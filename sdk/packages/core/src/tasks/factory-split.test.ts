import { execFileSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AgendaTaskRecord,
	FactoryRunState,
	FactoryTaskConfig,
} from "@cline/shared";
import { factoryTaskConfigSchema } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	AgendaTaskManager,
	type AgendaTaskRuntime,
	type AgendaTaskRuntimeResult,
} from "./agenda-task-manager";
import * as factoryPullRequest from "./factory-pull-request";
import { FACTORY_REPO_RULES_SOURCE } from "./factory-repo-rules";
import { createFactoryStatusTool, createFactoryTool } from "./factory-tool";
import * as factoryWorkflow from "./factory-workflow";
import { SqliteAgendaTaskStore } from "./store/sqlite-task-store";

const disposals: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const dispose of disposals.splice(0)) await dispose();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

const check = { name: "Behavior", kind: "test", command: "true" } as const;
const criterion = {
	id: "behavior",
	text: "The behavior check passes",
	required: true,
	check: "Behavior",
};
const plan = () => ({
	instructions: "Proposed brief",
	checks: [check],
	acceptanceCriteria: [criterion],
});
const part = (title: string, paths: string[], dependsOn: number[] = []) => ({
	title,
	brief: `Brief for ${title}`,
	paths,
	dependsOn,
});
/** A breakdown: export, footer, and a report that waits for the export. */
const breakdown = (
	parts = [
		part("Add CSV export", ["src/export"]),
		part("Fix the footer year", ["src/footer.ts"]),
		part("Link the export from reports", ["src/reports"], [0]),
	],
) => ({
	split: { rationale: "Separate changes", goal: "Export and tidy", parts },
});
const PR = "https://github.com/o/r/pull/41";

type Designer = (prompt: string, call: number) => unknown;

async function harness(
	options: { designer?: Designer; approval?: "required" | "automatic" } = {},
) {
	const root = realpathSync(
		mkdtempSync(join(tmpdir(), "cline-factory-split-")),
	);
	const workspaceRoot = join(root, "repo");
	const git = (cwd: string, ...args: string[]) =>
		execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
	mkdirSync(workspaceRoot);
	git(workspaceRoot, "init", "-q", "-b", "main");
	git(workspaceRoot, "config", "user.email", "factory@example.test");
	git(workspaceRoot, "config", "user.name", "Factory Test");
	writeFileSync(join(workspaceRoot, "README.md"), "base\n");
	git(workspaceRoot, "add", ".");
	git(workspaceRoot, "commit", "-q", "-m", "base");
	// Draft PRs need an origin: a bare repository stands in for GitHub.
	git(root, "init", "-q", "--bare", "-b", "main", join(root, "origin.git"));
	git(workspaceRoot, "remote", "add", "origin", join(root, "origin.git"));
	git(workspaceRoot, "push", "-q", "origin", "main");
	let designerCall = 0;
	const runtime: AgendaTaskRuntime &
		Required<Pick<AgendaTaskRuntime, "runDesignSession">> = {
		startSession: vi.fn(async () => ({ sessionId: "unused" })),
		runSession: vi.fn(async () => ({ status: "completed" as const })),
		abortSession: vi.fn(async () => {}),
		startDesignSession: vi.fn(
			async (_task, _client, _agent, sessionId?: string) => ({
				sessionId: sessionId ?? "designer",
			}),
		),
		startDesignReviewSession: vi.fn(
			async (_task, _client, _agent, sessionId?: string) => ({
				sessionId: sessionId ?? "review",
			}),
		),
		runDesignSession: vi.fn(
			async (_sessionId, task): Promise<AgendaTaskRuntimeResult> => ({
				status: "completed",
				summary: JSON.stringify(
					options.designer?.(task.instructions, designerCall++) ?? plan(),
				),
			}),
		),
	};
	const dbPath = join(root, "tasks.db");
	const open = () =>
		new AgendaTaskManager({
			runtime,
			dbPath,
			globalSpecsDir: join(root, "specs"),
			watchFiles: false,
			automationEnabled: false,
			factoryStorageDir: join(root, "factory"),
		});
	let manager = open();
	disposals.push(async () => {
		await manager.dispose();
		rmSync(root, { recursive: true, force: true });
	});
	const config = (factory: Partial<FactoryTaskConfig> = {}) =>
		factoryTaskConfigSchema.parse({
			autonomy: "hands_off",
			approval: options.approval ?? "automatic",
			reviewMode: "fixed",
			publishPullRequest: true,
			checks: [check],
			acceptanceCriteria: [criterion],
			agents: {
				planReviewers: [],
				reviewers: [
					{ modelSelection: { providerId: "other", modelId: "reviewer" } },
				],
			},
			...factory,
		});
	const create = (
		title = "Reports and footer",
		factory: Partial<FactoryTaskConfig> = {},
		extra: Partial<Parameters<AgendaTaskManager["createTask"]>[0]> = {},
	) =>
		manager.createTask({
			title,
			type: "follow-up",
			instructions: `Brief for ${title}`,
			scope: "workspace",
			workspaceRoot,
			expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
			createdBy: { kind: "user" },
			queueFactoryDesign: false,
			factory: config(factory),
			...extra,
		});
	const get = (taskId: string) =>
		manager.getTask(taskId) as Promise<AgendaTaskRecord>;
	/** Scopes the card and waits until scoping settles. */
	const designed = async (task: AgendaTaskRecord) => {
		await manager.startFactoryDesign(task.taskId);
		await vi.waitFor(async () => {
			const current = await get(task.taskId);
			expect(
				current.factoryDesignProgress?.phase === "complete" ||
					Boolean(current.error),
			).toBe(true);
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		return get(task.taskId);
	};
	const designerPrompts = () =>
		vi
			.mocked(runtime.runDesignSession)
			.mock.calls.map(([, task]) => task.instructions);
	const store = () => {
		const opened = new SqliteAgendaTaskStore({ dbPath });
		disposals.unshift(async () => opened.close());
		return opened;
	};
	/** Records a delivered run for a card, as the workflow would. */
	const deliver = (taskId: string, state: Partial<FactoryRunState> = {}) => {
		const db = store();
		const task = db.getTask(taskId) as AgendaTaskRecord;
		const run = db.createRun({
			taskId,
			taskRevision: task.revision,
			status: "completed",
			factory: {
				phase: "ready",
				repairRound: 0,
				sessions: [],
				workspace: {
					path: join(root, "factory", taskId),
					branch: `factory/${taskId}`,
					baseBranch: "main",
					baseCommit: "base",
				},
				pullRequestUrl: PR,
				...state,
			},
		});
		db.dequeueFactory(taskId);
		db.updateTaskState(taskId, {
			status: "completed",
			lastRunId: run.runId,
			completedAt: new Date().toISOString(),
		});
		return run;
	};
	/** A fake gh on PATH answering `gh pr view` with `state`, logging each call. */
	const gh = (
		state: "OPEN" | "MERGED" | "CLOSED" | "signed out" | "slow",
		base = "main",
	) => {
		const bin = join(root, "bin");
		mkdirSync(bin, { recursive: true });
		const log = join(root, "gh.log");
		const answer =
			state === "signed out"
				? "echo 'not logged in' >&2; exit 4"
				: state === "slow"
					? "sleep 10"
					: `echo '{"state":"${state}","baseRefName":"${base}"}'`;
		writeFileSync(
			join(bin, "gh"),
			`#!/bin/sh\necho "$@" >> "${log}"\n${answer}\n`,
		);
		chmodSync(join(bin, "gh"), 0o755);
		vi.stubEnv("PATH", `${bin}:${process.env.PATH ?? ""}`);
		return () =>
			readFileSync(log, { encoding: "utf8", flag: "a+" })
				.split("\n")
				.filter(Boolean);
	};
	const internals = () =>
		manager as unknown as {
			pumpFactoryQueue(): Promise<void>;
			checkFactoryMerges(): Promise<void>;
			createFactoryParts(parent: AgendaTaskRecord): Promise<AgendaTaskRecord[]>;
			factoryControllers: Map<string, unknown>;
			factorySpendingLimitReached: boolean;
			factoryMergeChecks: Map<string, unknown>;
			expireTasks(): void;
		};
	/** An approved breakdown: the parent and its kept parts. */
	const approvedSplit = async (
		designer: Designer = (_prompt, call) => (call === 0 ? breakdown() : plan()),
	) => {
		options.designer ??= designer;
		const parent = await designed(await create());
		const { task, parts } = await manager.approveFactorySplit(
			parent.taskId,
			parent.revision,
			{ kind: "user", id: "desktop" },
		);
		return { parent: task, parts };
	};
	return {
		get manager() {
			return manager;
		},
		reopen: async () => {
			await manager.dispose();
			manager = open();
			return manager;
		},
		runtime,
		root,
		workspaceRoot,
		git,
		create,
		get,
		designed,
		designerPrompts,
		store,
		deliver,
		gh,
		internals,
		approvedSplit,
	};
}

describe("offering a breakdown", () => {
	it("offers it on a first scoping, and an unusable one is withdrawn and the card planned as one", async () => {
		const h = await harness({
			designer: (_prompt, call) =>
				call === 0
					? breakdown([
							part("Export", ["src/export"]),
							part("Export tests", ["src/export/test.ts"]),
						])
					: plan(),
		});
		const task = await h.designed(await h.create());
		const [first, second] = h.designerPrompts();
		expect(first).toContain("SPLITTING (optional)");
		expect(first).toContain(
			"one change whose pieces can be built in parallel but merge together",
		);
		expect(second).not.toContain("SPLITTING (optional)");
		expect(second).toContain("Factory cannot use the breakdown");
		// Never stopped: the request is planned as one card.
		expect(task.error).toBeUndefined();
		expect(task.factoryDesignProgress).toMatchObject({
			phase: "complete",
			splitWithdrawn: expect.stringContaining("both change src/export"),
		});
		expect(task.factoryDesignProgress?.split).toBeUndefined();
		expect(task.instructions).toBe("Proposed brief");
		expect(h.manager.getFactorySplitCounts()).toMatchObject({
			offered: 1,
			proposed: 0,
		});
	});

	it.each([
		["the setting is off", "off"],
		["the person kept it as one card", "never"],
		["it is a rule card", "rule"],
		["it ran before", "ran"],
	] as const)("is not offered when %s", async (_label, condition) => {
		const h = await harness();
		if (condition === "off") h.manager.setFactorySplitLargeWork(false);
		const task = await h.create(
			"Rule",
			condition === "never"
				? { split: "never" }
				: condition === "rule"
					? { intake: { source: FACTORY_REPO_RULES_SOURCE, key: "rule" } }
					: {},
		);
		if (condition === "ran")
			h.store().updateTaskState(task.taskId, { lastRunId: "run_earlier" });
		await h.designed(task);
		expect(h.designerPrompts()[0]).not.toContain("SPLITTING");
	});

	it("keeps the breakdown of a card the manager chat filed, though its answer also rates the review", async () => {
		const h = await harness({
			designer: (_prompt, call) =>
				call === 0
					? {
							...breakdown(),
							reviewSelection: {
								impact: "local",
								size: "trivial",
								rationale: "Small documentation changes",
								affectedPaths: ["src/export"],
								consumers: [],
								planReviewerIndices: [],
								reviewerIndices: [0],
							},
						}
					: plan(),
		});
		const filed = await createFactoryTool({
			manager: h.manager,
			listProjects: async () => [h.workspaceRoot],
			resolveSessionDefaults: async () => ({
				modelSelection: { providerId: "anthropic", modelId: "chat-model" },
				interactive: true,
				manager: true,
			}),
		}).execute(
			{
				project: "repo",
				title: "Export, footer and report link",
				instructions:
					"Deliver these as separate pull requests: add the CSV export, fix the footer year, then link the export from reports once the export is merged.",
				start_scoping: false,
			},
			{ agentId: "manager-agent", iteration: 1, sessionId: "manager-chat" },
		);
		if (!filed.ok) throw new Error(filed.error.message);
		const task = await h.designed(await h.get(filed.task.taskId));
		expect(task.factory?.reviewMode).toBe("adaptive");
		expect(h.designerPrompts()[0]).toContain("SPLITTING (optional)");
		expect(h.designerPrompts()[0]).toContain("Also include reviewSelection");
		expect(task.factoryDesignProgress?.splitWithdrawn).toBeUndefined();
		expect(task.factoryDesignProgress?.split?.parts).toHaveLength(3);
		expect(h.designerPrompts()).toHaveLength(1);
	});
});

describe("approving a breakdown", () => {
	it("waits for a person even under automatic approval, and only a person approves it", async () => {
		const h = await harness({
			designer: (_prompt, call) => (call === 0 ? breakdown() : plan()),
		});
		const parent = await h.designed(await h.create());
		expect(parent).toMatchObject({ status: "pending_approval" });
		expect(parent.approvedRevision).toBeUndefined();
		expect(parent.factoryQueued).toBeUndefined();
		await expect(
			h.manager.approveTask(parent.taskId, { kind: "user" }, parent.revision),
		).rejects.toThrow(/Approve the breakdown/);
		await expect(
			h.manager.approveFactorySplit(parent.taskId, parent.revision, {
				kind: "agent",
				id: "manager",
			}),
		).rejects.toThrow(/Only a person/);
		await expect(
			h.manager.approveFactorySplit(
				parent.taskId,
				parent.revision,
				{ kind: "user" },
				[0],
			),
		).rejects.toThrow(/Part 3 waits for part 1/);
	});

	it("completes the parent with its record in one write and creates each kept part once, with the parent's whole config", async () => {
		const h = await harness({
			designer: (_prompt, call) => (call === 0 ? breakdown() : plan()),
		});
		const parent = await h.designed(
			await h.create(
				"Reports and footer",
				{
					humanStamp: "always",
					minCodeReviewers: 2,
					requireIndependentReview: true,
					pullRequestReady: "never",
					workflowSource: "repository",
					baseBranch: "main",
					intake: { source: "agent", key: "reports" },
				},
				{ factoryPriority: { level: "high", by: "person" } },
			),
		);
		const first = await h.manager.approveFactorySplit(
			parent.taskId,
			parent.revision,
			{ kind: "user", id: "desktop" },
			[1],
		);
		expect(first.task).toMatchObject({
			status: "completed",
			factorySplit: {
				revision: parent.revision,
				createdAt: expect.any(String),
				parts: [{}, { omitted: true }, {}],
			},
		});
		expect(first.task.factoryQueued).toBeUndefined();
		// The record replaces the proposal: list replies carry the parts once.
		expect(first.task.factoryDesignProgress?.split).toBeUndefined();
		expect(first.parts.map((entry) => entry.title)).toEqual([
			"Add CSV export",
			"Link the export from reports",
		]);
		const [exporting, linking] = first.parts as [
			AgendaTaskRecord,
			AgendaTaskRecord,
		];
		for (const created of first.parts) {
			expect(created).toMatchObject({
				factoryParentTaskId: parent.taskId,
				factoryQueued: "design",
				factoryPriority: { level: "high", by: "person" },
				factory: {
					humanStamp: "always",
					minCodeReviewers: 2,
					requireIndependentReview: true,
					pullRequestReady: "never",
					workflowSource: "repository",
					baseBranch: "main",
					publishPullRequest: true,
					// Filed by an agent: its parts may conclude no build is needed.
					triage: true,
					checks: [],
				},
			});
			expect(created.factory?.intake).toBeUndefined();
			expect(created.originTaskId).toBeUndefined();
		}
		expect(linking.factoryBlockedBy).toEqual({
			taskIds: [exporting.taskId],
			met: {},
		});
		expect(exporting.factoryBlockedBy).toBeUndefined();

		const again = await h.manager.approveFactorySplit(
			parent.taskId,
			parent.revision,
			{ kind: "user" },
		);
		expect(again.parts.map((entry) => entry.taskId)).toEqual(
			first.parts.map((entry) => entry.taskId),
		);
		expect((await h.manager.listTasks({ factoryOnly: true })).length).toBe(3);
		expect(h.manager.getFactorySplitCounts()).toEqual({
			offered: 1,
			proposed: 1,
			approved: 1,
			kept_whole: 0,
		});
		// The parent is never scoped, approved or edited again.
		await expect(h.manager.queueFactoryScoping(parent.taskId)).rejects.toThrow(
			/before feature execution/,
		);
		await expect(
			h.manager.approveTask(parent.taskId, { kind: "user" }, parent.revision),
		).rejects.toThrow(/split into parts/);
		await expect(
			h.manager.updateTask({
				taskId: parent.taskId,
				expectedRevision: parent.revision,
				instructions: "Changed",
				updatedBy: { kind: "user" },
			}),
		).rejects.toThrow(/cannot be edited from completed/);
	});

	it("keeps a card whole on request and scopes it again without the offer", async () => {
		const h = await harness({
			designer: (_prompt, call) => (call === 0 ? breakdown() : plan()),
		});
		const parent = await h.designed(await h.create());
		const kept = await h.manager.keepFactoryCardWhole(
			parent.taskId,
			parent.revision,
			{ kind: "user" },
		);
		expect(kept.factory?.split).toBe("never");
		expect(kept.factoryQueued).toBe("design");
		expect(h.manager.getFactorySplitCounts().kept_whole).toBe(1);
		// Not a general re-scope: a card with no breakdown waiting is refused.
		const held = await h.manager.holdFactoryTask(
			(await h.create("Other")).taskId,
		);
		await expect(
			h.manager.keepFactoryCardWhole(held.taskId, held.revision, {
				kind: "user",
			}),
		).rejects.toThrow(/no breakdown waiting for a decision/);
		expect((await h.get(held.taskId)).factory?.split).toBeUndefined();
	});

	it("refuses a part the manager did not create, even at a listed id, and leaves a card at a part's id alone without failing approval or Hub start", async () => {
		const h = await harness();
		const { parent, parts } = await h.approvedSplit();
		await expect(
			h.create("Forged", {}, { factoryParentTaskId: parent.taskId }),
		).rejects.toThrow(/only by approving its parent's breakdown/);
		// The breakdown's creation was interrupted after a part's card was
		// deleted; a client tries to fill the listed id with its own card.
		const [first] = parts as [AgendaTaskRecord];
		await h.manager.deleteTask(first.taskId, { kind: "user" }, first.revision);
		const unfinished = () =>
			h.store().setFactorySplit(parent.taskId, {
				...(parent.factorySplit as NonNullable<
					AgendaTaskRecord["factorySplit"]
				>),
				createdAt: undefined,
			});
		unfinished();
		await expect(
			h.create(
				"Forged",
				{},
				{ taskId: first.taskId, factoryParentTaskId: parent.taskId },
			),
		).rejects.toThrow(/only by approving its parent's breakdown/);
		await h.create("Unrelated", {}, { taskId: first.taskId });
		const again = await h.manager.approveFactorySplit(
			parent.taskId,
			parent.revision,
			{ kind: "user" },
		);
		expect(again.parts.map((entry) => entry.taskId)).not.toContain(
			first.taskId,
		);
		expect(again.task.factorySplit?.createdAt).toEqual(expect.any(String));
		expect((await h.get(first.taskId)).factoryParentTaskId).toBeUndefined();
		unfinished();
		const manager = await h.reopen();
		const logError = vi.spyOn(
			manager as unknown as { logError: () => void },
			"logError",
		);
		await manager.start();
		expect(logError).not.toHaveBeenCalledWith(
			"factory split parts not created",
			expect.anything(),
			expect.anything(),
		);
		expect((await h.get(parent.taskId)).factorySplit?.createdAt).toEqual(
			expect.any(String),
		);
	});
});

describe("a parent and its parts", () => {
	it("refuses archive and delete while a part is open; cancels only the remaining parts; delete unlinks", async () => {
		const h = await harness();
		const { parent, parts } = await h.approvedSplit();
		const [exporting, footer, linking] = parts as [
			AgendaTaskRecord,
			AgendaTaskRecord,
			AgendaTaskRecord,
		];
		await expect(
			h.manager.archiveTask(parent.taskId, { kind: "user" }, parent.revision),
		).rejects.toThrow(/still open/);
		await expect(
			h.manager.deleteTask(parent.taskId, { kind: "user" }, parent.revision),
		).rejects.toThrow(/still open/);
		h.deliver(exporting.taskId);
		await expect(
			h.manager.cancelFactoryParts(parent.taskId, { kind: "agent" }),
		).rejects.toThrow(/Only a person/);
		const { cancelled } = await h.manager.cancelFactoryParts(parent.taskId, {
			kind: "user",
		});
		expect(cancelled.map((entry) => entry.taskId).sort()).toEqual(
			[footer.taskId, linking.taskId].sort(),
		);
		expect((await h.get(exporting.taskId)).status).toBe("completed");
		expect((await h.get(parent.taskId)).factorySplit?.cancelledAt).toEqual(
			expect.any(String),
		);
		await h.manager.deleteTask(
			parent.taskId,
			{ kind: "user" },
			parent.revision,
		);
		for (const entry of parts)
			expect((await h.get(entry.taskId)).factoryParentTaskId).toBeUndefined();
	});

	it("reports parts, the parent and the wait in plain words, and the status tool cannot start a waiting part", async () => {
		const h = await harness();
		const { parent, parts } = await h.approvedSplit();
		const [exporting, , linking] = parts as [
			AgendaTaskRecord,
			AgendaTaskRecord,
			AgendaTaskRecord,
		];
		h.deliver(exporting.taskId);
		const tool = createFactoryStatusTool({
			manager: h.manager,
			resolveSessionDefaults: async () => ({
				sessionId: "s",
				workspaceRoot: h.workspaceRoot,
			}),
		} as never);
		const status = async (input: Record<string, unknown>) =>
			(await tool.execute(
				input as never,
				{
					agentId: "a",
					conversationId: "c",
					iteration: 1,
					sessionId: "s",
				} as never,
			)) as unknown as Record<string, unknown>;
		const id = (task: AgendaTaskRecord) => `F${task.factoryNumber}`;
		expect(await status({ task_id: id(parent) })).toMatchObject({
			ok: true,
			cards: [
				{
					stage: "Tracking its parts",
					parts: `1 of 3 delivered; ${id(linking)} waits for ${id(exporting)} to merge`,
				},
			],
		});
		expect(await status({ task_id: id(linking) })).toMatchObject({
			cards: [
				{
					stage: `Waiting for ${id(exporting)} to merge`,
					parent: id(parent),
					waitingFor: [id(exporting)],
				},
			],
		});
		expect(
			await status({ task_id: id(linking), action: "start" }),
		).toMatchObject({
			ok: false,
			error: {
				message: expect.stringMatching(/only the user can start it anyway/),
			},
		});
	});
});

describe("ordered parts", () => {
	it("holds no slot while waiting, and latches the merge while paused, at the daily limit and with every slot busy, even after the earlier part's follow-up stopped", async () => {
		const h = await harness();
		const { parts } = await h.approvedSplit();
		const [exporting, footer, linking] = parts as [
			AgendaTaskRecord,
			AgendaTaskRecord,
			AgendaTaskRecord,
		];
		// A person pushed a fix-up to the draft, so PR follow-up stopped.
		h.deliver(exporting.taskId, {
			phase: "blocked",
			error: "The PR branch changed outside this feature.",
		});
		h.manager.setFactoryConcurrency(1);
		await h.internals().pumpFactoryQueue();
		await vi.waitFor(async () =>
			expect((await h.get(footer.taskId)).factoryDesignProgress?.phase).toBe(
				"complete",
			),
		);
		expect((await h.get(linking.taskId)).factoryDesignProgress).toBeUndefined();
		expect((await h.get(linking.taskId)).factoryQueued).toBe("design");

		const calls = h.gh("OPEN");
		await h.internals().checkFactoryMerges();
		await h.internals().checkFactoryMerges();
		expect(calls()).toEqual([`pr view 41 --repo o/r --json state,baseRefName`]);
		expect((await h.get(linking.taskId)).factoryBlockedBy?.met).toEqual({});

		h.gh("MERGED");
		h.internals().factoryMergeChecks.clear();
		h.manager.setFactoryPaused(true);
		h.internals().factorySpendingLimitReached = true;
		h.internals().factoryControllers.set("busy", {});
		await h.internals().checkFactoryMerges();
		h.internals().factoryControllers.delete("busy");
		expect((await h.get(linking.taskId)).factoryBlockedBy?.met).toEqual({
			[exporting.taskId]: { at: expect.any(String), prUrl: PR },
		});

		// Latched for good: archiving the earlier part later changes nothing.
		const earlier = await h.get(exporting.taskId);
		await h.manager.archiveTask(
			earlier.taskId,
			{ kind: "user" },
			earlier.revision,
		);
		h.internals().factorySpendingLimitReached = false;
		h.manager.setFactoryPaused(false);
		const scoped = await h.designed(await h.get(linking.taskId));
		expect(scoped.factoryDesignProgress?.phase).toBe("complete");
		const prompt = h.designerPrompts().at(-1);
		expect(prompt).toContain("MERGED EARLIER PARTS");
		expect(prompt).toContain(PR);
		expect(prompt).not.toContain("SPLITTING");
	});

	it("asks the person when the earlier pull request closed unmerged; only a person starts it anyway", async () => {
		const h = await harness();
		const { parts } = await h.approvedSplit();
		const [exporting, , linking] = parts as [
			AgendaTaskRecord,
			AgendaTaskRecord,
			AgendaTaskRecord,
		];
		h.deliver(exporting.taskId, {
			pullRequestOutcome: { state: "closed", headChanged: false, at: "t" },
		});
		await expect(h.manager.startFactoryDesign(linking.taskId)).rejects.toThrow(
			`F${exporting.factoryNumber} was closed without merging. Start anyway or cancel.`,
		);
		await expect(
			h.manager.startFactoryPartAnyway(linking.taskId, linking.revision, {
				kind: "agent",
			}),
		).rejects.toThrow(/Only a person/);
		const started = await h.manager.startFactoryPartAnyway(
			linking.taskId,
			linking.revision,
			{ kind: "user" },
		);
		expect(started.factoryBlockedBy?.startedAnyway).toEqual({
			at: expect.any(String),
		});
		expect((await h.designed(started)).factoryDesignProgress?.phase).toBe(
			"complete",
		);
	});

	it("starts nothing and loses nothing across a restart", async () => {
		const h = await harness();
		const { parts } = await h.approvedSplit();
		const [exporting, , linking] = parts as [
			AgendaTaskRecord,
			AgendaTaskRecord,
			AgendaTaskRecord,
		];
		h.deliver(exporting.taskId);
		h.gh("OPEN");
		const designs = h.designerPrompts().length;
		const manager = await h.reopen();
		await manager.start();
		await h.internals().pumpFactoryQueue();
		await new Promise((resolve) => setTimeout(resolve, 50));
		const waiting = await h.get(linking.taskId);
		expect(waiting).toMatchObject({
			factoryQueued: "design",
			factoryBlockedBy: { taskIds: [exporting.taskId], met: {} },
		});
		expect(waiting.factoryDesignProgress).toBeUndefined();
		// Only the footer part (not waiting) was scoped after the restart.
		expect(
			h
				.designerPrompts()
				.slice(designs)
				.filter((prompt) =>
					prompt.includes("FEATURE REQUEST:\nBrief for Link the export"),
				),
		).toEqual([]);
	});

	it("builds a released part from origin's default branch with the merged work", async () => {
		const h = await harness();
		const { parts } = await h.approvedSplit();
		const [exporting, , linking] = parts as [
			AgendaTaskRecord,
			AgendaTaskRecord,
			AgendaTaskRecord,
		];
		h.deliver(exporting.taskId);
		// The person merged the earlier part's pull request on origin.
		const clone = join(h.root, "merger");
		h.git(h.root, "clone", "-q", join(h.root, "origin.git"), clone);
		h.git(clone, "config", "user.email", "person@example.test");
		h.git(clone, "config", "user.name", "Person");
		writeFileSync(join(clone, "export.ts"), "export const csv = true;\n");
		h.git(clone, "add", ".");
		h.git(clone, "commit", "-q", "-m", "Add CSV export");
		const merged = h.git(clone, "rev-parse", "HEAD");
		h.git(clone, "push", "-q", "origin", "main");
		h.gh("MERGED");
		await h.internals().checkFactoryMerges();

		const workflow = vi
			.spyOn(factoryWorkflow, "runFactoryWorkflow")
			.mockImplementation(async () => ({ status: "completed" }));
		const scoped = await h.designed(await h.get(linking.taskId));
		const approved =
			scoped.status === "approved"
				? scoped
				: await h.manager.approveTask(
						scoped.taskId,
						{ kind: "user" },
						scoped.revision,
					);
		await h.manager.runTask(
			approved.taskId,
			{ kind: "user" },
			approved.revision,
		);
		await vi.waitFor(() => expect(workflow).toHaveBeenCalled());
		const workspace = workflow.mock.calls[0]?.[0].state.workspace;
		expect(workspace).toMatchObject({ baseBranch: "main", baseCommit: merged });
		expect(h.git(workspace?.path ?? "", "log", "-1", "--format=%s")).toBe(
			"Add CSV export",
		);
	});
});

describe("settling a waiting part", () => {
	const statusTool = (manager: AgendaTaskManager, workspaceRoot: string) => {
		const tool = createFactoryStatusTool({
			manager,
			resolveSessionDefaults: async () => ({ sessionId: "s", workspaceRoot }),
		} as never);
		return async (input: Record<string, unknown>) =>
			(await tool.execute(
				input as never,
				{
					agentId: "a",
					conversationId: "c",
					iteration: 1,
					sessionId: "s",
				} as never,
			)) as unknown as { cards: Record<string, unknown>[] };
	};

	it("latches a merge PR follow-up recorded before the part is scoped, so its scoper sees the merged part", async () => {
		const h = await harness();
		const { parts } = await h.approvedSplit();
		const [exporting, , linking] = parts as [
			AgendaTaskRecord,
			AgendaTaskRecord,
			AgendaTaskRecord,
		];
		h.deliver(exporting.taskId, {
			pullRequestOutcome: {
				state: "merged",
				headChanged: false,
				at: "t",
				baseBranch: "main",
			},
		});
		const scoped = await h.designed(await h.get(linking.taskId));
		expect(scoped.factoryBlockedBy?.met).toEqual({
			[exporting.taskId]: { at: expect.any(String), prUrl: PR },
		});
		const prompt = h.designerPrompts().at(-1);
		expect(prompt).toContain("MERGED EARLIER PARTS");
		expect(prompt).toContain(PR);
	});

	it("latches as soon as PR follow-up records the merge, even while Factory is paused", async () => {
		const h = await harness();
		const { parts } = await h.approvedSplit();
		const [exporting, , linking] = parts as [
			AgendaTaskRecord,
			AgendaTaskRecord,
			AgendaTaskRecord,
		];
		const run = h.deliver(exporting.taskId);
		vi.spyOn(
			factoryPullRequest,
			"runFactoryPullRequestFollowup",
		).mockImplementation(async ({ state, save }) => {
			save({
				...state,
				pullRequestOutcome: {
					state: "merged",
					headChanged: false,
					at: "t",
					baseBranch: "main",
				},
			});
			return "closed";
		});
		h.manager.setFactoryPaused(true);
		const internals = h.internals() as unknown as {
			factoryOwner: string;
			finishFactoryFollowup(
				task: AgendaTaskRecord,
				run: unknown,
				state: unknown,
				active: { controller: AbortController; sessions: Set<string> },
			): Promise<void>;
		};
		// PR follow-up holds the run's claim while it polls.
		h.store().claimRun(
			run.runId,
			internals.factoryOwner,
			new Date(Date.now() + 60_000).toISOString(),
		);
		await internals.finishFactoryFollowup(
			await h.get(exporting.taskId),
			run,
			run.factory,
			{ controller: new AbortController(), sessions: new Set() },
		);
		expect((await h.get(linking.taskId)).factoryBlockedBy?.met).toEqual({
			[exporting.taskId]: { at: expect.any(String), prUrl: PR },
		});
	});

	it("lists every card a split links to the listed ones, beyond the limit", async () => {
		const h = await harness();
		const { parent, parts } = await h.approvedSplit();
		const ids = (tasks: AgendaTaskRecord[]) =>
			tasks.map((task) => task.taskId).sort();
		const all = ids([parent, ...parts]);
		// The oldest card is the parent; its parts come with it.
		expect(
			ids(await h.manager.listTasks({ limit: 1, factoryLinks: true })),
		).toEqual(all);
		// A part brings its parent, and through it the other parts.
		expect(
			ids(
				await h.manager.listTasks({
					statuses: ["pending_approval", "approved"],
					limit: 1,
					factoryLinks: true,
				}),
			),
		).toEqual(all);
		expect(await h.manager.listTasks({ limit: 1 })).toHaveLength(1);
	});

	it("asks the person when an earlier part was archived before it opened a pull request, and the status tool agrees", async () => {
		const h = await harness();
		const { parent, parts } = await h.approvedSplit();
		const [exporting, , linking] = parts as [
			AgendaTaskRecord,
			AgendaTaskRecord,
			AgendaTaskRecord,
		];
		await h.manager.archiveTask(
			exporting.taskId,
			{ kind: "user" },
			exporting.revision,
		);
		const id = (task: AgendaTaskRecord) => `F${task.factoryNumber}`;
		await expect(h.manager.startFactoryDesign(linking.taskId)).rejects.toThrow(
			`${id(exporting)} was archived before it opened a pull request. Start anyway or cancel.`,
		);
		const status = statusTool(h.manager, h.workspaceRoot);
		expect((await status({ task_id: id(linking) })).cards[0]).toMatchObject({
			stage: "Waiting for a decision to start",
		});
		expect((await status({ task_id: id(parent) })).cards[0]).toMatchObject({
			parts: expect.stringMatching(/^0 of 3 delivered, 1 closed/),
		});
	});

	it("asks the person, on both paths, when the earlier pull request merged into another branch, and reads a settled pull request no more", async () => {
		const h = await harness();
		const { parts } = await h.approvedSplit();
		const [exporting, , linking] = parts as [
			AgendaTaskRecord,
			AgendaTaskRecord,
			AgendaTaskRecord,
		];
		const reason = `F${exporting.factoryNumber} merged into release, not main. Start anyway or cancel.`;
		h.deliver(exporting.taskId);
		const calls = h.gh("MERGED", "release");
		await h.internals().checkFactoryMerges();
		expect((await h.get(linking.taskId)).factoryBlockedBy).toMatchObject({
			met: {},
			mergedElsewhere: {
				[exporting.taskId]: { baseBranch: "release", expected: "main" },
			},
		});
		await expect(h.manager.startFactoryDesign(linking.taskId)).rejects.toThrow(
			reason,
		);
		h.internals().factoryMergeChecks.clear();
		await h.internals().checkFactoryMerges();
		expect(calls()).toHaveLength(1);

		// PR follow-up recorded the same merge on another breakdown.
		const other = await harness();
		const split = await other.approvedSplit();
		const [first, , waiting] = split.parts as [
			AgendaTaskRecord,
			AgendaTaskRecord,
			AgendaTaskRecord,
		];
		other.deliver(first.taskId, {
			pullRequestOutcome: {
				state: "merged",
				headChanged: false,
				at: "t",
				baseBranch: "release",
			},
		});
		await expect(
			other.manager.startFactoryDesign(waiting.taskId),
		).rejects.toThrow(
			`F${first.factoryNumber} merged into release, not main. Start anyway or cancel.`,
		);
		expect((await other.get(waiting.taskId)).factoryBlockedBy?.met).toEqual({});
	});

	it("latches a held part too, and forgets a pull request once nothing waits on it", async () => {
		const h = await harness();
		const { parts } = await h.approvedSplit();
		const [exporting, , linking] = parts as [
			AgendaTaskRecord,
			AgendaTaskRecord,
			AgendaTaskRecord,
		];
		h.deliver(exporting.taskId);
		await h.manager.holdFactoryTask(linking.taskId);
		h.gh("MERGED");
		await h.internals().checkFactoryMerges();
		expect((await h.get(linking.taskId)).factoryBlockedBy?.met).toEqual({
			[exporting.taskId]: { at: expect.any(String), prUrl: PR },
		});
		await h.internals().checkFactoryMerges();
		expect(h.internals().factoryMergeChecks.size).toBe(0);
	});

	it("asks the person after repeated failed reads, and stops asking once a read succeeds", async () => {
		const h = await harness();
		const { parts } = await h.approvedSplit();
		const [exporting, , linking] = parts as [
			AgendaTaskRecord,
			AgendaTaskRecord,
			AgendaTaskRecord,
		];
		h.deliver(exporting.taskId);
		h.gh("signed out");
		const read = async () => {
			h.internals().factoryMergeChecks.forEach((check) => {
				(check as { at: number }).at = 0;
			});
			await h.internals().checkFactoryMerges();
			return (await h.get(linking.taskId)).factoryBlockedBy;
		};
		await read();
		expect((await read())?.unreadable).toBeUndefined();
		expect((await read())?.unreadable).toEqual({
			[exporting.taskId]: { at: expect.any(String), prUrl: PR },
		});
		await expect(h.manager.startFactoryDesign(linking.taskId)).rejects.toThrow(
			`Factory cannot check whether F${exporting.factoryNumber}'s pull request merged (gh is missing, signed out or cannot read it). Start anyway or cancel.`,
		);
		h.gh("OPEN");
		expect(await read()).toEqual({ taskIds: [exporting.taskId], met: {} });
	});

	it("stops a merge read in flight when the Hub stops", async () => {
		const h = await harness();
		const { parts } = await h.approvedSplit();
		h.deliver((parts[0] as AgendaTaskRecord).taskId);
		const calls = h.gh("slow");
		const check = h.internals().checkFactoryMerges();
		await vi.waitFor(() => expect(calls()).toHaveLength(1));
		const started = Date.now();
		await h.manager.dispose();
		await check;
		expect(Date.now() - started).toBeLessThan(5_000);
	});

	it("does not expire a part while it waits, and gives it time once its turn comes", async () => {
		const h = await harness();
		const { parts } = await h.approvedSplit();
		const [exporting, , linking] = parts as [
			AgendaTaskRecord,
			AgendaTaskRecord,
			AgendaTaskRecord,
		];
		const later = Date.now() + 60 * 86_400_000;
		vi.useFakeTimers({ now: later, toFake: ["Date"] });
		try {
			h.internals().expireTasks();
			expect((await h.get(linking.taskId)).status).toBe("pending_approval");
			expect((await h.get(exporting.taskId)).status).toBe("expired");
			h.store().setFactoryBlockedBy(linking.taskId, {
				taskIds: [exporting.taskId],
				met: {
					[exporting.taskId]: { at: new Date(later).toISOString(), prUrl: PR },
				},
			});
			h.internals().expireTasks();
			expect((await h.get(linking.taskId)).status).toBe("pending_approval");
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("a parent whose parts all closed", () => {
	it("reads as closed, not delivered, and does not block filing the same request again", async () => {
		const h = await harness();
		const { parent } = await h.approvedSplit();
		await h.manager.cancelFactoryParts(parent.taskId, { kind: "user" });
		const tool = createFactoryStatusTool({
			manager: h.manager,
			resolveSessionDefaults: async () => ({
				sessionId: "s",
				workspaceRoot: h.workspaceRoot,
			}),
		} as never);
		const status = (await tool.execute(
			{ task_id: `F${parent.factoryNumber}` } as never,
			{
				agentId: "a",
				conversationId: "c",
				iteration: 1,
				sessionId: "s",
			} as never,
		)) as unknown as { cards: Record<string, unknown>[] };
		expect(status.cards[0]).toMatchObject({
			stage: "Parts closed",
			parts: "0 of 3 delivered, 3 closed",
		});
		const again = await h.manager.fileFactoryCard({
			title: parent.title,
			type: "follow-up",
			instructions: parent.instructions,
			scope: "workspace",
			workspaceRoot: h.workspaceRoot,
			expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
			createdBy: { kind: "user" },
			queueFactoryDesign: false,
			factory: parent.factory,
		});
		expect(again.duplicateOf).toBeUndefined();
		expect(again.task.taskId).not.toBe(parent.taskId);
	});
});
