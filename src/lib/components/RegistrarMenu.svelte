<script lang="ts">
	import { app } from '$lib/state/app.svelte';
	import { REGISTRARS, REGISTRAR_IDS } from '$lib/types';
	import type { RegistrarId } from '$lib/types';

	interface Props {
		domain: string;
	}

	let { domain }: Props = $props();
	let open = $state(false);
	let menuRef = $state<HTMLDivElement | null>(null);

	/** Extract TLD from domain (e.g. "torch.dev" → ".dev") */
	function getTld(d: string): string {
		const dot = d.indexOf('.');
		return dot >= 0 ? d.slice(dot) : '';
	}

	/** Registrars that support this domain's TLD */
	let available = $derived(() => {
		const tld = getTld(domain);
		const supported = app.getRegistrarsForTld(tld);
		// Show all if registrar data hasn't loaded yet
		if (supported.length === 0 && app.registrarTlds.size === 0) return REGISTRAR_IDS;
		return supported;
	});

	function handleClickOutside(e: MouseEvent) {
		if (menuRef && !menuRef.contains(e.target as Node)) {
			open = false;
		}
	}

	/** Get pricing label for a registrar (e.g. "$9.73" for Porkbun, "at-cost" for Cloudflare) */
	function getPricingLabel(rid: RegistrarId): string {
		if (rid === 'cloudflare') return 'at-cost';
		if (rid === 'porkbun') {
			const tld = getTld(domain);
			const price = app.getPrice(tld);
			return price ? `$${price}` : '';
		}
		return '';
	}

	/** Get full pricing tooltip for Porkbun (registration + renewal) */
	function getPricingTooltip(): string {
		const tldKey = getTld(domain).replace(/^\./, '');
		const entry = app.pricing.get(tldKey);
		if (!entry) return '';
		return `Porkbun: reg $${entry.registration} / renew $${entry.renewal}`;
	}

	$effect(() => {
		if (open) {
			document.addEventListener('click', handleClickOutside, true);
			return () => document.removeEventListener('click', handleClickOutside, true);
		}
	});
</script>

{#if available().length > 0}
<div class="relative inline-flex" bind:this={menuRef}>
	<button
		onclick={(e) => { e.stopPropagation(); open = !open; }}
		class="inline-flex items-center justify-center w-6 h-6 rounded border-0 cursor-pointer transition-colors"
		style="background: var(--bg-tertiary); color: var(--text-muted);"
		title="Register at..."
		aria-label="Choose registrar"
	>
		<!-- External link icon (12px) -->
		<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M12 9v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h4" />
			<path d="M10 2h4v4" />
			<path d="M7 9L14 2" />
		</svg>
	</button>

	{#if open}
		<div class="popover" style="right: 0; top: 100%; margin-top: 4px;" title={getPricingTooltip()}>
			{#each available() as rid}
				{@const reg = REGISTRARS[rid]}
				{@const priceLabel = getPricingLabel(rid)}
				<a
					href={reg.url(domain)}
					target="_blank"
					rel="noopener"
					class="popover-item"
					onclick={() => { open = false; }}
				>
					<span
						class="inline-block w-2.5 h-2.5 rounded-full shrink-0"
						style="background: {reg.color};"
					></span>
					<span class="flex-1">{reg.name}</span>
					{#if priceLabel}
						<span class="text-xs tabular-nums" style="color: var(--text-muted);">{priceLabel}</span>
					{/if}
				</a>
			{/each}
		</div>
	{/if}
</div>
{/if}
