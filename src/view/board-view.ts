import { ItemView, Menu, Notice, WorkspaceLeaf } from "obsidian";
import { ProjectStore } from "../data/project-store";
import { ChicagoSettings } from "../settings";
import { Project, ProjectStatus } from "../models/project";
import { formatRelative } from "../util/dates";
import { ConfirmModal } from "./confirm-modal";

// Custom drag data type carrying a project's vault path between cards and
// columns — kept off "text/plain" so the drag doesn't act on the name text.
const DRAG_MIME = "application/x-chicago-project-path";

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
		this.registerDropZone(column, (path) => void this.activate(path));
		return column;
	}

	private renderActiveCard(project: Project, settings: ChicagoSettings): HTMLElement {
		const card = createDiv({ cls: "chicago-card chicago-card-active" });
		card.setAttr("draggable", "true");

		const head = card.createDiv({ cls: "chicago-card-head" });
		const nameEl = head.createEl("a", { cls: "chicago-card-name", text: project.name, href: "#" });
		nameEl.addEventListener("click", (evt) => {
			evt.preventDefault();
			void this.app.workspace.getLeaf(false).openFile(project.file);
		});

		const controls = head.createDiv({ cls: "chicago-card-controls" });
		const parkBtn = controls.createEl("button", { cls: "chicago-action-button", text: "Park" });
		parkBtn.addEventListener("click", () => void this.park(project.path));
		this.attachCardMenu(controls, card, project);

		this.attachDrag(card, project.path);

		const meta = card.createDiv({ cls: "chicago-card-meta" });
		meta.createSpan({ text: `${formatHours(project.hours)}h` });
		meta.createSpan({ text: " · " });
		meta.createSpan({ text: formatRelative(project.touched) });

		const next = card.createDiv({ cls: "chicago-card-next" });
		this.renderNextDisplay(next, project);

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

	// Displays the next action as a clickable line (a placeholder when empty,
	// per SPEC §4's "make its absence obvious"). Clicking or activating it via
	// keyboard swaps in an inline input — no modal, single line only.
	private renderNextDisplay(container: HTMLElement, project: Project): void {
		container.empty();
		const trigger = container.createEl("span", {
			cls: project.next ? "chicago-next-text" : "chicago-next-placeholder",
			text: project.next ? `▸ next: ${project.next}` : "▸ next: (set one)",
		});
		trigger.tabIndex = 0;
		trigger.setAttr("role", "button");
		trigger.addEventListener("click", () => this.renderNextEditor(container, project));
		trigger.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter" || evt.key === " ") {
				evt.preventDefault();
				this.renderNextEditor(container, project);
			}
		});
	}

	private renderNextEditor(container: HTMLElement, project: Project): void {
		container.empty();
		const input = container.createEl("input", {
			cls: "chicago-next-input",
			type: "text",
			value: project.next,
			attr: { placeholder: "next action" },
		});
		input.focus();
		input.select();

		let settled = false;
		const commit = async (): Promise<void> => {
			if (settled) return;
			settled = true;
			const value = input.value.trim();
			if (value === project.next) {
				this.renderNextDisplay(container, project);
				return;
			}
			await this.store.setNext(project.path, value);
		};
		const cancel = (): void => {
			if (settled) return;
			settled = true;
			this.renderNextDisplay(container, project);
		};

		input.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter") {
				evt.preventDefault();
				void commit();
			} else if (evt.key === "Escape") {
				evt.preventDefault();
				cancel();
			}
		});
		input.addEventListener("blur", () => void commit());
	}

	private renderSomedayColumn(someday: Project[]): HTMLElement {
		const column = createDiv({ cls: "chicago-column chicago-column-someday" });
		const header = column.createDiv({ cls: "chicago-column-header" });
		header.createSpan({ text: "Someday", cls: "chicago-column-title" });
		header.createSpan({ text: `${someday.length}`, cls: "chicago-column-count" });

		if (someday.length === 0) {
			column.createDiv({ cls: "chicago-empty-state", text: "No someday projects." });
			this.registerDropZone(column, (path) => void this.park(path));
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

		this.registerDropZone(column, (path) => void this.park(path));
		return column;
	}

	private renderSomedayCard(project: Project): HTMLElement {
		const card = createDiv({ cls: "chicago-card chicago-card-someday" });
		card.setAttr("draggable", "true");

		const head = card.createDiv({ cls: "chicago-card-head" });
		const nameEl = head.createEl("a", { cls: "chicago-card-name", text: project.name, href: "#" });
		nameEl.addEventListener("click", (evt) => {
			evt.preventDefault();
			void this.app.workspace.getLeaf(false).openFile(project.file);
		});

		const controls = head.createDiv({ cls: "chicago-card-controls" });
		const activateBtn = controls.createEl("button", { cls: "chicago-action-button", text: "Activate" });
		activateBtn.addEventListener("click", () => void this.activate(project.path));
		this.attachCardMenu(controls, card, project);

		this.attachDrag(card, project.path);

		this.cardMeta.set(project.path, { el: card, status: project.status, category: project.category, name: project.name });
		return card;
	}

	private async activate(path: string): Promise<void> {
		const settings = this.getSettings();
		const result = await this.store.activate(path, settings.activeLimit);
		if (result.ok) return;

		if (result.reason === "at-cap") {
			new Notice(
				`Active is full (${settings.activeLimit}/${settings.activeLimit}). Park one of these first: ${result.activeNames.join(", ")}.`,
				8000,
			);
		}
	}

	private async park(path: string): Promise<void> {
		await this.store.park(path);
	}

	private async deleteProject(project: Project): Promise<void> {
		if (project.hours > 0) {
			const confirmed = await ConfirmModal.ask(
				this.app,
				`Delete "${project.name}"? It has ${formatHours(project.hours)} hours logged. The note goes to your system trash.`,
			);
			if (!confirmed) return;
		}
		await this.store.deleteProject(project.path);
	}

	private attachCardMenu(controls: HTMLElement, card: HTMLElement, project: Project): void {
		const menuBtn = controls.createEl("button", { cls: "chicago-menu-button", text: "⋮" });
		menuBtn.setAttr("aria-label", "More actions");
		menuBtn.addEventListener("click", (evt) => {
			evt.stopPropagation();
			this.openCardMenu(evt, project);
		});
		card.addEventListener("contextmenu", (evt) => {
			evt.preventDefault();
			this.openCardMenu(evt, project);
		});
	}

	private openCardMenu(evt: MouseEvent, project: Project): void {
		const menu = new Menu();
		if (project.status === "active") {
			menu.addItem((item) => item.setTitle("Park").setIcon("arrow-down").onClick(() => void this.park(project.path)));
		} else {
			menu.addItem((item) => item.setTitle("Activate").setIcon("arrow-up").onClick(() => void this.activate(project.path)));
		}
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Delete")
				.setIcon("trash")
				.onClick(() => void this.deleteProject(project)),
		);
		menu.showAtMouseEvent(evt);
	}

	// Drag is an enhancement only — every action it performs (activate/park)
	// is already reachable via the visible buttons and the "⋮" menu above, so
	// nothing here is the only path to a feature (see SPEC §3, §5.5).
	private attachDrag(card: HTMLElement, path: string): void {
		card.addEventListener("dragstart", (evt) => {
			evt.dataTransfer?.setData(DRAG_MIME, path);
			if (evt.dataTransfer) evt.dataTransfer.effectAllowed = "move";
			card.addClass("chicago-dragging");
		});
		card.addEventListener("dragend", () => card.removeClass("chicago-dragging"));
	}

	private registerDropZone(column: HTMLElement, onDrop: (path: string) => void): void {
		column.addEventListener("dragover", (evt) => {
			if (!evt.dataTransfer?.types.includes(DRAG_MIME)) return;
			evt.preventDefault();
			evt.dataTransfer.dropEffect = "move";
			column.addClass("chicago-drop-target");
		});
		column.addEventListener("dragleave", (evt) => {
			const related = evt.relatedTarget as Node | null;
			if (!related || !column.contains(related)) {
				column.removeClass("chicago-drop-target");
			}
		});
		column.addEventListener("drop", (evt) => {
			const path = evt.dataTransfer?.getData(DRAG_MIME);
			column.removeClass("chicago-drop-target");
			if (!path) return;
			evt.preventDefault();
			onDrop(path);
		});
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
