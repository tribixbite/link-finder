import { generateCandidates } from '../mutations';
import type {
	DomainCandidate,
	DomainResult,
	MutationType,
	Filters,
	SortField,
	SortDir,
} from '../types';
import { DEFAULT_TLDS, DEFAULT_MUTATIONS } from '../types';

/** Parse terms from user input (comma, newline, or space separated) */
function parseTerms(input: string): string[] {
	return input
		.split(/[,\n\r]+/)
		.map((t) => t.trim().toLowerCase().replace(/[^a-z0-9-]/g, ''))
		.filter((t) => t.length >= 2);
}

class AppState {
	// --- Input state ---
	termsInput = $state('');
	selectedTlds = $state<Set<string>>(new Set(DEFAULT_TLDS));
	selectedMutations = $state<Set<MutationType>>(new Set(DEFAULT_MUTATIONS));

	// --- Results state ---
	results = $state<Map<string, DomainResult>>(new Map());
	searching = $state(false);
	progress = $state({ done: 0, total: 0 });

	// --- Filter state ---
	filters = $state<Filters>({
		status: 'all',
		tlds: new Set<string>(),
		mutations: new Set<MutationType>(),
		lengthMin: 0,
		lengthMax: 99,
		search: '',
	});

	// --- View state ---
	sort = $state<{ field: SortField; dir: SortDir }>({ field: 'status', dir: 'asc' });
	viewMode = $state<'card' | 'table'>('card');
	theme = $state<'dark' | 'light'>('dark');
	sidebarOpen = $state(false);

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
		if (this.filters.status !== 'all') {
			items = items.filter((r) => r.status === this.filters.status);
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
					const order = { available: 0, checking: 1, error: 2, taken: 3 };
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

	/** Count of taken results (unfiltered) */
	get takenCount(): number {
		let count = 0;
		for (const r of this.results.values()) {
			if (r.status === 'taken') count++;
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
			this.filters.search.length > 0
		);
	}

	/** Toggle a TLD for searching */
	toggleTld(tld: string) {
		const next = new Set(this.selectedTlds);
		if (next.has(tld)) next.delete(tld);
		else next.add(tld);
		this.selectedTlds = next;
	}

	/** Toggle a mutation for searching */
	toggleMutation(m: MutationType) {
		const next = new Set(this.selectedMutations);
		if (next.has(m)) next.delete(m);
		else next.add(m);
		this.selectedMutations = next;
	}

	/** Toggle a TLD in the result filters */
	toggleFilterTld(tld: string) {
		const next = new Set(this.filters.tlds);
		if (next.has(tld)) next.delete(tld);
		else next.add(tld);
		this.filters = { ...this.filters, tlds: next };
	}

	/** Toggle a mutation in the result filters */
	toggleFilterMutation(m: MutationType) {
		const next = new Set(this.filters.mutations);
		if (next.has(m)) next.delete(m);
		else next.add(m);
		this.filters = { ...this.filters, mutations: next };
	}

	/** Set status filter */
	setStatusFilter(status: Filters['status']) {
		this.filters = { ...this.filters, status };
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
		};
	}

	/** Toggle sort field (flip direction if same field) */
	setSort(field: SortField) {
		if (this.sort.field === field) {
			this.sort = { field, dir: this.sort.dir === 'asc' ? 'desc' : 'asc' };
		} else {
			this.sort = { field, dir: 'asc' };
		}
	}

	/** Toggle theme */
	toggleTheme() {
		this.theme = this.theme === 'dark' ? 'light' : 'dark';
		document.documentElement.setAttribute('data-theme', this.theme);
		localStorage.setItem('digr-theme', this.theme);
	}

	/** Initialize theme from localStorage */
	initTheme() {
		const saved = localStorage.getItem('digr-theme') as 'dark' | 'light' | null;
		if (saved) {
			this.theme = saved;
			document.documentElement.setAttribute('data-theme', saved);
		}
	}

	/** Abort controller for current search */
	private abortController: AbortController | null = null;

	/** Pending batch of SSE updates, flushed on a timer to reduce reactive churn */
	private pendingUpdates: Array<{ domain: string; records: string[]; status: string; error?: string }> = [];
	private flushTimer: ReturnType<typeof setTimeout> | null = null;
	private lastProgress = 0;

	/** Flush pending SSE updates into the results map in one batch */
	private flushUpdates() {
		if (this.pendingUpdates.length === 0) return;
		const updated = new Map(this.results);
		for (const upd of this.pendingUpdates) {
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
		this.progress = { done: this.lastProgress, total: this.progress.total };
		this.pendingUpdates = [];
		this.flushTimer = null;
	}

	/** Start domain search using SSE streaming */
	async search() {
		const candidates = this.candidates;
		if (candidates.length === 0) return;

		// Cancel any existing search
		this.abortController?.abort();
		this.abortController = new AbortController();
		const signal = this.abortController.signal;

		// Reset results with 'checking' status
		const nextResults = new Map<string, DomainResult>();
		for (const c of candidates) {
			nextResults.set(c.domain, { ...c, records: [], status: 'checking' });
		}
		this.results = nextResults;
		this.searching = true;
		this.progress = { done: 0, total: candidates.length };
		this.pendingUpdates = [];
		this.lastProgress = 0;

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
							this.pendingUpdates.push({
								domain: event.domain,
								records: event.records,
								status: event.status,
								error: event.error,
							});
							this.lastProgress = event.progress;
							// Batch flush every 150ms to avoid per-result reactive updates
							if (!this.flushTimer) {
								this.flushTimer = setTimeout(() => this.flushUpdates(), 150);
							}
						}
					} catch {
						// skip malformed events
					}
				}
			}

			// Flush any remaining buffered updates
			if (this.flushTimer) clearTimeout(this.flushTimer);
			this.flushUpdates();

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
			this.abortController = null;
			if (this.flushTimer) {
				clearTimeout(this.flushTimer);
				this.flushUpdates();
			}
		}
	}

	/** Cancel current search */
	cancelSearch() {
		this.abortController?.abort();
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
