/**
 * Factory settings words: Test setup (spec 3.6, with the backend contract's
 * correction for a file changed since it was approved: nothing runs until
 * the person decides, so there is no "keep approved version").
 */

import type { FactoryVerificationStatus } from "@/lib/factory-settings-client";

const PATH = ".cline/factory/verification.json";

export const FS_TEST_SETUP = {
	scope:
		"How the tester installs, starts and exercises the app in this project. Factory proposes one the first time a plan needs the running app; it is used only after you approve it.",
	path: PATH,
	/** Status pills. */
	status: {
		approved: "Approved",
		proposed: "Needs approval",
		changed: "Changed since approved",
		none: "Not set up",
		invalid: "Invalid",
	} satisfies Record<
		Exclude<FactoryVerificationStatus, "in_use"> | "approved",
		string
	>,
	// Not set up
	emptyTitle: (project: string) => `No test setup for ${project}.`,
	emptyBody:
		"A test setup tells the tester how to install, start and exercise the app, so it can check the running app and not only what the plan's commands cover. Factory proposes one when a plan needs it.",
	setUp: "Set one up",
	askFactory: "Ask Factory",
	askDraft: (project: string) => `Set up a test setup for ${project} that `,
	// Proposed
	proposedTitle: (project: string) =>
		`Factory proposed a test setup for ${project}.`,
	/** "Proposed while scoping F12 “Add retry”." around the card's link. */
	proposedWhile: "Proposed while scoping",
	proposedWhileTitle: (title: string) => `“${title}”.`,
	proposedFile: `It comes from ${PATH} in the repository.`,
	proposedRead:
		"The tester runs these commands on this computer, so read them before approving.",
	proposedHeading: "Proposed setup",
	proposedHint: "not in use yet",
	// In use
	inUseHeading: "In use",
	fromRepository: `from ${PATH}`,
	approvedHere: "approved on this computer",
	lastPassed: (date: string) => `last passed ${date}`,
	// Changed since approved (backend contract deviation)
	changedTitle: "The test setup file changed since you approved it.",
	changedBody:
		"Nothing runs until you approve the new version or stop using the approval.",
	changedHeading: "New version",
	changedHint: "changes marked",
	changedMark: "Changed",
	was: "Was:",
	approveNew: "Approve new version",
	// Invalid
	invalidTitle: `Factory can't read ${PATH}.`,
	invalidBody: "No test setup runs here until the file is fixed.",
	fix: "Fix with Ask Factory",
	fixDraft: (project: string, reason: string) =>
		`Fix ${PATH} in ${project}. It can't be read: ${reason}`,
	// Actions
	approve: "Approve",
	stopUsing: "Stop using",
	edit: "Edit",
	reload: "Reload",
	stale: "The test setup changed. Review it again.",
	runsAsYou:
		"The tester runs these commands in each card's worktree on this computer, as you, with access to your files.",
	// Fields
	fields: {
		install: "Install",
		start: "Start",
		readyWhen: "Ready when",
		portVariable: "Port variable",
		stop: "Stop",
		exercise: "What to exercise",
		evidence: "Evidence",
		skills: "Skills",
	},
	readyWhen: (seconds: number) => `answers, within ${seconds} seconds`,
	readyTimeout: "Ready within (seconds)",
	notSet: "Not set",
	// Editor
	editorTitle: "Test setup",
	editorHint:
		"Install or Start is required. Ready when needs Start. Each card gets its own port in the port variable.",
	editorFieldHints: {
		install: "Runs once and must finish, e.g. bun install",
		start: "Keeps running; Factory stops it, e.g. bun run dev",
		readyWhen:
			"Exits 0 when the app is ready, e.g. curl -fsS http://localhost:$PORT",
		portVariable: "PORT",
		stop: "Runs after Stop, e.g. docker compose down",
		exercise:
			"What the tester does with the running app: pages to open, actions to take, what to confirm.",
		evidence: "One path per line, e.g. test-results/**/*.png",
		skills: "Comma-separated skill names",
	},
	review: "Review and save…",
	confirmTitle: "Approve this test setup?",
	confirmBody:
		"Saved as approved on this computer. From the next card on, the tester runs these commands in each card's worktree on this computer, as you, with access to your files.",
	confirmVerb: "Approve and save",
	// Proposals from cards
	proposalsGroup: "Proposed by cards",
	proposalsHint: "open cards whose plan proposes a setup",
	/** Before the card's link: "Proposed by F12". */
	proposedBy: "Proposed by",
	proposalUsesFile: `This project uses ${PATH}; change that file to use this setup.`,
	proposalReplaces: "Approving replaces the setup in use.",
	// Tester and other projects
	testerGroup: "Tester",
	testerModel: "Tester model",
	testerModelHint: (model: string) =>
		`${model}. Runs commands and reads files; cannot edit code.`,
	testerOff: "No tester in the default workflow. Only the plan's checks run.",
	testerDefaultModel: "The default model",
	rolesAndModels: "Roles & models",
	overridden:
		"The default workflow has its own test setup, which is used instead.",
	openRoles: "Open Roles & models",
	otherProjects: "Other projects",
	otherSummary: {
		in_use: "In use",
		proposed: "Proposed, not in use yet",
		changed: "Changed since approved; nothing runs",
		invalid: "Can't read verification.json",
		none: "Not set up",
	} satisfies Record<FactoryVerificationStatus, string>,
	readFailed: "Couldn't read this project's test setup.",
	unavailable: "Test setup: update Cline to use it.",
	noProject:
		"No projects yet. A project appears here when you give Factory work in it.",
	search: {
		testSetup: {
			title: "Test setup",
			description:
				"How the tester installs, starts and exercises the app; approve or stop using it",
		},
		testerModel: {
			title: "Tester model",
			description: "The model that runs the test setup",
		},
	},
} as const;
