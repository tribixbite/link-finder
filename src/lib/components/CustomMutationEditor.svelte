<script lang="ts">
	import { app } from '$lib/state/app.svelte';

	let pattern = $state('');
	let error = $state('');

	function addPattern() {
		const p = pattern.trim().toLowerCase();
		if (!p.includes('{term}')) {
			error = 'Pattern must contain {term}';
			return;
		}
		// Validate: substituting a test word should produce valid domain chars
		const test = p.replace(/\{term\}/g, 'test').replace(/[^a-z0-9-]/g, '');
		if (test.length < 2) {
			error = 'Pattern produces name too short';
			return;
		}
		// Generate a label from the pattern
		const label = p.replace('{term}', '*');
		app.addCustomMutation(label, p);
		pattern = '';
		error = '';
	}
</script>

<div class="rounded-lg p-3" style="background: var(--bg-tertiary); border: 1px solid var(--border);">
	<div class="text-xs font-medium mb-2" style="color: var(--text-secondary);">
		Custom patterns
		<span style="color: var(--text-muted);">— use {'{term}'} as placeholder</span>
	</div>

	<!-- Existing custom mutations -->
	{#if app.customMutations.length > 0}
		<div class="flex flex-wrap gap-1 mb-2">
			{#each app.customMutations as cm (cm.id)}
				<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
					style="background: var(--accent-muted); color: var(--accent); border: 1px solid var(--accent);">
					<span style="font-family: ui-monospace, monospace;">{cm.pattern}</span>
					<button
						onclick={() => app.removeCustomMutation(cm.id)}
						class="w-3.5 h-3.5 rounded-full flex items-center justify-center border-0 cursor-pointer"
						style="background: transparent; color: var(--accent); font-size: 9px;"
						title="Remove"
					>&times;</button>
				</span>
			{/each}
		</div>
	{/if}

	<!-- Add new pattern -->
	<form class="flex gap-1" onsubmit={(e) => { e.preventDefault(); addPattern(); }}>
		<input
			bind:value={pattern}
			placeholder="{'{term}'}hub"
			class="flex-1 text-xs px-2 py-1.5 rounded border-0"
			style="background: var(--bg-secondary); color: var(--text-primary); font-family: ui-monospace, monospace; outline: none;"
		/>
		<button
			type="submit"
			class="text-xs px-3 py-1.5 rounded border-0 cursor-pointer"
			style="background: var(--accent-muted); color: var(--accent);"
			disabled={!pattern.trim()}
		>+</button>
	</form>

	{#if error}
		<div class="text-xs mt-1" style="color: var(--warning);">{error}</div>
	{/if}
</div>
