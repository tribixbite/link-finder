/// <reference lib="webworker" />
// @ts-nocheck
/**
 * findur.link Service Worker — network-first for app code, cache-first for static assets.
 * Ensures deploys take effect immediately while enabling offline access.
 */

const CACHE_VERSION = 'findur-v2';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const API_CACHE = `${CACHE_VERSION}-api`;

/** Static assets to precache (app shell) */
const PRECACHE_URLS = [
	'/',
	'/favicon.svg',
	'/manifest.json',
];

/** Install: precache app shell, activate immediately */
self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS))
	);
	self.skipWaiting();
});

/** Activate: clean old caches */
self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys().then((keys) =>
			Promise.all(
				keys
					.filter((key) => key !== STATIC_CACHE && key !== API_CACHE)
					.map((key) => caches.delete(key))
			)
		)
	);
	self.clients.claim();
});

/** Assets that should use cache-first (rarely change) */
const CACHE_FIRST_PATTERNS = [
	/\/favicon\.svg$/,
	/\/manifest\.json$/,
	/\/icons\//,
	/\/og-image\./,
	/\/oembed\.json$/,
];

/** Fetch: network-first for app code, cache-first for static images/icons */
self.addEventListener('fetch', (event) => {
	const url = new URL(event.request.url);

	// Skip non-GET, SSE streams, and localhost API probes
	if (event.request.method !== 'GET') return;
	if (url.pathname === '/api/stream') return;
	if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return;

	// API requests: network-first with cache fallback
	if (url.pathname.startsWith('/api/')) {
		event.respondWith(
			fetch(event.request)
				.then((response) => {
					const clone = response.clone();
					caches.open(API_CACHE).then((cache) => cache.put(event.request, clone));
					return response;
				})
				.catch(() => caches.match(event.request))
		);
		return;
	}

	// Static images/icons: cache-first (rarely change)
	if (CACHE_FIRST_PATTERNS.some((p) => p.test(url.pathname))) {
		event.respondWith(
			caches.match(event.request).then((cached) => {
				if (cached) return cached;
				return fetch(event.request).then((response) => {
					if (response.ok && response.type === 'basic') {
						const clone = response.clone();
						caches.open(STATIC_CACHE).then((cache) => cache.put(event.request, clone));
					}
					return response;
				});
			})
		);
		return;
	}

	// App code (HTML, JS, CSS): network-first with cache fallback
	event.respondWith(
		fetch(event.request)
			.then((response) => {
				if (response.ok && response.type === 'basic') {
					const clone = response.clone();
					caches.open(STATIC_CACHE).then((cache) => cache.put(event.request, clone));
				}
				return response;
			})
			.catch(() => caches.match(event.request))
	);
});
