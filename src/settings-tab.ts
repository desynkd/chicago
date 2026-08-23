import { App, PluginSettingTab, Setting } from "obsidian";
import type ChicagoPlugin from "../main";
import { nonEmptyString, nonNegativeInt, positiveInt, positiveNumberList } from "./settings";

export class ChicagoSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: ChicagoPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Projects folder")
			.setDesc("Vault folder scanned for project notes.")
			.addText((text) =>
				text.setValue(this.plugin.settings.projectsFolder).onChange(async (value) => {
					this.plugin.settings.projectsFolder = nonEmptyString(value, this.plugin.settings.projectsFolder);
					await this.save();
					await this.plugin.projectStore.scan();
				}),
			);

		new Setting(containerEl)
			.setName("Inbox note path")
			.setDesc("Note scanned for quick-jot ideas to triage.")
			.addText((text) =>
				text.setValue(this.plugin.settings.inboxPath).onChange(async (value) => {
					this.plugin.settings.inboxPath = nonEmptyString(value, this.plugin.settings.inboxPath);
					await this.save();
					await this.plugin.inboxStore.scan();
				}),
			);

		new Setting(containerEl)
			.setName("Active WIP limit")
			.setDesc("Hard cap on the number of Active projects.")
			.addText((text) =>
				text.setValue(String(this.plugin.settings.activeLimit)).onChange(async (value) => {
					this.plugin.settings.activeLimit = positiveInt(value, this.plugin.settings.activeLimit);
					await this.save();
				}),
			);

		new Setting(containerEl)
			.setName("Hour increment buttons")
			.setDesc("Comma-separated hour values for the log buttons, e.g. 0.5, 1, 2.")
			.addText((text) =>
				text.setValue(this.plugin.settings.hourIncrements.join(", ")).onChange(async (value) => {
					const parsed = value.split(",").map((v) => Number(v.trim()));
					this.plugin.settings.hourIncrements = positiveNumberList(parsed, this.plugin.settings.hourIncrements);
					await this.save();
				}),
			);

		new Setting(containerEl)
			.setName("Staleness warning threshold (days)")
			.setDesc("Active projects untouched this long show the warning state.")
			.addText((text) =>
				text.setValue(String(this.plugin.settings.staleWarningDays)).onChange(async (value) => {
					this.plugin.settings.staleWarningDays = nonNegativeInt(value, this.plugin.settings.staleWarningDays);
					await this.save();
				}),
			);

		new Setting(containerEl)
			.setName("Staleness stale threshold (days)")
			.setDesc("Active projects untouched this long show the stale state.")
			.addText((text) =>
				text.setValue(String(this.plugin.settings.staleStaleDays)).onChange(async (value) => {
					this.plugin.settings.staleStaleDays = nonNegativeInt(value, this.plugin.settings.staleStaleDays);
					await this.save();
				}),
			);

		new Setting(containerEl)
			.setName("Open dashboard on startup")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.openOnStartup).onChange(async (value) => {
					this.plugin.settings.openOnStartup = value;
					await this.save();
				}),
			);
	}

	// Every field is validated the same way `normalizeSettings` validates on
	// load, so a bad value typed here never produces a data.json that could
	// crash the plugin on next launch.
	private async save(): Promise<void> {
		await this.plugin.saveData(this.plugin.settings);
		this.plugin.refreshBoardViews();
	}
}
