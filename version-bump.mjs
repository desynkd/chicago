// Run by `npm version <patch|minor|major>` before it creates the tag, so the
// manifest and versions.json are always part of the release commit rather
// than a follow-up "oops, forgot the manifest" one.
//
// Obsidian reads the version from manifest.json, not package.json, and its
// release tooling expects a bare tag (1.0.0, never v1.0.0) — that is why
// .npmrc pins tag-version-prefix to the empty string.
import { readFileSync, writeFileSync } from "node:fs";

const target = process.env.npm_package_version;
if (!target) {
	console.error("version-bump: run this via `npm version`, not directly.");
	process.exit(1);
}

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = target;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t") + "\n");

// versions.json maps every published version to the Obsidian version it needs,
// so an older Obsidian install can still resolve a compatible release.
const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[target] = minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, "\t") + "\n");

console.log(`version-bump: ${target} (requires Obsidian ${minAppVersion})`);
