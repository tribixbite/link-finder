import type { Resolver, ResolverResult, OnResult } from './types';
import type { WhoisData, ResolverMode } from '../types';
import { getApiBaseUrl } from './index';

/** Resolver that uses the local Bun API server (dig + whois) */
export class ApiResolver implements Resolver {
	readonly mode: ResolverMode = 'local-api';

	async check(domains: string[], onResult: OnResult, signal?: AbortSignal): Promise<void> {
		const res = await fetch(`${getApiBaseUrl()}/stream`, {
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
			const res = await fetch(`${getApiBaseUrl()}/whois?domain=${encodeURIComponent(domain)}`);
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
