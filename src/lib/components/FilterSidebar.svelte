<script lang="ts">
	import { app } from '$lib/state/app.svelte';
	import { MUTATION_INFO, REGISTRARS, REGISTRAR_IDS } from '$lib/types';
	import type { MutationType } from '$lib/types';
	import SettingsPanel from './SettingsPanel.svelte';

	/** Controls visibility of the collapsible settings section */
	let showSettings = $state(false);

	/** Unique TLDs in current results */
	let resultTlds = $derived(() => {
		const tlds = new Set<string>();
		for (const r of app.results.values()) tlds.add(r.tld);
		return [...tlds].sort();
	});

	/** Unique mutations in current results */
	let resultMutations = $derived(() => {
		const muts = new Set<MutationType>();
		for (const r of app.results.values()) muts.add(r.mutation);
		return [...muts];
	});
</script>

<aside
	class="w-full lg:w-56 shrink-0 space-y-4 p-3 rounded-xl overflow-y-auto"
	style="background: var(--bg-secondary); border: 1px solid var(--border); max-height: calc(100dvh - 200px);"
>
	<!-- Result search -->
	<div>
		<label class="block text-xs font-medium mb-1" style="color: var(--text-muted);" for="filter-search">Filter results</label>
		<input
			id="filter-search"
			type="text"
			placeholder="Search domains..."
			value={app.filters.search}
			oninput={(e) => app.setFilter({ search: (e.target as HTMLInputElement).value })}
			class="w-full px-2.5 py-1.5 rounded-md text-xs border-0"
			style="background: var(--bg-tertiary); color: var(--text-primary); outline: none;"
		/>
	</div>

	<!-- Status filter -->
	<div>
		<span class="block text-xs font-medium mb-1.5" style="color: var(--text-muted);">Status</span>
		<div class="space-y-1">
			{#each [
				{ value: 'all', label: 'All', count: app.results.size },
				{ value: 'available', label: 'Available', count: app.availableCount },
				...(app.likelyAvailableCount > 0 ? [{ value: 'likely-available', label: 'Likely avail.', count: app.likelyAvailableCount }] : []),
				{ value: 'taken', label: 'Taken', count: app.takenCount },
				...(app.reservedCount > 0 ? [{ value: 'reserved', label: 'Reserved', count: app.reservedCount }] : []),
			] as opt}
				<button
					onclick={() => app.setStatusFilter(opt.value as 'all' | 'available' | 'likely-available' | 'taken' | 'reserved')}
					class="flex items-center justify-between w-full px-2 py-1 rounded text-xs cursor-pointer border-0 transition-colors"
					style="background: {app.filters.status === opt.value ? 'var(--accent-muted)' : 'transparent'}; color: {app.filters.status === opt.value ? 'var(--accent)' : 'var(--text-secondary)'};"
				>
					<span>{opt.label}</span>
					<span class="tabular-nums" style="color: var(--text-muted);">{opt.count}</span>
				</button>
			{/each}

			<!-- Unverified row: available domains with whois failures -->
			{#if app.unverifiedCount > 0}
				<div class="flex items-center justify-between px-2 py-1 rounded text-xs" style="color: var(--warning);">
					<span>Unverified</span>
					<div class="flex items-center gap-1.5">
						<span class="tabular-nums" style="color: var(--text-muted);">{app.unverifiedCount}</span>
						<button
							onclick={() => app.recheckUnverified()}
							class="text-xs px-1.5 py-0.5 rounded border-0 cursor-pointer"
							style="background: var(--accent-muted); color: var(--accent);"
							title="Re-verify all domains where whois failed"
						>verify all</button>
					</div>
				</div>
			{/if}

			<!-- Error row: hide toggle + retry all -->
			{#if app.errorCount > 0}
				<div class="flex items-center justify-between px-2 py-1 rounded text-xs" style="color: var(--warning);">
					<label class="flex items-center gap-1.5 cursor-pointer">
						<input
							type="checkbox"
							checked={app.filters.hideErrors}
							onchange={() => app.setFilter({ hideErrors: !app.filters.hideErrors })}
							class="accent-current"
						/>
						Hide errors
					</label>
					<div class="flex items-center gap-1.5">
						<span class="tabular-nums" style="color: var(--text-muted);">{app.errorCount}</span>
						<button
							onclick={() => app.recheckAllErrors()}
							class="text-xs px-1.5 py-0.5 rounded border-0 cursor-pointer"
							style="background: var(--accent-muted); color: var(--accent);"
							title="Retry all errored domains"
						>retry all</button>
					</div>
				</div>
			{/if}
		</div>
	</div>

	<!-- TLD filter -->
	{#if resultTlds().length > 0}
		<div>
			<span class="block text-xs font-medium mb-1.5" style="color: var(--text-muted);">TLD</span>
			<div class="flex flex-wrap gap-1">
				{#each resultTlds() as tld}
					<button
						onclick={() => app.toggleFilterTld(tld)}
						class="chip text-xs"
						class:active={app.filters.tlds.has(tld)}
						style="padding: 2px 6px; font-size: 0.7rem;"
					>{tld}</button>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Mutation filter -->
	{#if resultMutations().length > 0}
		<div>
			<span class="block text-xs font-medium mb-1.5" style="color: var(--text-muted);">Mutation</span>
			<div class="flex flex-wrap gap-1">
				{#each resultMutations() as m}
					<button
						onclick={() => app.toggleFilterMutation(m)}
						class="chip text-xs"
						class:active={app.filters.mutations.has(m)}
						style="padding: 2px 6px; font-size: 0.7rem;"
					>{MUTATION_INFO[m].label}</button>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Registrar filter -->
	{#if app.registrarTlds.size > 0}
		<div>
			<span class="block text-xs font-medium mb-1.5" style="color: var(--text-muted);">Registrar</span>
			<div class="flex flex-wrap gap-1">
				{#each REGISTRAR_IDS as rid}
					{@const reg = REGISTRARS[rid]}
					<button
						onclick={() => app.toggleFilterRegistrar(rid)}
						class="chip text-xs"
						class:active={app.filters.registrars.has(rid)}
						style="padding: 2px 6px; font-size: 0.7rem;"
					>
						<span
							class="inline-block w-2 h-2 rounded-full"
							style="background: {reg.color};"
						></span>
						{reg.name}
					</button>
				{/each}
			</div>
			{#if app.filters.registrars.size > 1}
				<span class="text-xs mt-1 block" style="color: var(--text-muted);">
					Showing TLDs sold by all selected
				</span>
			{/if}
		</div>
	{/if}

	<!-- Length filter -->
	<div>
		<span class="block text-xs font-medium mb-1.5" style="color: var(--text-muted);">Name length</span>
		<div class="flex items-center gap-2">
			<input
				type="number"
				min="0"
				max="99"
				value={app.filters.lengthMin}
				oninput={(e) => app.setFilter({ lengthMin: parseInt((e.target as HTMLInputElement).value) || 0 })}
				class="w-14 px-2 py-1 rounded text-xs text-center border-0"
				style="background: var(--bg-tertiary); color: var(--text-primary); outline: none;"
			/>
			<span class="text-xs" style="color: var(--text-muted);">to</span>
			<input
				type="number"
				min="0"
				max="99"
				value={app.filters.lengthMax}
				oninput={(e) => app.setFilter({ lengthMax: parseInt((e.target as HTMLInputElement).value) || 99 })}
				class="w-14 px-2 py-1 rounded text-xs text-center border-0"
				style="background: var(--bg-tertiary); color: var(--text-primary); outline: none;"
			/>
		</div>
	</div>

	<!-- Renewal price filter -->
	{#if app.pricing.size > 0}
		<div>
			<span class="block text-xs font-medium mb-1.5" style="color: var(--text-muted);">Renewal price ($/yr)</span>
			<div class="flex items-center gap-2">
				<input
					type="number"
					min="0"
					max="9999"
					step="0.01"
					value={app.filters.priceRenewalMin}
					oninput={(e) => app.setFilter({ priceRenewalMin: parseFloat((e.target as HTMLInputElement).value) || 0 })}
					class="w-14 px-2 py-1 rounded text-xs text-center border-0"
					style="background: var(--bg-tertiary); color: var(--text-primary); outline: none;"
				/>
				<span class="text-xs" style="color: var(--text-muted);">to</span>
				<input
					type="number"
					min="0"
					max="9999"
					step="0.01"
					value={app.filters.priceRenewalMax}
					oninput={(e) => app.setFilter({ priceRenewalMax: parseFloat((e.target as HTMLInputElement).value) || 9999 })}
					class="w-14 px-2 py-1 rounded text-xs text-center border-0"
					style="background: var(--bg-tertiary); color: var(--text-primary); outline: none;"
				/>
			</div>
		</div>
	{/if}

	<!-- Clear filters -->
	{#if app.hasActiveFilters}
		<button
			onclick={() => app.clearFilters()}
			class="w-full px-3 py-1.5 rounded-md text-xs cursor-pointer border-0 transition-colors"
			style="background: var(--bg-tertiary); color: var(--danger);"
		>
			Clear all filters
		</button>
	{/if}

	<!-- Settings (collapsible) -->
	<div class="border-t" style="border-color: var(--border); padding-top: 0.5rem;">
		<button
			onclick={() => showSettings = !showSettings}
			class="flex items-center justify-between w-full px-2 py-1 rounded text-xs cursor-pointer border-0"
			style="background: transparent; color: var(--text-muted);"
		>
			<span>Settings</span>
			<span>{showSettings ? '▾' : '▸'}</span>
		</button>
		{#if showSettings}
			<div class="mt-1.5">
				<SettingsPanel />
			</div>
		{/if}
	</div>
</aside>
