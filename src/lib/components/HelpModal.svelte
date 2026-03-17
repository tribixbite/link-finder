<script lang="ts">
	import { help, HELP_CONTENT } from '$lib/state/help.svelte';

	let entry = $derived(help.activeTopic ? HELP_CONTENT[help.activeTopic] : null);

	function handleBackdrop(e: MouseEvent) {
		if ((e.target as HTMLElement).dataset.helpBackdrop) {
			help.close();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') help.close();
	}
</script>

{#if entry}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-60 flex items-center justify-center p-4"
		data-help-backdrop="true"
		onclick={handleBackdrop}
		onkeydown={handleKeydown}
	>
		<div class="absolute inset-0 bg-black/50"></div>

		<!-- Modal -->
		<div
			class="relative w-full max-w-lg rounded-xl shadow-2xl overflow-hidden"
			style="background: var(--bg-secondary); border: 1px solid var(--border);"
		>
			<!-- Header -->
			<div
				class="flex items-center justify-between px-4 py-3 border-b"
				style="border-color: var(--border); background: var(--bg-tertiary);"
			>
				<h2 class="text-sm font-semibold m-0" style="color: var(--text-primary);">{entry.title}</h2>
				<button
					onclick={() => help.close()}
					class="w-7 h-7 flex items-center justify-center rounded-md border-0 cursor-pointer text-base"
					style="background: transparent; color: var(--text-muted);"
					aria-label="Close"
				>&times;</button>
			</div>

			<!-- Body -->
			<div
				class="px-4 py-3 overflow-y-auto help-body"
				style="max-height: 60dvh;"
			>
				{@html entry.body}
			</div>
		</div>
	</div>
{/if}
