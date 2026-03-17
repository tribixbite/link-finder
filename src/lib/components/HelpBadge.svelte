<script lang="ts">
	import { help } from '$lib/state/help.svelte';
	import type { HelpTopic } from '$lib/state/help.svelte';

	interface Props {
		topic: HelpTopic;
	}

	let { topic }: Props = $props();
</script>

{#if help.tutorialMode}
	<button
		class="help-badge"
		onclick={(e: MouseEvent) => { e.stopPropagation(); help.show(topic); }}
		aria-label="Help: {topic}"
	>i</button>
{/if}
