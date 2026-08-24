import { App, PluginSettingTab, Setting } from "obsidian";
import type { SettingDefinitionItem, TFile } from "obsidian";
import type ChicagoPlugin from "../main";
import { nonEmptyString, nonNegativeInt, positiveInt, positiveNumberList } from "./settings";

// Two renderings of the same seven settings. `getSettingDefinitions` is what
// Obsidian 1.13.0 and later use — it also feeds the settings search index, so
// without it none of these fields are findable by name. `display` is the
// fallback for 1.7–1.12, which the manifest still supports. Both read and
// write through the same helpers, and any field added to one belongs in the
// other.
export class ChicagoSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: ChicagoPlugin,
	) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: "Projects folder",
				desc: "Vault folder scanned for project notes.",
				aliases: ["projects", "folder", "scan"],
				control: {
					type: "folder",
					key: "projectsFolder",
					validate: (value) => (value.trim() ? undefined : "Enter a folder to scan."),
				},
			},
			{
				name: "Inbox note path",
				desc: "Note scanned for quick-jot ideas to triage.",
				aliases: ["inbox", "triage", "ideas"],
				control: {
					type: "file",
					key: "inboxPath",
					filter: (file: TFile) => file.extension === "md",
					validate: (value) => (value.trim() ? undefined : "Enter a note path."),
				},
			},
			{
				name: "Active WIP limit",
				desc: "Hard cap on the number of Active projects.",
				aliases: ["wip", "limit", "cap", "active"],
				control: {
					type: "number",
					key: "activeLimit",
					min: 1,
					step: 1,
					validate: (value) => (value >= 1 ? undefined : "The cap has to be at least 1."),
				},
			},
			{
				name: "Hour increment buttons",
				desc: "Comma-separated hour values for the log buttons, e.g. 0.5, 1, 2.",
				aliases: ["hours", "increments", "buttons", "log"],
				control: {
					type: "text",
					key: "hourIncrements",
					placeholder: "0.5, 1, 2",
					validate: (value) =>
						parseIncrements(value).length ? undefined : "Enter at least one positive number.",
				},
			},
			{
				name: "Staleness warning threshold (days)",
				desc: "Active projects untouched this long show the warning state.",
				aliases: ["stale", "staleness", "warning", "days"],
				control: {
					type: "number",
					key: "staleWarningDays",
					min: 0,
					step: 1,
					validate: (value) => (value >= 0 ? undefined : "Days cannot be negative."),
				},
			},
			{
				name: "Staleness stale threshold (days)",
				desc: "Active projects untouched this long show the stale state.",
				aliases: ["stale", "staleness", "days"],
				control: {
					type: "number",
					key: "staleStaleDays",
					min: 0,
					step: 1,
					validate: (value) => (value >= 0 ? undefined : "Days cannot be negative."),
				},
			},
			{
				name: "Open dashboard on startup",
				aliases: ["startup", "launch", "open"],
				control: { type: "toggle", key: "openOnStartup" },
			},
		];
	}

	// The stored hourIncrements is a number array but the control edits it as
	// one comma-separated line, so it is the single key whose stored and
	// displayed forms differ.
	getControlValue(key: string): unknown {
		if (key === "hourIncrements") return this.plugin.settings.hourIncrements.join(", ");
		return this.plugin.settings[key as keyof typeof this.plugin.settings];
	}

	// Every write runs the same validation `normalizeSettings` applies on load,
	// so a value that reaches disk from here can never crash the next launch.
	async setControlValue(key: string, value: unknown): Promise<void> {
		const settings = this.plugin.settings;

		switch (key) {
			case "projectsFolder":
				settings.projectsFolder = nonEmptyString(value, settings.projectsFolder);
				await this.save();
				await this.plugin.projectStore.scan();
				return;
			case "inboxPath":
				settings.inboxPath = nonEmptyString(value, settings.inboxPath);
				await this.save();
				await this.plugin.inboxStore.scan();
				return;
			case "activeLimit":
				settings.activeLimit = positiveInt(value, settings.activeLimit);
				break;
			case "hourIncrements":
				settings.hourIncrements = positiveNumberList(
					parseIncrements(typeof value === "string" ? value : ""),
					settings.hourIncrements,
				);
				break;
			case "staleWarningDays":
				settings.staleWarningDays = nonNegativeInt(value, settings.staleWarningDays);
				break;
			case "staleStaleDays":
				settings.staleStaleDays = nonNegativeInt(value, settings.staleStaleDays);
				break;
			case "openOnStartup":
				settings.openOnStartup = typeof value === "boolean" ? value : settings.openOnStartup;
				break;
			default:
				return;
		}

		await this.save();
	}

	// Fallback rendering for Obsidian versions before 1.13.0, which have no
	// declarative settings API. Ignored from 1.13.0 on.
	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Projects folder")
			.setDesc("Vault folder scanned for project notes.")
			.addText((text) =>
				text.setValue(this.plugin.settings.projectsFolder).onChange(async (value) => {
					await this.setControlValue("projectsFolder", value);
				}),
			);

		new Setting(containerEl)
			.setName("Inbox note path")
			.setDesc("Note scanned for quick-jot ideas to triage.")
			.addText((text) =>
				text.setValue(this.plugin.settings.inboxPath).onChange(async (value) => {
					await this.setControlValue("inboxPath", value);
				}),
			);

		new Setting(containerEl)
			.setName("Active WIP limit")
			.setDesc("Hard cap on the number of Active projects.")
			.addText((text) =>
				text.setValue(String(this.plugin.settings.activeLimit)).onChange(async (value) => {
					await this.setControlValue("activeLimit", value);
				}),
			);

		new Setting(containerEl)
			.setName("Hour increment buttons")
			.setDesc("Comma-separated hour values for the log buttons, e.g. 0.5, 1, 2.")
			.addText((text) =>
				text.setValue(this.plugin.settings.hourIncrements.join(", ")).onChange(async (value) => {
					await this.setControlValue("hourIncrements", value);
				}),
			);

		new Setting(containerEl)
			.setName("Staleness warning threshold (days)")
			.setDesc("Active projects untouched this long show the warning state.")
			.addText((text) =>
				text.setValue(String(this.plugin.settings.staleWarningDays)).onChange(async (value) => {
					await this.setControlValue("staleWarningDays", value);
				}),
			);

		new Setting(containerEl)
			.setName("Staleness stale threshold (days)")
			.setDesc("Active projects untouched this long show the stale state.")
			.addText((text) =>
				text.setValue(String(this.plugin.settings.staleStaleDays)).onChange(async (value) => {
					await this.setControlValue("staleStaleDays", value);
				}),
			);

		new Setting(containerEl)
			.setName("Open dashboard on startup")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.openOnStartup).onChange(async (value) => {
					await this.setControlValue("openOnStartup", value);
				}),
			);
	}

	private async save(): Promise<void> {
		await this.plugin.saveData(this.plugin.settings);
		this.plugin.refreshBoardViews();
	}
}

// Splits the comma-separated increment line into the numbers behind it,
// dropping anything that isn't a usable positive value so a half-typed entry
// never wipes the existing list.
function parseIncrements(value: string): number[] {
	return value
		.split(",")
		.map((part) => Number(part.trim()))
		.filter((n) => Number.isFinite(n) && n > 0);
}
