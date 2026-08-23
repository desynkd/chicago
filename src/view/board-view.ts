import { ItemView, WorkspaceLeaf } from "obsidian";
import { ProjectStore } from "../data/project-store";
import { ChicagoSettings } from "../settings";
import { Project } from "../models/project";
import { formatRelative } from "../util/dates";

export const VIEW_TYPE_CHICAGO_BOARD = "chicago-board";

export class ChicagoBoardView extends ItemView {
	private unsubscribe: (() => void) | null = null;

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
		this.unsubscribe = this.store.onChange(() => this.render());
		this.render();
	}

	async onClose(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = null;
	}

	private render(): void {
		const container = this.contentEl;
		container.empty();
		container.addClass("chicago-board");

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
			list.appendChild(this.renderActiveCard(project));
		}
		return column;
	}

	private renderActiveCard(project: Project): HTMLElement {
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

		return card;
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
