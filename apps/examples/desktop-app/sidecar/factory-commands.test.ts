import { factoryRunStateSchema, factoryTaskConfigSchema } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleFactoryCommand } from "./factory-commands";
import { readFactoryIssue } from "./factory-issue-import";
import { readFactoryDiff } from "./factory-review";
import type { SidecarContext } from "./types";

vi.mock("./factory-issue-import", () => ({ readFactoryIssue: vi.fn() }));
vi.mock("./factory-review", () => ({ readFactoryDiff: vi.fn() }));

const ctx: Pick<SidecarContext, "pendingQuestions"> = {
	pendingQuestions: new Map(),
};
const factory = factoryTaskConfigSchema.parse({});
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
			{ taskId: "automatic", status: "pending_approval" },
			{ taskId: "failed", status: "failed" },
		].map((task) => ({
			...task,
			factory:
				task.taskId === "automatic"
					? { ...factory, approval: "automatic" }
					: factory,
			revision: 2,
		}));
		const readTask = vi.fn<Parameters<typeof handleFactoryCommand>[3]>(
			async (command, args) => {
				if (command === "task.list")
					return {
						tasks: [
							...tasks,
							{ taskId: "ordinary", status: "pending_approval", revision: 1 },
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
			{ taskId: "design", questions: [questions[0]], needsAttention: true },
			{ taskId: "build", questions: [questions[1]], needsAttention: true },
			{ taskId: "ready", questions: [], needsAttention: true },
			{ taskId: "watching", questions: [], needsAttention: false },
			{ taskId: "stale", questions: [], needsAttention: false },
			{ taskId: "approval", questions: [], needsAttention: true },
			{ taskId: "automatic", questions: [], needsAttention: false },
			{ taskId: "failed", questions: [], needsAttention: true },
		]);
	});

	it("identifies an already imported issue only within the selected workspace", async () => {
		const issue = {
			title: "Feature",
			description: "Acceptance",
			source: {
				provider: "github",
				id: "I_example",
				url: "https://github.com/example/repo/issues/1",
			},
		} as const;
		vi.mocked(readFactoryIssue).mockResolvedValue(issue);
		const readTask = vi.fn().mockResolvedValue({
			tasks: [
				{
					taskId: "other",
					workspaceRoot: "/other",
					revision: 1,
					status: "pending_approval",
					factory: { ...factory, sourceIssue: issue.source },
				},
				{
					taskId: "existing",
					workspaceRoot: "/repo",
					revision: 1,
					status: "pending_approval",
					factory: { ...factory, sourceIssue: issue.source },
				},
			],
		});
		expect(
			await handleFactoryCommand(
				ctx,
				"factory_import_issue",
				{ url: issue.source.url, cwd: "/repo" },
				readTask,
			),
		).toEqual({ ...issue, existingTaskId: "existing" });
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
				{ taskId: "feature", runId: "run-1", cwd: "/untrusted" },
				readTask,
			),
		).resolves.toEqual([]);
		expect(readTask).toHaveBeenCalledWith("task.get", {
			taskId: "feature",
			allWorkspaces: true,
		});
		expect(readFactoryDiff).toHaveBeenCalledWith(reply, "run-1");
	});
});
