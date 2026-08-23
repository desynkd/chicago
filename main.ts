import { Plugin } from "obsidian";
import { ChicagoSettings, DEFAULT_SETTINGS, normalizeSettings } from "./src/settings";
import { ProjectStore } from "./src/data/project-store";

export default class ChicagoPlugin extends Plugin {
	settings: ChicagoSettings = DEFAULT_SETTINGS;
	projectStore!: ProjectStore;

	async onload() {
		console.log("Chicago: loading plugin");
		this.settings = normalizeSettings(await this.loadData());

		this.projectStore = new ProjectStore(this.app, () => this.settings.projectsFolder);
		this.projectStore.registerEvents(this);

		this.app.workspace.onLayoutReady(async () => {
			await this.projectStore.scan();
			const active = this.projectStore.getActive().length;
			const someday = this.projectStore.getSomeday().length;
			console.log(`Chicago: indexed ${active + someday} projects (${active} active, ${someday} someday)`);
		});
	}

	onunload() {
		console.log("Chicago: unloading plugin");
	}
}
