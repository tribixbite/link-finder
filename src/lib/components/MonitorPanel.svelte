<script lang="ts">
	import { app } from '$lib/state/app.svelte';
	import { formatAge } from '$lib/utils';

	const intervalOptions = [
		{ label: '1 hour', value: 60 },
		{ label: '6 hours', value: 360 },
		{ label: '24 hours', value: 1440 },
	];

	const statusColors: Record<string, string> = {
		available: 'var(--available)',
		taken: 'var(--taken)',
		reserved: 'var(--warning)',
		checking: 'var(--accent)',
		error: 'var(--warning)',
	};
</script>

<!-- Backdrop -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="fixed inset-0 z-50"
	onclick={() => { app.monitorPanelOpen = false; }}
	onkeydown={(e) => { if (e.key === 'Escape') app.monitorPanelOpen = false; }}
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
		<!-- Header -->
		<div class="flex items-center justify-between p-4" style="border-bottom: 1px solid var(--border);">
			<div>
				<h2 class="text-sm font-semibold m-0" style="color: var(--text-primary);">Domain Monitor</h2>
				<span class="text-xs" style="color: var(--text-muted);">{app.monitorEntries.length} domains tracked</span>
			</div>
			<button
				onclick={() => { app.monitorPanelOpen = false; }}
				class="w-7 h-7 rounded flex items-center justify-center border-0 cursor-pointer"
				style="background: var(--bg-tertiary); color: var(--text-muted);"
				aria-label="Close"
			>&times;</button>
		</div>

		<!-- Config -->
		<div class="p-3 flex items-center gap-2" style="border-bottom: 1px solid var(--border);">
			<button
				onclick={() => app.monitorConfig.enabled ? app.stopMonitoring() : app.startMonitoring()}
				class="text-xs px-3 py-1.5 rounded border-0 cursor-pointer"
				style="background: {app.monitorConfig.enabled ? 'var(--danger)' : 'var(--accent-muted)'}; color: {app.monitorConfig.enabled ? 'white' : 'var(--accent)'};"
			>{app.monitorConfig.enabled ? 'Stop' : 'Start'}</button>

			<select
				value={app.monitorConfig.intervalMinutes}
				onchange={(e) => app.setMonitorInterval(Number((e.target as HTMLSelectElement).value))}
				class="text-xs px-2 py-1.5 rounded border-0"
				style="background: var(--bg-tertiary); color: var(--text-primary); outline: none;"
			>
				{#each intervalOptions as opt}
					<option value={opt.value}>{opt.label}</option>
				{/each}
			</select>

			<button
				onclick={() => app.runMonitorCheck()}
				class="text-xs px-2 py-1.5 rounded border-0 cursor-pointer"
				style="background: var(--bg-tertiary); color: var(--text-secondary);"
				title="Check now"
			>Check now</button>
		</div>

		<!-- Monitored domains -->
		<div class="flex-1 overflow-y-auto p-3">
			{#if app.monitorEntries.length === 0}
				<div class="text-center py-8 text-xs" style="color: var(--text-muted);">
					No domains being monitored. Use the eye icon on domain cards to add.
				</div>
			{:else}
				<div class="flex flex-col gap-1">
					{#each app.monitorEntries as entry (entry.domain)}
						<div class="px-2 py-2 rounded" style="background: var(--bg-secondary);">
							<div class="flex items-center gap-2">
								<span
									class="inline-block w-2 h-2 rounded-full shrink-0"
									style="background: {statusColors[entry.status] || 'var(--text-muted)'};"
								></span>
								<span class="flex-1 text-xs truncate" style="font-family: ui-monospace, monospace; color: var(--text-primary);">
									{entry.domain}
								</span>
								<span class="text-xs tabular-nums shrink-0" style="color: var(--text-muted);">
									{formatAge(entry.lastChecked)}
								</span>
								<button
									onclick={() => app.removeFromMonitor(entry.domain)}
									class="w-5 h-5 rounded flex items-center justify-center border-0 cursor-pointer shrink-0"
									style="background: transparent; color: var(--danger); font-size: 0.65rem;"
									title="Remove"
								>&times;</button>
							</div>

							<!-- Status history timeline (last 5 entries) -->
							{#if entry.history.length > 1}
								<div class="flex items-center gap-0.5 mt-1 ml-4">
									{#each entry.history.slice(-5) as h}
										<span
											class="w-2 h-2 rounded-full"
											style="background: {statusColors[h.status] || 'var(--text-muted)'};"
											title="{h.status} — {new Date(h.checkedAt).toLocaleString()}"
										></span>
									{/each}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>
