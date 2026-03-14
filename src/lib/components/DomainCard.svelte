<script lang="ts">
	import { app } from '$lib/state/app.svelte';
	import { MUTATION_INFO } from '$lib/types';
	import type { DomainResult } from '$lib/types';
	import { formatAge, isStale } from '$lib/utils';

	interface Props {
		result: DomainResult;
	}

	let { result }: Props = $props();

	import RegistrarMenu from './RegistrarMenu.svelte';
	import SaveBookmarkButton from './SaveBookmarkButton.svelte';

	let price = $derived(app.getPrice(result.tld));
	let pricingTooltip = $derived(() => {
		const tldKey = result.tld.startsWith('.') ? result.tld.slice(1) : result.tld;
		const entry = app.pricing.get(tldKey);
		if (!entry) return '';
		return `Porkbun: reg $${entry.registration} / renew $${entry.renewal}`;
	});
	let copied = $state(false);
	let copyTimer: ReturnType<typeof setTimeout> | null = null;

	async function copyDomain() {
		try {
			await navigator.clipboard.writeText(result.domain);
			copied = true;
			if (copyTimer) clearTimeout(copyTimer);
			copyTimer = setTimeout(() => { copied = false; }, 1200);
		} catch { /* clipboard unavailable */ }
	}

	const statusColors: Record<string, string> = {
		available: 'var(--available)',
		taken: 'var(--taken)',
		reserved: 'var(--warning)',
		checking: 'var(--accent)',
		error: 'var(--warning)',
	};

	const statusIcons: Record<string, string> = {
		available: '\u2713',
		taken: '\u2717',
		reserved: '\u229B', // circled asterisk
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
					aria-label={result.status}
				>{statusIcons[result.status]}</span>

				<span
					class="text-sm font-semibold truncate"
					style="color: var(--text-primary); font-family: ui-monospace, monospace;"
					title={result.domain}
				>{result.name}<span style="color: var(--text-muted);">{result.tld}</span></span>

				<button
					onclick={copyDomain}
					class="inline-flex items-center justify-center w-5 h-5 rounded border-0 cursor-pointer shrink-0 transition-colors"
					style="background: transparent; color: {copied ? 'var(--success)' : 'var(--text-muted)'}; font-size: 0.7rem;"
					title="Copy domain"
					aria-label="Copy domain to clipboard"
				>{copied ? '\u2713' : '\u2398'}</button>

				{#if result.status === 'available'}
					<RegistrarMenu domain={result.domain} />
				{/if}
			</div>

			<!-- Meta row -->
			<div class="flex items-center gap-2 mt-1 ml-7">
				<span class="text-xs" style="color: var(--text-muted);">{result.term}</span>
				<span class="text-xs px-1.5 py-0 rounded"
					style="background: var(--bg-tertiary); color: var(--text-muted);"
				>{MUTATION_INFO[result.mutation].label}</span>
				<span class="text-xs tabular-nums" style="color: var(--text-muted);">{result.nameLength}ch</span>
				{#if price}
					<span class="text-xs tabular-nums font-medium" style="color: var(--success);" title={pricingTooltip()}>${price}/yr</span>
				{/if}
				{#if result.checkedAt && result.status !== 'checking'}
					<span class="text-xs tabular-nums" style="color: {isStale(result.checkedAt) ? 'var(--warning)' : 'var(--text-muted)'};">{formatAge(result.checkedAt)}</span>
				{/if}
			</div>
		</div>

		<!-- Actions -->
		<div class="flex items-center gap-1 shrink-0">
			<SaveBookmarkButton {result} />
			<span
				class="text-xs font-medium px-2 py-0.5 rounded-full"
				style="background: color-mix(in srgb, {statusColors[result.status]} 15%, transparent); color: {statusColors[result.status]};"
			>
				{result.status}
			</span>
		</div>
	</div>

	<!-- DNS records (if taken) -->
	{#if result.records.length > 0}
		<div class="mt-2 ml-7 text-xs truncate" style="color: var(--text-muted); font-family: ui-monospace, monospace;" title={result.records.join(', ')}>
			{result.records.slice(0, 3).join(', ')}
			{#if result.records.length > 3}
				<span> +{result.records.length - 3}</span>
			{/if}
		</div>
	{/if}

	<!-- Error message + retry -->
	{#if result.error || result.status === 'error'}
		<div class="mt-1 ml-7 flex items-center gap-2">
			{#if result.error}
				<span class="text-xs" style="color: var(--warning);">{result.error}</span>
			{/if}
			{#if result.status === 'error'}
				<button
					onclick={() => app.recheckDomain(result.domain)}
					class="text-xs px-2 py-0.5 rounded border-0 cursor-pointer transition-colors"
					style="background: var(--accent-muted); color: var(--accent);"
				>retry</button>
			{/if}
		</div>
	{/if}
</div>
