<script lang="ts">
	import { app } from '$lib/state/app.svelte';
	import { MUTATION_INFO, REGISTRARS } from '$lib/types';
</script>

{#if app.hasActiveFilters}
	<div class="flex flex-wrap items-center gap-1.5 px-1">
		{#if app.filters.status !== 'all'}
			<span class="filter-pill">
				{app.filters.status}
				<button onclick={() => app.setStatusFilter('all')}>&times;</button>
			</span>
		{/if}

		{#each [...app.filters.tlds] as tld}
			<span class="filter-pill">
				{tld}
				<button onclick={() => app.toggleFilterTld(tld)}>&times;</button>
			</span>
		{/each}

		{#each [...app.filters.mutations] as m}
			<span class="filter-pill">
				{MUTATION_INFO[m].label}
				<button onclick={() => app.toggleFilterMutation(m)}>&times;</button>
			</span>
		{/each}

		{#if app.filters.lengthMin > 0 || app.filters.lengthMax < 99}
			<span class="filter-pill">
				len: {app.filters.lengthMin}–{app.filters.lengthMax}
				<button onclick={() => { app.filters = { ...app.filters, lengthMin: 0, lengthMax: 99 }; }}>&times;</button>
			</span>
		{/if}

		{#if app.filters.hideErrors}
			<span class="filter-pill">
				hiding errors
				<button onclick={() => { app.setFilter({ hideErrors: false }); }}>&times;</button>
			</span>
		{/if}

		{#each [...app.filters.registrars] as rid}
			<span class="filter-pill">
				{REGISTRARS[rid].name}
				<button onclick={() => app.toggleFilterRegistrar(rid)}>&times;</button>
			</span>
		{/each}

		{#if app.filters.search}
			<span class="filter-pill">
				"{app.filters.search}"
				<button onclick={() => { app.filters = { ...app.filters, search: '' }; }}>&times;</button>
			</span>
		{/if}

		<button
			onclick={() => app.clearFilters()}
			class="text-xs cursor-pointer border-0 bg-transparent"
			style="color: var(--text-muted);"
		>clear all</button>
	</div>
{/if}
