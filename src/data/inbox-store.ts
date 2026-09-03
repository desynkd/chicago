import { App, Plugin, TAbstractFile, TFile } from "obsidian";
import { FrontMatter } from "../models/project";
import { todayString } from "../util/dates";

export interface InboxLine {
	raw: string;
	text: string;
}

export type PromoteResult = { ok: true } | { ok: false; reason: "line-not-found" };

export type CaptureResult =
	| { ok: true; added: number }
	| { ok: false; reason: "empty" }
	| { ok: false; reason: "not-a-note"; path: string };

const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|]/g;
const MAX_FILENAME_LENGTH = 100;
const CHECKED_TASK = /^-\s*\[[xX]\]/;
const LIST_ITEM = /^-\s*(?:\[ \]\s*)?(.*)$/;
// Leading list or task markers the user may have typed or pasted along with
// the idea itself. The marker must be followed by whitespace, so "-5 degrees"
// keeps its hyphen. A checked box is stripped along with an unchecked one:
// the alternative is writing "- [x] foo" to the file, which parseInboxLines
// skips, and an idea you captured must never fail to appear in the panel.
const PASTED_MARKER = /^\s*(?:[-*+][ \t]+)?(?:\[[ xX]?\][ \t]*)?/;

// A line counts as an inbox idea when it's a plain "- foo" bullet with
// non-empty content. A checked task ("- [x] foo") is treated as already
// handled and skipped, so a line the user has already ticked off stays
// out of the panel.
export function parseInboxLines(content: string): InboxLine[] {
	const lines: InboxLine[] = [];
	for (const raw of content.split(/\r?\n/)) {
		if (CHECKED_TASK.test(raw)) continue;
		const match = LIST_ITEM.exec(raw);
		if (!match) continue;
		const text = match[1].trim();
		if (!text) continue;
		lines.push({ raw, text });
	}
	return lines;
}

// Splits what the user typed into one idea per non-empty line, so a single
// submit can carry a batch — the same shape the monthly paste from a phone
// arrives in.
export function parseIdeaInput(input: string): string[] {
	const ideas: string[] = [];
	for (const raw of input.split(/\r?\n/)) {
		const text = raw.replace(PASTED_MARKER, "").trim();
		if (text) ideas.push(text);
	}
	return ideas;
}

export function sanitiseFilename(text: string): string {
	return text
		.replace(ILLEGAL_FILENAME_CHARS, "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, MAX_FILENAME_LENGTH)
		.trim();
}

// Reads Inbox.md into idea lines and turns them into Someday projects. Holds
// no data of its own beyond a cached parse of the file — like ProjectStore,
// the note is the source of truth.
export class InboxStore {
	private lines: InboxLine[] = [];
	private listeners = new Set<() => void>();

	constructor(
		private app: App,
		private getInboxPath: () => string,
		private getProjectsFolder: () => string,
	) {}

	onChange(callback: () => void): () => void {
		this.listeners.add(callback);
		return () => this.listeners.delete(callback);
	}

	getLines(): InboxLine[] {
		return this.lines;
	}

	async scan(): Promise<void> {
		this.lines = await this.readLines();
		this.notify();
	}

	registerEvents(plugin: Plugin): void {
		plugin.registerEvent(this.app.vault.on("modify", (file) => this.handleVaultEvent(file)));
		plugin.registerEvent(this.app.vault.on("create", (file) => this.handleVaultEvent(file)));
		plugin.registerEvent(this.app.vault.on("delete", (file) => this.handleVaultEvent(file)));
		plugin.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.handleRename(file, oldPath)));
	}

	// Creates the project first and removes the inbox line only after that
	// succeeds — if anything fails partway, the failure mode is "an extra
	// project exists" rather than "the idea silently vanished".
	async promote(line: InboxLine): Promise<PromoteResult> {
		const folder = this.getProjectsFolder().trim().replace(/^\/+|\/+$/g, "");
		if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
			await this.app.vault.createFolder(folder);
		}

		const sanitised = sanitiseFilename(line.text) || "Untitled idea";
		const path = this.uniquePath(folder, sanitised);
		const body = sanitised !== line.text.trim() ? line.text : "";

		const file = await this.app.vault.create(path, body);
		await this.app.fileManager.processFrontMatter(file, (fm: FrontMatter) => {
			fm.status = "someday";
			fm.hours = 0;
			fm.created = todayString();
		});

		const removed = await this.removeLine(line);
		await this.scan();
		return removed ? { ok: true } : { ok: false, reason: "line-not-found" };
	}

	// Appends one bullet per idea. Like removeLine, this re-reads the file
	// immediately before writing rather than trusting the cached parse, so a
	// capture never clobbers an edit made since the panel last rendered.
	async capture(input: string): Promise<CaptureResult> {
		const ideas = parseIdeaInput(input);
		if (ideas.length === 0) return { ok: false, reason: "empty" };

		const path = this.getInboxPath();
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing && !(existing instanceof TFile)) return { ok: false, reason: "not-a-note", path };

		const file = existing instanceof TFile ? existing : await this.createInboxNote(path);
		const content = await this.app.vault.read(file);
		const eol = content.includes("\r\n") ? "\r\n" : "\n";
		const lines = content.split(/\r?\n/);

		// Inserted after the last non-empty line rather than at the very end,
		// so the new bullets join the list instead of being pushed below any
		// trailing blank lines the file happens to carry.
		let insertAt = lines.length;
		while (insertAt > 0 && lines[insertAt - 1].trim() === "") insertAt--;
		lines.splice(insertAt, 0, ...ideas.map((idea) => `- ${idea}`));

		await this.app.vault.modify(file, lines.join(eol));
		await this.scan();
		return { ok: true, added: ideas.length };
	}

	// The inbox note is allowed not to exist yet — a vault that has never been
	// triaged is the normal starting state, and refusing to capture until the
	// user hand-creates the file would be friction for nothing. The path is
	// used exactly as configured, extension included, so what gets created is
	// the same path readLines looks for.
	private async createInboxNote(path: string): Promise<TFile> {
		const folder = path.slice(0, path.lastIndexOf("/"));
		if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
			await this.app.vault.createFolder(folder);
		}
		return this.app.vault.create(path, "");
	}

	async discard(line: InboxLine): Promise<boolean> {
		const removed = await this.removeLine(line);
		if (removed) await this.scan();
		return removed;
	}

	private uniquePath(folder: string, baseName: string): string {
		const prefix = folder ? `${folder}/` : "";
		const candidate = `${prefix}${baseName}.md`;
		if (!this.app.vault.getAbstractFileByPath(candidate)) return candidate;

		for (let n = 2; ; n++) {
			const numbered = `${prefix}${baseName} (${n}).md`;
			if (!this.app.vault.getAbstractFileByPath(numbered)) return numbered;
		}
	}

	// Re-reads the file immediately before writing and removes only the
	// first line matching `raw` exactly, so hand-edits made to other lines
	// since the panel last rendered are never clobbered by a stale copy.
	private async removeLine(line: InboxLine): Promise<boolean> {
		const file = this.app.vault.getAbstractFileByPath(this.getInboxPath());
		if (!(file instanceof TFile)) return false;

		const content = await this.app.vault.read(file);
		const eol = content.includes("\r\n") ? "\r\n" : "\n";
		const lines = content.split(/\r?\n/);
		const index = lines.indexOf(line.raw);
		if (index === -1) return false;

		lines.splice(index, 1);
		await this.app.vault.modify(file, lines.join(eol));
		return true;
	}

	private async readLines(): Promise<InboxLine[]> {
		const file = this.app.vault.getAbstractFileByPath(this.getInboxPath());
		if (!(file instanceof TFile)) return [];
		const content = await this.app.vault.read(file);
		return parseInboxLines(content);
	}

	private handleVaultEvent(file: TAbstractFile): void {
		if (file.path !== this.getInboxPath()) return;
		void this.scan();
	}

	private handleRename(file: TAbstractFile, oldPath: string): void {
		if (file.path === this.getInboxPath() || oldPath === this.getInboxPath()) void this.scan();
	}

	private notify(): void {
		for (const callback of this.listeners) callback();
	}
}
