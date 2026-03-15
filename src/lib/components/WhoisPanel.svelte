<script lang="ts">
	import { app } from '$lib/state/app.svelte';

	let showRaw = $state(false);
</script>

<!-- Backdrop -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="fixed inset-0 z-50"
	onclick={() => app.closeWhois()}
	onkeydown={(e) => { if (e.key === 'Escape') app.closeWhois(); }}
>
	<div class="absolute inset-0 bg-black/50"></div>

	<!-- Panel from right -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="absolute right-0 top-0 bottom-0 w-96 max-w-full flex flex-col overflow-hidden"
		style="background: var(--bg-primary); border-left: 1px solid var(--border);"
		onclick={(e) => e.stopPropagation()}
		onkeydown={() => {}}
	>
		<!-- Header -->
		<div class="flex items-center justify-between p-4" style="border-bottom: 1px solid var(--border);">
			<div class="min-w-0">
				<h2 class="text-sm font-semibold m-0 truncate" style="color: var(--text-primary); font-family: ui-monospace, monospace;">
					{app.whoisPanel.domain}
				</h2>
				<span class="text-xs" style="color: var(--text-muted);">{app.whoisPanel.data?.source === 'rdap' ? 'RDAP' : 'Whois'} details</span>
			</div>
			<button
				onclick={() => app.closeWhois()}
				class="w-7 h-7 rounded flex items-center justify-center border-0 cursor-pointer shrink-0"
				style="background: var(--bg-tertiary); color: var(--text-muted);"
				aria-label="Close"
			>&times;</button>
		</div>

		<!-- Content -->
		<div class="flex-1 overflow-y-auto p-4">
			{#if app.whoisPanel.loading}
				<!-- Loading skeleton -->
				<div class="space-y-3">
					{#each Array(5) as _}
						<div>
							<div class="h-3 w-20 rounded mb-1" style="background: var(--bg-tertiary);"></div>
							<div class="h-4 w-48 rounded" style="background: var(--bg-tertiary);"></div>
						</div>
					{/each}
				</div>
			{:else if app.whoisPanel.error}
				<!-- Error state -->
				<div class="text-center py-8">
					<div class="text-sm mb-2" style="color: var(--warning);">{app.whoisPanel.error}</div>
					<button
						onclick={() => app.openWhois(app.whoisPanel.domain)}
						class="text-xs px-3 py-1.5 rounded border-0 cursor-pointer"
						style="background: var(--accent-muted); color: var(--accent);"
					>Retry</button>
				</div>
			{:else if app.whoisPanel.data}
				{@const data = app.whoisPanel.data}
				<div class="space-y-4">
					<!-- Parsed fields -->
					{#if data.parsed.registrar}
						<div>
							<div class="text-xs font-medium mb-0.5" style="color: var(--text-muted);">Registrar</div>
							<div class="text-sm" style="color: var(--text-primary);">{data.parsed.registrar}</div>
						</div>
					{/if}
					{#if data.parsed.created}
						<div>
							<div class="text-xs font-medium mb-0.5" style="color: var(--text-muted);">Created</div>
							<div class="text-sm" style="color: var(--text-primary);">{data.parsed.created}</div>
						</div>
					{/if}
					{#if data.parsed.expires}
						<div>
							<div class="text-xs font-medium mb-0.5" style="color: var(--text-muted);">Expires</div>
							<div class="text-sm" style="color: var(--text-primary);">{data.parsed.expires}</div>
						</div>
					{/if}
					{#if data.parsed.updated}
						<div>
							<div class="text-xs font-medium mb-0.5" style="color: var(--text-muted);">Updated</div>
							<div class="text-sm" style="color: var(--text-primary);">{data.parsed.updated}</div>
						</div>
					{/if}
					{#if data.parsed.nameservers && data.parsed.nameservers.length > 0}
						<div>
							<div class="text-xs font-medium mb-0.5" style="color: var(--text-muted);">Nameservers</div>
							<div class="text-xs space-y-0.5" style="font-family: ui-monospace, monospace; color: var(--text-secondary);">
								{#each data.parsed.nameservers as ns}
									<div>{ns}</div>
								{/each}
							</div>
						</div>
					{/if}
					{#if data.parsed.status && data.parsed.status.length > 0}
						<div>
							<div class="text-xs font-medium mb-0.5" style="color: var(--text-muted);">Status</div>
							<div class="flex flex-wrap gap-1">
								{#each data.parsed.status as s}
									<span class="text-xs px-1.5 py-0.5 rounded" style="background: var(--bg-tertiary); color: var(--text-secondary); font-family: ui-monospace, monospace;">
										{s}
									</span>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Raw whois toggle -->
					<div>
						<button
							onclick={() => { showRaw = !showRaw; }}
							class="text-xs cursor-pointer border-0 bg-transparent"
							style="color: var(--accent);"
						>{showRaw ? 'Hide' : 'Show'} raw {data.source === 'rdap' ? 'RDAP' : 'whois'}</button>
						{#if showRaw}
							<pre
								class="mt-2 p-3 rounded-lg text-xs overflow-x-auto"
								style="background: var(--bg-tertiary); color: var(--text-secondary); font-family: ui-monospace, monospace; max-height: 400px; overflow-y: auto; white-space: pre-wrap; word-break: break-all;"
							>{data.raw}</pre>
						{/if}
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>
