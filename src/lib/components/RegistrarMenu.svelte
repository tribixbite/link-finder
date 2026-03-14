<script lang="ts">
	interface Props {
		domain: string;
	}

	let { domain }: Props = $props();
	let open = $state(false);
	let menuRef = $state<HTMLDivElement | null>(null);

	const registrars = [
		{ name: 'Namecheap', color: '#fe5803', url: (d: string) => `https://www.namecheap.com/domains/registration/results/?domain=${encodeURIComponent(d)}` },
		{ name: 'Porkbun', color: '#ef6f9a', url: (d: string) => `https://porkbun.com/checkout/search?q=${encodeURIComponent(d)}` },
		{ name: 'Cloudflare', color: '#f6821f', url: () => `https://www.cloudflare.com/products/registrar/` },
		{ name: 'Spaceship', color: '#635bff', url: () => `https://www.spaceship.com/domain-search/` },
	];

	function handleClickOutside(e: MouseEvent) {
		if (menuRef && !menuRef.contains(e.target as Node)) {
			open = false;
		}
	}

	$effect(() => {
		if (open) {
			document.addEventListener('click', handleClickOutside, true);
			return () => document.removeEventListener('click', handleClickOutside, true);
		}
	});
</script>

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
		<div class="popover" style="right: 0; top: 100%; margin-top: 4px;">
			{#each registrars as reg}
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
					{reg.name}
				</a>
			{/each}
		</div>
	{/if}
</div>
