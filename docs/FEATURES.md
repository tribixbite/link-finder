# digr Features

## Search & Generation

### Multi-Term Input
Enter comma-separated terms in the search box. Each term generates candidates across all selected mutations and TLDs. Terms are cleaned (lowercase, alphanumeric only, min 2 chars).

**Files:** `SearchInput.svelte`, `app.svelte.ts:parseTerms()`

### 12 Mutation Types
Transform terms into creative domain names: original, drop vowels, suffixes (-r, -ly, -ify, -db, -hq), plural, double letter, domain hacks, and compound pairs. See `docs/MUTATIONS.md`.

**Files:** `mutations.ts`, `types.ts:MUTATION_INFO`

### TLD Selection
470+ TLDs available. Popular TLDs shown first, full list expandable. Quick-select via search filter.

**Files:** `SearchInput.svelte`, `types.ts:TLDS, POPULAR_TLDS`

### TLD Presets
One-click preset groups: **Cheap** (under ~$5/yr), **Dev** (developer-friendly), **ccTLDs** (branding-friendly country codes).

**Files:** `SearchInput.svelte`, `types.ts:TLD_PRESETS`

### SSE Streaming
Results stream in real-time via Server-Sent Events. Client batches UI updates every 150ms to avoid per-result reactive overhead.

**Files:** `app.svelte.ts:search()`, `api-server.ts:handleStream()`

## Filtering & Sorting

### Status Filter
Filter results by: All, Available, Taken, Reserved. Hide errors toggle.

**Files:** `ResultToolbar.svelte`, `app.svelte.ts:filteredResults`

### TLD Filter
Filter results to specific TLDs within the result set.

**Files:** `FilterSidebar.svelte`, `FilterPills.svelte`

### Mutation Filter
Filter results to specific mutation types.

**Files:** `FilterSidebar.svelte`, `FilterPills.svelte`

### Length Filter
Min/max character length for domain names (excluding TLD).

**Files:** `FilterSidebar.svelte`

### Text Search
Free-text search within results — matches domain, term, or mutated name.

**Files:** `FilterSidebar.svelte`

### Registrar Filter
Show only domains whose TLD is sold by all selected registrars (Namecheap, Porkbun, Cloudflare, Spaceship).

**Files:** `FilterSidebar.svelte`, `app.svelte.ts:filteredResults`

### Sorting (7 Fields)
Sort by: Domain, Name, TLD, Mutation, Status, Length, Price. Click to toggle asc/desc.

**Files:** `ResultToolbar.svelte` (card view), `DomainTable.svelte` (table view)

### Filter Pills
Active filters shown as removable pills above results.

**Files:** `FilterPills.svelte`

## Display

### Card View
Two-column responsive grid. Each card shows: status icon, domain name, copy button, registrar menu (available), bookmark button, meta row (term, mutation, length, price, age, status change).

**Files:** `DomainCard.svelte`

### Table View
Compact sortable table with columns: Status, Domain, TLD, Mutation, Length, Price.

**Files:** `DomainTable.svelte`

### Pricing Labels
Registration price from Porkbun shown per domain. Tooltip shows registration + renewal. Sorted by price supported.

**Files:** `DomainCard.svelte`, `DomainTable.svelte`, `app.svelte.ts:getPrice()`

### Status Change Badges
When a domain is rechecked and its status changes, a "was X" badge appears.

**Files:** `DomainCard.svelte`, `DomainTable.svelte`, `app.svelte.ts:previousStatus`

## Actions

### Copy Domain
Click copy icon on any domain card to copy to clipboard.

**Files:** `DomainCard.svelte`

### Copy Available Domains
Toolbar button copies all visible available domains as newline-separated text.

**Files:** `ResultToolbar.svelte`

### Registrar Links
Available domains show a dropdown menu with direct links to register at Namecheap, Porkbun, Cloudflare, or Spaceship.

**Files:** `RegistrarMenu.svelte`, `types.ts:REGISTRARS`

### Clear Results
Toolbar button to clear all results with confirmation dialog.

**Files:** `ResultToolbar.svelte`, `app.svelte.ts:clearResults()`

### Retry Errors
Individual retry button on error cards. Batch "Retry all errors" in toolbar.

**Files:** `DomainCard.svelte`, `ResultToolbar.svelte`, `app.svelte.ts:recheckDomain(), recheckAllErrors()`

### Recheck Stale
Toolbar button to recheck results older than 24 hours.

**Files:** `ResultToolbar.svelte`, `app.svelte.ts:recheckStale()`

## Bookmarks / Saved Domains

### Lists
Create, rename, delete bookmark lists with auto-assigned colors.

**Files:** `SavedPanel.svelte`, `app.svelte.ts` CRUD methods

### Save/Unsave
Star button on domain cards opens list selector. Domains can be in multiple lists.

**Files:** `SaveBookmarkButton.svelte`

### Import/Export
Export saved domains as JSON. Import from JSON with dedup and validation.

**Files:** `SavedPanel.svelte`, `app.svelte.ts:exportSaved(), importSaved()`

## Infrastructure

### Request Deduplication
Server coalesces concurrent checks for the same domain into a single Promise.

**Files:** `api-server.ts:_pendingChecks`

### SSE Client Disconnect
Server detects `req.signal.aborted` and stops processing remaining domains when client disconnects.

**Files:** `api-server.ts:handleStream(), runConcurrent()`

### Result Cache
Server caches successful results for 15 minutes. Periodic cleanup every 5 minutes.

**Files:** `api-server.ts:_resultCache`

### Schema Migration
localStorage versioned with `digr-schema-version`. `runMigrations()` stub for future schema changes.

**Files:** `app.svelte.ts:runMigrations()`

### Infinite Scroll
Results render in batches (60 initial, 80 per load). IntersectionObserver triggers loading with 200px margin.

**Files:** `+page.svelte`

### URL State Sharing
Search config encoded in URL: terms, TLDs, mutations, sort, status filter. Debounced 300ms sync with `replaceState()`.

**Files:** `+page.svelte`, `utils.ts:encodeSearchParams(), decodeSearchParams()`

## UI/UX

### Dark/Light Theme
Toggle in header. Auto-detects OS preference when no saved preference. CSS variables for all colors.

**Files:** `Header.svelte`, `app.svelte.ts:initTheme()`, `app.css`

### Toast Notifications
Unified notification system for copy, export, import, recheck actions. Auto-dismiss.

**Files:** `Toast.svelte`, `toasts.svelte.ts`

### Keyboard Navigation
- `j`/`k` — navigate between domain cards
- Skip-to-content link for screen readers

**Files:** `+page.svelte`, `app.css`

### Accessibility
- Domain cards: `role="article"`, `aria-label`, `tabindex="0"`
- Focus outlines on keyboard navigation
- `aria-live="polite"` on result count and toast container

**Files:** `DomainCard.svelte`, `ResultToolbar.svelte`, `Toast.svelte`, `app.css`, `+page.svelte`

### Mobile Responsive
- Sidebar collapses to overlay on mobile
- Card grid: 1 column mobile, 2 columns tablet+
- Touch-friendly sizing

## Phase 3 Features

### Search History
Clock icon next to the Dig button opens a dropdown of recent searches (up to 50). Each entry shows terms, TLD count, mutation count, result count, and relative time. Click to restore, × to delete. Deduped by terms+tlds+mutations fingerprint.

**Files:** `SearchHistory.svelte`, `app.svelte.ts:saveToHistory(), restoreFromHistory()`

### Custom Mutations
User-defined `{term}` patterns (e.g. `{term}hub`, `go{term}`). Shown as an inline editor in SearchInput when the "custom" mutation chip is selected. Patterns must contain `{term}` and produce valid domain characters.

**Files:** `CustomMutationEditor.svelte`, `mutations.ts:generateCandidates()`, `app.svelte.ts:customMutations`

### Whois Detail Panel
Slide-in panel from right showing parsed whois data for taken/reserved domains. Fields: registrar, creation/expiry/update dates, nameservers, status. Collapsible raw whois text block. Triggered by "WH" button on domain cards/table rows.

**Files:** `WhoisPanel.svelte`, `api-server.ts:/api/whois`, `app.svelte.ts:openWhois()`

### Bulk Actions
Checkbox selection on domain cards and table rows. Shift-click for range selection. Select-all checkbox in table header. Fixed bottom bar appears when selection is active with: count display, Save to list (dropdown), Copy to clipboard, Deselect all.

**Files:** `BulkActionBar.svelte`, `DomainCard.svelte`, `DomainTable.svelte`, `app.svelte.ts:selectedDomains`

### Domain Monitoring
Track domains for status changes over time. Eye icon on domain cards toggles monitoring. Slide-in panel from header shows tracked domains with current status, last checked time, and status history timeline. Configurable check interval (1h, 6h, 24h). Toast notification on status changes.

**Files:** `MonitorPanel.svelte`, `Header.svelte`, `app.svelte.ts:monitorEntries, runMonitorCheck()`

### PWA Support
Progressive Web App with offline capability. Includes `manifest.json`, app icons (192px, 512px), service worker with cache-first strategy for static assets and network-first for API calls. Install prompt shown when browser triggers `beforeinstallprompt`.

**Files:** `static/manifest.json`, `static/sw.js`, `static/icons/`, `app.html`, `app.svelte.ts:registerSW()`

### Deploy Architecture
Production-ready deployment: multi-stage Dockerfile (bun + dig + whois), docker-compose.yml, deploy script. API server serves static files in production mode. Per-IP rate limiting (100 req/min). Configurable CORS origin and port via env vars.

**Files:** `Dockerfile`, `docker-compose.yml`, `scripts/deploy.sh`, `api-server.ts`
