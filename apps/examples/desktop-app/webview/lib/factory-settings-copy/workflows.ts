/**
 * Factory settings words: Workflows (saved workflows, import, save as and the
 * limits on a repository's workflow file). The import and copy errors keep
 * their wording from `FACTORY_WORKFLOW`.
 */

export const FS_WORKFLOWS = {
	scope:
		"A workflow is one saved set of Automation and Roles & models settings. New work uses the default; those two pages edit it.",
	savedGroup: "Saved workflows",
	repositoryGroup: "From a repository",
	builtIn: "Built in",
	defaultPill: "Default",
	makeDefault: "Make default",
	madeDefault: (name: string) => `New work now uses “${name}”.`,
	/** "Plans only when needed · 2 builders · tester on · $10 per card" */
	summary: {
		automatic: "Plans only when needed",
		required: "Every plan waits",
		builders: (count: number) =>
			`${count} ${count === 1 ? "builder" : "builders"}`,
		tester: (on: boolean) => (on ? "tester on" : "tester off"),
		perCard: (usd: string) => `${usd} per card`,
		noCardLimit: "no card limit",
	},
	menu: {
		rename: "Rename…",
		duplicate: "Duplicate",
		copyJson: "Copy as JSON",
		delete: "Delete…",
	},
	copyFailed: "Couldn't copy the workflow. Try again.",
	copied: (name: string) => `Copied “${name}” as JSON.`,
	duplicated: (name: string) => `Saved a copy as “${name}”.`,
	copyName: (name: string, n: number) =>
		n === 1 ? `${name} copy` : `${name} copy ${n}`,
	// Rename (inline)
	renameLabel: (name: string) => `New name for ${name}`,
	renamed: (name: string) => `Renamed to “${name}”.`,
	nameEmpty: "Enter a name.",
	nameTooLong: "Use 100 characters or fewer.",
	nameTaken: (name: string) => `A workflow named “${name}” already exists.`,
	nameBuiltIn: (name: string) => `“${name}” is built in; choose another name.`,
	// Delete
	deleteTitle: (name: string) => `Delete “${name}”?`,
	deleteBody:
		"It is removed from your saved workflows. Cards that used it keep their settings.",
	deleteDefaultBody:
		"It is the default workflow, so choose the one new work uses instead. Cards that used it keep their settings.",
	newDefault: "New default",
	newDefaultHint: "New work uses this from now on.",
	deleteVerb: "Delete",
	deleted: (name: string) => `Deleted “${name}”.`,
	// Save current as
	saveAs: "Save current as…",
	saveAsTitle: "Save current settings as a workflow",
	saveAsBody:
		"Saves the Automation and Roles & models settings in use now under a new name.",
	saveAsName: "Workflow name",
	saveAsDefault: "Make it the default workflow",
	saveAsDefaultHint: "Automation and Roles & models then edit this workflow.",
	saveVerb: "Save",
	savedAs: (name: string) => `Saved “${name}”.`,
	// Import
	import: "Import…",
	importTitle: "Import a workflow",
	importBody:
		"Paste a workflow exported with Copy as JSON. A workflow holds roles, models, instructions and policies, not credentials. Read its instructions before importing.",
	importField: "Workflow JSON",
	importPlaceholder: "Paste workflow JSON",
	chooseFile: "Choose file…",
	readFileFailed: "Couldn't read that file.",
	review: "Review",
	back: "Back",
	importVerb: "Import",
	invalidJson: "Workflow import must be valid JSON. Check the pasted text.",
	alreadySaved: (name: string) =>
		`“${name}” is already saved with these settings.`,
	previewTitle: (name: string) => `Import “${name}”`,
	previewBody:
		"Importing saves it under this name. It never changes the default workflow.",
	imported: (name: string) => `Imported “${name}”.`,
	/** The import preview's rows. */
	preview: {
		planApproval: "Plan approval",
		draftReview: "Draft PR review",
		pullRequests: "Pull requests",
		keepPassing: "Keep the PR passing",
		builders: "Builders",
		planCheckers: "Plan checkers",
		reviewers: "Code reviewers",
		tester: "Tester",
		cardLimit: "Card limit",
		repairRounds: "Fix rounds after review",
		retries: "Retries per stage",
		on: "On",
		off: "Off",
		none: "None",
		noLimit: "No limit",
		defaultModel: "default model",
		instructions: "with its own instructions",
	},
	// Repository workflow files
	repositoryFiles: "Workflow files in a repository",
	repositoryFilesHint:
		"A request can name a workflow file from its repository. Factory limits those: every plan waits for you, PRs stay drafts, a different model must review, and a card stops at $10.",
	repositoryLimits: [
		"Every plan waits for your approval.",
		"PRs stay drafts; Factory never marks them ready.",
		"A code reviewer on a different model from the builders must review.",
		"Draft PR review cannot be turned off.",
		"A card stops at $10.",
	],
} as const;
