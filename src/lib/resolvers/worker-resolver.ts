import type { Resolver, ResolverResult, OnResult } from './types';
import type { WhoisData, ResolverMode } from '../types';

/** Default Cloudflare Worker URL */
export const DEFAULT_WORKER_URL = 'https://digr-dns.tribixbite.workers.dev';

/** localStorage key for Worker URL override */
const LS_WORKER_URL = 'findur-worker-url';

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
