/// <reference lib="webworker" />
// @ts-nocheck
/**
 * findur.link Service Worker — cache-first for static assets, network-first for API.
 * Enables offline access to the app shell.
 */

const CACHE_VERSION = 'findur-v1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const API_CACHE = `${CACHE_VERSION}-api`;

/** Static assets to precache (app shell) */
const PRECACHE_URLS = [
	'/',
	'/favicon.svg',
	'/manifest.json',
	'/icons/icon-192.png',
	'/icons/icon-512.png',
];

/** Install: precache app shell */
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

/** Fetch: cache-first for static, network-first for API */
self.addEventListener('fetch', (event) => {
	const url = new URL(event.request.url);

	// Skip non-GET requests and SSE streams
	if (event.request.method !== 'GET') return;
	if (url.pathname === '/api/stream') return;

	// API requests: network-first with 5min cache fallback
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

	// Static assets: cache-first
	event.respondWith(
		caches.match(event.request).then((cached) => {
			if (cached) return cached;
			return fetch(event.request).then((response) => {
				// Cache successful responses for static assets
				if (response.ok && response.type === 'basic') {
					const clone = response.clone();
					caches.open(STATIC_CACHE).then((cache) => cache.put(event.request, clone));
				}
				return response;
			});
		})
	);
});
