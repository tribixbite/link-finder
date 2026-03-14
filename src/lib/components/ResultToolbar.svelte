<script lang="ts">
	import { app } from '$lib/state/app.svelte';

	let copyLabel = $state('Copy avail');
	let copyTimeout: ReturnType<typeof setTimeout> | null = null;

	async function copyAvailable() {
		const text = app.exportAvailable();
		if (!text) return;
		try {
			await navigator.clipboard.writeText(text);
			copyLabel = 'Copied!';
			if (copyTimeout) clearTimeout(copyTimeout);
			copyTimeout = setTimeout(() => { copyLabel = 'Copy avail'; }, 1500);
		} catch {
			copyLabel = 'Failed';
			if (copyTimeout) clearTimeout(copyTimeout);
			copyTimeout = setTimeout(() => { copyLabel = 'Copy avail'; }, 1500);
		}
	}

	function exportCsv() {
		const rows = app.filteredResults.map((r) =>
			[r.domain, r.status, r.tld, r.mutation, r.nameLength, r.term, r.records.join(' ')].join(',')
		);
		const csv = ['domain,status,tld,mutation,length,term,records', ...rows].join('\n');
		const blob = new Blob([csv], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `digr-${new Date().toISOString().slice(0, 10)}.csv`;
		a.click();
		URL.revokeObjectURL(url);
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
		<!-- Recheck stale -->
		{#if app.staleCount > 0}
			<button
				onclick={() => app.recheckStale()}
				class="px-2 py-1 rounded text-xs cursor-pointer border-0 transition-colors"
				style="background: color-mix(in srgb, var(--warning) 15%, var(--bg-tertiary)); color: var(--warning);"
				title="Re-check results older than 24 hours"
			>Recheck stale ({app.staleCount})</button>
		{/if}

		<!-- Copy available -->
		<button
			onclick={copyAvailable}
			disabled={app.availableCount === 0}
			class="px-2 py-1 rounded text-xs cursor-pointer border-0 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
			style="background: {copyLabel === 'Copied!' ? 'color-mix(in srgb, var(--success) 20%, var(--bg-tertiary))' : 'var(--bg-tertiary)'}; color: {copyLabel === 'Copied!' ? 'var(--success)' : 'var(--text-secondary)'};"
			title="Copy available domains to clipboard"
		>{copyLabel}</button>

		<!-- CSV export -->
		<button
			onclick={exportCsv}
			class="px-2 py-1 rounded text-xs cursor-pointer border-0 transition-colors"
			style="background: var(--bg-tertiary); color: var(--text-secondary);"
			title="Download results as CSV"
		>CSV</button>

		<!-- View toggle -->
		<div
			class="flex rounded-md overflow-hidden"
			style="border: 1px solid var(--border);"
		>
			<button
				onclick={() => app.setViewMode('card')}
				class="px-2.5 py-1 text-xs cursor-pointer border-0 transition-colors"
				style="background: {app.viewMode === 'card' ? 'var(--accent-muted)' : 'var(--bg-tertiary)'}; color: {app.viewMode === 'card' ? 'var(--accent)' : 'var(--text-muted)'};"
			>Cards</button>
			<button
				onclick={() => app.setViewMode('table')}
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
