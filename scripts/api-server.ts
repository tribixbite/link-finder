#!/usr/bin/env bun
/**
 * digr API server — runs dig + whois lookups on Termux.
 * Two-phase availability check:
 *   1. Fast: `dig` checks DNS status code (NXDOMAIN vs NOERROR)
 *   2. Verify: `whois` confirms availability for NXDOMAIN domains
 *
 * Usage: bun scripts/api-server.ts
 * Listens on port 3001 (proxied by Vite dev server at /api)
 */

const PORT = 3001;
const MAX_CONCURRENT_DIG = 12;
const MAX_CONCURRENT_WHOIS = 4; // whois servers rate-limit aggressively
const DIG_TIMEOUT_MS = 5000;
const WHOIS_TIMEOUT_MS = 8000;
const MAX_DOMAINS_PER_REQUEST = 500;
const VALID_DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z]{2,})+$/i;

interface CheckRequest {
	domains: string[];
}

interface DomainCheckResult {
	domain: string;
	records: string[];
	status: 'available' | 'taken' | 'reserved' | 'error';
	error?: string;
	/** How the status was determined */
	method?: 'dig' | 'whois';
}

/** Patterns in whois output indicating the domain is NOT registered */
const WHOIS_AVAILABLE_PATTERNS = [
	/no match/i,
	/not found/i,
	/no data found/i,
	/no entries found/i,
	/status:\s*free/i,
	/is available/i,
	/domain not found/i,
	/no object found/i,
	/nothing found/i,
	/^%% no matching objects/im,
];

/** Patterns indicating the domain is reserved by the registry */
const WHOIS_RESERVED_PATTERNS = [
	/reserved domain/i,
	/status:\s*reserved/i,
	/serverhold/i,
];

/** Patterns indicating the domain is registered */
const WHOIS_REGISTERED_PATTERNS = [
	/registrar:/i,
	/creation date:/i,
	/registry domain id:/i,
	/registered on:/i,
	/created:/i,
];

/**
 * Phase 1: Fast dig check — returns DNS status code + records.
 * NXDOMAIN = domain doesn't exist in DNS (needs whois confirmation)
 * NOERROR + records = definitely taken
 * NOERROR + no records = registered but no A records = taken
 */
async function digCheck(domain: string): Promise<{ nxdomain: boolean; records: string[] }> {
	try {
		const proc = Bun.spawn(
			['dig', '+noall', '+comments', '+answer', '+time=3', '+tries=1', domain],
			{ stdout: 'pipe', stderr: 'pipe' }
		);

		const timeout = new Promise<null>((resolve) =>
			setTimeout(() => resolve(null), DIG_TIMEOUT_MS)
		);
		const result = await Promise.race([proc.exited, timeout]);

		if (result === null) {
			proc.kill();
			return { nxdomain: false, records: [] };
		}

		const stdout = await new Response(proc.stdout).text();
		const lines = stdout.trim().split('\n').filter(Boolean);

		// Check for NXDOMAIN in the comments/header
		const nxdomain = lines.some((l) => /status:\s*NXDOMAIN/i.test(l));

		// Extract answer records (lines that don't start with ;)
		const records = lines.filter((l) => !l.startsWith(';') && l.includes('\t'));

		return { nxdomain, records: records.length > 0 ? records.map((r) => r.split('\t').pop()?.trim() || r) : [] };
	} catch {
		return { nxdomain: false, records: [] };
	}
}

/**
 * Phase 2: Whois verification — confirms whether an NXDOMAIN domain is
 * actually available, reserved, or registered-but-no-dns.
 */
async function whoisCheck(domain: string): Promise<'available' | 'taken' | 'reserved' | 'error'> {
	try {
		const proc = Bun.spawn(['whois', domain], {
			stdout: 'pipe',
			stderr: 'pipe',
		});

		const timeout = new Promise<null>((resolve) =>
			setTimeout(() => resolve(null), WHOIS_TIMEOUT_MS)
		);
		const result = await Promise.race([proc.exited, timeout]);

		if (result === null) {
			proc.kill();
			return 'error';
		}

		const stdout = await new Response(proc.stdout).text();

		// Check reserved first (more specific)
		for (const pattern of WHOIS_RESERVED_PATTERNS) {
			if (pattern.test(stdout)) return 'reserved';
		}

		// Check if registered
		for (const pattern of WHOIS_REGISTERED_PATTERNS) {
			if (pattern.test(stdout)) return 'taken';
		}

		// Check if available
		for (const pattern of WHOIS_AVAILABLE_PATTERNS) {
			if (pattern.test(stdout)) return 'available';
		}

		// If whois returned something but we can't parse it, assume taken
		// (better to show false-taken than false-available)
		return stdout.trim().length > 50 ? 'taken' : 'error';
	} catch {
		return 'error';
	}
}

/** Full domain check: dig + whois verification for NXDOMAIN results */
async function checkDomain(domain: string): Promise<DomainCheckResult> {
	try {
		const dig = await digCheck(domain);

		// If dig found records, domain is definitely taken
		if (dig.records.length > 0) {
			return { domain, records: dig.records, status: 'taken', method: 'dig' };
		}

		// If NOT NXDOMAIN (NOERROR with no records), domain is registered but has no A records
		if (!dig.nxdomain) {
			return { domain, records: [], status: 'taken', method: 'dig' };
		}

		// NXDOMAIN — domain doesn't exist in DNS, verify with whois
		const whois = await whoisCheck(domain);
		if (whois === 'reserved') {
			return { domain, records: [], status: 'reserved', method: 'whois' };
		}
		if (whois === 'taken') {
			return { domain, records: [], status: 'taken', method: 'whois' };
		}
		if (whois === 'available') {
			return { domain, records: [], status: 'available', method: 'whois' };
		}

		// Whois errored — report as available with caveat (NXDOMAIN is strong signal)
		return { domain, records: [], status: 'available', method: 'dig', error: 'whois timeout' };
	} catch (err) {
		return {
			domain,
			records: [],
			status: 'error',
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

/** Process domains with concurrency limit */
async function runConcurrent<T>(
	items: T[],
	concurrency: number,
	fn: (item: T) => Promise<void>,
): Promise<void> {
	const queue = [...items];
	const active = new Set<Promise<void>>();

	while (queue.length > 0 || active.size > 0) {
		while (queue.length > 0 && active.size < concurrency) {
			const item = queue.shift()!;
			const task = fn(item).finally(() => active.delete(task));
			active.add(task);
		}
		if (active.size > 0) {
			await Promise.race(active);
		}
	}
}

/** Batch check — returns all at once */
async function checkBatch(domains: string[]): Promise<DomainCheckResult[]> {
	const results: DomainCheckResult[] = [];
	await runConcurrent(domains, MAX_CONCURRENT_DIG, async (domain) => {
		results.push(await checkDomain(domain));
	});
	return results;
}

/** SSE endpoint: streams results as they complete */
async function handleStream(domains: string[]): Promise<Response> {
	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		async start(controller) {
			let done = 0;

			const sendEvent = (data: object) => {
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
			};

			sendEvent({ type: 'start', total: domains.length });

			await runConcurrent(domains, MAX_CONCURRENT_DIG, async (domain) => {
				const result = await checkDomain(domain);
				done++;
				sendEvent({ type: 'result', ...result, progress: done });
			});

			sendEvent({ type: 'done', total: domains.length });
			controller.close();
		},
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			'Connection': 'keep-alive',
			'Access-Control-Allow-Origin': '*',
		},
	});
}

Bun.serve({
	port: PORT,
	async fetch(req) {
		const url = new URL(req.url);
		const corsHeaders = {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type',
		};

		if (req.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: corsHeaders });
		}

		if (url.pathname === '/api/health') {
			return Response.json({ ok: true, pid: process.pid }, { headers: corsHeaders });
		}

		if ((url.pathname === '/api/check' || url.pathname === '/api/stream') && req.method === 'POST') {
			const body = (await req.json()) as CheckRequest;
			if (!body.domains?.length) {
				return Response.json({ error: 'domains array required' }, { status: 400, headers: corsHeaders });
			}
			const domains = body.domains
				.filter((d): d is string => typeof d === 'string' && VALID_DOMAIN.test(d))
				.slice(0, MAX_DOMAINS_PER_REQUEST);
			if (domains.length === 0) {
				return Response.json({ error: 'no valid domains provided' }, { status: 400, headers: corsHeaders });
			}

			if (url.pathname === '/api/check') {
				const results = await checkBatch(domains);
				return Response.json({ results }, { headers: corsHeaders });
			}
			return handleStream(domains);
		}

		return Response.json({ error: 'not found' }, { status: 404, headers: corsHeaders });
	},
});

console.log(`digr API server running on http://localhost:${PORT}`);
console.log(`  POST /api/check   — batch domain check (dig + whois)`);
console.log(`  POST /api/stream  — SSE streaming check`);
console.log(`  GET  /api/health  — health check`);
