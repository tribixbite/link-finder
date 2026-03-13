<script lang="ts">
	import { MUTATION_INFO } from '$lib/types';
	import type { DomainResult } from '$lib/types';

	interface Props {
		result: DomainResult;
	}

	let { result }: Props = $props();

	const statusColors = {
		available: 'var(--available)',
		taken: 'var(--taken)',
		checking: 'var(--accent)',
		error: 'var(--warning)',
	};

	const statusIcons = {
		available: '\u2713',
		taken: '\u2717',
		checking: '\u2022',
		error: '!',
	};
</script>

<div
	class="rounded-lg p-3 transition-colors"
	style="background: var(--bg-secondary); border: 1px solid {result.status === 'available' ? 'color-mix(in srgb, var(--available) 30%, var(--border))' : 'var(--border)'};"
>
	<div class="flex items-start justify-between gap-2">
		<!-- Domain name -->
		<div class="min-w-0">
			<div class="flex items-center gap-2">
				<span
					class="text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0"
					class:checking-pulse={result.status === 'checking'}
					style="background: color-mix(in srgb, {statusColors[result.status]} 20%, transparent); color: {statusColors[result.status]};"
				>{statusIcons[result.status]}</span>
				<span
					class="text-sm font-semibold truncate"
					style="color: var(--text-primary); font-family: ui-monospace, monospace;"
				>{result.name}<span style="color: var(--text-muted);">{result.tld}</span></span>
			</div>

			<!-- Meta row -->
			<div class="flex items-center gap-2 mt-1 ml-7">
				<span class="text-xs" style="color: var(--text-muted);">{result.term}</span>
				<span class="text-xs px-1.5 py-0 rounded"
					style="background: var(--bg-tertiary); color: var(--text-muted);"
				>{MUTATION_INFO[result.mutation].label}</span>
				<span class="text-xs tabular-nums" style="color: var(--text-muted);">{result.nameLength}ch</span>
			</div>
		</div>

		<!-- Status badge -->
		<span
			class="text-xs font-medium px-2 py-0.5 rounded-full shrink-0"
			style="background: color-mix(in srgb, {statusColors[result.status]} 15%, transparent); color: {statusColors[result.status]};"
		>
			{result.status}
		</span>
	</div>

	<!-- DNS records (if taken) -->
	{#if result.records.length > 0}
		<div class="mt-2 ml-7 text-xs truncate" style="color: var(--text-muted); font-family: ui-monospace, monospace;">
			{result.records.slice(0, 3).join(', ')}
			{#if result.records.length > 3}
				<span> +{result.records.length - 3}</span>
			{/if}
		</div>
	{/if}

	<!-- Error message -->
	{#if result.error}
		<div class="mt-1 ml-7 text-xs" style="color: var(--warning);">{result.error}</div>
	{/if}
</div>
