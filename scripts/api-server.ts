#!/usr/bin/env bun
/**
 * digr API server — runs dig lookups on Termux.
 * Accepts batches of domains, checks DNS records concurrently.
 *
 * Usage: bun scripts/api-server.ts
 * Listens on port 3001 (proxied by Vite dev server at /api)
 */

const PORT = 3001;
const MAX_CONCURRENT = 12;
const DIG_TIMEOUT_MS = 5000;
const MAX_DOMAINS_PER_REQUEST = 500;
const VALID_DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z]{2,})+$/i;

interface CheckRequest {
	domains: string[];
}

interface DomainCheckResult {
	domain: string;
	records: string[];
	status: 'available' | 'taken' | 'error';
	error?: string;
}

/** Run `dig +short` for a single domain and parse results */
async function checkDomain(domain: string): Promise<DomainCheckResult> {
	try {
		const proc = Bun.spawn(['dig', '+short', '+time=3', '+tries=1', domain], {
			stdout: 'pipe',
			stderr: 'pipe',
		});

		// Race against timeout
		const timeout = new Promise<null>((resolve) =>
			setTimeout(() => resolve(null), DIG_TIMEOUT_MS)
		);

		const result = await Promise.race([proc.exited, timeout]);

		if (result === null) {
			proc.kill();
			return { domain, records: [], status: 'error', error: 'timeout' };
		}

		const stdout = await new Response(proc.stdout).text();
		const records = stdout.trim().split('\n').filter(Boolean);

		return {
			domain,
			records,
			status: records.length === 0 ? 'available' : 'taken',
		};
	} catch (err) {
		return {
			domain,
			records: [],
			status: 'error',
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

/** Process domains in batches with concurrency limit */
async function checkBatch(domains: string[]): Promise<DomainCheckResult[]> {
	const results: DomainCheckResult[] = [];
	const queue = [...domains];
	const active = new Set<Promise<void>>();

	while (queue.length > 0 || active.size > 0) {
		while (queue.length > 0 && active.size < MAX_CONCURRENT) {
			const domain = queue.shift()!;
			const task = checkDomain(domain).then((result) => {
				results.push(result);
				active.delete(task);
			});
			active.add(task);
		}
		if (active.size > 0) {
			await Promise.race(active);
		}
	}

	return results;
}

/** SSE endpoint: streams results one by one as they complete */
async function handleStream(domains: string[]): Promise<Response> {
	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		async start(controller) {
			const queue = [...domains];
			const active = new Set<Promise<void>>();
			let done = 0;

			const sendEvent = (data: object) => {
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
			};

			// Send total count
			sendEvent({ type: 'start', total: domains.length });

			while (queue.length > 0 || active.size > 0) {
				while (queue.length > 0 && active.size < MAX_CONCURRENT) {
					const domain = queue.shift()!;
					const task = checkDomain(domain).then((result) => {
						done++;
						sendEvent({ type: 'result', ...result, progress: done });
						active.delete(task);
					});
					active.add(task);
				}
				if (active.size > 0) {
					await Promise.race(active);
				}
			}

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

const server = Bun.serve({
	port: PORT,
	async fetch(req) {
		const url = new URL(req.url);
		const corsHeaders = {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type',
		};

		// CORS preflight
		if (req.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: corsHeaders });
		}

		// Health check
		if (url.pathname === '/api/health') {
			return Response.json({ ok: true, pid: process.pid }, { headers: corsHeaders });
		}

		// Shared domain validation for check/stream endpoints
		if ((url.pathname === '/api/check' || url.pathname === '/api/stream') && req.method === 'POST') {
			const body = (await req.json()) as CheckRequest;
			if (!body.domains?.length) {
				return Response.json({ error: 'domains array required' }, { status: 400, headers: corsHeaders });
			}
			// Sanitize: filter to valid domain names, cap at limit
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
console.log(`  POST /api/check   — batch domain check`);
console.log(`  POST /api/stream  — SSE streaming check`);
console.log(`  GET  /api/health  — health check`);
