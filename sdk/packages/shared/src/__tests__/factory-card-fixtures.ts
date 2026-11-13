/**
 * Shared fixtures for the Factory card agreement tests: one task (and its
 * last run) per state a card can be in, with what `factoryCardState` says
 * about it. Core's status tool test and the desktop's agreement test both
 * read this list, so the engine's words, the desktop's stage line, its Needs
 * you decision and its card header are checked against one answer.
 *
 * Test data only: not exported from the package.
 */
import {
	FACTORY_AUTO_APPROVAL_WAITING_PREFIX,
	FACTORY_PLAN_HOLD_TEXT,
	type FactoryRunState,
	factoryTaskConfigSchema,
} from "../factory";
import type { FactoryCardState } from "../factory-card-state";
import type { FactoryDependencyState } from "../factory-split";
import {
	type AgendaTaskRecord,
	type AgendaTaskRunRecord,
	factoryDesignProgressSchema,
} from "../tasks";

export interface FactoryCardFixture {
	name: string;
	task: AgendaTaskRecord;
	run?: AgendaTaskRunRecord;
	/** The Hub is running this card now (a scoping session or a run). */
	working?: boolean;
	/** What `factoryCardState` answers for it. */
	card: Pick<FactoryCardState, "kind" | "waitingOn" | "stage"> &
		Partial<Pick<FactoryCardState, "reasonCode" | "checks" | "flagged">>;
}

const AT = "2026-11-11T09:00:00.000Z";
const LATER = "2026-11-11T09:30:00.000Z";
const PR = "https://github.com/o/r/pull/7";

const config = factoryTaskConfigSchema.parse({
	approval: "required",
	checks: [{ name: "Behavior", command: "bun test", kind: "test" }],
	acceptanceCriteria: [
		{ id: "behavior", text: "The behavior holds", check: "Behavior" },
	],
});
const handsOff = {
	...config,
	autonomy: "hands_off" as const,
	approval: "automatic" as const,
};

const task = (overrides: Partial<AgendaTaskRecord> = {}): AgendaTaskRecord => ({
	taskId: "task_fixture",
	title: "Export CSV",
	instructions: "Export the activity view as CSV.",
	type: "todo",
	scope: "workspace",
	workspaceRoot: "/repo",
	status: "pending_approval",
	resourcePaths: [],
	priority: 3,
	availableAt: AT,
	expiresAt: "2099-01-01T00:00:00.000Z",
	automationEligible: false,
	revision: 2,
	createdBy: { kind: "user" },
	updatedBy: { kind: "user" },
	createdAt: AT,
	updatedAt: LATER,
	factory: config,
	...overrides,
});
const approved = (overrides: Partial<AgendaTaskRecord> = {}) =>
	task({ approvedRevision: 2, lastRunId: "run_1", ...overrides });

const design = (
	phase: "designing" | "reviewing" | "complete",
	extra: Record<string, unknown> = {},
) =>
	factoryDesignProgressSchema.parse({
		revision: 2,
		repairRound: 0,
		agents: {},
		designerSessionId: "designer",
		findings: [],
		phase,
		...(phase === "designing" ? {} : { reviewerSessions: [], reviews: [] }),
		...extra,
	});

const run = (
	factory: Partial<FactoryRunState> = {},
	overrides: Partial<AgendaTaskRunRecord> = {},
): AgendaTaskRunRecord =>
	({
		runId: "run_1",
		taskId: "task_fixture",
		taskRevision: 2,
		attempt: 1,
		status: "running",
		createdAt: AT,
		startedAt: AT,
		updatedAt: LATER,
		factory: {
			phase: "implementing",
			repairRound: 0,
			workspace: { path: "/data/worktrees/task_fixture/repo" },
			sessions: [],
			...factory,
		},
		...overrides,
	}) as AgendaTaskRunRecord;

const attempt = (role: "builder" | "reviewer" | "verifier") =>
	({
		id: `${role}-1`,
		key: role,
		role,
		repairRound: 0,
		createdAt: AT,
		sessionId: `${role}-session`,
		instructions: "…",
		agent: {},
		status: "running",
	}) as never;
const candidate = { commit: "abc", checks: [], reviews: [] };
const delivered = (
	factory: Partial<FactoryRunState> = {},
	overrides: Partial<AgendaTaskRecord> = {},
) => ({
	task: approved({ status: "completed", ...overrides }),
	run: run(
		{
			phase: "ready",
			candidate,
			humanReview: { required: false, reason: "local change" },
			...factory,
		},
		{ status: "completed" },
	),
});
const note = { selectedAt: AT, finding: "Wrong copy", reviewedAt: LATER };
const held = (text: string) =>
	task({
		factory: handsOff,
		factoryDesignProgress: design("complete"),
		error: `${FACTORY_AUTO_APPROVAL_WAITING_PREFIX}${text}`,
	});

export const FACTORY_CARD_FIXTURES: readonly FactoryCardFixture[] = [
	{
		name: "held before scoping",
		task: task({ factory: { ...config, hold: true } }),
		card: { kind: "held", waitingOn: "start", stage: "waiting" },
	},
	{
		name: "queued for scoping",
		task: task({ factory: handsOff, factoryQueued: "design" }),
		card: { kind: "queued", waitingOn: "slot", stage: "waiting" },
	},
	{
		name: "scoping",
		task: task({
			factory: handsOff,
			factoryQueued: "design",
			factoryDesignProgress: design("designing"),
		}),
		working: true,
		card: { kind: "scoping", waitingOn: "nobody", stage: "scope" },
	},
	{
		name: "scoping question",
		task: task({
			factoryDesignProgress: design("designing"),
			factoryQuestions: [
				{
					questionId: "q1",
					revision: 2,
					sessionId: "designer",
					question: "Include archived rows?",
					createdAt: AT,
					status: "pending",
				},
			],
		}),
		working: true,
		card: {
			kind: "scoping",
			waitingOn: "person",
			reasonCode: "question",
			stage: "scope",
		},
	},
	{
		name: "plan to approve",
		task: task({ factoryDesignProgress: design("complete") }),
		card: {
			kind: "awaiting_approval",
			waitingOn: "person",
			reasonCode: "plan_approval",
			stage: "scope",
		},
	},
	{
		name: "plan held: large change",
		task: held(`${FACTORY_PLAN_HOLD_TEXT.large_change}.`),
		card: {
			kind: "awaiting_approval",
			waitingOn: "person",
			reasonCode: "plan_held",
			stage: "scope",
		},
	},
	{
		name: "plan held: open findings",
		task: held(`${FACTORY_PLAN_HOLD_TEXT.open_findings}2) reached.`),
		card: {
			kind: "awaiting_approval",
			waitingOn: "person",
			reasonCode: "plan_held",
			stage: "scope",
		},
	},
	{
		name: "plan held: changed by you",
		task: held(`${FACTORY_PLAN_HOLD_TEXT.changed_by_you}.`),
		card: {
			kind: "awaiting_approval",
			waitingOn: "person",
			reasonCode: "plan_held",
			stage: "scope",
		},
	},
	{
		name: "plan held: not ready",
		task: held("no independent reviewer is configured."),
		card: {
			kind: "awaiting_approval",
			waitingOn: "person",
			reasonCode: "plan_held",
			stage: "scope",
		},
	},
	{
		name: "plan that cannot be approved",
		task: task({
			factory: { ...config, checks: [], acceptanceCriteria: [] },
			factoryDesignProgress: design("complete"),
		}),
		card: {
			kind: "awaiting_approval",
			waitingOn: "start",
			reasonCode: "plan_not_ready",
			stage: "scope",
		},
	},
	{
		name: "designer conclusion",
		task: task({
			factoryDesignProgress: design("complete", {
				conclusion: {
					outcome: "already_fixed",
					rationale: "Fixed in abc.",
					evidence: ["src/export.ts:10"],
				},
			}),
		}),
		card: {
			kind: "concluded",
			waitingOn: "person",
			reasonCode: "conclusion",
			stage: "scope",
		},
	},
	{
		name: "scoping stopped on a pending card",
		task: task({
			factory: handsOff,
			error: "Design did not complete: the designer gave up",
		}),
		card: {
			kind: "stopped",
			waitingOn: "person",
			reasonCode: "scoping_failed",
			stage: "scope",
		},
	},
	{
		name: "scoping failed",
		task: task({
			status: "failed",
			factory: handsOff,
			error: "Design did not complete: the designer gave up",
		}),
		card: {
			kind: "stopped",
			waitingOn: "person",
			reasonCode: "scoping_failed",
			stage: "scope",
		},
	},
	{
		name: "queued to run",
		task: approved({
			status: "approved",
			lastRunId: undefined,
			factoryQueued: "run",
		}),
		card: { kind: "queued", waitingOn: "slot", stage: "waiting" },
	},
	{
		name: "automatic retry queued",
		task: approved({
			status: "approved",
			factory: handsOff,
			factoryQueued: "run",
		}),
		run: run(
			{
				autoRecovery: { attempts: 1, reason: "socket hang up", at: LATER },
			},
			{ status: "failed" },
		),
		card: {
			kind: "queued",
			waitingOn: "slot",
			reasonCode: "auto_retry",
			stage: "build",
		},
	},
	{
		name: "retried by a person after a stop",
		task: approved({
			status: "approved",
			factory: handsOff,
			factoryQueued: "run",
		}),
		run: run(
			{ phase: "blocked", error: "Builder failed" },
			{ status: "failed" },
		),
		card: { kind: "queued", waitingOn: "slot", stage: "waiting" },
	},
	{
		name: "building",
		task: approved({ status: "in_progress" }),
		run: run({ attempts: [attempt("builder")] }),
		working: true,
		card: { kind: "running", waitingOn: "nobody", stage: "build" },
	},
	{
		name: "running checks",
		task: approved({ status: "in_progress" }),
		run: run({ phase: "verifying" }),
		working: true,
		card: {
			kind: "running",
			waitingOn: "nobody",
			stage: "build",
			checks: true,
		},
	},
	{
		name: "verifying",
		task: approved({
			status: "in_progress",
			factory: factoryTaskConfigSchema.parse({
				...config,
				agents: { verifier: {} },
			}),
		}),
		run: run({ phase: "verifying", attempts: [attempt("verifier")] }),
		working: true,
		card: { kind: "running", waitingOn: "nobody", stage: "verify" },
	},
	{
		name: "reviewing",
		task: approved({ status: "in_progress" }),
		run: run({ phase: "reviewing", attempts: [attempt("reviewer")] }),
		working: true,
		card: { kind: "running", waitingOn: "nobody", stage: "review" },
	},
	{
		name: "publishing",
		task: approved({ status: "in_progress" }),
		run: run({ phase: "publishing" }),
		working: true,
		card: { kind: "running", waitingOn: "nobody", stage: "review" },
	},
	{
		name: "run blocked before its stop is recorded",
		task: approved({ status: "in_progress" }),
		run: run({
			phase: "blocked",
			error: "Repair limit (2) reached.",
			candidate: {
				...candidate,
				reviews: [
					{
						reviewerIndex: 0,
						sessionId: "review",
						review: {
							verdict: "changes_requested",
							summary: "s",
							findings: ["a"],
						},
					},
				],
			},
		}),
		card: {
			kind: "stopped",
			waitingOn: "person",
			reasonCode: "repair_limit",
			stage: "review",
		},
	},
	{
		name: "stopped while building",
		task: approved({ status: "failed", error: "Builder failed" }),
		run: run(
			{ phase: "blocked", error: "Builder failed" },
			{ status: "failed" },
		),
		card: {
			kind: "stopped",
			waitingOn: "person",
			reasonCode: "unknown",
			stage: "build",
		},
	},
	{
		name: "draft PR could not open",
		task: approved({
			status: "failed",
			error: "Could not open the draft PR: Add an origin remote.",
		}),
		run: run(
			{ phase: "blocked", pullRequestError: "no origin" },
			{ status: "failed" },
		),
		card: {
			kind: "stopped",
			waitingOn: "person",
			reasonCode: "publish_failed",
			stage: "review",
		},
	},
	{
		name: "plan fault",
		task: approved({
			status: "failed",
			error: "The plan's checks need fixing: Check escapes the worktree.",
		}),
		run: run({ phase: "blocked" }, { status: "failed" }),
		card: {
			kind: "stopped",
			waitingOn: "person",
			reasonCode: "plan_fault",
			stage: "build",
			checks: true,
		},
	},
	{
		name: "draft PR left open with findings",
		task: approved({
			status: "failed",
			error: "Repair limit (2) reached; the draft PR stays open.",
		}),
		run: run(
			{
				phase: "blocked",
				pullRequestUrl: PR,
				unresolvedFindings: {
					commit: "abc",
					findings: ["a", "b"],
					pullRequestOpen: true,
				},
			},
			{ status: "failed" },
		),
		card: {
			kind: "delivered_with_findings",
			waitingOn: "person",
			reasonCode: "open_findings",
			stage: "delivered",
		},
	},
	{
		name: "delivered, stamp required",
		...delivered({
			pullRequestUrl: PR,
			humanReview: { required: true, reason: "sensitive paths" },
		}),
		card: {
			kind: "delivered",
			waitingOn: "person",
			reasonCode: "review_required",
			stage: "delivered",
		},
	},
	{
		name: "draft PR ready",
		...delivered({ pullRequestUrl: PR }),
		card: {
			kind: "delivered",
			waitingOn: "nobody",
			reasonCode: "draft_pr_ready",
			stage: "delivered",
		},
	},
	{
		name: "draft PR watched",
		...delivered(
			{
				phase: "watching",
				pullRequestUrl: PR,
				pullRequestWatch: { headCommit: "abc", handledFeedbackIds: [] },
			},
			{ factory: { ...handsOff, watchPullRequest: true } },
		),
		card: {
			kind: "delivered",
			waitingOn: "nobody",
			reasonCode: "none",
			stage: "delivered",
		},
	},
	{
		name: "draft PR merged",
		...delivered({
			pullRequestUrl: PR,
			humanReview: { required: true, reason: "sensitive paths" },
			pullRequestOutcome: { state: "merged", headChanged: false, at: LATER },
		}),
		card: {
			kind: "delivered",
			waitingOn: "nobody",
			reasonCode: "pr_merged",
			stage: "delivered",
		},
	},
	{
		name: "draft PR closed",
		...delivered({
			pullRequestUrl: PR,
			pullRequestOutcome: { state: "closed", headChanged: false, at: LATER },
		}),
		card: {
			kind: "delivered",
			waitingOn: "nobody",
			reasonCode: "pr_closed",
			stage: "delivered",
		},
	},
	{
		name: "PR follow-up paused",
		...delivered(
			{
				pullRequestUrl: PR,
				pullRequestWatch: {
					headCommit: "abc",
					handledFeedbackIds: [],
					paused: true,
				},
			},
			{ factory: { ...handsOff, watchPullRequest: true } },
		),
		card: {
			kind: "delivered",
			waitingOn: "person",
			reasonCode: "followup_paused",
			stage: "delivered",
		},
	},
	{
		name: "flagged delivery",
		...delivered({ pullRequestUrl: PR, audit: note }),
		card: {
			kind: "delivered",
			waitingOn: "nobody",
			stage: "delivered",
			flagged: true,
		},
	},
	{
		name: "flagged delivery recorded as a stop by an older Hub",
		...delivered({
			phase: "blocked",
			error: "Human sample finding: Wrong copy",
			pullRequestUrl: PR,
			audit: note,
		}),
		card: {
			kind: "delivered",
			waitingOn: "nobody",
			stage: "delivered",
			flagged: true,
		},
	},
	{
		name: "proposed rule",
		...delivered({
			pullRequestUrl: PR,
			audit: {
				...note,
				analysis: { status: "proposed", trigger: "feedback", startedAt: AT },
			},
		}),
		card: {
			kind: "delivered",
			waitingOn: "person",
			reasonCode: "rule_proposed",
			stage: "delivered",
		},
	},
	{
		name: "unrated hands-off delivery",
		...delivered(
			{ audit: { selectedAt: AT, selectionReason: "delivered" } },
			{ factory: handsOff },
		),
		card: {
			kind: "delivered",
			waitingOn: "nobody",
			reasonCode: "none",
			stage: "delivered",
		},
	},
	{
		name: "PR follow-up stopped after delivery",
		...delivered({
			phase: "blocked",
			pullRequestUrl: PR,
			error: "CI log unavailable",
		}),
		card: {
			kind: "stopped",
			waitingOn: "person",
			reasonCode: "unknown",
			stage: "build",
		},
	},
	{
		name: "flagged delivery whose PR follow-up stopped",
		...delivered({
			phase: "blocked",
			pullRequestUrl: PR,
			error: "CI log unavailable",
			audit: note,
		}),
		card: {
			kind: "stopped",
			waitingOn: "person",
			reasonCode: "unknown",
			stage: "build",
		},
	},
	{
		name: "cancelled",
		task: task({ status: "cancelled", error: "Not needed." }),
		card: {
			kind: "closed",
			waitingOn: "nobody",
			reasonCode: "cancelled",
			stage: "waiting",
		},
	},
	{
		name: "archived after a stop",
		task: approved({
			status: "failed",
			error: "Builder failed",
			archivedAt: LATER,
		}),
		run: run({ phase: "blocked" }, { status: "failed" }),
		card: {
			kind: "archived",
			waitingOn: "nobody",
			reasonCode: "archived",
			stage: "build",
		},
	},
	{
		name: "manual card not started",
		task: task({ factory: { ...config, checks: [], acceptanceCriteria: [] } }),
		card: { kind: "not_started", waitingOn: "start", stage: "waiting" },
	},
	{
		name: "hands-off card not started",
		task: task({ factory: handsOff }),
		card: { kind: "not_started", waitingOn: "nobody", stage: "waiting" },
	},
];

/**
 * A split's cards, with the link facts a host reads beside the card: a
 * parent's parts (each part's short id and state; no state: deleted) and a
 * waiting part's dependency state. Hosts fold `parts` with
 * `factoryPartsSummary` and pass both to `factoryCardState`.
 */
export interface FactorySplitCardFixture extends FactoryCardFixture {
	parts?: {
		id: string;
		state?: Pick<
			FactoryCardState,
			| "kind"
			| "waitingOn"
			| "reasonCode"
			| "stage"
			| "deliverable"
			| "waitingFor"
		>;
	}[];
	dependency?: FactoryDependencyState;
}

const SPLIT_RECORD = {
	splitId: "split_1",
	revision: 2,
	approvedAt: AT,
	createdAt: AT,
	goal: "Export the activity view and tidy the footer",
	parts: [
		{
			title: "Add CSV export",
			brief: "Export the activity view as CSV.",
			paths: ["src/export"],
			dependsOn: [],
			taskId: "task_part_1",
		},
		{
			title: "Link the export from reports",
			brief: "Link the CSV export from the reports page.",
			paths: ["src/reports"],
			dependsOn: [0],
			taskId: "task_part_2",
		},
	],
};
const deliveredPart = {
	kind: "delivered",
	waitingOn: "nobody",
	reasonCode: "draft_pr_ready",
	stage: "delivered",
	deliverable: { kind: "draft_pr", url: PR },
} as const;
const cancelledPart = {
	kind: "closed",
	waitingOn: "nobody",
	reasonCode: "cancelled",
	stage: "waiting",
} as const;
const waitingPart: Pick<
	FactoryCardState,
	"kind" | "waitingOn" | "reasonCode" | "stage" | "waitingFor"
> = {
	kind: "queued",
	waitingOn: "card",
	reasonCode: "waiting_on_card",
	stage: "waiting",
	waitingFor: ["F41"],
};

export const FACTORY_SPLIT_CARD_FIXTURES: readonly FactorySplitCardFixture[] = [
	{
		name: "breakdown to approve",
		task: task({
			factory: handsOff,
			factoryDesignProgress: design("complete", {
				split: {
					rationale: "Two separate changes",
					goal: SPLIT_RECORD.goal,
					parts: SPLIT_RECORD.parts.map(({ taskId: _taskId, ...part }) => part),
				},
			}),
		}),
		card: {
			kind: "awaiting_approval",
			waitingOn: "person",
			reasonCode: "split_approval",
			stage: "scope",
		},
	},
	{
		name: "parent tracking its parts",
		task: task({
			status: "completed",
			completedAt: LATER,
			factorySplit: SPLIT_RECORD,
		}),
		parts: [
			{ id: "F41", state: deliveredPart },
			{ id: "F42", state: waitingPart },
		],
		card: {
			kind: "tracking",
			waitingOn: "nobody",
			reasonCode: "tracking",
			stage: "build",
		},
	},
	{
		name: "parent with every part settled",
		task: task({
			status: "completed",
			completedAt: LATER,
			factorySplit: SPLIT_RECORD,
		}),
		parts: [
			{ id: "F41", state: deliveredPart },
			{ id: "F42", state: cancelledPart },
		],
		card: {
			kind: "delivered",
			waitingOn: "nobody",
			reasonCode: "parts_delivered",
			stage: "delivered",
		},
	},
	{
		name: "parent whose parts were all cancelled",
		task: task({
			status: "completed",
			completedAt: LATER,
			factorySplit: { ...SPLIT_RECORD, cancelledAt: LATER },
		}),
		parts: [
			{ id: "F41", state: cancelledPart },
			{ id: "F42", state: cancelledPart },
		],
		card: {
			kind: "closed",
			waitingOn: "nobody",
			reasonCode: "parts_closed",
			stage: "build",
		},
	},
	{
		name: "part waiting for an earlier merge",
		task: task({
			factory: handsOff,
			factoryParentTaskId: "task_parent",
			factoryBlockedBy: { taskIds: ["task_part_1"], met: {} },
			factoryQueued: "design",
			factoryQueuedAt: AT,
		}),
		dependency: { state: "waiting", on: ["F41"] },
		card: { kind: "queued", waitingOn: "card", stage: "waiting" },
	},
	{
		name: "part whose earlier part closed unmerged",
		task: task({
			factory: handsOff,
			factoryParentTaskId: "task_parent",
			factoryBlockedBy: { taskIds: ["task_part_1"], met: {} },
			factoryQueued: "design",
			factoryQueuedAt: AT,
		}),
		dependency: {
			state: "unavailable",
			on: ["F41"],
			reason: "F41 was closed without merging",
		},
		card: {
			kind: "queued",
			waitingOn: "person",
			reasonCode: "dependency_unavailable",
			stage: "waiting",
		},
	},
];

/**
 * Every fixture as its own card on one board, each filed a minute before the
 * one above it: the board and `factory_status` must list its Needs you in
 * the same order (FACTORY_NEEDS_YOU_ORDER).
 */
export const FACTORY_BOARD_FIXTURES: readonly FactoryCardFixture[] =
	FACTORY_CARD_FIXTURES.map((fixture, index) => {
		const taskId = `board_${index + 1}`;
		const at = new Date(Date.parse(AT) - index * 60_000).toISOString();
		return {
			...fixture,
			task: {
				...fixture.task,
				taskId,
				factoryNumber: index + 1,
				createdAt: at,
				availableAt: at,
			},
			...(fixture.run ? { run: { ...fixture.run, taskId } } : {}),
		};
	});

/** The Needs you order of FACTORY_BOARD_FIXTURES, by fixture name. */
export const FACTORY_NEEDS_YOU_ORDER: readonly string[] = [
	// Stopped: a card awaiting approval first, then the agenda's order.
	"run blocked before its stop is recorded",
	"scoping stopped on a pending card",
	"plan fault",
	"draft PR could not open",
	"stopped while building",
	"scoping failed",
	"flagged delivery whose PR follow-up stopped",
	"PR follow-up stopped after delivery",
	// A question, then plans to decide on.
	"scoping question",
	"designer conclusion",
	"plan held: not ready",
	"plan held: changed by you",
	"plan held: open findings",
	"plan held: large change",
	"plan to approve",
	// Results to review, then a proposed rule.
	"draft PR left open with findings",
	"PR follow-up paused",
	"delivered, stamp required",
	"proposed rule",
];
