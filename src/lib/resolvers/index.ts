import type { Resolver } from './types';
import type { ResolverMode } from '../types';
import { ApiResolver } from './api-resolver';
import { BrowserResolver } from './browser-resolver';
import { WorkerResolver, DEFAULT_WORKER_URL } from './worker-resolver';

export type { Resolver, ResolverResult, OnResult } from './types';

/** localStorage keys */
const LS_MODE_OVERRIDE = 'findur-resolver-mode';
const LS_WORKER_URL = 'findur-worker-url';
const LS_API_PORT = 'findur-api-port';

/** Ports to probe for local API server (findurlink) */
const API_PROBE_PORTS = [3001, 3002, 3003, 3004, 3005, 3010, 3100, 4001, 8001];

/** Probe timeout for local API (ms) */
const API_PROBE_TIMEOUT = 1500;

/** Probe timeout for Worker (ms) */
const WORKER_PROBE_TIMEOUT = 3000;

/**
 * Probe a URL, returning true if it responds with 2xx within timeout.
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

/** Discovered local API base URL (set during detection) */
let _apiBaseUrl: string | null = null;

/** Get the local API base URL (localhost:PORT or same-origin /api) */
export function getApiBaseUrl(): string {
	return _apiBaseUrl ?? '/api';
}

/**
 * Probe localhost ports for a running findurlink server.
 * Checks last-known port first, then scans candidates.
 * Also probes same-origin /api for Vite dev proxy.
 */
async function probeLocalApi(): Promise<boolean> {
	// Try same-origin first (Vite dev proxy)
	if (await probe('/api/health', API_PROBE_TIMEOUT)) {
		_apiBaseUrl = '/api';
		return true;
	}

	// Try last-known port first for faster reconnect
	let lastPort: number | null = null;
	try { lastPort = parseInt(localStorage.getItem(LS_API_PORT) ?? '', 10) || null; } catch {}

	const ports = lastPort
		? [lastPort, ...API_PROBE_PORTS.filter(p => p !== lastPort)]
		: API_PROBE_PORTS;

	// Probe all ports in parallel — first to respond wins
	const result = await Promise.any(
		ports.map(async (port) => {
			const ok = await probe(`http://localhost:${port}/api/health`, API_PROBE_TIMEOUT);
			if (ok) return port;
			throw new Error('not found');
		})
	).catch(() => null);

	if (result) {
		_apiBaseUrl = `http://localhost:${result}/api`;
		try { localStorage.setItem(LS_API_PORT, String(result)); } catch {}
		return true;
	}

	return false;
}

/** Cached auto-detected mode — stable within a session to avoid bouncing */
let _autoDetectedMode: ResolverMode | null = null;

/**
 * Auto-detect the best available resolver mode.
 * Checks localStorage for a forced override first, then probes local API
 * and edge worker in parallel, falling back to browser DoH.
 * Result is cached for the session to prevent mode bouncing.
 */
export async function detectMode(): Promise<ResolverMode> {
	// Check for forced mode in localStorage
	try {
		const forced = localStorage.getItem(LS_MODE_OVERRIDE) as ResolverMode | null;
		if (forced && ['local-api', 'edge-worker', 'browser-doh'].includes(forced)) {
			// Still need to discover the API URL if forcing local-api
			if (forced === 'local-api') await probeLocalApi();
			return forced;
		}
	} catch { /* localStorage unavailable */ }

	// Return cached auto-detected mode if available (prevents bouncing)
	if (_autoDetectedMode) return _autoDetectedMode;

	// Probe local API and Worker in parallel
	const workerUrl = (() => {
		try { return localStorage.getItem(LS_WORKER_URL) || DEFAULT_WORKER_URL; }
		catch { return DEFAULT_WORKER_URL; }
	})();

	const [apiOk, workerOk] = await Promise.all([
		probeLocalApi(),
		probe(`${workerUrl}/health`, WORKER_PROBE_TIMEOUT),
	]);

	if (apiOk) _autoDetectedMode = 'local-api';
	else if (workerOk) _autoDetectedMode = 'edge-worker';
	else _autoDetectedMode = 'browser-doh';
	return _autoDetectedMode;
}

/** Clear the auto-detected mode cache (used when switching back to auto) */
export function clearAutoDetectedCache() {
	_autoDetectedMode = null;
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
