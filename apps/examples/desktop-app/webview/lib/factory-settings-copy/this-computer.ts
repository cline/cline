/**
 * Factory settings words: This computer.
 */

import { plural } from "./shell";

export const FS_COMPUTER = {
	scope:
		"Factory work runs on this computer, in its own copy of each repository, so your checkout is never touched. SSH hosts and cloud sessions set up in the app run chat sessions only.",
	serviceGroup: "Factory service",
	copiesGroup: "Working copies",
	copiesLoading: "Loading working copies…",
	helpGroup: "Help",

	hub: "Hub",
	hubHint: (address: string | undefined, version: string | undefined) =>
		`The background service that runs Factory work.${
			address ? ` ${address}` : ""
		}${version ? `${address ? " ·" : ""} same version as the app (${version})` : ""}.`,
	hubSearch: "The background service that runs Factory work.",
	hubOlder:
		"The service is older than the app. Updating it interrupts the sessions it is serving, then Cline restarts.",
	hubNewer:
		"The service is a different version from the app. Update Cline to match it.",
	hubDisconnected: "Factory can't reach the service.",
	connected: "Connected",
	notConnected: "Not connected",
	updateNeeded: "Update needed",
	details: "Details",
	address: "Address",
	appVersion: "App version",
	hubVersion: "Service version",
	retry: "Retry",
	updateHub: "Update Hub…",
	checkForUpdates: "Check for updates",
	updateTitle: "Update the Hub?",
	updateBody:
		"The background service is replaced with this app's version. Sessions it is serving are interrupted, and Cline restarts when it is done.",
	updateVerb: "Update and restart",

	copyPath: "Copy path",
	location: "Location",
	locationHint: "Each card works in its own copy of its repository, here.",
	diskUse: "Disk use",
	diskUseHint: (count: number, size: string, finished: number) =>
		`${plural(count, "working copy", "working copies")}, ${size}. ${finished} ${
			finished === 1 ? "belongs" : "belong"
		} to delivered or archived cards.`,
	approximate: "At least this much: the folder was too large to measure fully.",
	unknown: (count: number) =>
		`${plural(count, "copy", "copies")} ${count === 1 ? "belongs" : "belong"} to no card and ${count === 1 ? "is" : "are"} never removed.`,
	removeFinished: "Remove finished copies…",
	removeTitle: "Remove finished copies?",
	removeBody: (count: number, size: string) =>
		`Removes ${plural(count, "working copy", "working copies")} (${size}). Cards, their PRs and their evidence are kept.`,
	removeDetail: "A copy with uncommitted changes is left in place.",
	removeVerb: "Remove copies",
	removed: (count: number, size: string) =>
		`Removed ${plural(count, "working copy", "working copies")} and freed ${size}.`,
	removing: "Removing finished copies…",
	skipped: (count: number) =>
		`${plural(count, "copy", "copies")} kept, usually because of uncommitted changes.`,
	evidence: "Evidence and logs",
	evidenceHint: (size: string) =>
		`Screenshots, recordings and app logs from the tester. ${size}.`,

	evidenceSearch: "Screenshots, recordings and app logs from the tester.",
	diagnostics: "Diagnostics",
	diagnosticsHint: "Saves a report with the Hub log for support.",
	exportDiagnostics: "Export diagnostics",
	exported: (path: string) => `Saved to ${path}.`,
	exportFailed: "Couldn't export diagnostics. Try again.",
	storageUnavailable: (hub: boolean) =>
		hub
			? "Working copies: Update Cline to see them."
			: "Working copies: not available in this build.",
	connectionUnavailable: "Hub status: not available in this build.",
} as const;
