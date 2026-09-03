import { App, Modal, Notice, Platform } from "obsidian";
import { InboxStore } from "../data/inbox-store";

// The capture dialog. Deliberately a plain text box with no category, no
// project fields and no "create as a project" shortcut: capture is supposed
// to cost nothing, and deciding what an idea *is* belongs to triage.
export class IdeaModal extends Modal {
	private settled = false;
	private resolveFn: ((value: string | null) => void) | null = null;

	// Resolves with what the user typed, or null if they cancelled.
	static ask(app: App): Promise<string | null> {
		return new Promise((resolve) => {
			const modal = new IdeaModal(app);
			modal.resolveFn = resolve;
			modal.open();
		});
	}

	onOpen(): void {
		const { contentEl } = this;
		this.modalEl.addClass("chicago-idea-modal");
		this.titleEl.setText("Got a new idea?");

		contentEl.createEl("p", {
			cls: "chicago-idea-hint",
			text:
				"It goes straight to your inbox as a line to sort out later, so nothing is created yet. " +
				"Write one idea per line to add a few at once.",
		});

		const input = contentEl.createEl("textarea", { cls: "chicago-idea-input" });
		input.rows = 4;
		input.setAttr("placeholder", "Rewrite the parser\nLearn to make bread");

		const buttons = contentEl.createDiv({ cls: "chicago-confirm-buttons" });
		buttons.createSpan({
			cls: "chicago-idea-shortcut",
			text: Platform.isMacOS ? "⌘ + Enter" : "Ctrl + Enter",
		});

		const cancel = buttons.createEl("button", { text: "Cancel" });
		cancel.addEventListener("click", () => this.close());

		const add = buttons.createEl("button", { text: "Add to inbox" });
		add.addEventListener("click", () => this.submit(input.value));

		// Enter has to stay a newline for the multi-line case, so the keyboard
		// path to submit is the modifier one.
		input.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter" && (evt.metaKey || evt.ctrlKey)) {
				evt.preventDefault();
				this.submit(input.value);
			}
		});

		input.focus();
	}

	onClose(): void {
		this.contentEl.empty();
		// Escape, the backdrop and Cancel all land here without having called
		// submit, so treat any unsettled close as "never mind".
		this.settle(null);
	}

	private submit(value: string): void {
		this.settle(value);
		this.close();
	}

	private settle(value: string | null): void {
		if (this.settled) return;
		this.settled = true;
		this.resolveFn?.(value);
	}
}

// Shared by the board's + button and the capture command, so both paths give
// the same dialog and the same feedback.
export async function captureIdea(app: App, inbox: InboxStore): Promise<void> {
	const input = await IdeaModal.ask(app);
	if (input === null) return;

	const result = await inbox.capture(input);
	if (!result.ok) {
		// An empty submit is a no-op, not an error worth a notice.
		if (result.reason === "not-a-note") {
			new Notice(`Chicago: "${result.path}" is not a note, so the idea could not be saved.`, 6000);
		}
		return;
	}

	new Notice(result.added === 1 ? "Added to the inbox." : `Added ${result.added} ideas to the inbox.`);
}
