/**
 * Factory settings words: Data & reset. Each danger-zone confirmation is the
 * row's description, the count from a dry run, and what is never removed.
 */

import { plural } from "./shell";

export const FS_DATA = {
	scope: "Everything Factory keeps is on this computer.",
	dataGroup: "Data",
	dangerGroup: "Danger zone",
	factoryData: "Factory data",
	factoryDataHint: "cards, history, guidance and approvals",
	factoryDataUnavailable: "Factory data location: not available in this build.",
	copyPath: "Copy path",
	pathCopied: "Path copied.",
	copyFailed: "Couldn't copy the path.",
	archived: "Archived cards",
	archivedHint: (count: number | undefined) =>
		count === undefined
			? "Archived cards stay searchable on the board."
			: `${plural(count, "archived card")} stay searchable on the board.`,
	openArchive: "Open archive",
	dangerUnavailable: "Reset actions: not available in this build.",
	dangerHubTooOld: "Reset actions: update Cline to use these.",
	forgetStages: "Stage approvals",
	forgetStagesHint:
		"Repository stages in every project stop running until you approve them again.",
	forgetStagesAction: "Forget stage approvals…",
	forgetStagesConfirm: "Forget stage approvals?",
	forgetVerification: "Test setup approvals",
	forgetVerificationHint:
		"The tester stops starting apps in every project until you approve a setup again.",
	forgetVerificationAction: "Forget test setup approvals…",
	forgetVerificationConfirm: "Forget test setup approvals?",
	clearGuidance: "Your guidance",
	clearGuidanceHint:
		"Removes your guidance for every role. History is kept, so each one can be restored. Repository files are not changed.",
	clearGuidanceAction: "Clear your guidance…",
	clearGuidanceConfirm: "Clear your guidance?",
	resetSettings: "Factory settings",
	resetSettingsHint:
		"Makes Hands-off the default workflow and returns limits to 2 at once and $50 a day. Saved workflows are kept.",
	resetSettingsAction: "Reset Factory settings…",
	resetSettingsConfirm: "Reset Factory settings?",
	forgetVerb: "Forget approvals",
	clearVerb: "Clear guidance",
	resetVerb: "Reset settings",
	counting: "Counting what this changes…",
	countFailed: "Couldn't count what this changes.",
	/** Under every confirmation. */
	keeps: "No cards or repository files are deleted.",
	/** The dry run's count, in the confirmation. */
	count: {
		stages: (stages: number, projects: number) =>
			stages === 0
				? "No stage approvals to forget."
				: `${plural(stages, "stage")} in ${plural(projects, "project")} will need your approval again.`,
		verification: (projects: number) =>
			projects === 0
				? "No test setup approvals to forget."
				: `Test setup approvals in ${plural(projects, "project")} will be forgotten.`,
		guidance: (roles: readonly string[]) =>
			roles.length === 0
				? "You have no guidance to clear."
				: `Your guidance for ${plural(roles.length, "role")} will be removed: ${roles.join(", ")}.`,
		settings: (concurrency: number, dailyCostUsd: number | null) =>
			`Hands-off becomes the default workflow; limits return to ${concurrency} at once and ${
				dailyCostUsd === null ? "no daily limit" : `$${dailyCostUsd} a day`
			}.`,
	},
	/** After the reset, under the row. */
	done: {
		stages: (stages: number, projects: number) =>
			`Forgot ${plural(stages, "stage approval")} in ${plural(projects, "project")}.`,
		verification: (projects: number) =>
			`Forgot test setup approvals in ${plural(projects, "project")}.`,
		guidance: (roles: number) =>
			`Cleared your guidance for ${plural(roles, "role")}.`,
		settings: "Factory settings are back to their defaults.",
	},
	/** Guidance targets by role, for the count. */
	roles: {
		manager: "Manager readme",
		factory: "Routing",
		designer: "Scoping agent",
		plan_reviewer: "Plan checker",
		builder: "Builder",
		verifier: "Tester",
		reviewer: "Code reviewer",
	},
} as const;
