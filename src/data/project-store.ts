import { App, Plugin, TAbstractFile, TFile } from "obsidian";
import { Project, needsStatusWrite, parseProject } from "../models/project";

// Indexes Markdown notes in the configured projects folder into Project
// objects, keeping them live via vault/metadata events. Notes are the only
// source of truth — this class holds no data that isn't derived from disk.
export class ProjectStore {
	private projects = new Map<string, Project>();
	private listeners = new Set<() => void>();

	constructor(private app: App, private getFolder: () => string) {}

	onChange(callback: () => void): () => void {
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
		const files = this.app.vault.getMarkdownFiles().filter((f) => this.isTracked(f));
		for (const file of files) {
			await this.indexFile(file, { silent: true });
		}
		this.notify();
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
			await this.app.fileManager.processFrontMatter(file, (fm) => {
				if (fm.status !== "active" && fm.status !== "someday") {
					fm.status = "someday";
				}
			});
			const updated = this.app.metadataCache.getFileCache(file)?.frontmatter;
			project = parseProject(file, updated);
		}

		this.projects.set(file.path, project);
		if (!opts.silent) this.notify();
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

	private notify(): void {
		for (const callback of this.listeners) callback();
	}
}
