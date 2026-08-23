export interface ChicagoSettings {
	projectsFolder: string;
	inboxPath: string;
	activeLimit: number;
	hourIncrements: number[];
	staleWarningDays: number;
	staleStaleDays: number;
	openOnStartup: boolean;
}

export const DEFAULT_SETTINGS: ChicagoSettings = {
	projectsFolder: "Projects",
	inboxPath: "Inbox.md",
	activeLimit: 3,
	hourIncrements: [0.5, 1, 2],
	staleWarningDays: 7,
	staleStaleDays: 21,
	openOnStartup: false,
};

// A hand-edited or corrupted data.json must never crash the plugin, so every
// field falls back to its default independently rather than failing whole-object.
export function normalizeSettings(raw: unknown): ChicagoSettings {
	const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
	return {
		projectsFolder: nonEmptyString(data.projectsFolder, DEFAULT_SETTINGS.projectsFolder),
		inboxPath: nonEmptyString(data.inboxPath, DEFAULT_SETTINGS.inboxPath),
		activeLimit: positiveInt(data.activeLimit, DEFAULT_SETTINGS.activeLimit),
		hourIncrements: positiveNumberList(data.hourIncrements, DEFAULT_SETTINGS.hourIncrements),
		staleWarningDays: nonNegativeInt(data.staleWarningDays, DEFAULT_SETTINGS.staleWarningDays),
		staleStaleDays: nonNegativeInt(data.staleStaleDays, DEFAULT_SETTINGS.staleStaleDays),
		openOnStartup: typeof data.openOnStartup === "boolean" ? data.openOnStartup : DEFAULT_SETTINGS.openOnStartup,
	};
}

function nonEmptyString(value: unknown, fallback: string): string {
	return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function positiveInt(value: unknown, fallback: number): number {
	const n = Number(value);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function nonNegativeInt(value: unknown, fallback: number): number {
	const n = Number(value);
	return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function positiveNumberList(value: unknown, fallback: number[]): number[] {
	if (!Array.isArray(value)) return fallback;
	const nums = value.filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);
	return nums.length ? nums : fallback;
}
