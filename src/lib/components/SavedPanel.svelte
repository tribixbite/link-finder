<script lang="ts">
	import { app } from '$lib/state/app.svelte';

	let editingListId = $state<string | null>(null);
	let editName = $state('');
	let newListName = $state('');

	let filteredSaved = $derived(app.getSavedDomains(app.savedFilterListId));

	function startRename(id: string, currentName: string) {
		editingListId = id;
		editName = currentName;
	}

	function finishRename(id: string) {
		const name = editName.trim();
		if (name) app.renameList(id, name);
		editingListId = null;
	}

	function createList() {
		const name = newListName.trim();
		if (!name) return;
		app.createList(name);
		newListName = '';
	}

	function formatDate(ts: number): string {
		return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}
</script>

<!-- Backdrop -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="fixed inset-0 z-50"
	onclick={() => { app.savedViewOpen = false; }}
	onkeydown={(e) => { if (e.key === 'Escape') app.savedViewOpen = false; }}
>
	<div class="absolute inset-0 bg-black/50"></div>

	<!-- Panel from right -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="absolute right-0 top-0 bottom-0 w-80 max-w-full flex flex-col overflow-hidden"
		style="background: var(--bg-primary); border-left: 1px solid var(--border);"
		onclick={(e) => e.stopPropagation()}
		onkeydown={() => {}}
	>
		<!-- Panel header -->
		<div class="flex items-center justify-between p-4" style="border-bottom: 1px solid var(--border);">
			<h2 class="text-sm font-semibold m-0" style="color: var(--text-primary);">Saved Domains</h2>
			<button
				onclick={() => { app.savedViewOpen = false; }}
				class="w-7 h-7 rounded flex items-center justify-center border-0 cursor-pointer"
				style="background: var(--bg-tertiary); color: var(--text-muted);"
				aria-label="Close"
			>&times;</button>
		</div>

		<!-- Lists section -->
		<div class="p-3 flex flex-col gap-1" style="border-bottom: 1px solid var(--border);">
			<!-- "All" filter -->
			<button
				class="popover-item rounded"
				style="background: {app.savedFilterListId === null ? 'var(--accent-muted)' : 'transparent'};"
				onclick={() => { app.savedFilterListId = null; }}
			>
				<span class="flex-1 text-left">All saved</span>
				<span class="text-xs tabular-nums" style="color: var(--text-muted);">{app.saved.length}</span>
			</button>

			{#each app.lists as list}
				<div class="flex items-center gap-1">
					{#if editingListId === list.id}
						<form class="flex-1 flex gap-1" onsubmit={(e) => { e.preventDefault(); finishRename(list.id); }}>
							<input
								bind:value={editName}
								class="flex-1 text-xs px-2 py-1 rounded border-0"
								style="background: var(--bg-tertiary); color: var(--text-primary); outline: none;"
								onblur={() => finishRename(list.id)}
							/>
						</form>
					{:else}
						<button
							class="popover-item rounded flex-1"
							style="background: {app.savedFilterListId === list.id ? 'var(--accent-muted)' : 'transparent'};"
							onclick={() => { app.savedFilterListId = list.id; }}
						>
							<span
								class="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
								style="background: {list.color};"
							></span>
							<span class="flex-1 text-left truncate">{list.name}</span>
							<span class="text-xs tabular-nums" style="color: var(--text-muted);">{app.getListCount(list.id)}</span>
						</button>
						<button
							class="w-6 h-6 rounded flex items-center justify-center border-0 cursor-pointer shrink-0"
							style="background: transparent; color: var(--text-muted); font-size: 0.65rem;"
							title="Rename"
							onclick={() => startRename(list.id, list.name)}
						>&#x270E;</button>
						<button
							class="w-6 h-6 rounded flex items-center justify-center border-0 cursor-pointer shrink-0"
							style="background: transparent; color: var(--danger); font-size: 0.7rem;"
							title="Delete list"
							onclick={() => app.deleteList(list.id)}
						>&times;</button>
					{/if}
				</div>
			{/each}

			<!-- New list input -->
			<form class="flex gap-1 mt-1" onsubmit={(e) => { e.preventDefault(); createList(); }}>
				<input
					bind:value={newListName}
					placeholder="New list..."
					class="flex-1 text-xs px-2 py-1.5 rounded border-0"
					style="background: var(--bg-tertiary); color: var(--text-primary); outline: none;"
				/>
				<button
					type="submit"
					class="text-xs px-3 py-1.5 rounded border-0 cursor-pointer"
					style="background: var(--accent-muted); color: var(--accent);"
					disabled={!newListName.trim()}
				>+</button>
			</form>
		</div>

		<!-- Saved domains list -->
		<div class="flex-1 overflow-y-auto p-3">
			{#if filteredSaved.length === 0}
				<div class="text-center py-8 text-xs" style="color: var(--text-muted);">
					{#if app.lists.length === 0}
						Create a list and star domains to save them.
					{:else}
						No domains saved{app.savedFilterListId ? ' in this list' : ''}.
					{/if}
				</div>
			{:else}
				<div class="flex flex-col gap-1">
					{#each filteredSaved as sd}
						{@const list = app.lists.find((l) => l.id === sd.listId)}
						<div
							class="flex items-center gap-2 px-2 py-1.5 rounded text-xs"
							style="background: var(--bg-secondary);"
						>
							{#if list}
								<span
									class="inline-block w-2 h-2 rounded-sm shrink-0"
									style="background: {list.color};"
									title={list.name}
								></span>
							{/if}
							<span class="flex-1 truncate" style="font-family: ui-monospace, monospace; color: var(--text-primary);">{sd.domain}</span>
							<span class="tabular-nums shrink-0" style="color: var(--text-muted);">{formatDate(sd.addedAt)}</span>
							<button
								class="w-5 h-5 rounded flex items-center justify-center border-0 cursor-pointer shrink-0"
								style="background: transparent; color: var(--danger); font-size: 0.65rem;"
								title="Remove"
								onclick={() => app.unsaveDomain(sd.domain, sd.listId)}
							>&times;</button>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>
