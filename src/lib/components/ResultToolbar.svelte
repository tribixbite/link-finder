<script lang="ts">
	import { app } from '$lib/state/app.svelte';

	function copyAvailable() {
		const text = app.exportAvailable();
		if (text) navigator.clipboard.writeText(text);
	}
</script>

<div
	class="flex items-center justify-between px-3 py-2 rounded-lg"
	style="background: var(--bg-secondary); border: 1px solid var(--border);"
>
	<div class="flex items-center gap-3">
		<span class="text-sm font-medium tabular-nums" style="color: var(--text-primary);">
			{app.filteredResults.length}
			<span style="color: var(--text-muted);">result{app.filteredResults.length !== 1 ? 's' : ''}</span>
		</span>

		{#if app.hasActiveFilters}
			<span class="text-xs" style="color: var(--text-muted);">
				(of {app.results.size})
			</span>
		{/if}
	</div>

	<div class="flex items-center gap-2">
		<!-- Copy available -->
		{#if app.availableCount > 0}
			<button
				onclick={copyAvailable}
				class="px-2 py-1 rounded text-xs cursor-pointer border-0 transition-colors"
				style="background: var(--bg-tertiary); color: var(--text-secondary);"
				title="Copy available domains to clipboard"
			>Copy avail</button>
		{/if}

		<!-- View toggle -->
		<div
			class="flex rounded-md overflow-hidden"
			style="border: 1px solid var(--border);"
		>
			<button
				onclick={() => { app.viewMode = 'card'; }}
				class="px-2.5 py-1 text-xs cursor-pointer border-0 transition-colors"
				style="background: {app.viewMode === 'card' ? 'var(--accent-muted)' : 'var(--bg-tertiary)'}; color: {app.viewMode === 'card' ? 'var(--accent)' : 'var(--text-muted)'};"
			>Cards</button>
			<button
				onclick={() => { app.viewMode = 'table'; }}
				class="px-2.5 py-1 text-xs cursor-pointer border-0 transition-colors"
				style="background: {app.viewMode === 'table' ? 'var(--accent-muted)' : 'var(--bg-tertiary)'}; color: {app.viewMode === 'table' ? 'var(--accent)' : 'var(--text-muted)'};"
			>Table</button>
		</div>

		<!-- Mobile filter toggle -->
		<button
			onclick={() => { app.sidebarOpen = !app.sidebarOpen; }}
			class="lg:hidden px-2.5 py-1 rounded text-xs cursor-pointer border-0"
			style="background: var(--bg-tertiary); color: var(--text-secondary);"
		>Filters</button>
	</div>
</div>
