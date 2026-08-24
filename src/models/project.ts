import { TFile } from "obsidian";

export type ProjectStatus = "active" | "someday";

export interface Project {
	file: TFile;
	path: string;
	name: string;
	status: ProjectStatus;
	category: string | null;
	hours: number;
	next: string;
	touched: string | null;
	created: string | null;
}

// Frontmatter as the metadata cache and processFrontMatter hand it over.
// The Obsidian API types the processFrontMatter callback parameter as `any`,
// which turns off type checking on every field a caller touches — writers
// annotate this instead, so a typo in a field name is still an error.
export type FrontMatter = Record<string, unknown>;

export function parseProject(file: TFile, frontmatter: FrontMatter | undefined): Project {
	return {
		file,
		path: file.path,
		name: file.basename,
		status: coerceStatus(frontmatter?.status),
		category: coerceOptionalString(frontmatter?.category),
		hours: coerceHours(frontmatter?.hours),
		next: coerceString(frontmatter?.next),
		touched: coerceOptionalString(frontmatter?.touched),
		created: coerceOptionalString(frontmatter?.created),
	};
}

// True when the note's frontmatter has no valid status yet — the caller
// should stamp `status: someday` on it so no project stays invisible.
export function needsStatusWrite(frontmatter: FrontMatter | undefined): boolean {
	return frontmatter?.status !== "active" && frontmatter?.status !== "someday";
}

function coerceStatus(value: unknown): ProjectStatus {
	return value === "active" ? "active" : "someday";
}

export function coerceHours(value: unknown): number {
	const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
	if (!Number.isFinite(n)) return 0;
	return n < 0 ? 0 : n;
}

function coerceString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function coerceOptionalString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}
