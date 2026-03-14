/** Unified toast notification system */

export type ToastType = 'success' | 'error' | 'info';

export interface Toast {
	id: string;
	message: string;
	type: ToastType;
}

/** Default auto-dismiss duration in ms */
const DISMISS_MS = 3000;

class ToastStore {
	items = $state<Toast[]>([]);

	/** Add a toast and auto-dismiss after timeout */
	add(message: string, type: ToastType = 'info', durationMs = DISMISS_MS) {
		const id = crypto.randomUUID();
		this.items = [...this.items, { id, message, type }];
		setTimeout(() => this.remove(id), durationMs);
	}

	/** Remove a toast by ID */
	remove(id: string) {
		this.items = this.items.filter((t) => t.id !== id);
	}

	/** Convenience: success toast */
	success(message: string) {
		this.add(message, 'success');
	}

	/** Convenience: error toast */
	error(message: string) {
		this.add(message, 'error', 5000);
	}

	/** Convenience: info toast */
	info(message: string) {
		this.add(message, 'info');
	}
}

export const toasts = new ToastStore();
