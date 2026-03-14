# digr Architecture

## Overview

digr is a domain availability search tool that generates name candidates from user-supplied terms, mutations, and TLDs, then checks availability via `dig` and `whois` subprocess calls. Built for Termux on Android.

## System Architecture

```
┌─────────────────────────────────────────────┐
│  SvelteKit SPA (port 5173)                  │
│  ┌─────────────┐  ┌──────────────────────┐  │
│  │ SearchInput  │  │ FilterSidebar        │  │
│  │ + mutations  │  │ + TLD/mutation chips │  │
│  └──────┬───────┘  └──────────┬───────────┘  │
│         │ candidates          │ filters       │
│  ┌──────▼─────────────────────▼───────────┐  │
│  │         AppState singleton             │  │
│  │  (Svelte 5 runes: $state, $derived)    │  │
│  │  results Map, filters, saved, pricing  │  │
│  └──────┬─────────────────────┬───────────┘  │
│         │ SSE /api/stream     │ persist()    │
│         │                     ▼              │
│  ┌──────▼───────┐   ┌─────────────┐         │
│  │ Result Cards │   │ localStorage│         │
│  │ or Table     │   │ (2000 max)  │         │
│  └──────────────┘   └─────────────┘         │
└──────────────┬──────────────────────────────┘
               │ fetch /api/*
               ▼
┌─────────────────────────────────────────────┐
│  Bun API Server (port 3001)                 │
│  ┌──────────────┐  ┌─────────────────────┐  │
│  │ POST /stream │  │ GET /pricing        │  │
│  │ POST /check  │  │ GET /health         │  │
│  └──────┬───────┘  └─────────────────────┘  │
│         │                                    │
│  ┌──────▼───────┐  ┌─────────────────────┐  │
│  │   dig DNS    │  │   whois verify      │  │
│  │ (12 conc.)   │  │   (4 conc.)         │  │
│  └──────────────┘  └─────────────────────┘  │
│  Request dedup · 15min cache · per-TLD rate │
└─────────────────────────────────────────────┘
```

## Two-Process Model

| Process | Port | Role |
|---------|------|------|
| SvelteKit dev | 5173 | Serves UI, proxies `/api` to 3001 |
| Bun API server | 3001 | Domain checks (dig+whois), pricing |

In production, the SvelteKit build outputs static files served by any web server, while the API server runs separately.

## Component Hierarchy

```
+page.svelte
├── Header.svelte
│   └── theme toggle, saved panel toggle
├── SearchInput.svelte
│   ├── terms textarea, TLD chips, mutation chips
│   ├── TLD presets (Cheap / Dev / ccTLDs)
│   └── Dig button, candidate count
├── ResultToolbar.svelte
│   └── sort, view toggle, status tabs, counters
├── FilterPills.svelte
│   └── active filter indicators with remove buttons
├── FilterSidebar.svelte
│   └── TLD filter chips, mutation filter chips, length range, registrar filter
├── DomainCard.svelte / DomainTable.svelte
│   ├── status icon, domain name, copy button
│   ├── RegistrarMenu.svelte (available domains)
│   ├── SaveBookmarkButton.svelte
│   └── meta: term, mutation label, length, price, age
├── SavedPanel.svelte
│   └── lists CRUD, saved domains, import/export
└── Toast.svelte
    └── bottom-right notification stack
```

## State Management

### AppState Singleton (`src/lib/state/app.svelte.ts`)

Central reactive store using Svelte 5 runes:

| Category | Fields | Persistence |
|----------|--------|-------------|
| Input | `termsInput`, `selectedTlds`, `selectedMutations` | localStorage |
| Results | `results` (Map), `searching`, `progress` | localStorage (max 2000) |
| Filters | `filters` (status, tlds, mutations, length, search, registrars) | localStorage |
| Pricing | `pricing` (Map), `registrarTlds` (Map) | session only |
| Saved | `lists`, `saved`, `savedViewOpen`, `savedFilterListId` | localStorage |
| View | `sort`, `viewMode`, `theme`, `sidebarOpen` | localStorage |

### Module-Level Variables

Timers and AbortControllers are kept outside the class to avoid Svelte 5's reactive proxy wrapping:

- `_abortController` — SSE cancellation
- `_pendingUpdates`, `_flushTimer` — 150ms batched result updates
- `_persistInputTimer` — debounced input persistence

### Toast Store (`src/lib/state/toasts.svelte.ts`)

Lightweight notification system: `toasts.success()`, `toasts.error()`, `toasts.info()`. Auto-dismiss (3s default, 5s for errors).

## Data Flow

### Search Flow

1. User enters terms, selects TLDs and mutations
2. `app.candidates` (derived) generates `DomainCandidate[]` via `generateCandidates()`
3. User clicks "Dig" → `app.search()`
4. All candidates set to `status: 'checking'` in results Map
5. POST `/api/stream` with domain list
6. Server runs `dig` (12 concurrent) then `whois` (4 concurrent) per NXDOMAIN domain
7. SSE events stream back; client batches updates every 150ms via `_flushUpdates()`
8. Final results persisted to localStorage

### Two-Phase Availability Check

```
Domain → dig DNS lookup
  ├── Records found → TAKEN (dig)
  ├── NOERROR + no records → TAKEN (dig)
  └── NXDOMAIN → whois verification
       ├── Available patterns → AVAILABLE (whois)
       ├── Registered patterns → TAKEN (whois)
       ├── Reserved patterns → RESERVED (whois)
       └── Error (3 retries) → AVAILABLE with caveat (dig)
```

## localStorage Schema

All keys prefixed with `digr-`. Schema version tracked at `digr-schema-version`.

| Key | Type | Content |
|-----|------|---------|
| `digr-termsInput` | string | Raw textarea value |
| `digr-selectedTlds` | string[] | Active TLD selections |
| `digr-selectedMutations` | string[] | Active mutation selections |
| `digr-results` | [string, DomainResult][] | Map entries (max 2000, pruned by recency) |
| `digr-filters` | object | All filter state (Sets serialized as arrays) |
| `digr-sort` | object | `{ field, dir }` |
| `digr-viewMode` | string | `'card'` or `'table'` |
| `digr-lists` | DomainList[] | Bookmark lists |
| `digr-saved` | SavedDomain[] | Saved domain entries |
| `digr-schema-version` | number | Migration version (current: 1) |
| `digr-theme` | string | `'dark'` or `'light'` |

## URL State Sharing

Search configuration is encoded into the URL for sharing:

```
?q=torch,light&tlds=.dev,.app&mut=original,compound&sort=status:asc&status=available
```

Encoding/decoding handled by `encodeSearchParams()` / `decodeSearchParams()` in `src/lib/utils.ts`. URL sync is debounced (300ms) and guarded by `_urlInitialized` to prevent race conditions on page load.

## Technology Stack

- **Runtime**: Bun (handles both dev server and API)
- **Framework**: SvelteKit 2.16 with adapter-static (SPA mode)
- **Reactivity**: Svelte 5 runes ($state, $derived, $props, $effect)
- **Styling**: Tailwind CSS v4 (CSS-first, no config file)
- **Language**: TypeScript throughout
- **Platform**: Termux on Android (with postinstall.sh for native module fixes)
