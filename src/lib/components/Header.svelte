<script lang="ts">
	import { app } from '$lib/state/app.svelte';
</script>

<header
	class="sticky top-0 z-30 flex items-center justify-between px-4 py-3 border-b"
	style="background: var(--bg-secondary); border-color: var(--border);"
>
	<div class="flex items-center gap-3">
		<a href="/" class="flex items-center gap-2 no-underline">
			<img src="/favicon.svg" alt="digr" class="w-7 h-7" />
			<span
				class="text-xl font-bold tracking-tight"
				style="color: var(--accent); font-family: ui-monospace, monospace;"
			>digr</span>
		</a>
		<span class="text-xs hidden sm:inline" style="color: var(--text-muted);">
			domain search
		</span>
	</div>

	<div class="flex items-center gap-2">
		{#if app.results.size > 0}
			<span class="text-xs tabular-nums" style="color: var(--text-muted);">
				{app.availableCount} avail / {app.results.size} checked
			</span>
		{/if}

		<button
			onclick={() => app.toggleTheme()}
			class="p-2 rounded-lg transition-colors cursor-pointer border-0"
			style="background: var(--bg-tertiary); color: var(--text-secondary);"
			title="Toggle theme"
		>
			{app.theme === 'dark' ? '☀' : '☾'}
		</button>
	</div>
</header>
