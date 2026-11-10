import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
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
import { HubAgendaTaskCommandService } from "../hub/server/task-command-service";
import {
	AgendaTaskManager,
	type AgendaTaskRuntime,
} from "./agenda-task-manager";
import * as factoryLocal from "./factory-local";
import { runFactoryCommand } from "./factory-local";
import * as factoryPullRequest from "./factory-pull-request";
import {
	type FactoryPullRequestSnapshot,
	runFactoryPullRequestFollowup,
} from "./factory-pull-request";
import { runFactoryWorkflow } from "./factory-workflow";
import { SqliteAgendaTaskStore } from "./store/sqlite-task-store";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const dispose of cleanup.splice(0)) await dispose();
});
function harness(
	options: {
		review?: string;
		reviewFailures?: number;
		reviewerError?: string;
		verifier?: (task: AgendaTaskRecord) => Promise<string>;
		failures?: number;
		hold?: boolean;
		triage?: "repair" | "ignore" | "needs_user";
	} = {},
) {
	const root = mkdtempSync(join(tmpdir(), "cline-factory-workflow-"));
	const repo = join(root, "repo");
	execFileSync("git", ["init", "-b", "main", repo]);
	execFileSync("git", ["-C", repo, "config", "user.name", "Test"]);
	execFileSync("git", [
		"-C",
		repo,
		"config",
		"user.email",
		"test@example.invalid",
	]);
	writeFileSync(join(repo, "feature.txt"), "before\n");
	writeFileSync(join(repo, ".gitignore"), ".evidence/\n");
	execFileSync("git", ["-C", repo, "add", "."]);
	execFileSync("git", ["-C", repo, "commit", "-m", "Initial"]);
	let sessionIndex = 0;
	const roles = new Map<string, string>();
	let builds = 0;
	let reviews = 0;
	let release: (() => void) | undefined;
	const runtime: AgendaTaskRuntime = {
		reconcileSession: vi.fn<NonNullable<AgendaTaskRuntime["reconcileSession"]>>(
			async () => ({
				status: "failed",
				error: "Interrupted test session",
			}),
		),
		startSession: vi.fn(async (_task, _run, _client, config) => {
			const sessionId = config?.sessionId ?? `session_${++sessionIndex}`;
			roles.set(sessionId, config?.factoryRole ?? "builder");
			return { sessionId };
		}),
		runSession: vi.fn<AgendaTaskRuntime["runSession"]>(async (id, task) => {
			if (roles.get(id) === "verifier")
				return { status: "completed", summary: await options.verifier?.(task) };
			if (roles.get(id) === "reviewer") {
				if (task.instructions.startsWith("Triage this new PR feedback"))
					return {
						status: "completed",
						summary: JSON.stringify({
							action: options.triage ?? "repair",
							summary: "Review requested an edge case.",
							instructions:
								"Handle the edge case without changing the approved scope.",
						}),
					};
				reviews++;
				if (options.reviewerError)
					return { status: "failed", error: options.reviewerError };
				return {
					status: "completed",
					summary:
						options.review ??
						JSON.stringify({
							verdict:
								reviews <= (options.reviewFailures ?? 0)
									? "changes_requested"
									: "pass",
							findings:
								reviews <= (options.reviewFailures ?? 0)
									? ["Fix the missing edge case"]
									: [],
							summary: "Reviewed behavior and maintainability.",
						}),
				};
			}
			builds++;
			if (options.triage && builds > 1)
				writeFileSync(
					join(task.cwd ?? "", "followup.txt"),
					"Edge case handled\n",
				);
			writeFileSync(
				join(task.cwd ?? "", "feature.txt"),
				builds <= (options.failures ?? 0) ? "wrong\n" : "after\n",
			);
			if (options.hold)
				await new Promise<void>((resolve) => {
					release = resolve;
				});
			return { status: "completed", summary: "Implemented" };
		}),
		abortSession: vi.fn(async () => release?.()),
	};
	const manager = new AgendaTaskManager({
		runtime,
		dbPath: join(root, "tasks.db"),
		globalSpecsDir: join(root, "specs"),
		watchFiles: false,
		automationEnabled: false,
	});
	cleanup.push(async () => {
		await manager.dispose();
		rmSync(root, { recursive: true, force: true });
	});
	const create = async (
		maxRepairRounds = 2,
		factory: Partial<FactoryTaskConfig> = {},
	) =>
		manager.createTask({
			title: "Update feature",
			type: "follow-up",
			instructions: "Acceptance: feature.txt contains after.",
			scope: "workspace",
			workspaceRoot: repo,
			expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
			createdBy: { kind: "user" },
			factory: factoryTaskConfigSchema.parse({
				maxRepairRounds,
				checks: [
					{
						name: "Feature behavior",
						kind: "api",
						command: `node -e "if(require('fs').readFileSync('feature.txt','utf8').trim()!=='after')process.exit(1)"`,
					},
				],
				...factory,
			}),
		});
	const start = async (task: AgendaTaskRecord) => {
		await manager.approveTask(task.taskId, { kind: "user" }, task.revision);
		return manager.runTask(
			task.taskId,
			{ kind: "user" },
			task.revision,
			"test",
		);
	};
	return {
		manager,
		root,
		create,
		start,
		runtime,
		repo,
		builds: () => builds,
		reviews: () => reviews,
	};
}

async function followupHarness(
	triage: "repair" | "ignore" | "needs_user" = "repair",
) {
	const h = harness({ triage });
	const task = await h.create(2, {
		agents: {
			designer: {},
			planReviewers: [],
			implementer: {
				modelSelection: {
					providerId: "test-provider",
					modelId: "followup-writer",
				},
			},
			reviewers: [
				{
					modelSelection: {
						providerId: "test-provider",
						modelId: "followup-reviewer",
					},
				},
			],
		},
	});
	await h.start(task);
	await vi.waitFor(
		async () =>
			expect((await h.manager.getTask(task.taskId))?.status).toBe("completed"),
		{ timeout: 15000 },
	);
	const run = h.manager.getTaskRuns(task.taskId)[0];
	if (!run?.factory?.candidate?.commit)
		throw new Error("Missing verified candidate");
	let state: FactoryRunState = {
		...run.factory,
		phase: "watching",
		pullRequestUrl: "https://github.com/example/project/pull/1",
		pullRequestWatch: {
			headCommit: run.factory.candidate?.commit,
			handledFeedbackIds: [],
		},
	};
	let remote: FactoryPullRequestSnapshot = {
		state: "OPEN",
		headCommit: run.factory.candidate?.commit,
		branch: state.workspace.branch,
		feedback: [{ id: "review-1", text: "Handle empty input.", trusted: true }],
		commentBodies: [],
	};
	const remotePath = join(h.root, "remote.git");
	execFileSync("git", ["init", "--bare", remotePath], { stdio: "ignore" });
	execFileSync("git", [
		"-C",
		state.workspace.path,
		"remote",
		"add",
		"origin",
		remotePath,
	]);
	execFileSync(
		"git",
		[
			"-C",
			state.workspace.path,
			"push",
			"origin",
			`${state.candidate?.commit}:refs/heads/${state.workspace.branch}`,
		],
		{ stdio: "ignore" },
	);
	let loseReplyAcknowledgement = false;
	let headChangesDuringRepair = false;
	const commands = vi.fn<typeof runFactoryCommand>(async (input) => {
		if (input.file === "git") {
			expect(input.args).toEqual([
				"push",
				"origin",
				`${state.candidate?.commit}:refs/heads/${state.workspace.branch}`,
			]);
			const result = await runFactoryCommand(input);
			if (result.exitCode !== 0) throw new Error(result.output);
			remote = {
				...remote,
				headCommit: execFileSync(
					"git",
					[
						"--git-dir",
						remotePath,
						"rev-parse",
						`refs/heads/${state.workspace.branch}`,
					],
					{ encoding: "utf8" },
				).trim(),
			};
		} else {
			const bodyFile = input.args.at(-1);
			if (!bodyFile) throw new Error("Missing reply body");
			remote.commentBodies.push(readFileSync(bodyFile, "utf8"));
			if (loseReplyAcknowledgement) {
				loseReplyAcknowledgement = false;
				throw new Error("Lost reply acknowledgement");
			}
		}
		return { exitCode: 0, output: "", truncated: false, timedOut: false };
	});
	const follow = (signal = new AbortController().signal) =>
		runFactoryPullRequestFollowup(
			{
				task: {
					...task,
					factory: factoryTaskConfigSchema.parse({
						...task.factory,
						publishPullRequest: true,
						watchPullRequest: true,
					}),
				},
				run,
				state,
				runtime: h.runtime,
				storageDir: h.root,
				signal,
				save: (updated) => {
					state = updated;
				},
				sessionStarted: () => {},
			},
			{
				run: commands,
				read: async () => ({
					...remote,
					headCommit:
						headChangesDuringRepair && h.builds() > 1
							? "human-commit"
							: remote.headCommit,
				}),
			},
		);
	return {
		...h,
		task,
		follow,
		commands,
		state: () => state,
		remote: () => remote,
		loseReplyAcknowledgement: () => {
			loseReplyAcknowledgement = true;
		},
		changeHeadDuringRepair: () => {
			headChangesDuringRepair = true;
		},
		exhaustBudget: (repairRound = 2) => {
			state = { ...state, repairRound };
		},
	};
}

describe("durable Factory execution", () => {
	it("publishes a reconciled draft after deterministic checks and before independent review", async () => {
		const h = harness();
		const task = await h.create();
		await h.start(task);
		await vi.waitFor(
			async () =>
				expect((await h.manager.getTask(task.taskId))?.status).toBe(
					"completed",
				),
			{ timeout: 15000 },
		);
		const run = h.manager.getTaskRuns(task.taskId)[0];
		if (!run?.factory?.candidate) throw new Error("Missing verified candidate");
		let state: FactoryRunState = {
			...run.factory,
			candidate: { ...run.factory.candidate, reviews: [] },
			attempts: run.factory.attempts?.filter(
				(attempt) => attempt.role === "builder",
			),
		};
		const events: string[] = [];
		const publish = vi
			.spyOn(factoryLocal, "publishFactoryPullRequest")
			.mockImplementation(async () => {
				expect(
					state.candidate?.checks.every((check) => check.status === "passed"),
				).toBe(true);
				events.push("draft");
				return "https://github.com/example/project/pull/1";
			});
		const original = h.runtime.runSession;
		h.runtime.runSession = vi.fn<AgendaTaskRuntime["runSession"]>(
			async (...args) => {
				events.push("review");
				return original(...args);
			},
		);
		try {
			const input = {
				task: {
					...task,
					factory: factoryTaskConfigSchema.parse({
						...task.factory,
						publishPullRequest: true,
					}),
				},
				run,
				state,
				runtime: h.runtime,
				storageDir: h.root,
				signal: new AbortController().signal,
				save: (next: FactoryRunState) => {
					state = next;
				},
				sessionStarted: () => {},
			};
			await runFactoryWorkflow(input);
			expect(events).toEqual(["draft", "review"]);
			expect(state.phase).toBe("watching");
			await runFactoryWorkflow({ ...input, state });
			expect(publish).toHaveBeenCalledTimes(1);
		} finally {
			publish.mockRestore();
		}
	});

	it("resumes an interrupted integration owner without charging the code repair twice", async () => {
		const h = harness();
		const original = h.runtime.runSession;
		let integrations = 0;
		h.runtime.runSession = vi.fn<AgendaTaskRuntime["runSession"]>(
			async (id, task, run) => {
				if (task.instructions.startsWith("Resolve only the pending merge")) {
					if (++integrations === 1)
						throw new Error("Integration transport interrupted");
					writeFileSync(join(task.cwd ?? "", "feature.txt"), "after\n");
					execFileSync("git", ["-C", task.cwd ?? "", "add", "feature.txt"]);
					return {
						status: "completed",
						summary: "Resolved both implementations",
					};
				}
				if (task.instructions.includes("Your isolated implementation unit:")) {
					writeFileSync(
						join(task.cwd ?? "", "feature.txt"),
						task.instructions.includes("unit-alpha") ? "alpha\n" : "beta\n",
					);
					return { status: "completed", summary: "Implemented unit" };
				}
				return original(id, task, run);
			},
		);
		const task = await h.create(1, {
			implementationUnits: [
				{ id: "alpha", instructions: "unit-alpha", dependsOn: [] },
				{ id: "beta", instructions: "unit-beta", dependsOn: [] },
			],
		});
		await h.start(task);
		await vi.waitFor(
			async () =>
				expect((await h.manager.getTask(task.taskId))?.status).toBe("failed"),
			{ timeout: 15000 },
		);
		expect(h.manager.getTaskRuns(task.taskId)[0]?.factory?.repairRound).toBe(1);
		await h.manager.runTask(
			task.taskId,
			{ kind: "user" },
			task.revision,
			"test",
		);
		await vi.waitFor(
			async () =>
				expect((await h.manager.getTask(task.taskId))?.status).toBe(
					"completed",
				),
			{ timeout: 15000 },
		);
		const state = h.manager.getTaskRuns(task.taskId)[0]?.factory;
		expect(state).toMatchObject({
			repairRound: 1,
			implementationIntegrated: true,
			candidate: { checks: [{ status: "passed" }] },
		});
		expect(state?.integrationRepairs).toHaveLength(1);
		expect(integrations).toBe(2);
		expect(
			readFileSync(join(state?.workspace.path ?? "", "feature.txt"), "utf8"),
		).toBe("after\n");
	});

	it("keeps a sampled defect blocking through watch toggles on the same candidate", async () => {
		const h = harness();
		const task = await h.create(2, { watchPullRequest: true });
		await h.start(task);
		await vi.waitFor(
			async () =>
				expect((await h.manager.getTask(task.taskId))?.status).toBe(
					"completed",
				),
			{ timeout: 15000 },
		);
		const run = h.manager.getTaskRuns(task.taskId)[0];
		const state = run?.factory;
		if (!state?.candidate) throw new Error("Missing verified candidate");
		const head = state.candidate.commit;
		const store = new SqliteAgendaTaskStore({
			dbPath: join(h.root, "tasks.db"),
		});
		try {
			store.updateRun(run.runId, {
				factory: {
					...state,
					pullRequestUrl: "https://github.com/example/project/pull/1",
					pullRequestWatch: {
						headCommit: head,
						handledFeedbackIds: [],
						paused: true,
					},
				},
			});
		} finally {
			store.close();
		}
		await h.manager.stampFactoryTask(task.taskId, head);
		await h.manager.recordFactoryAudit(task.taskId, "Empty input still fails");
		await h.manager.recordFactoryAudit(task.taskId);
		for (const enabled of [false, true, false]) {
			await h.manager.setFactoryWatch(task.taskId, enabled, task.revision);
			const current = h.manager.getTaskRuns(task.taskId)[0]?.factory;
			expect(current).toMatchObject({
				phase: "blocked",
				candidate: { commit: head },
				audit: { finding: "Empty input still fails" },
			});
			expect(current?.humanApproval).toBeUndefined();
			await expect(
				h.manager.stampFactoryTask(task.taskId, head),
			).rejects.toThrow("not ready");
		}
	});
	it("accepts an explicit passing sample through Hub and stamps the verified local head", async () => {
		const h = harness();
		const task = await h.create();
		await h.start(task);
		await vi.waitFor(
			async () =>
				expect((await h.manager.getTask(task.taskId))?.status).toBe(
					"completed",
				),
			{ timeout: 15000 },
		);
		const candidate = h.manager.getTaskRuns(task.taskId)[0]?.factory?.candidate;
		if (!candidate) throw new Error("Missing verified candidate");
		const service = new HubAgendaTaskCommandService(h.manager);
		const authority = {
			clientId: "test",
			workspaceContext: { workspaceRoot: h.repo, cwd: h.repo },
		};
		const sampled = await service.handleCommand(
			{
				version: "v1",
				command: "task.factory.audit",
				requestId: "sample",
				clientId: "test",
				payload: { taskId: task.taskId, finding: "" },
			},
			authority,
		);
		expect(sampled.ok).toBe(true);
		expect(h.manager.getTaskRuns(task.taskId)[0]?.factory?.audit).toMatchObject(
			{ finding: "", reviewedAt: expect.any(String) },
		);
		const stamped = await service.handleCommand(
			{
				version: "v1",
				command: "task.factory.stamp",
				requestId: "stamp",
				clientId: "test",
				payload: { taskId: task.taskId, expectedHead: candidate.commit },
			},
			authority,
		);
		expect(stamped.ok).toBe(true);
		expect(
			h.manager.getTaskRuns(task.taskId)[0]?.factory?.humanApproval,
		).toMatchObject({ commit: candidate.commit });
	});

	it.each([
		"run",
		"followup",
	])("retries unavailable verification through %s without charging a code repair", async (resume) => {
		const options = {
			review: JSON.stringify({
				verdict: "pass",
				summary: "Static review completed",
				findings: [],
				coverage: {
					static: ["feature"],
					exercised: [],
					unverified: ["Required execution environment unavailable"],
				},
			}),
		};
		const h = harness(options);
		const task = await h.create(2, { watchPullRequest: true });
		await h.start(task);
		await vi.waitFor(
			async () =>
				expect((await h.manager.getTask(task.taskId))?.status).toBe("failed"),
			{ timeout: 15000 },
		);
		expect(h.builds()).toBe(1);
		expect(h.manager.getTaskRuns(task.taskId)[0]?.factory).toMatchObject({
			repairRound: 0,
			phase: "blocked",
			error: expect.stringContaining("verification remains unavailable"),
		});
		options.review = JSON.stringify({
			verdict: "pass",
			summary: "Verification now available",
			findings: [],
		});
		if (resume === "run") {
			await h.manager.runTask(
				task.taskId,
				{ kind: "user" },
				task.revision,
				"test",
			);
		} else {
			const run = h.manager.getTaskRuns(task.taskId)[0];
			if (!run?.factory?.candidate) throw new Error("Missing candidate");
			const store = new SqliteAgendaTaskStore({
				dbPath: join(h.root, "tasks.db"),
			});
			try {
				store.updateTaskState(task.taskId, { status: "completed" });
				store.updateRun(run.runId, {
					status: "completed",
					factory: {
						...run.factory,
						pullRequestUrl: "https://github.com/example/project/pull/1",
						pullRequestWatch: {
							headCommit: run.factory.candidate.commit,
							handledFeedbackIds: [],
							paused: true,
						},
					},
				});
			} finally {
				store.close();
			}
			const followup = vi
				.spyOn(factoryPullRequest, "runFactoryPullRequestFollowup")
				.mockImplementation(async (input) => {
					await runFactoryWorkflow(input);
					return "idle";
				});
			cleanup.push(async () => {
				followup.mockRestore();
			});
			await h.manager.setFactoryWatch(task.taskId, false, task.revision);
			await h.manager.setFactoryWatch(task.taskId, true, task.revision);
		}
		await vi.waitFor(
			async () =>
				expect(
					h.manager.getTaskRuns(task.taskId)[0]?.factory?.candidate?.reviews[0]
						?.review.summary,
				).toBe("Verification now available"),
			{ timeout: 15000 },
		);
		expect(h.builds()).toBe(1);
		expect(h.reviews()).toBe(2);
		expect(h.manager.getTaskRuns(task.taskId)[0]?.factory).toMatchObject({
			repairRound: 0,
			verificationRetry: 1,
		});
	});

	it("charges completed root sessions once and stops admission at the configured cost boundary", async () => {
		const h = harness();
		h.runtime.getSessionUsage = async () => ({
			inputTokens: 10,
			outputTokens: 5,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0.1,
		});
		const task = await h.create(2, { maxCostUsd: 0.05 });
		await h.start(task);
		await vi.waitFor(
			async () =>
				expect((await h.manager.getTask(task.taskId))?.status).toBe("failed"),
			{ timeout: 15000 },
		);
		const state = h.manager.getTaskRuns(task.taskId)[0]?.factory;
		expect(h.builds()).toBe(1);
		expect(h.reviews()).toBe(0);
		expect(state?.usage).toEqual({
			totals: {
				inputTokens: 10,
				outputTokens: 5,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				totalCost: 0.1,
			},
			unknownSessionIds: [],
		});
		expect(state?.error).toContain("cost budget");
		expect(state?.repairRound).toBe(0);
	});

	it.each([
		"source checkout",
		"missing UI evidence",
	])("rejects %s checks before approval or execution", async (scenario) => {
		const h = harness();
		const task = await h.create(2, {
			checks: [
				{
					name: "Behavior",
					kind: scenario === "source checkout" ? "test" : "ui",
					command:
						scenario === "source checkout"
							? `node "${h.repo}/check.mjs"`
							: "node --check app.js",
					artifacts: [],
				},
			],
		});
		await expect(h.start(task)).rejects.toThrow(
			scenario === "source checkout"
				? "references the original checkout"
				: "requires fresh screenshot",
		);
		expect(h.runtime.startSession).not.toHaveBeenCalled();
	});

	it("runs independent units in separate worktrees and integrates dependencies before their consumer", async () => {
		const h = harness();
		const original = h.runtime.runSession;
		const completedSessions = new Set<string>();
		h.runtime.getSessionUsage = async (id) =>
			completedSessions.has(id)
				? {
						inputTokens: 1,
						outputTokens: 1,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
						totalCost: 0.1,
					}
				: undefined;
		const paths = new Set<string>();
		let arrivals = 0;
		let release!: () => void;
		const bothStarted = new Promise<void>((resolve) => {
			release = resolve;
		});
		h.runtime.runSession = vi.fn<AgendaTaskRuntime["runSession"]>(
			async (id, task, run) => {
				if (!task.instructions.includes("Your isolated implementation unit:")) {
					const result = await original(id, task, run);
					completedSessions.add(id);
					return result;
				}
				const cwd = task.cwd ?? "";
				paths.add(cwd);
				if (
					task.instructions.includes("unit-alpha") ||
					task.instructions.includes("unit-beta")
				) {
					if (++arrivals === 2) release();
					await bothStarted;
					if (task.instructions.includes("unit-alpha"))
						writeFileSync(join(cwd, "feature.txt"), "after\n");
					else writeFileSync(join(cwd, "beta.txt"), "beta\n");
				} else {
					expect(readFileSync(join(cwd, "feature.txt"), "utf8")).toBe(
						"after\n",
					);
					expect(readFileSync(join(cwd, "beta.txt"), "utf8")).toBe("beta\n");
					writeFileSync(
						join(cwd, "integrated.txt"),
						"Both dependencies present\n",
					);
				}
				completedSessions.add(id);
				return { status: "completed", summary: "Implemented isolated unit" };
			},
		);
		const task = await h.create(0, {
			maxCostUsd: 1,
			implementationUnits: [
				{ id: "alpha", instructions: "unit-alpha", dependsOn: [] },
				{ id: "beta", instructions: "unit-beta", dependsOn: [] },
				{
					id: "consumer",
					instructions: "unit-consumer",
					dependsOn: ["alpha", "beta"],
				},
			],
		});
		await h.start(task);
		await vi.waitFor(
			async () =>
				expect((await h.manager.getTask(task.taskId))?.status).toBe(
					"completed",
				),
			{ timeout: 15000 },
		);
		const state = h.manager.getTaskRuns(task.taskId)[0]?.factory;
		expect(paths.size).toBe(3);
		expect(
			state?.implementationUnits?.every((unit) => unit.status === "completed"),
		).toBe(true);
		expect(
			readFileSync(join(state?.workspace.path ?? "", "integrated.txt"), "utf8"),
		).toContain("Both dependencies");
		expect(readFileSync(join(h.repo, "feature.txt"), "utf8")).toBe("before\n");
	});

	it("restores completed attempts and exact candidate without rerunning agents or checks", async () => {
		const h = await followupHarness();
		const run = h.manager.getTaskRuns(h.task.taskId)[0];
		if (!run?.factory) throw new Error("Missing run");
		const task = await h.manager.getTask(run.taskId);
		if (!task) throw new Error("Missing task");
		let state = run.factory;
		const calls = vi.mocked(h.runtime.runSession).mock.calls.length;
		const result = await runFactoryWorkflow({
			task,
			run,
			state,
			runtime: h.runtime,
			storageDir: h.root,
			signal: new AbortController().signal,
			save: (next) => {
				state = next;
			},
			sessionStarted: () => {},
		});
		expect(result.status).toBe("completed");
		expect(h.runtime.runSession).toHaveBeenCalledTimes(calls);
		expect(state.candidate).toEqual(run.factory.candidate);
		expect(
			state.attempts?.filter((attempt) => attempt.status === "completed"),
		).toHaveLength(2);
	});
	it("reconciles a completed builder after loss of its completion acknowledgement", async () => {
		const h = await followupHarness();
		const task = h.task;
		const run = h.manager.getTaskRuns(task.taskId)[0];
		if (!run?.factory) throw new Error("Missing run");
		const builder = run.factory.attempts?.find(
			(attempt) => attempt.role === "builder",
		);
		if (!builder) throw new Error("Missing builder");
		let state: FactoryRunState = {
			...run.factory,
			candidate: undefined,
			attempts: [{ ...builder, status: "running" }],
		};
		h.runtime.reconcileSession = vi.fn<
			NonNullable<AgendaTaskRuntime["reconcileSession"]>
		>(async () => ({
			status: "completed",
			summary: "Implemented",
		}));
		const builds = h.builds();
		await runFactoryWorkflow({
			task,
			run,
			state,
			runtime: h.runtime,
			storageDir: h.root,
			signal: new AbortController().signal,
			save: (next) => {
				state = next;
			},
			sessionStarted: () => {},
		});
		expect(h.builds()).toBe(builds);
		expect(h.runtime.reconcileSession).toHaveBeenCalledWith(builder.sessionId);
		expect(state.phase).toBe("ready");
	});
});

describe("PR follow-up through the existing feature workflow", () => {
	it("reconciles completed PR triage after interruption without a second triage turn or repair charge", async () => {
		const h = await followupHarness();
		const controller = new AbortController();
		const summary = JSON.stringify({
			action: "repair",
			summary: "Missing edge case",
			instructions: "Handle empty input.",
		});
		vi.mocked(h.runtime.runSession).mockImplementationOnce(async () => {
			controller.abort();
			return { status: "completed", summary };
		});
		await expect(h.follow(controller.signal)).rejects.toThrow();
		expect(h.state().repairRound).toBe(0);
		const pending = h
			.state()
			.attempts?.find((attempt) => attempt.key.startsWith("triage:"));
		expect(pending?.status).toBe("running");
		h.runtime.reconcileSession = vi.fn<
			NonNullable<AgendaTaskRuntime["reconcileSession"]>
		>(async () => ({ status: "completed", summary }));
		h.runtime.getSessionUsage = async () => ({
			inputTokens: 10,
			outputTokens: 5,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0.2,
		});
		expect(await h.follow()).toBe("repaired");
		expect(h.runtime.reconcileSession).toHaveBeenCalledWith(pending?.sessionId);
		expect(
			vi
				.mocked(h.runtime.runSession)
				.mock.calls.filter(([, task]) =>
					task.instructions.startsWith("Triage this new PR feedback"),
				),
		).toHaveLength(1);
		expect(h.state().repairRound).toBe(1);
		expect(
			h.state().attempts?.find((attempt) => attempt.key === pending?.key),
		).toMatchObject({ status: "completed", usage: { totalCost: 0.2 } });
	});

	it("repairs, verifies and replies once, and leaves subsequent polling agent-free", async () => {
		const h = await followupHarness();
		expect(await h.follow()).toBe("repaired");
		expect(h.state()).toMatchObject({
			phase: "watching",
			repairRound: 1,
			candidate: {
				reviews: [{ review: { verdict: "pass" } }],
				checks: [{ status: "passed" }],
			},
			pullRequestWatch: { handledFeedbackIds: ["review-1"] },
		});
		expect(h.state().pullRequestWatch?.pending).toBeUndefined();
		expect(h.builds()).toBe(2);
		expect(h.remote().commentBodies[0]).toContain(h.state().candidate?.commit);
		const sessions = vi.mocked(h.runtime.startSession).mock.calls.length;
		expect(await h.follow()).toBe("idle");
		expect(h.runtime.startSession).toHaveBeenCalledTimes(sessions);
		expect(
			vi
				.mocked(h.runtime.startSession)
				.mock.calls.map(([task]) => task.modelSelection?.modelId),
		).toEqual([
			"followup-writer",
			"followup-reviewer",
			"followup-reviewer",
			"followup-writer",
			"followup-reviewer",
		]);
		expect(
			vi
				.mocked(h.runtime.runSession)
				.mock.calls.map(([, task]) => task.modelSelection?.modelId),
		).toEqual([
			"followup-writer",
			"followup-reviewer",
			"followup-reviewer",
			"followup-writer",
			"followup-reviewer",
		]);
		expect(h.commands).toHaveBeenCalledTimes(2);
	});
	it("reconciles a reply accepted before a lost acknowledgement without repeating the repair or comment", async () => {
		const h = await followupHarness();
		h.loseReplyAcknowledgement();
		await expect(h.follow()).rejects.toThrow("Lost reply acknowledgement");
		expect(h.state().pullRequestWatch?.pending?.phase).toBe("publish");
		expect(await h.follow()).toBe("repaired");
		expect(h.builds()).toBe(2);
		expect(h.state().repairRound).toBe(1);
		expect(h.remote().commentBodies).toHaveLength(1);
	});
	it("resumes a paused final repair without charging another repair round", async () => {
		const h = await followupHarness();
		h.exhaustBudget(1);
		const controller = new AbortController();
		vi.mocked(h.runtime.runSession)
			.mockImplementationOnce(async () => ({
				status: "completed",
				summary: JSON.stringify({
					action: "repair",
					summary: "Missing edge case",
					instructions: "Handle empty input.",
				}),
			}))
			.mockImplementationOnce(async () => {
				controller.abort();
				return { status: "cancelled" };
			});
		await expect(h.follow(controller.signal)).rejects.toThrow();
		expect(h.state().repairRound).toBe(2);
		expect(h.state().pullRequestWatch?.pending?.phase).toBe("repair");
		expect(h.commands).not.toHaveBeenCalled();
		expect(await h.follow()).toBe("repaired");
		expect(h.state().repairRound).toBe(2);
		expect(h.state().pullRequestWatch?.pending).toBeUndefined();
		expect(h.remote().commentBodies).toHaveLength(1);
	});
	it("retries malformed reviewer output without spending another repair round", async () => {
		const h = await followupHarness();
		vi.mocked(h.runtime.runSession)
			.mockImplementationOnce(async () => ({
				status: "completed",
				summary: JSON.stringify({
					action: "repair",
					summary: "Fix edge case",
					instructions: "Handle empty input.",
				}),
			}))
			.mockImplementationOnce(async (_id, task) => {
				writeFileSync(join(task.cwd ?? "", "followup.txt"), "Partial fix\n");
				return { status: "completed" };
			})
			.mockImplementationOnce(async () => ({
				status: "completed",
				summary: "invalid reviewer response",
			}));
		expect(await h.follow()).toBe("repaired");
		expect(h.state().repairRound).toBe(1);
		expect(h.remote().commentBodies).toHaveLength(1);
	});
	it("does not reset the repair budget when new feedback arrives", async () => {
		const h = await followupHarness();
		h.exhaustBudget();
		const sessions = vi.mocked(h.runtime.startSession).mock.calls.length;
		await expect(h.follow()).rejects.toThrow("Repair limit (2) reached");
		expect(h.builds()).toBe(1);
		expect(h.runtime.startSession).toHaveBeenCalledTimes(sessions);
		expect(h.commands).not.toHaveBeenCalled();
	});
	it("blocks a changed remote head without pushing or replying", async () => {
		const h = await followupHarness();
		h.changeHeadDuringRepair();
		await expect(h.follow()).rejects.toThrow("PR changed during repair");
		expect(h.commands).not.toHaveBeenCalled();
	});
	it("waits for a new clarification after a scope dispute and includes the prior question as context", async () => {
		const h = await followupHarness();
		vi.mocked(h.runtime.runSession).mockImplementationOnce(async () => ({
			status: "completed",
			summary: JSON.stringify({
				action: "needs_user",
				summary: "Should empty input be rejected?",
				instructions: "",
			}),
		}));
		await expect(h.follow()).rejects.toThrow(
			"Clarify this in a new PR comment, then Resume",
		);
		expect(h.builds()).toBe(1);
		expect(h.commands).not.toHaveBeenCalled();
		const sessions = vi.mocked(h.runtime.startSession).mock.calls.length;
		expect(await h.follow()).toBe("idle");
		expect(h.runtime.startSession).toHaveBeenCalledTimes(sessions);
		h.remote().feedback.push({
			id: "clarification",
			text: "Reject empty input with status 400.",
			trusted: true,
		});
		expect(await h.follow()).toBe("repaired");
		const triage = vi
			.mocked(h.runtime.runSession)
			.mock.calls.filter(([, task]) =>
				task.instructions.startsWith("Triage this new PR feedback"),
			)
			.at(-1)?.[1].instructions;
		expect(triage).toContain("PREVIOUS FEEDBACK");
		expect(triage).toContain("Handle empty input.");
		expect(triage).toContain("Reject empty input with status 400.");
		expect(h.state().pullRequestWatch?.handledFeedbackIds).toEqual([
			"review-1",
			"clarification",
		]);
	});
	it("requires a new maintainer confirmation before outside-contributor feedback can trigger agents", async () => {
		const h = await followupHarness();
		h.remote().feedback = [
			{ id: "outside", text: "Handle empty input.", trusted: false },
		];
		const sessions = vi.mocked(h.runtime.startSession).mock.calls.length;
		await expect(h.follow()).rejects.toThrow(
			"Outside-contributor feedback needs maintainer confirmation",
		);
		expect(h.runtime.startSession).toHaveBeenCalledTimes(sessions);
		expect(h.commands).not.toHaveBeenCalled();
		expect(await h.follow()).toBe("idle");
		h.remote().feedback.push({
			id: "maintainer",
			text: "I confirm the outside contributor's empty-input fix is in scope.",
			trusted: true,
		});
		expect(await h.follow()).toBe("repaired");
		const triage = vi
			.mocked(h.runtime.runSession)
			.mock.calls.find(([, task]) =>
				task.instructions.startsWith("Triage this new PR feedback"),
			)?.[1].instructions;
		expect(triage).toContain("Outside contributor: Handle empty input.");
		expect(triage).toContain(
			"I confirm the outside contributor's empty-input fix is in scope.",
		);
	});
	it("ignores non-actionable comments once and stops when the PR closes", async () => {
		const h = await followupHarness("ignore");
		expect(await h.follow()).toBe("idle");
		expect(h.builds()).toBe(1);
		h.remote().state = "MERGED";
		expect(await h.follow()).toBe("closed");
		expect(h.state().phase).toBe("ready");
		expect(h.state().pullRequestWatch).toBeUndefined();
		expect(h.commands).not.toHaveBeenCalled();
	});
});

describe("feature workflow", () => {
	it("repairs a failed real check, reviews a fresh candidate, and retains the isolated workspace", async () => {
		const h = harness({ failures: 1 });
		const task = await h.create();
		await h.start(task);
		await vi.waitFor(
			async () =>
				expect((await h.manager.getTask(task.taskId))?.status).toBe(
					"completed",
				),
			{ timeout: 15000 },
		);
		const state = h.manager.getTaskRuns(task.taskId)[0]?.factory;
		expect(state).toMatchObject({
			phase: "ready",
			repairRound: 1,
			candidate: {
				reviews: [{ review: { verdict: "pass" } }],
				checks: [{ status: "passed" }],
			},
		});
		expect(state?.sessions.map((session) => session.role)).toEqual([
			"builder",
			"builder",
			"reviewer",
		]);
		expect(h.builds()).toBe(2);
		expect(h.reviews()).toBe(1);
		expect(readFileSync(join(h.repo, "feature.txt"), "utf8")).toBe("before\n");
		expect(state?.pullRequestUrl).toBeUndefined();
	});
	it("routes independent reviewers and reruns every gate after one requests a repair", async () => {
		const h = harness({ reviewFailures: 1 });
		const agent = (modelId: string) => ({
			modelSelection: { providerId: "test-provider", modelId },
			instructions: `Instructions for ${modelId}`,
			maxIterations: 3,
			timeoutSeconds: 20,
		});
		const task = await h.create(2, {
			agents: {
				designer: {},
				planReviewers: [],
				implementer: agent("writer"),
				reviewers: [agent("first"), agent("second")],
			},
		});
		await h.start(task);
		await vi.waitFor(
			async () =>
				expect((await h.manager.getTask(task.taskId))?.status).toBe(
					"completed",
				),
			{ timeout: 15000 },
		);
		const state = h.manager.getTaskRuns(task.taskId)[0]?.factory;
		expect(
			state?.candidate?.reviews.map((entry) => entry.reviewerIndex),
		).toEqual([0, 1]);
		expect(state?.repairRound).toBe(1);
		expect(h.builds()).toBe(2);
		expect(h.reviews()).toBe(4);
		const starts = vi.mocked(h.runtime.startSession).mock.calls;
		expect(starts.map(([task]) => task.modelSelection?.modelId)).toEqual([
			"writer",
			"first",
			"second",
			"writer",
			"first",
			"second",
		]);
		for (const [id, assigned] of vi.mocked(h.runtime.runSession).mock.calls) {
			const started = starts.find(
				([, , , options]) => id === options?.sessionId,
			)?.[0];
			expect(assigned.modelSelection).toEqual(started?.modelSelection);
			expect(assigned.systemPrompt).toContain(
				`Instructions for ${assigned.modelSelection?.modelId}`,
			);
			expect(assigned.maxIterations).toBe(3);
			expect(assigned.timeoutSeconds).toBe(20);
			if (assigned.modelSelection?.modelId === "second")
				expect(assigned.instructions).not.toContain(
					"Fix the missing edge case",
				);
		}
	});
	it.each([
		"fresh",
		"missing",
		"repaired-missing",
		"stale",
		"changed-candidate",
	])("validates verifier %s evidence before final review", async (scenario) => {
		const png = Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=",
			"base64",
		);
		let verifications = 0;
		const succeeds = scenario === "fresh" || scenario === "repaired-missing";
		const h = harness({
			verifier: async (task) => {
				verifications++;
				const dir = join(task.cwd ?? "", ".evidence");
				mkdirSync(dir, { recursive: true });
				if (
					scenario === "fresh" ||
					(scenario === "repaired-missing" && verifications === 2)
				)
					writeFileSync(join(dir, "screen.png"), png);
				if (scenario === "changed-candidate")
					writeFileSync(
						join(task.cwd ?? "", "feature.txt"),
						"unauthorized change",
					);
				return JSON.stringify({
					verdict: "pass",
					summary: "Verified behavior",
					findings: [],
				});
			},
		});
		const task = await h.create(
			scenario === "repaired-missing" || scenario === "changed-candidate"
				? 1
				: 0,
			{
				agents: {
					designer: {},
					planReviewers: [],
					implementer: {},
					reviewers: [{}],
					verifier: { artifacts: [".evidence/screen.png"] },
				},
				...(scenario === "stale"
					? {
							checks: [
								{
									name: "Prepare evidence",
									kind: "test",
									command: `node -e "require('fs').mkdirSync('.evidence',{recursive:true});require('fs').writeFileSync('.evidence/screen.png',Buffer.from('${png.toString("base64")}','base64'))"`,
									artifacts: [],
								},
							],
						}
					: {}),
			},
		);
		await h.start(task);
		await vi.waitFor(
			async () =>
				expect((await h.manager.getTask(task.taskId))?.status).toBe(
					succeeds ? "completed" : "failed",
				),
			{ timeout: 15000 },
		);
		const state = h.manager.getTaskRuns(task.taskId)[0]?.factory;
		if (succeeds) {
			expect(state?.candidate?.verification?.artifacts).toHaveLength(1);
			const artifact = state?.candidate?.verification?.artifacts[0];
			expect(artifact && readFileSync(artifact.path)).toEqual(png);
			expect(h.reviews()).toBe(scenario === "repaired-missing" ? 2 : 1);
			const rounds = scenario === "repaired-missing" ? 1 : 0;
			expect(state?.repairRound).toBe(rounds);
			expect(h.builds()).toBe(rounds + 1);
			expect(verifications).toBe(rounds + 1);
			expect(state?.candidate?.verification?.review.verdict).toBe("pass");
			if (scenario === "repaired-missing") {
				const repair = vi
					.mocked(h.runtime.runSession)
					.mock.calls.find(([, assigned]) =>
						assigned.instructions.startsWith("Address these consolidated"),
					);
				expect(repair?.[1].instructions).toContain("Verification:");
				expect(repair?.[1].instructions).toContain("screen.png");
			}
		} else {
			expect(state?.phase).toBe("blocked");
			expect(h.reviews()).toBe(1);
			expect(h.builds()).toBe(1);
			expect(state?.repairRound).toBe(0);
			if (scenario === "missing" || scenario === "stale") {
				expect(state?.candidate?.verification?.review.verdict).toBe(
					"changes_requested",
				);
				expect(state?.candidate?.verification?.review.findings).toHaveLength(1);
				expect(state?.error).toContain("Repair limit (0) reached");
			}
		}
	});
	it("repairs failed agent verification and reruns it on the new candidate", async () => {
		let verifications = 0;
		const h = harness({
			verifier: async () =>
				JSON.stringify(
					++verifications === 1
						? {
								verdict: "changes_requested",
								findings: ["Behavior failed"],
								summary: "Failed",
							}
						: { verdict: "pass", findings: [], summary: "Passed" },
				),
		});
		const task = await h.create(2, {
			agents: {
				designer: {},
				planReviewers: [],
				implementer: {},
				verifier: {},
				reviewers: [{}],
			},
		});
		await h.start(task);
		await vi.waitFor(
			async () =>
				expect((await h.manager.getTask(task.taskId))?.status).toBe(
					"completed",
				),
			{ timeout: 15000 },
		);
		expect(verifications).toBe(2);
		expect(h.builds()).toBe(2);
		expect(h.reviews()).toBe(2);
		expect(
			h.manager.getTaskRuns(task.taskId)[0]?.factory?.candidate?.verification
				?.review.verdict,
		).toBe("pass");
	});

	it("stops at the configured repair limit without turning failed checks into success", async () => {
		const h = harness({ failures: 10 });
		const task = await h.create(1);
		await h.start(task);
		await vi.waitFor(
			async () =>
				expect((await h.manager.getTask(task.taskId))?.status).toBe("failed"),
			{ timeout: 15000 },
		);
		expect(h.manager.getTaskRuns(task.taskId)[0]?.factory).toMatchObject({
			phase: "blocked",
			repairRound: 1,
			candidate: { checks: [{ status: "failed" }] },
		});
		expect(h.builds()).toBe(2);
		expect(h.reviews()).toBe(0);
	});
	it.each([
		"malformed",
		"provider failure",
	])("blocks %s review without spending repair rounds", async (failure) => {
		const h = harness(
			failure === "malformed"
				? { review: "Everything looks good!" }
				: { reviewerError: "Provider unavailable" },
		);
		const task = await h.create();
		await h.start(task);
		await vi.waitFor(
			async () =>
				expect((await h.manager.getTask(task.taskId))?.status).toBe("failed"),
			{ timeout: 15000 },
		);
		const state = h.manager.getTaskRuns(task.taskId)[0]?.factory;
		expect(state?.phase).toBe("blocked");
		expect(state?.repairRound).toBe(0);
		expect(h.builds()).toBe(1);
		expect(state?.candidate?.reviews).toEqual([]);
		if (failure === "provider failure")
			expect(state?.error).toContain("Provider unavailable");
	});

	it("advances an explicitly approved queue while legacy automation stays disabled", async () => {
		const h = harness();
		const tasks = [await h.create(), await h.create()];
		for (const task of tasks)
			await h.manager.approveTask(task.taskId, { kind: "user" }, task.revision);
		await h.manager.startFactoryQueue(
			tasks.map((task) => ({
				taskId: task.taskId,
				expectedRevision: task.revision,
			})),
			{ kind: "user" },
			"test",
		);
		await vi.waitFor(
			async () => {
				for (const task of tasks)
					expect((await h.manager.getTask(task.taskId))?.status).toBe(
						"completed",
					);
			},
			{ timeout: 15000 },
		);
		expect(h.builds()).toBe(2);
	});
	it("cancels an active writer and prevents verification and reviewer stages", async () => {
		const h = harness({ hold: true });
		const task = await h.create();
		await h.start(task);
		await vi.waitFor(() => expect(h.builds()).toBe(1));
		await h.manager.cancelTask(task.taskId, { kind: "user" }, task.revision);
		expect((await h.manager.getTask(task.taskId))?.status).toBe("cancelled");
		expect(h.runtime.abortSession).toHaveBeenCalled();
		expect(h.reviews()).toBe(0);
		expect(
			h.manager.getTaskRuns(task.taskId)[0]?.factory?.candidate,
		).toBeUndefined();
	});
	it("keeps design sessions singular across windows until the interview finishes", async () => {
		const h = harness();
		h.runtime.startDesignSession = vi.fn(async () => ({ sessionId: "design" }));
		const task = await h.create();
		let finish!: () => void;
		const interview = new Promise<void>((resolve) => {
			finish = resolve;
		});
		h.runtime.abortSession = vi.fn(async () => finish());
		h.runtime.runDesignSession = vi.fn<
			NonNullable<AgendaTaskRuntime["runDesignSession"]>
		>(async () => {
			await interview;
			return {
				status: "completed",
				summary: JSON.stringify({
					instructions: "Agreed brief",
					checks: task.factory?.checks,
				}),
			};
		});
		expect(
			await Promise.all([
				h.manager.startFactoryDesign(task.taskId),
				h.manager.startFactoryDesign(task.taskId),
			]),
		).toEqual([{ sessionId: "design" }, { sessionId: "design" }]);
		expect(h.runtime.startDesignSession).toHaveBeenCalledTimes(1);
		expect((await h.manager.getTask(task.taskId))?.originSessionId).toBe(
			"design",
		);
		expect(await h.manager.startFactoryDesign(task.taskId)).toEqual({
			sessionId: "design",
		});
		expect(h.runtime.runDesignSession).toHaveBeenCalledTimes(1);
		expect(h.runtime.startDesignSession).toHaveBeenCalledTimes(1);
		finish();
		await vi.waitFor(async () =>
			expect((await h.manager.getTask(task.taskId))?.instructions).toBe(
				"Agreed brief",
			),
		);
		await h.manager.startFactoryDesign(task.taskId);
		expect(h.runtime.startDesignSession).toHaveBeenCalledTimes(2);
	});
	it("saves the document-backed interview result as a new brief requiring approval", async () => {
		const h = harness();
		const documents = [
			{
				name: "Keyboard design.md",
				content: "The board must support keyboard navigation.",
			},
		];
		const task = await h.create(2, { documents });
		await h.manager.approveTask(task.taskId, { kind: "user" }, task.revision);
		const design = {
			instructions:
				"Agreed answer: support arrow keys on desktop. Acceptance: keyboard navigation passes. Exclude mobile gestures.",
			checks: [
				{
					name: "Keyboard navigation",
					command: "bun test keyboard.test.ts",
					kind: "ui",
					artifacts: ["keyboard.png"],
				},
			],
		};
		h.runtime.startDesignSession = vi.fn(async () => ({ sessionId: "design" }));
		h.runtime.runDesignSession = vi.fn<
			NonNullable<AgendaTaskRuntime["runDesignSession"]>
		>(async () => ({
			status: "completed",
			summary: JSON.stringify(design),
		}));
		await h.manager.startFactoryDesign(task.taskId, "desktop-client");
		await vi.waitFor(async () =>
			expect((await h.manager.getTask(task.taskId))?.instructions).toBe(
				design.instructions,
			),
		);
		const saved = await h.manager.getTask(task.taskId);
		expect(saved).toMatchObject({
			revision: task.revision + 1,
			status: "pending_approval",
			originSessionId: "design",
			factory: { checks: design.checks, documents },
		});
		expect(saved?.approvedRevision).toBeUndefined();
		expect(h.runtime.runDesignSession).toHaveBeenCalledWith(
			"design",
			expect.objectContaining({
				mode: "plan",
				instructions: expect.stringContaining(documents[0].content),
			}),
			"desktop-client",
		);
		const prompt = vi.mocked(h.runtime.runDesignSession).mock.calls[0][1]
			.instructions;
		expect(prompt).toContain(task.instructions);
		expect(prompt).toContain("Use ask_question for unresolved decisions");
		expect(h.runtime.startSession).not.toHaveBeenCalled();
		expect(h.runtime.runSession).not.toHaveBeenCalled();
	});
	it.each([
		"starting",
		"running",
	])("cancels a %s design interview without saving its result", async (stage) => {
		const h = harness();
		const task = await h.create();
		let release!: () => void;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		h.runtime.startDesignSession = vi.fn(async () => {
			if (stage === "starting") await held;
			return { sessionId: "design" };
		});
		h.runtime.runDesignSession = vi.fn(async () => {
			await held;
			return {
				status: "completed" as const,
				summary: JSON.stringify({
					instructions: "Cancelled proposal",
					checks: task.factory?.checks,
				}),
			};
		});
		h.runtime.abortSession = vi.fn(async () => release());
		const design = h.manager.startFactoryDesign(task.taskId);
		const designResult = design.catch(() => undefined);
		if (stage === "running") await design;
		else
			await vi.waitFor(() =>
				expect(h.runtime.startDesignSession).toHaveBeenCalled(),
			);
		const cancellation = h.manager.cancelTask(
			task.taskId,
			{ kind: "user" },
			task.revision,
		);
		release();
		await cancellation;
		await designResult;
		expect(h.runtime.abortSession).toHaveBeenCalledWith(
			"design",
			expect.any(String),
		);
		if (stage === "starting")
			expect(h.runtime.runDesignSession).not.toHaveBeenCalled();
		expect(await h.manager.getTask(task.taskId)).toMatchObject({
			status: "cancelled",
			revision: task.revision,
			instructions: task.instructions,
		});
	});
	it("preserves a user edit made during the interview and exposes the save conflict", async () => {
		const h = harness();
		const task = await h.create();
		let finish!: () => void;
		const interview = new Promise<void>((resolve) => {
			finish = resolve;
		});
		h.runtime.startDesignSession = vi.fn(async () => ({ sessionId: "design" }));
		h.runtime.abortSession = vi.fn(async () => finish());
		h.runtime.runDesignSession = vi.fn<
			NonNullable<AgendaTaskRuntime["runDesignSession"]>
		>(async () => {
			await interview;
			return {
				status: "completed",
				summary: JSON.stringify({
					instructions: "Stale interview brief",
					checks: task.factory?.checks,
				}),
			};
		});
		await h.manager.startFactoryDesign(task.taskId);
		const edited = await h.manager.updateTask({
			taskId: task.taskId,
			expectedRevision: task.revision,
			instructions: "The user narrowed the feature while answering questions.",
			updatedBy: { kind: "user" },
		});
		finish();
		await vi.waitFor(async () =>
			expect((await h.manager.getTask(task.taskId))?.error).toContain(
				"Design was not saved",
			),
		);
		const saved = await h.manager.getTask(task.taskId);
		expect(saved?.instructions).toBe(edited.instructions);
		expect(saved?.revision).toBe(edited.revision);
		expect(saved?.factory?.checks).toEqual(edited.factory?.checks);
		expect(saved?.error).toContain("Your current brief is unchanged");
		expect(saved?.error).toContain("revision");
	});
	it("deduplicates imported issues within a workspace while allowing another workspace", async () => {
		const h = harness();
		const sourceIssue = {
			provider: "github",
			id: "I_example",
			url: "https://github.com/example/project/issues/1",
		} as const;
		const task = await h.create(2, { sourceIssue });
		const duplicate = await h.create(2, {
			sourceIssue: {
				...sourceIssue,
				url: "https://github.com/example/renamed/issues/1",
			},
		});
		expect(duplicate.taskId).toBe(task.taskId);
		expect(duplicate.revision).toBe(task.revision);
		const workspaceRoot = join(h.root, "another-repo");
		mkdirSync(workspaceRoot);
		const separate = await h.manager.createTask({
			title: task.title,
			type: task.type,
			instructions: task.instructions,
			scope: "workspace",
			workspaceRoot,
			expiresAt: task.expiresAt,
			createdBy: { kind: "user" },
			factory: task.factory,
		});
		expect(separate.taskId).not.toBe(task.taskId);
		expect(separate.workspaceRoot).toBe(workspaceRoot);
	});
	it("rejects cloud execution explicitly and invalidates approval when checks change", async () => {
		const h = harness();
		const task = await h.create();
		await h.manager.approveTask(task.taskId, { kind: "user" }, task.revision);
		const updated = await h.manager.updateTask({
			taskId: task.taskId,
			expectedRevision: task.revision,
			factory: factoryTaskConfigSchema.parse({
				execution: "cloud",
				checks: [{ name: "Route", kind: "api", command: "true" }],
			}),
			updatedBy: { kind: "user" },
		});
		expect(updated.status).toBe("pending_approval");
		expect(updated.approvedRevision).toBeUndefined();
		await expect(
			h.manager.runTask(task.taskId, { kind: "user" }, updated.revision),
		).rejects.toThrow("Cloud factory execution is not available");
		expect(h.runtime.startSession).not.toHaveBeenCalled();
	});
});
