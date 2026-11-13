import type {
	FactoryPartsSummary,
	FactoryPriority,
	FactoryPriorityState,
	FactoryReviewSize,
	FactoryRunRoute,
	FactoryRunState,
} from "@cline/shared";
import { FACTORY_PRIORITY_LABEL, factoryCardList } from "@cline/shared/browser";

/**
 * Plain-language Factory copy, defined once. Engine terms (implementer,
 * candidate, stamp, sample queue, revision) stay in the engine; every Factory
 * surface reads its user-facing words from here so labels cannot drift.
 */

/** What a run is doing, by engine phase. */
export const FACTORY_PHASE_LABEL = {
	implementing: "Building",
	verifying: "Testing",
	reviewing: "Reviewing code",
	repairing: "Fixing review findings",
	publishing: "Opening draft PR",
	watching: "Watching CI on the draft PR",
	ready: "Ready for you",
	blocked: "Blocked",
} as const satisfies Record<string, string>;

export type FactoryPhase = keyof typeof FACTORY_PHASE_LABEL;

/** Label for a run phase; unknown phases read as plain words. */
export function factoryPhaseLabel(phase: string): string {
	return FACTORY_PHASE_LABEL[phase as FactoryPhase] ?? sentenceCase(phase);
}

/** Who does the work, by engine role. */
export const FACTORY_ROLE_LABEL = {
	designer: "Scoping agent",
	implementer: "Builder",
	builder: "Builder",
	planReviewer: "Plan checker",
	reviewer: "Code reviewer",
	finalReviewer: "Code reviewer",
	verifier: "Tester",
} as const satisfies Record<string, string>;

export type FactoryRole = keyof typeof FACTORY_ROLE_LABEL;

/** "1 builder", "2 code reviewers". */
export function factoryRoleCount(role: FactoryRole, count: number): string {
	const label = FACTORY_ROLE_LABEL[role].toLowerCase();
	return `${count} ${label}${count === 1 ? "" : "s"}`;
}

/** Where a card stands on the board before or between runs. */
export const FACTORY_ACTIVITY = {
	scoping: "Scoping",
	checkingPlan: "Checking the plan",
	starting: "Starting",
	finishing: "Finishing up",
	waitingToStart: "Waiting to start",
	waitingToBuild: "Waiting to build",
	waitingForPlanCheck: "Waiting for plan check",
	waitingForSlot: "Waiting for a free slot",
	/** Not queued, not held and not scoping: nothing will start it. */
	notStarted: "Not started",
	planNotReady: "Plan not ready to approve",
	onHold: "On hold",
	statusNotLoaded: "Status not loaded yet",
	reviewed: "Reviewed",
} as const;

/** Why a card needs the user. Each is also the heading of its group. */
export const FACTORY_DECISION = {
	question: "Answer a question",
	/** A card that stopped; its row's verb is Try again. */
	failure: "Stopped",
	blocker: "Resolve blocker",
	/** A guidance rule Factory proposed from the person's note: save or discard it. */
	rule: "Review proposed rule",
	followup: "Resume draft PR follow-up",
	plan: "Approve plan",
	noBuild: "Confirm: no build needed",
	/** Scoping split the request into parts; the person approves the breakdown. */
	breakdown: "Approve breakdown",
	/** An earlier part will never merge, so this part cannot start on its own. */
	unmerged: "Start anyway or cancel",
} as const;

/** What is ready for the user to look at. */
export const FACTORY_READY = {
	draftPr: "Draft PR ready",
	/** Factory marked the draft PR ready (workflow `pullRequestReady`). */
	markedReady: "Marked ready for review",
	changes: "Delivered on a branch, no PR",
	/** A delivered result Factory asks the user to review before merging. */
	needsReview: "Needs your review",
} as const;

/**
 * Why Factory asks for the user's review, from the reason core froze at
 * delivery (`factoryStampRequirement`, or the unresolved and security
 * findings reasons in shared factory.ts). Unknown reasons are shown as
 * recorded.
 */
export function factoryReviewReason(reason: string): string {
	switch (reason.trim().toLowerCase()) {
		case "shared contract":
		case "shared_contract":
			return "touches a shared contract";
		case "cross cutting":
		case "cross_cutting":
			return "cuts across the codebase";
		case "review escalated":
			return "a reviewer found it riskier than planned";
		case "impact unknown":
			return "Factory could not tell how far the change reaches";
		case "sensitive paths":
			return "it changes sensitive files";
		case "verification profile changed":
			return "changes the test setup";
		case "workflow always requires a stamp":
			return "your settings ask to review every change";
		case "review findings unresolved":
			return "the reviewer left findings it could not clear";
		case "possible security finding kept local":
			return "a possible security issue, kept off the PR";
		default:
			return reason.trim();
	}
}

/** A review size (the engine's FACTORY_REVIEW_SIZES) in plain words. */
export const FACTORY_REVIEW_SIZE_LABEL = {
	trivial: "trivial",
	local: "local",
	shared_contract: "shared contract",
	cross_cutting: "cross-cutting",
} as const satisfies Record<FactoryReviewSize, string>;

/** "Factory asks for your review: touches a shared contract." */
export function factoryReviewRequest(reason: string): string {
	const plain = factoryReviewReason(reason);
	return plain
		? `Factory asks for your review: ${plain}.`
		: "Factory asks for your review.";
}

/** The review policy in Factory settings; values are the workflow's `humanStamp`. */
export const FACTORY_REVIEW_POLICY = {
	label: "Ask for my review",
	options: [
		{
			value: "by_risk",
			label: "Only on risky changes (recommended)",
			hint: "Changes to shared contracts, wide changes and escalated reviews wait for you. Small local changes end at the draft PR.",
		},
		{
			value: "always",
			label: "On every change",
			hint: "Every draft PR waits for you to mark it as reviewed.",
		},
		{
			value: "never",
			label: "Never",
			hint: "Draft PRs never wait for you. You still decide when to merge.",
		},
	],
} as const satisfies {
	label: string;
	options: readonly {
		value: "by_risk" | "always" | "never";
		label: string;
		hint: string;
	}[];
};

/** Where a card's test setup came from, by recorded origin. */
export const FACTORY_VERIFICATION_ORIGIN = {
	repository: "From the repository",
	approved_local: "Approved earlier on this machine",
	proposed: "Proposed by this plan: reviewed before it runs",
} as const satisfies Record<string, string>;

/** The test setup block in a card's details. */
export const FACTORY_VERIFICATION_SETUP = {
	title: "Test setup",
	exercise: "How the tester uses the app",
	dryRunPassed: "Dry run passed",
	dryRunFailed: (stage?: string) =>
		stage ? `Dry run failed at ${stage}` : "Dry run failed",
	dryRunPending: "Not tried yet",
	showLog: "Show log",
	presetOverrides:
		"This plan's workflow sets its own app environment, which overrides the repository's test setup.",
	presetOverridesField: "Overrides the repository's test setup",
	noneConfigured:
		"No test setup. Turn on the tester in Factory settings to have an agent test the running app.",
	proposesWhenNeeded: "Factory proposes a test setup when a plan needs one.",
} as const;

/** How a check result reads beside its status. */
export const FACTORY_CHECK_RESULT = {
	limitations: (limitations: readonly string[]) =>
		`Passed, but did not check: ${limitations.join("; ")}`,
	configuration: "This check's setup needs fixing in the plan",
	configurationPill: "Plan problem",
	editPlan: "Edit plan",
} as const;

/** A card that stopped, or never started, and how to move it on. */
export const FACTORY_RECOVERY = {
	/** A stopped card whose plan's checks, not its code, are at fault. */
	planFault:
		"The plan's checks need fixing. Try again sends it back to scoping.",
	/** Factory re-scoped once and the checks still cannot work. */
	planFaultStopped:
		"Factory could not fix the plan's checks on its own. Edit the plan to fix them.",
	notStarted: FACTORY_ACTIVITY.notStarted,
	start: "Start",
	/** After saving an edited hands-off plan. */
	savedRescoping: "Saved. Sending it back to scoping.",
	savePlan: "Save plan",
	publishFailed: "Could not open the draft PR",
	/** The run was based on origin's default branch, not the local one. */
	builtFromDefault: (branch: string) =>
		`Built from the published default branch (${branch}), not your local branch.`,
} as const;

/**
 * A run that stopped at its repair limit after its draft PR opened: the PR
 * is the result, and a person decides what to do about the open findings.
 */
export const FACTORY_OPEN_FINDINGS = {
	headline: (count: number) =>
		`Draft PR open · reviewer has ${count} unresolved ${count === 1 ? "finding" : "findings"}`,
	next: (count: number) =>
		`The reviewer left ${count} ${count === 1 ? "finding" : "findings"} Factory did not fix. Have Factory fix them, or accept as is.`,
	openPr: "Open draft PR",
	fullText: "Full findings",
	notificationTitle: "Draft PR open with review findings",
} as const;

/** Cards Factory files itself for patterns reviewers keep finding. */
export const FACTORY_RULE_CARD = {
	source: "factory:repo-rules",
	badge: "Suggested by Factory",
	explanation:
		"Factory filed this because reviewers saw the same pattern in more than one card.",
} as const;

/** Shared nouns and short phrases. */
export const FACTORY_TERMS = {
	candidate: "Changes",
	feedback: "Feedback",
	agentTesting: "Agent testing",
	keepPrGreen: "Keep the draft PR green (fix CI and review comments)",
	settings: "Factory settings",
} as const;

/** The everyday Factory settings, visible without opening Advanced. */
export const FACTORY_SETTING_LABEL = {
	handsOff: "Run new work to a draft PR automatically",
	pauseForApproval: "Pause for my approval before building",
	advanced: "Advanced",
	handsOffHint:
		"Scoping, building, testing and code review continue on their own and end in a draft PR for you to review.",
	pauseForApprovalHint: {
		on: "Factory waits for you to approve each plan before it builds.",
		off: "Off: building starts as soon as the plan check passes.",
	},
	/** What the two switches above do together, said once in plain words. */
	flow: (handsOff: boolean, pause: boolean) =>
		handsOff
			? pause
				? "New work stops once for you to approve its plan, then runs to a draft PR."
				: "New work runs from request to draft PR without stopping."
			: pause
				? "New work waits for you to approve its plan before building, and doesn't run to a draft PR on its own."
				: "New work builds as soon as its plan passes the check, but doesn't run to a draft PR on its own.",
	advancedSummary: "Workflows, review, retries, participants, agent testing",
} as const;

/** Saved workflows in Factory settings: one word, "workflow", throughout. */
export const FACTORY_WORKFLOW = {
	heading: "Saved workflows",
	apply: "Apply a saved workflow",
	applyPlaceholder: "Apply a saved workflow…",
	name: "Workflow name",
	save: "Save workflow",
	useByDefault: "Use this workflow for new work (when saved)",
	matches: (name: string) => `Matches saved workflow “${name}”`,
	changed: (name: string) =>
		`Changed from saved workflow “${name}”. Saving the brief keeps them for this work only.`,
	explainer:
		"A workflow sets participants, limits and approval for new work. Checks, documents and PR settings stay with each piece of work.",
	notVersion1: (detail: string) => `Not a version 1 workflow: ${detail}`.trim(),
	nameTaken: (name: string) =>
		`A different saved workflow is named “${name}”. Change the name in the JSON, then import.`,
} as const;

/** Page-level messages. */
export const FACTORY_MESSAGES = {
	empty:
		"Nothing in the factory yet. Describe one thing to build and it shows up here.",
	loading: "Loading…",
	cantReach: "Can't reach Factory. Showing the last known status.",
	notFound: "Can't find this card. Back to Factory.",
	/** "Paused: nothing new starts. 1 card is finishing." */
	paused: (finishing: number) =>
		finishing > 0
			? `Paused: nothing new starts. ${countOf(finishing, "card")} ${finishing === 1 ? "is" : "are"} finishing.`
			: "Paused: nothing new starts.",
	pauseNewWork: "Pause new work",
	resume: "Resume",
} as const;

/** The limit after "Working N": "of 3", however many run. */
export function factoryWorkingLimit(limit: number): string {
	return `of ${limit}`;
}

/**
 * Why "Working 7 of 6" is over its limit (the limit was lowered while work
 * ran), for the limit's tooltip; nothing when within it.
 */
export function factoryWorkingOverLimit(
	running: number,
	limit: number,
): string | undefined {
	return running > limit
		? `More work is running than the limit of ${limit} allows, because the limit was lowered while it ran. No new work starts until fewer than ${limit} run.`
		: undefined;
}

/**
 * The feedback the user gave on a finished result, if any. Feedback is
 * optional: no rating means nothing to say, never a request for one.
 */
export function factoryFeedbackLabel(
	audit: { reviewedAt?: string; finding?: string } | undefined,
): string | undefined {
	if (!audit?.reviewedAt) return undefined;
	return audit.finding ? "Feedback: something's off" : "Feedback: looks good";
}

/** Plain status for a finished or archived card in History. */
export function factoryHistoryStatus(input: {
	status: string;
	phase?: string;
	reviewed?: boolean;
	/** Findings a stopped run left on its open draft PR. */
	openFindings?: number;
}): string {
	if (input.reviewed) return FACTORY_ACTIVITY.reviewed;
	if (input.openFindings !== undefined)
		return FACTORY_OPEN_FINDINGS.headline(input.openFindings);
	switch (input.status) {
		case "cancelled":
			return "Cancelled";
		case "expired":
			return "Expired";
		case "failed":
			return "Failed";
		case "pending_approval":
			return "Waiting for approval";
		case "approved":
			return FACTORY_ACTIVITY.waitingToBuild;
		case "in_progress":
			return "Working";
	}
	if (input.phase === "ready") return "Done";
	if (input.phase) return factoryPhaseLabel(input.phase);
	return input.status === "completed" ? "Done" : sentenceCase(input.status);
}

/** "1 card", "2 cards". */
function countOf(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function sentenceCase(value: string): string {
	const words = value.replaceAll("_", " ");
	return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The card's artifact panel: what the agents are doing and what came out. */
export const FACTORY_PANEL = {
	label: "Work and results",
	tabs: {
		live: "Agents",
		changes: "Changes",
		checks: "Checks",
		pr: "Review",
	},
	/** "No agent on this card. Builder finished 4m ago." */
	liveIdle: (last?: { role: string; ago: string }) =>
		last
			? `No agent on this card. ${last.role} finished ${last.ago} ago.`
			: "No agent on this card yet.",
	loadingChanges: "Loading changes…",
	noCandidate: "No changes have been committed yet.",
	changesFailed: "Couldn't load the changes.",
	reloadChanges: "Reload changes",
	changesTitle: "Feature changes",
	noChecks: "No checks have run yet.",
	output: "Output",
	showOutput: "Show output",
	hideOutput: "Hide output",
	noOutput: "No output recorded.",
	ciHeading: "CI on the draft PR",
	ciStatus: {
		passed: "CI passed",
		pending: "CI running",
		failed: "CI failed",
		unknown: "CI status unknown",
	},
	reviewsHeading: "Code review",
	findingsHeading: "Unresolved review findings",
} as const;

/** Activity's card rail and the app sidebar's Factory group. */
export const FACTORY_MASTER_DETAIL = {
	rail: "Factory work",
	allActivity: "Show all Activity",
	/** The sidebar's Factory entry: "Factory, 3 need you". */
	sidebarEntry: (status?: { needsYou: number; working: boolean }) =>
		status && status.needsYou > 0
			? `Factory, ${status.needsYou} ${status.needsYou === 1 ? "needs" : "need"} you`
			: status?.working
				? "Factory, working"
				: "Factory",
} as const;

/** The Factory manager conversation opened by Ask Factory. */
export const FACTORY_MANAGER = {
	ask: "Ask Factory",
	title: "Ask Factory",
	description:
		"Give Factory work, ask how it is going, hold or retry a card, or tell Factory how its agents should work.",
	examplesLabel: "Example questions",
	/** The card example appears only when there is a real card to ask about. */
	examples: (cardId?: string): string[] => [
		"What needs me right now?",
		...(cardId ? [`How is ${cardId} going?`] : []),
		"Retry everything that stopped today",
	],
	sessionTitle: "Factory manager",
	placeholder:
		"Describe work to add, ask how it is going, or tell Factory how to work",
	modelLabel: "Manager's model",
	modelHint:
		"Only Factory's manager uses this model. Work runs on its workflow's models.",
} as const;

/** The read-only transcript of a Factory role agent in its card's Live tab. */
export const FACTORY_LIVE_TRANSCRIPT = {
	live: (label: string) => `Live · ${label}`,
	finished: (label: string) => `${label} finished`,
	loading: "Loading conversation",
	reconnecting: "Reconnecting, updates paused",
	unavailable: "This session is no longer available.",
	noMessages: "No messages yet.",
	showInstructions: "Show the instructions this agent was given",
	hideInstructions: "Hide the instructions",
} as const;

/**
 * How a chosen model reads everywhere in Factory: the model id alone
 * ("openai/gpt-5"), never prefixed with the provider that routes it.
 */
export function factoryModelLabel(selection: {
	providerId?: string;
	modelId?: string;
}): string {
	return selection.modelId?.trim() || selection.providerId?.trim() || "";
}

/**
 * A model id without its provider path where space is tight: "gpt-5" for
 * "openai/gpt-5". Show the full id beside it (a title) so nothing is lost.
 */
export function factoryShortModel(modelId: string): string {
	return modelId.slice(modelId.lastIndexOf("/") + 1) || modelId;
}

/** Factory settings: spending limits per card and per day. */
export const FACTORY_SPENDING = {
	heading: "Spending",
	cardLimitBefore: "Stop a card after $",
	cardLimitHint:
		"Per card, saved with these settings. Work already running can go a little past it.",
	cardLimitInvalid: (max: number) =>
		`Enter an amount above $0 and up to $${max.toLocaleString("en-US")}, or leave it empty for no limit.`,
	dailyLimitHint:
		"Across all Factory work on this computer. Applies right away; running work finishes.",
	dailyLimitInvalid: (max: number) =>
		`Enter an amount from $0 to $${max.toLocaleString("en-US")}, or leave it empty for no limit.`,
	noLimit: "No spending limit: Factory keeps working until you stop it",
	unsupported: "Update Cline to use this.",
} as const;

/** Factory settings: who plans, builds and checks the work. */
export const FACTORY_REVIEW_SAFETY = {
	heading: "Who checks the work",
	plans: "Plans",
	checksPlan: "Checks the plan",
	builds: "Builds",
	tests: "Tests",
	reviews: "Reviews",
	nobody: "nobody",
	sameModel: "same model",
	editRoles: "Edit roles",
	sameModelWarning:
		"The same model builds and reviews this work, so it can miss its own mistakes. Give a plan checker or code reviewer a different model.",
	noChecksWarning:
		"No plan checker and no tester: only code review checks the work.",
	requireIndependent:
		"Require a different model to review before approving automatically",
	requireIndependentHint:
		"Otherwise the plan waits for your approval, even when approval is automatic.",
	unsupported: "Update Cline to use this.",
} as const;

/**
 * The confirmation the Factory manager chat shows before a guidance change
 * is saved. Guidance roles use the engine's names; `factory` is routing
 * guidance.
 */
export const FACTORY_GUIDANCE = {
	roleLabel: {
		designer: FACTORY_ROLE_LABEL.designer,
		plan_reviewer: FACTORY_ROLE_LABEL.planReviewer,
		builder: FACTORY_ROLE_LABEL.builder,
		verifier: FACTORY_ROLE_LABEL.verifier,
		reviewer: FACTORY_ROLE_LABEL.reviewer,
	},
	roleHeading: (roleLabel: string) =>
		`Change how Factory's ${roleLabel.toLowerCase()} works?`,
	routingHeading: "Change how Factory routes work?",
	managerHeading: "Change the Factory manager's readme?",
	acceptHeading:
		"This guidance file was changed outside Factory. Use this version?",
	discardHeading: "Discard the outside change and keep Factory's version?",
	scopeUser: "For all your projects",
	scopeRepository: (repository: string) => `For ${repository}`,
	scopeRepositoryUnnamed: "For this repository",
	notSavedYet: "Nothing is saved until you choose.",
	changeCount: (additions: number, removals: number) =>
		`${additions} line${additions === 1 ? "" : "s"} added, ${removals} removed`,
	save: "Save this guidance",
	saving: "Saving...",
	dontSave: "Don't save",
	declining: "Not saving...",
	unreadable: "Factory could not show this change, so it cannot be saved.",
} as const;

export type FactoryGuidanceRoleName =
	| keyof typeof FACTORY_GUIDANCE.roleLabel
	| "factory"
	| "manager";

/** A Factory card's own page: headings, notes and the plan editor. */
export const FACTORY_CARD = {
	/** A stopped card whose plan's checks, not its code, are at fault. */
	planFaultHeadline: "The plan's checks need fixing",
	planFaultStoppedHeadline: "The plan's checks still need fixing",
	planFaultNext: "Try again sends it back to scoping, or edit the plan.",
	/** Scoping asked a question; nothing runs until it is answered. */
	waitingForAnswer: "Waiting for your answer",
	/** A brief nobody scoped yet: both ways forward are on the card. */
	unscopedNext:
		"Approve and run the brief as written, or start scoping so Factory plans it first.",
	/** Stopped at the review repair limit. */
	repairLimitHeadline: "Review findings were not cleared",
	/** A rule Factory proposed from the person's note. */
	ruleNext: "Factory suggests a rule from your note. Save it or discard it.",
	reviewRule: "Review the rule",
	/** Under a building card's headline when no live line is shown. */
	buildingNext:
		"Nothing is needed from you while Factory builds and checks it.",
	/** Heading of a manual card's run results. */
	resultsHeading: "Latest results",
	noCriterionResults:
		"Not proven per requirement: this run only ran the checks.",
	/** "Model cost $3.86 · 4 agent runs". */
	costLine: (
		cost: string | undefined,
		runs: number,
		unknownCost: number,
	): string =>
		[
			cost === undefined ? undefined : `Model cost ${cost}`,
			unknownCost
				? `cost unknown for ${unknownCost} ${unknownCost === 1 ? "run" : "runs"}`
				: undefined,
			`${runs} agent ${runs === 1 ? "run" : "runs"}`,
		]
			.filter(Boolean)
			.join(" · "),
	branch: "Branch",
	copyWorktreePath: "Copy worktree path",
	copiedWorktreePath: "Copied",
	/** The header's one action on a card nothing else will start. */
	startScoping: "Start scoping",
	/** The plan editor's check fields. */
	checkName: "Check name",
	checkType: "Check type",
	checkCommand: "Check command",
	evidencePaths: "Evidence files",
	evidencePathsHint:
		"Files the check writes, relative to the worktree. Optional.",
	evidencePath: "Evidence path",
	removeCheck: "Remove check",
} as const;

/**
 * Engine approval blockers in plain words. Core's sentences are kept as is
 * when there is no plainer form; see FACTORY_CARD for the card's own copy.
 */
export function factoryApprovalReasonText(reason: string): string;
export function factoryApprovalReasonText(reason: null): null;
export function factoryApprovalReasonText(reason: string | null): string | null;
export function factoryApprovalReasonText(
	reason: string | null,
): string | null {
	if (reason === null) return null;
	if (reason.startsWith("Complete adaptive design and reviewer selection"))
		return "Scoping has not chosen reviewers for this plan yet. Refine the plan to finish it.";
	if (reason.startsWith("Complete plan review for this revision"))
		return "The plan has not passed its review yet. Refine the plan to resolve the reviewers' findings.";
	return reason;
}

/** The verb on a card's row, beside the label `factoryActivity` gives it. */
export const FACTORY_ROW_ACTION = {
	answer: "Answer",
	resolve: "Resolve",
	resume: "Resume",
	approvePlan: "Approve plan",
	review: "Review",
	open: "Open",
} as const;

/** A card whose stored data Factory could not read; the others still show. */
export const FACTORY_UNREADABLE = {
	title: "This card could not be read",
	label: "Could not be read",
	/** The board card's line; the reason is under Details on the card. */
	card: "This card could not be read.",
	/** The card page, when the card's data breaks its rendering. */
	cardPage:
		"This card could not be shown. Its stored data may be incomplete; the rest of Factory is unaffected.",
	/** The page-level line when Factory's reply as a whole was unreadable. */
	page: "Factory sent status the app could not read. Showing the last known status.",
} as const;

/** Compact forms of page controls, for narrow spaces. */
export const FACTORY_COMPACT = {
	settings: "Settings",
	paused: "Paused",
	/** Tooltip and accessible name of the paused icon in the narrow rail. */
	pausedIndicator:
		"New work is paused. Resume it from the banner beside the card.",
} as const;

/**
 * What a card that has not started says, in Activity and on the card. A plan
 * is only offered for approval once scoping has written it.
 */
export const FACTORY_NOT_STARTED = {
	label: FACTORY_ACTIVITY.notStarted,
	detail:
		"Factory hasn't scoped this yet. Start scoping to write a plan you can approve.",
} as const;

/**
 * A card's proof receipt: what was proven, who checked it on which model,
 * and what was not checked, said as plainly as what was.
 */
export const FACTORY_PROOF = {
	label: "Proof",
	proven: "Proven",
	checkedBy: "Checked by",
	notChecked: "Not checked",
	openFindings: "Open findings",
	/** "6 of 7 requirements proven". */
	provenCount: (proven: number, total: number) =>
		`${proven} of ${total} ${total === 1 ? "requirement" : "requirements"} proven`,
	/** "4 of 4 checks passed". */
	checksPassed: (passed: number, total: number) =>
		`${passed} of ${total} ${total === 1 ? "check" : "checks"} passed`,
	noChecks: "No checks ran.",
	showEach: "Show each requirement",
	byCheck: (name: string) => `Proven by check “${name}”`,
	byTester: "Proven by the tester running the app",
	outcome: {
		passed: "proven",
		failed: "failed",
		unverified: "not proven",
		uncheckable: "not checked",
	},
	/** A requirement whose own text says the build cannot check it. */
	uncheckable: (text: string) => `Can't be checked by the build: ${text}`,
	notProven: (text: string) => `Not proven: ${text}`,
	failed: (text: string) => `Failed: ${text}`,
	noTester: "No agent ran the app: this card has no tester.",
	testerNoResult: "The tester did not record a result.",
	checkLimitation: (name: string, limitations: readonly string[]) =>
		`${name}: ${FACTORY_CHECK_RESULT.limitations(limitations)}`,
	/** A path or behavior a reviewer or the tester did not verify. */
	gap: (who: string, what: string) => `${who} did not verify: ${what}`,
	limitation: (who: string, what: string) => `${who} could not check: ${what}`,
	unresolved: (count: number) =>
		`${count} reviewer ${count === 1 ? "finding" : "findings"} left unresolved`,
	nothing: "Nothing recorded",
	/** Every requirement proven and nothing left unchecked. */
	nothingLeft: "Nothing; every requirement was checked.",
	noCheckers: "No agent recorded a check of this work.",
	modelNotRecorded: "model not recorded",
	/** "Code reviewer · gpt-5 · passed". */
	agentLine: (role: string, model: string, verdict?: string) =>
		[role, model, verdict].filter(Boolean).join(" · "),
	verdict: { pass: "passed", changes_requested: "asked for changes" },
	independent: "The code reviewer runs on a different model from the builder.",
	sameModel:
		"The code reviewer runs on the same model as the builder, so it can miss its own mistakes.",
	independenceUnknown:
		"Not recorded whether the code reviewer's model differs from the builder's.",
	builder: (model: string) => `Built on ${model}.`,
	/** Delivery asked nothing more because the person approved the plan. */
	planApproved: "No further review needed: you approved the plan.",
	/** What became of the draft PR, from the run's `pullRequestOutcome`. */
	pullRequestOutcome: (
		outcome: Pick<
			NonNullable<FactoryRunState["pullRequestOutcome"]>,
			"state" | "headChanged"
		>,
	) =>
		outcome.state === "closed"
			? "Closed without merging"
			: outcome.headChanged
				? "Merged after changes"
				: "Merged as delivered",
	/**
	 * "Routed as shared contract because it changes sensitive files
	 * (.env.example): 1 plan checker, 1 tester, 2 code reviewers. Scoping
	 * $0.06 · build $0.31 · review $1.89."
	 */
	route: (route: FactoryRunRoute) => {
		const because = route.sensitivePaths.length
			? `${factoryReviewReason("sensitive paths")} (${route.sensitivePaths.slice(0, 3).join(", ")})`
			: route.escalated
				? "the change came out bigger than planned"
				: undefined;
		const roles = [
			route.planReviewers
				? factoryRoleCount("planReviewer", route.planReviewers)
				: undefined,
			route.tester ? factoryRoleCount("verifier", 1) : undefined,
			route.reviewers
				? factoryRoleCount("reviewer", route.reviewers)
				: undefined,
			route.stages ? FACTORY_STAGES.count(route.stages) : undefined,
		].filter(Boolean);
		const costs = (
			[
				["scoping", route.cost.scoping],
				["build", route.cost.build],
				["test", route.cost.test],
				["review", route.cost.review],
			] as const
		)
			.filter(([, usd]) => usd > 0)
			.map(([station, usd]) => `${station} $${usd.toFixed(2)}`);
		return [
			`Routed as ${FACTORY_REVIEW_SIZE_LABEL[route.size]}${because ? ` because ${because}` : ""}: ${roles.join(", ") || "no reviewers"}.`,
			costs.length ? `${sentenceCase(costs.join(" · "))}.` : undefined,
		]
			.filter(Boolean)
			.join(" ");
	},
	good: "Good",
	somethingOff: "Something's off…",
	feedbackQuestion: "What did Factory miss?",
	sendFeedback: "Send feedback",
	feedbackRecorded: "Thanks. Feedback recorded.",
} as const;

/** The card header: one state sentence and one primary action per state. */
export const FACTORY_CARD_ACTION = {
	accept: "Accept",
	/** Beside Accept: what accepting records. */
	acceptHint: "Accepting records your review of this result.",
	haveFactoryFix: "Have Factory fix",
	openDraftPr: "Open draft PR",
	/** A PR that is merged or closed is no longer a draft. */
	openPr: "Open PR",
	/** A working card's quick action: watch its running agent. */
	watch: "Watch",
	viewChanges: "View changes",
	tryAgain: "Try again",
	tryScopingAgain: "Try scoping again",
	editPlan: "Edit plan",
	/** More → the delivered card's feedback box. */
	rate: "Leave feedback…",
	deliveredPr: "You decide when to merge.",
	deliveredBranch: (branch: string) =>
		`The changes are on branch ${branch}. Nothing was published.`,
	reviewed: "You accepted this delivery.",
	/** The card's station line, in the home's vocabulary. */
	stationLine: "Where this card is",
} as const;

/** The PR button: "Open draft PR" only while it is an open draft. */
export function factoryPullRequestActionLabel(
	pr: { pullRequestOutcome?: unknown; pullRequestReady?: boolean } | undefined,
): string {
	return pr?.pullRequestOutcome || pr?.pullRequestReady
		? FACTORY_CARD_ACTION.openPr
		: FACTORY_CARD_ACTION.openDraftPr;
}

/** The panel's Agents tab: one lane per role session of the card. */
export const FACTORY_AGENT_LANES = {
	label: "Agents on this card",
	working: "Working",
	starting: "Starting",
	/** "Builder finished · 4m". */
	finished: (role: string, elapsed?: string) =>
		elapsed ? `${role} finished · ${elapsed}` : `${role} finished`,
	select: (role: string) => `Show the ${role.toLowerCase()}'s conversation`,
} as const;

/** More → Details: settings and history kept off the card's default view. */
export const FACTORY_DETAILS = {
	heading: "Details",
	revision: (revision: number) => `Plan version ${revision}`,
	attempt: (attempt: number) => `Attempt ${attempt}`,
	worktree: "Worktree",
	refresh: "Refresh results",
} as const;

/** Trying a card's work again with other models (replays). */
export const FACTORY_COMPARE = {
	heading: "Try this work with other models",
	replayHeading: (label: string) => `Tried with other models · ${label}`,
	replay: "Run it again with other models…",
	explainer:
		"Factory runs the same request again on Cline, once for each saved workflow you pick, so you can compare models side by side.",
	sourceRun: "Attempt to compare",
	/** "Attempt 2 · plan version 3 · completed". */
	runOption: (attempt: number, revision: number, status: string) =>
		`Attempt ${attempt} · plan version ${revision} · ${status}`,
	none: "Not tried with other models yet.",
} as const;

/**
 * The Factory home: four status groups (Working, Waiting, Needs you,
 * Delivered) in three columns, Waiting as the Queue under Working unless it is
 * its own column; each row has a small stage line. Stage names are shared with
 * the card's own stage line.
 */
export const FACTORY_LINE = {
	/**
	 * Where a card is. The stage line shows Scope to Done; Waiting is a
	 * state, named where a card is listed rather than drawn as a stage.
	 */
	stations: {
		waiting: "Waiting",
		scope: "Scope",
		build: "Build",
		verify: "Verify",
		review: "Review",
		delivered: "Done",
	},
	skippedForCard: "Skipped for this card",
	stoppedAt: (station: string) => `Stopped at ${station}`,
	/** The row stage line's accessible name: "Build, stage 2 of 5". */
	stage: (station: string, index: number, total: number) =>
		`${station}, stage ${index} of ${total}`,
	/** The plan's own checks run as part of Build. */
	runningChecks: "Running checks",
	checksFailed: "Checks did not pass",
	groups: {
		needsYou: "Needs you",
		working: "Working",
		waiting: "Waiting",
		delivered: "Delivered",
	},
	/** Beside "Delivered": how many of them were delivered today. */
	deliveredToday: (count: number) => `${count} today`,
	limitReached: (spent: string, limit: string) =>
		`Stopped at the spending limit: ${spent} of ${limit} spent today. Nothing new starts; running work finishes.`,
	changeLimit: "Change the limit",
	/** Today's spend in the header: "$12.40 of $50 today". */
	spend: (spent: string, limit?: string) =>
		limit ? `${spent} of ${limit} today` : `${spent} today`,
	question: (question: string) => `Question: ${question}`,
	flagged: (finding: string) => `You flagged this: “${finding}”`,
	tryAgain: "Try again",
	resolve: "Resolve",
	/** The one-line proof under a delivery. */
	proof: {
		checksPassed: (count: number) =>
			`${count} ${count === 1 ? "check" : "checks"} passed`,
		reviewPassed: "review passed",
		findings: (count: number) =>
			`reviewer left ${count} ${count === 1 ? "finding" : "findings"}`,
		reviewedByYou: "reviewed by you",
		looksGood: "you said it looks good",
		flagged: "you flagged it",
		onBranch: "on a branch, no PR",
	},
	allHistory: "All history",
} as const;

/**
 * The feedback row on a delivered card once the person left a note: what
 * Factory made of it and the one rule it proposes. Feedback stays optional,
 * so nothing here asks for a rating.
 */
export const FACTORY_FEEDBACK = {
	yourNote: "Your note",
	checking: "Checking what Factory missed…",
	/** "Code reviewer guidance · all your projects". */
	target: (roleLabel: string, scope: "user" | "repository") =>
		`${roleLabel} guidance · ${scope === "user" ? "all your projects" : "this project"}`,
	routing: "Routing",
	repositoryNote:
		"Saving writes this rule into the project's .cline/factory/guidance folder; it is not committed.",
	evidence: "From the evidence",
	save: "Save rule",
	saving: "Saving…",
	discard: "Discard",
	discuss: "Discuss",
	tryAgain: "Try again",
	saved: "Rule saved. Factory follows it from the next card.",
	discarded: "Rule discarded. Nothing was saved.",
	failed: "Factory couldn't check this note.",
	stopped: "Factory stopped before it finished checking this note.",
	/** The docked Ask Factory panel, when another card has a proposed rule. */
	proposedNotice: (shortId: string) => `Proposed rule from ${shortId}`,
	review: "Review",
	/** The draft Discuss puts in the Ask Factory composer. */
	discussDraft: (shortId: string, note: string, verdict?: string) =>
		[
			`My feedback on ${shortId}: “${note}”`,
			verdict ? `Factory's check: ${verdict}` : undefined,
			"Can we talk about what should change?",
		]
			.filter(Boolean)
			.join("\n"),
} as const;

/** Labels that only repeat their stage's name: "Build · Building". */
const STAGE_VERBS = new Set<string>([
	FACTORY_ACTIVITY.scoping,
	FACTORY_PHASE_LABEL.implementing,
	FACTORY_PHASE_LABEL.reviewing,
]);

/**
 * A working card's stage and what it is doing there, as the rail shows it:
 * "Build · Running checks", "Verify · Testing", or just "Build" when the
 * label would only repeat the stage.
 */
export function factoryWorkingDetail(station: string, label: string): string {
	return STAGE_VERBS.has(label) || !label ? station : `${station} · ${label}`;
}

/** Repository stages (`.cline/factory/stages.json`): a sub-step of Build. */
export const FACTORY_STAGES = {
	/** The card header while a stage runs: "Build · Security scan". */
	subStep: (name: string) => `Build · ${name}`,
	/** In the route line: "2 repository stages". */
	count: (count: number) =>
		`${count} repository ${count === 1 ? "stage" : "stages"}`,
	/** One receipt line: "Also ran: Security scan, passed · Docs update, changed 2 files". */
	alsoRan: (items: readonly string[]) => `Also ran: ${items.join(" · ")}`,
	item: (name: string, outcome: string) => `${name}, ${outcome}`,
	status: {
		running: "running",
		passed: "passed",
		failed: "failed",
		error: "could not run",
		skipped: "skipped",
	},
	/** A write stage's outcome: "changed 2 files" or "no changes". */
	changed: (files: number) =>
		files ? `changed ${files} ${files === 1 ? "file" : "files"}` : "no changes",
	/** Not checked: a stage that failed without blocking. */
	failedNotBlocking: (name: string, reason?: string) =>
		`Repository stage ${name} failed${reason ? `: ${reason}` : ""}; it does not block delivery.`,
	couldNotRun: (name: string, reason?: string) =>
		`Repository stage ${name} could not run${reason ? `: ${reason}` : ""}.`,
	/** Not checked: "Security scan did not run: its definition changed and is not approved yet." */
	notRun: (name: string, reason: string) => `${name} did not run: ${reason}.`,
	/** The Checks area. */
	heading: "Repository stages",
	skipped: (reason?: string) => `Skipped${reason ? `: ${reason}` : ""}`,
	showOutput: "Show output",
	empty: "No repository stages in this project. Ask Factory to add one.",
	unsupported: "This Factory version cannot run repository stages.",
	invalid: (reason: string) => `stages.json is invalid: ${reason}`,
	trust: {
		approved: "In use",
		needs_approval: "Needs approval",
		changed: "Changed since approved",
		declined: "Not used",
	},
	kind: {
		command: "Command",
		read: "Read-only agent",
		write: "Agent that edits",
	},
	/** When a stage runs, from its `when`. */
	when: (paths?: readonly string[], minSize?: string) =>
		[
			paths?.length ? `files matching ${paths.join(", ")}` : undefined,
			minSize ? `changes at least ${minSize.replaceAll("_", " ")}` : undefined,
		]
			.filter(Boolean)
			.join(" and ") || "every build",
	notBlocking: "does not block delivery",
	approve: "Approve",
	/** Under a definition awaiting Approve: what approving allows. */
	approveRunsAsYou:
		"Once approved, Factory runs this in each card's worktree on this computer, as you, with access to your files.",
	stopUsing: "Stop using",
	readFailed: "Couldn't read this project's repository stages.",
} as const;

/** The Factory home board: its columns, empty lines and Display menu. */
export const FACTORY_BOARD = {
	board: "Factory board",
	/** One line in an empty column. */
	empty: {
		waiting: "Nothing is waiting.",
		working: "Nothing is running.",
		needsYou: "Nothing needs you.",
		delivered: "Nothing delivered yet.",
		column: "No cards.",
		nothing:
			"Nothing here yet. Ask Factory for a change and its card starts here.",
	},
	paused: "Paused. Running cards finish; waiting cards do not start.",
	/** Working's lower part: the cards waiting to start. */
	queue: "Queue",
	/** After "Working 3 of 6" when work waits: "· 8 queued". */
	queued: (count: number) => `${count} queued`,
	/** Display → Columns: the queue as its own Waiting column. */
	queueColumn: "Queue as its own column",
	/** Under Delivered when older deliveries are left for All history. */
	mostRecent: (count: number) => `${count} most recent`,
	moreWaiting: (count: number) => `+${count} more waiting`,
	/** A collapsed column's strip. */
	showColumn: (name: string, count: number) =>
		`Show ${name}, ${count} ${count === 1 ? "card" : "cards"}`,
	collapseColumn: (name: string) => `Collapse ${name}`,
	noProject: "No project",
	/** The trailing column for cards no column matches. */
	other: "Other",
	/**
	 * The end of a delivered card's proof when it opened a pull request:
	 * what became of it, else "ready for review" or "draft PR".
	 */
	pullRequest: (
		outcome: Parameters<typeof FACTORY_PROOF.pullRequestOutcome>[0] | undefined,
		ready: boolean,
	) =>
		outcome
			? outcome.state === "closed"
				? "closed without merging"
				: outcome.headChanged
					? "merged after changes"
					: "merged"
			: ready
				? "ready for review"
				: "draft PR",
	display: "Display",
	groupBy: "Group by",
	groupings: { status: "Status", stage: "Stage", project: "Project" },
	columns: "Columns",
	reorder: "Reorder columns",
	moveLeft: (name: string) => `Move ${name} left`,
	moveRight: (name: string) => `Move ${name} right`,
	reset: "Reset to default",
} as const;

/** The line under a card's headline when its request came with a plan (design progress `route`). */
export const FACTORY_SCOPE_ROUTE = {
	checking: "Plan provided with the request; quick check running.",
	modelChecked: "Plan provided with the request; quick check passed.",
	codeChecked: "Plan provided with the request; checked against the code only.",
	notUsed: (reason: string) =>
		`Scoped by Factory: the supplied plan was not used (${reason.replace(/[.\s]+$/, "")}).`,
} as const;

/** The Factory settings page: General, Models and Projects. */
export const FACTORY_SETTINGS = {
	reload: "Reload settings",
	loadFailed: "Couldn't load Factory settings.",
	saveFailed: "Couldn't save. Try again.",
	general: {
		planApproval: "Plan approval",
		planApprovalOptions: {
			automatic: "Only when needed",
			required: "Every plan",
		},
		planApprovalHint: {
			automatic:
				"Small plans start building on their own. Factory waits for you when a plan is large, when plan checkers still object, or when you edited it.",
			required: "Every plan waits for your approval before anything is built.",
		},
		olderTitle: "Saved by an older version.",
		/** The older-workflow note; `local` when finished work stays on a branch. */
		olderBody: (local: boolean, setsCardLimit: boolean) =>
			`Factory does not retry or re-scope stopped work on its own${local ? ", and finished work stays on a local branch, with no draft PR" : ""}. Update turns that on${setsCardLimit ? " and sets a $10 card limit" : ""}. The settings shown on this page stay as they are.`,
		update: "Update",
		draftReview: "Draft PR review",
		draftReviewOptions: {
			by_risk: "Only when needed",
			always: "Every change",
			never: "Never",
		},
		draftReviewHint: {
			by_risk:
				"A large change is asked about once, at its plan. The draft PR waits for you only if the result went beyond the plan or reviewers escalated it.",
			always: "Every draft PR waits for you to mark it as reviewed.",
			never: "Draft PRs never wait for you.",
		},
		pullRequests: "Pull requests",
		pullRequestOptions: {
			never: "Open as draft",
			when_no_review_required: "Mark ready when no review is needed",
		},
		pullRequestHint: {
			never:
				"Factory leaves every PR as a draft for you to mark ready, and never merges.",
			when_no_review_required:
				"Marked ready only after checks, the tester and an independent review all pass. PRs that need your review, or have open findings, stay drafts. Factory never merges.",
		},
		cardNoLimit: "No limit: a card keeps spending until you stop it.",
		/** A hands-off workflow with no card limit of its own. */
		cardBuiltInLimit: (amount: string) =>
			`Empty uses Factory's built-in ${amount} card limit.`,
		noLimitPlaceholder: "No limit",
	},
	/** Code review on Roles & models. */
	models: {
		codeReviewOptions: {
			adaptive: "Choose per change",
			fixed: "Every reviewer",
		},
		codeReviewHint: {
			adaptive: "Factory picks the reviewers each change needs.",
			fixed: "Every code reviewer reviews every change.",
		},
	},
} as const;

/** The chat's confirmation of a repository stages change from Ask Factory. */
export const FACTORY_STAGES_APPROVAL = {
	heading: "Change this project's Factory stages?",
	save: "Save and approve",
	notSavedYet:
		"Nothing is saved, approved or run until you choose. Saving approves the stages this change adds or changes.",
} as const;

/** The scoper's estimate, with its basis when it gave one. */
const priorityEstimated = (reason?: string) =>
	reason ? `estimated: ${reason}` : "estimated";

/** A card's priority; the level names are the shared labels. */
export const FACTORY_PRIORITY = {
	menu: "Priority",
	/** The icon's accessible name: "High priority". */
	level: (level: FactoryPriority) =>
		`${FACTORY_PRIORITY_LABEL[level]} priority`,
	/** The level and who set it: "High priority · set by you". */
	tooltip: (priority: Pick<FactoryPriorityState, "level" | "by" | "reason">) =>
		`${FACTORY_PRIORITY_LABEL[priority.level]} priority · ${
			priority.by === "person"
				? "set by you"
				: priority.by === "manager"
					? "set in Ask Factory"
					: priority.by === "agent"
						? "set by an agent"
						: priorityEstimated(priority.reason)
		}`,
	estimated: priorityEstimated,
	saveFailed: "Couldn't change the priority. Try again.",
} as const;

/** Duplicate detection on the card page: related cards and repeat requests. */
export const FACTORY_DUPLICATES = {
	related: "Related:",
	openRelated: (id: string) => `Open related card ${id}`,
	/** On a card later filings were matched to: "Also requested 2 times". */
	alsoRequested: (count: number) =>
		`Also requested ${count} ${count === 1 ? "time" : "times"}`,
	lastRequested: (when: string) => `Last requested ${when}`,
	/** Ask Factory, when a filing was blocked: "F12 already covers this — it is in Review." */
	covers: (id: string, state: string) =>
		`${id} already covers this — it is in ${state}.`,
	open: (id: string) => `Open ${id}`,
	fileAnyway: "File anyway",
	/** Sent for File anyway: the manager files it again with the check skipped. */
	fileAnywayPrompt:
		"This is different work. File it anyway (allow_duplicate: true).",
} as const;

/** Large work split into a parent card and its part cards. */
export const FACTORY_SPLIT = {
	/** A parent's progress: "2 of 5 parts delivered"; plainer before it loads. */
	progress: (
		parts: Pick<FactoryPartsSummary, "delivered" | "total"> | undefined,
	) =>
		parts
			? `${parts.delivered} of ${parts.total} ${parts.total === 1 ? "part" : "parts"} delivered`
			: "Tracking its parts",
	partOf: (id: string) => `Part of ${id}`,
	openParent: (id: string) => `Open ${id}, the card this part came from`,
	// Approving a breakdown
	approvalTitle: (count: number) => `Split into ${count} parts`,
	approvalHeadline: "Breakdown ready for your approval",
	approvalNext:
		"Each part becomes its own card. Approve the breakdown, or keep the request as one card.",
	why: "Why split",
	approve: "Approve breakdown",
	keep: "Keep as one card",
	include: (number: number, title: string) =>
		`Include part ${number}: ${title}`,
	leftOut: "Left out",
	startsAfter: (numbers: readonly number[]) =>
		`Starts after you merge ${factoryCardList(numbers.map((number) => `part ${number}`))}'s pull ${numbers.length === 1 ? "request" : "requests"}.`,
	// A parent
	parentHeadline: (count: number) => `Split into ${count} parts`,
	parentDone: "Every part is delivered or closed",
	parentClosed: "Every part closed before it was delivered",
	parentNext: "Its parts do the work; nothing runs on this card.",
	partsTitle: "Parts",
	archived: "Archived",
	/** A kept part with no card: before its card exists, or after. */
	creating: "Being created",
	notCreated: "Not created",
	removed: "Removed",
	cancelRemaining: "Cancel remaining parts",
	cancelRemainingTitle: (count: number) =>
		`Cancel ${count} remaining ${count === 1 ? "part" : "parts"}?`,
	cancelRemainingDescription:
		"Parts that have not delivered stop and close. Delivered parts and their pull requests stay as they are. You cannot undo this.",
	cancelRemainingConfirm: "Cancel parts",
	keepParts: "Keep parts",
	// A part that waits for an earlier part
	waitingNext: (ids: readonly string[]) =>
		`Starts on its own after you merge ${factoryCardList(ids)}'s pull ${ids.length === 1 ? "request" : "requests"}.`,
	openPullRequest: (id: string) => `Open ${id}'s PR`,
	openPr: "Open PR",
	unmergedNext: "Start this part anyway, or cancel it.",
	startAnyway: "Start anyway",
	cancelPart: "Cancel this part…",
	cancelPartTitle: "Cancel this part?",
	cancelPartDescription:
		"It closes without starting. The other parts are not affected.",
	cancelPartConfirm: "Cancel part",
	keepPart: "Keep part",
	// Notifications
	notificationTitle: "Breakdown ready for your approval",
	notificationBody: "approve the breakdown, or keep it as one card.",
} as const;
