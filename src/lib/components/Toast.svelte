<script lang="ts">
	import { toasts } from '$lib/state/toasts.svelte';

	const typeColors: Record<string, { bg: string; text: string }> = {
		success: { bg: 'color-mix(in srgb, var(--success) 15%, var(--bg-elevated))', text: 'var(--success)' },
		error: { bg: 'color-mix(in srgb, var(--danger) 15%, var(--bg-elevated))', text: 'var(--danger)' },
		info: { bg: 'color-mix(in srgb, var(--accent) 15%, var(--bg-elevated))', text: 'var(--accent)' },
	};
</script>

{#if toasts.items.length > 0}
	<div
		class="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-xs"
		aria-live="polite"
		aria-atomic="false"
	>
		{#each toasts.items as toast (toast.id)}
			{@const colors = typeColors[toast.type] ?? typeColors.info}
			<div
				class="flex items-center gap-2 px-3 py-2 rounded-lg text-xs shadow-lg"
				style="background: {colors.bg}; color: {colors.text}; border: 1px solid {colors.text}33;"
				role="status"
			>
				<span class="flex-1">{toast.message}</span>
				<button
					onclick={() => toasts.remove(toast.id)}
					class="w-5 h-5 rounded flex items-center justify-center border-0 cursor-pointer shrink-0"
					style="background: transparent; color: {colors.text}; font-size: 0.7rem;"
					aria-label="Dismiss"
				>&times;</button>
			</div>
		{/each}
	</div>
{/if}
