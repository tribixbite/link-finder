# digr Architecture

## Overview

digr is a domain availability search tool that generates name candidates from user-supplied terms, mutations, and TLDs, then checks availability via a tri-mode resolver: local API (dig+whois), Cloudflare Worker edge proxy, or browser-native DNS-over-HTTPS + RDAP. Built for Termux on Android, but the deployed static site works without any backend.

## System Architecture

```
┌─────────────────────────────────────────────────────┐
│  SvelteKit SPA (port 5173)                          │
│  ┌─────────────┐  ┌──────────────────────┐          │
│  │ SearchInput  │  │ FilterSidebar        │          │
│  │ + mutations  │  │ + TLD/mutation chips │          │
│  └──────┬───────┘  │ + SettingsPanel      │          │
│         │           └──────────┬───────────┘          │
│  ┌──────▼─────────────────────▼───────────┐          │
│  │         AppState singleton             │          │
│  │  (Svelte 5 runes: $state, $derived)    │          │
│  │  results Map, filters, saved, pricing  │          │
│  └──────┬─────────────────────┬───────────┘          │
│         │ resolver.check()    │ persist()            │
│         │                     ▼                      │
│  ┌──────▼───────┐   ┌─────────────┐                 │
│  │ Result Cards │   │ localStorage│                 │
│  │ or Table     │   │ (2000 max)  │                 │
│  └──────────────┘   └─────────────┘                 │
└──────────────┬──────────────────────────────────────┘
               │ Resolver Interface
               ▼
┌──────────────────────────────────────────────────────┐
│  Tri-Mode Resolver (auto-detected on load)           │
│                                                      │
│  Mode 1: Local API (probe /api/health, 1.5s)         │
│  ┌──────────────────────────────────────────────┐    │
│  │  Bun API Server (port 3001)                  │    │
│  │  dig DNS (12 conc.) + whois verify (4 conc.) │    │
│  │  Dedup · 15min cache · rate limit · per-TLD  │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│  Mode 2: Edge Worker (probe worker/health, 3s)       │
│  ┌──────────────────────────────────────────────┐    │
│  │  Cloudflare Worker (digr-dns.workers.dev)    │    │
│  │  Server-side DoH + RDAP (no CORS issues)     │    │
│  │  20 concurrent checks, streaming response    │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│  Mode 3: Browser DoH (fallback, no probe needed)     │
│  ┌──────────────────────────────────────────────┐    │
│  │  DNS-over-HTTPS: Google/Cloudflare/Quad9     │    │
│  │  Round-robin, 8 concurrent, 20ms stagger     │    │
│  │  RDAP verification on-demand (lazy)          │    │
│  │  Returns 'likely-available' until verified    │    │
│  └──────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
```

## Resolver Architecture

All DNS/WHOIS operations go through a `Resolver` interface (`src/lib/resolvers/types.ts`). Three implementations exist:

| Mode | Probe | Backend | Status Accuracy | WHOIS |
|------|-------|---------|----------------|-------|
| Local API | `/api/health` (1.5s) | Bun server, dig+whois | Authoritative | Full whois text |
| Edge Worker | `worker/health` (3s) | Cloudflare Worker | Authoritative (DoH+RDAP) | RDAP JSON |
| Browser DoH | Fallback (no probe) | None (pure client-side) | `likely-available` until RDAP verified | RDAP JSON |

Auto-detection runs on app load: probes run in parallel, first success wins. User can force a mode via Settings panel (persisted to `digr-resolver-mode` in localStorage).

### Resolver Module (`src/lib/resolvers/`)

| File | Purpose |
|------|---------|
| `types.ts` | `Resolver` interface, `ResolverResult`, `DohProvider`, `DohResponse`, `RdapResponse` |
| `browser-resolver.ts` | DoH round-robin + RDAP verification + IANA bootstrap caching |
| `api-resolver.ts` | SSE stream parser wrapping local API server |
| `worker-resolver.ts` | Stream parser for Cloudflare Worker edge proxy |
| `index.ts` | `detectMode()`, `createResolver()`, `MODE_LABELS` |

### Two-Process Model (Local API mode)

| Process | Port | Role |
|---------|------|------|
| SvelteKit dev | 5173 | Serves UI, proxies `/api` to 3001 |
| Bun API server | 3001 | Domain checks (dig+whois), pricing |

In production, the API server can serve static files directly (`NODE_ENV=production`) or be paired with a reverse proxy. Docker deployment available via `Dockerfile` and `docker-compose.yml`.

**Without API server:** The deployed static site auto-detects no backend and falls back to Browser DoH mode.

## Component Hierarchy

```
+page.svelte
├── Header.svelte
│   └── theme toggle, resolver mode badge, offline banner, monitor/saved toggles
├── SearchInput.svelte
│   ├── terms textarea, TLD chips, mutation chips
│   ├── TLD presets (Cheap / Dev / ccTLDs)
│   ├── SearchHistory.svelte (recent searches dropdown)
│   ├── CustomMutationEditor.svelte ({term} pattern editor)
│   └── Dig button, candidate count
├── ResultToolbar.svelte
│   └── sort, view toggle, status tabs, counters
├── FilterPills.svelte
│   └── active filter indicators with remove buttons
├── FilterSidebar.svelte
│   ├── TLD filter chips, mutation filter chips, length range, registrar filter
│   └── SettingsPanel.svelte (resolver mode override, worker URL)
├── DomainCard.svelte / DomainTable.svelte
│   ├── bulk selection checkbox, status icon, domain name, copy button
│   ├── RegistrarMenu.svelte (available domains)
│   ├── SaveBookmarkButton.svelte
│   ├── whois detail button, monitor toggle
│   └── meta: term, mutation label, length, price, age
├── WhoisPanel.svelte
│   └── slide-in panel with parsed whois data
├── BulkActionBar.svelte
│   └── fixed bottom bar: save to list, copy, deselect
├── MonitorPanel.svelte
│   └── slide-in panel: tracked domains, interval config, status timeline
├── SavedPanel.svelte
│   └── lists CRUD, saved domains, import/export
└── Toast.svelte
    └── bottom-right notification stack
```

## State Management

### AppState Singleton (`src/lib/state/app.svelte.ts`)

Central reactive store using Svelte 5 runes:

| Category | Fields | Persistence |
|----------|--------|-------------|
| Input | `termsInput`, `selectedTlds`, `selectedMutations` | localStorage |
| Results | `results` (Map), `searching`, `progress` | localStorage (max 2000) |
| Filters | `filters` (status, tlds, mutations, length, search, registrars) | localStorage |
| Pricing | `pricing` (Map), `registrarTlds` (Map) | session only |
| Saved | `lists`, `saved`, `savedViewOpen`, `savedFilterListId` | localStorage |
| History | `searchHistory` (50 max) | localStorage |
| Custom | `customMutations` | localStorage |
| Whois | `whoisPanel` (domain, loading, data, error) | session only |
| Selection | `selectedDomains` (Set) | session only |
| Monitor | `monitorEntries`, `monitorConfig` | localStorage |
| Resolver | `resolverMode`, `resolverReady`, `isOffline` | `digr-resolver-mode` in localStorage |
| View | `sort`, `viewMode`, `theme`, `sidebarOpen` | localStorage |

### Module-Level Variables

Timers and AbortControllers are kept outside the class to avoid Svelte 5's reactive proxy wrapping:

- `_abortController` — search cancellation
- `_pendingUpdates`, `_flushTimer` — 150ms batched result updates
- `_persistInputTimer` — debounced input persistence
- `_monitorTimer` — periodic domain monitoring interval
- `_resolver` — active `Resolver` instance (initialized in `initTheme()`)

### Toast Store (`src/lib/state/toasts.svelte.ts`)

Lightweight notification system: `toasts.success()`, `toasts.error()`, `toasts.info()`. Auto-dismiss (3s default, 5s for errors).

## Data Flow

### Search Flow

1. User enters terms, selects TLDs and mutations
2. `app.candidates` (derived) generates `DomainCandidate[]` via `generateCandidates()`
3. User clicks "Dig" → `app.search()`
4. All candidates set to `status: 'checking'` in results Map
5. `resolver.check(domains, onResult, signal)` invoked on the active resolver
6. Results stream back via `onResult` callback; client batches updates every 150ms via `_flushUpdates()`
7. Final results persisted to localStorage

Behavior varies by resolver mode:
- **Local API**: POST `/api/stream` → dig (12 conc.) + whois (4 conc.) → authoritative `available`/`taken`
- **Edge Worker**: POST `worker/check` → server-side DoH + RDAP → authoritative `available`/`taken`
- **Browser DoH**: Client-side DoH round-robin (8 conc.) → `likely-available` for NXDOMAIN, lazy RDAP verify on click

### Two-Phase Availability Check

```
Domain → dig DNS lookup
  ├── Records found → TAKEN (dig)
  ├── NOERROR + no records → TAKEN (dig)
  └── NXDOMAIN → whois verification
       ├── Available patterns → AVAILABLE (whois)
       ├── Registered patterns → TAKEN (whois)
       ├── Reserved patterns → RESERVED (whois)
       └── Error (3 retries) → AVAILABLE with caveat (dig)
```

## localStorage Schema

All keys prefixed with `digr-`. Schema version tracked at `digr-schema-version`.

| Key | Type | Content |
|-----|------|---------|
| `digr-termsInput` | string | Raw textarea value |
| `digr-selectedTlds` | string[] | Active TLD selections |
| `digr-selectedMutations` | string[] | Active mutation selections |
| `digr-results` | [string, DomainResult][] | Map entries (max 2000, pruned by recency) |
| `digr-filters` | object | All filter state (Sets serialized as arrays) |
| `digr-sort` | object | `{ field, dir }` |
| `digr-viewMode` | string | `'card'` or `'table'` |
| `digr-lists` | DomainList[] | Bookmark lists |
| `digr-saved` | SavedDomain[] | Saved domain entries |
| `digr-schema-version` | number | Migration version (current: 2) |
| `digr-theme` | string | `'dark'` or `'light'` |
| `digr-history` | SearchHistoryEntry[] | Recent searches (max 50) |
| `digr-custom-mutations` | CustomMutation[] | User-defined {term} patterns |
| `digr-monitor-entries` | MonitorEntry[] | Tracked domains with status history |
| `digr-monitor-config` | MonitorConfig | Monitoring enabled flag + interval |
| `digr-resolver-mode` | ResolverMode | Forced resolver mode override (`local-api`, `edge-worker`, `browser-doh`) |
| `digr-worker-url` | string | Custom Cloudflare Worker URL (default: `https://digr-dns.workers.dev`) |

## URL State Sharing

Search configuration is encoded into the URL for sharing:

```
?q=torch,light&tlds=.dev,.app&mut=original,compound&sort=status:asc&status=available
```

Encoding/decoding handled by `encodeSearchParams()` / `decodeSearchParams()` in `src/lib/utils.ts`. URL sync is debounced (300ms) and guarded by `_urlInitialized` to prevent race conditions on page load.

## Technology Stack

- **Runtime**: Bun (handles both dev server and API)
- **Framework**: SvelteKit 2.16 with adapter-static (SPA mode)
- **Reactivity**: Svelte 5 runes ($state, $derived, $props, $effect)
- **Styling**: Tailwind CSS v4 (CSS-first, no config file)
- **Language**: TypeScript throughout
- **Platform**: Termux on Android (with postinstall.sh for native module fixes)
