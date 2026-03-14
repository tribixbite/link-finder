<script lang="ts">
	import { app } from '$lib/state/app.svelte';
	import { MUTATION_INFO } from '$lib/types';
	import type { DomainResult, SortField } from '$lib/types';

	interface Props {
		results: DomainResult[];
	}

	let { results }: Props = $props();

	const columns: { field: SortField; label: string; class: string }[] = [
		{ field: 'status', label: 'St', class: 'w-10 text-center' },
		{ field: 'domain', label: 'Domain', class: 'flex-1 min-w-[140px]' },
		{ field: 'tld', label: 'TLD', class: 'w-16' },
		{ field: 'mutation', label: 'Mutation', class: 'w-24 hidden sm:block' },
		{ field: 'length', label: 'Len', class: 'w-12 text-right' },
	];

	/** Get formatted price for a TLD */
	function getPrice(tld: string): string | null {
		return app.getPrice(tld);
	}

	import RegistrarMenu from './RegistrarMenu.svelte';
	import SaveBookmarkButton from './SaveBookmarkButton.svelte';

	const statusColors: Record<string, string> = {
		available: 'var(--available)',
		taken: 'var(--taken)',
		reserved: 'var(--warning)',
		checking: 'var(--accent)',
		error: 'var(--warning)',
	};
</script>

<div class="rounded-lg overflow-hidden" style="border: 1px solid var(--border);">
	<!-- Table header -->
	<div
		class="flex items-center gap-2 px-3 py-2 text-xs font-medium sticky top-0"
		style="background: var(--bg-tertiary); color: var(--text-muted); z-index: 1;"
	>
		{#each columns as col}
			<button
				onclick={() => app.setSort(col.field)}
				class="border-0 bg-transparent cursor-pointer p-0 text-left {col.class}"
				style="color: {app.sort.field === col.field ? 'var(--accent)' : 'var(--text-muted)'}; font-size: inherit;"
			>
				{col.label}
				{#if app.sort.field === col.field}
					<span>{app.sort.dir === 'asc' ? '\u25B2' : '\u25BC'}</span>
				{/if}
			</button>
		{/each}
		<div class="w-16 text-right hidden sm:block" style="color: var(--text-muted);">Price</div>
		<div class="w-7"></div>
	</div>

	<!-- Table rows -->
	{#each results as result (result.domain)}
		<div
			class="flex items-center gap-2 px-3 py-2 text-xs transition-colors"
			style="background: var(--bg-secondary); border-top: 1px solid var(--border);"
		>
			<!-- Status dot -->
			<div class="w-10 text-center">
				<span
					class="inline-block w-2.5 h-2.5 rounded-full"
					class:checking-pulse={result.status === 'checking'}
					style="background: {statusColors[result.status]};"
					title={result.status}
				></span>
			</div>

			<!-- Domain -->
			<div class="flex-1 min-w-[140px] flex items-center gap-1.5" style="font-family: ui-monospace, monospace;" title={result.domain}>
				<span class="truncate">
					<span style="color: var(--text-primary);">{result.name}</span><span style="color: var(--text-muted);">{result.tld}</span>
				</span>
				{#if result.status === 'available'}
					<RegistrarMenu domain={result.domain} />
				{:else if result.status === 'error'}
					<button
						onclick={() => app.recheckDomain(result.domain)}
						class="text-xs px-1.5 py-0 rounded border-0 cursor-pointer shrink-0"
						style="background: var(--accent-muted); color: var(--accent); font-size: 0.65rem;"
						title={result.error || 'retry'}
					>retry</button>
				{/if}
			</div>

			<!-- TLD -->
			<div class="w-16" style="color: var(--text-muted);">{result.tld}</div>

			<!-- Mutation -->
			<div class="w-24 hidden sm:block" style="color: var(--text-muted);">{MUTATION_INFO[result.mutation].label}</div>

			<!-- Length -->
			<div class="w-12 text-right tabular-nums" style="color: var(--text-muted);">{result.nameLength}</div>

			<!-- Price -->
			<div class="w-16 text-right tabular-nums hidden sm:block" style="color: var(--success); font-size: 0.7rem;">
				{#if getPrice(result.tld)}
					${getPrice(result.tld)}
				{/if}
			</div>

			<!-- Save -->
			<div class="w-7">
				<SaveBookmarkButton {result} />
			</div>
		</div>
	{/each}
</div>
