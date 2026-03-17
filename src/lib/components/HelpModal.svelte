<script lang="ts">
	import { help, HELP_CONTENT } from '$lib/state/help.svelte';
	import type { HelpTopic } from '$lib/state/help.svelte';

	let entry = $derived(help.activeTopic ? HELP_CONTENT[help.activeTopic] : null);

	/** Reference to the close button for auto-focus */
	let closeBtn = $state<HTMLButtonElement | null>(null);
	/** Reference to the modal container for focus trapping */
	let modalRef = $state<HTMLDivElement | null>(null);
	/** Element that had focus before modal opened, to restore on close */
	let previousFocus: HTMLElement | null = null;

	/** Auto-focus close button when modal opens, store previous focus */
	$effect(() => {
		if (entry && closeBtn) {
			previousFocus = document.activeElement as HTMLElement | null;
			closeBtn.focus();
		}
	});

	function handleClose() {
		help.close();
		// Restore focus to the element that triggered the modal
		if (previousFocus && typeof previousFocus.focus === 'function') {
			previousFocus.focus();
		}
	}

	function handleBackdrop(e: MouseEvent) {
		if ((e.target as HTMLElement).dataset.helpBackdrop) {
			handleClose();
		}
	}

	/** Focus trap: Tab/Shift+Tab stay within the modal */
	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			handleClose();
			return;
		}
		if (e.key === 'Tab' && modalRef) {
			const focusable = modalRef.querySelectorAll<HTMLElement>(
				'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
			);
			if (focusable.length === 0) return;
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		}
	}
</script>

{#if entry}
	<div
		class="fixed inset-0 z-60 flex items-center justify-center p-4"
		data-help-backdrop="true"
		onclick={handleBackdrop}
		onkeydown={handleKeydown}
		role="dialog"
		aria-modal="true"
		aria-labelledby="help-modal-title"
		tabindex="-1"
	>
		<div class="absolute inset-0 bg-black/50 pointer-events-none"></div>

		<!-- Modal — stop clicks from bubbling to backdrop -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div
			bind:this={modalRef}
			class="relative w-full max-w-lg rounded-xl shadow-2xl overflow-hidden"
			style="background: var(--bg-secondary); border: 1px solid var(--border);"
			onclick={(e: MouseEvent) => e.stopPropagation()}
		>
			<!-- Header -->
			<div
				class="flex items-center justify-between px-4 py-3 border-b"
				style="border-color: var(--border); background: var(--bg-tertiary);"
			>
				<h2 id="help-modal-title" class="text-sm font-semibold m-0" style="color: var(--text-primary);">{entry.title}</h2>
				<button
					bind:this={closeBtn}
					onclick={handleClose}
					class="w-7 h-7 flex items-center justify-center rounded-md border-0 cursor-pointer text-base"
					style="background: transparent; color: var(--text-muted);"
					aria-label="Close help"
				>&times;</button>
			</div>

			<!-- Body -->
			<div
				class="px-4 py-3 overflow-y-auto help-body"
				style="max-height: 60dvh;"
			>
				{@html entry.body}
			</div>
		</div>
	</div>
{/if}
