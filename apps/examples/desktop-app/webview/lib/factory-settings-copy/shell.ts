/**
 * Factory settings words: the shell (header, section list, search, shared
 * states). Each page keeps its own words in its own file beside this one,
 * so pages can change without touching each other or `factory-copy.ts`.
 */

export const plural = (count: number, one: string, many = `${one}s`) =>
	`${count} ${count === 1 ? one : many}`;

export const FS_SHELL = {
	title: "Factory settings",
	back: "Back to Factory",
	saved: "Saved",
	nav: "Factory settings",
	search: "Search settings",
	searchResults: "Matching settings",
	noResults: (query: string) => `No settings match “${query}”.`,
	pageMenuLabel: "Factory settings pages",
	project: "Project",
	hubUnreachable:
		"Can't reach Factory. Settings show the last known values and can't be changed.",
	retry: "Retry",
	notAvailable: "Not available in this build.",
	hubTooOld: "Update Cline to change this.",
	loadFailed: "Couldn't load this. Try again.",
	saveFailed: "Couldn't save. Try again.",
	/** The scope line's end on pages that edit the default workflow. */
	savedTo: "Saved to the default workflow,",
	cancel: "Cancel",
	save: "Save",
	show: "Show",
	hide: "Hide",
	open: "Open",
	moreActions: (name: string) => `More actions for ${name}`,
	/** A card link's text when the card has no Factory number. */
	aCard: "a card",
	numberOrEmptyInvalid: (min: number, max: number) =>
		`Enter a whole number from ${min} to ${max}, or leave it empty.`,
} as const;

/** "Copy", "Copied": the copy button beside a path or a command. */
export const FS_COPY = {
	copy: "Copy",
	copied: "Copied",
	failed: "Couldn't copy. Select the text instead.",
	label: (what: string) => `Copy ${what}`,
} as const;

export const FS_GROUPS = {
	factory: "Factory",
	workers: "Workers",
	pipeline: "Pipeline",
	where: "Where work runs",
	advanced: "Advanced",
} as const;

export const FS_PAGES = {
	automation: "Automation",
	limits: "Limits & spending",
	roles: "Roles & models",
	guidance: "Guidance",
	stages: "Stages",
	verification: "Test setup",
	projects: "Projects",
	computer: "This computer",
	connections: "Connections",
	workflows: "Workflows",
	data: "Data & reset",
} as const;

/** The section list's counts, as sentences for screen readers. */
export const FS_COUNTS = {
	guidance: (count: number) =>
		`${plural(count, "guidance file")} changed outside Factory`,
	stages: (count: number) =>
		`${count} ${count === 1 ? "stage needs" : "stages need"} approval`,
	verification: (count: number) =>
		`${count} test ${count === 1 ? "setup needs" : "setups need"} approval`,
	connections: (count: number) =>
		`${count} ${count === 1 ? "connection" : "connections"} not ready`,
} as const;

/** A confirmation dialog's title: the row title and a question mark. */
export const fsConfirmTitle = (title: string) => `${title}?`;

/** "3.2 GB": a byte count for a description. */
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
	const units = ["KB", "MB", "GB", "TB"] as const;
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value >= 10 || unit < 1 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
