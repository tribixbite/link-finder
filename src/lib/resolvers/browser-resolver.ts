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
