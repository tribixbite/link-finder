<script lang="ts">
	import { app } from '$lib/state/app.svelte';
	import { MODE_LABELS } from '$lib/resolvers';
	import type { ResolverMode } from '$lib/types';

	let dropdownOpen = $state(false);

	/** Short labels for mobile badge */
	const SHORT_LABELS: Record<ResolverMode, string> = {
		'local-api': 'Local',
		'edge-worker': 'Edge',
		'browser-doh': 'DoH',
	};

	const modes: { value: ResolverMode | 'auto'; label: string; desc: string }[] = [
		{ value: 'auto', label: 'Auto-detect', desc: 'Probe local → worker → browser' },
		{ value: 'local-api', label: 'Local API', desc: 'dig + whois (npx findurlink)' },
		{ value: 'edge-worker', label: 'Edge Worker', desc: 'Cloudflare Worker proxy' },
		{ value: 'browser-doh', label: 'Browser DNS', desc: 'Client-side DoH + RDAP' },
	];

	let forcedMode = $state<ResolverMode | 'auto'>((() => {
		try {
			const m = localStorage.getItem('findur-resolver-mode');
			if (m && ['local-api', 'edge-worker', 'browser-doh'].includes(m)) return m as ResolverMode;
		} catch {}
		return 'auto';
	})());

	let isLocal = $derived(app.resolverMode === 'local-api');

	let workerUrl = $state((() => {
		try { return localStorage.getItem('findur-worker-url') || ''; }
		catch { return ''; }
	})());

	function selectMode(mode: ResolverMode | 'auto') {
		forcedMode = mode;
		if (mode === 'auto') {
			app.clearResolverOverride();
		} else {
			app.switchResolver(mode);
		}
	}

	function saveWorkerUrl() {
		try {
			if (workerUrl.trim()) {
				localStorage.setItem('findur-worker-url', workerUrl.trim());
			} else {
				localStorage.removeItem('findur-worker-url');
			}
		} catch {}
	}

	function handleClickOutside(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('[data-resolver-dropdown]')) {
			dropdownOpen = false;
		}
	}
</script>

<svelte:window onclick={handleClickOutside} />

{#if app.isOffline}
	<div
		class="w-full px-3 py-1 text-xs text-center"
		style="background: var(--warning); color: var(--bg-primary);"
	>Offline — DNS lookups unavailable</div>
{/if}
<header
	class="sticky top-0 z-30 flex items-center justify-between px-3 py-2 border-b sm:px-4 sm:py-3"
	style="background: var(--bg-secondary); border-color: var(--border);"
>
	<a href="/" class="flex items-center gap-1.5 no-underline shrink-0 sm:gap-2">
		<img src="/favicon.svg" alt="findur.link" class="w-6 h-6 sm:w-7 sm:h-7" />
		<span
			class="hidden sm:inline text-xl font-bold tracking-tight"
			style="color: var(--accent); font-family: ui-monospace, monospace;"
		>findur<span style="color: var(--text-muted); font-weight: 400;">.link</span></span>
	</a>

	<div class="flex items-center gap-1.5 sm:gap-2">
		<!-- Resolver mode badge + dropdown -->
		{#if app.resolverReady}
			<div class="relative" data-resolver-dropdown>
				<button
					onclick={(e) => { e.stopPropagation(); dropdownOpen = !dropdownOpen; }}
					class="text-xs px-1.5 py-0.5 rounded-full cursor-pointer border transition-colors whitespace-nowrap sm:px-2"
					style="background: {dropdownOpen ? 'var(--accent-muted)' : isLocal ? 'color-mix(in srgb, var(--available) 15%, transparent)' : 'var(--bg-tertiary)'}; color: {dropdownOpen ? 'var(--accent)' : isLocal ? 'var(--available)' : 'var(--text-muted)'}; border-color: {dropdownOpen ? 'var(--accent)' : isLocal ? 'var(--available)' : 'var(--border)'};"
					title="Change DNS resolver mode"
				>
					<span class="sm:hidden">{SHORT_LABELS[app.resolverMode]} ▾</span>
					<span class="hidden sm:inline">{MODE_LABELS[app.resolverMode]} ▾</span>
				</button>

				{#if dropdownOpen}
					<div
						class="absolute right-0 top-8 w-64 rounded-lg shadow-lg overflow-hidden z-50"
						style="background: var(--bg-secondary); border: 1px solid var(--border);"
					>
						<div class="p-2 flex flex-col gap-1">
							{#each modes as mode}
								<button
									onclick={() => { selectMode(mode.value); dropdownOpen = false; }}
									class="flex flex-col items-start w-full px-2.5 py-1.5 rounded text-left cursor-pointer border-0 transition-colors"
									style="background: {forcedMode === mode.value ? 'var(--accent-muted)' : 'transparent'}; color: var(--text-primary);"
								>
									<span class="text-xs font-medium">{mode.label}</span>
									<span class="text-xs" style="color: var(--text-muted);">{mode.desc}</span>
								</button>
							{/each}
						</div>

						<!-- Contextual hint for local-api -->
						{#if forcedMode === 'local-api' || app.resolverMode === 'local-api'}
							<div class="px-3 py-2 text-xs border-t" style="border-color: var(--border); background: var(--bg-tertiary);">
								<span style="color: var(--accent);">Run:</span>
								<code class="select-all ml-1" style="color: var(--text-primary);">npx findurlink</code>
								<div class="mt-0.5" style="color: var(--text-muted);">Requires dig + whois</div>
							</div>
						{/if}

						<!-- Worker URL for edge-worker -->
						{#if forcedMode === 'edge-worker' || app.resolverMode === 'edge-worker'}
							<div class="px-3 py-2 border-t" style="border-color: var(--border); background: var(--bg-tertiary);">
								<label class="text-xs block mb-1" style="color: var(--text-muted);" for="hdr-worker-url">Worker URL</label>
								<div class="flex gap-1">
									<input
										id="hdr-worker-url"
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
				{/if}
			</div>
		{/if}

		{#if app.results.size > 0}
			<span class="hidden xs:inline text-xs tabular-nums" style="color: var(--text-muted);">
				{app.availableCount + app.likelyAvailableCount}/{app.results.size}
			</span>
		{/if}

		<!-- Monitor button -->
		{#if app.monitorEntries.length > 0}
			<button
				onclick={() => { app.monitorPanelOpen = !app.monitorPanelOpen; }}
				class="relative p-1.5 rounded-lg transition-colors cursor-pointer border-0 sm:p-2"
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
			class="relative p-1.5 rounded-lg transition-colors cursor-pointer border-0 sm:p-2"
			style="background: var(--bg-tertiary); color: {app.savedCount > 0 ? 'var(--warning)' : 'var(--text-secondary)'};"
			title="Saved domains ({app.savedCount})"
		>
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
			class="p-1.5 rounded-lg transition-colors cursor-pointer border-0 sm:p-2"
			style="background: var(--bg-tertiary); color: var(--text-secondary);"
			title="Toggle theme"
		>
			{app.theme === 'dark' ? '☀' : '☾'}
		</button>
	</div>
</header>
