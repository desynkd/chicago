import { ItemView, Menu, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import { ProjectStore } from "../data/project-store";
import { InboxStore, InboxLine } from "../data/inbox-store";
import { ChicagoSettings } from "../settings";
import { Project, ProjectStatus } from "../models/project";
import { computeStaleness, formatRelative, Staleness } from "../util/dates";
import { ConfirmModal } from "./confirm-modal";
import { CHICAGO_ICON_ID } from "../icon";

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
	private unsubscribeInbox: (() => void) | null = null;
	// Tracks the rendered card for each project path so a change to a single
	// project can patch just that card instead of rebuilding the whole board
	// (a full rebuild flickers and loses the scroll position).
	private cardMeta = new Map<string, CardMeta>();

	constructor(
		leaf: WorkspaceLeaf,
		private store: ProjectStore,
		private inbox: InboxStore,
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
		return CHICAGO_ICON_ID;
	}

	async onOpen(): Promise<void> {
		this.unsubscribe = this.store.onChange((path) => this.handleStoreChange(path));
		this.unsubscribeInbox = this.inbox.onChange(() => this.render());
		this.render();
	}

	async onClose(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.unsubscribeInbox?.();
		this.unsubscribeInbox = null;
	}

	// Called by the settings tab after a setting that affects rendering
	// (WIP limit, hour increments, staleness thresholds) changes — those
	// aren't project or inbox data, so no store event fires on their own.
	refresh(): void {
		this.render();
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

	// Active on top in a tray of its own, then Ideas inbox and Suspended
	// side by side beneath it. Active carries no heading: its position and
	// its enclosure are what identify it.
	private render(): void {
		const container = this.contentEl;
		container.empty();
		container.addClass("chicago-board");
		this.cardMeta.clear();

		const settings = this.getSettings();
		const active = [...this.store.getActive()].sort((a, b) => a.name.localeCompare(b.name));
		const someday = this.store.getSomeday();

		container.appendChild(this.renderActive(active, settings));

		const lower = container.createDiv({ cls: "chicago-lower" });
		lower.appendChild(this.renderInboxSection(this.inbox.getLines()));
		lower.appendChild(this.renderSuspended(someday));
	}

	private renderActive(active: Project[], settings: ChicagoSettings): HTMLElement {
		const tray = createDiv({ cls: "chicago-active chicago-tray" });

		// The WIP rule is enforced on the action — activate() refuses past the
		// cap — so a permanent gauge would only ever read "n of n". A count is
		// worth showing exactly when the board is already over the limit, which
		// is reachable only by hand-editing a note's frontmatter.
		if (active.length > settings.activeLimit) {
			tray.createSpan({
				cls: "chicago-wip-badge",
				text: `${active.length} / ${settings.activeLimit}`,
			});
		}

		if (active.length === 0) {
			tray.createDiv({ cls: "chicago-empty-state", text: "Nothing active" });
		} else {
			const grid = tray.createDiv({ cls: "chicago-active-grid" });
			for (const project of active) {
				grid.appendChild(this.renderActiveCard(project, settings));
			}
		}

		this.registerDropZone(tray, (path) => void this.activate(path));
		return tray;
	}

	// This panel used to hide itself when the inbox was empty. It now shares
	// a row with Suspended, and vanishing would leave that row lopsided, so
	// it holds its place and says it is clear instead.
	private renderInboxSection(lines: InboxLine[]): HTMLElement {
		const section = createDiv({ cls: "chicago-section" });
		section.createDiv({ cls: "chicago-section-title", text: "Ideas inbox" });

		if (lines.length === 0) {
			section.createDiv({ cls: "chicago-empty-state", text: "Inbox is clear" });
			return section;
		}

		const list = section.createDiv({ cls: "chicago-card-list" });
		for (const line of lines) {
			list.appendChild(this.renderInboxRow(line));
		}
		return section;
	}

	private renderInboxRow(line: InboxLine): HTMLElement {
		const row = createDiv({ cls: "chicago-card chicago-inbox-row" });
		row.createSpan({ cls: "chicago-inbox-text", text: line.text });

		const controls = row.createDiv({ cls: "chicago-card-controls" });
		this.attachMenu(controls, row, (evt) => this.openInboxMenu(evt, line));
		return row;
	}

	private openInboxMenu(evt: MouseEvent, line: InboxLine): void {
		const menu = new Menu();
		menu.addItem((item) => item.setTitle("Promote").setIcon("arrow-up").onClick(() => void this.promoteInboxLine(line)));
		menu.addItem((item) => item.setTitle("Discard").setIcon("trash").onClick(() => void this.discardInboxLine(line)));
		menu.showAtMouseEvent(evt);
	}

	private async promoteInboxLine(line: InboxLine): Promise<void> {
		const result = await this.inbox.promote(line);
		if (!result.ok) {
			new Notice("Created the project, but that inbox line had already changed and could not be removed.", 6000);
		}
	}

	private async discardInboxLine(line: InboxLine): Promise<void> {
		const removed = await this.inbox.discard(line);
		if (!removed) new Notice("That line is no longer in the inbox.", 4000);
	}

	private renderSuspended(someday: Project[]): HTMLElement {
		const section = createDiv({ cls: "chicago-section chicago-tray" });
		section.createDiv({ cls: "chicago-section-title", text: "Suspended" });

		if (someday.length === 0) {
			section.createDiv({ cls: "chicago-empty-state", text: "Nothing suspended" });
		} else {
			for (const [category, projects] of groupByCategory(someday)) {
				const group = section.createDiv({ cls: "chicago-category-group" });
				group.createDiv({ cls: "chicago-category-header", text: category });
				const list = group.createDiv({ cls: "chicago-card-list" });
				for (const project of projects) {
					list.appendChild(this.renderSomedayCard(project));
				}
			}
		}

		this.registerDropZone(section, (path) => void this.park(path));
		return section;
	}

	private renderActiveCard(project: Project, settings: ChicagoSettings): HTMLElement {
		const card = createDiv({ cls: "chicago-card chicago-card-active" });
		card.setAttr("draggable", "true");

		const staleness = computeStaleness(project.touched, settings.staleWarningDays, settings.staleStaleDays);
		if (staleness !== "normal") card.addClass(`chicago-stale-${staleness}`);

		const head = card.createDiv({ cls: "chicago-card-head" });
		this.renderCardName(head, project);

		const controls = head.createDiv({ cls: "chicago-card-controls" });
		// Staleness is carried by colour alone, so the dot needs a label for
		// anyone not reading it visually.
		const dot = controls.createSpan({ cls: "chicago-status-dot" });
		dot.setAttr("role", "img");
		dot.setAttr("aria-label", stalenessLabel(staleness, project.touched));
		this.attachMenu(controls, card, (evt) => this.openCardMenu(evt, project));

		this.attachDrag(card, project.path);

		card.createDiv({
			cls: "chicago-card-meta",
			text: `${formatHours(project.hours)} ${project.hours === 1 ? "hour" : "hours"} • ${formatRelative(project.touched)}`,
		});

		// Pinned to the bottom edge so the next action and the hour buttons
		// line up across every card in the grid regardless of title length.
		const foot = card.createDiv({ cls: "chicago-card-foot" });
		const next = foot.createDiv({ cls: "chicago-card-next" });
		this.renderNextDisplay(next, project);

		const buttons = foot.createDiv({ cls: "chicago-hour-buttons" });
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

	private renderSomedayCard(project: Project): HTMLElement {
		const card = createDiv({ cls: "chicago-card chicago-card-someday" });
		card.setAttr("draggable", "true");

		const head = card.createDiv({ cls: "chicago-card-head" });
		this.renderCardName(head, project);

		const controls = head.createDiv({ cls: "chicago-card-controls" });
		this.attachMenu(controls, card, (evt) => this.openCardMenu(evt, project));

		this.attachDrag(card, project.path);

		this.cardMeta.set(project.path, { el: card, status: project.status, category: project.category, name: project.name });
		return card;
	}

	// Titles clip to a single line, so the full name goes on the tooltip.
	private renderCardName(head: HTMLElement, project: Project): void {
		const nameEl = head.createEl("a", { cls: "chicago-card-name", text: project.name, href: "#" });
		nameEl.setAttr("title", project.name);
		nameEl.addEventListener("click", (evt) => {
			evt.preventDefault();
			void this.app.workspace.getLeaf(false).openFile(project.file);
		});
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

	// Displays the next action as a clickable line. When empty it renders a
	// placeholder rather than nothing: this is the field that answers "where
	// did I leave off", so its absence has to be visible. Clicking or
	// activating it by keyboard swaps in an inline input — no modal, one line.
	private renderNextDisplay(container: HTMLElement, project: Project): void {
		container.empty();
		const trigger = container.createEl("span", {
			cls: project.next ? "chicago-next-text" : "chicago-next-placeholder",
			text: project.next ? `▶ next: ${project.next}` : "▶ next: (set one)",
		});
		trigger.tabIndex = 0;
		trigger.setAttr("role", "button");
		if (project.next) trigger.setAttr("title", project.next);
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

	// One "⋮" button, plus right-click anywhere on the row, both opening the
	// same menu. Every verb the board offers lives in there now — Park,
	// Activate, Delete, Promote, Discard — so a card's surface carries
	// nothing but its hour buttons.
	private attachMenu(controls: HTMLElement, row: HTMLElement, open: (evt: MouseEvent) => void): void {
		const button = controls.createEl("button", { cls: "chicago-menu-button" });
		button.setAttr("aria-label", "More actions");
		setIcon(button, "more-vertical");
		button.addEventListener("click", (evt) => {
			evt.stopPropagation();
			open(evt);
		});
		row.addEventListener("contextmenu", (evt) => {
			evt.preventDefault();
			open(evt);
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
	// is already reachable from the menu above, so nothing here is the only
	// path to a feature. That keeps the board usable by keyboard, by screen
	// reader, and on any platform where dragging is awkward.
	private attachDrag(card: HTMLElement, path: string): void {
		card.addEventListener("dragstart", (evt) => {
			evt.dataTransfer?.setData(DRAG_MIME, path);
			if (evt.dataTransfer) evt.dataTransfer.effectAllowed = "move";
			card.addClass("chicago-dragging");
		});
		card.addEventListener("dragend", () => card.removeClass("chicago-dragging"));
	}

	private registerDropZone(zone: HTMLElement, onDrop: (path: string) => void): void {
		zone.addEventListener("dragover", (evt) => {
			if (!evt.dataTransfer?.types.includes(DRAG_MIME)) return;
			evt.preventDefault();
			evt.dataTransfer.dropEffect = "move";
			zone.addClass("chicago-drop-target");
		});
		zone.addEventListener("dragleave", (evt) => {
			const related = evt.relatedTarget as Node | null;
			if (!related || !zone.contains(related)) {
				zone.removeClass("chicago-drop-target");
			}
		});
		zone.addEventListener("drop", (evt) => {
			const path = evt.dataTransfer?.getData(DRAG_MIME);
			zone.removeClass("chicago-drop-target");
			if (!path) return;
			evt.preventDefault();
			onDrop(path);
		});
	}
}

// Alphabetical by category, with a trailing "Uncategorised" group for
// projects that have none.
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

// "normal" is only reachable with a valid `touched` date — computeStaleness
// treats a missing one as stale — so the relative time always reads sensibly.
function stalenessLabel(staleness: Staleness, touched: string | null): string {
	const when = formatRelative(touched);
	if (staleness === "stale") return `Stale — ${when}`;
	if (staleness === "warning") return `Going stale — ${when}`;
	return `Worked on ${when}`;
}

function formatHours(hours: number): string {
	return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}
