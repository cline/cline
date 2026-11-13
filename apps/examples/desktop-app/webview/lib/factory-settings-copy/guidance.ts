/** Factory settings words: Guidance (spec section 3.4). */

import type { FactoryGuidanceRole } from "@/lib/factory-settings-client";

const count = (n: number) => n.toLocaleString("en-US");

export const FS_GUIDANCE = {
	scope:
		"What each role is told on every card, on top of Factory's built-in instructions. Yours applies everywhere; a repository's applies to work in that project.",
	targetsLabel: "Guidance for",
	searchTargets: "Guidance for each role",
	searchYours: "Your guidance",
	searchRepository: "Repository guidance",
	/** The target list and select, in the engine's order. */
	targets: {
		manager: "Manager readme",
		factory: "Routing",
		designer: "Scoping",
		plan_reviewer: "Plan checkers",
		builder: "Builders",
		verifier: "Tester",
		reviewer: "Code reviewers",
	} satisfies Record<FactoryGuidanceRole, string>,
	/** "Change the builder guidance: ", in a sentence. */
	targetWord: {
		manager: "manager readme",
		factory: "routing",
		designer: "scoping",
		plan_reviewer: "plan checker",
		builder: "builder",
		verifier: "tester",
		reviewer: "code reviewer",
	} satisfies Record<FactoryGuidanceRole, string>,
	/** Who keeps using the accepted version while a change waits. */
	keepsUsing: {
		manager: "The manager keeps",
		factory: "Routing keeps",
		designer: "Scoping keeps",
		plan_reviewer: "Plan checkers keep",
		builder: "Builders keep",
		verifier: "The tester keeps",
		reviewer: "Code reviewers keep",
	} satisfies Record<FactoryGuidanceRole, string>,
	none: "None",
	builtIn: "Built-in",
	changedCount: (n: number) => `${n} changed`,
	targetSummary: (title: string, state: string) => `${title} · ${state}`,

	yours: "Yours",
	yoursMeta: (n: number, max: number) =>
		`every project · ${count(n)} of ${count(max)} characters`,
	yoursEmpty: "every project",
	yoursBuiltIn: "every project · built-in text",
	repository: "Repository",
	noProject:
		"Repository guidance appears here once Factory has work in a project.",
	noUserScope: "This Factory service can't save your own guidance.",

	statusInUse: "In use",
	statusChanged: "Changed outside Factory",
	statusEmpty: "Empty",
	statusNotInUse: "Not in use",
	statusInvalid: "Can't read",

	builtInNote: "Built-in. Editing saves your own copy.",
	truncatedNote: (max: number) =>
		`This file is over the ${count(max)} character limit, so Factory can't use it. Shorten it outside Factory.`,
	empty: (target: string) =>
		`No guidance for ${target} yet. Roles use Factory's built-in instructions.`,
	write: "Write guidance",
	askFactory: "Ask Factory to write it",

	edit: "Edit text",
	editLabel: (title: string, scope: string) =>
		`Edit ${title} guidance, ${scope}`,
	change: "Ask Factory to change it",
	draft: (target: string) => `Change the ${target} guidance: `,
	draftRepository: (target: string, project: string) =>
		`Change the ${target} guidance for ${project}: `,
	editorLabel: (title: string, scope: string) => `${title} guidance, ${scope}`,
	counter: (n: number, max: number) => `${count(n)} of ${count(max)}`,
	over: (n: number, max: number) =>
		`Over the ${count(max)} character limit by ${count(n)}.`,
	cancel: "Cancel",
	review: "Review change",
	reviewHeading: "Review the change",
	reviewNote:
		"Nothing is saved until you choose Save. Roles use the new text on their next card.",
	removesFile: "Saving empty text removes this guidance.",
	save: "Save",
	keepEditing: "Keep editing",
	stale: "This guidance changed while you were editing.",
	staleHint: "Your text is still here, so you can copy it.",
	reload: "Reload",
	note: "Edited in Factory settings",

	changedTitle: "This file was changed outside Factory.",
	changedBody: (keeps: string) =>
		`${keeps} using the last version you accepted until you decide. The change is marked below.`,
	newTitle: "This file is not in use yet.",
	newBody: (keeps: string) =>
		`${keeps} using Factory's built-in instructions until you accept it.`,
	accept: "Accept change",
	discard: "Discard change",
	discardAction: "Discard change…",
	discardTitle: "Discard change?",
	discardBody:
		"The file goes back to the version you accepted. History keeps the outside change.",
	discardRemovesBody: (path: string) =>
		`Nothing was ever accepted, so ${path} is removed from the repository. History keeps its text.`,
	added: "added",
	removed: "removed",

	history: "History",
	historyMeta: (title: string, both: boolean) =>
		`${title}, ${both ? "both scopes" : "yours"}`,
	historyEmpty: "No changes yet.",
	historyScopeYours: "Yours",
	sourceAskFactory: "Ask Factory",
	sourceSettings: "Edited in settings",
	/** Before the card's link: "From feedback on F12". */
	sourceFeedback: "From feedback on",
	view: "View",
	hide: "Hide",
	restore: "Restore",
	restoreLabel: (note: string) => `Restore the version before “${note}”`,
	restoreNote: (note: string) => `Restored the version before “${note}”`,
	showMore: "Show more",
	today: "Today",
	yesterday: "Yesterday",
	unavailable: "Guidance: not available in this build.",
	historyUnavailable: "History: not available in this build.",
} as const;
