/** Cloudflare Worker: findur.link DNS edge proxy */

interface Env {
	ENVIRONMENT: string;
}

/** CORS headers for browser access */
const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type',
};

/** DoH providers */
const DOH_PROVIDERS = [
	{
		name: 'google',
		url: (d: string) => `https://dns.google/resolve?name=${encodeURIComponent(d)}&type=A`,
		headers: {} as Record<string, string>,
	},
	{
		name: 'cloudflare',
		url: (d: string) => `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(d)}&type=A`,
		headers: { Accept: 'application/dns-json' },
	},
];

let _providerIdx = 0;

function nextProvider() {
	const p = DOH_PROVIDERS[_providerIdx % DOH_PROVIDERS.length];
	_providerIdx++;
	return p;
}

/** IANA RDAP bootstrap */
const IANA_BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json';
const RDAP_ORG_URL = 'https://rdap.org/domain/';

let _bootstrapCache: Map<string, string> | null = null;
let _bootstrapFetchedAt = 0;
const BOOTSTRAP_TTL_MS = 60 * 60 * 1000; // 1h (shorter in Worker since instances are ephemeral)

function extractTld(domain: string): string {
	const dot = domain.lastIndexOf('.');
	return dot >= 0 ? domain.slice(dot + 1) : domain;
}

async function loadBootstrap(): Promise<Map<string, string>> {
	if (_bootstrapCache && Date.now() - _bootstrapFetchedAt < BOOTSTRAP_TTL_MS) {
		return _bootstrapCache;
	}
	try {
		const res = await fetch(IANA_BOOTSTRAP_URL);
		const data = await res.json() as { services: Array<[string[], string[]]> };
		const map = new Map<string, string>();
		for (const [tlds, urls] of data.services) {
			const baseUrl = urls[0];
			for (const tld of tlds) {
				map.set(tld.toLowerCase(), baseUrl);
			}
		}
		_bootstrapCache = map;
		_bootstrapFetchedAt = Date.now();
		return map;
	} catch {
		return _bootstrapCache ?? new Map();
	}
}

async function getRdapUrl(domain: string): Promise<string> {
	const tld = extractTld(domain);
	const bootstrap = await loadBootstrap();
	const baseUrl = bootstrap.get(tld);
	if (baseUrl) {
		const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
		return `${base}domain/${domain}`;
	}
	return `${RDAP_ORG_URL}${domain}`;
}

interface DohResponse {
	Status: number;
	Answer?: Array<{ name: string; type: number; TTL: number; data: string }>;
	Authority?: Array<{ name: string; type: number; TTL: number; data: string }>;
}

interface CheckResult {
	domain: string;
	status: 'available' | 'likely-available' | 'taken' | 'reserved' | 'error';
	records: string[];
	error?: string;
	method: 'worker';
}

/** Check a single domain: DoH first, then RDAP to confirm NXDOMAIN */
async function checkDomain(domain: string): Promise<CheckResult> {
	const provider = nextProvider();
	try {
		// Step 1: DoH check
		const dohRes = await fetch(provider.url(domain), { headers: provider.headers });
		if (!dohRes.ok) {
			return { domain, status: 'error', records: [], error: `DoH HTTP ${dohRes.status}`, method: 'worker' };
		}
		const doh: DohResponse = await dohRes.json();

		// SERVFAIL
		if (doh.Status === 2) {
			return { domain, status: 'error', records: [], error: 'SERVFAIL', method: 'worker' };
		}

		// NOERROR = taken
		if (doh.Status === 0) {
			const records = (doh.Answer ?? [])
				.filter((a) => a.type === 1 || a.type === 28)
				.map((a) => a.data);
			return { domain, status: 'taken', records, method: 'worker' };
		}

		// NXDOMAIN = potentially available, verify with RDAP
		if (doh.Status === 3) {
			try {
				const rdapUrl = await getRdapUrl(domain);
				const rdapRes = await fetch(rdapUrl, { redirect: 'follow' });
				if (rdapRes.status === 404) {
					// Not in registry — confirmed available
					return { domain, status: 'available', records: [], method: 'worker' };
				}
				if (rdapRes.ok) {
					// RDAP found it — registered despite NXDOMAIN (parked/held/no DNS)
					return { domain, status: 'taken', records: [], method: 'worker' };
				}
				// RDAP returned non-404/non-OK (429, 500, etc.) — can't confirm
				return { domain, status: 'likely-available', records: [], error: `RDAP unverified (HTTP ${rdapRes.status})`, method: 'worker' };
			} catch {
				// RDAP network error — can't confirm
				return { domain, status: 'likely-available', records: [], error: 'RDAP unavailable', method: 'worker' };
			}
		}

		return { domain, status: 'error', records: [], error: `Unknown DNS status: ${doh.Status}`, method: 'worker' };
	} catch (err) {
		return {
			domain,
			status: 'error',
			records: [],
			error: err instanceof Error ? err.message : 'check failed',
			method: 'worker',
		};
	}
}

/** RDAP lookup for whois panel */
async function rdapLookup(domain: string): Promise<Response> {
	try {
		const url = await getRdapUrl(domain);
		const res = await fetch(url, { redirect: 'follow' });
		if (!res.ok) {
			return new Response(JSON.stringify({ error: `RDAP HTTP ${res.status}` }), {
				status: 404,
				headers: { ...CORS, 'Content-Type': 'application/json' },
			});
		}
		const raw = await res.text();
		const rdap = JSON.parse(raw);

		// Parse into WhoisData shape
		const parsed: Record<string, unknown> = {};

		// Registrar
		const registrarEntity = rdap.entities?.find((e: { roles?: string[] }) => e.roles?.includes('registrar'));
		if (registrarEntity?.vcardArray) {
			const vcard = registrarEntity.vcardArray[1] as Array<unknown[]>;
			const fn = vcard?.find((f: unknown[]) => f[0] === 'fn');
			if (fn && fn.length > 3) parsed.registrar = String(fn[3]);
		}
		if (!parsed.registrar && registrarEntity?.publicIds?.[0]) {
			parsed.registrar = `IANA ID: ${registrarEntity.publicIds[0].identifier}`;
		}

		// Events
		if (rdap.events) {
			for (const ev of rdap.events) {
				if (ev.eventAction === 'registration' && !parsed.created) parsed.created = ev.eventDate;
				if (ev.eventAction === 'expiration' && !parsed.expires) parsed.expires = ev.eventDate;
				if (ev.eventAction === 'last changed' && !parsed.updated) parsed.updated = ev.eventDate;
			}
		}

		// Nameservers
		if (rdap.nameservers) {
			parsed.nameservers = rdap.nameservers.map((ns: { ldhName: string }) => ns.ldhName.toLowerCase());
		}

		// Status
		if (rdap.status) {
			parsed.status = rdap.status;
		}

		const whoisData = {
			domain,
			raw,
			parsed,
			fetchedAt: Date.now(),
			source: 'rdap',
		};

		return new Response(JSON.stringify(whoisData), {
			headers: { ...CORS, 'Content-Type': 'application/json' },
		});
	} catch (err) {
		return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'RDAP lookup failed' }), {
			status: 500,
			headers: { ...CORS, 'Content-Type': 'application/json' },
		});
	}
}

/** Handle POST /check — stream results */
async function handleCheck(request: Request): Promise<Response> {
	const body = await request.json() as { domains?: string[] };
	const domains = body.domains;
	if (!Array.isArray(domains) || domains.length === 0) {
		return new Response(JSON.stringify({ error: 'domains array required' }), {
			status: 400,
			headers: { ...CORS, 'Content-Type': 'application/json' },
		});
	}

	// Cap at 500 domains per request
	const batch = domains.slice(0, 500);

	const { readable, writable } = new TransformStream();
	const writer = writable.getWriter();
	const encoder = new TextEncoder();

	// Process domains concurrently (max 20 in-flight)
	const MAX_CONCURRENT = 20;

	(async () => {
		const queue = [...batch];
		const active = new Set<Promise<void>>();

		while (queue.length > 0 || active.size > 0) {
			while (queue.length > 0 && active.size < MAX_CONCURRENT) {
				const domain = queue.shift()!;
				const task = (async () => {
					const result = await checkDomain(domain);
					await writer.write(encoder.encode(`data: ${JSON.stringify(result)}\n`));
				})().finally(() => active.delete(task));
				active.add(task);
			}
			if (active.size > 0) {
				await Promise.race(active);
			}
		}
		await writer.close();
	})();

	return new Response(readable, {
		headers: {
			...CORS,
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
		},
	});
}

export default {
	async fetch(request: Request, _env: Env): Promise<Response> {
		const url = new URL(request.url);

		// CORS preflight
		if (request.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: CORS });
		}

		// Health check
		if (url.pathname === '/health') {
			return new Response(JSON.stringify({ status: 'ok', mode: 'edge-worker' }), {
				headers: { ...CORS, 'Content-Type': 'application/json' },
			});
		}

		// Domain check (streaming)
		if (url.pathname === '/check' && request.method === 'POST') {
			return handleCheck(request);
		}

		// RDAP lookup
		if (url.pathname === '/lookup') {
			const domain = url.searchParams.get('domain');
			if (!domain) {
				return new Response(JSON.stringify({ error: 'domain param required' }), {
					status: 400,
					headers: { ...CORS, 'Content-Type': 'application/json' },
				});
			}
			return rdapLookup(domain);
		}

		return new Response('Not Found', { status: 404, headers: CORS });
	},
};
