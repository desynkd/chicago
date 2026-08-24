import esbuild from "esbuild";
import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Vault target is machine-specific, so it's read from an env var or a
// gitignored .env file rather than hardcoded, so the repo is not tied to
// one machine.
function loadDotEnv() {
	const envPath = path.join(__dirname, ".env");
	if (!fs.existsSync(envPath)) return;
	for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eq = trimmed.indexOf("=");
		if (eq === -1) continue;
		const key = trimmed.slice(0, eq).trim();
		const value = trimmed.slice(eq + 1).trim();
		if (!(key in process.env)) process.env[key] = value;
	}
}

loadDotEnv();

const prod = process.argv[2] === "production";
const vaultPath = process.env.CHICAGO_VAULT_PATH || "/mnt/work/life";
const pluginDir = path.join(vaultPath, ".obsidian", "plugins", "chicago");

const banner = `/* Chicago — bundled build output. Source: https://github.com/ (see repo) */`;

const context = await esbuild.context({
	banner: { js: banner },
	entryPoints: ["main.ts"],
	bundle: true,
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
	],
	format: "cjs",
	target: "es2018",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	outfile: "main.js",
	minify: prod,
});

if (prod) {
	await context.rebuild();
	await context.dispose();
	process.exit(0);
} else {
	linkIntoVault();
	await context.watch();
}

// Symlinks build artifacts into the vault's plugin folder so `npm run dev`
// needs no separate copy step — esbuild writes main.js at the repo root and
// the vault sees it live via the link.
function linkIntoVault() {
	fs.mkdirSync(pluginDir, { recursive: true });
	for (const file of ["main.js", "manifest.json", "styles.css"]) {
		const target = path.join(pluginDir, file);
		const source = path.join(__dirname, file);
		try {
			const stat = fs.lstatSync(target);
			if (stat.isSymbolicLink() && fs.readlinkSync(target) === source) continue;
			fs.unlinkSync(target);
		} catch (err) {
			if (err.code !== "ENOENT") throw err;
		}
		fs.symlinkSync(source, target);
	}
	console.log(`Chicago: linked build into ${pluginDir}`);
}
