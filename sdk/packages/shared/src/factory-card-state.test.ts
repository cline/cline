import { describe, expect, expectTypeOf, it } from "vitest";
import { FACTORY_PR_REVIEW_CARD_FIXTURES } from "./__tests__/factory-card-fixtures";
import {
	FACTORY_AUTO_APPROVAL_WAITING_PREFIX,
	FACTORY_PLAN_FAULT_PREFIX,
	FACTORY_PLAN_FAULT_STOPPED_PREFIX,
	FACTORY_PLAN_HOLD_TEXT,
	FACTORY_PUBLISH_FAILURE_PREFIX,
	factoryDailySpendingLimitReason,
	factorySpendingLimitReason,
} from "./factory";
import {
	FACTORY_CARD_KINDS,
	FACTORY_CARD_REASON_CODES,
	type FactoryCardKind,
	type FactoryCardReasonCode,
	type FactoryCardRunFacts,
	type FactoryCardState,
	type FactoryCardStateInput,
	type FactoryCardTaskFacts,
	factoryCardState,
	factoryErrorReasonCode,
} from "./factory-card-state";
import * as browser from "./index.browser";
import type { AgendaTaskRecord, AgendaTaskRunRecord } from "./tasks";

// Shapes follow core's factory-tool.test.ts and factory-hands-off.test.ts.
const WORKTREE = "/data/factory/factory-worktrees/task_a/repo";
const card = (
	overrides: Partial<FactoryCardTaskFacts> = {},
): FactoryCardTaskFacts => ({
	status: "pending_approval",
	revision: 2,
	workspaceRoot: "/repo",
	factory: { approval: "required" },
	...overrides,
});
const handsOff = { autonomy: "hands_off", approval: "automatic" } as const;
const run = (
	factory: Partial<NonNullable<FactoryCardRunFacts["factory"]>> = {},
	overrides: Partial<FactoryCardRunFacts> = {},
): FactoryCardRunFacts => ({
	status: "running",
	taskRevision: 2,
	factory: {
		phase: "implementing",
		workspace: { path: WORKTREE },
		...factory,
	},
	...overrides,
});
const design = (
	phase: "designing" | "reviewing" | "complete",
	extra: Partial<
		NonNullable<FactoryCardTaskFacts["factoryDesignProgress"]>
	> = {},
) => ({
	phase,
	revision: 2,
	...(phase === "designing" ? {} : { reviewerSessions: [] }),
	...extra,
});
const attempt = (
	role: "builder" | "reviewer" | "verifier",
	status = "running",
) =>
	({
		id: `${role}-1`,
		key: role,
		role,
		repairRound: 0,
		createdAt: "2026-11-11T00:00:00.000Z",
		sessionId: `${role}-session`,
		instructions: "…",
		agent: {},
		status,
	}) as never;
const check = (status: "passed" | "failed") =>
	({ name: "Behavior", command: "true", status }) as never;
const review = (verdict: "pass" | "changes_requested") => ({
	reviewerIndex: 0,
	sessionId: "review",
	review: { verdict, summary: "s", findings: [] },
});
const candidate = (
	checks: Array<"passed" | "failed">,
	verdicts: Array<"pass" | "changes_requested"> = [],
	verification?: "pass" | "fail",
) =>
	({
		commit: "abc",
		checks: checks.map(check),
		reviews: verdicts.map(review),
		...(verification
			? {
					verification: {
						sessionId: "v",
						review: { verdict: verification },
						artifacts: [],
					},
				}
			: {}),
	}) as never;
const question = {
	questionId: "q1",
	revision: 2,
	sessionId: "designer",
	question: "Should archived rows be included?",
	createdAt: "2026-11-11T00:00:00.000Z",
	status: "pending",
};
const PR = "https://github.com/o/r/pull/7";
const behaviorCheck = {
	name: "Behavior",
	command: "true",
	kind: "test",
} as never;
const localSelection = {
	impact: "local" as const,
	rationale: "One file",
	affectedPaths: ["src/form.ts"],
	consumers: ["form"],
	planReviewerIndices: [],
	reviewerIndices: [0],
};

type Expected = {
	kind: FactoryCardKind;
	waitingOn: FactoryCardState["waitingOn"];
	reasonCode: FactoryCardReasonCode;
	stage?: FactoryCardState["stage"];
	checks?: true;
	reasonText?: string;
	deliverable?: FactoryCardState["deliverable"];
	parts?: FactoryCardState["parts"];
	waitingFor?: FactoryCardState["waitingFor"];
};
type Case = [label: string, input: FactoryCardStateInput, expected: Expected];

const failed = (
	error: string,
	factory?: Partial<NonNullable<FactoryCardRunFacts["factory"]>>,
): FactoryCardStateInput => ({
	task: card({
		status: "failed",
		error,
		approvedRevision: 2,
		lastRunId: "run_1",
	}),
	...(factory ? { lastRun: run(factory, { status: "failed", error }) } : {}),
});

const SPLIT = {
	splitId: "s1",
	revision: 2,
	approvedAt: "2026-11-11T00:00:00.000Z",
	createdAt: "2026-11-11T00:00:00.000Z",
	goal: "Export and rename",
	parts: [
		{ title: "A", brief: "A", paths: ["a"], dependsOn: [], taskId: "task_a" },
		{ title: "B", brief: "B", paths: ["b"], dependsOn: [0], taskId: "task_b" },
	],
};
const NO_PARTS = {
	total: 0,
	delivered: 0,
	merged: 0,
	open: 0,
	needsYou: 0,
	stopped: 0,
	closed: 0,
};

const CASES: Case[] = [
	// held
	[
		"an explicitly held card before scoping",
		{ task: card({ factory: { approval: "required", hold: true } }) },
		{
			kind: "held",
			waitingOn: "start",
			reasonCode: "held",
			stage: "waiting",
		},
	],
	// queued
	[
		"a card queued for scoping with a free slot",
		{ task: card({ factory: handsOff, factoryQueued: "design" }) },
		{
			kind: "queued",
			waitingOn: "slot",
			reasonCode: "none",
			stage: "waiting",
		},
	],
	[
		"an approved card queued to run while every slot is in use",
		{
			task: card({
				status: "approved",
				approvedRevision: 2,
				factoryQueued: "run",
			}),
			live: { slotsFull: true },
		},
		{
			kind: "queued",
			waitingOn: "slot",
			reasonCode: "slots_full",
		},
	],
	[
		"a queued card while Factory is paused",
		{
			task: card({
				status: "approved",
				approvedRevision: 2,
				factoryQueued: "run",
			}),
			live: { paused: true, slotsFull: true },
		},
		{
			kind: "queued",
			waitingOn: "slot",
			reasonCode: "factory_paused",
			reasonText: "Factory is paused",
		},
	],
	[
		"a run the Hub restart re-queued",
		{
			task: card({
				status: "approved",
				approvedRevision: 2,
				factoryQueued: "run",
			}),
			lastRun: run({}, { status: "interrupted" }),
		},
		{ kind: "queued", waitingOn: "slot", reasonCode: "interrupted" },
	],
	[
		"a hands-off run whose one automatic retry is queued",
		{
			task: card({
				status: "approved",
				approvedRevision: 2,
				factoryQueued: "run",
				factory: handsOff,
			}),
			lastRun: run(
				{
					autoRecovery: {
						attempts: 1,
						reason: "socket hang up",
						at: "2026-11-11T00:00:00.000Z",
					},
				},
				{ status: "failed", error: "socket hang up" },
			),
		},
		{
			kind: "queued",
			waitingOn: "slot",
			reasonCode: "auto_retry",
			reasonText: "socket hang up",
		},
	],
	// scoping
	[
		"a live designer",
		{
			task: card({
				factory: handsOff,
				factoryQueued: "design",
				factoryDesignProgress: design("designing"),
			}),
			live: { designLive: true },
		},
		{
			kind: "scoping",
			waitingOn: "nobody",
			reasonCode: "none",
			stage: "scope",
		},
	],
	[
		"live plan reviewers",
		{
			task: card({
				factoryDesignProgress: design("reviewing", {
					reviewerSessions: [{ reviewerIndex: 0 }],
				}),
			}),
			live: { designLive: true },
		},
		{
			kind: "scoping",
			waitingOn: "nobody",
			reasonCode: "none",
			stage: "scope",
		},
	],
	[
		"a scoping question waiting for an answer",
		{
			task: card({
				factoryQuestions: [question],
				factoryDesignProgress: design("designing"),
			}),
			live: { designLive: true },
		},
		{
			kind: "scoping",
			waitingOn: "person",
			reasonCode: "question",
			reasonText: "Should archived rows be included?",
			stage: "scope",
		},
	],
	[
		"a question from an earlier revision does not wait",
		{
			task: card({
				factoryQuestions: [{ ...question, revision: 1 }],
				factoryQueued: "design",
			}),
		},
		{ kind: "queued", waitingOn: "slot", reasonCode: "none" },
	],
	// awaiting_approval
	[
		"a settled plan that needs approval",
		{
			task: card({
				factoryDesignProgress: design("complete", {
					reviewerSessions: [{ reviewerIndex: 0 }],
				}),
			}),
		},
		{
			kind: "awaiting_approval",
			waitingOn: "person",
			reasonCode: "plan_approval",
			stage: "scope",
		},
	],
	[
		"a plan automatic approval refused",
		{
			task: card({
				factory: handsOff,
				factoryDesignProgress: design("complete"),
				error: `${FACTORY_AUTO_APPROVAL_WAITING_PREFIX}no independent reviewer is configured: add a reviewer on a different model in Factory settings, or approve this plan yourself.`,
			}),
		},
		{
			kind: "awaiting_approval",
			waitingOn: "person",
			reasonCode: "plan_held",
			reasonText:
				"no independent reviewer is configured: add a reviewer on a different model in Factory settings, or approve this plan yourself.",
		},
	],
	// concluded
	[
		"a designer conclusion waiting for confirmation",
		{
			task: card({
				factoryDesignProgress: design("complete", {
					conclusion: {
						outcome: "already_fixed",
						rationale: "Fixed in abc123.",
					},
				}),
			}),
		},
		{
			kind: "concluded",
			waitingOn: "person",
			reasonCode: "conclusion",
			reasonText: "already_fixed: Fixed in abc123.",
			stage: "scope",
		},
	],
	// running
	[
		"a builder at work",
		{
			task: card({ status: "in_progress", approvedRevision: 2 }),
			lastRun: run({ attempts: [attempt("builder")] }),
			live: { runLive: true },
		},
		{
			kind: "running",
			waitingOn: "nobody",
			reasonCode: "none",
			stage: "build",
		},
	],
	[
		"an approved card whose run is starting (no run state yet)",
		{
			task: card({ status: "approved", approvedRevision: 2 }),
			live: { runLive: true },
		},
		{
			kind: "running",
			waitingOn: "nobody",
			reasonCode: "none",
			stage: "build",
		},
	],
	[
		"deterministic checks running",
		{
			task: card({
				status: "in_progress",
				approvedRevision: 2,
				factory: { approval: "required", checks: [behaviorCheck] },
			}),
			lastRun: run({ phase: "verifying" }),
		},
		{
			kind: "running",
			waitingOn: "nobody",
			reasonCode: "none",
			stage: "build",
			checks: true,
		},
	],
	[
		"the verifier running",
		{
			task: card({ status: "in_progress", approvedRevision: 2 }),
			lastRun: run({ phase: "verifying", attempts: [attempt("verifier")] }),
		},
		{
			kind: "running",
			waitingOn: "nobody",
			reasonCode: "none",
			stage: "verify",
		},
	],
	[
		"reviewers running on a run without a verifier",
		{
			task: card({ status: "in_progress", approvedRevision: 2 }),
			lastRun: run({
				phase: "reviewing",
				agents: { implementers: [{}], reviewers: [{}] } as never,
			}),
		},
		{
			kind: "running",
			waitingOn: "nobody",
			reasonCode: "none",
			stage: "review",
		},
	],
	[
		"publishing the draft PR",
		{
			task: card({ status: "in_progress", approvedRevision: 2 }),
			lastRun: run({ phase: "publishing" }),
		},
		{
			kind: "running",
			waitingOn: "nobody",
			reasonCode: "none",
			stage: "review",
		},
	],
	// delivered
	[
		"a delivered local change with no PR and no stamp needed",
		{
			task: card({
				status: "completed",
				approvedRevision: 2,
				factory: { ...handsOff },
			}),
			lastRun: run(
				{
					phase: "ready",
					reviewSelection: localSelection,
					agents: { implementers: [{}], reviewers: [{}] } as never,
				},
				{ status: "completed" },
			),
		},
		{
			kind: "delivered",
			waitingOn: "nobody",
			reasonCode: "none",
			stage: "delivered",
			deliverable: { kind: "branch" },
		},
	],
	[
		"a draft PR whose workflow always needs a stamp",
		{
			task: card({
				status: "completed",
				approvedRevision: 2,
				factory: { approval: "required", humanStamp: "always" },
			}),
			lastRun: run(
				{
					phase: "ready",
					pullRequestUrl: PR,
					humanReview: {
						required: true,
						reason: "workflow always requires a stamp",
					},
				},
				{ status: "completed" },
			),
		},
		{
			kind: "delivered",
			waitingOn: "person",
			reasonCode: "review_required",
			reasonText: "workflow always requires a stamp",
			deliverable: { kind: "draft_pr", url: PR },
		},
	],
	[
		"an open draft PR that needs no stamp is not the person's decision",
		{
			task: card({
				status: "completed",
				approvedRevision: 2,
				// PR follow-up turned off; unset is on for hands-off work.
				factory: { ...handsOff, watchPullRequest: false },
			}),
			lastRun: run(
				{ phase: "ready", pullRequestUrl: PR, reviewSelection: localSelection },
				{ status: "completed" },
			),
		},
		{ kind: "delivered", waitingOn: "nobody", reasonCode: "draft_pr_ready" },
	],
	[
		"a watched draft PR that needs no stamp",
		{
			task: card({
				status: "completed",
				approvedRevision: 2,
				factory: { ...handsOff, watchPullRequest: true },
			}),
			lastRun: run(
				{
					phase: "watching",
					pullRequestUrl: PR,
					reviewSelection: localSelection,
				},
				{ status: "completed" },
			),
		},
		{ kind: "delivered", waitingOn: "nobody", reasonCode: "none" },
	],
	[
		"a stamped draft PR",
		{
			task: card({
				status: "completed",
				approvedRevision: 2,
				factory: { approval: "required", humanStamp: "always" },
			}),
			lastRun: run(
				{
					phase: "ready",
					pullRequestUrl: PR,
					humanApproval: {
						commit: "abc",
						approvedAt: "2026-11-11T00:00:00.000Z",
					},
				},
				{ status: "completed" },
			),
		},
		{ kind: "delivered", waitingOn: "nobody", reasonCode: "none" },
	],
	[
		"a run that reached ready before its task completed",
		{
			task: card({
				status: "in_progress",
				approvedRevision: 2,
				factory: { approval: "required", humanStamp: "never" },
			}),
			lastRun: run({ phase: "ready" }),
		},
		{
			kind: "delivered",
			waitingOn: "nobody",
			reasonCode: "none",
			stage: "delivered",
		},
	],
	// delivered_with_findings
	[
		"a draft PR left open at the repair limit with findings",
		{
			task: card({
				status: "failed",
				approvedRevision: 2,
				error:
					"Repair limit (2) reached; the draft PR stays open with 3 unresolved findings.\n- Reviewer 1: …",
			}),
			lastRun: run(
				{
					phase: "blocked",
					pullRequestUrl: PR,
					unresolvedFindings: {
						commit: "abc",
						findings: ["a", "b", "c"],
						pullRequestOpen: true,
					},
				},
				{ status: "failed" },
			),
		},
		{
			kind: "delivered_with_findings",
			waitingOn: "person",
			reasonCode: "open_findings",
			reasonText: "3 unresolved findings",
			stage: "delivered",
			deliverable: { kind: "draft_pr", url: PR },
		},
	],
	[
		"a stamped draft PR with open findings",
		{
			task: card({
				status: "failed",
				approvedRevision: 2,
				error: "Repair limit (2) reached.",
			}),
			lastRun: run(
				{
					phase: "blocked",
					pullRequestUrl: PR,
					humanApproval: {
						commit: "abc",
						approvedAt: "2026-11-11T00:00:00.000Z",
					},
					unresolvedFindings: {
						commit: "abc",
						findings: ["a"],
						pullRequestOpen: true,
					},
				},
				{ status: "failed" },
			),
		},
		{
			kind: "delivered_with_findings",
			waitingOn: "nobody",
			reasonCode: "open_findings",
			reasonText: "1 unresolved finding",
		},
	],
	// stopped: every recorded reason
	[
		"a plan fault Try again re-scopes",
		failed(
			`${FACTORY_PLAN_FAULT_PREFIX}Check "Behavior" artifact "/tmp/behavior.log" escapes.`,
			{
				phase: "implementing",
			},
		),
		{
			kind: "stopped",
			waitingOn: "person",
			reasonCode: "plan_fault",
			stage: "build",
			checks: true,
		},
	],
	[
		"a plan fault Factory will not re-scope again",
		failed(
			`${FACTORY_PLAN_FAULT_STOPPED_PREFIX}Factory already sent the plan back to scoping once for these checks, so it waits for you: edit the plan's checks, then approve it again.\nCheck "Behavior"`,
		),
		{
			kind: "stopped",
			waitingOn: "person",
			reasonCode: "plan_fault_unfixable",
			stage: "build",
			checks: true,
			reasonText:
				"The plan's checks still need fixing: Factory already sent the plan back to scoping once for these checks, so it waits for you: edit the plan's checks, then approve it again.",
		},
	],
	[
		"a draft PR Factory could not open",
		failed(
			`${FACTORY_PUBLISH_FAILURE_PREFIX}Add an origin remote, then try again.`,
			{
				phase: "blocked",
				candidate: candidate(["passed"], ["pass"]),
			},
		),
		{
			kind: "stopped",
			waitingOn: "person",
			reasonCode: "publish_failed",
			stage: "review",
		},
	],
	[
		"an older run's publish failure wording",
		failed("Could not confirm the draft PR after pushing.", {
			phase: "blocked",
		}),
		{
			kind: "stopped",
			waitingOn: "person",
			reasonCode: "publish_failed",
			stage: "review",
		},
	],
	[
		"the card's spending limit at run start",
		failed(factorySpendingLimitReason(10)),
		{
			kind: "stopped",
			waitingOn: "person",
			reasonCode: "spend_limit",
			reasonText:
				"This card reached its $10 spending limit. Raise the limit or stop here.",
		},
	],
	[
		"Factory's daily spending limit",
		failed(factoryDailySpendingLimitReason(50)),
		{ kind: "stopped", waitingOn: "person", reasonCode: "daily_spend_limit" },
	],
	[
		"the review repair limit with findings in a worktree path",
		failed(
			`Repair limit (2) reached.\n- Reviewer 1: Redundant gate in ${WORKTREE}/apps/a.ts.`,
			{
				phase: "blocked",
				candidate: candidate(["passed"], ["changes_requested"]),
			},
		),
		{
			kind: "stopped",
			waitingOn: "person",
			reasonCode: "repair_limit",
			reasonText: "Repair limit (2) reached.",
			stage: "review",
		},
	],
	[
		"a broken verification profile Factory will not reopen again",
		failed(
			"Verification profile failed (start): port 3000 already in use\n\nFactory already reopened design once for a broken verification profile on this card, so it waits for you: fix the verification setup.",
			{ phase: "implementing" },
		),
		{
			kind: "stopped",
			waitingOn: "person",
			reasonCode: "profile_failed",
			stage: "build",
		},
	],
	[
		"verification that stayed unavailable",
		failed(
			"Required verification remains unavailable after 2 retries: browser missing. Restore the missing capability or revise the approved verification setup before retrying.",
			{ phase: "blocked", candidate: candidate(["passed"], [], "fail") },
		),
		{
			kind: "stopped",
			waitingOn: "person",
			reasonCode: "verification_unavailable",
			stage: "verify",
		},
	],
	[
		"failing checks at the stop",
		failed("Checks failed: bun test exited 1", {
			phase: "blocked",
			candidate: candidate(["failed"]),
		}),
		{
			kind: "stopped",
			waitingOn: "person",
			reasonCode: "unknown",
			stage: "build",
			checks: true,
		},
	],
	[
		"a run Factory restarted twice after Hub stops",
		failed(
			"Factory restarted this run 2 times after the Hub stopped mid-run, so it stops here: check the card's workspace, then try again.",
			{ phase: "implementing" },
		),
		{
			kind: "stopped",
			waitingOn: "person",
			reasonCode: "interrupted",
			stage: "build",
		},
	],
	[
		"a failed scoping session on a failed card",
		{
			task: card({
				status: "failed",
				error: "Design did not complete: the designer gave up",
			}),
		},
		{
			kind: "stopped",
			waitingOn: "person",
			reasonCode: "scoping_failed",
			stage: "scope",
		},
	],
	[
		"an unrecognised error",
		failed("Builder failed", { phase: "implementing" }),
		{
			kind: "stopped",
			waitingOn: "person",
			reasonCode: "unknown",
			reasonText: "Builder failed",
		},
	],
	[
		"a run blocked before its failure is recorded",
		{
			task: card({ status: "in_progress", approvedRevision: 2 }),
			lastRun: run({
				phase: "blocked",
				error: "Repair limit (1) reached.",
				candidate: candidate(["passed"], ["changes_requested"]),
			}),
		},
		{
			kind: "stopped",
			waitingOn: "person",
			reasonCode: "repair_limit",
			stage: "review",
		},
	],
	[
		"a cancelled card that was building",
		{
			task: card({ status: "cancelled", error: "Task archived." }),
			lastRun: run({}, { status: "cancelled" }),
		},
		{
			kind: "closed",
			waitingOn: "nobody",
			reasonCode: "cancelled",
			stage: "build",
			reasonText: "Task archived.",
		},
	],
	[
		"a cancelled card that was waiting",
		{ task: card({ status: "cancelled" }) },
		{
			kind: "closed",
			waitingOn: "nobody",
			reasonCode: "cancelled",
			stage: "waiting",
		},
	],
	[
		"an expired card",
		{ task: card({ status: "expired" }) },
		{ kind: "closed", waitingOn: "nobody", reasonCode: "expired" },
	],
	// not_started
	[
		"a hands-off card nothing queued or held",
		{ task: card({ factory: handsOff }) },
		{
			kind: "not_started",
			waitingOn: "nobody",
			reasonCode: "not_started",
			stage: "waiting",
		},
	],
	[
		"a manual card waiting for Start scoping",
		{ task: card() },
		{ kind: "not_started", waitingOn: "start", reasonCode: "not_started" },
	],
	[
		"scoping progress nobody is working or queued",
		{
			task: card({
				factory: handsOff,
				factoryDesignProgress: design("designing"),
			}),
		},
		{
			kind: "not_started",
			waitingOn: "nobody",
			reasonCode: "not_started",
		},
	],
	[
		"an approved card that is not queued",
		{
			task: card({
				status: "approved",
				approvedRevision: 2,
				factory: handsOff,
			}),
		},
		{ kind: "not_started", waitingOn: "nobody", reasonCode: "not_started" },
	],
	[
		"scoping refused at the card's spending limit",
		{ task: card({ factory: handsOff, error: factorySpendingLimitReason(1) }) },
		{
			kind: "stopped",
			waitingOn: "person",
			reasonCode: "spend_limit",
			stage: "scope",
		},
	],
	[
		"scoping that did not start",
		{
			task: card({
				factory: handsOff,
				error: "Design did not start: Feature design is unavailable",
			}),
		},
		{
			kind: "stopped",
			waitingOn: "person",
			reasonCode: "scoping_failed",
			stage: "scope",
		},
	],
	// newer states
	[
		"a plan held because it is a large change",
		{
			task: card({
				factory: handsOff,
				factoryDesignProgress: design("complete"),
				error: `${FACTORY_AUTO_APPROVAL_WAITING_PREFIX}${FACTORY_PLAN_HOLD_TEXT.large_change}.`,
			}),
		},
		{
			kind: "awaiting_approval",
			waitingOn: "person",
			reasonCode: "plan_held",
			planHold: "large_change",
			stage: "scope",
		},
	],
	[
		"a settled plan that cannot be approved as written",
		{
			task: card({ factoryDesignProgress: design("complete") }),
			planApprovable: false,
		},
		{
			kind: "awaiting_approval",
			waitingOn: "start",
			reasonCode: "plan_not_ready",
			stage: "scope",
		},
	],
	[
		"a plan written without scoping that can be approved",
		{ task: card(), planApprovable: true },
		{
			kind: "awaiting_approval",
			waitingOn: "person",
			reasonCode: "plan_approval",
			stage: "scope",
		},
	],
	[
		"scoping that finally failed on a pending card",
		{
			task: card({
				factory: handsOff,
				error: "Design did not complete: the designer gave up",
			}),
		},
		{
			kind: "stopped",
			waitingOn: "person",
			reasonCode: "scoping_failed",
			stage: "scope",
		},
	],
	[
		"a merged draft PR",
		{
			task: card({
				status: "completed",
				approvedRevision: 2,
				factory: { approval: "required", humanStamp: "always" },
			}),
			lastRun: run(
				{
					phase: "ready",
					pullRequestUrl: PR,
					pullRequestOutcome: {
						state: "merged",
						headChanged: false,
						at: "2026-11-11T00:00:00.000Z",
					},
				},
				{ status: "completed" },
			),
		},
		{
			kind: "delivered",
			waitingOn: "nobody",
			reasonCode: "pr_merged",
			stage: "delivered",
			deliverable: { kind: "draft_pr", url: PR, outcome: "merged" },
		},
	],
	[
		"a draft PR closed without merging",
		{
			task: card({ status: "completed", approvedRevision: 2 }),
			lastRun: run(
				{
					phase: "ready",
					pullRequestUrl: PR,
					pullRequestOutcome: {
						state: "closed",
						headChanged: false,
						at: "2026-11-11T00:00:00.000Z",
					},
				},
				{ status: "completed" },
			),
		},
		{ kind: "delivered", waitingOn: "nobody", reasonCode: "pr_closed" },
	],
	[
		"PR follow-up the person paused",
		{
			task: card({
				status: "completed",
				approvedRevision: 2,
				factory: { ...handsOff, watchPullRequest: true },
			}),
			lastRun: run(
				{
					phase: "ready",
					pullRequestUrl: PR,
					pullRequestWatch: {
						headCommit: "abc",
						paused: true,
						handledFeedbackIds: [],
					},
				},
				{ status: "completed" },
			),
		},
		{
			kind: "delivered",
			waitingOn: "person",
			reasonCode: "followup_paused",
			stage: "delivered",
		},
	],
	[
		"a delivery the person flagged stays delivered, with a quiet note",
		{
			task: card({ status: "completed", approvedRevision: 2 }),
			lastRun: run(
				{
					phase: "ready",
					humanApproval: {
						commit: "abc",
						approvedAt: "2026-11-11T00:00:00.000Z",
					},
					audit: {
						selectedAt: "2026-11-11T00:00:00.000Z",
						finding: "Wrong copy",
						reviewedAt: "2026-11-11T00:00:00.000Z",
					},
				},
				{ status: "completed" },
			),
		},
		{
			kind: "delivered",
			waitingOn: "nobody",
			reasonCode: "none",
			stage: "delivered",
			flagged: true,
		},
	],
	[
		"an older run that recorded the note as a stop reads as delivered",
		{
			task: card({ status: "completed", approvedRevision: 2 }),
			lastRun: run(
				{
					phase: "blocked",
					error: "Human sample finding: Wrong copy",
					pullRequestUrl: PR,
					audit: {
						selectedAt: "2026-11-11T00:00:00.000Z",
						finding: "Wrong copy",
						reviewedAt: "2026-11-11T00:00:00.000Z",
					},
				},
				{ status: "completed" },
			),
		},
		{
			kind: "delivered",
			waitingOn: "nobody",
			stage: "delivered",
			flagged: true,
		},
	],
	[
		"a guidance rule proposed from feedback",
		{
			task: card({ status: "completed", approvedRevision: 2 }),
			lastRun: run(
				{
					phase: "ready",
					audit: {
						selectedAt: "2026-11-11T00:00:00.000Z",
						finding: "Wrong copy",
						analysis: {
							status: "proposed",
							trigger: "feedback",
							startedAt: "2026-11-11T00:00:00.000Z",
						},
					},
				},
				{ status: "completed" },
			),
		},
		{
			kind: "delivered",
			waitingOn: "person",
			reasonCode: "rule_proposed",
			stage: "delivered",
		},
	],
	[
		"a proposed rule does not hide a PR follow-up that stopped",
		{
			task: card({ status: "completed", approvedRevision: 2 }),
			lastRun: run(
				{
					phase: "blocked",
					pullRequestUrl: PR,
					error: "CI log unavailable",
					audit: {
						selectedAt: "2026-11-11T00:00:00.000Z",
						finding: "Wrong copy",
						analysis: {
							status: "proposed",
							trigger: "feedback",
							startedAt: "2026-11-11T00:00:00.000Z",
						},
					},
				},
				{ status: "completed" },
			),
		},
		{ kind: "stopped", waitingOn: "person" },
	],
	[
		"a proposal left without a note is not the person's decision",
		{
			task: card({ status: "completed", approvedRevision: 2 }),
			lastRun: run(
				{
					phase: "ready",
					audit: {
						selectedAt: "2026-11-11T00:00:00.000Z",
						finding: "",
						analysis: {
							status: "proposed",
							trigger: "feedback",
							startedAt: "2026-11-11T00:00:00.000Z",
						},
					},
				},
				{ status: "completed" },
			),
		},
		{ kind: "delivered", waitingOn: "nobody" },
	],
	[
		"a noted delivery whose follow-up later stopped without an error message is stopped",
		{
			task: card({ status: "completed", approvedRevision: 2 }),
			lastRun: run(
				{
					phase: "blocked",
					pullRequestUrl: PR,
					audit: {
						selectedAt: "2026-11-11T00:00:00.000Z",
						finding: "Wrong copy",
					},
				},
				{ status: "completed" },
			),
		},
		{ kind: "stopped", waitingOn: "person" },
	],
	[
		"an unrated delivery is not the person's decision",
		{
			task: card({
				status: "completed",
				approvedRevision: 2,
				factory: handsOff,
			}),
			lastRun: run(
				{
					phase: "ready",
					reviewSelection: localSelection,
					audit: { selectedAt: "2026-11-11T00:00:00.000Z" },
				},
				{ status: "completed" },
			),
		},
		{ kind: "delivered", waitingOn: "nobody", reasonCode: "none" },
	],
	[
		"PR follow-up that stopped after delivery",
		{
			task: card({ status: "completed", approvedRevision: 2 }),
			lastRun: run(
				{ phase: "blocked", pullRequestUrl: PR, error: "CI log unavailable" },
				{ status: "completed" },
			),
		},
		{ kind: "stopped", waitingOn: "person", reasonCode: "unknown" },
	],
	[
		"a person's retry of a stopped card while it waits",
		{
			task: card({
				status: "approved",
				approvedRevision: 2,
				factoryQueued: "run",
				factory: handsOff,
			}),
			lastRun: run(
				{
					phase: "blocked",
					autoRecovery: {
						attempts: 1,
						reason: "socket hang up",
						at: "2026-11-11T00:00:00.000Z",
					},
				},
				{ status: "failed", createdAt: "2026-11-11T00:05:00.000Z" },
			),
		},
		{
			kind: "queued",
			waitingOn: "slot",
			reasonCode: "none",
			stage: "waiting",
		},
	],
	[
		"a repository stage running after the checks",
		{
			task: card({ status: "in_progress", approvedRevision: 2 }),
			lastRun: run({
				phase: "verifying",
				candidate: {
					commit: "abc",
					checks: [],
					reviews: [],
					stages: [
						{
							id: "lint",
							name: "Lint",
							kind: "command",
							hash: "h",
							status: "running",
							blocking: true,
						},
					],
				},
			}),
		},
		{
			kind: "running",
			waitingOn: "nobody",
			stage: "build",
			checks: true,
			activeStage: "Lint",
		},
	],
	// archived
	[
		"an archived card keeps its steps and waits on nobody",
		{
			task: card({
				status: "failed",
				archivedAt: "2026-11-11T00:00:00.000Z",
				error: "Builder failed",
			}),
			lastRun: run({}, { status: "failed" }),
		},
		{
			kind: "archived",
			waitingOn: "nobody",
			reasonCode: "archived",
			stage: "build",
		},
	],
	[
		"an archived queued card",
		{
			task: card({
				archivedAt: "2026-11-11T00:00:00.000Z",
				factory: { approval: "required", hold: true },
			}),
		},
		{
			kind: "archived",
			waitingOn: "nobody",
			reasonCode: "archived",
			stage: "waiting",
		},
	],
	// split into parts
	[
		"a breakdown waits for a person even under automatic approval",
		{
			task: card({
				factory: handsOff,
				factoryDesignProgress: design("complete", {
					split: { parts: [{}, {}, {}] },
				}),
			}),
			planApprovable: false,
		},
		{
			kind: "awaiting_approval",
			waitingOn: "person",
			reasonCode: "split_approval",
			reasonText: "Split into 3 parts",
			stage: "scope",
		},
	],
	[
		"a parent with an open part tracks it and waits on nobody",
		{
			task: card({ status: "completed", factorySplit: SPLIT }),
			parts: { ...NO_PARTS, total: 2, delivered: 1, open: 1 },
		},
		{
			kind: "tracking",
			waitingOn: "nobody",
			reasonCode: "tracking",
			stage: "build",
			parts: { ...NO_PARTS, total: 2, delivered: 1, open: 1 },
		},
	],
	[
		"a parent without its parts' progress still only tracks",
		{ task: card({ status: "completed", factorySplit: SPLIT }) },
		{ kind: "tracking", waitingOn: "nobody", reasonCode: "tracking" },
	],
	[
		"a parent whose parts all settled is delivered, with no deliverable of its own",
		{
			task: card({ status: "completed", factorySplit: SPLIT }),
			parts: { ...NO_PARTS, total: 2, delivered: 1, closed: 1 },
		},
		{
			kind: "delivered",
			waitingOn: "nobody",
			reasonCode: "parts_delivered",
			stage: "delivered",
		},
	],
	[
		"a parent whose parts were all closed before delivery is closed, not delivered",
		{
			task: card({ status: "completed", factorySplit: SPLIT }),
			parts: { ...NO_PARTS, total: 3, closed: 3 },
		},
		{
			kind: "closed",
			waitingOn: "nobody",
			reasonCode: "parts_closed",
			reasonText: "0 of 3 delivered, 3 closed",
		},
	],
	[
		"a parent whose parts are still being created tracks, even when none is listed yet",
		{
			task: card({
				status: "completed",
				factorySplit: { ...SPLIT, createdAt: undefined },
			}),
			parts: { ...NO_PARTS, total: 2, delivered: 1, closed: 1 },
		},
		{ kind: "tracking", waitingOn: "nobody", reasonCode: "tracking" },
	],
	[
		"a part waiting for an earlier part's merge holds no slot",
		{
			task: card({ factory: handsOff, factoryQueued: "design" }),
			live: { slotsFull: true },
			dependency: { state: "waiting", on: ["F41"] },
		},
		{
			kind: "queued",
			waitingOn: "card",
			reasonCode: "waiting_on_card",
			reasonText: "Waiting for F41 to merge",
			waitingFor: ["F41"],
			stage: "waiting",
		},
	],
	[
		"a part whose earlier part will never merge needs the person",
		{
			task: card({ factory: handsOff, factoryQueued: "design" }),
			dependency: {
				state: "unavailable",
				on: ["F41"],
				reason: "F41 was closed without merging",
			},
		},
		{
			kind: "queued",
			waitingOn: "person",
			reasonCode: "dependency_unavailable",
			reasonText: "F41 was closed without merging. Start anyway or cancel.",
			stage: "waiting",
		},
	],
];

describe("factoryCardState", () => {
	it.each(CASES)("%s", (_label, input, expected) => {
		const state = factoryCardState(input);
		expect(state).toMatchObject(expected);
		if (!("reasonText" in expected) && expected.reasonCode === "none")
			expect(state.reasonText).toBeUndefined();
		if (!("checks" in expected)) expect(state.checks).toBeUndefined();
		// Same input, same answer.
		expect(factoryCardState(input)).toEqual(state);
	});

	it.each(
		FACTORY_PR_REVIEW_CARD_FIXTURES.map((fixture) => [fixture.name, fixture]),
	)("a pull request review: %s", (_name, fixture) => {
		const state = factoryCardState({
			task: fixture.task,
			lastRun: fixture.run,
			live: { runLive: fixture.working },
		});
		expect(state).toMatchObject(fixture.card);
		expect(state.skipped).toEqual(["scope", "build", "verify"]);
		expect(state.deliverable).toEqual({
			kind: "review",
			url: "https://github.com/acme/widgets/pull/15",
			...(fixture.card.reasonCode === "review_posted"
				? { outcome: "posted" }
				: {}),
		});
	});

	it("covers every kind and every reason code", () => {
		const states = [
			...CASES.map(([, input]) => factoryCardState(input)),
			...FACTORY_PR_REVIEW_CARD_FIXTURES.map((fixture) =>
				factoryCardState({ task: fixture.task, lastRun: fixture.run }),
			),
		];
		expect(new Set(states.map((state) => state.kind))).toEqual(
			new Set(FACTORY_CARD_KINDS),
		);
		const codes = new Set(states.map((state) => state.reasonCode));
		// `none` is the parser's blank answer; `unknown` covers the rest.
		expect(new Set([...codes, "none"])).toEqual(
			new Set(FACTORY_CARD_REASON_CODES),
		);
	});

	it("ignores run state from an earlier revision", () => {
		const state = factoryCardState({
			task: card({
				status: "approved",
				approvedRevision: 2,
				factoryQueued: "run",
			}),
			lastRun: run(
				{ phase: "blocked", pullRequestUrl: PR },
				{ status: "failed", taskRevision: 1 },
			),
		});
		expect(state).toMatchObject({ kind: "queued", reasonCode: "none" });
		expect(state.deliverable).toBeUndefined();
		expect(state.stage).toBe("waiting");
	});

	it("bounds the reason to one repository-relative line without long tokens", () => {
		const token = `ghp_${"a".repeat(40)}`;
		const state = factoryCardState(
			failed(
				`\n  Checks failed in ${WORKTREE}/src/a.ts using ${token} ${"x".repeat(400)}\n    at run (/repo/a.ts:1)\n${"log ".repeat(2000)}`,
			),
		);
		expect(state.reasonText).toMatch(/^Checks failed in src\/a\.ts using …/);
		expect(state.reasonText?.length).toBeLessThanOrEqual(200);
		expect(state.reasonText).not.toContain("\n");
		expect(state.reasonText).not.toContain(token);
		expect(
			factoryCardState(failed("Broke /repo/src/b.ts while testing")).reasonText,
		).toBe("Broke src/b.ts while testing");
	});

	it("accepts persisted records as they are", () => {
		expectTypeOf<AgendaTaskRecord>().toMatchTypeOf<FactoryCardTaskFacts>();
		expectTypeOf<AgendaTaskRunRecord>().toMatchTypeOf<FactoryCardRunFacts>();
	});

	it("is exported from the browser entry", () => {
		expect(browser.factoryCardState).toBe(factoryCardState);
		expect(browser.factoryErrorReasonCode).toBe(factoryErrorReasonCode);
	});
});

describe("factoryErrorReasonCode", () => {
	it.each<[string | undefined, FactoryCardReasonCode]>([
		[undefined, "none"],
		["  ", "none"],
		[
			`${FACTORY_AUTO_APPROVAL_WAITING_PREFIX}Plan repair limit (2) reached.`,
			"plan_held",
		],
		[`${FACTORY_PLAN_FAULT_PREFIX}x`, "plan_fault"],
		[`${FACTORY_PLAN_FAULT_STOPPED_PREFIX}x`, "plan_fault_unfixable"],
		[`${FACTORY_PUBLISH_FAILURE_PREFIX}Sign in to gh.`, "publish_failed"],
		["Could not confirm the draft PR.", "publish_failed"],
		[factorySpendingLimitReason(3), "spend_limit"],
		[factoryDailySpendingLimitReason(50), "daily_spend_limit"],
		[
			"Repair limit (2) reached resolving implementation integration",
			"repair_limit",
		],
		["Verification profile failed (healthcheck): 503", "profile_failed"],
		[
			"Required verification remains unavailable after 1 retries: x",
			"verification_unavailable",
		],
		["Design did not start: Feature design is unavailable", "scoping_failed"],
		[
			"Design was not saved: the feature revision changed during design.",
			"scoping_failed",
		],
		["Hub task manager stopped before the run completed.", "interrupted"],
		["Hub restarted while this task was running.", "interrupted"],
		[
			"Factory restarted this run 2 times after the Hub stopped mid-run, so it stops here.",
			"interrupted",
		],
		["Plan repair limit (2) reached.", "unknown"],
		["Builder failed", "unknown"],
	])("%j is %s", (error, code) => {
		expect(factoryErrorReasonCode(error)).toBe(code);
	});
});
