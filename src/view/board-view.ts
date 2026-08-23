import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { ProjectStore } from "../data/project-store";
import { ChicagoSettings } from "../settings";
import { Project, ProjectStatus } from "../models/project";
import { formatRelative } from "../util/dates";

export const VIEW_TYPE_CHICAGO_BOARD = "chicago-board";

interface CardMeta {
	el: HTMLElement;
	status: ProjectStatus;
	category: string | null;
	name: string;
}

export class ChicagoBoardView extends ItemView {
	private unsubscribe: (() => void) | null = null;
	// Tracks the rendered card for each project path so a change to a single
	// project can patch just that card instead of rebuilding the whole board
	// (full rebuild causes flicker and loses scroll position — see SPEC §5.2).
	private cardMeta = new Map<string, CardMeta>();

	constructor(
		leaf: WorkspaceLeaf,
		private store: ProjectStore,
		private getSettings: () => ChicagoSettings,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_CHICAGO_BOARD;
	}

	getDisplayText(): string {
		return "Chicago";
	}

	getIcon(): string {
		return "layout-dashboard";
	}

	async onOpen(): Promise<void> {
		this.unsubscribe = this.store.onChange((path) => this.handleStoreChange(path));
		this.render();
	}

	async onClose(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = null;
	}

	// A change to exactly one already-rendered project, with no change to the
	// things that would move or resort its card, can be patched in place.
	// Anything else (new/deleted file, status/category/name change, or a
	// multi-file refresh) falls back to a full render.
	private handleStoreChange(path?: string): void {
		if (!path) {
			this.render();
			return;
		}

		const project = this.store.get(path);
		const prev = this.cardMeta.get(path);
		if (!project || !prev || prev.status !== project.status || prev.category !== project.category || prev.name !== project.name) {
			this.render();
			return;
		}

		this.patchCard(path, project);
	}

	private patchCard(path: string, project: Project): void {
		const prev = this.cardMeta.get(path);
		if (!prev) return;

		const settings = this.getSettings();
		const replacement = project.status === "active" ? this.renderActiveCard(project, settings) : this.renderSomedayCard(project);
		prev.el.replaceWith(replacement);
	}

	private render(): void {
		const container = this.contentEl;
		container.empty();
		container.addClass("chicago-board");
		this.cardMeta.clear();

		const settings = this.getSettings();
		const active = [...this.store.getActive()].sort((a, b) => a.name.localeCompare(b.name));
		const someday = this.store.getSomeday();

		container.appendChild(this.renderActiveColumn(active, settings));
		container.appendChild(this.renderSomedayColumn(someday));
	}

	private renderActiveColumn(active: Project[], settings: ChicagoSettings): HTMLElement {
		const column = createDiv({ cls: "chicago-column chicago-column-active" });
		const header = column.createDiv({ cls: "chicago-column-header" });
		header.createSpan({ text: "Active", cls: "chicago-column-title" });

		const overLimit = active.length > settings.activeLimit;
		header.createSpan({
			text: `${active.length}/${settings.activeLimit}`,
			cls: overLimit ? "chicago-column-count chicago-over-limit" : "chicago-column-count",
		});

		if (active.length === 0) {
			column.createDiv({ cls: "chicago-empty-state", text: "No active projects." });
			return column;
		}

		const list = column.createDiv({ cls: "chicago-card-list" });
		for (const project of active) {
			list.appendChild(this.renderActiveCard(project, settings));
		}
		return column;
	}

	private renderActiveCard(project: Project, settings: ChicagoSettings): HTMLElement {
		const card = createDiv({ cls: "chicago-card chicago-card-active" });

		const nameEl = card.createEl("a", { cls: "chicago-card-name", text: project.name, href: "#" });
		nameEl.addEventListener("click", (evt) => {
			evt.preventDefault();
			void this.app.workspace.getLeaf(false).openFile(project.file);
		});

		const meta = card.createDiv({ cls: "chicago-card-meta" });
		meta.createSpan({ text: `${formatHours(project.hours)}h` });
		meta.createSpan({ text: " · " });
		meta.createSpan({ text: formatRelative(project.touched) });

		const next = card.createDiv({ cls: "chicago-card-next" });
		if (project.next) {
			next.createSpan({ text: `▸ next: ${project.next}` });
		} else {
			next.createSpan({ cls: "chicago-next-placeholder", text: "▸ next: (set one)" });
		}

		const buttons = card.createDiv({ cls: "chicago-hour-buttons" });
		for (const increment of settings.hourIncrements) {
			const button = buttons.createEl("button", {
				cls: "chicago-hour-button",
				text: `+${formatHours(increment)}`,
			});
			button.addEventListener("click", () => void this.logHours(project.path, increment));
		}

		this.cardMeta.set(project.path, { el: card, status: project.status, category: project.category, name: project.name });
		return card;
	}

	private async logHours(path: string, delta: number): Promise<void> {
		const updated = await this.store.logHours(path, delta);
		if (!updated) return;

		const message = createFragment((frag) => {
			frag.createSpan({ text: `Logged +${formatHours(delta)}h to ${updated.name}. ` });
			const undo = frag.createEl("a", { text: "Undo", href: "#", cls: "chicago-undo-link" });
			undo.addEventListener("click", (evt) => {
				evt.preventDefault();
				notice.hide();
				void this.store.logHours(path, -delta);
			});
		});
		const notice = new Notice(message, 8000);
	}

	private renderSomedayColumn(someday: Project[]): HTMLElement {
		const column = createDiv({ cls: "chicago-column chicago-column-someday" });
		const header = column.createDiv({ cls: "chicago-column-header" });
		header.createSpan({ text: "Someday", cls: "chicago-column-title" });
		header.createSpan({ text: `${someday.length}`, cls: "chicago-column-count" });

		if (someday.length === 0) {
			column.createDiv({ cls: "chicago-empty-state", text: "No someday projects." });
			return column;
		}

		for (const [category, projects] of groupByCategory(someday)) {
			const group = column.createDiv({ cls: "chicago-category-group" });
			group.createDiv({ cls: "chicago-category-header", text: category });
			const list = group.createDiv({ cls: "chicago-card-list" });
			for (const project of projects) {
				list.appendChild(this.renderSomedayCard(project));
			}
		}

		return column;
	}

	private renderSomedayCard(project: Project): HTMLElement {
		const card = createDiv({ cls: "chicago-card chicago-card-someday" });

		const nameEl = card.createEl("a", { cls: "chicago-card-name", text: project.name, href: "#" });
		nameEl.addEventListener("click", (evt) => {
			evt.preventDefault();
			void this.app.workspace.getLeaf(false).openFile(project.file);
		});

		this.cardMeta.set(project.path, { el: card, status: project.status, category: project.category, name: project.name });
		return card;
	}
}

// Alphabetical by category, with a trailing "Uncategorised" group for
// projects that have none — matches §5.4 of the spec.
function groupByCategory(projects: Project[]): Array<[string, Project[]]> {
	const UNCATEGORISED = "Uncategorised";
	const groups = new Map<string, Project[]>();

	for (const project of projects) {
		const key = project.category ?? UNCATEGORISED;
		const list = groups.get(key);
		if (list) {
			list.push(project);
		} else {
			groups.set(key, [project]);
		}
	}

	for (const list of groups.values()) {
		list.sort((a, b) => a.name.localeCompare(b.name));
	}

	const categories = [...groups.keys()].filter((c) => c !== UNCATEGORISED).sort((a, b) => a.localeCompare(b));
	if (groups.has(UNCATEGORISED)) categories.push(UNCATEGORISED);

	return categories.map((c) => [c, groups.get(c) as Project[]]);
}

function formatHours(hours: number): string {
	return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}
