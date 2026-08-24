import { App, Plugin, TAbstractFile, TFile } from "obsidian";
import { coerceHours, FrontMatter, Project, needsStatusWrite, parseProject } from "../models/project";
import { todayString } from "../util/dates";

export type ActivateResult =
	| { ok: true; project: Project }
	| { ok: false; reason: "at-cap"; activeNames: string[] }
	| { ok: false; reason: "not-found" };

// Indexes Markdown notes in the configured projects folder into Project
// objects, keeping them live via vault/metadata events. Notes are the only
// source of truth — this class holds no data that isn't derived from disk.
export class ProjectStore {
	private projects = new Map<string, Project>();
	private listeners = new Set<(path?: string) => void>();
	// Serialises frontmatter writes per file so two rapid hour-log clicks on
	// the same card read-modify-write in sequence instead of racing and
	// dropping one of the increments.
	private writeQueues = new Map<string, Promise<unknown>>();
	// Activate/park/delete share one global queue, not the per-file queue
	// above: enforcing the WIP cap requires checking the active count across
	// ALL files atomically, so two simultaneous activations (of two different
	// projects) must not both read the count before either one's write lands.
	private statusQueue: Promise<unknown> = Promise.resolve();

	constructor(private app: App, private getFolder: () => string) {}

	// `path` is set when exactly one project changed (so a view can patch just
	// that card) and omitted for broader refreshes (initial scan, rename).
	onChange(callback: (path?: string) => void): () => void {
		this.listeners.add(callback);
		return () => this.listeners.delete(callback);
	}

	getAll(): Project[] {
		return [...this.projects.values()];
	}

	getActive(): Project[] {
		return this.getAll().filter((p) => p.status === "active");
	}

	getSomeday(): Project[] {
		return this.getAll().filter((p) => p.status === "someday");
	}

	get(path: string): Project | undefined {
		return this.projects.get(path);
	}

	async scan(): Promise<void> {
		this.projects.clear();
		for (const file of this.folderNotes()) {
			await this.indexFile(file, { silent: true });
		}
		this.notify();
	}

	// Reads the configured folder's own children rather than filtering every
	// Markdown file in the vault. Tracked notes only ever sit one level inside
	// that folder, so walking the whole vault to find them asks for a great
	// deal more of it than the plugin has any use for.
	private folderNotes(): TFile[] {
		const folder = this.getFolder().trim().replace(/^\/+|\/+$/g, "");
		const target = folder ? this.app.vault.getFolderByPath(folder) : this.app.vault.getRoot();
		if (!target) return [];
		return target.children.filter((f): f is TFile => f instanceof TFile && f.extension === "md");
	}

	registerEvents(plugin: Plugin): void {
		plugin.registerEvent(this.app.vault.on("create", (file) => this.handleCreate(file)));
		plugin.registerEvent(this.app.vault.on("delete", (file) => this.handleDelete(file)));
		plugin.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.handleRename(file, oldPath)));
		plugin.registerEvent(this.app.vault.on("modify", (file) => this.handleModify(file)));
		plugin.registerEvent(this.app.metadataCache.on("changed", (file) => this.handleModify(file)));
	}

	private isTracked(file: TAbstractFile): file is TFile {
		if (!(file instanceof TFile) || file.extension !== "md") return false;
		const parentPath = file.parent?.path ?? "";
		const normalizedParent = parentPath === "/" ? "" : parentPath;
		const normalizedFolder = this.getFolder().trim().replace(/^\/+|\/+$/g, "");
		return normalizedParent === normalizedFolder;
	}

	private async indexFile(file: TFile, opts: { silent?: boolean } = {}): Promise<void> {
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		let project = parseProject(file, frontmatter);

		if (needsStatusWrite(frontmatter)) {
			await this.app.fileManager.processFrontMatter(file, (fm: FrontMatter) => {
				if (fm.status !== "active" && fm.status !== "someday") {
					fm.status = "someday";
				}
			});
			const updated = this.app.metadataCache.getFileCache(file)?.frontmatter;
			project = parseProject(file, updated);
		}

		this.projects.set(file.path, project);
		if (!opts.silent) this.notify(file.path);
	}

	// Adds `delta` hours (clamped at 0) and stamps `touched` to today, in one
	// atomic read-modify-write per file. Returns the updated project, or null
	// if the file is no longer tracked (deleted/moved out from under the click).
	async logHours(path: string, delta: number): Promise<Project | null> {
		return this.enqueue(path, async () => {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile) || !this.projects.has(path)) return null;

			await this.app.fileManager.processFrontMatter(file, (fm: FrontMatter) => {
				const next = coerceHours(fm.hours) + delta;
				fm.hours = next < 0 ? 0 : Math.round(next * 100) / 100;
				fm.touched = todayString();
			});

			await this.indexFile(file, { silent: true });
			const project = this.projects.get(path) ?? null;
			this.notify(path);
			return project;
		});
	}

	// Sets the one-line next action. Single-file, no cross-file invariant to
	// protect, so this uses the per-file queue rather than the global one.
	async setNext(path: string, value: string): Promise<Project | null> {
		return this.enqueue(path, async () => {
			const project = this.projects.get(path);
			if (!project) return null;

			await this.app.fileManager.processFrontMatter(project.file, (fm: FrontMatter) => {
				fm.next = value;
			});
			await this.indexFile(project.file, { silent: true });
			const updated = this.projects.get(path) ?? null;
			this.notify(path);
			return updated;
		});
	}

	private enqueue<T>(path: string, task: () => Promise<T>): Promise<T> {
		const prior = this.writeQueues.get(path) ?? Promise.resolve();
		const run = prior.then(task, task);
		this.writeQueues.set(
			path,
			run.then(
				() => undefined,
				() => undefined,
			),
		);
		return run;
	}

	private enqueueGlobal<T>(task: () => Promise<T>): Promise<T> {
		const run = this.statusQueue.then(task, task);
		this.statusQueue = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}

	// Promotes a Someday project to Active. Fails without touching the file if
	// doing so would exceed `limit` — the WIP cap is the entire point of the
	// plugin, so this never auto-demotes another project to make room.
	async activate(path: string, limit: number): Promise<ActivateResult> {
		return this.enqueueGlobal(async () => {
			const project = this.projects.get(path);
			if (!project) return { ok: false, reason: "not-found" };
			if (project.status === "active") return { ok: true, project };

			if (this.getActive().length >= limit) {
				return {
					ok: false,
					reason: "at-cap",
					activeNames: this.getActive()
						.map((p) => p.name)
						.sort((a, b) => a.localeCompare(b)),
				};
			}

			await this.app.fileManager.processFrontMatter(project.file, (fm: FrontMatter) => {
				fm.status = "active";
			});
			await this.indexFile(project.file, { silent: true });
			const updated = this.projects.get(path);
			this.notify(path);
			return updated ? { ok: true, project: updated } : { ok: false, reason: "not-found" };
		});
	}

	// Demoting is always allowed and touches only `status` — hours, touched,
	// and next survive untouched so re-activating restores full context.
	async park(path: string): Promise<Project | null> {
		return this.enqueueGlobal(async () => {
			const project = this.projects.get(path);
			if (!project) return null;
			if (project.status === "someday") return project;

			await this.app.fileManager.processFrontMatter(project.file, (fm: FrontMatter) => {
				fm.status = "someday";
			});
			await this.indexFile(project.file, { silent: true });
			const updated = this.projects.get(path) ?? null;
			this.notify(path);
			return updated;
		});
	}

	// Uses the vault trash (never a hard delete) so the user's trash
	// preference is respected. The vault "delete" event removes it from the
	// in-memory index and notifies listeners once Obsidian confirms it.
	async deleteProject(path: string): Promise<void> {
		return this.enqueueGlobal(async () => {
			const project = this.projects.get(path);
			if (!project) return;
			await this.app.fileManager.trashFile(project.file);
		});
	}

	private handleCreate(file: TAbstractFile): void {
		if (!this.isTracked(file)) return;
		void this.indexFile(file);
	}

	private handleDelete(file: TAbstractFile): void {
		if (!(file instanceof TFile)) return;
		if (this.projects.delete(file.path)) this.notify();
	}

	private handleRename(file: TAbstractFile, oldPath: string): void {
		const hadEntry = this.projects.delete(oldPath);
		if (this.isTracked(file)) {
			void this.indexFile(file);
		} else if (hadEntry) {
			this.notify();
		}
	}

	private handleModify(file: TAbstractFile): void {
		if (!this.isTracked(file)) return;
		void this.indexFile(file);
	}

	private notify(path?: string): void {
		for (const callback of this.listeners) callback(path);
	}
}
