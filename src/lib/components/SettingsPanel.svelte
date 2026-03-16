<script lang="ts">
	import { app } from '$lib/state/app.svelte';
</script>

<div class="flex flex-col gap-2">
	<span class="text-xs font-medium" style="color: var(--text-primary);">Settings</span>

	<!-- Storage usage -->
	<div class="flex items-center justify-between text-xs" style="color: var(--text-muted);">
		<span>Storage used</span>
		<span class="tabular-nums">{app.storageUsageKB.toFixed(0)} KB</span>
	</div>
</div>
