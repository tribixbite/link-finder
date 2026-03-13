# digr

**Domain name search tool** — bulk DNS lookups with smart name mutations. Runs on Termux via Bun.

## Stack

- **SvelteKit** (adapter-static, SPA mode, SSR off)
- **Svelte 5** runes only ($state, $derived, $props, $effect)
- **Tailwind CSS v4** (CSS-first `@import "tailwindcss"`, no config file)
- **Bun** as runtime and package manager
- **Vite** via `scripts/vite-cli.ts` (Termux compatibility wrapper)

## Architecture

**Two-process setup:**
1. `bun run api` — Bun HTTP server on port 3001, runs `dig` commands
2. `bun run dev` — SvelteKit dev server on port 5173, proxies `/api` to 3001

**Data flow:**
1. User enters terms, selects TLDs and mutations
2. Client generates all domain combinations (mutations × TLDs)
3. Client streams candidates to API server via SSE (`POST /api/stream`)
4. API server runs `dig +short` with concurrency limit (12 parallel)
5. Results stream back via Server-Sent Events
6. Client displays in filterable card/table view

## Project Structure

```
scripts/
  vite-cli.ts         — Vite wrapper for Termux/Bun
  api-server.ts       — Bun HTTP server running dig lookups
src/
  lib/
    types.ts          — DomainCandidate, DomainResult, Filters, TLDs
    mutations.ts      — Domain name mutation engine
    state/
      app.svelte.ts   — Central AppState class (search, filter, UI state)
    components/
      Header.svelte, SearchInput.svelte, FilterSidebar.svelte,
      FilterPills.svelte, ResultToolbar.svelte,
      DomainCard.svelte, DomainTable.svelte
  routes/
    +layout.ts        — ssr=false, prerender=false
    +layout.svelte    — app shell
    +page.svelte      — main page
```

## Commands

```sh
bun install              # install dependencies
bun run api              # start API server (port 3001)
bun run dev              # start dev server (port 5173)
bun run build            # production build
bun run check            # typecheck
```

## Mutation Types

| Mutation | Example |
|----------|---------|
| original | torch |
| dropLastVowel | torchr, filtr |
| dropAllVowels | trch, fltr |
| addR | scopr, seekr |
| addLy | torchly |
| addIfy | torchify |
| addDb | torchdb |
| addHq | torchhq |
| plural | specs, torches |
| doubleLastLetter | digg, specc |
| domainHack | del.icio.us style |
