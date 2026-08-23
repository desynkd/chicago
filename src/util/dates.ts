// Dates in frontmatter are plain "YYYY-MM-DD" strings, always compared at
// day granularity — projects don't get logged multiple times with distinct
// times of day, so time-of-day noise would only introduce off-by-one bugs.
export function daysSince(date: Date): number {
	const now = new Date();
	const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
	const msPerDay = 24 * 60 * 60 * 1000;
	return Math.round((startOfToday.getTime() - startOfDate.getTime()) / msPerDay);
}

export function parseDate(dateStr: string): Date | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr.trim());
	if (!match) return null;
	const [, y, m, d] = match;
	const date = new Date(Number(y), Number(m) - 1, Number(d));
	return Number.isNaN(date.getTime()) ? null : date;
}

export function formatRelative(dateStr: string | null): string {
	if (!dateStr) return "never worked on";
	const date = parseDate(dateStr);
	if (!date) return "never worked on";
	const days = daysSince(date);
	if (days <= 0) return "today";
	if (days === 1) return "yesterday";
	return `${days} days ago`;
}
