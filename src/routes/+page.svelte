<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { app } from '$lib/state/app.svelte';
	import { encodeSearchParams, decodeSearchParams } from '$lib/utils';
	import type { MutationType } from '$lib/types';
	import Header from '$lib/components/Header.svelte';
	import SearchInput from '$lib/components/SearchInput.svelte';
	import FilterSidebar from '$lib/components/FilterSidebar.svelte';
	import FilterPills from '$lib/components/FilterPills.svelte';
	import ResultToolbar from '$lib/components/ResultToolbar.svelte';
	import DomainCard from '$lib/components/DomainCard.svelte';
	import DomainTable from '$lib/components/DomainTable.svelte';
	import SavedPanel from '$lib/components/SavedPanel.svelte';
	import WhoisPanel from '$lib/components/WhoisPanel.svelte';
	import BulkActionBar from '$lib/components/BulkActionBar.svelte';
	import MonitorPanel from '$lib/components/MonitorPanel.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import HelpModal from '$lib/components/HelpModal.svelte';

	const INITIAL_BATCH = 60;
	const LOAD_MORE = 80;

	let visibleCount = $state(INITIAL_BATCH);
	/** Guards URL sync effect until onMount has finished applying URL params */
	let _urlInitialized = $state(false);

	let visibleResults = $derived(app.filteredResults.slice(0, visibleCount));
	let hasMore = $derived(visibleCount < app.filteredResults.length);

	// Reset visible count when filter criteria change (not on every streamed result)
	$effect(() => {
		// Track filter state changes only
		app.filters.status;
		app.filters.search;
		app.filters.tlds.size;
		app.filters.mutations.size;
		app.filters.lengthMin;
		app.filters.lengthMax;
		app.filters.priceRenewalMin;
		app.filters.priceRenewalMax;
		visibleCount = INITIAL_BATCH;
	});

	// --- Infinite scroll via IntersectionObserver ---
	let sentinelRef = $state<HTMLDivElement | null>(null);
	let observer: IntersectionObserver | null = null;

	$effect(() => {
		if (sentinelRef && hasMore) {
			observer?.disconnect();
			observer = new IntersectionObserver(
				(entries) => {
					if (entries[0]?.isIntersecting) {
						visibleCount += LOAD_MORE;
					}
				},
				{ rootMargin: '200px' }
			);
			observer.observe(sentinelRef);
		} else {
			observer?.disconnect();
		}
	});

	// --- URL state sharing ---
	let urlSyncTimer: ReturnType<typeof setTimeout> | null = null;

	// Reactive URL sync: update URL when search state changes (debounced)
	// Guarded by _urlInitialized to avoid overwriting URL params before onMount processes them
	$effect(() => {
		if (!_urlInitialized) return;
		// Snapshot reactive values upfront so Svelte tracks them
		const terms = app.termsInput || undefined;
		const tlds = app.selectedTlds.size > 0 ? [...app.selectedTlds] : undefined;
		const mutations = app.selectedMutations.size > 0 ? [...app.selectedMutations] : undefined;
		const sort = { field: app.sort.field, dir: app.sort.dir };
		const status = app.filters.status;
		if (urlSyncTimer) clearTimeout(urlSyncTimer);
		urlSyncTimer = setTimeout(() => {
			const search = encodeSearchParams({ terms, tlds, mutations, sort, status });
			const url = new URL(window.location.href);
			const newUrl = `${url.pathname}${search}`;
			if (newUrl !== `${url.pathname}${url.search}`) {
				replaceState(newUrl, {});
			}
		}, 300);
	});

	onMount(() => {
		app.initTheme();

		// Check URL params on mount — override localStorage state if present
		const urlState = decodeSearchParams(window.location.search);
		if (urlState) {
			if (urlState.terms) app.setTermsInput(urlState.terms);
			if (urlState.tlds) app.selectedTlds = new Set(urlState.tlds);
			if (urlState.mutations) app.selectedMutations = new Set(urlState.mutations);
			if (urlState.sort) app.sort = urlState.sort;
			if (urlState.status) app.setStatusFilter(urlState.status);
		}

		// Enable URL sync after a microtask to ensure all URL-derived state has settled
		queueMicrotask(() => { _urlInitialized = true; });
	});

	/** j/k keyboard navigation for domain cards */
	function handleGlobalKeydown(e: KeyboardEvent) {
		// Don't capture when focus is in an input/textarea
		const tag = (e.target as HTMLElement)?.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

		if (e.key === 'j' || e.key === 'k') {
			e.preventDefault();
			const cards = [...document.querySelectorAll('[data-domain-card]')] as HTMLElement[];
			if (cards.length === 0) return;
			const currentIdx = cards.findIndex((el) => el === document.activeElement);
			const nextIdx = e.key === 'j'
				? Math.min(currentIdx + 1, cards.length - 1)
				: Math.max(currentIdx - 1, 0);
			cards[nextIdx]?.focus();
		}
	}

	onDestroy(() => {
		observer?.disconnect();
		if (urlSyncTimer) clearTimeout(urlSyncTimer);
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="min-h-dvh flex flex-col" style="background: var(--bg-primary);" onkeydown={handleGlobalKeydown}>
	<!-- Skip to content link (F9 accessibility) -->
	<a
		href="#main-content"
		class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[200] focus:px-3 focus:py-2 focus:rounded-lg focus:text-sm"
		style="background: var(--accent); color: #0a0a0a;"
	>Skip to content</a>

	<Header />

	<main id="main-content" class="flex-1 flex flex-col gap-4 p-4 max-w-6xl mx-auto w-full">
		<!-- Search input area -->
		<SearchInput />

		<!-- Results section (only shown when we have results) -->
		{#if app.results.size > 0}
			<ResultToolbar />
			<FilterPills />

			<div class="flex gap-4 items-start">
				<!-- Sidebar — desktop: always visible, mobile: toggle -->
				<div
					class="hidden lg:block"
				>
					<div class="sticky top-16">
						<FilterSidebar />
					</div>
				</div>

				<!-- Mobile sidebar overlay -->
				{#if app.sidebarOpen}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="fixed inset-0 z-40 lg:hidden"
						onclick={() => { app.sidebarOpen = false; }}
						onkeydown={(e) => { if (e.key === 'Escape') app.sidebarOpen = false; }}
					>
						<div class="absolute inset-0 bg-black/50"></div>
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="absolute left-0 top-0 bottom-0 w-64 p-3 overflow-y-auto"
							style="background: var(--bg-primary);"
							onclick={(e) => e.stopPropagation()}
							onkeydown={() => {}}
						>
							<FilterSidebar />
						</div>
					</div>
				{/if}

				<!-- Results grid -->
				<div class="flex-1 min-w-0">
					{#if app.viewMode === 'card'}
						<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
							{#each visibleResults as result (result.domain)}
								<DomainCard {result} />
							{/each}
						</div>
					{:else}
						<DomainTable results={visibleResults} />
					{/if}

					<!-- Infinite scroll sentinel -->
					{#if hasMore}
						<div bind:this={sentinelRef} class="h-1" aria-hidden="true"></div>
					{/if}

					<!-- Empty state -->
					{#if app.filteredResults.length === 0 && !app.searching}
						<div class="text-center py-12" style="color: var(--text-muted);">
							{#if app.hasActiveFilters}
								<p class="text-sm">No results match your filters.</p>
								<button
									onclick={() => app.clearFilters()}
									class="text-sm mt-2 cursor-pointer border-0 bg-transparent"
									style="color: var(--accent);"
								>Clear filters</button>
							{:else}
								<p class="text-sm">All domains checked. No results.</p>
							{/if}
						</div>
					{/if}
				</div>
			</div>
		{:else if !app.searching}
			<!-- Empty state before any search -->
			<div class="text-center py-16" style="color: var(--text-muted);">
				<div class="text-4xl mb-4" style="color: var(--accent); opacity: 0.3;">
					&#x1F50D;
				</div>
				<p class="text-sm">Enter search terms, select TLDs and mutations, then hit Dig.</p>
				<p class="text-xs mt-2">Ctrl+Enter to search quickly.</p>
			</div>
		{/if}
	</main>

	<!-- Footer -->
	<footer class="text-center py-3 text-xs" style="color: var(--text-muted); border-top: 1px solid var(--border);">
		findur.link &mdash; bulk domain name search
	</footer>

	<!-- Saved domains panel overlay -->
	{#if app.savedViewOpen}
		<SavedPanel />
	{/if}

	<!-- Whois detail panel -->
	{#if app.whoisPanel.domain}
		<WhoisPanel />
	{/if}

	<!-- Monitor panel -->
	{#if app.monitorPanelOpen}
		<MonitorPanel />
	{/if}

	<!-- Bulk action bar -->
	<BulkActionBar />

	<!-- Toast notifications -->
	<Toast />

	<!-- Tutorial help modal -->
	<HelpModal />
</div>
