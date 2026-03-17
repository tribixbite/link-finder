<script lang="ts">
	import { app } from '$lib/state/app.svelte';
	import { toasts } from '$lib/state/toasts.svelte';
	import HelpBadge from './HelpBadge.svelte';

	async function copyAvailable() {
		const text = app.exportAvailable();
		if (!text) return;
		try {
			await navigator.clipboard.writeText(text);
			toasts.success('Available domains copied');
		} catch {
			toasts.error('Copy failed');
		}
	}

	function clearResults() {
		if (confirm('Clear all results? This cannot be undone.')) {
			app.clearResults();
			toasts.info('Results cleared');
		}
	}

	function exportCsv() {
		const rows = app.filteredResults.map((r) =>
			[r.domain, r.status, r.tld, r.mutation, r.nameLength, r.term, app.getPrice(r.tld) ?? '', app.getRenewalPrice(r.tld) ?? '', r.records.join(' ')].join(',')
		);
		const csv = ['domain,status,tld,mutation,length,term,reg_price,renewal_price,records', ...rows].join('\n');
		const blob = new Blob([csv], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `findur-${new Date().toISOString().slice(0, 10)}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}
</script>

<div
	class="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg"
	style="background: var(--bg-secondary); border: 1px solid var(--border);"
>
	<div class="flex items-center gap-3" role="status" aria-live="polite">
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

	<div class="flex flex-wrap items-center gap-1.5">
		<!-- Recheck stale -->
		{#if app.staleCount > 0}
			<button
				onclick={() => app.recheckStale()}
				class="px-2 py-1 rounded text-xs cursor-pointer border-0 transition-colors"
				style="background: color-mix(in srgb, var(--warning) 15%, var(--bg-tertiary)); color: var(--warning);"
				title="Re-check results older than 24 hours"
			>Stale ({app.staleCount})</button>
		{/if}
		<HelpBadge topic="verify-button" />

		<!-- Clear results -->
		<button
			onclick={clearResults}
			class="px-2 py-1 rounded text-xs cursor-pointer border-0 transition-colors"
			style="background: color-mix(in srgb, var(--danger) 10%, var(--bg-tertiary)); color: var(--danger);"
			title="Clear all results"
		>Clear</button>

		<!-- Copy available -->
		<button
			onclick={copyAvailable}
			disabled={app.availableCount === 0 && app.likelyAvailableCount === 0}
			class="px-1.5 py-1 rounded text-xs cursor-pointer border-0 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
			style="background: var(--bg-tertiary); color: var(--text-secondary);"
			title="Copy available domains to clipboard"
		>Copy</button>

		<!-- CSV export -->
		<button
			onclick={exportCsv}
			class="px-1.5 py-1 rounded text-xs cursor-pointer border-0 transition-colors"
			style="background: var(--bg-tertiary); color: var(--text-secondary);"
			title="Download results as CSV"
		>CSV</button>

		<!-- View toggle -->
		<div
			class="flex rounded-md overflow-hidden shrink-0"
			style="border: 1px solid var(--border);"
		>
			<button
				onclick={() => app.setViewMode('card')}
				class="px-2 py-1 text-xs cursor-pointer border-0 transition-colors"
				style="background: {app.viewMode === 'card' ? 'var(--accent-muted)' : 'var(--bg-tertiary)'}; color: {app.viewMode === 'card' ? 'var(--accent)' : 'var(--text-muted)'};"
			>Cards</button>
			<button
				onclick={() => app.setViewMode('table')}
				class="px-2 py-1 text-xs cursor-pointer border-0 transition-colors"
				style="background: {app.viewMode === 'table' ? 'var(--accent-muted)' : 'var(--bg-tertiary)'}; color: {app.viewMode === 'table' ? 'var(--accent)' : 'var(--text-muted)'};"
			>Table</button>
		</div>

		<!-- Mobile filter toggle -->
		<button
			onclick={() => { app.sidebarOpen = !app.sidebarOpen; }}
			class="lg:hidden px-2 py-1 rounded text-xs cursor-pointer border-0 shrink-0"
			style="background: var(--bg-tertiary); color: var(--text-secondary);"
		>Filters</button>
	</div>
</div>
