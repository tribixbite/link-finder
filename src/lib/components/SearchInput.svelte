<script lang="ts">
	import { app } from '$lib/state/app.svelte';
	import { TLDS, POPULAR_TLDS, MUTATION_INFO, TLD_PRESETS } from '$lib/types';
	import type { MutationType } from '$lib/types';
	import SearchHistory from './SearchHistory.svelte';
	import CustomMutationEditor from './CustomMutationEditor.svelte';

	const allMutations = Object.keys(MUTATION_INFO) as MutationType[];

	let showAllTlds = $state(false);
	let tldSearch = $state('');
	let historyOpen = $state(false);

	/** TLDs to display based on search + expand state */
	let visibleTlds = $derived(() => {
		if (tldSearch) {
			const q = tldSearch.toLowerCase();
			return TLDS.filter((t) => t.includes(q));
		}
		return showAllTlds ? TLDS : POPULAR_TLDS;
	});

	/** Count of selected TLDs not currently visible (hidden in collapsed view) */
	let hiddenSelectedCount = $derived(() => {
		if (showAllTlds || tldSearch) return 0;
		let count = 0;
		for (const tld of app.selectedTlds) {
			if (!POPULAR_TLDS.includes(tld)) count++;
		}
		return count;
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			app.search();
		}
	}
</script>

<div class="space-y-4 p-4 rounded-xl" style="background: var(--bg-secondary); border: 1px solid var(--border);">
	<!-- Terms input -->
	<div>
		<label class="block text-sm font-medium mb-1.5" style="color: var(--text-secondary);" for="search-terms">
			Search terms
			<span class="text-xs font-normal" style="color: var(--text-muted);">
				(comma or newline separated)
			</span>
		</label>
		<textarea
			id="search-terms"
			value={app.termsInput}
			oninput={(e) => app.setTermsInput((e.target as HTMLTextAreaElement).value)}
			onkeydown={handleKeydown}
			placeholder="torch&#10;sift&#10;beacon&#10;grep"
			rows="4"
			class="w-full px-3 py-2 rounded-lg text-sm resize-y border-0"
			style="background: var(--bg-tertiary); color: var(--text-primary); font-family: ui-monospace, monospace; outline: none;"
		></textarea>
	</div>

	<!-- TLD selector -->
	<div>
		<div class="flex items-center justify-between mb-1.5">
			<span class="text-sm font-medium" style="color: var(--text-secondary);">
				TLDs
				<span class="text-xs font-normal" style="color: var(--text-muted);">
					({app.selectedTlds.size}/{TLDS.length})
				</span>
			</span>
			<div class="flex gap-1">
				<button
					onclick={() => { app.selectedTlds = new Set(TLDS); app.persist(); }}
					class="text-xs px-2 py-0.5 rounded cursor-pointer border-0"
					style="background: var(--bg-tertiary); color: var(--text-muted);"
				>all</button>
				<button
					onclick={() => { app.selectedTlds = new Set(POPULAR_TLDS); app.persist(); }}
					class="text-xs px-2 py-0.5 rounded cursor-pointer border-0"
					style="background: var(--bg-tertiary); color: var(--text-muted);"
				>popular</button>
				<button
					onclick={() => { app.selectedTlds = new Set(); app.persist(); }}
					class="text-xs px-2 py-0.5 rounded cursor-pointer border-0"
					style="background: var(--bg-tertiary); color: var(--text-muted);"
				>none</button>
			</div>
		</div>

		<!-- TLD presets -->
		<div class="flex gap-1 mb-1.5">
			{#each TLD_PRESETS as preset}
				<button
					onclick={() => { app.selectedTlds = new Set(preset.tlds); app.persist(); }}
					class="text-xs px-2 py-0.5 rounded cursor-pointer border-0"
					style="background: var(--accent-muted); color: var(--accent);"
					title={preset.description}
				>{preset.label}</button>
			{/each}
		</div>

		<!-- TLD search (shown when expanded or 470+ TLDs) -->
		<input
			type="text"
			placeholder="Search TLDs..."
			value={tldSearch}
			oninput={(e) => { tldSearch = (e.target as HTMLInputElement).value; }}
			class="w-full px-2.5 py-1.5 rounded-md text-xs border-0 mb-1.5"
			style="background: var(--bg-tertiary); color: var(--text-primary); outline: none;"
		/>

		<div class="flex flex-wrap gap-1.5" style="max-height: 200px; overflow-y: auto;">
			{#each visibleTlds() as tld}
				<button
					onclick={() => app.toggleTld(tld)}
					class="chip"
					class:active={app.selectedTlds.has(tld)}
				>{tld}</button>
			{/each}
		</div>

		<!-- Expand/collapse toggle -->
		{#if !tldSearch}
			<button
				onclick={() => { showAllTlds = !showAllTlds; }}
				class="text-xs mt-1.5 cursor-pointer border-0 bg-transparent"
				style="color: var(--accent);"
			>
				{#if showAllTlds}
					Show popular only
				{:else}
					Show all {TLDS.length} TLDs{hiddenSelectedCount() > 0 ? ` (${hiddenSelectedCount()} selected hidden)` : ''}
				{/if}
			</button>
		{/if}
	</div>

	<!-- Mutation selector -->
	<div>
		<div class="flex items-center justify-between mb-1.5">
			<span class="text-sm font-medium" style="color: var(--text-secondary);">Mutations</span>
			<div class="flex gap-1">
				<button
					onclick={() => { app.selectedMutations = new Set(allMutations); app.persist(); }}
					class="text-xs px-2 py-0.5 rounded cursor-pointer border-0"
					style="background: var(--bg-tertiary); color: var(--text-muted);"
				>all</button>
				<button
					onclick={() => { app.selectedMutations = new Set(['original']); app.persist(); }}
					class="text-xs px-2 py-0.5 rounded cursor-pointer border-0"
					style="background: var(--bg-tertiary); color: var(--text-muted);"
				>reset</button>
			</div>
		</div>
		<div class="flex flex-wrap gap-1.5">
			{#each allMutations as m}
				<button
					onclick={() => app.toggleMutation(m)}
					class="chip"
					class:active={app.selectedMutations.has(m)}
					title="{MUTATION_INFO[m].description} — {MUTATION_INFO[m].example}"
				>{MUTATION_INFO[m].label}</button>
			{/each}
		</div>
	</div>

	<!-- Search button + candidate count -->
	<div class="flex items-center gap-3">
		{#if app.searching}
			<button
				onclick={() => app.cancelSearch()}
				class="flex-1 px-4 py-2.5 rounded-lg font-medium text-sm cursor-pointer border-0 transition-colors"
				style="background: var(--danger); color: white;"
			>
				Cancel ({app.progress.done}/{app.progress.total})
			</button>
		{:else}
			<button
				onclick={() => app.search()}
				disabled={app.candidates.length === 0}
				class="flex-1 px-4 py-2.5 rounded-lg font-medium text-sm cursor-pointer border-0 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
				style="background: var(--accent); color: #0a0a0a;"
			>
				Dig {app.candidates.length} domain{app.candidates.length !== 1 ? 's' : ''}
			</button>
		{/if}

		<!-- History toggle -->
		{#if app.searchHistory.length > 0}
			<button
				onclick={() => { historyOpen = !historyOpen; }}
				class="w-9 h-9 rounded-lg flex items-center justify-center border-0 cursor-pointer shrink-0"
				style="background: {historyOpen ? 'var(--accent-muted)' : 'var(--bg-tertiary)'}; color: {historyOpen ? 'var(--accent)' : 'var(--text-muted)'};"
				title="Search history ({app.searchHistory.length})"
				aria-label="Search history"
			>&#x1F552;</button>
		{/if}

		{#if app.terms.length > 0}
			<span class="text-xs tabular-nums" style="color: var(--text-muted);">
				{app.terms.length} term{app.terms.length !== 1 ? 's' : ''} &times;
				{app.selectedMutations.size} mut &times;
				{app.selectedTlds.size} tld
			</span>
		{/if}
	</div>

	<!-- Search history dropdown -->
	{#if historyOpen}
		<SearchHistory onclose={() => { historyOpen = false; }} />
	{/if}

	<!-- Custom mutation editor -->
	{#if app.selectedMutations.has('custom')}
		<CustomMutationEditor />
	{/if}

	<!-- Progress bar -->
	{#if app.searching}
		<div class="progress-bar">
			<div
				class="progress-fill"
				style="width: {(app.progress.done / Math.max(1, app.progress.total) * 100).toFixed(1)}%"
			></div>
		</div>
	{/if}
</div>
