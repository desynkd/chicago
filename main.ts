import { Plugin } from "obsidian";

export default class ChicagoPlugin extends Plugin {
	async onload() {
		console.log("Chicago: loading plugin");
	}

	onunload() {
		console.log("Chicago: unloading plugin");
	}
}
