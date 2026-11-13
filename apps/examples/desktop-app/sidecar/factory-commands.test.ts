import { factoryRunStateSchema, factoryTaskConfigSchema } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	forgetFactoryRuns,
	handleFactoryCommand,
	handleFactoryLimitsCommand,
	handleFactorySettingsCommand,
	handleFactoryStagesCommand,
	oncePerConnection,
} from "./factory-commands";
import { readFactoryDiff } from "./factory-review";
import type { SidecarContext } from "./types";

vi.mock("./factory-review", () => ({ readFactoryDiff: vi.fn() }));

const ctx: Pick<SidecarContext, "pendingQuestions"> = {
	pendingQuestions: new Map(),
};
const factory = factoryTaskConfigSchema.parse({});
const checked = factoryTaskConfigSchema.parse({
	checks: [{ name: "API", command: "bun test", kind: "api" }],
});
const ready = factoryRunStateSchema.parse({
	phase: "ready",
	repairRound: 0,
	checks: [],
	workspace: {
		path: "/repo",
		branch: "feat/example",
		baseBranch: "main",
		baseCommit: "a".repeat(40),
	},
	sessions: [{ role: "builder", sessionId: "builder" }],
});

beforeEach(() => {
	vi.clearAllMocks();
	ctx.pendingQuestions.clear();
	forgetFactoryRuns();
});

describe("Factory commands", () => {
	it("collects questions from the feature's current sessions and distinguishes current review from stale or watching runs", async () => {
		const questions = ["designer", "builder", "unrelated"].map((sessionId) => ({
			requestId: `question-${sessionId}`,
			sessionId,
			createdAt: "2026-01-01T00:00:00Z",
			question: "Which option?",
			options: ["Default"],
		}));
		for (const item of questions)
			ctx.pendingQuestions.set(item.requestId, {
				item,
				resolve: vi.fn(),
				reject: vi.fn(),
			});
		const tasks = [
			{ taskId: "design", status: "approved", originSessionId: "designer" },
			{ taskId: "build", status: "in_progress", currentRunId: "run-build" },
			{ taskId: "ready", status: "completed", lastRunId: "run-ready" },
			{ taskId: "watching", status: "completed", lastRunId: "run-watching" },
			{ taskId: "stale", status: "completed", lastRunId: "run-stale" },
			{ taskId: "approval", status: "pending_approval" },
			{ taskId: "unscoped", status: "pending_approval" },
			{ taskId: "plan-ready", status: "pending_approval" },
			{ taskId: "automatic", status: "pending_approval" },
			{ taskId: "failed", status: "failed" },
			{
				taskId: "archived",
				status: "completed",
				lastRunId: "run-archived",
				archivedAt: "2026-01-01T00:00:00Z",
			},
		].map((task) => ({
			...task,
			instructions: "Search notes by title.",
			factory:
				task.taskId === "automatic"
					? { ...factory, approval: "automatic" }
					: // Checks alone no longer meet the approval gate; criteria do.
						task.taskId === "unscoped"
						? checked
						: task.taskId === "plan-ready"
							? factoryTaskConfigSchema.parse({
									...checked,
									acceptanceCriteria: [
										{ id: "titles", text: "Title search", check: "API" },
									],
								})
							: factory,
			revision: 2,
		}));
		const readTask = vi.fn<Parameters<typeof handleFactoryCommand>[3]>(
			async (command, args) => {
				if (command === "task.list")
					return {
						tasks: [
							...tasks,
							{
								taskId: "ordinary",
								status: "pending_approval",
								revision: 1,
								instructions: "Reminder",
							},
						],
					};
				return {
					runs: [
						{
							runId: `run-${args.taskId}`,
							taskRevision: args.taskId === "stale" ? 1 : 2,
							factory: {
								...ready,
								sessions: args.taskId === "build" ? ready.sessions : [],
								phase: args.taskId === "watching" ? "watching" : "ready",
							},
						},
					],
				};
			},
		);
		expect(
			await handleFactoryCommand(ctx, "factory_attention", undefined, readTask),
		).toEqual([
			{
				revision: 2,
				taskId: "design",
				questions: [questions[0]],
				needsAttention: true,
			},
			{
				revision: 2,
				taskId: "build",
				runId: "run-build",
				questions: [questions[1]],
				needsAttention: true,
				outcome: {
					phase: "ready",
					repairRound: 0,
					activeRoles: [],
					activeSessions: [],
					followupPaused: false,
				},
			},
			{
				revision: 2,
				taskId: "ready",
				runId: "run-ready",
				questions: [],
				needsAttention: true,
				outcome: {
					phase: "ready",
					repairRound: 0,
					activeRoles: [],
					activeSessions: [],
					followupPaused: false,
				},
			},
			{
				revision: 2,
				taskId: "watching",
				runId: "run-watching",
				questions: [],
				needsAttention: false,
				outcome: {
					phase: "watching",
					repairRound: 0,
					activeRoles: [],
					activeSessions: [],
					followupPaused: false,
				},
			},
			{ revision: 2, taskId: "stale", questions: [], needsAttention: false },
			{ revision: 2, taskId: "approval", questions: [], needsAttention: false },
			{ revision: 2, taskId: "unscoped", questions: [], needsAttention: false },
			{
				revision: 2,
				taskId: "plan-ready",
				questions: [],
				needsAttention: true,
			},
			{
				revision: 2,
				taskId: "automatic",
				questions: [],
				needsAttention: false,
			},
			{ revision: 2, taskId: "failed", questions: [], needsAttention: true },
		]);
		ctx.pendingQuestions.clear();
		readTask.mockClear();
		const withoutQuestions = await handleFactoryCommand(
			ctx,
			"factory_attention",
			undefined,
			readTask,
		);
		expect(withoutQuestions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					taskId: "build",
					outcome: expect.objectContaining({ phase: "ready" }),
				}),
			]),
		);
		expect(
			readTask.mock.calls
				.filter(([command]) => command === "task.get")
				.map(([, args]) => args.taskId),
		).toEqual(["build", "ready", "watching", "stale"]);
	});

	it("keeps post-approval stops in Needs you, but not a note on a delivery or paused approved results", async () => {
		const outcomes = Object.entries({
			// Recorded as a stop by an older Hub.
			finding: {
				...ready,
				phase: "blocked",
				error: "Human sample finding: Missed empty titles",
				audit: {
					selectedAt: "2026-01-01T00:00:00Z",
					finding: "Missed empty titles",
				},
			},
			"approved-stop": {
				...ready,
				phase: "blocked",
				humanApproval: { commit: "abc", approvedAt: "2026-01-01T00:00:00Z" },
			},
			"approved-paused": {
				...ready,
				humanApproval: { commit: "abc", approvedAt: "2026-01-01T00:00:00Z" },
				pullRequestWatch: {
					headCommit: "abc",
					paused: true,
					handledFeedbackIds: [],
				},
			},
			paused: {
				...ready,
				pullRequestWatch: {
					headCommit: "abc",
					paused: true,
					handledFeedbackIds: [],
				},
			},
		});
		const readTask = vi.fn<Parameters<typeof handleFactoryCommand>[3]>(
			async (command, args) =>
				command === "task.list"
					? {
							tasks: outcomes.map(([taskId]) => ({
								taskId,
								status: "completed",
								lastRunId: `run-${taskId}`,
								instructions: "Search notes by title.",
								factory,
								revision: 2,
							})),
						}
					: {
							runs: [
								{
									runId: `run-${args.taskId}`,
									taskRevision: 2,
									factory: outcomes.find(
										([taskId]) => taskId === args.taskId,
									)?.[1],
								},
							],
						},
		);
		expect(
			await handleFactoryCommand(ctx, "factory_attention", undefined, readTask),
		).toEqual(
			[
				// Feedback is optional and never a decision.
				["finding", false],
				["approved-stop", true],
				["approved-paused", false],
				["paused", true],
			].map(([taskId, needsAttention]) =>
				expect.objectContaining({ taskId, needsAttention }),
			),
		);
	});

	it("passes a feedback analysis and its proposed rule through to the board", async () => {
		const analysis = {
			status: "proposed",
			trigger: "feedback",
			startedAt: "2026-01-01T00:00:00Z",
			completedAt: "2026-01-01T00:01:00Z",
			summary: "Review missed empty titles.",
			proposal: {
				role: "reviewer",
				scope: "user",
				change: { topic: "Empty titles", text: "Check empty titles." },
				baseHash: "a",
				hash: "b",
				diff: "@@ -0,0 +1 @@\n+Check empty titles.\n",
				summary: 'Added "Empty titles"',
			},
		};
		const readTask = vi.fn<Parameters<typeof handleFactoryCommand>[3]>(
			async (command) =>
				command === "task.list"
					? {
							tasks: [
								{
									taskId: "noted",
									status: "completed",
									lastRunId: "run-noted",
									instructions: "Search notes by title.",
									factory,
									revision: 2,
								},
							],
						}
					: {
							runs: [
								{
									runId: "run-noted",
									taskRevision: 2,
									factory: {
										...ready,
										audit: {
											selectedAt: "2026-01-01T00:00:00Z",
											finding: "Missed empty titles",
											analysis,
										},
									},
								},
							],
						},
		);
		const [item] = (await handleFactoryCommand(
			ctx,
			"factory_attention",
			undefined,
			readTask,
		)) as Array<{ outcome?: { audit?: { analysis?: unknown } } }>;
		expect(item?.outcome?.audit?.analysis).toEqual(analysis);
	});

	it("reads the last run of an approved hands-off card so its automatic retry shows", async () => {
		const handsOff = factoryTaskConfigSchema.parse({ autonomy: "hands_off" });
		const autoRecovery = {
			attempts: 1,
			reason: "gh: connection reset by peer",
			at: "2026-01-01T00:05:00Z",
		};
		// Core returns a recovering card to approved with its failed run last.
		const tasks = [
			{ taskId: "retrying", factory: handsOff, lastRunId: "run-retrying" },
			{ taskId: "fresh", factory: handsOff },
			{ taskId: "manual", factory, lastRunId: "run-manual" },
		];
		const readTask = vi.fn<Parameters<typeof handleFactoryCommand>[3]>(
			async (command, args) =>
				command === "task.list"
					? {
							tasks: tasks.map((task) => ({
								...task,
								status: "approved",
								instructions: "Search notes by title.",
								revision: 2,
							})),
						}
					: {
							runs: [
								{
									runId: `run-${args.taskId}`,
									taskRevision: 2,
									factory: { ...ready, phase: "blocked", autoRecovery },
								},
							],
						},
		);
		const attention = (await handleFactoryCommand(
			ctx,
			"factory_attention",
			undefined,
			readTask,
		)) as Array<{ taskId: string; needsAttention: boolean; outcome?: unknown }>;
		expect(
			readTask.mock.calls
				.filter(([command]) => command === "task.get")
				.map(([, args]) => args.taskId),
		).toEqual(["retrying"]);
		expect(attention.find((item) => item.taskId === "retrying")).toMatchObject({
			needsAttention: false,
			outcome: { autoRecovery, autoRetrying: true },
		});
		expect(
			attention.find((item) => item.taskId === "manual")?.outcome,
		).toBeUndefined();
	});

	it("reads a finished card's runs once across sweeps until a task event names it", async () => {
		const cards = Array.from({ length: 20 }, (_, index) => ({
			taskId: `done-${index}`,
			status: "completed",
			lastRunId: `run-done-${index}`,
			instructions: "Search notes by title.",
			revision: 2,
			factory,
		}));
		const readTask = vi.fn<Parameters<typeof handleFactoryCommand>[3]>(
			async (command, args) =>
				command === "task.list"
					? {
							tasks: [
								...cards,
								{
									taskId: "live",
									status: "in_progress",
									currentRunId: "run-live",
									instructions: "Search notes by title.",
									revision: 2,
									factory,
								},
							],
						}
					: {
							runs: [
								{
									runId: `run-${args.taskId}`,
									taskRevision: 2,
									status: args.taskId === "live" ? "running" : "completed",
									factory: ready,
								},
							],
						},
		);
		const gets = () =>
			readTask.mock.calls.filter(([command]) => command === "task.get").length;
		const sweep = () =>
			handleFactoryCommand(ctx, "factory_attention", undefined, readTask);
		await sweep();
		expect(gets()).toBe(21);
		// Several views refreshing at once share the sweeps.
		await Promise.all([sweep(), sweep(), sweep()]);
		expect(readTask.mock.calls.filter(([c]) => c === "task.list")).toHaveLength(
			3,
		);
		expect(gets()).toBe(23);
		forgetFactoryRuns("done-3");
		await sweep();
		expect(gets()).toBe(25);
	});

	it("lists running role sessions from the run it already reads, with one read per card", async () => {
		const attempt = (
			sessionId: string,
			role: "builder" | "reviewer" | "verifier",
			status: "intent" | "running" | "completed",
		) => ({
			id: sessionId,
			key: sessionId,
			role,
			repairRound: 0,
			createdAt: `2026-01-01T00:0${sessionId.length % 10}:00Z`,
			sessionId,
			instructions: "Work.",
			agent: {},
			status,
			...(status === "completed"
				? { summary: "Done.", completedAt: "2026-01-01T00:09:00Z" }
				: {}),
		});
		const state = factoryRunStateSchema.parse({
			...ready,
			phase: "reviewing",
			attempts: [
				attempt("builder-1", "builder", "completed"),
				attempt("reviewer-1", "reviewer", "running"),
				attempt("reviewer-22", "reviewer", "intent"),
			],
		});
		const readTask = vi.fn<Parameters<typeof handleFactoryCommand>[3]>(
			async (command) =>
				command === "task.list"
					? {
							tasks: [
								{
									taskId: "build",
									status: "in_progress",
									currentRunId: "run-build",
									instructions: "Search notes by title.",
									revision: 2,
									factory,
								},
							],
						}
					: {
							runs: [{ runId: "run-build", taskRevision: 2, factory: state }],
						},
		);
		const [item] = (await handleFactoryCommand(
			ctx,
			"factory_attention",
			undefined,
			readTask,
		)) as Array<{
			outcome?: { activeRoles: string[]; activeSessions: unknown };
		}>;
		expect(readTask).toHaveBeenCalledTimes(2);
		expect(item?.outcome?.activeRoles).toEqual(["reviewer", "reviewer"]);
		expect(item?.outcome?.activeSessions).toEqual([
			{
				sessionId: "reviewer-1",
				role: "reviewer",
				startedAt: state.attempts?.[1]?.createdAt,
			},
			{
				sessionId: "reviewer-22",
				role: "reviewer",
				startedAt: state.attempts?.[2]?.createdAt,
			},
		]);
	});

	it("projects the review decision, the setup dry run and the rule-card flag so rows need no extra read", async () => {
		const delivered = factoryRunStateSchema.parse({
			...ready,
			candidate: { commit: "b".repeat(40), checks: [], reviews: [] },
			humanReview: { required: true, reason: "shared contract" },
			verificationProfile: {
				hash: "c".repeat(64),
				preflight: "failed",
				stage: "healthcheck",
				detail: "curl: connection refused",
			},
		});
		const legacy = factoryRunStateSchema.parse({
			...ready,
			candidate: { commit: "d".repeat(40), checks: [], reviews: [] },
		});
		const readTask = vi.fn<Parameters<typeof handleFactoryCommand>[3]>(
			async (command, args) =>
				command === "task.list"
					? {
							tasks: [
								{
									taskId: "rule",
									status: "completed",
									lastRunId: "run-rule",
									instructions: "Add a lint rule.",
									revision: 1,
									factory: factoryTaskConfigSchema.parse({
										intake: { source: "factory:repo-rules", key: "no-any" },
									}),
								},
								{
									taskId: "legacy",
									status: "completed",
									lastRunId: "run-legacy",
									instructions: "Older work.",
									revision: 1,
									factory,
								},
							],
						}
					: args.taskId === "rule"
						? {
								runs: [
									{ runId: "run-rule", taskRevision: 1, factory: delivered },
								],
							}
						: {
								runs: [
									{ runId: "run-legacy", taskRevision: 1, factory: legacy },
								],
							},
		);
		const [rule, older] = (await handleFactoryCommand(
			ctx,
			"factory_attention",
			undefined,
			readTask,
		)) as Array<
			Record<string, unknown> & { outcome?: Record<string, unknown> }
		>;
		expect(readTask).toHaveBeenCalledTimes(3);
		expect(rule?.ruleCard).toBe(true);
		expect(rule?.outcome?.humanReview).toEqual({
			required: true,
			reason: "shared contract",
		});
		// The log stays on the run; rows get the summary.
		expect(rule?.outcome?.verificationProfile).toEqual({
			hash: "c".repeat(64),
			preflight: "failed",
			stage: "healthcheck",
		});
		expect(older?.ruleCard).toBeUndefined();
		expect(older?.outcome).not.toHaveProperty("humanReview");
		expect(older?.outcome).not.toHaveProperty("verificationProfile");
	});

	it("projects a draft PR left open with unresolved findings as ready for review with its link", async () => {
		const url = "https://github.com/o/r/pull/15672";
		const unresolvedFindings = {
			commit: "b".repeat(40),
			findings: ["Reviewer 1: gate", "Reviewer 1: churn"],
			pullRequestOpen: true,
		};
		const stopped = factoryRunStateSchema.parse({
			...ready,
			phase: "blocked",
			repairRound: 2,
			pullRequestUrl: url,
			candidate: { commit: "b".repeat(40), checks: [], reviews: [] },
			unresolvedFindings,
			humanReview: { required: true, reason: "review findings unresolved" },
		});
		const readTask = vi.fn<Parameters<typeof handleFactoryCommand>[3]>(
			async (command) =>
				command === "task.list"
					? {
							tasks: [
								{
									taskId: "findings",
									status: "failed",
									lastRunId: "run-findings",
									instructions: "Add a setting.",
									revision: 1,
									factory,
								},
							],
						}
					: {
							runs: [
								{ runId: "run-findings", taskRevision: 1, factory: stopped },
							],
						},
		);
		const [item] = (await handleFactoryCommand(
			ctx,
			"factory_attention",
			undefined,
			readTask,
		)) as Array<
			Record<string, unknown> & { outcome?: Record<string, unknown> }
		>;
		expect(item?.needsAttention).toBe(true);
		expect(item?.outcome).toMatchObject({
			phase: "blocked",
			pullRequestUrl: url,
			unresolvedFindings,
			humanReview: { required: true, reason: "review findings unresolved" },
		});
	});

	it("projects what became of a delivered card's PR", async () => {
		const delivered = factoryRunStateSchema.parse({
			...ready,
			phase: "ready",
			pullRequestUrl: "https://github.com/o/r/pull/1",
			pullRequestReady: true,
			pullRequestOutcome: {
				state: "merged",
				headChanged: true,
				at: "2026-11-11T00:00:00.000Z",
			},
		});
		const readTask = vi.fn<Parameters<typeof handleFactoryCommand>[3]>(
			async (command) =>
				command === "task.list"
					? {
							tasks: [
								{
									taskId: "merged",
									status: "completed",
									lastRunId: "run-merged",
									instructions: "Add a setting.",
									revision: 1,
									factory,
								},
							],
						}
					: {
							runs: [
								{ runId: "run-merged", taskRevision: 1, factory: delivered },
							],
						},
		);
		const [item] = (await handleFactoryCommand(
			ctx,
			"factory_attention",
			undefined,
			readTask,
		)) as Array<
			Record<string, unknown> & { outcome?: Record<string, unknown> }
		>;
		expect(item?.outcome?.pullRequestOutcome).toEqual({
			state: "merged",
			headChanged: true,
			at: "2026-11-11T00:00:00.000Z",
		});
		expect(item?.outcome?.pullRequestReady).toBe(true);
	});

	it("projects a parent's parts and a waiting part's dependency from the listed cards and their links", async () => {
		const delivered = factoryRunStateSchema.parse({
			...ready,
			pullRequestUrl: "https://github.com/o/r/pull/41",
		});
		const part = (title: string, taskId: string, dependsOn: number[] = []) => ({
			title,
			brief: `${title}.`,
			paths: [`src/${taskId}`],
			dependsOn,
			taskId,
		});
		const card = (taskId: string, number: number, extra: object) => ({
			taskId,
			factoryNumber: number,
			instructions: "Do it.",
			revision: 1,
			factory,
			factoryParentTaskId: "parent",
			...extra,
		});
		const waitsFor = (taskId: string, extra: object = {}) => ({
			status: "pending_approval",
			factoryBlockedBy: { taskIds: [taskId], met: {}, ...extra },
		});
		const readTask = vi.fn<Parameters<typeof handleFactoryCommand>[3]>(
			async (command) =>
				command === "task.list"
					? {
							tasks: [
								{
									taskId: "parent",
									factoryNumber: 40,
									status: "completed",
									instructions: "Export and link activity.",
									revision: 1,
									factory,
									factorySplit: {
										splitId: "split-1",
										revision: 1,
										approvedAt: "2026-11-12T00:00:00.000Z",
										goal: "Export and link activity",
										createdAt: "2026-11-12T00:00:01.000Z",
										parts: [
											part("Export", "p1"),
											part("Link", "p2", [0]),
											part("Footer", "p3"),
											part("Menu", "p4", [0]),
											part("Search", "p5"),
											part("Filters", "p6", [4]),
										],
									},
								},
								card("p1", 41, { status: "completed", lastRunId: "run-41" }),
								card("p2", 42, waitsFor("p1")),
								card("p3", 43, { status: "cancelled" }),
								card(
									"p4",
									44,
									waitsFor("p1", {
										mergedElsewhere: {
											p1: {
												at: "t",
												prUrl: "https://github.com/o/r/pull/41",
												baseBranch: "release",
												expected: "main",
											},
										},
									}),
								),
								card("p5", 45, {
									status: "pending_approval",
									archivedAt: "2026-11-12T00:00:02.000Z",
								}),
								card("p6", 46, waitsFor("p5")),
							],
						}
					: {
							runs: [{ runId: "run-41", taskRevision: 1, factory: delivered }],
						},
		);
		const items = (await handleFactoryCommand(
			ctx,
			"factory_attention",
			undefined,
			readTask,
		)) as Array<Record<string, unknown>>;
		const item = (taskId: string) =>
			items.find((entry) => entry.taskId === taskId);
		expect(item("parent")?.parts).toEqual({
			total: 6,
			delivered: 1,
			merged: 0,
			open: 3,
			needsYou: 2,
			stopped: 0,
			closed: 2,
		});
		expect(item("p2")?.dependency).toEqual({ state: "waiting", on: ["F41"] });
		expect(item("p4")?.dependency).toEqual({
			state: "unavailable",
			on: ["F41"],
			reason: "F41 merged into release, not main",
		});
		expect(item("p6")?.dependency).toEqual({
			state: "unavailable",
			on: ["F45"],
			reason: "F45 was archived before it opened a pull request",
		});
		// One list that carries every linked card, and the one delivered
		// card's runs: no read per link.
		expect(readTask).toHaveBeenCalledTimes(2);
		expect(readTask).toHaveBeenCalledWith(
			"task.list",
			expect.objectContaining({ factoryLinks: true }),
		);
	});

	it("reports a card whose data fails validation as unreadable and keeps every other card", async () => {
		const log = vi.fn();
		const readTask = vi.fn<Parameters<typeof handleFactoryCommand>[3]>(
			async (command, args) => {
				if (command === "task.list")
					return {
						tasks: [
							{
								taskId: "good",
								status: "pending_approval",
								revision: 1,
								instructions: "Feature",
								factory,
							},
							{
								taskId: "bad-config",
								factoryNumber: 7,
								status: "pending_approval",
								revision: 3,
								instructions: "Feature",
								factory: { approval: 42 },
							},
							{
								taskId: "bad-run",
								status: "completed",
								lastRunId: "run-bad",
								revision: 1,
								instructions: "Feature",
								factory,
							},
							// Not a Factory card, and archived cards stay hidden.
							{ taskId: "ordinary", status: 3 },
							{
								taskId: "archived",
								archivedAt: "2026-01-01T00:00:00Z",
								factory: { approval: 42 },
							},
						],
					};
				expect(args.taskId).toBe("bad-run");
				return {
					runs: [{ runId: "run-bad", taskRevision: 1, factory: { phase: 7 } }],
				};
			},
		);
		const items = (await handleFactoryCommand(
			{ ...ctx, logger: { log, debug: vi.fn() } as never },
			"factory_attention",
			undefined,
			readTask,
		)) as Array<{
			taskId: string;
			revision?: number;
			unreadable?: { reason: string };
		}>;
		expect(items.map((item) => item.taskId)).toEqual([
			"good",
			"bad-config",
			"bad-run",
		]);
		expect(items[0]?.unreadable).toBeUndefined();
		expect(items[1]).toMatchObject({
			taskId: "bad-config",
			revision: 3,
			questions: [],
			needsAttention: false,
			unreadable: { reason: expect.stringContaining("approval") },
		});
		expect(items[2]?.unreadable?.reason).toEqual(expect.any(String));
		for (const item of items.slice(1)) {
			// A short line, never the raw validation output.
			expect(item.unreadable?.reason).not.toMatch(/[[{]/);
			expect(item.unreadable?.reason.length).toBeLessThanOrEqual(120);
		}
		expect(log).toHaveBeenCalledWith(
			"Factory card could not be read",
			expect.objectContaining({ taskId: "bad-config" }),
		);
		expect(log).toHaveBeenCalledWith(
			"Factory card could not be read",
			expect.objectContaining({ taskId: "bad-run" }),
		);
	});

	it("loads review evidence from the requested stored task without accepting a caller-supplied workspace", async () => {
		const reply = {
			runs: [{ runId: "run-1", taskRevision: 1, factory: ready }],
		};
		const readTask = vi.fn().mockResolvedValue(reply);
		vi.mocked(readFactoryDiff).mockResolvedValue([]);
		await expect(
			handleFactoryCommand(
				ctx,
				"factory_get_diff",
				{
					taskId: "feature",
					runId: "run-1",
					expectedCommit: "candidate",
					cwd: "/untrusted",
				},
				readTask,
			),
		).resolves.toEqual([]);
		expect(readTask).toHaveBeenCalledWith("task.get", {
			taskId: "feature",
			allWorkspaces: true,
		});
		expect(readFactoryDiff).toHaveBeenCalledWith(reply, "run-1", "candidate");
	});
});

describe("handleFactoryLimitsCommand", () => {
	it("reads the limit from the Hub", async () => {
		const send = vi.fn(async () => ({ ok: true, payload: { concurrency: 2 } }));
		await expect(
			handleFactoryLimitsCommand("factory_get_limits", undefined, send),
		).resolves.toEqual({ supported: true, concurrency: 2 });
		expect(send).toHaveBeenCalledWith("task.factory.limits.get", {});
	});

	it("sets the limit and returns the Hub's value", async () => {
		const send = vi.fn(async () => ({ ok: true, payload: { concurrency: 5 } }));
		await expect(
			handleFactoryLimitsCommand(
				"factory_set_limits",
				{ concurrency: 5 },
				send,
			),
		).resolves.toEqual({ supported: true, concurrency: 5 });
		expect(send).toHaveBeenCalledWith("task.factory.limits.set", {
			concurrency: 5,
		});
	});

	it("passes the Hub's pause through on read and sets it alone", async () => {
		const read = vi.fn(async () => ({
			ok: true,
			payload: { concurrency: 2, paused: true },
		}));
		await expect(
			handleFactoryLimitsCommand("factory_get_limits", undefined, read),
		).resolves.toEqual({ supported: true, concurrency: 2, paused: true });
		const set = vi.fn(async () => ({
			ok: true,
			payload: { concurrency: 2, paused: false },
		}));
		await expect(
			handleFactoryLimitsCommand("factory_set_limits", { paused: false }, set),
		).resolves.toEqual({ supported: true, concurrency: 2, paused: false });
		expect(set).toHaveBeenCalledWith("task.factory.limits.set", {
			paused: false,
		});
		await expect(
			handleFactoryLimitsCommand(
				"factory_set_limits",
				{ paused: "yes" },
				vi.fn(),
			),
		).rejects.toThrow();
	});

	it("passes the Hub's duplicate check switch through on read and sets it alone", async () => {
		const read = vi.fn(async () => ({
			ok: true,
			payload: { concurrency: 2, duplicateCheck: true },
		}));
		await expect(
			handleFactoryLimitsCommand("factory_get_limits", undefined, read),
		).resolves.toEqual({
			supported: true,
			concurrency: 2,
			duplicateCheck: true,
		});
		const set = vi.fn(async () => ({
			ok: true,
			payload: { concurrency: 2, duplicateCheck: false },
		}));
		await expect(
			handleFactoryLimitsCommand(
				"factory_set_limits",
				{ duplicateCheck: false },
				set,
			),
		).resolves.toEqual({
			supported: true,
			concurrency: 2,
			duplicateCheck: false,
		});
		expect(set).toHaveBeenCalledWith("task.factory.limits.set", {
			duplicateCheck: false,
		});
		await expect(
			handleFactoryLimitsCommand(
				"factory_set_limits",
				{ duplicateCheck: "off" },
				vi.fn(),
			),
		).rejects.toThrow();
	});

	it.each([
		0,
		9,
		2.5,
		"3",
		undefined,
	])("rejects %s before it reaches the Hub", async (concurrency) => {
		const send = vi.fn();
		await expect(
			handleFactoryLimitsCommand("factory_set_limits", { concurrency }, send),
		).rejects.toThrow();
		expect(send).not.toHaveBeenCalled();
	});

	it.each([
		"factory_get_limits",
		"factory_set_limits",
	] as const)("reports an older Hub as unsupported for %s", async (command) => {
		const send = vi.fn(async () => ({
			ok: false,
			error: {
				code: "unsupported_command",
				message: "Unsupported hub schedule command: task.factory.limits.get",
			},
		}));
		await expect(
			handleFactoryLimitsCommand(command, { concurrency: 3 }, send),
		).resolves.toEqual({ supported: false });
	});

	it("passes the Hub's split switch through on read and sets it alone", async () => {
		const send = vi.fn(async () => ({
			ok: true,
			payload: { concurrency: 2, splitLargeWork: false },
		}));
		await expect(
			handleFactoryLimitsCommand(
				"factory_set_limits",
				{ splitLargeWork: false },
				send,
			),
		).resolves.toEqual({
			supported: true,
			concurrency: 2,
			splitLargeWork: false,
		});
		expect(send).toHaveBeenCalledWith("task.factory.limits.set", {
			splitLargeWork: false,
		});
	});

	it("surfaces a failed set as a readable error", async () => {
		const send = vi.fn(async () => ({
			ok: false,
			error: {
				code: "task_command_failed",
				message: "this client cannot change Factory limits",
			},
		}));
		await expect(
			handleFactoryLimitsCommand(
				"factory_set_limits",
				{ concurrency: 3 },
				send,
			),
		).rejects.toThrow(
			"Factory could not change how much work runs at once: this client cannot change Factory limits",
		);
	});
});

describe("handleFactoryLimitsCommand spending", () => {
	it("passes the daily limit and today's spending through on read", async () => {
		const read = vi.fn(async () => ({
			ok: true,
			payload: { concurrency: 2, dailyCostUsd: 50, spentTodayUsd: 12.5 },
		}));
		await expect(
			handleFactoryLimitsCommand("factory_get_limits", undefined, read),
		).resolves.toEqual({
			supported: true,
			concurrency: 2,
			dailyCostUsd: 50,
			spentTodayUsd: 12.5,
		});
		// null is "no limit", not unsupported.
		const unlimited = vi.fn(async () => ({
			ok: true,
			payload: { concurrency: 2, dailyCostUsd: null, spentTodayUsd: 0 },
		}));
		await expect(
			handleFactoryLimitsCommand("factory_get_limits", undefined, unlimited),
		).resolves.toEqual({
			supported: true,
			concurrency: 2,
			dailyCostUsd: null,
			spentTodayUsd: 0,
		});
	});

	it("reads a Hub without the cost fields as not supporting the daily limit", async () => {
		const older = vi.fn(async () => ({
			ok: true,
			payload: { concurrency: 3, paused: false, somethingNew: 1 },
		}));
		const reply = await handleFactoryLimitsCommand(
			"factory_get_limits",
			undefined,
			older,
		);
		expect(reply).toEqual({ supported: true, concurrency: 3, paused: false });
		expect(reply).not.toHaveProperty("dailyCostUsd");
		// Malformed cost fields read the same way instead of failing the read.
		const malformed = vi.fn(async () => ({
			ok: true,
			payload: { concurrency: 3, dailyCostUsd: "lots", spentTodayUsd: -1 },
		}));
		await expect(
			handleFactoryLimitsCommand("factory_get_limits", undefined, malformed),
		).resolves.toEqual({ supported: true, concurrency: 3 });
	});

	it("uses the default daily limit when the Hub reports spending but no limit", async () => {
		const send = vi.fn(async () => ({
			ok: true,
			payload: { concurrency: 2, spentTodayUsd: 4 },
		}));
		await expect(
			handleFactoryLimitsCommand("factory_get_limits", undefined, send),
		).resolves.toEqual({
			supported: true,
			concurrency: 2,
			dailyCostUsd: 50,
			spentTodayUsd: 4,
		});
	});

	it.each([
		[25, 25],
		// One meaning end to end: empty (null) and 0 are "no daily limit",
		// sent as null; the Hub stores it and reads it back as null.
		[0, null],
		[null, null],
	])("sends dailyCostUsd %s as %s alone to the Hub", async (dailyCostUsd, sent) => {
		const send = vi.fn(async () => ({
			ok: true,
			payload: { concurrency: 2, dailyCostUsd: sent },
		}));
		await expect(
			handleFactoryLimitsCommand("factory_set_limits", { dailyCostUsd }, send),
		).resolves.toEqual({ supported: true, concurrency: 2, dailyCostUsd: sent });
		expect(send).toHaveBeenCalledWith("task.factory.limits.set", {
			dailyCostUsd: sent,
		});
	});

	it.each([
		-1,
		10_001,
		Number.POSITIVE_INFINITY,
		"20",
	])("rejects dailyCostUsd %s before it reaches the Hub", async (dailyCostUsd) => {
		const send = vi.fn();
		await expect(
			handleFactoryLimitsCommand("factory_set_limits", { dailyCostUsd }, send),
		).rejects.toThrow();
		expect(send).not.toHaveBeenCalled();
	});

	it("names the daily limit when the Hub rejects it", async () => {
		const send = vi.fn(async () => ({
			ok: false,
			error: { code: "invalid_input", message: "too high" },
		}));
		await expect(
			handleFactoryLimitsCommand(
				"factory_set_limits",
				{ dailyCostUsd: 20 },
				send,
			),
		).rejects.toThrow(
			"Factory could not change the daily spending limit: too high",
		);
	});
});

describe("oncePerConnection", () => {
	it("pushes once per connection and retries after a failed push", async () => {
		const push = vi
			.fn<(key: object, context: undefined) => Promise<void>>()
			.mockRejectedValueOnce(new Error("Hub busy"))
			.mockResolvedValue(undefined);
		const onError = vi.fn();
		const sync = oncePerConnection(push, onError);
		const connection = {};
		// A failure is logged and never rejects the command waiting on it.
		await expect(sync(connection, undefined)).resolves.toBeUndefined();
		expect(onError).toHaveBeenCalledWith(new Error("Hub busy"), undefined);
		await sync(connection, undefined);
		await sync(connection, undefined);
		expect(push).toHaveBeenCalledTimes(2);
		// A new connection pushes again.
		await sync({}, undefined);
		expect(push).toHaveBeenCalledTimes(3);
	});
});

describe("Factory repository stages", () => {
	const stage = {
		id: "no-todo-left",
		name: "No TODO left",
		kind: "command",
		command: "true",
	};
	const hash = "a".repeat(64);
	const listing = {
		file: "present",
		stages: [{ stage, hash, status: "needs_approval" }],
	};

	it("reads a project's stages and sends a decision for the shown hash only", async () => {
		const send = vi.fn(async (command: string) => ({
			ok: true,
			payload:
				command === "task.factory.stages.get"
					? listing
					: {
							listing: {
								...listing,
								stages: [{ stage, hash, status: "approved" }],
							},
							record: { hash, decision: "approved", at: "now" },
						},
		}));
		await expect(
			handleFactoryStagesCommand(
				"factory_get_stages",
				{ workspaceRoot: "/repo" },
				send,
			),
		).resolves.toEqual(listing);
		await expect(
			handleFactoryStagesCommand(
				"factory_decide_stage",
				{
					workspaceRoot: "/repo",
					stageId: stage.id,
					expectedHash: hash,
					decision: "approved",
				},
				send,
			),
		).resolves.toMatchObject({ stages: [{ status: "approved" }] });
		expect(send).toHaveBeenLastCalledWith("task.factory.stages.set", {
			workspaceRoot: "/repo",
			stageId: stage.id,
			expectedHash: hash,
			decision: "approved",
		});
		// No hash, an unknown decision or extra fields never reach the Hub.
		for (const args of [
			{ workspaceRoot: "/repo", stageId: stage.id, decision: "approved" },
			{
				workspaceRoot: "/repo",
				stageId: stage.id,
				expectedHash: hash,
				decision: "always",
			},
			{
				workspaceRoot: "/repo",
				stageId: stage.id,
				expectedHash: hash,
				decision: "approved",
				command: "rm -rf .",
			},
		])
			await expect(
				handleFactoryStagesCommand("factory_decide_stage", args, send),
			).rejects.toThrow();
		expect(send).toHaveBeenCalledTimes(2);
	});

	it("reports an older Hub as unsupported", async () => {
		await expect(
			handleFactoryStagesCommand(
				"factory_get_stages",
				{ workspaceRoot: "/repo" },
				async () => ({ ok: false, error: { code: "unsupported_command" } }),
			),
		).resolves.toEqual({ supported: false });
	});

	it("projects the repository stage running now onto the card outcome", async () => {
		const state = factoryRunStateSchema.parse({
			...ready,
			phase: "verifying",
			candidate: {
				commit: "b".repeat(40),
				checks: [],
				reviews: [],
				stages: [
					{
						id: "no-todo-left",
						name: "No TODO left",
						kind: "command",
						hash,
						blocking: true,
						status: "running",
					},
				],
			},
		});
		const readTask = vi.fn<Parameters<typeof handleFactoryCommand>[3]>(
			async (command) =>
				command === "task.list"
					? {
							tasks: [
								{
									taskId: "build",
									status: "in_progress",
									currentRunId: "run-build",
									instructions: "Search notes by title.",
									revision: 2,
									factory,
								},
							],
						}
					: {
							runs: [{ runId: "run-build", taskRevision: 2, factory: state }],
						},
		);
		const [item] = (await handleFactoryCommand(
			ctx,
			"factory_attention",
			undefined,
			readTask,
		)) as Array<{ outcome?: { activeStage?: string } }>;
		expect(item?.outcome?.activeStage).toBe("No TODO left");
	});
});

describe("Factory settings commands", () => {
	const guidance = {
		maxChars: 8000,
		userScope: true,
		managerReadmeDefault: "# Factory manager readme",
		workspaceRoot: "/repo",
		targets: [
			{
				role: "builder",
				user: { status: "none", content: "", hash: "e3b0c44298fc1c14" },
				repository: {
					status: "changed",
					content: "## Lint\nRun it.\n",
					hash: "1234567890abcdef",
					path: "/repo/.cline/factory/guidance/builder.md",
					accepted: false,
					inUse: false,
					needsAcceptance: true,
				},
			},
		],
	};

	it("passes each read to its Hub command and validates the reply", async () => {
		const send = vi.fn(async () => ({ ok: true, payload: guidance }));
		await expect(
			handleFactorySettingsCommand(
				"factory_get_guidance",
				{ workspaceRoot: "/repo" },
				send,
			),
		).resolves.toEqual({ supported: true, ...guidance });
		expect(send).toHaveBeenCalledWith("task.factory.guidance.get", {
			workspaceRoot: "/repo",
		});
		// A reply the webview cannot rely on is an error, not data.
		await expect(
			handleFactorySettingsCommand(
				"factory_get_guidance",
				{},
				vi.fn(async () => ({ ok: true, payload: { targets: "x" } })),
			),
		).rejects.toThrow();
	});

	it("keeps the card number of a guidance change made from feedback", async () => {
		const entry = {
			id: "x",
			time: "2026-11-12T00:00:00.000Z",
			role: "builder",
			scope: "user",
			note: "From feedback",
			hashBefore: "1234567890abcdef",
			hashAfter: "fedcba0987654321",
			before: "a",
			after: "b",
			source: { kind: "feedback", taskId: "task-12", factoryNumber: 12 },
		};
		await expect(
			handleFactorySettingsCommand(
				"factory_get_guidance_history",
				{ role: "builder" },
				async () => ({ ok: true, payload: { entries: [entry], more: false } }),
			),
		).resolves.toEqual({ supported: true, entries: [entry], more: false });
	});

	it("reports an older Hub as unsupported for every settings command", async () => {
		const old = vi.fn(async () => ({
			ok: false,
			error: { code: "unsupported_command", message: "unknown" },
		}));
		for (const [command, args] of [
			["factory_get_guidance", {}],
			["factory_get_guidance_history", { role: "builder" }],
			["factory_get_verification", { workspaceRoot: "/repo" }],
			["factory_get_storage", {}],
			["factory_get_projects", {}],
			["factory_reset", { what: "user_guidance", dryRun: true }],
		] as const)
			await expect(
				handleFactorySettingsCommand(command, args, old),
			).resolves.toEqual({ supported: false });
	});

	it("returns a write's refusal with its code and current hash, and throws other failures", async () => {
		const edit = {
			role: "builder",
			scope: "repository",
			workspaceRoot: "/repo",
			expectedHash: "1234567890abcdef",
			content: "## Lint\nRun it twice.\n",
		};
		await expect(
			handleFactorySettingsCommand("factory_set_guidance", edit, async () => ({
				ok: false,
				error: {
					code: "factory_guidance_stale",
					message: "This guidance changed while you were editing.",
					details: { currentHash: "fedcba0987654321" },
				},
			})),
		).resolves.toEqual({
			supported: true,
			ok: false,
			error: {
				code: "factory_guidance_stale",
				message: "This guidance changed while you were editing.",
				currentHash: "fedcba0987654321",
			},
		});
		await expect(
			handleFactorySettingsCommand("factory_set_guidance", edit, async () => ({
				ok: false,
				error: { code: "task_command_failed", message: "disk full" },
			})),
		).rejects.toThrow("Factory could not save the guidance: disk full");
		const entry = {
			id: "x",
			time: "2026-11-12T00:00:00.000Z",
			role: "builder",
			scope: "repository",
			workspaceRoot: "/repo",
			note: "Edited in Factory settings",
			hashBefore: "1234567890abcdef",
			hashAfter: "fedcba0987654321",
			before: "a",
			after: "b",
			source: { kind: "settings" },
		};
		await expect(
			handleFactorySettingsCommand("factory_set_guidance", edit, async () => ({
				ok: true,
				payload: { target: guidance.targets[0], entry },
			})),
		).resolves.toMatchObject({ supported: true, ok: true, entry });
	});

	it("never sends invalid input, a free path or user guidance tied to a project", async () => {
		const send = vi.fn();
		for (const [command, args] of [
			[
				"factory_set_guidance",
				{
					role: "builder",
					scope: "user",
					workspaceRoot: "/repo",
					expectedHash: "1234567890abcdef",
					content: "x",
				},
			],
			[
				"factory_set_guidance",
				{
					role: "builder",
					scope: "repository",
					expectedHash: "1234567890abcdef",
					content: "x",
				},
			],
			[
				"factory_set_guidance",
				{
					role: "operator",
					scope: "user",
					expectedHash: "1234567890abcdef",
					content: "x",
				},
			],
			[
				"factory_resolve_guidance",
				{
					role: "builder",
					scope: "user",
					decision: "keep",
					expectedHash: "1234567890abcdef",
				},
			],
			[
				"factory_set_verification",
				{ workspaceRoot: "/repo", decision: "approve", expectedHash: "abc" },
			],
			["factory_get_storage", { path: "/" }],
			["factory_clean_storage", { what: "everything" }],
			["factory_reset", { what: "cards" }],
			["factory_get_projects", { workspaceRoot: "/" }],
		] as const)
			await expect(
				handleFactorySettingsCommand(command, args as never, send),
			).rejects.toThrow();
		expect(send).not.toHaveBeenCalled();
	});

	it("removes finished working copies with the default what", async () => {
		const storage = {
			dataDir: "/data",
			worktreesDir: "/data/factory/factory-worktrees",
			artifactsDir: "/data/factory/factory-artifacts",
			logsDir: "/data/factory/factory-app-logs",
			worktrees: {
				count: 1,
				bytes: 10,
				finishedCount: 0,
				finishedBytes: 0,
				unknownCount: 0,
			},
			artifactsBytes: 0,
			logsBytes: 0,
			approximate: false,
			measuredAt: "2026-11-12T00:00:00.000Z",
		};
		const send = vi.fn(async () => ({
			ok: true,
			payload: { removed: 2, bytes: 2048, skipped: [], storage },
		}));
		await expect(
			handleFactorySettingsCommand("factory_clean_storage", {}, send),
		).resolves.toEqual({
			supported: true,
			ok: true,
			removed: 2,
			bytes: 2048,
			skipped: [],
			storage,
		});
		expect(send).toHaveBeenCalledWith("task.factory.storage.clean", {
			what: "finished_worktrees",
		});
	});
});
