import { addIcon, Plugin } from "obsidian";
import { ChicagoSettings, DEFAULT_SETTINGS, normalizeSettings } from "./src/settings";
import { ChicagoSettingTab } from "./src/settings-tab";
import { ProjectStore } from "./src/data/project-store";
import { InboxStore } from "./src/data/inbox-store";
import { ChicagoBoardView, VIEW_TYPE_CHICAGO_BOARD } from "./src/view/board-view";
import { CHICAGO_ICON_ID, CHICAGO_ICON_SVG } from "./src/icon";

export default class ChicagoPlugin extends Plugin {
	settings: ChicagoSettings = DEFAULT_SETTINGS;
	projectStore!: ProjectStore;
	inboxStore!: InboxStore;

	async onload() {
		console.log("Chicago: loading plugin");
		addIcon(CHICAGO_ICON_ID, CHICAGO_ICON_SVG);
		this.settings = normalizeSettings(await this.loadData());

		this.projectStore = new ProjectStore(this.app, () => this.settings.projectsFolder);
		this.projectStore.registerEvents(this);

		this.inboxStore = new InboxStore(
			this.app,
			() => this.settings.inboxPath,
			() => this.settings.projectsFolder,
		);
		this.inboxStore.registerEvents(this);

		this.registerView(
			VIEW_TYPE_CHICAGO_BOARD,
			(leaf) => new ChicagoBoardView(leaf, this.projectStore, this.inboxStore, () => this.settings),
		);

		this.addSettingTab(new ChicagoSettingTab(this.app, this));

		this.addRibbonIcon("layout-dashboard", "Open Chicago dashboard", () => {
			void this.activateView();
		});

		this.addCommand({
			id: "open-dashboard",
			name: "Open dashboard",
			callback: () => {
				void this.activateView();
			},
		});

		this.app.workspace.onLayoutReady(async () => {
			await this.projectStore.scan();
			await this.inboxStore.scan();
			const active = this.projectStore.getActive().length;
			const someday = this.projectStore.getSomeday().length;
			console.log(`Chicago: indexed ${active + someday} projects (${active} active, ${someday} someday)`);

			if (this.settings.openOnStartup) {
				await this.activateView();
			}
		});
	}

	onunload() {
		console.log("Chicago: unloading plugin");
	}

	// Reuses an existing dashboard leaf rather than opening duplicates, and
	// opens in the main workspace area rather than the sidebar — the board is
	// a glance-at-everything surface and needs the width.
	async activateView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_CHICAGO_BOARD);

		if (existing.length > 0) {
			await workspace.revealLeaf(existing[0]);
			return;
		}

		const leaf = workspace.getLeaf("tab");
		await leaf.setViewState({ type: VIEW_TYPE_CHICAGO_BOARD, active: true });
		await workspace.revealLeaf(leaf);
	}

	// Settings that affect rendering (WIP limit, hour increments, staleness
	// thresholds) don't touch project or inbox data, so no store event fires
	// when they change — the settings tab calls this directly instead.
	refreshBoardViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CHICAGO_BOARD)) {
			if (leaf.view instanceof ChicagoBoardView) leaf.view.refresh();
		}
	}
}
