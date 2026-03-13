<script lang="ts">
	import { onMount } from 'svelte';
	import { app } from '$lib/state/app.svelte';
	import Header from '$lib/components/Header.svelte';
	import SearchInput from '$lib/components/SearchInput.svelte';
	import FilterSidebar from '$lib/components/FilterSidebar.svelte';
	import FilterPills from '$lib/components/FilterPills.svelte';
	import ResultToolbar from '$lib/components/ResultToolbar.svelte';
	import DomainCard from '$lib/components/DomainCard.svelte';
	import DomainTable from '$lib/components/DomainTable.svelte';

	const INITIAL_BATCH = 60;
	const LOAD_MORE = 80;

	let visibleCount = $state(INITIAL_BATCH);

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
		visibleCount = INITIAL_BATCH;
	});

	onMount(() => {
		app.initTheme();
	});
</script>

<div class="min-h-dvh flex flex-col" style="background: var(--bg-primary);">
	<Header />

	<main class="flex-1 flex flex-col gap-4 p-4 max-w-6xl mx-auto w-full">
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

					<!-- Load more -->
					{#if hasMore}
						<div class="flex justify-center mt-4">
							<button
								onclick={() => { visibleCount += LOAD_MORE; }}
								class="px-6 py-2 rounded-lg text-sm cursor-pointer border-0 transition-colors"
								style="background: var(--bg-tertiary); color: var(--text-secondary); border: 1px solid var(--border);"
							>
								Show more ({app.filteredResults.length - visibleCount} remaining)
							</button>
						</div>
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
		digr — domain search tool &mdash; dig DNS lookups on Termux
	</footer>
</div>
