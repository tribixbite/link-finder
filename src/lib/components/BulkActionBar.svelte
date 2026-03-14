<script lang="ts">
	import { app } from '$lib/state/app.svelte';

	let listMenuOpen = $state(false);
</script>

{#if app.selectedDomains.size > 0}
	<div
		class="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-lg"
		style="background: var(--bg-elevated); border: 1px solid var(--border); box-shadow: 0 8px 32px rgba(0,0,0,0.5);"
	>
		<span class="text-sm font-medium tabular-nums" style="color: var(--text-primary);">
			{app.selectedDomains.size} selected
		</span>

		<!-- Save to list -->
		<div class="relative">
			<button
				onclick={() => { listMenuOpen = !listMenuOpen; }}
				class="text-xs px-3 py-1.5 rounded border-0 cursor-pointer"
				style="background: var(--accent-muted); color: var(--accent);"
			>Save to list</button>

			{#if listMenuOpen}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="popover absolute bottom-full mb-1 left-0"
					onclick={(e) => e.stopPropagation()}
					onkeydown={() => {}}
				>
					{#if app.lists.length === 0}
						<div class="px-3 py-2 text-xs" style="color: var(--text-muted);">No lists. Create one in Saved panel.</div>
					{:else}
						{#each app.lists as list}
							<button
								class="popover-item"
								onclick={() => { app.bulkSave(list.id); listMenuOpen = false; }}
							>
								<span class="inline-block w-2.5 h-2.5 rounded-sm" style="background: {list.color};"></span>
								{list.name}
							</button>
						{/each}
					{/if}
				</div>
			{/if}
		</div>

		<!-- Copy -->
		<button
			onclick={() => app.bulkCopy()}
			class="text-xs px-3 py-1.5 rounded border-0 cursor-pointer"
			style="background: var(--bg-tertiary); color: var(--text-secondary);"
		>Copy</button>

		<!-- Deselect -->
		<button
			onclick={() => app.clearSelection()}
			class="text-xs px-3 py-1.5 rounded border-0 cursor-pointer"
			style="background: var(--bg-tertiary); color: var(--text-muted);"
		>Deselect</button>
	</div>
{/if}
