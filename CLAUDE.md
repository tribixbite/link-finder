# digr — Domain Name Search Tool

## Project Overview
SvelteKit 5 SPA with adapter-static for domain availability search. Generates name candidates from terms × mutations × TLDs, checks availability via a tri-mode resolver: local API (dig+whois), Cloudflare Worker edge proxy, or browser-native DNS-over-HTTPS + RDAP. Built for Termux on Android, but the deployed static site works without any backend.

## Tech Stack
- **Runtime**: Bun (dev server + API server)
- **Framework**: SvelteKit 2.16, Svelte 5 runes ($state, $derived, $props, $effect)
- **Styling**: Tailwind CSS v4 (CSS-first, `@import "tailwindcss"` — no config file)
- **Language**: TypeScript throughout
- **Platform**: Termux/Android with `postinstall.sh` for native module fixes

## Architecture
- **Tri-mode resolver**: Local API (dig+whois) → Edge Worker (Cloudflare DoH+RDAP) → Browser DoH (fallback)
- **Auto-detection**: Probes run in parallel on load; first success wins. User can force mode via Settings.
- **Two-process model** (Local API mode): SvelteKit dev (5173) + Bun API server (3001)
- **Central state**: `AppState` singleton in `src/lib/state/app.svelte.ts`
- **Module-level vars**: timers/AbortControllers/resolver outside class to avoid Svelte 5 proxy issues
- **Streaming results**: resolver.check() callback with 150ms client-side batched flush
- **13 mutation types** including compound pairs, domain hacks, custom `{term}` patterns
- **Production mode**: API server serves static files when `NODE_ENV=production`
- **Docker**: multi-stage Dockerfile with `dig` + `whois` in Alpine runtime
- **Edge Worker**: Cloudflare Worker at `workers/digr-worker/` (deploy from non-Termux machine)

## Commands
```bash
bun run dev        # SvelteKit dev server (port 5173)
bun run api        # API server (port 3001)
bun run build      # Build static SPA to build/
bun run check      # svelte-check (typecheck)
bun run preview    # Preview production build
```

## Key Files
- `src/lib/state/app.svelte.ts` — central reactive state (AppState class)
- `src/lib/mutations.ts` — candidate generation, domain hacks, compound
- `src/lib/types.ts` — all interfaces, DomainStatus, ResolverMode, MutationType union
- `src/lib/resolvers/` — tri-mode resolver module:
  - `types.ts` — Resolver interface, ResolverResult, DoH/RDAP types
  - `browser-resolver.ts` — DoH round-robin + RDAP verification
  - `api-resolver.ts` — SSE stream wrapper for local API
  - `worker-resolver.ts` — Cloudflare Worker client
  - `index.ts` — detectMode(), createResolver(), MODE_LABELS
- `scripts/api-server.ts` — Bun HTTP server with dig/whois, SSE, rate limiting
- `workers/digr-worker/` — Cloudflare Worker (DoH+RDAP edge proxy)
- `src/lib/components/` — Svelte 5 components (DomainCard, SearchInput, FilterSidebar, etc.)
- `docs/` — ARCHITECTURE.md, API.md, MUTATIONS.md, FEATURES.md, DEPLOY.md

## Code Conventions
- ES modules, destructured imports
- async/await (no Promise chains)
- const/let (no var)
- JSDoc for public APIs
- Svelte 5 runes only ($state, $derived, $effect — no stores)
- Module-level variables for non-reactive bookkeeping (timers, AbortControllers)
- `JSON.parse(JSON.stringify())` to unwrap Svelte 5 proxies before postMessage/localStorage

## Workflow
- Always run `bun run check` after code changes
- Always use bun/bunx, never npm/npx
- Dev server runs through `scripts/vite-cli.ts` via bun (bypasses lightningcss platform issues)
- Commit messages: conventional commits, sign with emdash + model version (no co-authored-by)

## localStorage Keys
All prefixed `findur-`. Schema version at `findur-schema-version` (current: 2). Max 2000 results persisted.

Resolver keys:
- `findur-resolver-mode` — forced resolver mode override (`local-api` | `edge-worker` | `browser-doh`)
- `findur-worker-url` — custom Cloudflare Worker URL (default: `https://digr-dns.tribixbite.workers.dev`)

## Environment Variables
| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | API server port |
| `CORS_ORIGIN` | `*` | Allowed CORS origin |
| `NODE_ENV` | — | Set to `production` for static serving |
