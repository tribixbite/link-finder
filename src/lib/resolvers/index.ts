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

/**
 * Probe a URL, returning true if it responds with 2xx within timeout.
 * @param url - URL to probe
 * @param timeoutMs - Abort after this many milliseconds
 */
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

/**
 * Auto-detect the best available resolver mode.
 * Checks localStorage for a forced override first, then probes local API
 * and edge worker in parallel, falling back to browser DoH.
 */
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

/**
 * Create a resolver instance for the given mode.
 * @param mode - Resolver mode to instantiate
 */
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
