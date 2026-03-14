<script lang="ts">
	import { app } from '$lib/state/app.svelte';
	import { formatAge } from '$lib/utils';

	interface Props {
		onclose: () => void;
	}

	let { onclose }: Props = $props();

	function restore(entry: typeof app.searchHistory[0]) {
		app.restoreFromHistory(entry);
		onclose();
	}
</script>

<div class="rounded-lg p-3 space-y-1" style="background: var(--bg-tertiary); border: 1px solid var(--border);">
	<div class="flex items-center justify-between mb-2">
		<span class="text-xs font-medium" style="color: var(--text-secondary);">Recent searches</span>
		<button
			onclick={() => { app.clearHistory(); onclose(); }}
			class="text-xs px-2 py-0.5 rounded border-0 cursor-pointer"
			style="background: transparent; color: var(--text-muted);"
		>Clear all</button>
	</div>

	{#each app.searchHistory as entry (entry.id)}
		<div
			class="flex items-center gap-2 px-2 py-1.5 rounded text-xs cursor-pointer transition-colors"
			style="background: var(--bg-secondary);"
			role="button"
			tabindex="0"
			onclick={() => restore(entry)}
			onkeydown={(e) => { if (e.key === 'Enter') restore(entry); }}
		>
			<div class="flex-1 min-w-0">
				<div class="truncate font-medium" style="color: var(--text-primary); font-family: ui-monospace, monospace;">
					{entry.terms}
				</div>
				<div class="flex items-center gap-1.5 mt-0.5" style="color: var(--text-muted);">
					<span>{entry.tlds.length} TLDs</span>
					<span>&middot;</span>
					<span>{entry.mutations.length} mut</span>
					<span>&middot;</span>
					<span>{entry.resultCount} results</span>
					<span>&middot;</span>
					<span class="tabular-nums">{formatAge(entry.timestamp)}</span>
				</div>
			</div>
			<button
				onclick={(e) => { e.stopPropagation(); app.deleteHistoryEntry(entry.id); }}
				class="w-5 h-5 rounded flex items-center justify-center border-0 cursor-pointer shrink-0"
				style="background: transparent; color: var(--text-muted); font-size: 0.65rem;"
				title="Remove"
			>&times;</button>
		</div>
	{/each}
</div>
