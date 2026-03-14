import { generateCandidates } from '../mutations';
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
} from '../types';
import { DEFAULT_TLDS, DEFAULT_MUTATIONS, LIST_COLORS, REGISTRARS } from '../types';

/** Parse terms from user input (comma, newline, or space separated) */
function parseTerms(input: string): string[] {
	return input
		.split(/[,\n\r]+/)
		.map((t) => t.trim().toLowerCase().replace(/[^a-z0-9-]/g, ''))
		.filter((t) => t.length >= 2);
}

/** localStorage key prefix */
const LS = 'digr-';

/**
 * Module-level operational state — kept outside the class to prevent
 * Svelte 5's compiler from wrapping them in reactive getters/setters,
 * which breaks timer callbacks and non-reactive bookkeeping.
 */
let _abortController: AbortController | null = null;
let _pendingUpdates: Array<{ domain: string; records: string[]; status: string; error?: string }> = [];
let _flushTimer: ReturnType<typeof setTimeout> | null = null;
let _lastProgress = 0;
let _persistInputTimer: ReturnType<typeof setTimeout> | null = null;

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
		const defaults: Filters = { status: 'all', tlds: new Set<string>(), mutations: new Set<MutationType>(), lengthMin: 0, lengthMax: 99, search: '', hideErrors: false, registrars: new Set<RegistrarId>() };
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
				search: this.filters.search,
				hideErrors: this.filters.hideErrors,
				registrars: [...this.filters.registrars],
			}));
			// Serialize results Map (skip 'checking' status entries)
			const entries = [...this.results.entries()].filter(([, r]) => r.status !== 'checking');
			localStorage.setItem(LS + 'results', JSON.stringify(entries));
			// Persist saved domains and lists
			localStorage.setItem(LS + 'lists', JSON.stringify(this.lists));
			localStorage.setItem(LS + 'saved', JSON.stringify(this.saved));
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
		return generateCandidates(this.terms, this.selectedMutations, this.selectedTlds);
	}

	/** All results as array, with active filters applied */
	get filteredResults(): DomainResult[] {
		let items = [...this.results.values()];

		// Status filter
		if (this.filters.status === 'available') {
			items = items.filter((r) => r.status === 'available');
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
					const order: Record<string, number> = { available: 0, checking: 1, error: 2, reserved: 3, taken: 4 };
					cmp = order[a.status] - order[b.status] || a.domain.localeCompare(b.domain);
					break;
				}
				case 'length':
					cmp = a.nameLength - b.nameLength || a.domain.localeCompare(b.domain);
					break;
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

	/** Whether any filter is active */
	get hasActiveFilters(): boolean {
		return (
			this.filters.status !== 'all' ||
			this.filters.tlds.size > 0 ||
			this.filters.mutations.size > 0 ||
			this.filters.lengthMin > 0 ||
			this.filters.lengthMax < 99 ||
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

	/** Fetch TLD pricing + registrar TLD support from API */
	async fetchPricing() {
		try {
			const res = await fetch('/api/pricing');
			const data = await res.json() as {
				pricing: Record<string, TldPricing>;
				registrars: Record<string, string[]>;
			};
			if (data.pricing) {
				const map = new Map<string, TldPricing>();
				for (const [tld, p] of Object.entries(data.pricing)) {
					map.set(tld, p);
				}
				this.pricing = map;
			}
			if (data.registrars) {
				const rmap = new Map<RegistrarId, Set<string>>();
				for (const [rid, tlds] of Object.entries(data.registrars)) {
					rmap.set(rid as RegistrarId, new Set(tlds));
				}
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

		// Set to checking state
		const updated = new Map(this.results);
		updated.set(domain, { ...existing, status: 'checking', error: undefined });
		this.results = updated;

		try {
			const res = await fetch('/api/check', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ domains: [domain] }),
			});
			const data = await res.json() as { results: Array<{ domain: string; records: string[]; status: string; error?: string }> };
			if (data.results?.[0]) {
				const r = data.results[0];
				const next = new Map(this.results);
				const entry = next.get(domain);
				if (entry) {
					next.set(domain, {
						...entry,
						records: r.records,
						status: r.status as DomainResult['status'],
						error: r.error,
						checkedAt: Date.now(),
					});
					this.results = next;
				}
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
		const errorDomains = [...this.results.values()]
			.filter((r) => r.status === 'error')
			.map((r) => r.domain);
		if (errorDomains.length === 0) return;

		// Set all to checking
		const updated = new Map(this.results);
		for (const d of errorDomains) {
			const entry = updated.get(d);
			if (entry) updated.set(d, { ...entry, status: 'checking', error: undefined });
		}
		this.results = updated;

		try {
			const res = await fetch('/api/check', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ domains: errorDomains }),
			});
			const data = await res.json() as { results: Array<{ domain: string; records: string[]; status: string; error?: string }> };
			if (data.results) {
				const next = new Map(this.results);
				for (const r of data.results) {
					const entry = next.get(r.domain);
					if (entry) {
						next.set(r.domain, {
							...entry,
							records: r.records,
							status: r.status as DomainResult['status'],
							error: r.error,
							checkedAt: Date.now(),
						});
					}
				}
				this.results = next;
			}
		} catch {
			// Restore error state on fetch failure
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

	/** Toggle theme */
	toggleTheme() {
		this.theme = this.theme === 'dark' ? 'light' : 'dark';
		document.documentElement.setAttribute('data-theme', this.theme);
		localStorage.setItem('digr-theme', this.theme);
	}

	/** Initialize theme from localStorage, fetch pricing, bind visibility persistence */
	initTheme() {
		const saved = localStorage.getItem('digr-theme') as 'dark' | 'light' | null;
		if (saved) {
			this.theme = saved;
			document.documentElement.setAttribute('data-theme', saved);
		}
		// Fetch TLD pricing (non-blocking)
		this.fetchPricing();
		// Persist state when user switches away from app (mobile tab switch, home button)
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'hidden') this.persist();
		});
		// Also persist before unload (desktop tab close / navigate away)
		window.addEventListener('beforeunload', () => this.persist());
	}

	/** Flush pending SSE updates into the results map in one batch */
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

	/** Start domain search using SSE streaming */
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
			const res = await fetch('/api/stream', {
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
							_pendingUpdates.push({
								domain: event.domain,
								records: event.records,
								status: event.status,
								error: event.error,
							});
							_lastProgress = event.progress;
							// Batch flush every 150ms to avoid per-result reactive updates
							if (!_flushTimer) {
								_flushTimer = setTimeout(() => this._flushUpdates(), 150);
							}
						}
					} catch {
						// skip malformed events
					}
				}
			}

			// Flush any remaining buffered updates
			if (_flushTimer) clearTimeout(_flushTimer);
			this._flushUpdates();

			// Process any remaining partial buffer
			if (buffer.startsWith('data: ')) {
				try {
					const event = JSON.parse(buffer.slice(6));
					if (event.type === 'result') {
						const existing = this.results.get(event.domain);
						if (existing) {
							const updated = new Map(this.results);
							updated.set(event.domain, {
								...existing,
								records: event.records,
								status: event.status,
								error: event.error,
								checkedAt: Date.now(),
							});
							this.results = updated;
						}
					}
				} catch {
					// partial event at end of stream — expected
				}
			}
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
		}
	}

	/** Cancel current search */
	cancelSearch() {
		_abortController?.abort();
		this.searching = false;
	}

	/** Export available domains as text */
	exportAvailable(): string {
		return this.filteredResults
			.filter((r) => r.status === 'available')
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
