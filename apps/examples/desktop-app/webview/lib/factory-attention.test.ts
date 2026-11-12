import type { AgendaTaskRecord } from "@cline/shared";
import {
	factoryDesignProgressSchema,
	factoryRunStateSchema,
	factoryTaskConfigSchema,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	factoryActivity,
	factoryNeedsYou,
} from "@/components/views/factory/factory-ui";
import type { FactoryAttention } from "@/hooks/use-factory-attention";
import {
	factoryAttentionReasons,
	factoryAutoApprovalBlocker,
	factoryAutoApprovalWaiting,
	factoryAutoRetrying,
	factoryAutoRetryLabel,
	factoryOpenFindings,
	factoryOutcomeDetails,
	factoryPlanFault,
	factoryPlanFaultStopped,
	factoryPublishFailureReason,
	factoryRetryPath,
	factoryReviewRequired,
	factoryScopingWait,
	factoryStation,
	factoryUnreadable,
	isFactoryRuleCard,
} from "./factory-attention";

const handsOff = factoryTaskConfigSchema.parse({
	autonomy: "hands_off",
	approval: "automatic",
	publishPullRequest: true,
});
const state = (overrides: Record<string, unknown> = {}) =>
	factoryRunStateSchema.parse({
		phase: "implementing",
		repairRound: 0,
		workspace: {
			path: "/repo",
			branch: "feat/example",
			baseBranch: "main",
			baseCommit: "a".repeat(40),
		},
		sessions: [],
		...overrides,
	});
const recovery = {
	attempts: 1,
	reason: "Provider unavailable",
	at: "2026-01-01T00:05:00Z",
};
const task = (overrides: Record<string, unknown> = {}) => ({
	taskId: "task-1",
	instructions: "Search notes by title.",
	status: "failed",
	revision: 2,
	factory: handsOff,
	updatedAt: "2026-01-01T00:04:00Z",
	error: "Provider unavailable",
	...overrides,
});

describe("hands-off auto retry", () => {
	it("keeps a failed card out of Needs you while its one retry is queued or running", () => {
		const retrying = state({ phase: "blocked", autoRecovery: recovery });
		expect(factoryAutoRetrying(task(), retrying)).toBe(true);
		expect(factoryAttentionReasons(task(), retrying)).toEqual([]);
		expect(factoryAutoRetrying(task({ status: "in_progress" }), retrying)).toBe(
			true,
		);
		expect(factoryAutoRetryLabel(recovery)).toBe(
			"Retrying after failure (1/1)",
		);
	});

	it("counts only the immediate retry run, not a later manual Try again", () => {
		const inherited = state({ phase: "implementing", autoRecovery: recovery });
		const scheduled = Date.parse(recovery.at);
		const at = (minutes: number) =>
			new Date(scheduled + minutes * 60_000).toISOString();
		const failed = {
			runId: "run-1",
			taskRevision: 2,
			createdAt: at(-5),
			status: "failed",
		};
		const retry = {
			runId: "run-2",
			taskRevision: 2,
			createdAt: at(1),
			status: "running",
		};
		// Queued: the retry run does not exist yet.
		expect(
			factoryAutoRetrying(
				task({ status: "approved", lastRunId: "run-1" }),
				inherited,
				[failed],
			),
		).toBe(true);
		// Running: the first run after the retry was scheduled.
		expect(
			factoryAutoRetrying(
				task({ status: "in_progress", currentRunId: "run-2" }),
				inherited,
				[retry, failed],
			),
		).toBe(true);
		// The retry failed and the user tried again: queued, then running.
		const retryFailed = { ...retry, status: "failed" };
		const manual = {
			runId: "run-3",
			taskRevision: 2,
			createdAt: at(30),
			status: "running",
		};
		expect(
			factoryAutoRetrying(
				task({ status: "approved", lastRunId: "run-2" }),
				inherited,
				[retryFailed, failed],
			),
		).toBe(false);
		const manualTask = task({ status: "in_progress", currentRunId: "run-3" });
		expect(
			factoryAutoRetrying(manualTask, inherited, [manual, retryFailed, failed]),
		).toBe(false);
		expect(
			factoryAttentionReasons({ ...manualTask, status: "failed" }, inherited, [
				manual,
				retryFailed,
				failed,
			]),
		).toEqual([{ kind: "stopped" }]);
	});

	it("reports the failure once the retry itself fails or no retry was taken", () => {
		const retried = state({ phase: "blocked", autoRecovery: recovery });
		const failedAgain = task({ updatedAt: "2026-01-01T00:20:00Z" });
		expect(factoryAutoRetrying(failedAgain, retried)).toBe(false);
		expect(factoryAttentionReasons(failedAgain, retried)).toEqual([
			{ kind: "stopped" },
		]);
		expect(
			factoryAttentionReasons(task(), state({ phase: "blocked" })),
		).toEqual([{ kind: "stopped" }]);
		// Without a failure time the retry cannot be confirmed, so the user sees it.
		expect(factoryAutoRetrying(task({ updatedAt: undefined }), retried)).toBe(
			false,
		);
	});

	it("reads retry and PR details from an attention outcome", () => {
		expect(
			factoryOutcomeDetails({
				phase: "ready",
				pullRequestUrl: "https://github.com/o/r/pull/1",
				autoRecovery: recovery,
				autoRetrying: true,
			}),
		).toEqual({
			pullRequestUrl: "https://github.com/o/r/pull/1",
			autoRecovery: recovery,
			autoRetrying: true,
		});
		expect(factoryOutcomeDetails({ autoRecovery: { attempts: "1" } })).toEqual(
			{},
		);
		expect(factoryOutcomeDetails(undefined)).toEqual({});
	});
});

describe("plan and ready attention", () => {
	const settled = (overrides: Record<string, unknown> = {}) =>
		factoryDesignProgressSchema.parse({
			revision: 2,
			repairRound: 0,
			agents: {},
			designerSessionId: "designer",
			findings: [],
			phase: "complete",
			reviewerSessions: [],
			reviews: [],
			...overrides,
		});

	it("asks for the plan with its blocker when automatic approval was refused", () => {
		const blocked = task({
			status: "pending_approval",
			error: undefined,
			factoryDesignProgress: settled(),
		});
		const blocker = factoryAutoApprovalBlocker(blocked);
		expect(blocker).toEqual(expect.any(String));
		expect(factoryAttentionReasons(blocked, undefined)).toEqual([
			{ kind: "plan", blocker },
		]);
	});

	it("treats core's recorded automatic-approval wait as a plan to approve, not a failure", () => {
		const waiting = task({
			status: "pending_approval",
			error:
				"Automatic approval is waiting: Implementer model test-provider/gone is not available",
			factoryDesignProgress: settled(),
		});
		expect(factoryAutoApprovalWaiting(waiting)).toBe(
			"Implementer model test-provider/gone is not available",
		);
		expect(factoryAutoApprovalBlocker(waiting)).toBe(
			"Implementer model test-provider/gone is not available",
		);
		expect(factoryAttentionReasons(waiting, undefined)).toEqual([
			{
				kind: "plan",
				blocker: "Implementer model test-provider/gone is not available",
			},
		]);
		// Any other error on a waiting plan is still a stop.
		expect(
			factoryAttentionReasons(
				{ ...waiting, error: "Plan review failed" },
				undefined,
			),
		).toEqual(expect.arrayContaining([{ kind: "stopped" }]));
	});

	it("offers a plan for approval only after its pending question is answered", () => {
		const question = {
			questionId: "q1",
			status: "pending",
			revision: 2,
		};
		const asking = task({
			status: "pending_approval",
			error: undefined,
			factory: factoryTaskConfigSchema.parse({
				checks: [{ name: "API", command: "bun test", kind: "api" }],
				acceptanceCriteria: [{ id: "titles", text: "Titles", check: "API" }],
			}),
			factoryQuestions: [question],
		});
		expect(factoryAttentionReasons(asking, undefined)).toEqual([
			{ kind: "question", question },
		]);
		expect(
			factoryAttentionReasons(
				{ ...asking, factoryQuestions: [{ ...question, status: "answered" }] },
				undefined,
			),
		).toEqual([{ kind: "plan" }]);
	});

	it("stays quiet while an automatic plan is still being scoped or reviewed", () => {
		for (const progress of [
			undefined,
			settled({ phase: "reviewing" }),
			settled({ revision: 1 }),
		]) {
			const scoping = task({
				status: "pending_approval",
				error: undefined,
				factoryDesignProgress: progress,
			});
			expect(factoryAutoApprovalBlocker(scoping)).toBeNull();
			expect(factoryAttentionReasons(scoping, undefined)).toEqual([]);
		}
	});

	it("names the published draft PR on a result ready for review", () => {
		const ready = state({
			phase: "ready",
			pullRequestUrl: "https://github.com/o/r/pull/1",
			candidate: {
				commit: "b".repeat(40),
				checks: [],
				reviews: [],
			},
		});
		expect(
			factoryAttentionReasons(
				task({ status: "completed", error: undefined }),
				ready,
			),
		).toEqual([
			{
				kind: "ready",
				commit: "b".repeat(40),
				pullRequestUrl: "https://github.com/o/r/pull/1",
			},
		]);
	});
});

describe("scoping wait", () => {
	const card = (overrides: Record<string, unknown> = {}) =>
		task({
			status: "pending_approval",
			error: undefined,
			...overrides,
		}) as never;
	const designing = factoryDesignProgressSchema.parse({
		revision: 2,
		repairRound: 0,
		agents: {},
		designerSessionId: "designer",
		findings: [],
		phase: "designing",
	});

	it("treats a card as queued only when the Hub reports it in the design queue", () => {
		// Never scoped, unheld and unqueued: nothing will start it.
		expect(factoryScopingWait(card())).toBeUndefined();
		expect(factoryScopingWait(card({ factoryQueued: "design" }))).toBe(
			"queued",
		);
	});

	it("reports holds and leaves live, failed or run-queued cards alone", () => {
		expect(
			factoryScopingWait(card({ factory: { ...handsOff, hold: true } })),
		).toBe("held");
		expect(
			factoryScopingWait(card({ factoryDesignProgress: designing })),
		).toBeUndefined();
		expect(
			factoryScopingWait(card({ error: "Designer failed" })),
		).toBeUndefined();
		expect(factoryScopingWait(card({ factoryQueued: "run" }))).toBeUndefined();
		expect(factoryScopingWait(card({ status: "approved" }))).toBeUndefined();
	});
});

describe("review by risk", () => {
	const delivered = (overrides: Record<string, unknown> = {}) =>
		state({
			phase: "ready",
			pullRequestUrl: "https://github.com/o/r/pull/1",
			candidate: { commit: "b".repeat(40), checks: [], reviews: [] },
			...overrides,
		});
	const completed = (factory: unknown = handsOff) =>
		task({ status: "completed", error: undefined, factory });
	const manual = factoryTaskConfigSchema.parse({});

	it("carries a required review on the ready reason", () => {
		const required = { required: true, reason: "shared contract" };
		expect(
			factoryAttentionReasons(
				completed(),
				delivered({ humanReview: required }),
			),
		).toEqual([
			{
				kind: "ready",
				commit: "b".repeat(40),
				pullRequestUrl: "https://github.com/o/r/pull/1",
				humanReview: required,
			},
		]);
		expect(
			factoryReviewRequired(completed(), delivered({ humanReview: required })),
		).toBe(true);
	});

	it("keeps a sampled result ready without asking for review", () => {
		const sampled = { required: false, reason: "local change" };
		const [reason] = factoryAttentionReasons(
			completed(manual),
			delivered({ humanReview: sampled }),
		);
		expect(reason).toMatchObject({ kind: "ready", humanReview: sampled });
		// Core's decision wins over the old manual-work rule.
		expect(
			factoryReviewRequired(
				completed(manual),
				delivered({ humanReview: sampled }),
			),
		).toBe(false);
	});

	it("keeps today's rule for runs from before core decided", () => {
		const [reason] = factoryAttentionReasons(completed(), delivered());
		expect(reason).not.toHaveProperty("humanReview");
		expect(factoryReviewRequired(completed(), delivered())).toBe(false);
		expect(factoryReviewRequired(completed(manual), delivered())).toBe(true);
	});

	it("reports a draft PR left open with unresolved findings as ready for review, not stopped", () => {
		const url = "https://github.com/o/r/pull/15672";
		const stopped = (overrides: Record<string, unknown> = {}) =>
			state({
				phase: "blocked",
				repairRound: 2,
				pullRequestUrl: url,
				unresolvedFindings: {
					commit: "c",
					findings: [
						"Reviewer 1: gate in /d/factory-worktrees/31/repo/apps/a.ts",
						"Reviewer 1: churn",
					],
					pullRequestOpen: true,
				},
				humanReview: { required: true, reason: "review findings unresolved" },
				...overrides,
			});
		const failed = task({ status: "failed", factory: handsOff });
		expect(factoryOpenFindings(failed, stopped())).toEqual({
			pullRequestUrl: url,
			findings: ["Reviewer 1: gate in apps/a.ts", "Reviewer 1: churn"],
		});
		expect(factoryAttentionReasons(failed, stopped())).toEqual([
			{
				kind: "ready",
				commit: "c",
				pullRequestUrl: url,
				humanReview: { required: true, reason: "review findings unresolved" },
				unresolvedFindings: 2,
			},
		]);
		// Marked reviewed: nothing waits on the user.
		expect(
			factoryAttentionReasons(
				failed,
				stopped({ humanApproval: { commit: "c", approvedAt: "2026-01-01" } }),
			),
		).toEqual([]);
		// Without the open PR, or once retried, it is not this state.
		const closed = stopped({
			unresolvedFindings: { commit: "c", findings: ["x"] },
		});
		expect(factoryOpenFindings(failed, closed)).toBeUndefined();
		expect(factoryAttentionReasons(failed, closed)).toEqual([
			{ kind: "stopped" },
		]);
		expect(
			factoryOpenFindings(task({ status: "in_progress" }), stopped()),
		).toBeUndefined();
	});

	it("reads the review decision and dry-run summary from an attention outcome", () => {
		expect(
			factoryOutcomeDetails({
				humanReview: { required: true, reason: "cross cutting" },
				verificationProfile: {
					hash: "c".repeat(64),
					preflight: "failed",
					stage: "start",
				},
			}),
		).toEqual({
			humanReview: { required: true, reason: "cross cutting" },
			verificationProfile: {
				hash: "c".repeat(64),
				preflight: "failed",
				stage: "start",
			},
		});
		expect(
			factoryOutcomeDetails({
				humanReview: { required: "yes" },
				verificationProfile: { hash: "x", preflight: "maybe" },
			}),
		).toEqual({});
	});
});

describe("rule cards", () => {
	it("recognizes cards Factory filed for a recurring review pattern", () => {
		expect(
			isFactoryRuleCard({
				factory: { intake: { source: "factory:repo-rules" } },
			}),
		).toBe(true);
		expect(
			isFactoryRuleCard({ factory: { intake: { source: "desktop:chat" } } }),
		).toBe(false);
		expect(isFactoryRuleCard({})).toBe(false);
	});
});

describe("Try again and publish failures", () => {
	const failed = (overrides: Record<string, unknown> = {}) =>
		({
			status: "failed",
			revision: 2,
			approvedRevision: 2,
			workspaceRoot: "/repo",
			factory: {
				...handsOff,
				checks: [
					{ name: "API", command: "bun test", kind: "test", artifacts: [] },
				],
			},
			error: "Repair limit (2) reached.",
			...overrides,
		}) as never;
	const absolute = {
		...handsOff,
		checks: [
			{
				name: "API",
				command: "bun test",
				kind: "test",
				artifacts: ["/tmp/api.log"],
			},
		],
	};

	it("finds plan faults in check paths, blocked checks and core's error", () => {
		expect(factoryPlanFault(failed())).toBe(false);
		expect(factoryPlanFault(failed({ factory: absolute }))).toBe(true);
		expect(
			factoryPlanFault(
				failed({ error: "The plan's checks need fixing: Check API." }),
			),
		).toBe(true);
		expect(
			factoryPlanFault(failed(), {
				candidate: {
					checks: [{ status: "blocked", blockedBy: "configuration" }],
				},
			}),
		).toBe(true);
	});

	it("leaves a plan Factory already re-scoped to Edit plan", () => {
		const stopped = failed({
			factory: absolute,
			error: "The plan's checks still need fixing: Check API.",
		});
		expect(factoryPlanFaultStopped(stopped)).toBe(true);
		expect(factoryPlanFault(stopped)).toBe(false);
	});

	it("re-scopes a plan fault, queues an approved plan, approves an edited one", () => {
		expect(factoryRetryPath(failed({ factory: absolute }))).toBe("scope");
		expect(factoryRetryPath(failed())).toBe("queue");
		expect(
			factoryRetryPath(failed({ approvedRevision: 1 }), { approvable: true }),
		).toBe("approve");
		expect(factoryRetryPath(failed({ approvedRevision: 1 }))).toBe("scope");
	});

	it("reads the one-sentence reason from current and older publish errors", () => {
		expect(
			factoryPublishFailureReason(
				"Could not open the draft PR: The base branch is not on GitHub. Push it first.",
			),
		).toBe("The base branch is not on GitHub.");
		expect(
			factoryPublishFailureReason(
				"Could not confirm the draft PR: gh timed out.\nlog",
			),
		).toBe("gh timed out.");
		expect(factoryPublishFailureReason("Could not open the draft PR")).toBe("");
		expect(factoryPublishFailureReason("Checks failed.")).toBeUndefined();
	});
});

describe("factoryUnreadable", () => {
	it("reads the sidecar's reason for a card it could not read", () => {
		expect(
			factoryUnreadable({ taskId: "a", unreadable: { reason: "bad" } }),
		).toBe("bad");
		expect(factoryUnreadable({ taskId: "a", unreadable: {} })).toBe("");
		expect(factoryUnreadable({ taskId: "a" })).toBeUndefined();
		expect(factoryUnreadable(undefined)).toBeUndefined();
	});
});

describe("feedback is optional", () => {
	const done = {
		...task({ status: "completed", error: undefined }),
		title: "Search notes",
		revision: 1,
	} as unknown as AgendaTaskRecord;
	const attention = (
		audit?: NonNullable<FactoryAttention["outcome"]>["audit"],
	): FactoryAttention => ({
		taskId: done.taskId,
		revision: 1,
		questions: [],
		needsAttention: false,
		outcome: {
			phase: "watching",
			repairRound: 0,
			activeRoles: [],
			activeSessions: [],
			followupPaused: false,
			pullRequestUrl: "https://github.com/acme/app/pull/1",
			audit,
		} as FactoryAttention["outcome"],
	});

	it("treats an unrated delivery as delivered, never as needing the user", () => {
		for (const audit of [
			undefined,
			{ selectedAt: "2026-01-01", selectionReason: "delivered" as const },
			{ selectedAt: "2026-01-01", selectionReason: "random" as const },
		]) {
			const activity = factoryActivity(done, attention(audit));
			expect(activity.column).toBe("Done");
			expect(factoryNeedsYou(activity)).toBe(false);
			expect(activity.label).not.toMatch(/feedback|rating/i);
			expect(activity.action).not.toMatch(/feedback/i);
		}
	});

	it("names the user's rating when they gave one", () => {
		expect(
			factoryActivity(
				done,
				attention({ selectedAt: "2026-01-01", reviewedAt: "2026-01-02" }),
			).label,
		).toBe("Feedback: looks good");
	});
});

describe("factoryStation", () => {
	type StationTask = Parameters<typeof factoryStation>[0];
	const config = factoryTaskConfigSchema.parse({
		checks: [{ name: "API", command: "bun test", kind: "api", artifacts: [] }],
		agents: { verifier: {} },
	});
	const card = (overrides: Partial<StationTask> = {}): StationTask => ({
		status: "approved",
		revision: 2,
		approvedRevision: 2,
		updatedAt: "2026-03-04T10:00:00Z",
		workspaceRoot: "/repo",
		factory: config,
		...overrides,
	});
	const design = (phase: string, extra: Record<string, unknown> = {}) =>
		factoryDesignProgressSchema.parse({
			revision: 2,
			repairRound: 0,
			agents: {},
			designerSessionId: "designer",
			findings: [],
			phase,
			...(phase === "complete" ? { reviewerSessions: [], reviews: [] } : {}),
			...(phase === "reviewing" ? { reviewerSessions: [], reviews: [] } : {}),
			...extra,
		});
	const now = new Date("2026-03-04T18:00:00Z");
	const at = (
		task: StationTask,
		outcome?: Parameters<typeof factoryStation>[1],
	) => {
		// The plan's checks are part of Build; `checks` marks the card there.
		const { station, stopped, checks } = factoryStation(task, outcome, {
			now,
		});
		const place = checks ? `${station} checks` : station;
		return stopped ? `${place} (stopped)` : place;
	};

	it("places waiting and scoping cards", () => {
		expect(
			at(card({ status: "pending_approval", approvedRevision: undefined })),
		).toBe("waiting");
		expect(at(card())).toBe("waiting");
		expect(
			at(
				card({
					status: "pending_approval",
					factoryDesignProgress: design("designing"),
				}),
			),
		).toBe("scope");
		expect(
			at(
				card({
					status: "pending_approval",
					factoryDesignProgress: design("reviewing"),
				}),
			),
		).toBe("scope");
		// A plan to approve and a no-build conclusion wait at Scope.
		expect(
			at(
				card({
					status: "pending_approval",
					factory: { ...config, approval: "required" },
					factoryDesignProgress: design("complete"),
				}),
			),
		).toBe("scope");
		expect(
			at(
				card({
					status: "pending_approval",
					approvedRevision: undefined,
					factoryDesignProgress: design("complete", {
						conclusion: {
							outcome: "already_fixed",
							rationale: "Done.",
							evidence: ["src/export.ts:10"],
						},
					}),
				}),
			),
		).toBe("scope");
		expect(
			at(
				card({
					status: "pending_approval",
					approvedRevision: undefined,
					factoryDesignProgress: design("complete"),
					error: "Automatic approval is waiting: no reviewer",
				}),
			),
		).toBe("scope");
	});

	it("places running cards by phase and by the agents running", () => {
		const running = card({ status: "in_progress" });
		expect(at(running)).toBe("build");
		expect(at(running, { phase: "implementing" })).toBe("build");
		expect(at(running, { phase: "repairing" })).toBe("build");
		expect(at(running, { phase: "verifying" })).toBe("build checks");
		expect(
			at(running, {
				phase: "verifying",
				activeSessions: [{ role: "verifier" }, { role: "reviewer" }],
			}),
		).toBe("verify");
		expect(at(running, { phase: "verifying", activeRoles: ["verifier"] })).toBe(
			"verify",
		);
		// A repository stage is a sub-step of Build, named for the line.
		expect(
			factoryStation(running, { phase: "verifying", activeStage: "Lint" }),
		).toMatchObject({ station: "build", checks: true, stage: "Lint" });
		expect(at(running, { phase: "reviewing" })).toBe("review");
		expect(at(running, { phase: "publishing" })).toBe("review");
		// A hands-off retry is building again, not stopped.
		expect(
			at(card({ status: "failed", error: "Provider unavailable" }), {
				phase: "blocked",
				autoRecovery: recovery,
				autoRetrying: true,
			}),
		).toBe("build");
	});

	it("places deliveries, today and earlier", () => {
		const done = card({ status: "completed" });
		expect(factoryStation(done, { phase: "ready" }, { now })).toEqual({
			station: "delivered",
			stopped: false,
			skipped: [],
			deliveredToday: true,
		});
		expect(
			factoryStation(
				{ ...done, updatedAt: "2026-03-03T10:00:00Z" },
				{ phase: "ready" },
				{ now },
			).deliveredToday,
		).toBe(false);
		expect(at(done, { phase: "watching" })).toBe("delivered");
		expect(
			at(done, {
				phase: "ready",
				humanApproval: { commit: "c", approvedAt: "2026-03-04T11:00:00Z" },
			}),
		).toBe("delivered");
		expect(at(done)).toBe("delivered");
		// The user flagged it, recorded as a stop by an older Hub: still the
		// delivery, not a stop.
		expect(
			at(done, {
				phase: "blocked",
				error: "Human sample finding: Wrong copy",
				audit: { selectedAt: "2026-03-04T11:00:00Z", finding: "Wrong copy" },
			}),
		).toBe("delivered");
		// A draft PR left open with findings is the delivery.
		expect(
			at(card({ status: "failed" }), {
				phase: "blocked",
				pullRequestUrl: "https://github.com/o/r/pull/1",
				unresolvedFindings: {
					commit: "c",
					findings: ["a"],
					pullRequestOpen: true,
				},
			}),
		).toBe("delivered");
	});

	it("places a stopped card at the station where it stopped", () => {
		const failed = card({ status: "failed", error: "Builder crashed." });
		expect(at(failed, { phase: "implementing" })).toBe("build (stopped)");
		expect(at(failed, { phase: "verifying" })).toBe("build checks (stopped)");
		expect(at(failed, { phase: "reviewing" })).toBe("review (stopped)");
		expect(at(failed)).toBe("build (stopped)");
		expect(at({ ...failed, approvedRevision: undefined })).toBe(
			"scope (stopped)",
		);
		// The engine records `blocked` without the phase it left.
		expect(at(failed, { phase: "blocked" })).toBe("build (stopped)");
		expect(
			at(
				{
					...failed,
					error:
						"Required verification remains unavailable after 1 retries: app.",
				},
				{ phase: "blocked" },
			),
		).toBe("verify (stopped)");
		expect(
			at(
				{ ...failed, error: "Could not open the draft PR: push rejected." },
				{ phase: "blocked" },
			),
		).toBe("review (stopped)");
		expect(
			at(card({ status: "completed" }), {
				phase: "blocked",
				pullRequestError: "push rejected",
			}),
		).toBe("review (stopped)");
		expect(
			at(failed, {
				phase: "blocked",
				unresolvedFindings: { commit: "c", findings: ["a"] },
			}),
		).toBe("review (stopped)");
		// A plan fault stops at the plan's checks, in Build.
		expect(
			at({
				...failed,
				error: "Plan fault: the check cannot run here.",
				factory: {
					...config,
					checks: [
						{
							name: "API",
							command: "bun test",
							kind: "api",
							artifacts: ["/tmp/out.log"],
						},
					],
				},
			}),
		).toBe("build checks (stopped)");
		// A blocker after delivery stops too.
		expect(at(card({ status: "completed" }), { phase: "blocked" })).toBe(
			"build (stopped)",
		);
	});

	it("skips the stations a settled plan leaves out", () => {
		const bare = factoryTaskConfigSchema.parse({});
		// Checks are part of Build: only Verify, without a tester, is skipped.
		const skipped = (task: StationTask) =>
			factoryStation(task, undefined).skipped;
		expect(skipped(card({ factory: bare }))).toEqual(["verify"]);
		expect(skipped(card())).toEqual([]);
		// Nothing is skipped before scoping settles the plan.
		expect(
			skipped(
				card({
					factory: bare,
					status: "pending_approval",
					approvedRevision: undefined,
				}),
			),
		).toEqual([]);
		// With no checks, a verifying run is at Verify, or Review without a tester.
		expect(
			at(card({ status: "in_progress", factory: { ...config, checks: [] } }), {
				phase: "verifying",
			}),
		).toBe("verify");
		expect(
			at(card({ status: "in_progress", factory: bare }), {
				phase: "verifying",
			}),
		).toBe("review");
	});
});
