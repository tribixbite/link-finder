<script lang="ts">
	import { app } from '$lib/state/app.svelte';
	import { MUTATION_INFO } from '$lib/types';
	import type { DomainResult, SortField } from '$lib/types';
	import { formatAge, isStale } from '$lib/utils';

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
		{ field: 'price', label: 'Price', class: 'w-16 text-right hidden sm:block' },
	];

	/** Get formatted price for a TLD */
	function getPrice(tld: string): string | null {
		return app.getPrice(tld);
	}

	/** Get pricing tooltip for a TLD (registration + renewal) */
	function getPricingTooltip(tld: string): string {
		const key = tld.startsWith('.') ? tld.slice(1) : tld;
		const entry = app.pricing.get(key);
		if (!entry) return '';
		return `Porkbun: reg $${entry.registration} / renew $${entry.renewal}`;
	}

	/** Per-row copy feedback without per-row state */
	let copiedDomains = $state(new Set<string>());

	async function copyDomain(domain: string) {
		try {
			await navigator.clipboard.writeText(domain);
			copiedDomains = new Set([...copiedDomains, domain]);
			setTimeout(() => {
				const next = new Set(copiedDomains);
				next.delete(domain);
				copiedDomains = next;
			}, 1200);
		} catch { /* clipboard unavailable */ }
	}

	import RegistrarMenu from './RegistrarMenu.svelte';
	import SaveBookmarkButton from './SaveBookmarkButton.svelte';

	const statusColors: Record<string, string> = {
		available: 'var(--available)',
		'likely-available': 'var(--warning)',
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
		<!-- Select all checkbox -->
		<input
			type="checkbox"
			checked={app.selectedDomains.size > 0}
			onclick={() => app.toggleSelectAll()}
			class="w-3.5 h-3.5 shrink-0 cursor-pointer accent-[var(--accent)]"
			aria-label="Select all"
		/>
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
		<div class="w-14 text-right hidden sm:block" style="color: var(--text-muted);">Age</div>
		<div class="w-7"></div>
	</div>

	<!-- Table rows -->
	{#each results as result (result.domain)}
		<div
			class="flex items-center gap-2 px-3 py-2 text-xs transition-colors"
			style="background: var(--bg-secondary); border-top: 1px solid {app.selectedDomains.has(result.domain) ? 'var(--accent)' : 'var(--border)'};"
		>
			<!-- Selection checkbox -->
			<input
				type="checkbox"
				checked={app.selectedDomains.has(result.domain)}
				onclick={() => app.toggleSelect(result.domain)}
				class="w-3.5 h-3.5 shrink-0 cursor-pointer accent-[var(--accent)]"
				aria-label="Select {result.domain}"
			/>
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
				<button
					onclick={() => copyDomain(result.domain)}
					class="inline-flex items-center justify-center w-4 h-4 rounded border-0 cursor-pointer shrink-0"
					style="background: transparent; color: {copiedDomains.has(result.domain) ? 'var(--success)' : 'var(--text-muted)'}; font-size: 0.6rem; padding: 0;"
					title="Copy domain"
				>{copiedDomains.has(result.domain) ? '\u2713' : '\u2398'}</button>
				{#if result.status === 'available' || result.status === 'likely-available'}
					{#if result.status === 'likely-available'}
						<button
							onclick={() => app.verifyDomain(result.domain)}
							class="text-xs px-1 py-0 rounded border-0 cursor-pointer shrink-0"
							style="background: var(--accent-muted); color: var(--accent); font-size: 0.6rem;"
							title="Verify availability via RDAP"
						>verify</button>
					{/if}
					<RegistrarMenu domain={result.domain} />
				{:else if result.status === 'taken' || result.status === 'reserved' || result.status === 'likely-available'}
					<button
						onclick={() => app.openWhois(result.domain)}
						class="text-xs px-1 py-0 rounded border-0 cursor-pointer shrink-0"
						style="background: transparent; color: var(--text-muted); font-size: 0.6rem;"
						title="Whois lookup"
					>WH</button>
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
			<div class="w-16" style="color: var(--text-muted);">
				{result.tld}
				{#if result.previousStatus && result.previousStatus !== result.status}
					<span class="text-xs" style="color: var(--warning); font-size: 0.6rem;" title="Previously {result.previousStatus}">was {result.previousStatus}</span>
				{/if}
			</div>

			<!-- Mutation -->
			<div class="w-24 hidden sm:block" style="color: var(--text-muted);">{MUTATION_INFO[result.mutation].label}</div>

			<!-- Length -->
			<div class="w-12 text-right tabular-nums" style="color: var(--text-muted);">{result.nameLength}</div>

			<!-- Price -->
			<div class="w-16 text-right tabular-nums hidden sm:block" style="color: var(--success); font-size: 0.7rem;" title={getPricingTooltip(result.tld)}>
				{#if getPrice(result.tld)}
					${getPrice(result.tld)}
				{/if}
			</div>

			<!-- Age -->
			<div class="w-14 text-right tabular-nums hidden sm:block" style="color: {isStale(result.checkedAt) ? 'var(--warning)' : 'var(--text-muted)'}; font-size: 0.65rem;">
				{formatAge(result.checkedAt)}
			</div>

			<!-- Save -->
			<div class="w-7">
				<SaveBookmarkButton {result} />
			</div>
		</div>
	{/each}
</div>
