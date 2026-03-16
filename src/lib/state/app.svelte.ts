import { generateCandidates } from '../mutations';
import { isStale } from '../utils';
import { toasts } from './toasts.svelte';
import type {
	DomainCandidate,
	DomainResult,
	DomainList,
	SavedDomain,
	MutationType,
	Filters,
	SortField,
	SortDir,
	TldPricing,
	RegistrarId,
	SearchHistoryEntry,
	CustomMutation,
	WhoisData,
	MonitorEntry,
	MonitorConfig,
	ResolverMode,
} from '../types';
import { DEFAULT_TLDS, DEFAULT_MUTATIONS, LIST_COLORS, REGISTRARS } from '../types';
import { SPACESHIP_TLDS, NAMECHEAP_TLDS, CLOUDFLARE_TLDS } from '../registrar-tlds';
import { detectMode, createResolver, MODE_LABELS } from '../resolvers';
import type { Resolver, ResolverResult } from '../resolvers';

/** Parse terms from user input (comma, newline, or space separated) */
function parseTerms(input: string): string[] {
	return input
		.split(/[,\n\r]+/)
		.map((t) => t.trim().toLowerCase().replace(/[^a-z0-9-]/g, ''))
		.filter((t) => t.length >= 2);
}

/** localStorage key prefix */
const LS = 'digr-';

/** Current schema version — bump when localStorage shape changes */
const SCHEMA_VERSION = 2;

/** Maximum number of results to persist (prune oldest by checkedAt) */
const MAX_STORED_RESULTS = 2000;

/**
 * Module-level operational state — kept outside the class to prevent
 * Svelte 5's compiler from wrapping them in reactive getters/setters,
 * which breaks timer callbacks and non-reactive bookkeeping.
 */
let _abortController: AbortController | null = null;
let _pendingUpdates: Array<{ domain: string; records: string[]; status: string; error?: string; method?: string }> = [];
let _flushTimer: ReturnType<typeof setTimeout> | null = null;
let _lastProgress = 0;
let _persistInputTimer: ReturnType<typeof setTimeout> | null = null;
let _monitorTimer: ReturnType<typeof setInterval> | null = null;
/** Active resolver instance — initialized in initTheme(), falls back to browser-doh */
let _resolver: Resolver | null = null;

/** Max search history entries */
const MAX_HISTORY = 50;

/** Run any needed schema migrations based on stored version */
function runMigrations(): void {
	const stored = parseInt(localStorage.getItem(LS + 'schema-version') ?? '0', 10);
	if (stored >= SCHEMA_VERSION) return;
	// Future migrations go here: if (stored < 2) { ... }
	localStorage.setItem(LS + 'schema-version', String(SCHEMA_VERSION));
}

/** Safe JSON parse with fallback */
function safeParse<T>(key: string, fallback: T): T {
	try {
		const raw = localStorage.getItem(LS + key);
		if (raw === null) return fallback;
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

/** Restore a Set from localStorage (stored as array) */
function restoreSet<T>(key: string, fallback: Set<T>): Set<T> {
	try {
		const raw = localStorage.getItem(LS + key);
		if (raw === null) return fallback;
		return new Set(JSON.parse(raw) as T[]);
	} catch {
		return fallback;
	}
}

/** Restore results Map from localStorage */
function restoreResults(): Map<string, DomainResult> {
	try {
		const raw = localStorage.getItem(LS + 'results');
		if (raw === null) return new Map();
		const entries = JSON.parse(raw) as [string, DomainResult][];
		return new Map(entries);
	} catch {
		return new Map();
	}
}

class AppState {
	// --- Input state (restored from localStorage) ---
	termsInput = $state(safeParse('termsInput', ''));
	selectedTlds = $state<Set<string>>(restoreSet('selectedTlds', new Set(DEFAULT_TLDS)));
	selectedMutations = $state<Set<MutationType>>(restoreSet('selectedMutations', new Set(DEFAULT_MUTATIONS)));

	// --- Results state (restored from localStorage) ---
	results = $state<Map<string, DomainResult>>(restoreResults());
	searching = $state(false);
	progress = $state({ done: 0, total: 0 });

	// --- Filter state (restored from localStorage) ---
	filters = $state<Filters>((() => {
		const defaults: Filters = { status: 'all', tlds: new Set<string>(), mutations: new Set<MutationType>(), lengthMin: 0, lengthMax: 99, priceRenewalMin: 0, priceRenewalMax: 9999, search: '', hideErrors: false, registrars: new Set<RegistrarId>() };
		try {
			const raw = localStorage.getItem(LS + 'filters');
			if (raw === null) return defaults;
			const parsed = JSON.parse(raw);
			return {
				status: parsed.status || 'all',
				tlds: new Set<string>(parsed.tlds || []),
				mutations: new Set<MutationType>(parsed.mutations || []),
				lengthMin: parsed.lengthMin ?? 0,
				lengthMax: parsed.lengthMax ?? 99,
				priceRenewalMin: parsed.priceRenewalMin ?? 0,
				priceRenewalMax: parsed.priceRenewalMax ?? 9999,
				search: parsed.search || '',
				hideErrors: parsed.hideErrors ?? false,
				registrars: new Set<RegistrarId>(parsed.registrars || []),
			};
		} catch {
			return defaults;
		}
	})());

	// --- Pricing state (fetched per session, not persisted) ---
	pricing = $state<Map<string, TldPricing>>(new Map());
	/** Per-registrar TLD support (fetched with pricing, not persisted) */
	registrarTlds = $state<Map<RegistrarId, Set<string>>>(new Map());

	// --- Saved domains / lists (restored from localStorage) ---
	lists = $state<DomainList[]>(safeParse('lists', [] as DomainList[]));
	saved = $state<SavedDomain[]>(safeParse('saved', [] as SavedDomain[]));
	savedViewOpen = $state(false);
	savedFilterListId = $state<string | null>(null);

	// --- View state (restored from localStorage) ---
	sort = $state<{ field: SortField; dir: SortDir }>(safeParse('sort', { field: 'status' as SortField, dir: 'asc' as SortDir }));
	viewMode = $state<'card' | 'table'>(safeParse('viewMode', 'card' as const));
	theme = $state<'dark' | 'light'>('dark');
	sidebarOpen = $state(false);

	// --- Search history (restored from localStorage) ---
	searchHistory = $state<SearchHistoryEntry[]>(safeParse('history', [] as SearchHistoryEntry[]));

	// --- Custom mutations (restored from localStorage) ---
	customMutations = $state<CustomMutation[]>(safeParse('custom-mutations', [] as CustomMutation[]));

	// --- Whois detail panel ---
	whoisPanel = $state<{ domain: string; loading: boolean; data: WhoisData | null; error: string | null }>({
		domain: '', loading: false, data: null, error: null,
	});

	// --- Bulk selection ---
	selectedDomains = $state<Set<string>>(new Set());

	// --- Domain monitoring (restored from localStorage) ---
	monitorEntries = $state<MonitorEntry[]>(safeParse('monitor-entries', [] as MonitorEntry[]));
	monitorConfig = $state<MonitorConfig>(safeParse('monitor-config', { enabled: false, intervalMinutes: 1440 }));
	monitorPanelOpen = $state(false);

	// --- Resolver state ---
	resolverMode = $state<ResolverMode>('browser-doh');
	resolverReady = $state(false);

	/** Browser online/offline status — updated by window online/offline events */
	isOffline = $state(false);

	/** Persist current state to localStorage */
	persist() {
		try {
			localStorage.setItem(LS + 'termsInput', JSON.stringify(this.termsInput));
			localStorage.setItem(LS + 'selectedTlds', JSON.stringify([...this.selectedTlds]));
			localStorage.setItem(LS + 'selectedMutations', JSON.stringify([...this.selectedMutations]));
			localStorage.setItem(LS + 'sort', JSON.stringify(this.sort));
			localStorage.setItem(LS + 'viewMode', JSON.stringify(this.viewMode));
			// Serialize filters (Sets → arrays)
			localStorage.setItem(LS + 'filters', JSON.stringify({
				status: this.filters.status,
				tlds: [...this.filters.tlds],
				mutations: [...this.filters.mutations],
				lengthMin: this.filters.lengthMin,
				lengthMax: this.filters.lengthMax,
				priceRenewalMin: this.filters.priceRenewalMin,
				priceRenewalMax: this.filters.priceRenewalMax,
				search: this.filters.search,
				hideErrors: this.filters.hideErrors,
				registrars: [...this.filters.registrars],
			}));
			// Serialize results Map (skip 'checking' status entries, prune to MAX_STORED_RESULTS)
			let entries = [...this.results.entries()].filter(([, r]) => r.status !== 'checking');
			if (entries.length > MAX_STORED_RESULTS) {
				entries.sort((a, b) => (b[1].checkedAt ?? 0) - (a[1].checkedAt ?? 0));
				entries = entries.slice(0, MAX_STORED_RESULTS);
			}
			localStorage.setItem(LS + 'results', JSON.stringify(entries));
			// Persist saved domains and lists
			localStorage.setItem(LS + 'lists', JSON.stringify(this.lists));
			localStorage.setItem(LS + 'saved', JSON.stringify(this.saved));
			// Persist search history
			localStorage.setItem(LS + 'history', JSON.stringify(this.searchHistory));
			// Persist custom mutations
			localStorage.setItem(LS + 'custom-mutations', JSON.stringify(this.customMutations));
			// Persist monitoring state
			localStorage.setItem(LS + 'monitor-entries', JSON.stringify(this.monitorEntries));
			localStorage.setItem(LS + 'monitor-config', JSON.stringify(this.monitorConfig));
		} catch {
			// localStorage full or unavailable — silently ignore
		}
	}

	/** Parsed terms from the input textarea */
	get terms(): string[] {
		return parseTerms(this.termsInput);
	}

	/** Generate candidates from current input state (preview before searching) */
	get candidates(): DomainCandidate[] {
		return generateCandidates(this.terms, this.selectedMutations, this.selectedTlds, this.customMutations);
	}

	/** All results as array, with active filters applied */
	get filteredResults(): DomainResult[] {
		let items = [...this.results.values()];

		// Status filter
		if (this.filters.status === 'available') {
			items = items.filter((r) => r.status === 'available');
		} else if (this.filters.status === 'likely-available') {
			items = items.filter((r) => r.status === 'likely-available');
		} else if (this.filters.status === 'taken') {
			items = items.filter((r) => r.status === 'taken');
		} else if (this.filters.status === 'reserved') {
			items = items.filter((r) => r.status === 'reserved');
		}

		// Hide errors filter
		if (this.filters.hideErrors) {
			items = items.filter((r) => r.status !== 'error');
		}

		// TLD filter
		if (this.filters.tlds.size > 0) {
			items = items.filter((r) => this.filters.tlds.has(r.tld));
		}

		// Mutation filter
		if (this.filters.mutations.size > 0) {
			items = items.filter((r) => this.filters.mutations.has(r.mutation));
		}

		// Length filter
		if (this.filters.lengthMin > 0) {
			items = items.filter((r) => r.nameLength >= this.filters.lengthMin);
		}
		if (this.filters.lengthMax < 99) {
			items = items.filter((r) => r.nameLength <= this.filters.lengthMax);
		}

		// Text search within results
		if (this.filters.search) {
			const q = this.filters.search.toLowerCase();
			items = items.filter(
				(r) => r.domain.includes(q) || r.term.includes(q) || r.name.includes(q)
			);
		}

		// Registrar filter: only show domains whose TLD is sold by ALL selected registrars
		if (this.filters.registrars.size > 0) {
			items = items.filter((r) => {
				const tldKey = r.tld.startsWith('.') ? r.tld.slice(1) : r.tld;
				for (const rid of this.filters.registrars) {
					const supported = this.registrarTlds.get(rid);
					if (!supported || !supported.has(tldKey)) return false;
				}
				return true;
			});
		}

		// Renewal price filter
		if (this.filters.priceRenewalMin > 0 || this.filters.priceRenewalMax < 9999) {
			items = items.filter((r) => {
				const renewal = parseFloat(this.getRenewalPrice(r.tld) ?? '');
				if (isNaN(renewal)) return true; // keep domains with no pricing data
				return renewal >= this.filters.priceRenewalMin && renewal <= this.filters.priceRenewalMax;
			});
		}

		// Sort
		items.sort((a, b) => {
			let cmp = 0;
			switch (this.sort.field) {
				case 'domain':
					cmp = a.domain.localeCompare(b.domain);
					break;
				case 'name':
					cmp = a.name.localeCompare(b.name);
					break;
				case 'tld':
					cmp = a.tld.localeCompare(b.tld) || a.name.localeCompare(b.name);
					break;
				case 'mutation':
					cmp = a.mutation.localeCompare(b.mutation) || a.name.localeCompare(b.name);
					break;
				case 'status': {
					const order: Record<string, number> = { available: 0, 'likely-available': 1, checking: 2, error: 3, reserved: 4, taken: 5 };
					cmp = order[a.status] - order[b.status] || a.domain.localeCompare(b.domain);
					break;
				}
				case 'length':
					cmp = a.nameLength - b.nameLength || a.domain.localeCompare(b.domain);
					break;
				case 'price': {
					const pa = parseFloat(this.getPrice(a.tld) ?? '') || Infinity;
					const pb = parseFloat(this.getPrice(b.tld) ?? '') || Infinity;
					cmp = pa - pb || a.domain.localeCompare(b.domain);
					break;
				}
				case 'renewal': {
					const ra = parseFloat(this.getRenewalPrice(a.tld) ?? '') || Infinity;
					const rb = parseFloat(this.getRenewalPrice(b.tld) ?? '') || Infinity;
					cmp = ra - rb || a.domain.localeCompare(b.domain);
					break;
				}
			}
			return this.sort.dir === 'asc' ? cmp : -cmp;
		});

		return items;
	}

	/** Count of available results (unfiltered) */
	get availableCount(): number {
		let count = 0;
		for (const r of this.results.values()) {
			if (r.status === 'available') count++;
		}
		return count;
	}

	/** Count of likely-available results (unfiltered) */
	get likelyAvailableCount(): number {
		let count = 0;
		for (const r of this.results.values()) {
			if (r.status === 'likely-available') count++;
		}
		return count;
	}

	/** Count of taken results (unfiltered, excludes reserved) */
	get takenCount(): number {
		let count = 0;
		for (const r of this.results.values()) {
			if (r.status === 'taken') count++;
		}
		return count;
	}

	/** Count of reserved results (unfiltered) */
	get reservedCount(): number {
		let count = 0;
		for (const r of this.results.values()) {
			if (r.status === 'reserved') count++;
		}
		return count;
	}

	/** Count of error results (unfiltered) */
	get errorCount(): number {
		let count = 0;
		for (const r of this.results.values()) {
			if (r.status === 'error') count++;
		}
		return count;
	}

	/** Count of unverified results (available but whois failed — needs retry) */
	get unverifiedCount(): number {
		let count = 0;
		for (const r of this.results.values()) {
			if (r.status === 'available' && r.error) count++;
		}
		return count;
	}

	/** Re-check all unverified domains (available with whois errors) */
	async recheckUnverified() {
		const entries = [...this.results.values()]
			.filter((r) => r.status === 'available' && r.error);
		if (entries.length === 0) return;

		const domains = entries.map((r) => r.domain);
		const updated = new Map(this.results);
		for (const d of domains) {
			const entry = updated.get(d);
			if (entry) updated.set(d, { ...entry, status: 'checking', error: undefined });
		}
		this.results = updated;

		try {
			const resolver = this.getResolver();
			const resultMap = new Map<string, ResolverResult>();
			await resolver.check(domains, (r) => { resultMap.set(r.domain, r); });

			let changed = 0;
			const next = new Map(this.results);
			for (const [domain, r] of resultMap) {
				const entry = next.get(domain);
				if (entry) {
					const wasAvailable = entries.find((e) => e.domain === domain);
					const statusChanged = wasAvailable && wasAvailable.status !== r.status;
					if (statusChanged) changed++;
					next.set(domain, {
						...entry,
						records: r.records,
						status: r.status,
						error: r.error,
						checkedAt: Date.now(),
						previousStatus: statusChanged ? wasAvailable.status : entry.previousStatus,
					});
				}
			}
			this.results = next;
			const verified = domains.length - [...resultMap.values()].filter((r) => r.error).length;
			toasts.success(`Rechecked ${domains.length} unverified${verified > 0 ? `, ${verified} verified` : ''}${changed > 0 ? `, ${changed} changed` : ''}`);
		} catch {
			const next = new Map(this.results);
			for (const d of domains) {
				const entry = next.get(d);
				if (entry && entry.status === 'checking') {
					next.set(d, { ...entry, status: 'error', error: 'recheck failed' });
				}
			}
			this.results = next;
		}
		this.persist();
	}

	/** Count of stale results (checked >24h ago, unfiltered) */
	get staleCount(): number {
		let count = 0;
		for (const r of this.results.values()) {
			if (r.status !== 'checking' && isStale(r.checkedAt)) count++;
		}
		return count;
	}

	/** Re-check all stale results (older than 24h) */
	async recheckStale() {
		const staleEntries = [...this.results.values()]
			.filter((r) => r.status !== 'checking' && isStale(r.checkedAt));
		if (staleEntries.length === 0) return;

		const oldStatuses = new Map(staleEntries.map((r) => [r.domain, r.status]));
		const staleDomains = staleEntries.map((r) => r.domain);

		// Set all stale to checking
		const updated = new Map(this.results);
		for (const d of staleDomains) {
			const entry = updated.get(d);
			if (entry) updated.set(d, { ...entry, status: 'checking', error: undefined });
		}
		this.results = updated;

		try {
			const resolver = this.getResolver();
			const resultMap = new Map<string, ResolverResult>();
			await resolver.check(staleDomains, (r) => { resultMap.set(r.domain, r); });

			let changed = 0;
			const next = new Map(this.results);
			for (const [domain, r] of resultMap) {
				const entry = next.get(domain);
				if (entry) {
					const oldStatus = oldStatuses.get(domain);
					const statusChanged = oldStatus && oldStatus !== r.status;
					if (statusChanged) changed++;
					next.set(domain, {
						...entry,
						records: r.records,
						status: r.status,
						error: r.error,
						checkedAt: Date.now(),
						previousStatus: statusChanged ? oldStatus : entry.previousStatus,
					});
				}
			}
			this.results = next;
			toasts.success(`Rechecked ${staleDomains.length} stale${changed > 0 ? `, ${changed} changed` : ''}`);
		} catch {
			const next = new Map(this.results);
			for (const d of staleDomains) {
				const entry = next.get(d);
				if (entry && entry.status === 'checking') {
					next.set(d, { ...entry, status: 'error', error: 'stale recheck failed' });
				}
			}
			this.results = next;
		}
		this.persist();
	}

	/** Estimated localStorage usage for digr-* keys in KB */
	get storageUsageKB(): number {
		let bytes = 0;
		try {
			for (let i = 0; i < localStorage.length; i++) {
				const key = localStorage.key(i);
				if (key?.startsWith(LS)) {
					bytes += key.length * 2; // UTF-16
					bytes += (localStorage.getItem(key)?.length ?? 0) * 2;
				}
			}
		} catch { /* ignore */ }
		return Math.round(bytes / 1024);
	}

	/** Export saved lists + domains as JSON */
	exportSaved(): string {
		return JSON.stringify({
			version: 1,
			exportedAt: Date.now(),
			lists: this.lists,
			saved: this.saved,
		}, null, 2);
	}

	/** Import saved lists + domains from JSON, merging by dedup */
	importSaved(json: string): { lists: number; domains: number } {
		const data = JSON.parse(json) as { lists?: DomainList[]; saved?: SavedDomain[] };

		// Validate JSON structure
		if (typeof data !== 'object' || data === null) {
			throw new Error('Invalid import: expected JSON object');
		}
		if (data.lists && !Array.isArray(data.lists)) {
			throw new Error('Invalid import: lists must be an array');
		}
		if (data.saved && !Array.isArray(data.saved)) {
			throw new Error('Invalid import: saved must be an array');
		}
		// Validate required fields on each list entry
		if (data.lists) {
			for (const l of data.lists) {
				if (!l.id || !l.name || typeof l.createdAt !== 'number') {
					throw new Error('Invalid import: list missing required fields (id, name, createdAt)');
				}
			}
		}
		// Validate required fields on each saved domain entry
		if (data.saved) {
			for (const s of data.saved) {
				if (!s.domain || !s.listId || !s.status || typeof s.addedAt !== 'number') {
					throw new Error('Invalid import: saved domain missing required fields (domain, listId, status, addedAt)');
				}
			}
		}
		let listsAdded = 0;
		let domainsAdded = 0;

		if (data.lists) {
			const existingIds = new Set(this.lists.map((l) => l.id));
			const newLists = data.lists.filter((l) => !existingIds.has(l.id));
			if (newLists.length > 0) {
				this.lists = [...this.lists, ...newLists];
				listsAdded = newLists.length;
			}
		}

		if (data.saved) {
			const existingKey = new Set(this.saved.map((s) => `${s.domain}:${s.listId}`));
			const newSaved = data.saved.filter((s) => !existingKey.has(`${s.domain}:${s.listId}`));
			if (newSaved.length > 0) {
				this.saved = [...this.saved, ...newSaved];
				domainsAdded = newSaved.length;
			}
		}

		this.persist();
		return { lists: listsAdded, domains: domainsAdded };
	}

	/** Whether any filter is active */
	get hasActiveFilters(): boolean {
		return (
			this.filters.status !== 'all' ||
			this.filters.tlds.size > 0 ||
			this.filters.mutations.size > 0 ||
			this.filters.lengthMin > 0 ||
			this.filters.lengthMax < 99 ||
			this.filters.priceRenewalMin > 0 ||
			this.filters.priceRenewalMax < 9999 ||
			this.filters.search.length > 0 ||
			this.filters.hideErrors ||
			this.filters.registrars.size > 0
		);
	}

	/** Toggle a TLD for searching */
	toggleTld(tld: string) {
		const next = new Set(this.selectedTlds);
		if (next.has(tld)) next.delete(tld);
		else next.add(tld);
		this.selectedTlds = next;
		this.persist();
	}

	/** Toggle a mutation for searching */
	toggleMutation(m: MutationType) {
		const next = new Set(this.selectedMutations);
		if (next.has(m)) next.delete(m);
		else next.add(m);
		this.selectedMutations = next;
		this.persist();
	}

	/** Toggle a TLD in the result filters */
	toggleFilterTld(tld: string) {
		const next = new Set(this.filters.tlds);
		if (next.has(tld)) next.delete(tld);
		else next.add(tld);
		this.filters = { ...this.filters, tlds: next };
		this.persist();
	}

	/** Toggle a mutation in the result filters */
	toggleFilterMutation(m: MutationType) {
		const next = new Set(this.filters.mutations);
		if (next.has(m)) next.delete(m);
		else next.add(m);
		this.filters = { ...this.filters, mutations: next };
		this.persist();
	}

	/** Set status filter */
	setStatusFilter(status: Filters['status']) {
		this.filters = { ...this.filters, status };
		this.persist();
	}

	/** Clear all result filters */
	clearFilters() {
		this.filters = {
			status: 'all',
			tlds: new Set(),
			mutations: new Set(),
			lengthMin: 0,
			lengthMax: 99,
			priceRenewalMin: 0,
			priceRenewalMax: 9999,
			search: '',
			hideErrors: false,
			registrars: new Set(),
		};
		this.persist();
	}

	/** Toggle sort field (flip direction if same field) */
	setSort(field: SortField) {
		if (this.sort.field === field) {
			this.sort = { field, dir: this.sort.dir === 'asc' ? 'desc' : 'asc' };
		} else {
			this.sort = { field, dir: 'asc' };
		}
		this.persist();
	}

	/** Update terms input and persist (debounced) */
	setTermsInput(value: string) {
		this.termsInput = value;
		if (_persistInputTimer) clearTimeout(_persistInputTimer);
		_persistInputTimer = setTimeout(() => this.persist(), 500);
	}

	/** Set view mode and persist */
	setViewMode(mode: 'card' | 'table') {
		this.viewMode = mode;
		this.persist();
	}

	/** Update a filter field and persist (for inline oninput handlers) */
	setFilter(patch: Partial<Filters>) {
		this.filters = { ...this.filters, ...patch };
		this.persist();
	}

	// --- Pricing methods ---

	/** Fetch TLD pricing + registrar TLD support from API or Porkbun direct */
	async fetchPricing() {
		try {
			// Try local API first if in that mode
			if (_resolver?.mode === 'local-api') {
				const res = await fetch('/api/pricing');
				const data = await res.json() as {
					pricing: Record<string, TldPricing>;
					registrars: Record<string, string[]>;
				};
				if (data.pricing) {
					const map = new Map<string, TldPricing>();
					for (const [tld, p] of Object.entries(data.pricing)) map.set(tld, p);
					this.pricing = map;
				}
				if (data.registrars) {
					const rmap = new Map<RegistrarId, Set<string>>();
					for (const [rid, tlds] of Object.entries(data.registrars)) rmap.set(rid as RegistrarId, new Set(tlds));
					this.registrarTlds = rmap;
				}
				return;
			}

			// Direct Porkbun API call (public, CORS-enabled)
			const res = await fetch('https://api.porkbun.com/api/json/v3/domain/pricing', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({}),
			});
			const data = await res.json() as { status: string; pricing?: Record<string, { registration?: string; renewal?: string }> };
			if (data.status === 'SUCCESS' && data.pricing) {
				const map = new Map<string, TldPricing>();
				const porkbunTlds: string[] = [];
				for (const [tld, prices] of Object.entries(data.pricing)) {
					map.set(tld, { registration: prices.registration || '0', renewal: prices.renewal || '0' });
					porkbunTlds.push(tld);
				}
				this.pricing = map;
				// Build registrar TLD support from Porkbun response + curated lists
				const rmap = new Map<RegistrarId, Set<string>>();
				rmap.set('porkbun', new Set(porkbunTlds));
				rmap.set('namecheap', new Set(NAMECHEAP_TLDS));
				rmap.set('spaceship', new Set(SPACESHIP_TLDS));
				rmap.set('cloudflare', new Set(CLOUDFLARE_TLDS));
				this.registrarTlds = rmap;
			}
		} catch {
			// Pricing is optional — silently fail
		}
	}

	/** Get registration price for a TLD (e.g. ".com" → "9.73") or null */
	getPrice(tld: string): string | null {
		const key = tld.startsWith('.') ? tld.slice(1) : tld;
		const entry = this.pricing.get(key);
		return entry?.registration ?? null;
	}

	/** Get renewal price for a TLD (e.g. ".com" → "10.18") or null */
	getRenewalPrice(tld: string): string | null {
		const key = tld.startsWith('.') ? tld.slice(1) : tld;
		const entry = this.pricing.get(key);
		return entry?.renewal ?? null;
	}

	/** Get registrar IDs that support a given TLD (e.g. ".com" → ['namecheap','porkbun','cloudflare','spaceship']) */
	getRegistrarsForTld(tld: string): RegistrarId[] {
		const key = tld.startsWith('.') ? tld.slice(1) : tld;
		const result: RegistrarId[] = [];
		for (const [rid, tlds] of this.registrarTlds) {
			if (tlds.has(key)) result.push(rid);
		}
		// Porkbun always included (source of pricing data, supports everything they price)
		if (!result.includes('porkbun') && this.pricing.has(key)) {
			result.push('porkbun');
		}
		return result;
	}

	/** Toggle a registrar in the result filters */
	toggleFilterRegistrar(id: RegistrarId) {
		const next = new Set(this.filters.registrars);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		this.filters = { ...this.filters, registrars: next };
		this.persist();
	}

	// --- Saved domain / list CRUD ---

	/** Total saved domain count */
	get savedCount(): number {
		return this.saved.length;
	}

	/** Create a new list with auto-assigned color */
	createList(name: string): DomainList {
		const list: DomainList = {
			id: crypto.randomUUID(),
			name,
			color: LIST_COLORS[this.lists.length % LIST_COLORS.length],
			createdAt: Date.now(),
		};
		this.lists = [...this.lists, list];
		this.persist();
		return list;
	}

	/** Rename a list */
	renameList(id: string, name: string) {
		this.lists = this.lists.map((l) => (l.id === id ? { ...l, name } : l));
		this.persist();
	}

	/** Delete a list and all its saved domains */
	deleteList(id: string) {
		this.lists = this.lists.filter((l) => l.id !== id);
		this.saved = this.saved.filter((s) => s.listId !== id);
		this.persist();
	}

	/** Save a domain to a list */
	saveDomain(domain: string, listId: string, status: SavedDomain['status']) {
		// Don't duplicate
		if (this.saved.some((s) => s.domain === domain && s.listId === listId)) return;
		this.saved = [...this.saved, { domain, listId, status, addedAt: Date.now() }];
		this.persist();
	}

	/** Remove a domain from a list (or all lists if listId omitted) */
	unsaveDomain(domain: string, listId?: string) {
		if (listId) {
			this.saved = this.saved.filter((s) => !(s.domain === domain && s.listId === listId));
		} else {
			this.saved = this.saved.filter((s) => s.domain !== domain);
		}
		this.persist();
	}

	/** Check if domain is saved in any list */
	isDomainSaved(domain: string): boolean {
		return this.saved.some((s) => s.domain === domain);
	}

	/** Get all list IDs a domain is saved in */
	getListsForDomain(domain: string): string[] {
		return this.saved.filter((s) => s.domain === domain).map((s) => s.listId);
	}

	/** Get saved domains, optionally filtered by list */
	getSavedDomains(listId?: string | null): SavedDomain[] {
		if (listId) return this.saved.filter((s) => s.listId === listId);
		return this.saved;
	}

	/** Get count of saved domains in a list */
	getListCount(listId: string): number {
		return this.saved.filter((s) => s.listId === listId).length;
	}

	// --- Retry methods ---

	/** Re-check a single domain (for retrying errors) */
	async recheckDomain(domain: string) {
		const existing = this.results.get(domain);
		if (!existing) return;

		const oldStatus = existing.status !== 'checking' ? existing.status : undefined;

		// Set to checking state
		const updated = new Map(this.results);
		updated.set(domain, { ...existing, status: 'checking', error: undefined });
		this.results = updated;

		try {
			const resolver = this.getResolver();
			const result = await resolver.verify(domain);
			const next = new Map(this.results);
			const entry = next.get(domain);
			if (entry) {
				const statusChanged = oldStatus && oldStatus !== result.status;
				next.set(domain, {
					...entry,
					records: result.records,
					status: result.status,
					error: result.error,
					checkedAt: Date.now(),
					previousStatus: statusChanged ? oldStatus : entry.previousStatus,
				});
				this.results = next;
			}
		} catch {
			// Restore error state on fetch failure
			const next = new Map(this.results);
			const entry = next.get(domain);
			if (entry) {
				next.set(domain, { ...entry, status: 'error', error: 'retry failed' });
				this.results = next;
			}
		}
		this.persist();
	}

	/** Re-check all domains with error status */
	async recheckAllErrors() {
		const errorEntries = [...this.results.values()].filter((r) => r.status === 'error');
		if (errorEntries.length === 0) return;

		const oldStatuses = new Map(errorEntries.map((r) => [r.domain, r.status]));
		const errorDomains = errorEntries.map((r) => r.domain);

		// Set all to checking
		const updated = new Map(this.results);
		for (const d of errorDomains) {
			const entry = updated.get(d);
			if (entry) updated.set(d, { ...entry, status: 'checking', error: undefined });
		}
		this.results = updated;

		try {
			const resolver = this.getResolver();
			const resultMap = new Map<string, ResolverResult>();
			await resolver.check(errorDomains, (r) => { resultMap.set(r.domain, r); });

			let resolved = 0;
			const next = new Map(this.results);
			for (const [domain, r] of resultMap) {
				const entry = next.get(domain);
				if (entry) {
					const oldStatus = oldStatuses.get(domain);
					const statusChanged = oldStatus && oldStatus !== r.status;
					if (r.status !== 'error') resolved++;
					next.set(domain, {
						...entry,
						records: r.records,
						status: r.status,
						error: r.error,
						checkedAt: Date.now(),
						previousStatus: statusChanged ? oldStatus : entry.previousStatus,
					});
				}
			}
			this.results = next;
			toasts.success(`Retried ${errorDomains.length} errors, ${resolved} resolved`);
		} catch {
			const next = new Map(this.results);
			for (const d of errorDomains) {
				const entry = next.get(d);
				if (entry && entry.status === 'checking') {
					next.set(d, { ...entry, status: 'error', error: 'retry failed' });
				}
			}
			this.results = next;
		}
		this.persist();
	}

	// --- Search history methods ---

	/** Save current search config to history (called after search completes) */
	saveToHistory() {
		if (!this.termsInput.trim()) return;
		// Deduplicate by fingerprint (terms + tlds + mutations)
		const fingerprint = JSON.stringify({
			terms: this.termsInput.trim(),
			tlds: [...this.selectedTlds].sort(),
			mutations: [...this.selectedMutations].sort(),
		});
		const existing = this.searchHistory.findIndex((h) => {
			const fp = JSON.stringify({
				terms: h.terms,
				tlds: [...h.tlds].sort(),
				mutations: [...h.mutations].sort(),
			});
			return fp === fingerprint;
		});
		const entry: SearchHistoryEntry = {
			id: crypto.randomUUID(),
			terms: this.termsInput.trim(),
			tlds: [...this.selectedTlds],
			mutations: [...this.selectedMutations],
			timestamp: Date.now(),
			resultCount: this.results.size,
		};
		let history = [...this.searchHistory];
		if (existing >= 0) history.splice(existing, 1); // remove old duplicate
		history.unshift(entry); // add to front
		if (history.length > MAX_HISTORY) history = history.slice(0, MAX_HISTORY);
		this.searchHistory = history;
		this.persist();
	}

	/** Restore search config from a history entry */
	restoreFromHistory(entry: SearchHistoryEntry) {
		this.setTermsInput(entry.terms);
		this.selectedTlds = new Set(entry.tlds);
		this.selectedMutations = new Set(entry.mutations as MutationType[]);
		this.persist();
	}

	/** Delete a history entry */
	deleteHistoryEntry(id: string) {
		this.searchHistory = this.searchHistory.filter((h) => h.id !== id);
		this.persist();
	}

	/** Clear all history */
	clearHistory() {
		this.searchHistory = [];
		this.persist();
	}

	// --- Custom mutation methods ---

	/** Add a custom mutation pattern */
	addCustomMutation(label: string, pattern: string) {
		if (!pattern.includes('{term}')) return;
		const cm: CustomMutation = {
			id: crypto.randomUUID(),
			label: label || pattern,
			pattern: pattern.toLowerCase(),
		};
		this.customMutations = [...this.customMutations, cm];
		this.persist();
	}

	/** Remove a custom mutation */
	removeCustomMutation(id: string) {
		this.customMutations = this.customMutations.filter((m) => m.id !== id);
		this.persist();
	}

	// --- Whois detail panel ---

	/** Open whois detail panel for a domain */
	async openWhois(domain: string) {
		this.whoisPanel = { domain, loading: true, data: null, error: null };
		try {
			const resolver = this.getResolver();
			const data = await resolver.lookup(domain);
			if (data) {
				this.whoisPanel = { domain, loading: false, data, error: null };
			} else {
				this.whoisPanel = { domain, loading: false, data: null, error: 'Lookup returned no data' };
			}
		} catch (err) {
			this.whoisPanel = {
				domain,
				loading: false,
				data: null,
				error: err instanceof Error ? err.message : 'Lookup failed',
			};
		}
	}

	/** Close whois panel */
	closeWhois() {
		this.whoisPanel = { domain: '', loading: false, data: null, error: null };
	}

	// --- Bulk selection ---

	/** Toggle domain selection */
	toggleSelect(domain: string) {
		const next = new Set(this.selectedDomains);
		if (next.has(domain)) next.delete(domain);
		else next.add(domain);
		this.selectedDomains = next;
	}

	/** Select/deselect all visible domains */
	toggleSelectAll() {
		if (this.selectedDomains.size > 0) {
			this.selectedDomains = new Set();
		} else {
			this.selectedDomains = new Set(this.filteredResults.map((r) => r.domain));
		}
	}

	/** Clear selection */
	clearSelection() {
		this.selectedDomains = new Set();
	}

	/** Select range of domains (for shift-click) */
	selectRange(fromDomain: string, toDomain: string) {
		const domains = this.filteredResults.map((r) => r.domain);
		const fromIdx = domains.indexOf(fromDomain);
		const toIdx = domains.indexOf(toDomain);
		if (fromIdx < 0 || toIdx < 0) return;
		const [start, end] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
		const next = new Set(this.selectedDomains);
		for (let i = start; i <= end; i++) next.add(domains[i]);
		this.selectedDomains = next;
	}

	/** Save all selected domains to a list */
	bulkSave(listId: string) {
		let count = 0;
		for (const domain of this.selectedDomains) {
			const result = this.results.get(domain);
			if (result && result.status !== 'checking') {
				const status = result.status === 'error' ? 'taken' : result.status;
				if (!this.saved.some((s) => s.domain === domain && s.listId === listId)) {
					this.saved = [...this.saved, { domain, listId, status, addedAt: Date.now() }];
					count++;
				}
			}
		}
		if (count > 0) {
			toasts.success(`Saved ${count} domains to list`);
			this.persist();
		}
	}

	/** Copy selected domains to clipboard */
	async bulkCopy() {
		const text = [...this.selectedDomains].join('\n');
		try {
			await navigator.clipboard.writeText(text);
			toasts.success(`Copied ${this.selectedDomains.size} domains`);
		} catch { /* clipboard unavailable */ }
	}

	// --- Domain monitoring ---

	/** Add domain to monitoring */
	addToMonitor(domain: string) {
		if (this.monitorEntries.some((e) => e.domain === domain)) return;
		const result = this.results.get(domain);
		const entry: MonitorEntry = {
			domain,
			status: result?.status ?? 'error',
			lastChecked: Date.now(),
			history: [{ status: result?.status ?? 'error', checkedAt: Date.now() }],
		};
		this.monitorEntries = [...this.monitorEntries, entry];
		this.persist();
		toasts.info(`Monitoring ${domain}`);
	}

	/** Remove domain from monitoring */
	removeFromMonitor(domain: string) {
		this.monitorEntries = this.monitorEntries.filter((e) => e.domain !== domain);
		this.persist();
	}

	/** Check if domain is being monitored */
	isMonitored(domain: string): boolean {
		return this.monitorEntries.some((e) => e.domain === domain);
	}

	/** Run a check on all monitored domains */
	async runMonitorCheck() {
		if (this.monitorEntries.length === 0) return;
		const domains = this.monitorEntries.map((e) => e.domain);
		try {
			const resolver = this.getResolver();
			const resultMap = new Map<string, ResolverResult>();
			await resolver.check(domains, (r) => { resultMap.set(r.domain, r); });

			// In browser-doh mode, auto-verify likely-available monitor entries via RDAP
			if (resolver.mode === 'browser-doh') {
				for (const [domain, r] of resultMap) {
					if (r.status === 'likely-available') {
						const verified = await resolver.verify(domain);
						resultMap.set(domain, verified);
					}
				}
			}

			let changed = 0;
			const next = [...this.monitorEntries];
			for (const [domain, r] of resultMap) {
				const idx = next.findIndex((e) => e.domain === domain);
				if (idx < 0) continue;
				const entry = next[idx];
				const newStatus = r.status;
				if (entry.status !== newStatus) changed++;
				next[idx] = {
					...entry,
					status: newStatus,
					lastChecked: Date.now(),
					history: [...entry.history, { status: newStatus, checkedAt: Date.now() }].slice(-20),
				};
			}
			this.monitorEntries = next;
			this.persist();
			if (changed > 0) {
				toasts.success(`Monitor: ${changed} domain${changed > 1 ? 's' : ''} changed status`);
			}
		} catch {
			// Silently fail — will retry next interval
		}
	}

	/** Start periodic monitoring */
	startMonitoring() {
		this.stopMonitoring();
		this.monitorConfig = { ...this.monitorConfig, enabled: true };
		this.persist();
		const intervalMs = this.monitorConfig.intervalMinutes * 60 * 1000;
		_monitorTimer = setInterval(() => this.runMonitorCheck(), intervalMs);
		// Run immediately on start
		this.runMonitorCheck();
	}

	/** Stop periodic monitoring */
	stopMonitoring() {
		this.monitorConfig = { ...this.monitorConfig, enabled: false };
		this.persist();
		if (_monitorTimer) {
			clearInterval(_monitorTimer);
			_monitorTimer = null;
		}
	}

	/** Set monitoring interval and restart if enabled */
	setMonitorInterval(minutes: number) {
		this.monitorConfig = { ...this.monitorConfig, intervalMinutes: minutes };
		this.persist();
		if (this.monitorConfig.enabled) {
			this.startMonitoring(); // restart with new interval
		}
	}

	/** Toggle theme */
	toggleTheme() {
		this.theme = this.theme === 'dark' ? 'light' : 'dark';
		document.documentElement.setAttribute('data-theme', this.theme);
		localStorage.setItem('digr-theme', this.theme);
	}

	/** Initialize theme from localStorage, fetch pricing, bind visibility persistence */
	initTheme() {
		// Run schema migrations before anything else
		runMigrations();

		const saved = localStorage.getItem('digr-theme') as 'dark' | 'light' | null;
		if (saved) {
			this.theme = saved;
			document.documentElement.setAttribute('data-theme', saved);
		} else if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) {
			// No saved pref — detect OS preference
			this.theme = 'light';
			document.documentElement.setAttribute('data-theme', 'light');
		}
		// Fetch TLD pricing (non-blocking)
		this.fetchPricing();
		// Persist state when user switches away from app (mobile tab switch, home button)
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'hidden') this.persist();
		});
		// Also persist before unload (desktop tab close / navigate away)
		window.addEventListener('beforeunload', () => this.persist());
		// Resume monitoring if it was enabled
		if (this.monitorConfig.enabled && this.monitorEntries.length > 0) {
			const intervalMs = this.monitorConfig.intervalMinutes * 60 * 1000;
			_monitorTimer = setInterval(() => this.runMonitorCheck(), intervalMs);
		}
		// Register service worker for PWA support
		if ('serviceWorker' in navigator) {
			navigator.serviceWorker.register('/sw.js').catch(() => {
				// SW registration failed — non-critical
			});
		}
		// Detect and initialize resolver
		detectMode().then((mode) => {
			this.resolverMode = mode;
			_resolver = createResolver(mode);
			this.resolverReady = true;
		});
		// Offline detection — set initial state and listen for changes
		this.isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
		if (typeof window !== 'undefined') {
			window.addEventListener('online', () => { this.isOffline = false; });
			window.addEventListener('offline', () => { this.isOffline = true; });
		}
	}

	/** Get the active resolver (falls back to browser-doh if not yet initialized) */
	private getResolver(): Resolver {
		if (!_resolver) {
			_resolver = createResolver('browser-doh');
		}
		return _resolver;
	}

	/** Switch resolver mode (for settings UI) */
	switchResolver(mode: ResolverMode) {
		this.resolverMode = mode;
		_resolver = createResolver(mode);
		try {
			localStorage.setItem('digr-resolver-mode', mode);
		} catch { /* ignore */ }
	}

	/** Clear forced resolver mode (revert to auto-detection) */
	clearResolverOverride() {
		try {
			localStorage.removeItem('digr-resolver-mode');
		} catch { /* ignore */ }
		detectMode().then((mode) => {
			this.resolverMode = mode;
			_resolver = createResolver(mode);
		});
	}

	/** Verify a likely-available domain via RDAP (upgrades or downgrades status) */
	async verifyDomain(domain: string) {
		const existing = this.results.get(domain);
		if (!existing || existing.status !== 'likely-available') return;

		const updated = new Map(this.results);
		updated.set(domain, { ...existing, status: 'checking' });
		this.results = updated;

		try {
			const resolver = this.getResolver();
			const result = await resolver.verify(domain);
			const next = new Map(this.results);
			const entry = next.get(domain);
			if (entry) {
				next.set(domain, {
					...entry,
					status: result.status,
					records: result.records,
					error: result.error,
					method: result.method,
					checkedAt: Date.now(),
					previousStatus: 'likely-available',
				});
				this.results = next;
			}
		} catch {
			const next = new Map(this.results);
			const entry = next.get(domain);
			if (entry) {
				next.set(domain, { ...entry, status: 'likely-available', error: 'verification failed' });
				this.results = next;
			}
		}
		this.persist();
	}

	/** Flush pending resolver updates into the results map in one batch */
	_flushUpdates() {
		if (_pendingUpdates.length === 0) return;
		const updated = new Map(this.results);
		for (const upd of _pendingUpdates) {
			const existing = updated.get(upd.domain);
			if (existing) {
				updated.set(upd.domain, {
					...existing,
					records: upd.records,
					status: upd.status as DomainResult['status'],
					error: upd.error,
					method: (upd.method as DomainResult['method']) ?? existing.method,
					checkedAt: Date.now(),
				});
			}
		}
		this.results = updated;
		this.progress = { done: _lastProgress, total: this.progress.total };
		_pendingUpdates = [];
		_flushTimer = null;
		this.persist();
	}

	/** Start domain search using active resolver */
	async search() {
		const candidates = this.candidates;
		if (candidates.length === 0) return;

		// Cancel any existing search
		_abortController?.abort();
		_abortController = new AbortController();
		const signal = _abortController.signal;

		// Reset results with 'checking' status
		const nextResults = new Map<string, DomainResult>();
		for (const c of candidates) {
			nextResults.set(c.domain, { ...c, records: [], status: 'checking' });
		}
		this.results = nextResults;
		this.searching = true;
		this.progress = { done: 0, total: candidates.length };
		_pendingUpdates = [];
		_lastProgress = 0;

		try {
			const domains = candidates.map((c) => c.domain);
			const resolver = this.getResolver();
			let done = 0;

			await resolver.check(domains, (result) => {
				done++;
				_pendingUpdates.push({
					domain: result.domain,
					records: result.records,
					status: result.status,
					error: result.error,
					method: result.method,
				});
				_lastProgress = done;
				// Batch flush every 150ms to avoid per-result reactive updates
				if (!_flushTimer) {
					_flushTimer = setTimeout(() => this._flushUpdates(), 150);
				}
			}, signal);

			// Flush any remaining buffered updates
			if (_flushTimer) clearTimeout(_flushTimer);
			this._flushUpdates();
		} catch (err) {
			if (signal.aborted) return; // cancelled intentionally
			console.error('Search error:', err);
		} finally {
			this.searching = false;
			_abortController = null;
			if (_flushTimer) {
				clearTimeout(_flushTimer);
				this._flushUpdates();
			}
			// Always persist final results
			this.persist();
			// Save to search history
			this.saveToHistory();
		}
	}

	/** Cancel current search */
	cancelSearch() {
		_abortController?.abort();
		this.searching = false;
	}

	/** Clear all results */
	clearResults() {
		this.results = new Map();
		this.progress = { done: 0, total: 0 };
		this.persist();
	}

	/** Clear stale results older than N days (default 7) */
	clearStaleResults(daysOld = 7) {
		const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
		const next = new Map(this.results);
		for (const [key, r] of next) {
			if (r.checkedAt && r.checkedAt < cutoff) next.delete(key);
		}
		this.results = next;
		this.persist();
	}

	/** Export available (and likely-available) domains as text */
	exportAvailable(): string {
		return this.filteredResults
			.filter((r) => r.status === 'available' || r.status === 'likely-available')
			.map((r) => r.domain)
			.join('\n');
	}

	/** Deduplicated terms (for UI feedback) */
	get uniqueTermCount(): number {
		return new Set(this.terms).size;
	}

	get hasDuplicateTerms(): boolean {
		return this.terms.length > this.uniqueTermCount;
	}
}

export const app = new AppState();
