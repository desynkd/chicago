import { App, Modal } from "obsidian";

// A minimal Yes/No modal. Used only for the one confirmation the spec
// requires (deleting a project with hours logged) — everything else in the
// hot path must stay a single click with no dialog.
export class ConfirmModal extends Modal {
	private settled = false;
	private resolveFn: ((value: boolean) => void) | null = null;

	private constructor(app: App, private message: string, private confirmText: string) {
		super(app);
	}

	static ask(app: App, message: string, confirmText = "Delete"): Promise<boolean> {
		return new Promise((resolve) => {
			const modal = new ConfirmModal(app, message, confirmText);
			modal.resolveFn = resolve;
			modal.open();
		});
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("p", { text: this.message });

		const buttons = contentEl.createDiv({ cls: "chicago-confirm-buttons" });
		const cancel = buttons.createEl("button", { text: "Cancel" });
		cancel.addEventListener("click", () => {
			this.settle(false);
			this.close();
		});

		const confirm = buttons.createEl("button", { text: this.confirmText, cls: "mod-warning" });
		confirm.addEventListener("click", () => {
			this.settle(true);
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
		// Escape / backdrop dismissal never called either button, so treat it
		// as "cancel" rather than leaving the caller's promise unresolved.
		this.settle(false);
	}

	private settle(value: boolean): void {
		if (this.settled) return;
		this.settled = true;
		this.resolveFn?.(value);
	}
}
