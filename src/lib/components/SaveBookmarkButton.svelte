<script lang="ts">
	import { app } from '$lib/state/app.svelte';
	import type { DomainResult } from '$lib/types';

	interface Props {
		result: DomainResult;
	}

	let { result }: Props = $props();
	let open = $state(false);
	let newListName = $state('');
	let menuRef = $state<HTMLDivElement | null>(null);

	let isSaved = $derived(app.isDomainSaved(result.domain));
	let savedListIds = $derived(app.getListsForDomain(result.domain));

	function handleClickOutside(e: MouseEvent) {
		if (menuRef && !menuRef.contains(e.target as Node)) {
			open = false;
		}
	}

	$effect(() => {
		if (open) {
			document.addEventListener('click', handleClickOutside, true);
			return () => document.removeEventListener('click', handleClickOutside, true);
		}
	});

	function toggleList(listId: string) {
		if (savedListIds.includes(listId)) {
			app.unsaveDomain(result.domain, listId);
		} else {
			app.saveDomain(result.domain, listId, result.status === 'checking' ? 'available' : result.status as any);
		}
	}

	function createAndSave() {
		const name = newListName.trim();
		if (!name) return;
		const list = app.createList(name);
		app.saveDomain(result.domain, list.id, result.status === 'checking' ? 'available' : result.status as any);
		newListName = '';
	}
</script>

<div class="relative inline-flex" bind:this={menuRef}>
	<button
		onclick={(e) => { e.stopPropagation(); open = !open; }}
		class="inline-flex items-center justify-center w-6 h-6 rounded border-0 cursor-pointer transition-colors"
		style="background: transparent; color: {isSaved ? 'var(--warning)' : 'var(--text-muted)'};"
		title={isSaved ? 'Saved' : 'Save to list'}
		aria-label="Save domain"
	>
		<!-- Star icon -->
		{#if isSaved}
			<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1">
				<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
			</svg>
		{:else}
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
			</svg>
		{/if}
	</button>

	{#if open}
		<div class="popover" style="right: 0; top: 100%; margin-top: 4px; min-width: 180px;">
			{#if app.lists.length === 0}
				<div class="px-3 py-2 text-xs" style="color: var(--text-muted);">No lists yet</div>
			{:else}
				{#each app.lists as list}
					<button
						class="popover-item"
						onclick={() => toggleList(list.id)}
					>
						<span
							class="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
							style="background: {list.color};"
						></span>
						<span class="flex-1 text-left truncate">{list.name}</span>
						{#if savedListIds.includes(list.id)}
							<span style="color: var(--accent);">&#x2713;</span>
						{/if}
					</button>
				{/each}
			{/if}
			<!-- New list inline input -->
			<div style="border-top: 1px solid var(--border); padding: 6px 8px;">
				<form class="flex gap-1" onsubmit={(e) => { e.preventDefault(); createAndSave(); }}>
					<input
						bind:value={newListName}
						placeholder="New list..."
						class="flex-1 text-xs px-2 py-1 rounded border-0"
						style="background: var(--bg-tertiary); color: var(--text-primary); outline: none; min-width: 0;"
					/>
					<button
						type="submit"
						class="text-xs px-2 py-1 rounded border-0 cursor-pointer"
						style="background: var(--accent-muted); color: var(--accent);"
						disabled={!newListName.trim()}
					>+</button>
				</form>
			</div>
		</div>
	{/if}
</div>
