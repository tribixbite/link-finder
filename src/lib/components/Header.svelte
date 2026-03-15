<script lang="ts">
	import { app } from '$lib/state/app.svelte';
	import { MODE_LABELS } from '$lib/resolvers';
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
		{#if app.resolverReady}
			<span
				class="text-xs px-2 py-0.5 rounded-full"
				style="background: var(--bg-tertiary); color: var(--text-muted); border: 1px solid var(--border);"
				title="DNS resolver mode"
			>{MODE_LABELS[app.resolverMode]}</span>
		{/if}
		{#if app.results.size > 0}
			<span class="text-xs tabular-nums" style="color: var(--text-muted);">
				{app.availableCount + app.likelyAvailableCount} avail / {app.results.size} checked
			</span>
		{/if}

		<!-- Monitor button -->
		{#if app.monitorEntries.length > 0}
			<button
				onclick={() => { app.monitorPanelOpen = !app.monitorPanelOpen; }}
				class="relative p-2 rounded-lg transition-colors cursor-pointer border-0"
				style="background: var(--bg-tertiary); color: {app.monitorConfig.enabled ? 'var(--accent)' : 'var(--text-secondary)'};"
				title="Domain monitor ({app.monitorEntries.length})"
			>
				&#x1F441;
				<span
					class="absolute -top-1 -right-1 min-w-4 h-4 flex items-center justify-center rounded-full text-xs font-bold px-1"
					style="background: var(--accent); color: var(--bg-primary); font-size: 0.6rem; line-height: 1;"
				>{app.monitorEntries.length}</span>
			</button>
		{/if}

		<!-- Saved domains button -->
		<button
			onclick={() => { app.savedViewOpen = !app.savedViewOpen; }}
			class="relative p-2 rounded-lg transition-colors cursor-pointer border-0"
			style="background: var(--bg-tertiary); color: {app.savedCount > 0 ? 'var(--warning)' : 'var(--text-secondary)'};"
			title="Saved domains ({app.savedCount})"
		>
			<!-- Star icon -->
			{#if app.savedCount > 0}
				<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1">
					<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
				</svg>
			{:else}
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
				</svg>
			{/if}
			{#if app.savedCount > 0}
				<span
					class="absolute -top-1 -right-1 min-w-4 h-4 flex items-center justify-center rounded-full text-xs font-bold px-1"
					style="background: var(--warning); color: var(--bg-primary); font-size: 0.6rem; line-height: 1;"
				>{app.savedCount}</span>
			{/if}
		</button>

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
