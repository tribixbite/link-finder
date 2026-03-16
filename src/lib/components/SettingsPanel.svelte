<script lang="ts">
	import { app } from '$lib/state/app.svelte';
	import { MODE_LABELS } from '$lib/resolvers/index';
	import type { ResolverMode } from '$lib/types';

	/** All selectable modes including auto */
	const modes: { value: ResolverMode | 'auto'; label: string; desc: string }[] = [
		{ value: 'auto', label: 'Auto-detect', desc: 'Probe local API, then Worker, then browser' },
		{ value: 'local-api', label: 'Local API', desc: 'Use local dig + whois (requires API server)' },
		{ value: 'edge-worker', label: 'Edge Worker', desc: 'Use Cloudflare Worker proxy' },
		{ value: 'browser-doh', label: 'Browser DNS', desc: 'Pure client-side DoH + RDAP' },
	];

	/** Worker URL input value (persisted separately in localStorage) */
	let workerUrl = $state((() => {
		try { return localStorage.getItem('findur-worker-url') || ''; }
		catch { return ''; }
	})());

	/** Currently forced mode (or 'auto' if none is forced) */
	let forcedMode = $state<ResolverMode | 'auto'>((() => {
		try {
			const m = localStorage.getItem('findur-resolver-mode');
			if (m && ['local-api', 'edge-worker', 'browser-doh'].includes(m)) return m as ResolverMode;
		} catch {}
		return 'auto';
	})());

	/** Select a resolver mode — 'auto' clears the override, others set it explicitly */
	function selectMode(mode: ResolverMode | 'auto') {
		forcedMode = mode;
		if (mode === 'auto') {
			app.clearResolverOverride();
		} else {
			app.switchResolver(mode);
		}
	}

	/** Persist worker URL to localStorage */
	function saveWorkerUrl() {
		try {
			if (workerUrl.trim()) {
				localStorage.setItem('findur-worker-url', workerUrl.trim());
			} else {
				localStorage.removeItem('findur-worker-url');
			}
		} catch {}
	}
</script>

<div class="flex flex-col gap-3">
	<!-- Header row with current active mode badge -->
	<div class="flex items-center justify-between">
		<span class="text-sm font-medium" style="color: var(--text-primary);">Resolver Settings</span>
		<span
			class="text-xs px-2 py-0.5 rounded-full"
			style="background: var(--bg-tertiary); color: var(--text-muted);"
		>
			{MODE_LABELS[app.resolverMode]}
		</span>
	</div>

	<!-- Mode selector buttons -->
	<div class="flex flex-col gap-1.5">
		{#each modes as mode}
			<button
				onclick={() => selectMode(mode.value)}
				class="flex flex-col items-start w-full px-3 py-2 rounded text-left cursor-pointer border transition-colors"
				style="background: {forcedMode === mode.value ? 'var(--accent-muted)' : 'var(--bg-secondary)'}; border-color: {forcedMode === mode.value ? 'var(--accent)' : 'var(--border)'}; color: var(--text-primary);"
			>
				<span class="text-xs font-medium">{mode.label}</span>
				<span class="text-xs" style="color: var(--text-muted);">{mode.desc}</span>
			</button>
		{/each}
	</div>

	<!-- Local API hint — shown when local-api is active or forced -->
	{#if forcedMode === 'local-api' || app.resolverMode === 'local-api'}
		<div class="flex flex-col gap-1 px-2 py-1.5 rounded text-xs" style="background: var(--accent-muted); color: var(--text-secondary);">
			<span style="color: var(--accent);">Run the API server:</span>
			<code class="select-all" style="color: var(--text-primary); font-size: 0.7rem;">npx findurlink</code>
			<span style="color: var(--text-muted);">Requires dig + whois installed</span>
		</div>
	{/if}

	<!-- Worker URL field — shown only when edge-worker is active or forced -->
	{#if app.resolverMode === 'edge-worker' || forcedMode === 'edge-worker'}
		<div class="flex flex-col gap-1">
			<label class="text-xs" style="color: var(--text-muted);" for="worker-url">Worker URL</label>
			<div class="flex gap-1">
				<input
					id="worker-url"
					type="url"
					bind:value={workerUrl}
					placeholder="https://findur-dns.workers.dev"
					class="flex-1 px-2 py-1 rounded text-xs border"
					style="background: var(--bg-primary); color: var(--text-primary); border-color: var(--border);"
				/>
				<button
					onclick={saveWorkerUrl}
					class="px-2 py-1 rounded text-xs border-0 cursor-pointer"
					style="background: var(--accent-muted); color: var(--accent);"
				>Save</button>
			</div>
		</div>
	{/if}
</div>
