# Client-Side DNS Resolution Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate backend dependency for deployed digr by adding browser-native DNS-over-HTTPS + RDAP resolution, with Cloudflare Worker as middle tier.

**Architecture:** Tri-mode resolver (Local API > Edge Worker > Browser DoH) behind a `Resolver` interface. AppState delegates all DNS/whois calls through the resolver. Auto-detection on load picks the best available mode. Browser mode uses round-robin DoH across Google/Cloudflare/Quad9 with lazy RDAP verification.

**Tech Stack:** SvelteKit 5 / Svelte 5 runes, TypeScript, Bun, Tailwind CSS v4, Cloudflare Workers (Wrangler)

**Spec:** `docs/superpowers/specs/2026-03-15-client-side-dns-design.md`

---

## Chunk 1: Types & Resolver Interface

### Task 1: Update shared types in `src/lib/types.ts`

**Files:**
- Modify: `src/lib/types.ts:17-31` (DomainResult interface)
- Modify: `src/lib/types.ts:174-185` (Filters interface)
- Modify: `src/lib/types.ts:206-212` (SavedDomain interface)
- Modify: `src/lib/types.ts:274-279` (MonitorEntry interface)

- [ ] **Step 1: Add `DomainStatus` type and `ResolverMode` type**

Add after the `DomainCandidate` interface (line 15):

```typescript
/** Shared domain status — used across results, saved domains, and monitoring */
export type DomainStatus = 'available' | 'likely-available' | 'taken' | 'reserved' | 'error' | 'checking';

/** How the domain status was determined */
export type DomainMethod = 'dig' | 'whois' | 'doh' | 'rdap' | 'worker';

/** Active resolver mode */
export type ResolverMode = 'local-api' | 'edge-worker' | 'browser-doh';
```

- [ ] **Step 2: Update `DomainResult` to use shared types**

Replace the `DomainResult` interface (lines 18-31):

```typescript
/** Result of checking a domain's availability */
export interface DomainResult extends DomainCandidate {
	/** DNS records found (empty = no records) */
	records: string[];
	/** Availability status */
	status: DomainStatus;
	/** How the status was determined */
	method?: DomainMethod;
	/** Error message if status is 'error' */
	error?: string;
	/** Timestamp of check */
	checkedAt?: number;
	/** Previous status before recheck (only set when status changed) */
	previousStatus?: DomainStatus;
}
```

- [ ] **Step 3: Update `Filters.status` to include `likely-available`**

Replace line 176:

```typescript
status: 'all' | 'available' | 'likely-available' | 'taken' | 'reserved';
```

- [ ] **Step 4: Update `SavedDomain.status` to use `DomainStatus`**

Replace lines 206-212:

```typescript
/** A domain saved to a list */
export interface SavedDomain {
	domain: string;
	listId: string;
	status: DomainStatus;
	addedAt: number;
	notes?: string;
}
```

- [ ] **Step 5: Update `WhoisData` to support RDAP source**

Replace lines 258-271:

```typescript
/** Whois/RDAP detail data */
export interface WhoisData {
	domain: string;
	/** Raw text (whois) or JSON string (RDAP) */
	raw: string;
	parsed: {
		registrar?: string;
		created?: string;
		expires?: string;
		updated?: string;
		nameservers?: string[];
		status?: string[];
	};
	fetchedAt: number;
	/** Data source */
	source?: 'whois' | 'rdap';
}
```

- [ ] **Step 6: Run typecheck**

Run: `cd /data/data/com.termux/files/home/git/digr && bun run check`

Expected: Type errors in `app.svelte.ts` and components referencing old status values — these are expected and will be fixed in Task 4.

- [ ] **Step 7: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add DomainStatus type, likely-available status, ResolverMode"
```

### Task 2: Create resolver type definitions

**Files:**
- Create: `src/lib/resolvers/types.ts`

- [ ] **Step 1: Create the resolver interface module**

```typescript
import type { DomainStatus, DomainMethod, ResolverMode, WhoisData } from '../types';

/** Result from a resolver check */
export interface ResolverResult {
	domain: string;
	status: DomainStatus;
	records: string[];
	error?: string;
	method: DomainMethod;
}

/** Callback for streaming results */
export type OnResult = (result: ResolverResult) => void;

/** Resolver interface — all three modes implement this */
export interface Resolver {
	/** Check availability for a batch of domains, calling onResult as they complete */
	check(domains: string[], onResult: OnResult, signal?: AbortSignal): Promise<void>;

	/** Get detailed registration data for a single domain (whois/RDAP) */
	lookup(domain: string): Promise<WhoisData | null>;

	/** Verify a likely-available domain via RDAP (browser mode only, no-op for others) */
	verify(domain: string): Promise<ResolverResult>;

	/** The active mode */
	readonly mode: ResolverMode;
}

/** DoH provider configuration */
export interface DohProvider {
	name: string;
	url: (domain: string) => string;
	headers?: Record<string, string>;
}

/** DoH JSON response shape (Google/Cloudflare/Quad9) */
export interface DohResponse {
	Status: number; // 0=NOERROR, 2=SERVFAIL, 3=NXDOMAIN
	Answer?: Array<{ name: string; type: number; TTL: number; data: string }>;
	Authority?: Array<{ name: string; type: number; TTL: number; data: string }>;
}

/** RDAP domain response (subset of fields we use) */
export interface RdapResponse {
	handle?: string;
	ldhName?: string;
	status?: string[];
	entities?: Array<{
		roles?: string[];
		vcardArray?: unknown[];
		publicIds?: Array<{ type: string; identifier: string }>;
	}>;
	events?: Array<{ eventAction: string; eventDate: string }>;
	nameservers?: Array<{ ldhName: string }>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/resolvers/types.ts
git commit -m "feat: add resolver interface and DoH/RDAP type definitions"
```

### Task 3: Create browser resolver

**Files:**
- Create: `src/lib/resolvers/browser-resolver.ts`

- [ ] **Step 1: Write the DoH provider config and round-robin logic**

```typescript
import type {
	Resolver, ResolverResult, OnResult,
	DohProvider, DohResponse, RdapResponse,
} from './types';
import type { WhoisData, ResolverMode } from '../types';

/** DoH providers with CORS support */
const DOH_PROVIDERS: DohProvider[] = [
	{
		name: 'google',
		url: (d) => `https://dns.google/resolve?name=${encodeURIComponent(d)}&type=A`,
	},
	{
		name: 'cloudflare',
		url: (d) => `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(d)}&type=A`,
		headers: { Accept: 'application/dns-json' },
	},
	{
		name: 'quad9',
		url: (d) => `https://dns.quad9.net:5053/dns-query?name=${encodeURIComponent(d)}&type=A`,
		headers: { Accept: 'application/dns-json' },
	},
];

/** Max concurrent DoH requests across all providers */
const MAX_CONCURRENT = 8;

/** Stagger between launching new requests (ms) */
const STAGGER_MS = 20;

/** RDAP rate limit backoff (ms) */
const RDAP_BACKOFF_MS = 5000;

/** IANA RDAP bootstrap file URL */
const IANA_BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json';

/** RDAP fallback redirect service */
const RDAP_ORG_URL = 'https://rdap.org/domain/';

/** Cached IANA bootstrap: TLD → RDAP base URL */
let _bootstrapCache: Map<string, string> | null = null;
let _bootstrapFetchedAt = 0;
const BOOTSTRAP_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/** Track RDAP rate limiting per-TLD */
const _rdapBackoff = new Map<string, number>();

/** Round-robin counter */
let _providerIdx = 0;

function nextProvider(): DohProvider {
	const p = DOH_PROVIDERS[_providerIdx % DOH_PROVIDERS.length];
	_providerIdx++;
	return p;
}

function extractTld(domain: string): string {
	const dot = domain.lastIndexOf('.');
	return dot >= 0 ? domain.slice(dot + 1) : domain;
}
```

- [ ] **Step 2: Write the DoH check function**

```typescript
/** Query a single domain via DoH, returns ResolverResult */
async function dohCheck(domain: string, signal?: AbortSignal): Promise<ResolverResult> {
	const provider = nextProvider();
	try {
		const res = await fetch(provider.url(domain), {
			headers: provider.headers,
			signal,
		});
		if (!res.ok) {
			return { domain, status: 'error', records: [], error: `DoH ${provider.name}: HTTP ${res.status}`, method: 'doh' };
		}
		const data: DohResponse = await res.json();

		// NXDOMAIN = likely available
		if (data.Status === 3) {
			return { domain, status: 'likely-available', records: [], method: 'doh' };
		}

		// SERVFAIL
		if (data.Status === 2) {
			return { domain, status: 'error', records: [], error: 'SERVFAIL', method: 'doh' };
		}

		// NOERROR — extract answer records
		const records = (data.Answer ?? [])
			.filter((a) => a.type === 1 || a.type === 28) // A or AAAA
			.map((a) => a.data);

		// Has answers → taken. No answers but NOERROR → still taken (registered, no A records)
		return { domain, status: 'taken', records, method: 'doh' };
	} catch (err) {
		if (signal?.aborted) {
			return { domain, status: 'error', records: [], error: 'aborted', method: 'doh' };
		}
		return { domain, status: 'error', records: [], error: `DoH ${provider.name}: ${err instanceof Error ? err.message : 'failed'}`, method: 'doh' };
	}
}
```

- [ ] **Step 3: Write the RDAP bootstrap and verification functions**

```typescript
/** Fetch IANA bootstrap file and cache TLD → RDAP URL mapping */
async function loadBootstrap(): Promise<Map<string, string>> {
	if (_bootstrapCache && Date.now() - _bootstrapFetchedAt < BOOTSTRAP_TTL_MS) {
		return _bootstrapCache;
	}
	try {
		const res = await fetch(IANA_BOOTSTRAP_URL);
		const data = await res.json() as { services: Array<[string[], string[]]> };
		const map = new Map<string, string>();
		for (const [tlds, urls] of data.services) {
			const baseUrl = urls[0]; // first URL is preferred
			for (const tld of tlds) {
				map.set(tld.toLowerCase(), baseUrl);
			}
		}
		_bootstrapCache = map;
		_bootstrapFetchedAt = Date.now();
		return map;
	} catch {
		// Return empty map — will fall back to rdap.org
		return _bootstrapCache ?? new Map();
	}
}

/** Build the RDAP URL for a domain, using bootstrap or rdap.org fallback */
async function getRdapUrl(domain: string): Promise<string> {
	const tld = extractTld(domain);
	const bootstrap = await loadBootstrap();
	const baseUrl = bootstrap.get(tld);
	if (baseUrl) {
		// Ensure trailing slash
		const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
		return `${base}domain/${domain}`;
	}
	return `${RDAP_ORG_URL}${domain}`;
}

/** Parse RDAP response into WhoisData format */
function parseRdapResponse(domain: string, rdap: RdapResponse, raw: string): WhoisData {
	const parsed: WhoisData['parsed'] = {};

	// Extract registrar from entities with 'registrar' role
	const registrar = rdap.entities?.find((e) => e.roles?.includes('registrar'));
	if (registrar?.vcardArray) {
		// vCard format: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "Name"]]]
		const vcard = registrar.vcardArray[1] as Array<unknown[]>;
		const fn = vcard?.find((f) => f[0] === 'fn');
		if (fn) parsed.registrar = String(fn[3]);
	}
	if (!parsed.registrar && registrar?.publicIds?.[0]) {
		parsed.registrar = `IANA ID: ${registrar.publicIds[0].identifier}`;
	}

	// Extract events (dates)
	if (rdap.events) {
		for (const ev of rdap.events) {
			if (ev.eventAction === 'registration' && !parsed.created) parsed.created = ev.eventDate;
			if (ev.eventAction === 'expiration' && !parsed.expires) parsed.expires = ev.eventDate;
			if (ev.eventAction === 'last changed' && !parsed.updated) parsed.updated = ev.eventDate;
		}
	}

	// Nameservers
	if (rdap.nameservers) {
		parsed.nameservers = rdap.nameservers.map((ns) => ns.ldhName.toLowerCase());
	}

	// Status
	if (rdap.status) {
		parsed.status = rdap.status;
	}

	return { domain, raw, parsed, fetchedAt: Date.now(), source: 'rdap' };
}

/** Verify a single domain via RDAP — called on-demand, not in bulk */
async function rdapVerify(domain: string): Promise<ResolverResult> {
	const tld = extractTld(domain);

	// Check rate limit backoff
	const backoffUntil = _rdapBackoff.get(tld) ?? 0;
	if (Date.now() < backoffUntil) {
		return { domain, status: 'likely-available', records: [], error: 'rate limited, try again later', method: 'rdap' };
	}

	try {
		const url = await getRdapUrl(domain);
		const res = await fetch(url, { redirect: 'follow' });

		if (res.status === 404) {
			// Not in registry → confirmed available
			return { domain, status: 'available', records: [], method: 'rdap' };
		}

		if (res.status === 429) {
			// Rate limited — backoff for this TLD
			_rdapBackoff.set(tld, Date.now() + RDAP_BACKOFF_MS);
			return { domain, status: 'likely-available', records: [], error: 'rate limited, try again later', method: 'rdap' };
		}

		if (res.ok) {
			// Domain exists → taken (even if DNS said NXDOMAIN)
			return { domain, status: 'taken', records: [], method: 'rdap' };
		}

		// Other HTTP errors
		return { domain, status: 'likely-available', records: [], error: `RDAP: HTTP ${res.status}`, method: 'rdap' };
	} catch {
		// CORS failure, network error — domain stays likely-available
		return { domain, status: 'likely-available', records: [], error: 'RDAP unavailable for this TLD', method: 'rdap' };
	}
}
```

- [ ] **Step 4: Write the RDAP lookup function (for whois panel)**

```typescript
/** Fetch full RDAP data for whois panel display */
async function rdapLookup(domain: string): Promise<WhoisData | null> {
	try {
		const url = await getRdapUrl(domain);
		const res = await fetch(url, { redirect: 'follow' });
		if (!res.ok) return null;
		const raw = await res.text();
		const rdap: RdapResponse = JSON.parse(raw);
		return parseRdapResponse(domain, rdap, raw);
	} catch {
		return null;
	}
}
```

- [ ] **Step 5: Write the concurrent runner and BrowserResolver class**

```typescript
/** Run tasks with concurrency limit and stagger */
async function runConcurrent<T>(
	items: T[],
	concurrency: number,
	staggerMs: number,
	fn: (item: T) => Promise<void>,
	signal?: AbortSignal,
): Promise<void> {
	const queue = [...items];
	const active = new Set<Promise<void>>();
	let lastLaunch = 0;

	while ((queue.length > 0 || active.size > 0) && !signal?.aborted) {
		while (queue.length > 0 && active.size < concurrency && !signal?.aborted) {
			// Stagger
			const now = Date.now();
			const wait = Math.max(0, lastLaunch + staggerMs - now);
			if (wait > 0) await new Promise((r) => setTimeout(r, wait));
			lastLaunch = Date.now();

			const item = queue.shift()!;
			const task = fn(item).finally(() => active.delete(task));
			active.add(task);
		}
		if (active.size > 0) {
			await Promise.race(active);
		}
	}
}

/** Browser-based resolver using DoH + RDAP */
export class BrowserResolver implements Resolver {
	readonly mode: ResolverMode = 'browser-doh';

	async check(domains: string[], onResult: OnResult, signal?: AbortSignal): Promise<void> {
		await runConcurrent(domains, MAX_CONCURRENT, STAGGER_MS, async (domain) => {
			const result = await dohCheck(domain, signal);
			if (!signal?.aborted) onResult(result);
		}, signal);
	}

	async lookup(domain: string): Promise<WhoisData | null> {
		return rdapLookup(domain);
	}

	async verify(domain: string): Promise<ResolverResult> {
		return rdapVerify(domain);
	}
}
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/resolvers/browser-resolver.ts
git commit -m "feat: add browser resolver with DoH round-robin and RDAP verification"
```

### Task 4: Extract API resolver from AppState

**Files:**
- Create: `src/lib/resolvers/api-resolver.ts`

- [ ] **Step 1: Write the API resolver that wraps existing fetch calls**

```typescript
import type { Resolver, ResolverResult, OnResult } from './types';
import type { WhoisData, ResolverMode } from '../types';

/** API server base URL */
const API_BASE = '/api';

/** Resolver that uses the local Bun API server (dig + whois) */
export class ApiResolver implements Resolver {
	readonly mode: ResolverMode = 'local-api';

	async check(domains: string[], onResult: OnResult, signal?: AbortSignal): Promise<void> {
		const res = await fetch(`${API_BASE}/stream`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ domains }),
			signal,
		});

		const reader = res.body!.getReader();
		const decoder = new TextDecoder();
		let buffer = '';

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() || '';

			for (const line of lines) {
				if (!line.startsWith('data: ')) continue;
				try {
					const event = JSON.parse(line.slice(6));
					if (event.type === 'result') {
						onResult({
							domain: event.domain,
							status: event.status,
							records: event.records ?? [],
							error: event.error,
							method: event.method ?? 'dig',
						});
					}
				} catch {
					// skip malformed events
				}
			}
		}

		// Process remaining buffer
		if (buffer.startsWith('data: ')) {
			try {
				const event = JSON.parse(buffer.slice(6));
				if (event.type === 'result') {
					onResult({
						domain: event.domain,
						status: event.status,
						records: event.records ?? [],
						error: event.error,
						method: event.method ?? 'dig',
					});
				}
			} catch {
				// partial event at end of stream
			}
		}
	}

	async lookup(domain: string): Promise<WhoisData | null> {
		try {
			const res = await fetch(`${API_BASE}/whois?domain=${encodeURIComponent(domain)}`);
			if (!res.ok) return null;
			return await res.json() as WhoisData;
		} catch {
			return null;
		}
	}

	async verify(domain: string): Promise<ResolverResult> {
		// API mode uses dig+whois, so verify is just a single-domain check
		return new Promise((resolve) => {
			this.check([domain], (result) => resolve(result)).catch(() => {
				resolve({ domain, status: 'error', records: [], error: 'verify failed', method: 'dig' });
			});
		});
	}
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/resolvers/api-resolver.ts
git commit -m "feat: extract API resolver from AppState"
```

### Task 5: Create worker resolver client

**Files:**
- Create: `src/lib/resolvers/worker-resolver.ts`

- [ ] **Step 1: Write the Worker resolver**

```typescript
import type { Resolver, ResolverResult, OnResult } from './types';
import type { WhoisData, ResolverMode } from '../types';

/** Default Cloudflare Worker URL */
export const DEFAULT_WORKER_URL = 'https://digr-dns.workers.dev';

/** localStorage key for Worker URL override */
const LS_WORKER_URL = 'digr-worker-url';

function getWorkerUrl(): string {
	try {
		return localStorage.getItem(LS_WORKER_URL) || DEFAULT_WORKER_URL;
	} catch {
		return DEFAULT_WORKER_URL;
	}
}

/** Resolver that uses the Cloudflare Worker edge proxy */
export class WorkerResolver implements Resolver {
	readonly mode: ResolverMode = 'edge-worker';

	async check(domains: string[], onResult: OnResult, signal?: AbortSignal): Promise<void> {
		const workerUrl = getWorkerUrl();
		const res = await fetch(`${workerUrl}/check`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ domains }),
			signal,
		});

		const reader = res.body!.getReader();
		const decoder = new TextDecoder();
		let buffer = '';

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() || '';

			for (const line of lines) {
				if (!line.startsWith('data: ')) continue;
				try {
					const event = JSON.parse(line.slice(6));
					onResult({
						domain: event.domain,
						status: event.status,
						records: event.records ?? [],
						error: event.error,
						method: 'worker',
					});
				} catch {
					// skip malformed
				}
			}
		}

		// Remaining buffer
		if (buffer.startsWith('data: ')) {
			try {
				const event = JSON.parse(buffer.slice(6));
				onResult({
					domain: event.domain,
					status: event.status,
					records: event.records ?? [],
					error: event.error,
					method: 'worker',
				});
			} catch { /* partial */ }
		}
	}

	async lookup(domain: string): Promise<WhoisData | null> {
		const workerUrl = getWorkerUrl();
		try {
			const res = await fetch(`${workerUrl}/lookup?domain=${encodeURIComponent(domain)}`);
			if (!res.ok) return null;
			return await res.json() as WhoisData;
		} catch {
			return null;
		}
	}

	async verify(domain: string): Promise<ResolverResult> {
		// Worker does server-side RDAP, so verify is a single-domain check
		return new Promise((resolve) => {
			this.check([domain], (result) => resolve(result)).catch(() => {
				resolve({ domain, status: 'error', records: [], error: 'verify failed', method: 'worker' });
			});
		});
	}
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/resolvers/worker-resolver.ts
git commit -m "feat: add worker resolver client for Cloudflare edge proxy"
```

## Chunk 2: Resolver Factory & AppState Integration

### Task 6: Create resolver factory with auto-detection

**Files:**
- Create: `src/lib/resolvers/index.ts`

- [ ] **Step 1: Write the auto-detection and factory**

```typescript
import type { Resolver } from './types';
import type { ResolverMode } from '../types';
import { ApiResolver } from './api-resolver';
import { BrowserResolver } from './browser-resolver';
import { WorkerResolver, DEFAULT_WORKER_URL } from './worker-resolver';

export type { Resolver, ResolverResult, OnResult } from './types';

/** localStorage keys */
const LS_MODE_OVERRIDE = 'digr-resolver-mode';
const LS_WORKER_URL = 'digr-worker-url';

/** Probe timeout for local API (ms) */
const API_PROBE_TIMEOUT = 1500;

/** Probe timeout for Worker (ms) */
const WORKER_PROBE_TIMEOUT = 3000;

/** Probe a URL, returning true if it responds with 2xx within timeout */
async function probe(url: string, timeoutMs: number): Promise<boolean> {
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		const res = await fetch(url, { signal: controller.signal });
		clearTimeout(timer);
		return res.ok;
	} catch {
		return false;
	}
}

/** Auto-detect the best available resolver mode */
export async function detectMode(): Promise<ResolverMode> {
	// Check for forced mode in localStorage
	try {
		const forced = localStorage.getItem(LS_MODE_OVERRIDE) as ResolverMode | null;
		if (forced && ['local-api', 'edge-worker', 'browser-doh'].includes(forced)) {
			return forced;
		}
	} catch { /* localStorage unavailable */ }

	// Probe local API and Worker in parallel
	const workerUrl = (() => {
		try { return localStorage.getItem(LS_WORKER_URL) || DEFAULT_WORKER_URL; }
		catch { return DEFAULT_WORKER_URL; }
	})();

	const [apiOk, workerOk] = await Promise.all([
		probe('/api/health', API_PROBE_TIMEOUT),
		probe(`${workerUrl}/health`, WORKER_PROBE_TIMEOUT),
	]);

	if (apiOk) return 'local-api';
	if (workerOk) return 'edge-worker';
	return 'browser-doh';
}

/** Create a resolver instance for the given mode */
export function createResolver(mode: ResolverMode): Resolver {
	switch (mode) {
		case 'local-api': return new ApiResolver();
		case 'edge-worker': return new WorkerResolver();
		case 'browser-doh': return new BrowserResolver();
	}
}

/** Mode display labels for UI */
export const MODE_LABELS: Record<ResolverMode, string> = {
	'local-api': 'Local API',
	'edge-worker': 'Edge Worker',
	'browser-doh': 'Browser DNS',
};
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/resolvers/index.ts
git commit -m "feat: add resolver factory with auto-detection"
```

### Task 7: Wire AppState to use resolver abstraction

**Files:**
- Modify: `src/lib/state/app.svelte.ts` (major refactor of all fetch calls)

This is the largest task. Replace all direct `fetch('/api/...')` calls with resolver methods.

- [ ] **Step 1: Add resolver imports and state to AppState**

At the top of `app.svelte.ts`, add imports:

```typescript
import { detectMode, createResolver, MODE_LABELS } from '../resolvers';
import type { Resolver, ResolverResult } from '../resolvers';
import type { ResolverMode } from '../types';
```

Add module-level resolver variable (outside the class, with other module-level vars near line 45):

```typescript
let _resolver: Resolver | null = null;
```

Add reactive state inside the `AppState` class (after `monitorPanelOpen`):

```typescript
// --- Resolver state ---
resolverMode = $state<ResolverMode>('browser-doh');
resolverReady = $state(false);
```

- [ ] **Step 2: Add resolver initialization to `initTheme()`**

In the `initTheme()` method (around line 1106), after the service worker registration block, add resolver initialization:

```typescript
// Detect and initialize resolver
detectMode().then((mode) => {
	this.resolverMode = mode;
	_resolver = createResolver(mode);
	this.resolverReady = true;
});
```

- [ ] **Step 3: Add `getResolver()` helper and `switchResolver()` method**

Add to AppState class:

```typescript
/** Get the active resolver (falls back to browser if not yet initialized) */
private getResolver(): Resolver {
	if (!_resolver) {
		_resolver = createResolver('browser-doh');
	}
	return _resolver;
}

/** Switch resolver mode (for settings UI) */
switchResolver(mode: ResolverMode) {
	this.resolverMode = mode;
	_resolver = createResolver(mode);
	try {
		localStorage.setItem('digr-resolver-mode', mode);
	} catch { /* ignore */ }
}

/** Clear forced resolver mode (revert to auto-detection) */
clearResolverOverride() {
	try {
		localStorage.removeItem('digr-resolver-mode');
	} catch { /* ignore */ }
	// Re-detect
	detectMode().then((mode) => {
		this.resolverMode = mode;
		_resolver = createResolver(mode);
	});
}
```

- [ ] **Step 4: Rewrite `search()` to use resolver**

Replace the `search()` method (lines 1164-1269):

```typescript
/** Start domain search using resolver */
async search() {
	const candidates = this.candidates;
	if (candidates.length === 0) return;

	// Cancel any existing search
	_abortController?.abort();
	_abortController = new AbortController();
	const signal = _abortController.signal;

	// Reset results with 'checking' status
	const nextResults = new Map<string, DomainResult>();
	for (const c of candidates) {
		nextResults.set(c.domain, { ...c, records: [], status: 'checking' });
	}
	this.results = nextResults;
	this.searching = true;
	this.progress = { done: 0, total: candidates.length };
	_pendingUpdates = [];
	_lastProgress = 0;

	try {
		const domains = candidates.map((c) => c.domain);
		const resolver = this.getResolver();
		let done = 0;

		await resolver.check(domains, (result) => {
			done++;
			_pendingUpdates.push({
				domain: result.domain,
				records: result.records,
				status: result.status,
				error: result.error,
			});
			_lastProgress = done;
			// Batch flush every 150ms
			if (!_flushTimer) {
				_flushTimer = setTimeout(() => this._flushUpdates(), 150);
			}
		}, signal);

		// Flush remaining updates
		if (_flushTimer) clearTimeout(_flushTimer);
		this._flushUpdates();
	} catch (err) {
		if (signal.aborted) return;
		console.error('Search error:', err);
	} finally {
		this.searching = false;
		_abortController = null;
		if (_flushTimer) {
			clearTimeout(_flushTimer);
			this._flushUpdates();
		}
		this.persist();
		this.saveToHistory();
	}
}
```

- [ ] **Step 5: Rewrite `recheckStale()` to use resolver**

Replace the `recheckStale()` method (lines 356-414):

```typescript
/** Re-check all stale results (older than 24h) */
async recheckStale() {
	const staleEntries = [...this.results.values()]
		.filter((r) => r.status !== 'checking' && isStale(r.checkedAt));
	if (staleEntries.length === 0) return;

	const oldStatuses = new Map<string, DomainResult['previousStatus']>(staleEntries.map((r) => [r.domain, r.status as DomainResult['previousStatus']]));
	const staleDomains = staleEntries.map((r) => r.domain);

	// Set all stale to checking
	const updated = new Map(this.results);
	for (const d of staleDomains) {
		const entry = updated.get(d);
		if (entry) updated.set(d, { ...entry, status: 'checking', error: undefined });
	}
	this.results = updated;

	try {
		const resolver = this.getResolver();
		const resultMap = new Map<string, ResolverResult>();
		await resolver.check(staleDomains, (r) => { resultMap.set(r.domain, r); });

		let changed = 0;
		const next = new Map(this.results);
		for (const [domain, r] of resultMap) {
			const entry = next.get(domain);
			if (entry) {
				const oldStatus = oldStatuses.get(domain);
				const statusChanged = oldStatus && oldStatus !== r.status;
				if (statusChanged) changed++;
				next.set(domain, {
					...entry,
					records: r.records,
					status: r.status,
					error: r.error,
					checkedAt: Date.now(),
					previousStatus: statusChanged ? oldStatus : entry.previousStatus,
				});
			}
		}
		this.results = next;
		toasts.success(`Rechecked ${staleDomains.length} stale${changed > 0 ? `, ${changed} changed` : ''}`);
	} catch {
		const next = new Map(this.results);
		for (const d of staleDomains) {
			const entry = next.get(d);
			if (entry && entry.status === 'checking') {
				next.set(d, { ...entry, status: 'error', error: 'stale recheck failed' });
			}
		}
		this.results = next;
	}
	this.persist();
}
```

- [ ] **Step 6: Rewrite `recheckDomain()` to use resolver**

Replace the `recheckDomain()` method (lines 730-776):

```typescript
/** Re-check a single domain (for retrying errors) */
async recheckDomain(domain: string) {
	const existing = this.results.get(domain);
	if (!existing) return;

	const oldStatus = existing.status !== 'checking' ? existing.status : undefined;

	const updated = new Map(this.results);
	updated.set(domain, { ...existing, status: 'checking', error: undefined });
	this.results = updated;

	try {
		const resolver = this.getResolver();
		const result = await resolver.verify(domain);
		const next = new Map(this.results);
		const entry = next.get(domain);
		if (entry) {
			const statusChanged = oldStatus && oldStatus !== result.status;
			next.set(domain, {
				...entry,
				records: result.records,
				status: result.status,
				error: result.error,
				checkedAt: Date.now(),
				previousStatus: statusChanged ? oldStatus : entry.previousStatus,
			});
			this.results = next;
		}
	} catch {
		const next = new Map(this.results);
		const entry = next.get(domain);
		if (entry) {
			next.set(domain, { ...entry, status: 'error', error: 'retry failed' });
			this.results = next;
		}
	}
	this.persist();
}
```

- [ ] **Step 7: Rewrite `recheckAllErrors()` to use resolver**

Replace the `recheckAllErrors()` method (lines 779-837):

```typescript
/** Re-check all domains with error status */
async recheckAllErrors() {
	const errorEntries = [...this.results.values()].filter((r) => r.status === 'error');
	if (errorEntries.length === 0) return;

	const oldStatuses = new Map<string, DomainResult['previousStatus']>(errorEntries.map((r) => [r.domain, r.status as DomainResult['previousStatus']]));
	const errorDomains = errorEntries.map((r) => r.domain);

	const updated = new Map(this.results);
	for (const d of errorDomains) {
		const entry = updated.get(d);
		if (entry) updated.set(d, { ...entry, status: 'checking', error: undefined });
	}
	this.results = updated;

	try {
		const resolver = this.getResolver();
		const resultMap = new Map<string, ResolverResult>();
		await resolver.check(errorDomains, (r) => { resultMap.set(r.domain, r); });

		let resolved = 0;
		const next = new Map(this.results);
		for (const [domain, r] of resultMap) {
			const entry = next.get(domain);
			if (entry) {
				const oldStatus = oldStatuses.get(domain);
				const statusChanged = oldStatus && oldStatus !== r.status;
				if (r.status !== 'error') resolved++;
				next.set(domain, {
					...entry,
					records: r.records,
					status: r.status,
					error: r.error,
					checkedAt: Date.now(),
					previousStatus: statusChanged ? oldStatus : entry.previousStatus,
				});
			}
		}
		this.results = next;
		toasts.success(`Retried ${errorDomains.length} errors, ${resolved} resolved`);
	} catch {
		const next = new Map(this.results);
		for (const d of errorDomains) {
			const entry = next.get(d);
			if (entry && entry.status === 'checking') {
				next.set(d, { ...entry, status: 'error', error: 'retry failed' });
			}
		}
		this.results = next;
	}
	this.persist();
}
```

- [ ] **Step 8: Rewrite `openWhois()` to use resolver**

Replace the `openWhois()` method (lines 917-932):

```typescript
/** Open whois/RDAP detail panel for a domain */
async openWhois(domain: string) {
	this.whoisPanel = { domain, loading: true, data: null, error: null };
	try {
		const resolver = this.getResolver();
		const data = await resolver.lookup(domain);
		if (data) {
			this.whoisPanel = { domain, loading: false, data, error: null };
		} else {
			this.whoisPanel = { domain, loading: false, data: null, error: 'Lookup returned no data' };
		}
	} catch (err) {
		this.whoisPanel = {
			domain,
			loading: false,
			data: null,
			error: err instanceof Error ? err.message : 'Lookup failed',
		};
	}
}
```

- [ ] **Step 9: Rewrite `runMonitorCheck()` to use resolver**

Replace the `runMonitorCheck()` method (lines 1032-1066):

```typescript
/** Run a check on all monitored domains */
async runMonitorCheck() {
	if (this.monitorEntries.length === 0) return;
	const domains = this.monitorEntries.map((e) => e.domain);
	try {
		const resolver = this.getResolver();
		const resultMap = new Map<string, ResolverResult>();
		await resolver.check(domains, (r) => { resultMap.set(r.domain, r); });

		// In browser-doh mode, auto-verify likely-available monitor entries via RDAP
		if (resolver.mode === 'browser-doh') {
			for (const [domain, r] of resultMap) {
				if (r.status === 'likely-available') {
					const verified = await resolver.verify(domain);
					resultMap.set(domain, verified);
				}
			}
		}

		let changed = 0;
		const next = [...this.monitorEntries];
		for (const [domain, r] of resultMap) {
			const idx = next.findIndex((e) => e.domain === domain);
			if (idx < 0) continue;
			const entry = next[idx];
			const newStatus = r.status;
			if (entry.status !== newStatus) changed++;
			next[idx] = {
				...entry,
				status: newStatus,
				lastChecked: Date.now(),
				history: [...entry.history, { status: newStatus, checkedAt: Date.now() }].slice(-20),
			};
		}
		this.monitorEntries = next;
		this.persist();
		if (changed > 0) {
			toasts.success(`Monitor: ${changed} domain${changed > 1 ? 's' : ''} changed status`);
		}
	} catch {
		// Silently fail — will retry next interval
	}
}
```

- [ ] **Step 10: Rewrite `fetchPricing()` for client-side direct fetch**

Replace the `fetchPricing()` method (lines 599-623):

```typescript
/** Fetch TLD pricing + registrar TLD support */
async fetchPricing() {
	try {
		// Try local API first if in that mode
		if (_resolver?.mode === 'local-api') {
			const res = await fetch('/api/pricing');
			const data = await res.json() as {
				pricing: Record<string, TldPricing>;
				registrars: Record<string, string[]>;
			};
			if (data.pricing) {
				const map = new Map<string, TldPricing>();
				for (const [tld, p] of Object.entries(data.pricing)) map.set(tld, p);
				this.pricing = map;
			}
			if (data.registrars) {
				const rmap = new Map<RegistrarId, Set<string>>();
				for (const [rid, tlds] of Object.entries(data.registrars)) rmap.set(rid as RegistrarId, new Set(tlds));
				this.registrarTlds = rmap;
			}
			return;
		}

		// Direct Porkbun API call (public, CORS-enabled)
		const res = await fetch('https://api.porkbun.com/api/json/v3/domain/pricing', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({}),
		});
		const data = await res.json() as { status: string; pricing?: Record<string, { registration?: string; renewal?: string }> };
		if (data.status === 'SUCCESS' && data.pricing) {
			const map = new Map<string, TldPricing>();
			for (const [tld, prices] of Object.entries(data.pricing)) {
				map.set(tld, { registration: prices.registration || '0', renewal: prices.renewal || '0' });
			}
			this.pricing = map;
			// Porkbun TLDs derived from pricing response; other registrar lists
			// are currently only in api-server.ts — follow-up task to extract to shared module
		}
	} catch {
		// Pricing is optional — silently fail
	}
}
```

- [ ] **Step 11: Add `verifyDomain()` method for UI verify button**

Add to AppState class:

```typescript
/** Verify a likely-available domain via RDAP (upgrades or downgrades status) */
async verifyDomain(domain: string) {
	const existing = this.results.get(domain);
	if (!existing || existing.status !== 'likely-available') return;

	const updated = new Map(this.results);
	updated.set(domain, { ...existing, status: 'checking' });
	this.results = updated;

	try {
		const resolver = this.getResolver();
		const result = await resolver.verify(domain);
		const next = new Map(this.results);
		const entry = next.get(domain);
		if (entry) {
			next.set(domain, {
				...entry,
				status: result.status,
				records: result.records,
				error: result.error,
				method: result.method,
				checkedAt: Date.now(),
				previousStatus: 'likely-available',
			});
			this.results = next;
		}
	} catch {
		const next = new Map(this.results);
		const entry = next.get(domain);
		if (entry) {
			next.set(domain, { ...entry, status: 'likely-available', error: 'verification failed' });
			this.results = next;
		}
	}
	this.persist();
}
```

- [ ] **Step 12: Update `availableCount` to include likely-available**

Add a new getter alongside `availableCount`:

```typescript
/** Count of likely-available results (unfiltered) */
get likelyAvailableCount(): number {
	let count = 0;
	for (const r of this.results.values()) {
		if (r.status === 'likely-available') count++;
	}
	return count;
}
```

- [ ] **Step 13: Update `filteredResults` status filter and sort order**

In the `filteredResults` getter, update the status filter block (lines 222-228):

```typescript
// Status filter
if (this.filters.status === 'available') {
	items = items.filter((r) => r.status === 'available');
} else if (this.filters.status === 'likely-available') {
	items = items.filter((r) => r.status === 'likely-available');
} else if (this.filters.status === 'taken') {
	items = items.filter((r) => r.status === 'taken');
} else if (this.filters.status === 'reserved') {
	items = items.filter((r) => r.status === 'reserved');
}
```

Update the status sort order map (line 290):

```typescript
const order: Record<string, number> = { available: 0, 'likely-available': 1, checking: 2, error: 3, reserved: 4, taken: 5 };
```

- [ ] **Step 14: Update `SCHEMA_VERSION` and migration**

Change `SCHEMA_VERSION` from 1 to 2 (line 35). Update `runMigrations()` — no actual data migration needed since the new status only appears on fresh searches:

```typescript
const SCHEMA_VERSION = 2;
```

- [ ] **Step 15: Update `exportAvailable()` to include likely-available**

```typescript
/** Export available domains as text */
exportAvailable(): string {
	return this.filteredResults
		.filter((r) => r.status === 'available' || r.status === 'likely-available')
		.map((r) => r.domain)
		.join('\n');
}
```

- [ ] **Step 16: Run typecheck**

Run: `cd /data/data/com.termux/files/home/git/digr && bun run check`

Expected: Should pass or show only component-level issues (fixed in next chunk).

- [ ] **Step 17: Commit**

```bash
git add src/lib/state/app.svelte.ts
git commit -m "feat: wire AppState to resolver abstraction, replace all API fetch calls"
```

## Chunk 3: UI Updates

### Task 8: Update DomainCard for likely-available status

**Files:**
- Modify: `src/lib/components/DomainCard.svelte`

- [ ] **Step 1: Add likely-available color and icon**

In DomainCard.svelte, update `statusColors` and `statusIcons` (lines 37-51):

```typescript
const statusColors: Record<string, string> = {
	available: 'var(--available)',
	'likely-available': 'var(--warning)',
	taken: 'var(--taken)',
	reserved: 'var(--warning)',
	checking: 'var(--accent)',
	error: 'var(--warning)',
};

const statusIcons: Record<string, string> = {
	available: '\u2713',
	'likely-available': '?',
	taken: '\u2717',
	reserved: '\u229B',
	checking: '\u2022',
	error: '!',
};
```

- [ ] **Step 2: Add verify button and registrar menu for likely-available**

Update the registrar menu conditional (line 97-99):

```svelte
{#if result.status === 'available' || result.status === 'likely-available'}
	<RegistrarMenu domain={result.domain} />
{/if}
```

Update the actions section (lines 122-146). Add a verify button before the status badge:

```svelte
<!-- Actions -->
<div class="flex items-center gap-1 shrink-0">
	{#if result.status === 'likely-available'}
		<button
			onclick={() => app.verifyDomain(result.domain)}
			class="inline-flex items-center justify-center px-1.5 h-6 rounded border-0 cursor-pointer text-xs"
			style="background: var(--accent-muted); color: var(--accent);"
			title="Verify availability via RDAP"
			aria-label="Verify domain availability"
		>verify</button>
	{/if}
	{#if result.status === 'taken' || result.status === 'reserved' || result.status === 'likely-available'}
		<button
			onclick={() => app.openWhois(result.domain)}
			class="inline-flex items-center justify-center w-6 h-6 rounded border-0 cursor-pointer"
			style="background: transparent; color: var(--text-muted); font-size: 0.65rem;"
			title="Whois/RDAP lookup"
			aria-label="View registration details"
		>WH</button>
	{/if}
	<button
		onclick={() => app.isMonitored(result.domain) ? app.removeFromMonitor(result.domain) : app.addToMonitor(result.domain)}
		class="inline-flex items-center justify-center w-6 h-6 rounded border-0 cursor-pointer"
		style="background: transparent; color: {isMonitored ? 'var(--accent)' : 'var(--text-muted)'}; font-size: 0.7rem;"
		title={isMonitored ? 'Stop monitoring' : 'Monitor domain'}
		aria-label={isMonitored ? 'Stop monitoring' : 'Monitor domain'}
	>&#x1F441;</button>
	<SaveBookmarkButton {result} />
	<span
		class="text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
		style="background: color-mix(in srgb, {statusColors[result.status]} 15%, transparent); color: {statusColors[result.status]};"
	>
		{result.status === 'likely-available' ? 'likely' : result.status}
	</span>
</div>
```

- [ ] **Step 3: Update border color for likely-available**

Update the container border style (line 58):

```svelte
style="background: var(--bg-secondary); border: 1px solid {isSelected ? 'var(--accent)' : result.status === 'available' ? 'color-mix(in srgb, var(--available) 30%, var(--border))' : result.status === 'likely-available' ? 'color-mix(in srgb, var(--warning) 20%, var(--border))' : 'var(--border)'};"
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/DomainCard.svelte
git commit -m "feat: add likely-available status UI with verify button"
```

### Task 9: Update Header with resolver mode badge

**Files:**
- Modify: `src/lib/components/Header.svelte`

- [ ] **Step 1: Import MODE_LABELS and add mode badge**

Update Header.svelte imports:

```typescript
import { app } from '$lib/state/app.svelte';
import { MODE_LABELS } from '$lib/resolvers';
```

Add the mode badge inside the right-side div, before the results count (after line 22):

```svelte
<div class="flex items-center gap-2">
	<!-- Resolver mode badge -->
	{#if app.resolverReady}
		<span
			class="text-xs px-2 py-0.5 rounded-full"
			style="background: var(--bg-tertiary); color: var(--text-muted); border: 1px solid var(--border);"
			title="DNS resolver mode"
		>{MODE_LABELS[app.resolverMode]}</span>
	{/if}

	{#if app.results.size > 0}
```

Also update the available count to include likely-available:

```svelte
<span class="text-xs tabular-nums" style="color: var(--text-muted);">
	{app.availableCount + app.likelyAvailableCount} avail / {app.results.size} checked
</span>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/Header.svelte
git commit -m "feat: add resolver mode badge to header"
```

### Task 10: Update FilterSidebar for likely-available filter

**Files:**
- Modify: `src/lib/components/FilterSidebar.svelte`

- [ ] **Step 1: Add likely-available to status filter options**

Update the status filter `#each` block (lines 43-57):

```svelte
{#each [
	{ value: 'all', label: 'All', count: app.results.size },
	{ value: 'available', label: 'Available', count: app.availableCount },
	...(app.likelyAvailableCount > 0 ? [{ value: 'likely-available', label: 'Likely avail.', count: app.likelyAvailableCount }] : []),
	{ value: 'taken', label: 'Taken', count: app.takenCount },
	...(app.reservedCount > 0 ? [{ value: 'reserved', label: 'Reserved', count: app.reservedCount }] : []),
] as opt}
	<button
		onclick={() => app.setStatusFilter(opt.value as 'all' | 'available' | 'likely-available' | 'taken' | 'reserved')}
		class="flex items-center justify-between w-full px-2 py-1 rounded text-xs cursor-pointer border-0 transition-colors"
		style="background: {app.filters.status === opt.value ? 'var(--accent-muted)' : 'transparent'}; color: {app.filters.status === opt.value ? 'var(--accent)' : 'var(--text-secondary)'};"
	>
		<span>{opt.label}</span>
		<span class="tabular-nums" style="color: var(--text-muted);">{opt.count}</span>
	</button>
{/each}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/FilterSidebar.svelte
git commit -m "feat: add likely-available filter option to sidebar"
```

### Task 11: Update WhoisPanel for RDAP source

**Files:**
- Modify: `src/lib/components/WhoisPanel.svelte`

- [ ] **Step 1: Update the raw toggle label and add source indicator**

In WhoisPanel.svelte, update the raw toggle section (lines 113-126):

Replace:
```svelte
{showRaw ? 'Hide' : 'Show'} raw whois
```

With:
```svelte
{showRaw ? 'Hide' : 'Show'} raw {data.source === 'rdap' ? 'RDAP' : 'whois'}
```

Update the subheader (line 30):

Replace:
```svelte
<span class="text-xs" style="color: var(--text-muted);">Whois details</span>
```

With:
```svelte
<span class="text-xs" style="color: var(--text-muted);">{app.whoisPanel.data?.source === 'rdap' ? 'RDAP' : 'Whois'} details</span>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/WhoisPanel.svelte
git commit -m "feat: show RDAP/whois source indicator in panel"
```

### Task 12: Update DomainTable for likely-available

**Files:**
- Modify: `src/lib/components/DomainTable.svelte:53-59` (statusColors)
- Modify: `src/lib/components/DomainTable.svelte:127-143` (status-conditional actions)

- [ ] **Step 1: Add likely-available to statusColors (lines 53-59)**

```typescript
const statusColors: Record<string, string> = {
	available: 'var(--available)',
	'likely-available': 'var(--warning)',
	taken: 'var(--taken)',
	reserved: 'var(--warning)',
	checking: 'var(--accent)',
	error: 'var(--warning)',
};
```

- [ ] **Step 2: Update status-conditional actions (lines 127-143)**

Replace the RegistrarMenu/WH/retry conditional block:

```svelte
{#if result.status === 'available' || result.status === 'likely-available'}
	<RegistrarMenu domain={result.domain} />
{/if}
{#if result.status === 'likely-available'}
	<button
		onclick={() => app.verifyDomain(result.domain)}
		class="text-xs px-1 py-0 rounded border-0 cursor-pointer shrink-0"
		style="background: var(--accent-muted); color: var(--accent); font-size: 0.65rem;"
		title="Verify availability"
	>verify</button>
{/if}
{#if result.status === 'taken' || result.status === 'reserved' || result.status === 'likely-available'}
	<button
		onclick={() => app.openWhois(result.domain)}
		class="text-xs px-1 py-0 rounded border-0 cursor-pointer shrink-0"
		style="background: transparent; color: var(--text-muted); font-size: 0.6rem;"
		title="Whois/RDAP lookup"
	>WH</button>
{/if}
{#if result.status === 'error'}
	<button
		onclick={() => app.recheckDomain(result.domain)}
		class="text-xs px-1.5 py-0 rounded border-0 cursor-pointer shrink-0"
		style="background: var(--accent-muted); color: var(--accent); font-size: 0.65rem;"
		title={result.error || 'retry'}
	>retry</button>
{/if}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/DomainTable.svelte
git commit -m "feat: add likely-available status to table view with verify button"
```

### Task 13: Update MonitorPanel, ResultToolbar, SaveBookmarkButton

**Files:**
- Modify: `src/lib/components/MonitorPanel.svelte:11-17` (statusColors)
- Modify: `src/lib/components/ResultToolbar.svelte:77` (copy avail disabled check)
- Modify: `src/lib/components/SaveBookmarkButton.svelte:34,42` (status cast)

- [ ] **Step 1: Add likely-available to MonitorPanel statusColors (lines 11-17)**

```typescript
const statusColors: Record<string, string> = {
	available: 'var(--available)',
	'likely-available': 'var(--warning)',
	taken: 'var(--taken)',
	reserved: 'var(--warning)',
	checking: 'var(--accent)',
	error: 'var(--warning)',
};
```

- [ ] **Step 2: Update ResultToolbar copy-avail disabled check (line 77)**

Replace:
```svelte
disabled={app.availableCount === 0}
```

With:
```svelte
disabled={app.availableCount === 0 && app.likelyAvailableCount === 0}
```

- [ ] **Step 3: Fix SaveBookmarkButton status cast (lines 34, 42)**

Replace both `as any` casts with proper DomainStatus handling. Line 34:
```typescript
app.saveDomain(result.domain, listId, result.status === 'checking' ? 'available' : result.status);
```

Line 42:
```typescript
app.saveDomain(result.domain, list.id, result.status === 'checking' ? 'available' : result.status);
```

The `as any` cast is no longer needed since `DomainStatus` now includes `likely-available` in `SavedDomain.status`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/MonitorPanel.svelte src/lib/components/ResultToolbar.svelte src/lib/components/SaveBookmarkButton.svelte
git commit -m "feat: add likely-available support to monitor, toolbar, and bookmark components"
```

### Task 14: Final typecheck and integration test

- [ ] **Step 1: Run full typecheck**

Run: `cd /data/data/com.termux/files/home/git/digr && bun run check`

Expected: PASS — no type errors.

- [ ] **Step 2: Build the static SPA**

Run: `cd /data/data/com.termux/files/home/git/digr && bun run build`

Expected: Build succeeds.

- [ ] **Step 3: Start dev server and test browser mode**

Run: `cd /data/data/com.termux/files/home/git/digr && bun run dev &`

Verify:
- Mode badge shows "Browser DNS" (API server not running)
- Search produces results with "likely" status badges
- Verify button on likely-available cards triggers RDAP check
- Whois/RDAP panel opens for domains
- Filters include "Likely avail." option
- Status sort puts likely-available between available and checking

- [ ] **Step 4: Test API mode**

Start API server: `cd /data/data/com.termux/files/home/git/digr && bun run api &`

Reload the app. Verify:
- Mode badge switches to "Local API"
- Search produces "available"/"taken" (not "likely-available")
- All existing functionality works as before

- [ ] **Step 5: Commit any remaining fixes**

```bash
git add -A
git commit -m "fix: resolve integration issues from resolver migration"
```

## Chunk 4: Deferred / Follow-up Items

The following items from the spec are intentionally deferred to keep the core migration focused:

- **Settings panel UI** — The spec requires a settings panel with resolver mode dropdown and Worker URL field. The `switchResolver()` and `clearResolverOverride()` methods are in place (Task 7). The UI for settings can be added as a follow-up task.
- **Browser offline detection** — The spec calls for `navigator.onLine` check and offline banner. Can be added as a follow-up without affecting the resolver architecture.
- **Worker rate-limit fallback** — The spec says auto-fallback from Worker to browser-doh when Worker returns 429. Can be added to `WorkerResolver.check()` as a follow-up.
- **`DomainStatus` includes `checking`** — The spec defines `DomainStatus` without `checking`, but the existing codebase uses `checking` as a transient UI state in `DomainResult.status`. Including it in the shared type is an intentional deviation for backward compatibility.
- **Registrar TLD data in non-API modes** — The `fetchPricing()` method falls back to direct Porkbun API, which provides pricing but not per-registrar TLD support. The curated registrar TLD lists (Spaceship, Namecheap, Cloudflare) live in `api-server.ts`. A follow-up task should extract these to a shared module importable by both API server and client.

### Task 15: Create Cloudflare Worker

**Files:**
- Create: `workers/digr-worker/src/index.ts`
- Create: `workers/digr-worker/wrangler.toml`
- Create: `workers/digr-worker/package.json`

> This task is deferred until the core client-side migration is working. The Worker is the middle tier — it can be added later without changing the app code (just needs the Worker URL configured).

- [ ] **Step 1: Create wrangler config**
- [ ] **Step 2: Write Worker handler (DoH + RDAP server-side)**
- [ ] **Step 3: Add /health and /check endpoints**
- [ ] **Step 4: Add /lookup endpoint for RDAP detail**
- [ ] **Step 5: Deploy and test**
- [ ] **Step 6: Commit**

### Task 16: Update docs

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/FEATURES.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Document tri-mode resolver in architecture docs**
- [ ] **Step 2: Document likely-available status in features**
- [ ] **Step 3: Update CLAUDE.md with new resolver commands/patterns**
- [ ] **Step 4: Commit**

```bash
git add docs/ CLAUDE.md
git commit -m "docs: document tri-mode resolver and client-side DNS"
```
