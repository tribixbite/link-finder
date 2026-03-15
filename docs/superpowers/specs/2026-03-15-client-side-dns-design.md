# Client-Side DNS Resolution for digr

## Problem

digr requires a backend API server (`scripts/api-server.ts`) running `dig` and `whois` subprocesses to check domain availability. This means the deployed static site is non-functional without a running backend. Users must either self-host the API server or run locally on Termux.

## Goal

Eliminate the backend dependency for deployed/static versions by using browser-native DNS-over-HTTPS (DoH) and RDAP APIs, while keeping the local API server as an option for Termux use.

## Design: Tri-Mode Resolver

### Mode Priority (auto-detected on app load)

1. **Local API** — probe `localhost:3001/api/health` with 1.5s timeout. If reachable, use existing dig+whois subprocess behavior.
2. **Edge Worker** — probe configured Worker URL with 3s timeout. If reachable, use it for server-side DoH+RDAP.
3. **Browser DoH** — immediate fallback if both probes fail. Pure client-side, no probe needed.

Probes run in parallel on app load (`Promise.allSettled`). First successful probe wins. If user has a forced mode in localStorage, skip probing.

A small UI badge in the header shows the active mode (e.g., "Local API", "Edge Worker", "Browser DNS"). User can force a mode via settings panel.

### Architecture

```
src/lib/resolvers/
  types.ts              — Resolver interfaces, ResolverMode enum
  browser-resolver.ts   — DoH round-robin + lazy RDAP
  api-resolver.ts       — Existing SSE/API logic (extracted from app.svelte.ts)
  worker-resolver.ts    — Edge Worker client
  index.ts              — Auto-detection + mode switching + factory

workers/
  digr-worker/          — Cloudflare Worker (Wrangler project)
    src/index.ts        — Worker entry: DoH + RDAP handler
    wrangler.toml       — Worker config
```

### Resolver Interface

```typescript
type DomainStatus = 'available' | 'likely-available' | 'taken' | 'reserved' | 'error';
type ResolverMode = 'local-api' | 'edge-worker' | 'browser-doh';

interface ResolverResult {
  domain: string;
  status: DomainStatus;
  records: string[];
  error?: string;
  method: 'dig' | 'whois' | 'doh' | 'rdap' | 'worker';
}

interface Resolver {
  /** Check availability for a batch of domains, yielding results as they come */
  check(domains: string[], onResult: (result: ResolverResult) => void, signal?: AbortSignal): Promise<void>;

  /** Get detailed registration data for a single domain (whois/RDAP) */
  lookup(domain: string): Promise<WhoisData | null>;

  /** The active mode */
  readonly mode: ResolverMode;
}
```

### Browser Resolver Details

#### DoH Availability Check

**Providers (round-robin):**

| Provider | Endpoint | Accept Header |
|----------|----------|---------------|
| Google | `https://dns.google/resolve?name={d}&type=A` | none required |
| Cloudflare | `https://cloudflare-dns.com/dns-query?name={d}&type=A` | `application/dns-json` |
| Quad9 | `https://dns.quad9.net:5053/dns-query?name={d}&type=A` | `application/dns-json` |

All three serve `Access-Control-Allow-Origin: *`. GET requests only (avoids CORS preflight).

**Concurrency:** 8 concurrent requests total across all providers (not per-origin — all three use HTTP/2 which multiplexes on a single connection per origin). Stagger new requests by 20ms to smooth traffic. The real constraint is API-side rate limits (~1500 queries/min for Google, undocumented but generous for Cloudflare/Quad9), not browser connection limits.

**Status mapping:**
- DNS Status `3` (NXDOMAIN) → `likely-available`
- DNS Status `0` (NOERROR) with Answer records → `taken`
- DNS Status `0` (NOERROR) without Answer but with Authority SOA → `taken`
- DNS Status `0` (NOERROR) without Answer and without SOA → `taken` (conservative — empty non-terminals are still delegated)
- DNS Status `2` (SERVFAIL) → `error`
- Fetch failure → `error`

**Key distinction from current behavior:** Browser mode returns `likely-available` instead of `available`. This signals to the UI that RDAP confirmation is needed.

#### RDAP Verification (Lazy, On-Demand)

RDAP is NOT called in bulk. It is triggered when:
- User clicks a domain card marked `likely-available`
- User expands domain details / whois panel
- User explicitly requests verification

**Endpoint:** `https://rdap.org/domain/{domain}` (follows 302 redirect to registry)

**Status mapping:**
- HTTP 404 → upgrade to `available` (confirmed)
- HTTP 200 → downgrade to `taken` (false positive from DNS)
- HTTP 429 (rate limited) → keep as `likely-available`, show "rate limited, try again later", back off 5s
- Fetch failure (CORS, timeout) → keep as `likely-available`, show "RDAP unavailable for this TLD"

**CORS support verified for:** .com, .net, .org, .dev, .app, .io, .co
**Known CORS issues:** Many ccTLDs, some newer gTLDs. Graceful degradation — domain stays `likely-available`.

**RDAP reliability note:** `rdap.org` is a community-run redirect service. As a fallback, the browser resolver should fetch the IANA bootstrap file (`https://data.iana.org/rdap/dns.json`) once per session, cache it, and resolve registry RDAP URLs directly. This avoids the `rdap.org` single point of failure.

### Edge Worker Details

A Cloudflare Worker that receives domain arrays and performs DoH + RDAP server-side.

**Endpoint:** `POST https://{worker-url}/check`

**Request:**
```json
{ "domains": ["example.com", "test.dev", "foo.io"] }
```

**Response:** Chunked JSON lines (Worker client uses `fetch()` + `ReadableStream` text line parsing, NOT the `EventSource` API since `EventSource` only supports GET):
```
data: {"domain":"example.com","status":"available","records":[],"method":"worker"}
data: {"domain":"test.dev","status":"taken","records":["1.2.3.4"],"method":"worker"}
```

**Worker internals:**
- Uses `fetch()` to Google/Cloudflare DoH (no CORS restrictions server-side)
- Confirms NXDOMAIN results via RDAP (no CORS restrictions server-side)
- Returns authoritative `available` / `taken` / `reserved` status
- Rate limiting: per-IP, using Cloudflare's built-in rate limiting or KV-backed counter

**Deployment:** Wrangler CLI, free tier (100k requests/day, 10ms CPU per request).

**Worker URL configuration:** Stored in `localStorage` key `digr-worker-url`. Default: `https://digr-dns.workers.dev` (to be created during deployment). User can override in settings panel. Constant defined in `src/lib/resolvers/worker-resolver.ts` as `DEFAULT_WORKER_URL`.

### AppState Changes

Current flow in `app.svelte.ts`:
```
startSearch() → fetch('/api/stream') → SSE EventSource → batch updates
```

New flow:
```
startSearch() → resolver.check(domains, onResult, signal) → batch updates
```

The `onResult` callback feeds into the same `_pendingUpdates` / `_flushTimer` batching logic. No changes to the UI update path.

**Changes to AppState:**
1. Import resolver factory from `src/lib/resolvers/index.ts`
2. Replace ALL `fetch('/api/...')` calls with resolver methods:
   - `startSearch()` → `resolver.check()` (replaces `fetch('/api/stream')`)
   - `recheckStale()` → `resolver.check()` (replaces `fetch('/api/check')`)
   - `recheckDomain()` → `resolver.check()` for single domain (replaces `fetch('/api/check')`)
   - `recheckAllErrors()` → `resolver.check()` (replaces `fetch('/api/check')`)
   - `runMonitorCheck()` → `resolver.check()` (replaces `fetch('/api/check')`)
   - `fetchWhoisData()` → `resolver.lookup()` (replaces `fetch('/api/whois')`)
   - `fetchPricing()` → direct `fetch('https://porkbun.com/api/...')` from browser (Porkbun API is public with CORS), or via Worker proxy
3. Add `resolverMode` reactive state for the UI badge
4. Add mode override setting (persisted to localStorage key `digr-resolver-mode`)

### New Status: `likely-available`

**Visual treatment:**
- Different color from confirmed `available` (e.g., amber/yellow vs green)
- Small "verify" icon/button on the domain card
- Tooltip: "DNS indicates this domain may be available. Click to verify."
- Clicking triggers RDAP check, upgrades to `available` or downgrades to `taken`

**Type changes in `src/lib/types.ts`:**
- Create shared status type: `type DomainStatus = 'available' | 'likely-available' | 'taken' | 'reserved' | 'error'`
- Update `DomainResult.status` to use `DomainStatus`
- Update `DomainResult.previousStatus` to use `DomainStatus`
- Update `SavedDomain.status` to use `DomainStatus` (likely-available domains can be saved; they persist as `likely-available` and get re-verified on next check)
- Update `MonitorEntry.status` to use `DomainStatus`
- Expand `DomainResult.method` to `'dig' | 'whois' | 'doh' | 'rdap' | 'worker'`
- Update `Filters.status` to `'all' | 'available' | 'likely-available' | 'taken' | 'reserved'`
- Add sort priority for `likely-available` between `available` and `taken` in `filteredResults` sort map

**Filter behavior:** The `'available'` filter shows ONLY confirmed available. A separate `'likely-available'` filter option shows unverified results. This distinction is intentional — users should see the confidence level.

**Monitor behavior per mode:**
- Local API mode: monitor checks return authoritative `available`/`taken` (no change)
- Edge Worker mode: monitor checks return authoritative `available`/`taken` (Worker does RDAP)
- Browser DoH mode: monitor checks return `likely-available` for NXDOMAIN results. Auto-trigger RDAP verification for monitored domains (since the set is small, typically < 20 domains)

**Schema migration:** Adding `likely-available` requires bumping `SCHEMA_VERSION` to 2. Migration is backward-compatible — existing persisted results with the old status values remain valid. No data migration needed; the new status only appears on fresh searches or re-checks.

### UI Changes

1. **Mode badge** — small pill in header: "Local API" / "Edge Worker" / "Browser DNS"
2. **Domain card** — amber color for `likely-available`, verify button
3. **Settings panel** — resolver mode override dropdown, Worker URL field
4. **Whois panel** — works with RDAP JSON in browser/worker mode, full whois in API mode

### Edge Cases

| Scenario | Handling |
|----------|----------|
| Wildcard DNS (.ws, some ccTLDs) | DoH returns NOERROR → correctly marked `taken`. No false available. |
| Parked domain, no nameservers | DoH returns NXDOMAIN → marked `likely-available`. RDAP verify catches it. |
| RDAP CORS failure | Domain stays `likely-available`. UI shows "verification unavailable". |
| DoH provider down | Round-robin skips to next provider. All down → error with retry option. |
| Browser offline | Detected via `navigator.onLine`. Show offline banner, disable search. |
| Worker rate limited | Fall back to browser DoH mode automatically. |

### What Does NOT Change

- Mutation/candidate generation logic (`src/lib/mutations.ts`)
- UI components structure (DomainCard, SearchInput, FilterSidebar, etc.)
- localStorage key prefix (`digr-`)
- Domain lists, saved domains, search history
- API server code (`scripts/api-server.ts`) — kept as-is

### What Changes (beyond resolver)

- `SCHEMA_VERSION` bumps from 1 to 2 (backward-compatible, no migration needed)
- `Filters.status` gets new `'likely-available'` option
- Domain monitoring auto-verifies via RDAP in browser-doh mode
- New localStorage keys: `digr-resolver-mode`, `digr-worker-url`

### Migration Path

1. Create resolver abstraction and browser resolver
2. Extract API resolver from current app state
3. Wire up AppState to use resolver factory
4. Add `likely-available` status and UI treatment
5. Build and deploy Cloudflare Worker
6. Add Worker resolver client
7. Add auto-detection and mode switching
8. Add UI badge and settings
9. Update docs and deployment guide
