/** Stale threshold: results older than 24 hours are considered stale */
const STALE_MS = 24 * 60 * 60 * 1000;

/** Format a checkedAt timestamp as a human-readable age string */
export function formatAge(checkedAt: number | undefined): string {
	if (!checkedAt) return '';
	const ms = Date.now() - checkedAt;
	if (ms < 60_000) return 'just now';
	if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`;
	if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}h ago`;
	return `${Math.floor(ms / 86400_000)}d ago`;
}

/** Whether a result is stale (older than 24 hours) */
export function isStale(checkedAt: number | undefined): boolean {
	if (!checkedAt) return false;
	return Date.now() - checkedAt > STALE_MS;
}

// --- URL state sharing ---

import type { MutationType, SortField, SortDir } from './types';

export interface URLSearchState {
	terms?: string;
	tlds?: string[];
	mutations?: MutationType[];
	sort?: { field: SortField; dir: SortDir };
	status?: 'all' | 'available' | 'likely-available' | 'taken' | 'reserved';
}

/** Encode current search state into URL search params */
export function encodeSearchParams(state: URLSearchState): string {
	const params = new URLSearchParams();
	if (state.terms) params.set('q', state.terms);
	if (state.tlds?.length) params.set('tlds', state.tlds.join(','));
	if (state.mutations?.length) params.set('mut', state.mutations.join(','));
	if (state.sort) params.set('sort', `${state.sort.field}:${state.sort.dir}`);
	if (state.status && state.status !== 'all') params.set('status', state.status);
	const str = params.toString();
	return str ? `?${str}` : '';
}

/** Decode URL search params into search state */
export function decodeSearchParams(search: string): URLSearchState | null {
	const params = new URLSearchParams(search);
	if (params.size === 0) return null;

	const state: URLSearchState = {};

	const q = params.get('q');
	if (q) state.terms = q;

	const tlds = params.get('tlds');
	if (tlds) state.tlds = tlds.split(',').map((t) => t.startsWith('.') ? t : `.${t}`);

	const mut = params.get('mut');
	if (mut) state.mutations = mut.split(',') as MutationType[];

	const sort = params.get('sort');
	if (sort) {
		const [field, dir] = sort.split(':');
		if (field && dir) state.sort = { field: field as SortField, dir: dir as SortDir };
	}

	const status = params.get('status');
	if (status === 'available' || status === 'likely-available' || status === 'taken' || status === 'reserved') {
		state.status = status;
	}

	return state;
}
