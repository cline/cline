/**
 * Factory settings words: Roles & models (spec section 3.3).
 */

/** The five pipeline roles, by their key in the workflow's `agents`. */
export type FsRoleKey =
	| "designer"
	| "planReviewers"
	| "implementers"
	| "verifier"
	| "reviewers";

export const FS_ROLES = {
	scope: "Who does each step, for new work in every project.",
	rolesGroup: "Pipeline roles",
	reviewGroup: "Review rules",
	managerGroup: "Ask Factory",
	roles: {
		designer: {
			title: "Scoping",
			hint: "Reads the request and writes the plan.",
			/** One agent: "Add scoping" never shows. */
			one: "scoping",
			tab: "Scoping",
			guidance: "scoping",
		},
		planReviewers: {
			title: "Plan checkers",
			hint: "Check the plan before anything is built.",
			empty: "None. Plans are not checked before building.",
			one: "plan checker",
			tab: "Plan checker",
			guidance: "plan checker",
		},
		implementers: {
			title: "Builders",
			hint: "Write the code. Independent parts of a plan rotate through them.",
			one: "builder",
			tab: "Builder",
			guidance: "builder",
		},
		verifier: {
			title: "Tester",
			hint: "Runs the app and checks the result. Off: only the plan's checks run.",
			one: "tester",
			tab: "Tester",
			guidance: "tester",
		},
		reviewers: {
			title: "Code reviewers",
			hint: "Review the change before the draft PR opens.",
			one: "code reviewer",
			tab: "Code reviewer",
			guidance: "code reviewer",
		},
	} satisfies Record<
		FsRoleKey,
		{
			title: string;
			hint: string;
			one: string;
			tab: string;
			guidance: string;
			empty?: string;
		}
	>,
	defaultModel: "Default model",
	modelLabel: (agent: string) => `${agent} model`,
	showDetails: (role: string) => `Show ${role} settings`,
	hideDetails: (role: string) => `Hide ${role} settings`,
	agentTabs: (role: string) => `${role} agents`,
	add: (one: string) => `Add ${one}`,
	remove: (agent: string) => `Remove ${agent}`,
	useTester: "Use a tester",
	testerOff: "The tester is off. Turn it on to choose its model and settings.",
	noPlanCheckers: "No plan checkers. Add one to check plans before building.",
	sameModelWarning:
		"Every code reviewer uses the same model as scoping or a builder, so review can miss their mistakes. Give a code reviewer a different model.",
	sameModelWaits:
		"Until a code reviewer uses a different model, plans wait for your approval.",
	noChecksWarning:
		"No plan checker and no tester: only code review checks the work.",

	// The expanded role
	model: "Model",
	instructions: "Extra instructions",
	instructionsHintBefore: (guidance: string) =>
		`Added after the ${guidance} guidance, for this workflow only. For lasting rules use`,
	instructionsLink: "Guidance",
	instructionsPlaceholder: "Nothing extra",
	instructionsSave: "Save",
	instructionsCancel: "Cancel",
	skills: "Skills",
	skillsHint: (one: string) => `Loaded when the ${one} starts.`,
	addSkill: "Add",
	addSkillLabel: "Skill name",
	removeSkill: (name: string) => `Remove skill ${name}`,
	profile: "Agent profile",
	profileHint: "A profile from .cline/agents sets the prompt and tools.",
	profilePlaceholder: "None",
	limits: "Limits",
	limitsHint: "The session stops at whichever comes first.",
	steps: "steps",
	minutes: "minutes",
	stepsLabel: (agent: string) => `${agent} step limit`,
	minutesLabel: (agent: string) => `${agent} time limit in minutes`,
	noStepLimit: "No limit",
	tools: "Tools",
	toolsByRole: {
		builder:
			"Every tool: reads and edits files, runs commands, and uses the MCP servers set up in the app. Asks you through the card when it has a question.",
		readOnly:
			"Reads files, searches code and uses skills. Cannot edit or run commands.",
		tester:
			"Reads files, searches code, uses skills and runs commands. Cannot edit code.",
	},
	testSetup: "Test setup for this workflow",
	testSetupHint: "Used instead of a project's test setup.",
	testSetupSet: "Set",
	evidence: "Evidence paths",
	evidencePlaceholder: "Paths separated by commas, e.g. screenshots/*.png",
	testSetupSave: "Save test setup",

	// Review rules
	requireIndependent: "Require a different model to review",
	requireIndependentHint:
		"Plans approve themselves only when a code reviewer uses a different model from the builders.",
	codeReview: "Code review",
	fewestReviewers: "Fewest code reviewers",
	fewestReviewersHint: "The smallest number any change gets.",
	fewestReviewersCapped: (count: number) =>
		`Up to ${count}, the number of code reviewers.`,

	// Ask Factory
	managerModel: "Manager model",
	managerModelHint: "The model behind the Ask Factory panel.",
	managerModelOwn:
		"Ask Factory remembers its own; until you choose one it uses the model new chats start with.",
	managerCan: "What the manager can do",
	managerCanHint:
		"Start, hold and retry work; propose guidance and stage changes that you confirm. It cannot change approval, limits or review rules.",
	canHeading: "Can",
	cannotHeading: "Cannot",
	can: [
		"Start work, hold, start and retry cards",
		"Read status",
		"Propose changes to guidance and repository stages, which are saved only after you confirm the exact change",
		"Search and read the web",
		"Ask you a question",
	],
	cannot: [
		"Change plan approval, draft PR review, limits, spending or review rules",
		"Approve a stage or test setup for you",
		"Merge or archive",
	],
} as const;
