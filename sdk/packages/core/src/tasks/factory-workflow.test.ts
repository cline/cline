import { execFileSync, spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AgendaTaskRecord,
	AgendaTaskRunRecord,
	FactoryAppEnvironment,
	FactoryReviewSelection,
	FactoryRunState,
	FactoryTaskConfig,
	FactoryWorkflowRecipe,
} from "@cline/shared";
import {
	applyFactoryVerificationProfile,
	DEFAULT_FACTORY_AGENTS,
	FACTORY_VERIFICATION_EXERCISE_HEADING,
	FACTORY_VERIFICATION_PROFILE_PATH,
	factoryTaskConfigSchema,
	factoryVerificationProfileSchema,
} from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HubAgendaTaskCommandService } from "../hub/server/task-command-service";
import {
	AgendaTaskManager,
	type AgendaTaskRuntime,
	adoptFactoryPolicy,
	factoryResumeState,
} from "./agenda-task-manager";
import {
	FactoryDecisionError,
	FactoryPublishError,
	FactoryVerificationProfileError,
} from "./factory-errors";
import * as factoryLocal from "./factory-local";
import { runFactoryCommand } from "./factory-local";
import * as factoryPullRequest from "./factory-pull-request";
import {
	type FactoryPullRequestSnapshot,
	runFactoryPullRequestFollowup,
} from "./factory-pull-request";
import { createFactoryReplayInputs } from "./factory-replay";
import {
	FACTORY_REPO_RULES_SOURCE,
	FACTORY_RULE_NOMINATION_INSTRUCTION,
	formatFactoryKnownRuleKeys,
} from "./factory-repo-rules";
import {
	factoryVerificationProfileFileContent,
	factoryVerificationProfileHash,
	formatFactoryVerificationProfileForFinalReviewer,
} from "./factory-verification-profile";
import { runFactoryWorkflow } from "./factory-workflow";
import { createFactoryWorkflowRecipe } from "./factory-workflow-recipe";
import { SqliteAgendaTaskStore } from "./store/sqlite-task-store";

const cleanup: Array<() => Promise<void>> = [];
// The fixture repos have no GitHub remote; the PR base check has its own tests.
let resolveBase: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
	resolveBase = vi
		.spyOn(factoryLocal, "resolveFactoryPullRequestBase")
		.mockResolvedValue("main");
});
afterEach(async () => {
	for (const dispose of cleanup.splice(0)) await dispose();
	resolveBase.mockRestore();
});
function harness(
	options: {
		review?: string;
		reviewSelection?: FactoryReviewSelection;
		outsidePath?: boolean;
		reviewFailures?: number;
		reviewerError?: string;
		verifier?: (task: AgendaTaskRecord) => Promise<string>;
		failures?: number;
		hold?: boolean;
		triage?: "repair" | "ignore" | "needs_user";
		defaultWorkflow?: FactoryWorkflowRecipe;
		factoryConcurrency?: number;
		resolveFactoryConcurrency?: () => Promise<number | undefined>;
		resolveFactoryPaused?: () => Promise<boolean | undefined>;
		resolveFactoryDefaultsReceived?: () => Promise<boolean>;
		logger?: { log: (message: string, metadata?: unknown) => void };
		/**
		 * Freezes cards without their own agents with a final reviewer on
		 * another model than the builder, as automatic approval of hands-off
		 * plans requires (see factoryIndependentReview).
		 */
		independentReviewer?: boolean;
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
	// A local bare origin: publishing cards start from a published branch.
	const origin = join(root, "origin.git");
	execFileSync("git", ["init", "--bare", "-b", "main", origin]);
	// Publishing needs a GitHub origin; git serves it from the bare repository.
	const originUrl = "https://github.com/example/project.git";
	execFileSync("git", ["-C", repo, "remote", "add", "origin", originUrl]);
	execFileSync("git", [
		"-C",
		repo,
		"config",
		`url.${origin}.insteadOf`,
		originUrl,
	]);
	execFileSync("git", ["-C", repo, "push", "-q", "origin", "main"]);
	let sessionIndex = 0;
	const roles = new Map<string, string>();
	let builds = 0;
	let reviews = 0;
	let release: (() => void) | undefined;
	const runtime: AgendaTaskRuntime = {
		...(options.independentReviewer
			? {
					resolveFactoryAgents: async (task: AgendaTaskRecord) => {
						const agents = task.factory?.agents ?? DEFAULT_FACTORY_AGENTS;
						return {
							...agents,
							reviewers: agents.reviewers.map((reviewer) => ({
								...reviewer,
								modelSelection: reviewer.modelSelection ?? {
									providerId: "other",
									modelId: "reviewer",
								},
							})),
						};
					},
				}
			: {}),
		startDesignSession: vi.fn(async (_task, _client, _agent, sessionId) => ({
			sessionId: sessionId ?? "designer",
		})),
		runDesignSession: vi.fn<NonNullable<AgendaTaskRuntime["runDesignSession"]>>(
			async (_id, task) => ({
				status: "completed",
				summary: JSON.stringify({
					instructions: task.instructions,
					checks: task.factory?.checks,
					acceptanceCriteria: task.factory?.acceptanceCriteria,
					reviewSelection: options.reviewSelection,
				}),
			}),
		),
		reconcileSession: vi.fn<NonNullable<AgendaTaskRuntime["reconcileSession"]>>(
			async (sessionId) =>
				roles.has(sessionId)
					? { status: "failed", error: "Interrupted test session" }
					: { status: "missing" },
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
			if (options.outsidePath)
				writeFileSync(
					join(task.cwd ?? "", " feature.txt"),
					"outside declared scope\n",
				);
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
		resolveFactoryDefaultWorkflow: async () => options.defaultWorkflow,
		factoryConcurrency: options.factoryConcurrency,
		resolveFactoryConcurrency: options.resolveFactoryConcurrency,
		resolveFactoryPaused: options.resolveFactoryPaused,
		resolveFactoryDefaultsReceived: options.resolveFactoryDefaultsReceived,
		...(options.logger
			? { logger: { debug: () => {}, log: options.logger.log } }
			: {}),
	});
	cleanup.push(async () => {
		await manager.dispose();
		rmSync(root, { recursive: true, force: true });
	});
	const create = async (
		maxRepairRounds = 2,
		factory: Partial<FactoryTaskConfig> = {},
	) => {
		const checks = factory.checks ?? [
			{
				name: "Feature behavior",
				kind: "api" as const,
				command: `node -e "if(require('fs').readFileSync('feature.txt','utf8').trim()!=='after')process.exit(1)"`,
				artifacts: [],
			},
		];
		return manager.createTask({
			title: "Update feature",
			type: "follow-up",
			instructions: "Acceptance: feature.txt contains after.",
			scope: "workspace",
			workspaceRoot: repo,
			expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
			createdBy: { kind: "user" },
			factory: factoryTaskConfigSchema.parse({
				maxRepairRounds,
				checks,
				acceptanceCriteria: [
					{
						id: "feature-after",
						text: "feature.txt contains after",
						check: checks[0]?.name,
					},
				],
				...factory,
			}),
		});
	};
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
			implementers: [
				{
					modelSelection: {
						providerId: "test-provider",
						modelId: "followup-writer",
					},
				},
				{
					modelSelection: {
						providerId: "test-provider",
						modelId: "secondary-writer",
					},
				},
			],
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
		"set-url",
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
	let description = "Human summary.";
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
		} else if (input.args[1] === "view") {
			expect(input.captureStdout).toBe(true);
			return {
				exitCode: 0,
				output: `A new release of gh is available\n${JSON.stringify({ body: description })}`,
				stdout: JSON.stringify({ body: description }),
				truncated: false,
				timedOut: false,
			};
		} else if (input.args[1] === "edit") {
			description = readFileSync(input.args.at(-1) ?? "", "utf8");
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
		description: () => description,
		loseReplyAcknowledgement: () => {
			loseReplyAcknowledgement = true;
		},
		changeHeadDuringRepair: () => {
			headChangesDuringRepair = true;
		},
		exhaustBudget: (repairRound = 2) => {
			state = { ...state, repairRound };
		},
		patchState: (patch: Partial<FactoryRunState>) => {
			state = { ...state, ...patch };
		},
	};
}

const verifiedCriteria = (
	verifier: (task: AgendaTaskRecord) => Promise<string>,
) => {
	const h = harness({ verifier });
	const create = (maxRuntimeRetries?: number) =>
		h.create(2, {
			maxRuntimeRetries,
			agents: {
				designer: {},
				planReviewers: [],
				implementers: [{}],
				reviewers: [{}],
				verifier: { instructions: "Start with npm run dev; ready at :3000." },
			},
			acceptanceCriteria: [
				{
					id: "feature-after",
					text: "feature.txt contains after",
					required: true,
					check: "Feature behavior",
				},
				{ id: "visible", text: "The card shows after", required: true },
				{ id: "paged", text: "Pagination keeps order", required: false },
			],
		});
	return { h, create };
};
const verification = (acceptance?: unknown[]) =>
	JSON.stringify({
		verdict: "pass",
		summary: "Exercised the app; stopped the dev server.",
		findings: [],
		coverage: { static: [], exercised: [], requiredGaps: [], limitations: [] },
		...(acceptance ? { acceptance } : {}),
	});

/**
 * The first reconcile after a thrown turn fails, so the run blocks and the
 * manual rerun path stays covered. A session that settles is retried
 * automatically, and one that keeps reporting running blocks only after the
 * runner's one-minute settle poll, too slow for these tests. Only the session
 * the runner aborted for its thrown turn is targeted, so design, recovery and
 * response-repair reconciles pass through untouched.
 */
function failReconcileOnce(runtime: {
	reconcileSession?: AgendaTaskRuntime["reconcileSession"];
	abortSession: AgendaTaskRuntime["abortSession"];
}) {
	const reconcile = runtime.reconcileSession;
	const abort = runtime.abortSession;
	let target: string | undefined;
	let failed = false;
	runtime.abortSession = vi.fn<AgendaTaskRuntime["abortSession"]>(
		async (sessionId, reason) => {
			if (!target && / session failed: /.test(reason)) target = sessionId;
			return abort(sessionId, reason);
		},
	);
	runtime.reconcileSession = vi.fn<
		NonNullable<AgendaTaskRuntime["reconcileSession"]>
	>(async (sessionId) => {
		if (!failed && sessionId === target) {
			failed = true;
			throw new Error("Hub unavailable during reconciliation");
		}
		return reconcile ? reconcile(sessionId) : { status: "missing" };
	});
}

describe("durable Factory execution", () => {
	it.each([
		false,
		true,
	])("snapshots selected reviewers and preserves append-only escalation on resume (outside=%s)", async (outsidePath) => {
		const selection: FactoryReviewSelection = {
			impact: "local",
			rationale: "Feature-only behavior",
			affectedPaths: ["feature.txt"],
			consumers: ["feature reader"],
			planReviewerIndices: [],
			reviewerIndices: [1],
		};
		const h = harness({ reviewSelection: selection, outsidePath });
		const task = await h.create(2, {
			reviewMode: "adaptive",
			agents: {
				designer: {},
				planReviewers: [],
				implementers: [{}],
				reviewers: [
					{
						modelSelection: {
							providerId: "test-provider",
							modelId: "pool-first",
						},
					},
					{
						modelSelection: {
							providerId: "test-provider",
							modelId: "selected",
						},
					},
					{
						modelSelection: {
							providerId: "test-provider",
							modelId: "pool-third",
						},
					},
				],
			},
		});
		await h.manager.startFactoryDesign(task.taskId);
		await vi.waitFor(async () =>
			expect(
				(await h.manager.getTask(task.taskId))?.factoryDesignProgress?.phase,
			).toBe("complete"),
		);
		const scoped = await h.manager.getTask(task.taskId);
		if (!scoped) throw new Error("Missing scoped task");
		await h.start(scoped);
		await vi.waitFor(
			async () =>
				expect((await h.manager.getTask(task.taskId))?.status).toBe(
					"completed",
				),
			{ timeout: 15000 },
		);
		const run = h.manager.getTaskRuns(task.taskId)[0];
		if (!run?.factory?.candidate) throw new Error("Missing candidate");
		const expectedModels = outsidePath
			? ["selected", "pool-first", "pool-third"]
			: ["selected"];
		expect(
			run.factory.agents?.reviewers.map(
				(agent) => agent.modelSelection?.modelId,
			),
		).toEqual(expectedModels);
		expect(
			run.factory.candidate.reviews.map((review) => review.reviewerIndex),
		).toEqual(expectedModels.map((_, index) => index));
		expect(run.factory.reviewEscalation?.affectedPaths).toEqual(
			outsidePath ? [" feature.txt"] : undefined,
		);
		// Replay reapplies the selection's indices, so the snapshot keeps the whole pool.
		expect(
			run.factory.inputSnapshot?.factory.agents?.reviewers.map(
				(agent) => agent.modelSelection?.modelId,
			),
		).toEqual(["pool-first", "selected", "pool-third"]);
		const [replay] = await h.manager.replayFactoryTask({
			taskId: task.taskId,
			runId: run.runId,
			comparisonId: `adaptive-${outsidePath}`,
			variants: [{ label: "Original" }],
			actor: { kind: "user" },
		});
		expect(replay?.factoryDesignProgress).toMatchObject({
			phase: "complete",
			originalRequest: replay?.instructions,
			reviewSelection: selection,
		});
		let resumed = run.factory;
		const starts = vi.mocked(h.runtime.startSession).mock.calls.length;
		await runFactoryWorkflow({
			task: scoped,
			run,
			state: resumed,
			runtime: h.runtime,
			storageDir: h.root,
			signal: new AbortController().signal,
			save: (state) => {
				resumed = state;
			},
			sessionStarted: () => {},
		});
		expect(h.runtime.startSession).toHaveBeenCalledTimes(starts);
		expect(
			resumed.agents?.reviewers.map((agent) => agent.modelSelection?.modelId),
		).toEqual(expectedModels);
		await expect(
			h.manager.stampFactoryTask(task.taskId, run.factory.candidate.commit),
		).resolves.toMatchObject({ taskId: task.taskId });
	});

	it("publishes the draft PR only after independent review passes, with the verified description", async () => {
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
				expect(state.candidate?.reviews).toHaveLength(1);
				events.push("draft");
				return "https://github.com/example/project/pull/1";
			});
		const updateBody = vi
			.spyOn(factoryLocal, "updateFactoryPullRequestBody")
			.mockResolvedValue();
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
			expect(events).toEqual(["review", "draft"]);
			expect(state.phase).toBe("watching");
			const commit = state.candidate?.commit;
			expect(state.pullRequestWatch?.headCommit).toBe(commit);
			// The first description is already the verified one.
			const section = publish.mock.calls[0]?.[0].body ?? "";
			expect(section).toMatch(/^<!-- cline-factory-evidence:start -->\n/);
			expect(section).toContain("## Changes\n\n- `feature.txt` (+1 −1)");
			expect(section).toMatch(/## Testing\n\nRan:\n\n- `/);
			// How Factory checked the work stays in Factory.
			expect(section).not.toMatch(
				/passed|Verdict|Checked by|Not verified|Review needed|feature-after/,
			);
			// A new card is named by its short id on its branch, PR title and evidence.
			expect(task.factoryNumber).toBe(1);
			expect(state.workspace.branch).toBe("factory/f-1-update-feature");
			expect(publish.mock.calls[0]?.[0].title).toBe("F1: Update feature");
			expect(section).toContain("Opened by Cline Factory · card F1\n");
			// Without the opt-in, no model-written text is published.
			expect(section).not.toContain("Reviewed behavior");
			expect(section).not.toContain("Evidence |");
			// A new PR carries its description; nothing rewrites it.
			expect(updateBody).not.toHaveBeenCalled();
			// Resuming the delivered run updates the same PR's description only.
			await runFactoryWorkflow({ ...input, state });
			expect(publish).toHaveBeenCalledTimes(1);
			expect(updateBody).toHaveBeenCalledTimes(1);
			expect(updateBody.mock.calls[0]?.[0].url).toBe(
				"https://github.com/example/project/pull/1",
			);
		} finally {
			publish.mockRestore();
			updateBody.mockRestore();
		}
	});

	it("resumes an interrupted integration owner without charging the code repair twice", async () => {
		const h = harness();
		failReconcileOnce(h.runtime);
		const original = h.runtime.runSession;
		let integrations = 0;
		h.runtime.runSession = vi.fn<AgendaTaskRuntime["runSession"]>(
			async (id, task, run) => {
				if (task.instructions.startsWith("Resolve only the pending merge")) {
					integrations++;
					writeFileSync(join(task.cwd ?? "", "feature.txt"), "after\n");
					execFileSync("git", ["-C", task.cwd ?? "", "add", "feature.txt"]);
					if (integrations === 1)
						throw new Error("Integration transport interrupted");
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
		const interruptedWorkspace = h.manager.getTaskRuns(task.taskId)[0]?.factory
			?.workspace;
		if (!interruptedWorkspace)
			throw new Error("Missing interrupted integration workspace");
		expect(
			execFileSync(
				"git",
				["-C", interruptedWorkspace.path, "ls-files", "--unmerged"],
				{ encoding: "utf8" },
			),
		).toBe("");
		expect(
			execFileSync(
				"git",
				["-C", interruptedWorkspace.path, "rev-parse", "MERGE_HEAD"],
				{ encoding: "utf8" },
			).trim(),
		).not.toBe("");
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
		for (const [, assigned] of vi.mocked(h.runtime.runSession).mock.calls) {
			if (assigned.instructions.startsWith("Resolve only the pending merge")) {
				expect(assigned.instructions).toContain(task.instructions);
				expect(assigned.instructions).toContain(
					JSON.stringify(task.factory?.checks),
				);
			}
		}
		expect(
			readFileSync(join(state?.workspace.path ?? "", "feature.txt"), "utf8"),
		).toBe("after\n");
	});

	it("keeps archived and restored PR follow-up paused across maintenance", async () => {
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
		const store = new SqliteAgendaTaskStore({
			dbPath: join(h.root, "tasks.db"),
		});
		try {
			store.updateRun(run.runId, {
				factory: {
					...state,
					phase: "watching",
					pullRequestUrl: "https://github.com/example/project/pull/1",
					pullRequestWatch: {
						headCommit: state.candidate.commit,
						handledFeedbackIds: [],
					},
				},
			});
		} finally {
			store.close();
		}
		const read = vi
			.spyOn(factoryPullRequest, "readFactoryPullRequest")
			.mockRejectedValue(new Error("Unexpected PR follow-up"));
		const sessions = vi.mocked(h.runtime.startSession).mock.calls.length;
		vi.useFakeTimers();
		try {
			await h.manager.archiveTask(task.taskId, { kind: "user" }, task.revision);
			expect(h.manager.getTaskRuns(task.taskId)[0]?.factory).toMatchObject({
				candidate: state.candidate,
				pullRequestWatch: { paused: true },
			});
			await h.manager.start();
			await vi.advanceTimersByTimeAsync(30_000);
			const restored = await h.manager.restoreTask(
				task.taskId,
				{ kind: "user" },
				task.revision,
			);
			expect(restored).toMatchObject({
				status: "completed",
				archivedAt: undefined,
			});
			await vi.advanceTimersByTimeAsync(30_000);
			expect(read).not.toHaveBeenCalled();
			expect(h.runtime.startSession).toHaveBeenCalledTimes(sessions);
		} finally {
			vi.useRealTimers();
			read.mockRestore();
		}
	});

	it("keeps a flagged delivery delivered and stamped through watch toggles on the same candidate", async () => {
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
			// Feedback is a note, not a stop: the delivery and its stamp stand,
			// and follow-up runs as it would without the note (here it cannot
			// reach GitHub, so a resumed watch may stop on its own).
			expect(current).toMatchObject({
				candidate: { commit: head },
				audit: { finding: "Empty input still fails" },
				humanApproval: { commit: head },
			});
			if (!enabled) expect(current?.phase).toBe("ready");
		}
	});
	it("stops polling a draft PR it only watches for its outcome 14 days after the run completed", async () => {
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
		if (!run || !state?.candidate) throw new Error("Missing delivered run");
		const store = (h.manager as unknown as { store: SqliteAgendaTaskStore })
			.store;
		const current = await h.manager.getTask(task.taskId);
		// Read-only watching: published, without PR follow-up.
		const readOnly = {
			...current,
			factory: {
				...current?.factory,
				watchPullRequest: false,
				publishPullRequest: true,
			},
		} as AgendaTaskRecord;
		vi.spyOn(store, "listTasks").mockReturnValue([readOnly]);
		const claim = vi.spyOn(store, "claimRun").mockReturnValue(undefined);
		const watchingSince = (days: number) =>
			store.updateRun(run.runId, {
				completedAt: new Date(Date.now() - days * 86_400_000).toISOString(),
				factory: {
					...state,
					phase: "watching",
					pullRequestUrl: "https://github.com/example/project/pull/1",
					pullRequestWatch: {
						headCommit: state.candidate?.commit ?? "",
						handledFeedbackIds: [],
					},
				},
			});
		const poll = () =>
			(
				h.manager as unknown as { queueFactoryFollowup(): void }
			).queueFactoryFollowup();
		watchingSince(13);
		poll();
		expect(claim).toHaveBeenCalledTimes(1);
		watchingSince(15);
		poll();
		expect(claim).toHaveBeenCalledTimes(1);
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
		"automatic",
		"interrupted",
		"limitations",
	])("closes required verifier gaps after %s execution without repeating passing lanes or checks", async (scenario) => {
		let verifications = 0;
		const prompts: string[] = [];
		const gap = "Exercise repeated query, header handling, and fetch failure";
		const h = harness({
			verifier: async (task) => {
				prompts.push(task.instructions);
				verifications++;
				if (scenario === "interrupted" && verifications === 2)
					throw new Error("Verifier transport interrupted");
				return JSON.stringify({
					verdict:
						scenario !== "limitations" && verifications === 1
							? "changes_requested"
							: "pass",
					summary: "Behavior verification",
					findings: [],
					coverage: {
						static: [],
						exercised: [],
						requiredGaps:
							scenario !== "limitations" && verifications === 1 ? [gap] : [],
						limitations: [
							"No pagination data; this check is conditional on available rows",
						],
					},
				});
			},
		});
		if (scenario === "interrupted") failReconcileOnce(h.runtime);
		const task = await h.create(2, {
			agents: {
				designer: {},
				planReviewers: [],
				implementers: [{}],
				reviewers: [{}],
				verifier: {},
			},
			checks: [
				{
					name: "Counted behavior check",
					kind: "api",
					command: `node -e "const fs=require('fs');fs.mkdirSync('.evidence',{recursive:true});fs.appendFileSync('.evidence/check-count','x');if(fs.readFileSync('feature.txt','utf8').trim()!=='after')process.exit(1)"`,
					artifacts: [],
				},
			],
		});
		await h.start(task);
		if (scenario === "interrupted") {
			await vi.waitFor(
				async () =>
					expect((await h.manager.getTask(task.taskId))?.status).toBe("failed"),
				{ timeout: 15000 },
			);
			expect(
				h.manager.getTaskRuns(task.taskId)[0]?.factory?.verificationFeedback
					?.verifier,
			).toEqual([gap]);
			await h.manager.runTask(
				task.taskId,
				{ kind: "user" },
				task.revision,
				"test",
			);
		}
		await vi.waitFor(
			async () =>
				expect((await h.manager.getTask(task.taskId))?.status).toBe(
					"completed",
				),
			{ timeout: 15000 },
		);
		const state = h.manager.getTaskRuns(task.taskId)[0]?.factory;
		expect(state?.repairRound).toBe(0);
		expect(state?.verificationRetry ?? 0).toBe(
			scenario === "limitations" ? 0 : 1,
		);
		expect(
			state?.candidate?.verification?.review.coverage?.limitations,
		).toEqual([
			"No pagination data; this check is conditional on available rows",
		]);
		expect(h.builds()).toBe(1);
		expect(h.reviews()).toBe(1);
		expect(verifications).toBe(
			scenario === "interrupted" ? 3 : scenario === "limitations" ? 1 : 2,
		);
		if (scenario !== "limitations") expect(prompts.at(-1)).toContain(gap);
		expect(
			readFileSync(
				join(state?.workspace.path ?? "", ".evidence/check-count"),
				"utf8",
			),
		).toBe("x");
		expect(state?.candidateHistory ?? []).toHaveLength(0);
		expect(
			state?.attempts?.filter(
				(attempt) =>
					attempt.role === "verifier" && attempt.status === "completed",
			),
		).toHaveLength(scenario === "limitations" ? 1 : 2);
	});

	it.each([
		"recovers",
		"exhausts",
	])("retries verification, not the builder, when a bare pass omits a required criterion (%s)", async (scenario) => {
		const prompts: string[] = [];
		const { h, create } = verifiedCriteria(async (task) => {
			prompts.push(task.instructions);
			return prompts.length === 1 || scenario === "exhausts"
				? verification()
				: verification([
						{
							criterionId: "visible",
							outcome: "passed",
							evidence: "Saw after",
						},
						{
							criterionId: "paged",
							outcome: "failed",
							evidence: "Order flips",
						},
					]);
		});
		const task = await create(scenario === "exhausts" ? 1 : undefined);
		await h.start(task);
		await vi.waitFor(
			async () =>
				expect((await h.manager.getTask(task.taskId))?.status).toBe(
					scenario === "exhausts" ? "failed" : "completed",
				),
			{ timeout: 15000 },
		);
		const state = h.manager.getTaskRuns(task.taskId)[0]?.factory;
		expect(h.builds()).toBe(1);
		expect(h.reviews()).toBe(1);
		expect(state).toMatchObject({ repairRound: 0, verificationRetry: 1 });
		expect(prompts[0]).toContain("ACCEPTANCE CRITERIA:");
		expect(prompts[0]).toContain('"id":"visible"');
		expect(prompts[0]).toContain('"id":"paged"');
		expect(prompts[0]).not.toContain('"id":"feature-after"');
		expect(prompts[1]).toContain(
			JSON.stringify([
				'Acceptance criterion "visible" (The card shows after) unverified: no result was reported',
			]),
		);
		if (scenario === "exhausts") {
			expect(state?.error).toContain(
				'Required verification remains unavailable after 1 retries: Acceptance criterion "visible"',
			);
			return;
		}
		// The optional failure stays a recorded limitation, not a blocker.
		expect(state?.candidate?.verification?.review.acceptance).toEqual([
			{ criterionId: "visible", outcome: "passed", evidence: "Saw after" },
			{ criterionId: "paged", outcome: "failed", evidence: "Order flips" },
		]);
		const head = state?.candidate?.commit ?? "";
		const restarted = new AgendaTaskManager({
			runtime: h.runtime,
			dbPath: join(h.root, "tasks.db"),
			globalSpecsDir: join(h.root, "specs"),
			watchFiles: false,
			automationEnabled: false,
		});
		cleanup.unshift(() => restarted.dispose());
		const run = restarted.getTaskRuns(task.taskId)[0];
		if (!run?.factory?.candidate?.verification) throw new Error("Missing run");
		const store = new SqliteAgendaTaskStore({
			dbPath: join(h.root, "tasks.db"),
		});
		try {
			// A report recorded before per-criterion results cannot satisfy them.
			const { acceptance: _, ...legacy } =
				run.factory.candidate.verification.review;
			store.updateRun(run.runId, {
				factory: {
					...run.factory,
					candidate: {
						...run.factory.candidate,
						verification: {
							...run.factory.candidate.verification,
							review: legacy,
						},
					},
				},
			});
			await expect(
				restarted.stampFactoryTask(task.taskId, head),
			).rejects.toThrow(
				'Required acceptance criteria are not met:\nAcceptance criterion "visible"',
			);
			store.updateRun(run.runId, { factory: run.factory });
		} finally {
			store.close();
		}
		await expect(
			restarted.stampFactoryTask(task.taskId, head),
		).resolves.toMatchObject({ taskId: task.taskId });
	});

	it("repairs a failed required criterion behind a bare verifier pass", async () => {
		let verifications = 0;
		const { h, create } = verifiedCriteria(async () =>
			verification([
				{
					criterionId: "visible",
					outcome: ++verifications === 1 ? "failed" : "passed",
					evidence:
						verifications === 1 ? "Card is empty after reload" : "Saw after",
				},
			]),
		);
		const task = await create();
		await h.start(task);
		await vi.waitFor(
			async () =>
				expect((await h.manager.getTask(task.taskId))?.status).toBe(
					"completed",
				),
			{ timeout: 15000 },
		);
		const state = h.manager.getTaskRuns(task.taskId)[0]?.factory;
		expect(state).toMatchObject({ phase: "ready", repairRound: 1 });
		expect(state?.verificationRetry).toBeUndefined();
		expect(h.builds()).toBe(2);
		expect(verifications).toBe(2);
		expect(
			state?.attempts?.find((attempt) => attempt.key === "builder:1")
				?.instructions,
		).toContain(
			'Acceptance criterion "visible" (The card shows after) failed: Card is empty after reload',
		);
		// App setup reaches only the verifier, through its role instructions.
		const setup = "Start with npm run dev; ready at :3000.";
		for (const [, assigned] of vi.mocked(h.runtime.runSession).mock.calls)
			expect(assigned.systemPrompt?.includes(setup) ?? false).toBe(
				assigned.instructions.startsWith("Verify the approved behavior"),
			);
	});

	it("rejects stale criterion mappings and briefs without criteria before approval", async () => {
		const h = harness();
		const cases: Array<[Partial<FactoryTaskConfig>, string]> = [
			[
				{
					acceptanceCriteria: [
						{
							id: "renamed",
							text: "Behavior",
							required: true,
							check: "Old check",
						},
					],
				},
				'names check "Old check", which is not an approved check',
			],
			[
				{
					acceptanceCriteria: [{ id: "visible", text: "Card", required: true }],
				},
				"needs a named approved check or a configured verifier",
			],
			[
				{ acceptanceCriteria: undefined },
				"Name the acceptance criteria before approval",
			],
		];
		for (const [factory, message] of cases) {
			const task = await h.create(2, factory);
			await expect(h.start(task)).rejects.toThrow(message);
		}
		expect(h.runtime.startSession).not.toHaveBeenCalled();
	});

	it("retains real code findings when a role also reports missing coverage", async () => {
		const h = harness({
			review: JSON.stringify({
				verdict: "changes_requested",
				summary: "Required behavior is broken",
				findings: ["Handle empty input"],
				coverage: {
					static: [],
					exercised: [],
					requiredGaps: ["Failure path not yet exercised"],
				},
			}),
		});
		const task = await h.create(0);
		await h.start(task);
		await vi.waitFor(
			async () =>
				expect((await h.manager.getTask(task.taskId))?.status).toBe("failed"),
			{ timeout: 15000 },
		);
		const state = h.manager.getTaskRuns(task.taskId)[0]?.factory;
		expect(state?.candidate?.reviews[0]?.review.findings).toEqual([
			"Handle empty input",
		]);
		expect(state?.verificationRetry).toBeUndefined();
		expect(state?.error).toContain("Repair limit (0)");
		expect(h.reviews()).toBe(1);
	});

	it("automatically retries PR repair verification without spending another code repair", async () => {
		const h = await followupHarness();
		const original = vi.mocked(h.runtime.runSession).getMockImplementation();
		if (!original) throw new Error("Missing runtime");
		let reviews = 0;
		h.runtime.runSession = vi.fn<AgendaTaskRuntime["runSession"]>(
			async (...args) => {
				if (
					args[1].instructions.startsWith("Independently review") &&
					++reviews === 1
				)
					return {
						status: "completed",
						summary: JSON.stringify({
							verdict: "pass",
							summary: "Review missing one criterion",
							findings: [],
							coverage: {
								static: [],
								exercised: [],
								requiredGaps: ["Trace the empty-input consumer"],
							},
						}),
					};
				return original(...args);
			},
		);
		expect(await h.follow()).toBe("repaired");
		expect(h.state()).toMatchObject({ repairRound: 1, verificationRetry: 1 });
		expect(h.builds()).toBe(2);
		expect(reviews).toBe(2);
		expect(h.runtime.runSession).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				instructions: expect.stringContaining("Trace the empty-input consumer"),
			}),
			expect.anything(),
		);
	});

	it("bounds true unavailable verification across automatic attempts and manual reruns", async () => {
		const gap = "Required execution environment unavailable";
		const h = harness({
			review: JSON.stringify({
				verdict: "pass",
				summary: "Required capability is missing",
				findings: [],
				coverage: { static: [], exercised: [], requiredGaps: [gap] },
			}),
		});
		const task = await h.create(2, { maxRuntimeRetries: 1 });
		await h.start(task);
		await vi.waitFor(
			async () =>
				expect((await h.manager.getTask(task.taskId))?.status).toBe("failed"),
			{ timeout: 15000 },
		);
		expect(h.reviews()).toBe(2);
		expect(h.builds()).toBe(1);
		expect(h.manager.getTaskRuns(task.taskId)[0]?.factory).toMatchObject({
			repairRound: 0,
			verificationRetry: 1,
			phase: "blocked",
			error: expect.stringContaining("unavailable after 1 retries"),
			candidate: {
				reviews: [{ review: { coverage: { requiredGaps: [gap] } } }],
			},
		});
		await h.manager.runTask(
			task.taskId,
			{ kind: "user" },
			task.revision,
			"test",
		);
		await vi.waitFor(
			async () =>
				expect((await h.manager.getTask(task.taskId))?.status).toBe("failed"),
			{ timeout: 15000 },
		);
		expect(h.reviews()).toBe(2);
		expect(h.builds()).toBe(1);
		expect(
			h.manager.getTaskRuns(task.taskId)[0]?.factory?.verificationRetry,
		).toBe(1);
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
		expect(state?.error).toBe(
			"This card reached its $0.05 spending limit. Raise the limit or stop here.",
		);
		expect(state?.repairRound).toBe(0);
	});

	it("fails fast on UI evidence outside the worktree without spending builder repairs", async () => {
		const h = harness();
		// The approved path is inside the worktree; the build links it outside.
		const outside = join(h.root, "private.png");
		writeFileSync(outside, "outside");
		h.runtime.runSession = vi.fn<AgendaTaskRuntime["runSession"]>(
			async (_id, task) => {
				writeFileSync(join(task.cwd ?? "", "feature.txt"), "after\n");
				mkdirSync(join(task.cwd ?? "", "evidence"), { recursive: true });
				const { symlinkSync } = await import("node:fs");
				symlinkSync(outside, join(task.cwd ?? "", "evidence", "shot.png"));
				return { status: "completed", summary: "Implemented" };
			},
		);
		const task = await h.create(2, {
			checks: [
				{
					name: "Screen",
					kind: "ui",
					command: "node -e ''",
					artifacts: ["evidence/shot.png"],
				},
			],
		});
		await h.start(task);
		await vi.waitFor(
			async () =>
				expect((await h.manager.getTask(task.taskId))?.status).toBe("failed"),
			{ timeout: 15000 },
		);
		const state = h.manager.getTaskRuns(task.taskId)[0]?.factory;
		expect(state?.error).toContain(
			"Check configuration blocked verification: Screen: Evidence must be inside the task worktree.",
		);
		expect(state?.repairRound).toBe(0);
		expect(h.runtime.runSession).toHaveBeenCalledTimes(1);
	});

	it("keeps the repair-limit error to one line per blocking check", async () => {
		const h = harness({ failures: 10 });
		const task = await h.create(0, {
			checks: [
				{
					name: "Feature behavior",
					kind: "test",
					command: `node -e "for(let i=0;i<300;i++)console.log('=== RUN Test'+i);console.log('FAIL feature.txt is wrong');process.exit(1)"`,
					artifacts: [],
				},
			],
		});
		await h.start(task);
		await vi.waitFor(
			async () =>
				expect((await h.manager.getTask(task.taskId))?.status).toBe("failed"),
			{ timeout: 15000 },
		);
		const error = (await h.manager.getTask(task.taskId))?.error ?? "";
		expect(error).toContain("Repair limit (0) reached.");
		expect(error).toContain(
			'- Check "Feature behavior" failed: exit 1: FAIL feature.txt is wrong',
		);
		expect(error).not.toContain("=== RUN");
		// The full log stays in the run's candidate evidence.
		const run = h.manager.getTaskRuns(task.taskId)[0];
		expect(run?.factory?.candidate?.checks[0]?.output).toContain(
			"=== RUN Test0",
		);
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
			// Each running unit counts $1 toward the cap until it reports usage,
			// so the limit leaves room for both units to run in parallel.
			maxCostUsd: 5,
			agents: {
				designer: {},
				planReviewers: [],
				implementers: [
					{
						modelSelection: {
							providerId: "test-provider",
							modelId: "alpha-model",
						},
					},
					{
						modelSelection: {
							providerId: "test-provider",
							modelId: "beta-model",
						},
					},
					{
						modelSelection: {
							providerId: "test-provider",
							modelId: "consumer-model",
						},
					},
				],
				reviewers: [{}],
			},
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
			state?.attempts
				?.filter((attempt) => attempt.key.startsWith("unit:"))
				.map((attempt) => [attempt.key, attempt.agent.modelSelection?.modelId])
				.sort(),
		).toEqual([
			["unit:alpha", "alpha-model"],
			["unit:beta", "beta-model"],
			["unit:consumer", "consumer-model"],
		]);
		for (const [, assigned] of vi.mocked(h.runtime.runSession).mock.calls) {
			if (
				assigned.instructions.includes("Your isolated implementation unit:")
			) {
				expect(assigned.instructions).toContain(task.instructions);
				expect(assigned.instructions).toContain(
					JSON.stringify(task.factory?.checks),
				);
				const model = assigned.instructions.includes("unit-alpha")
					? "alpha-model"
					: assigned.instructions.includes("unit-beta")
						? "beta-model"
						: "consumer-model";
				expect(assigned.modelSelection?.modelId).toBe(model);
			}
		}
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
	it("resumes an interrupted builder with its frozen agent after the roster changes", async () => {
		const h = await followupHarness();
		const run = h.manager.getTaskRuns(h.task.taskId)[0];
		const builder = run?.factory?.attempts?.find(
			(attempt) => attempt.role === "builder",
		);
		if (!run?.factory?.agents || !builder)
			throw new Error("Missing completed builder");
		let state: FactoryRunState = {
			...run.factory,
			candidate: undefined,
			agents: {
				...run.factory.agents,
				implementers: [
					{
						modelSelection: {
							providerId: "test-provider",
							modelId: "replacement",
						},
					},
				],
			},
			attempts: [{ ...builder, status: "running" }],
		};
		h.runtime.reconcileSession = vi.fn(async () => ({
			status: "resumable" as const,
		}));
		vi.mocked(h.runtime.startSession).mockClear();
		await runFactoryWorkflow({
			task: h.task,
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
		const resumed = vi
			.mocked(h.runtime.startSession)
			.mock.calls.find(
				([, , , options]) => options?.sessionId === builder.sessionId,
			);
		expect(resumed?.[0].modelSelection?.modelId).toBe("followup-writer");
		expect(resumed?.[3]?.factoryAgent).toEqual(builder.agent);
		expect(state.phase).toBe("ready");
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
		// The description is updated only after the pushed repair is confirmed.
		expect(
			h.commands.mock.calls.map(([command]) => command.args.slice(0, 2)),
		).toEqual([
			["push", "origin"],
			["pr", "comment"],
			// Read-only: origin, the changed files and the PR template.
			["remote", "get-url"],
			["diff", "--numstat"],
			["ls-tree", "--name-only"],
			["pr", "view"],
			["pr", "edit"],
		]);
		expect(h.description()).toMatch(
			/^Human summary\.\n\n<!-- cline-factory-evidence:start -->/,
		);
		expect(h.description()).toContain("## Testing\n\nRan:");
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
		await expect(h.follow()).rejects.toMatchObject({
			name: "FactoryDecisionError",
			message: expect.stringContaining(
				"Outside-contributor feedback needs maintainer confirmation",
			),
		});
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
	it("keeps the run's review requirement and verification setup out of the follow-up description", async () => {
		const h = await followupHarness();
		h.patchState({
			humanReview: { required: false, reason: "local change" },
			verificationProfile: { hash: "a".repeat(64), preflight: "passed" },
		});
		expect(await h.follow()).toBe("repaired");
		expect(h.description()).toContain("## Testing\n\nRan:");
		expect(h.description()).not.toMatch(
			/review required|sampled|feedback|preflight|start-up check|aaaaaaaaaaaa/i,
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
	it.each([
		false,
		true,
	])("repairs a failed real check with the approved context and retains the isolated workspace (interrupted=%s)", async (interrupted) => {
		const h = harness({ failures: 1 });
		if (interrupted)
			h.runtime.reconcileSession = vi.fn(async () => ({
				status: "resumable" as const,
			}));
		if (interrupted) failReconcileOnce(h.runtime);
		const original = h.runtime.runSession;
		let pauseRepair = interrupted;
		h.runtime.runSession = vi.fn<AgendaTaskRuntime["runSession"]>(
			async (id, assigned, run) => {
				if (pauseRepair && h.builds() === 1) {
					pauseRepair = false;
					throw new Error("Repair transport interrupted");
				}
				return original(id, assigned, run);
			},
		);
		const task = await h.create();
		await h.start(task);
		if (interrupted) {
			await vi.waitFor(
				async () =>
					expect((await h.manager.getTask(task.taskId))?.status).toBe("failed"),
				{ timeout: 15000 },
			);
			await h.manager.runTask(
				task.taskId,
				{ kind: "user" },
				task.revision,
				"test",
			);
		}
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
		const repair = state?.attempts?.find(
			(attempt) => attempt.key === "builder:1",
		);
		expect(repair).toBeDefined();
		const repairCalls = vi
			.mocked(h.runtime.runSession)
			.mock.calls.filter(([id]) => id === repair?.sessionId);
		expect(repairCalls).toHaveLength(interrupted ? 2 : 1);
		// The failed check is reported against the criterion it proves.
		expect(state?.repairInstructions).toContain(
			'Acceptance criterion "feature-after" (feature.txt contains after) failed: Check "Feature behavior" failed (exit 1)',
		);
		for (const [, assigned] of repairCalls) {
			expect(assigned.instructions).toContain(task.instructions);
			expect(assigned.instructions).toContain(
				JSON.stringify(task.factory?.checks),
			);
			expect(assigned.instructions).toContain(
				JSON.stringify(task.factory?.acceptanceCriteria),
			);
			expect(assigned.instructions).toContain(state?.repairInstructions);
		}
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
				implementers: [agent("writer")],
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
		"recovered-missing",
		"stale",
		"changed-candidate",
	])("validates verifier %s evidence without treating collection gaps as code defects", async (scenario) => {
		const png = Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=",
			"base64",
		);
		let verifications = 0;
		const succeeds = scenario === "fresh" || scenario === "recovered-missing";
		const h = harness({
			verifier: async (task) => {
				verifications++;
				const dir = join(task.cwd ?? "", ".evidence");
				mkdirSync(dir, { recursive: true });
				if (
					scenario === "fresh" ||
					(scenario === "recovered-missing" && verifications === 2)
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
					coverage: {
						static: ["Verified candidate source"],
						exercised: ["Ran the behavior harness"],
						requiredGaps: [],
						limitations: [
							"Native interaction is outside the approved browser scope",
						],
					},
				});
			},
		});
		const task = await h.create(0, {
			maxRuntimeRetries: 1,
			agents: {
				designer: {},
				planReviewers: [],
				implementers: [{}],
				reviewers: [{}],
				verifier: { artifacts: [".evidence/screen.png"] },
			},
			checks: [
				{
					name: "Behavior and evidence setup",
					kind: "api",
					artifacts: [],
					command: `node -e "const fs=require('fs');fs.mkdirSync('.evidence',{recursive:true});fs.appendFileSync('.evidence/check-count','x');if(fs.readFileSync('feature.txt','utf8').trim()!=='after')process.exit(1);${scenario === "stale" ? `fs.writeFileSync('.evidence/screen.png',Buffer.from('${png.toString("base64")}','base64'));` : ""}"`,
				},
			],
		});
		await h.start(task);
		await vi.waitFor(
			async () =>
				expect((await h.manager.getTask(task.taskId))?.status).toBe(
					succeeds ? "completed" : "failed",
				),
			{ timeout: 15000 },
		);
		const state = h.manager.getTaskRuns(task.taskId)[0]?.factory;
		expect(
			readFileSync(
				join(state?.workspace.path ?? "", ".evidence/check-count"),
				"utf8",
			),
		).toBe("x");
		if (succeeds) {
			expect(state?.candidate?.verification?.artifacts).toHaveLength(1);
			const artifact = state?.candidate?.verification?.artifacts[0];
			expect(artifact && readFileSync(artifact.path)).toEqual(png);
			expect(h.reviews()).toBe(1);
			const rounds = scenario === "recovered-missing" ? 1 : 0;
			expect(state?.repairRound).toBe(0);
			expect(state?.verificationRetry ?? 0).toBe(rounds);
			expect(h.builds()).toBe(1);
			expect(verifications).toBe(rounds + 1);
			expect(state?.candidate?.verification?.review.verdict).toBe("pass");
			if (scenario === "recovered-missing") {
				const verificationPrompts = vi
					.mocked(h.runtime.runSession)
					.mock.calls.filter(([, assigned]) =>
						assigned.instructions.startsWith("Verify the approved behavior"),
					);
				expect(verificationPrompts[1]?.[1].instructions).toContain(
					"screen.png",
				);
				expect(verificationPrompts[1]?.[1].instructions).toContain(
					"REQUIRED GAPS FROM THE PREVIOUS VERIFICATION ATTEMPT",
				);
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
				expect(state?.candidate?.verification?.review.findings).toEqual([]);
				expect(state?.candidate?.verification?.review.coverage).toMatchObject({
					static: ["Verified candidate source"],
					exercised: ["Ran the behavior harness"],
					requiredGaps: [expect.stringContaining("screen.png")],
					limitations: [
						"Native interaction is outside the approved browser scope",
					],
				});
				expect(state?.verificationRetry).toBe(1);
				expect(verifications).toBe(2);
				expect(state?.error).toContain(
					"verification remains unavailable after 1 retries",
				);
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
				implementers: [{}],
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
					acceptanceCriteria: task.factory?.acceptanceCriteria,
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
			acceptanceCriteria: [
				{
					id: "arrow-keys",
					text: "Arrow keys move focus between cards on desktop",
					required: true,
					check: "Keyboard navigation",
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
			factory: {
				checks: design.checks,
				acceptanceCriteria: design.acceptanceCriteria,
				documents,
			},
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
		expect(prompt).toContain(JSON.stringify(task.factory?.acceptanceCriteria));
		expect(prompt).toContain(
			"every criterion must name one of the listed checks",
		);
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
	it("preserves a user edit made during the interview and scopes the edited brief", async () => {
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
					acceptanceCriteria: task.factory?.acceptanceCriteria,
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
		// The stale interview's brief is never saved over the edit; the edited
		// brief is interviewed again instead of waiting on a person.
		const interviews = vi.mocked(h.runtime.runDesignSession).mock.calls;
		finish();
		await vi.waitFor(async () =>
			expect(
				(await h.manager.getTask(task.taskId))?.factoryDesignProgress?.revision,
			).toBeGreaterThan(edited.revision),
		);
		expect(interviews).toHaveLength(2);
		expect(interviews[1]?.[1].instructions).toContain(edited.instructions);
		expect((await h.manager.getTask(task.taskId))?.error).toBeUndefined();
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

describe("Factory replay", () => {
	async function completedSource(factory: Partial<FactoryTaskConfig> = {}) {
		const h = harness();
		// A cost budget admits later sessions only when earlier spend is known.
		h.runtime.getSessionUsage = async () => ({
			inputTokens: 10,
			outputTokens: 5,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0.01,
		});
		const source = await h.create(2, factory);
		const { run } = await h.start(source);
		await vi.waitFor(
			async () =>
				expect(["approved", "in_progress"]).not.toContain(
					(await h.manager.getTask(source.taskId))?.status,
				),
			{ timeout: 15000 },
		);
		const finished = await h.manager.getTask(source.taskId);
		expect(finished?.status, finished?.error).toBe("completed");
		if (!run?.factory) throw new Error("Missing source run");
		return { h, source, run, state: run.factory };
	}

	it("creates locked variants once per comparison and finds them by run or comparison", async () => {
		const { h, source, run, state } = await completedSource({ maxCostUsd: 5 });
		const recipe = createFactoryWorkflowRecipe({
			name: "Two reviewers",
			config: { agents: { reviewers: [{}, {}] } },
		});
		const request = {
			taskId: source.taskId,
			runId: run.runId,
			comparisonId: "compare-1",
			variants: [{ label: "Original" }, { label: "Two reviewers", recipe }],
			actor: { kind: "user" as const },
		};
		const created = await h.manager.replayFactoryTask(request);
		const [original, variant] = created;
		expect(original).toMatchObject({
			status: "pending_approval",
			workspaceRoot: source.workspaceRoot,
			instructions: source.instructions,
			originTaskId: source.taskId,
			factory: {
				checks: source.factory?.checks,
				maxCostUsd: 5,
				replay: {
					sourceRunId: run.runId,
					comparisonId: "compare-1",
					variantIndex: 0,
					baseCommit: state.workspace.baseCommit,
				},
			},
			// No plan reviewers are configured, so nothing is left to review.
			factoryDesignProgress: { phase: "complete" },
		});
		// A recipe replaces workflow settings it omits instead of inheriting them.
		expect(variant?.factory?.maxCostUsd).toBeUndefined();
		expect(variant?.factory?.agents?.reviewers).toHaveLength(2);
		expect(variant?.factory?.workflow).toEqual({
			name: "Two reviewers",
			revision: recipe.revision,
		});

		const ids = created.map((task) => task.taskId);
		expect(
			(await h.manager.replayFactoryTask(request)).map((task) => task.taskId),
		).toEqual(ids);
		await expect(
			h.manager.replayFactoryTask({
				...request,
				variants: [{ label: "Different" }],
			}),
		).rejects.toThrow("already used for different replay inputs");
		const listed = async (filter: {
			factoryReplaySourceRunId?: string;
			factoryComparisonId?: string;
		}) =>
			(
				await h.manager.listTasks({
					scope: "workspace",
					workspaceRoot: h.repo,
					...filter,
				})
			)
				.map((task) => task.taskId)
				.sort();
		expect(await listed({ factoryComparisonId: "compare-1" })).toEqual(
			[...ids].sort(),
		);
		expect(await listed({ factoryReplaySourceRunId: run.runId })).toEqual(
			[...ids].sort(),
		);
		expect(await listed({ factoryComparisonId: "compare-2" })).toEqual([]);

		if (!original) throw new Error("Missing replay");
		await expect(
			h.manager.updateTask({
				taskId: original.taskId,
				expectedRevision: original.revision,
				instructions: "A different brief",
				updatedBy: { kind: "user" },
			}),
		).rejects.toThrow("Replay inputs are fixed");
	});

	it("keeps the source acceptance rubric and app setup across workflow variants", async () => {
		const { h, create } = verifiedCriteria(async () =>
			verification([
				{ criterionId: "visible", outcome: "passed", evidence: "Saw after" },
			]),
		);
		const source = await create();
		const { run } = await h.start(source);
		await vi.waitFor(
			async () =>
				expect((await h.manager.getTask(source.taskId))?.status).toBe(
					"completed",
				),
			{ timeout: 15000 },
		);
		const completed = h.manager.getTaskRuns(source.taskId)[0];
		if (!run || !completed?.factory) throw new Error("Missing source run");
		const setup = source.factory?.agents?.verifier?.instructions;
		const recipe = (name: string, verifier?: Record<string, unknown>) =>
			createFactoryWorkflowRecipe({
				name,
				config: { agents: { reviewers: [{}], verifier } },
			});
		const otherModel = {
			modelSelection: { providerId: "test-provider", modelId: "other" },
		};
		const inherited = recipe("Other verifier model", otherModel);
		const explicit = recipe("Staging verifier", {
			...otherModel,
			instructions: "Use the staging URL.",
		});
		const [kept, replaced] = await h.manager.replayFactoryTask({
			taskId: source.taskId,
			runId: run.runId,
			comparisonId: "rubric",
			variants: [
				{ label: "Inherited setup", recipe: inherited },
				{ label: "Explicit setup", recipe: explicit },
			],
			actor: { kind: "user" },
		});
		for (const variant of [kept, replaced])
			expect(variant?.factory?.acceptanceCriteria).toEqual(
				source.factory?.acceptanceCriteria,
			);
		expect(kept?.factory?.agents?.verifier).toMatchObject({
			...otherModel,
			instructions: setup,
		});
		// The effective workflow identity records the inherited setup.
		expect(kept?.factory?.workflow?.name).toBe(inherited.name);
		expect(kept?.factory?.workflow?.revision).not.toBe(inherited.revision);
		expect(replaced?.factory?.agents?.verifier?.instructions).toBe(
			"Use the staging URL.",
		);
		const request = {
			taskId: source.taskId,
			runId: run.runId,
			comparisonId: "no-verifier",
			variants: [{ label: "No verifier", recipe: recipe("No verifier") }],
			actor: { kind: "user" as const },
		};
		await expect(h.manager.replayFactoryTask(request)).rejects.toThrow(
			'cannot prove the source acceptance criteria. Acceptance criterion "visible" needs a named approved check or a configured verifier.',
		);
		const state = completed.factory;
		const snapshot = state.inputSnapshot;
		if (!snapshot) throw new Error("Missing snapshot");
		expect(() =>
			createFactoryReplayInputs({
				source,
				run: {
					...completed,
					factory: {
						...state,
						inputSnapshot: {
							...snapshot,
							factory: { ...snapshot.factory, acceptanceCriteria: undefined },
						},
					},
				},
				request: { ...request, variants: [{ label: "Original" }] },
			}),
		).toThrow("predates named acceptance criteria");
	});

	it("repeats only plan review, then executes from the saved base commit", async () => {
		const { h, source, run, state } = await completedSource();
		writeFileSync(join(h.repo, "feature.txt"), "moved\n");
		execFileSync("git", ["-C", h.repo, "commit", "-am", "Move the source"]);
		h.runtime.startDesignReviewSession = vi.fn<
			NonNullable<AgendaTaskRuntime["startDesignReviewSession"]>
		>(async (_task, _client, _agent, sessionId) => ({
			sessionId: sessionId ?? "plan-review",
		}));
		const runDesign = h.runtime.runDesignSession;
		if (!runDesign) throw new Error("Missing design runtime");
		vi.mocked(runDesign).mockImplementation(async () => ({
			status: "completed",
			summary: JSON.stringify({
				verdict: "pass",
				findings: [],
				summary: "The saved brief is sound.",
			}),
		}));
		const [replay] = await h.manager.replayFactoryTask({
			taskId: source.taskId,
			runId: run.runId,
			comparisonId: "compare-review",
			variants: [
				{
					label: "Plan reviewed",
					recipe: createFactoryWorkflowRecipe({
						name: "Plan reviewed",
						config: { agents: { planReviewers: [{}] } },
					}),
				},
			],
			actor: { kind: "user" },
		});
		if (!replay) throw new Error("Missing replay");
		// Queued for review, but no review is live before the queue starts one.
		expect(replay.factoryDesignProgress).toBeUndefined();
		await vi.waitFor(async () =>
			expect(
				(await h.manager.getTask(replay.taskId))?.factoryDesignProgress?.phase,
			).toBe("complete"),
		);
		const reviewed = await h.manager.getTask(replay.taskId);
		if (!reviewed) throw new Error("Missing reviewed replay");
		expect(h.runtime.startDesignSession).not.toHaveBeenCalled();
		expect(reviewed).toMatchObject({
			revision: replay.revision,
			instructions: source.instructions,
			factory: { checks: source.factory?.checks },
		});
		expect(reviewed.originSessionId).toBe(
			reviewed.factoryDesignReview?.reviews[0]?.sessionId,
		);

		await h.start(reviewed);
		await vi.waitFor(
			async () =>
				expect((await h.manager.getTask(replay.taskId))?.status).toBe(
					"completed",
				),
			{ timeout: 15000 },
		);
		const workspace = h.manager.getTaskRuns(replay.taskId)[0]?.factory
			?.workspace;
		expect(workspace).toMatchObject({
			baseCommit: state.workspace.baseCommit,
			baseBranch: state.workspace.baseBranch,
		});
		expect(workspace?.path).not.toBe(state.workspace.path);
		expect(
			execFileSync("git", ["-C", h.repo, "rev-parse", "HEAD"], {
				encoding: "utf8",
			}).trim(),
		).not.toBe(state.workspace.baseCommit);
		expect((await h.manager.getTask(replay.taskId))?.workspaceRoot).toBe(
			source.workspaceRoot,
		);
	});

	it("queues plan review again when an archived replay is restored", async () => {
		const { h, source, run } = await completedSource();
		h.runtime.startDesignReviewSession = vi.fn<
			NonNullable<AgendaTaskRuntime["startDesignReviewSession"]>
		>(async (_task, _client, _agent, sessionId) => ({
			sessionId: sessionId ?? "plan-review",
		}));
		const runDesign = h.runtime.runDesignSession;
		if (!runDesign) throw new Error("Missing design runtime");
		let stopReview: (() => void) | undefined;
		vi.mocked(runDesign).mockImplementation(
			() =>
				new Promise((resolve) => {
					stopReview = () => resolve({ status: "cancelled" });
				}),
		);
		vi.mocked(h.runtime.abortSession).mockImplementation(async () =>
			stopReview?.(),
		);
		const [replay] = await h.manager.replayFactoryTask({
			taskId: source.taskId,
			runId: run.runId,
			comparisonId: "restore-review",
			variants: [
				{
					label: "Plan reviewed",
					recipe: createFactoryWorkflowRecipe({
						name: "Plan reviewed",
						config: { agents: { planReviewers: [{}] } },
					}),
				},
			],
			actor: { kind: "user" },
		});
		if (!replay) throw new Error("Missing replay");
		await vi.waitFor(() => expect(stopReview).toBeDefined());
		await h.manager.archiveTask(
			replay.taskId,
			{ kind: "user" },
			replay.revision,
		);
		const archived = await h.manager.getTask(replay.taskId);
		if (!archived) throw new Error("Missing archived replay");
		vi.mocked(runDesign).mockResolvedValue({
			status: "completed",
			summary: JSON.stringify({
				verdict: "pass",
				findings: [],
				summary: "The saved brief is sound.",
			}),
		});
		await h.manager.restoreTask(
			replay.taskId,
			{ kind: "user" },
			archived.revision,
		);
		await vi.waitFor(async () =>
			expect(
				(await h.manager.getTask(replay.taskId))?.factoryDesignProgress?.phase,
			).toBe("complete"),
		);
		const reviewed = await h.manager.getTask(replay.taskId);
		if (!reviewed) throw new Error("Missing reviewed replay");
		await expect(
			h.manager.approveTask(replay.taskId, { kind: "user" }, reviewed.revision),
		).resolves.toMatchObject({ status: "approved" });
		expect(h.runtime.startDesignSession).not.toHaveBeenCalled();
	});

	it("shares concurrent requests and restores a reviewer-less replay without its source", async () => {
		const selection: FactoryReviewSelection = {
			impact: "local",
			rationale: "Feature-only behavior",
			affectedPaths: ["feature.txt"],
			consumers: ["feature reader"],
			planReviewerIndices: [],
			reviewerIndices: [0],
		};
		const h = harness({ reviewSelection: selection, hold: true });
		const created = await h.create(2, {
			reviewMode: "adaptive",
			agents: {
				designer: {},
				planReviewers: [],
				implementers: [{}],
				reviewers: [{}],
			},
		});
		await h.manager.startFactoryDesign(created.taskId);
		await vi.waitFor(async () =>
			expect(
				(await h.manager.getTask(created.taskId))?.factoryDesignProgress?.phase,
			).toBe("complete"),
		);
		const source = await h.manager.getTask(created.taskId);
		if (!source) throw new Error("Missing scoped source");
		const { run } = await h.start(source);
		await vi.waitFor(() => expect(h.builds()).toBe(1));
		await h.runtime.abortSession("held-build", "Release the source build");
		await vi.waitFor(
			async () =>
				expect((await h.manager.getTask(source.taskId))?.status).toBe(
					"completed",
				),
			{ timeout: 15000 },
		);
		if (!run) throw new Error("Missing source run");
		const request = {
			taskId: source.taskId,
			runId: run.runId,
			comparisonId: "concurrent",
			variants: [{ label: "Original" }, { label: "Again" }],
			actor: { kind: "user" as const },
		};
		const [first, second] = await Promise.all([
			h.manager.replayFactoryTask(request),
			h.manager.replayFactoryTask(request),
		]);
		expect(second.map((task) => task.taskId)).toEqual(
			first.map((task) => task.taskId),
		);
		// Conflicting inputs for one comparison: one wins whole, the other changes nothing.
		const settled = await Promise.allSettled([
			h.manager.replayFactoryTask({ ...request, comparisonId: "conflict" }),
			h.manager.replayFactoryTask({
				...request,
				comparisonId: "conflict",
				variants: [{ label: "Other" }],
			}),
		]);
		const winner = settled.find((result) => result.status === "fulfilled");
		const loser = settled.find((result) => result.status === "rejected");
		if (winner?.status !== "fulfilled" || loser?.status !== "rejected")
			throw new Error("Expected exactly one conflicting request to win");
		expect(String(loser.reason)).toContain(
			"already used for different replay inputs",
		);
		const conflict = await h.manager.listTasks({
			scope: "workspace",
			workspaceRoot: h.repo,
			factoryComparisonId: "conflict",
		});
		expect(conflict.map((task) => task.taskId).sort()).toEqual(
			winner.value.map((task) => task.taskId).sort(),
		);

		const [replay] = first;
		if (!replay) throw new Error("Missing replay");
		expect(replay.factory?.replay?.reviewSelection).toEqual(selection);
		expect(replay.factoryDesignProgress).toMatchObject({
			phase: "complete",
			reviewSelection: selection,
		});
		const completedSource = await h.manager.getTask(source.taskId);
		if (!completedSource) throw new Error("Missing completed source");
		// Deleting the source also deletes its runs; the replay keeps its selection.
		await h.manager.deleteTask(
			source.taskId,
			{ kind: "user" },
			completedSource.revision,
		);
		await h.start(replay);
		await vi.waitFor(() => expect(h.builds()).toBe(2));
		await h.manager.archiveTask(
			replay.taskId,
			{ kind: "user" },
			replay.revision,
		);
		await vi.waitFor(() =>
			expect(h.manager.getTaskRuns(replay.taskId)[0]?.status).toBe("cancelled"),
		);
		const archived = await h.manager.getTask(replay.taskId);
		expect(archived).toMatchObject({
			status: "cancelled",
			error: "Task archived.",
		});
		if (!archived) throw new Error("Missing archived replay");
		const startDesign = h.runtime.startDesignSession;
		if (!startDesign) throw new Error("Missing design runtime");
		const designs = vi.mocked(startDesign).mock.calls.length;
		const restored = await h.manager.restoreTask(
			replay.taskId,
			{ kind: "user" },
			archived.revision,
		);
		expect(restored.revision).toBeGreaterThan(archived.revision);
		expect(restored).toMatchObject({
			status: "pending_approval",
			factoryDesignProgress: {
				phase: "complete",
				revision: restored.revision,
				reviewSelection: selection,
				agents: replay.factoryDesignProgress?.agents,
			},
		});
		// No designer or synthetic transcript was attached.
		expect(restored.originSessionId).toBeUndefined();
		expect(restored.factoryDesignSessionIds).toBeUndefined();
		await expect(
			h.manager.approveTask(replay.taskId, { kind: "user" }, restored.revision),
		).resolves.toMatchObject({ status: "approved" });
		expect(startDesign).toHaveBeenCalledTimes(designs);
	});
});

const APP_SCRIPT = `const fs = require("node:fs");
const net = require("node:net");
const [events, mode] = process.argv.slice(2);
const port = Number(process.env.FACTORY_APP_PORT);
const log = (line) => fs.appendFileSync(events, line + "\\n");
if (mode === "setup") log("setup " + port);
else if (mode === "cleanup") log("cleanup " + port);
else if (mode === "health") {
	const deadline = Date.now() + 5000;
	const probe = () =>
		net
			.connect(port, "127.0.0.1")
			.on("connect", () => process.exit(0))
			.on("error", () =>
				Date.now() < deadline ? setTimeout(probe, 50) : process.exit(1),
			);
	probe();
} else if (mode === "serve") {
	if (fs.existsSync(events + ".broken")) {
		console.error("boot failure");
		process.exit(2);
	}
	log("start " + port + " " + process.env.APP_PORT);
	require("node:http")
		.createServer((_, response) => response.end("app ok"))
		.listen(port, "127.0.0.1");
}
`;

function listening(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = connect(port, "127.0.0.1");
		socket.once("connect", () => {
			socket.destroy();
			resolve(true);
		});
		socket.once("error", () => resolve(false));
	});
}

/** A process standing in for an app a crashed hub left running, carrying its token. */
function plantLeftover() {
	const token = `leftover-${Math.random().toString(36).slice(2)}`;
	const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
		detached: true,
		stdio: "ignore",
		env: { ...process.env, FACTORY_APP_TOKEN: token },
	});
	const exited = new Promise((resolve) =>
		child.once("exit", (_code, signal) => resolve(signal)),
	);
	cleanup.push(async () => {
		child.kill("SIGKILL");
	});
	if (!child.pid) throw new Error("Leftover app did not start");
	return {
		exited,
		record: {
			key: "verifier:0:interrupted:0",
			port: 45_678,
			token,
			pid: child.pid,
		},
	};
}

function environmentHarness(
	verify: (app?: { url: string; port: number }) => Promise<string> = async (
		app,
	) => {
		if (app)
			expect(await (await fetch(`http://127.0.0.1:${app.port}`)).text()).toBe(
				"app ok",
			);
		return verification();
	},
) {
	const prompts: string[] = [];
	const records: Array<FactoryRunState["verifierEnvironment"]> = [];
	let taskId = "";
	const h = harness({
		verifier: async (task) => {
			prompts.push(task.instructions);
			records.push(
				h.manager.getTaskRuns(taskId)[0]?.factory?.verifierEnvironment,
			);
			const match = /already running at (http:\/\/localhost:(\d+))/.exec(
				task.instructions,
			);
			return verify(
				match?.[1] ? { url: match[1], port: Number(match[2]) } : undefined,
			);
		},
	});
	const script = join(h.root, "app.cjs");
	const eventsPath = join(h.root, "app-events.log");
	writeFileSync(script, APP_SCRIPT);
	const command = (mode: string) =>
		[process.execPath, script, eventsPath, mode]
			.map((part) => JSON.stringify(part))
			.join(" ");
	const environment: FactoryAppEnvironment = {
		setup: command("setup"),
		start: command("serve"),
		healthcheck: command("health"),
		cleanup: command("cleanup"),
		portEnv: "APP_PORT",
	};
	const create = async (
		appEnvironment: FactoryAppEnvironment = environment,
		factory: Partial<FactoryTaskConfig> = {},
	) => {
		const task = await h.create(2, {
			...factory,
			agents: {
				designer: {},
				planReviewers: [],
				implementers: [{}],
				reviewers: [{}],
				verifier: {
					instructions: "Open the card and check it.",
					environment: appEnvironment,
				},
			},
		});
		taskId = task.taskId;
		return task;
	};
	const settle = async (id: string) => {
		await vi.waitFor(
			async () =>
				expect(["approved", "in_progress"]).not.toContain(
					(await h.manager.getTask(id))?.status,
				),
			{ timeout: 15000 },
		);
		return h.manager.getTaskRuns(id)[0]?.factory;
	};
	return {
		h,
		create,
		settle,
		command,
		environment,
		prompts,
		records,
		events: () =>
			existsSync(eventsPath)
				? readFileSync(eventsPath, "utf8").split("\n").filter(Boolean)
				: [],
		breakStart: () => writeFileSync(`${eventsPath}.broken`, ""),
		fixStart: () => rmSync(`${eventsPath}.broken`),
	};
}

describe.skipIf(process.platform === "win32")(
	"Verifier app environment",
	() => {
		const managedSentence =
			"Start the application as described by any app setup in your role instructions and wait for its ready signal. Stop every server or process you started before returning, including after failures, and state the cleanup result in summary.";

		it("keeps today's verifier prompt and starts nothing without an environment", async () => {
			const prompts: string[] = [];
			const { h, create } = verifiedCriteria(async (task) => {
				prompts.push(task.instructions);
				return verification([
					{ criterionId: "visible", outcome: "passed", evidence: "Saw after" },
				]);
			});
			const task = await create();
			await h.start(task);
			await vi.waitFor(
				async () =>
					expect((await h.manager.getTask(task.taskId))?.status).toBe(
						"completed",
					),
				{ timeout: 15000 },
			);
			expect(prompts).toHaveLength(1);
			expect(prompts[0]).toContain(
				`missing verifier evidence is not a builder defect. ${managedSentence} Return only JSON`,
			);
			expect(prompts[0]).not.toContain("FACTORY APP ENVIRONMENT");
			const state = h.manager.getTaskRuns(task.taskId)[0]?.factory;
			expect(state?.verifierEnvironment).toBeUndefined();
			expect(existsSync(join(h.root, "factory", "factory-app-logs"))).toBe(
				false,
			);
		});

		it("starts the app on its own port before the verifier and stops it after success", async () => {
			const e = environmentHarness();
			const task = await e.create();
			await e.h.start(task);
			const state = await e.settle(task.taskId);
			expect((await e.h.manager.getTask(task.taskId))?.status).toBe(
				"completed",
			);
			const record = e.records[0];
			if (!record) throw new Error("The verifier ran without a recorded app");
			const { port } = record;
			expect(record).toEqual({
				key: `verifier:0:${state?.candidate?.commit}:0`,
				port,
				token: expect.any(String),
				setupPid: expect.any(Number),
				pid: expect.any(Number),
			});
			expect(e.events()).toEqual([
				`setup ${port}`,
				`start ${port} ${port}`,
				`cleanup ${port}`,
			]);
			const prompt = e.prompts[0] ?? "";
			expect(prompt).toContain(
				`FACTORY APP ENVIRONMENT: the application is already running at http://localhost:${port} (port ${port})`,
			);
			expect(prompt).toContain("do not start, restart or stop it");
			expect(prompt).not.toContain(managedSentence);
			expect(state?.verifierEnvironment).toBeUndefined();
			expect(await listening(port)).toBe(false);
			// The log lives in Factory storage, so the candidate worktree stays clean.
			const logPath =
				/its output is logged at (\S+)\. Factory/.exec(prompt)?.[1] ?? "";
			expect(
				logPath.startsWith(join(e.h.root, "factory", "factory-app-logs")),
			).toBe(true);
			expect(readFileSync(logPath, "utf8")).toContain("$ setup");
			expect(
				execFileSync(
					"git",
					[
						"-C",
						state?.workspace.path ?? "",
						"status",
						"--porcelain",
						"--untracked-files=all",
					],
					{ encoding: "utf8" },
				),
			).toBe("");
		});

		it("runs only setup and hands the verifier a port for a setup-only environment", async () => {
			const e = environmentHarness();
			const task = await e.create({ setup: e.command("setup") });
			await e.h.start(task);
			const state = await e.settle(task.taskId);
			expect(state?.phase).toBe("ready");
			const port = e.records[0]?.port;
			// Setup-only: no start process, so no app pid is recorded.
			expect(e.records[0]).toEqual({
				key: expect.any(String),
				port,
				token: expect.any(String),
				setupPid: expect.any(Number),
			});
			expect(e.events()).toEqual([`setup ${port}`]);
			expect(e.prompts[0]).toContain(
				`FACTORY APP ENVIRONMENT: Factory already ran the app setup. Start the application as described in your role instructions on port ${port} (http://localhost:${port})`,
			);
		});

		it("stops the app after the verifier fails", async () => {
			const e = environmentHarness(async () => "not a verification result");
			const task = await e.create(undefined, { maxRuntimeRetries: 0 });
			await e.h.start(task);
			const state = await e.settle(task.taskId);
			expect(state).toMatchObject({
				phase: "blocked",
				error: expect.stringContaining("Factory verifier retry limit reached"),
			});
			const port = e.records[0]?.port ?? 0;
			expect(e.events()).toContain(`cleanup ${port}`);
			expect(state?.verifierEnvironment).toBeUndefined();
			expect(await listening(port)).toBe(false);
		});

		it("stops the app when the run is cancelled during verification", async () => {
			let release: () => void = () => {};
			const e = environmentHarness(
				() =>
					new Promise((resolve) => {
						release = () => resolve(verification());
					}),
			);
			const task = await e.create();
			await e.h.start(task);
			await vi.waitFor(() => expect(e.prompts).toHaveLength(1), {
				timeout: 15000,
			});
			const port = e.records[0]?.port ?? 0;
			expect(await listening(port)).toBe(true);
			await e.h.manager.cancelTask(
				task.taskId,
				{ kind: "user" },
				task.revision,
			);
			release();
			await vi.waitFor(() => expect(e.events()).toContain(`cleanup ${port}`), {
				timeout: 15000,
			});
			await vi.waitFor(async () => expect(await listening(port)).toBe(false));
			expect((await e.h.manager.getTask(task.taskId))?.status).toBe(
				"cancelled",
			);
		});

		it("blocks with the failing stage without spending verifier sessions or repairs, then resumes at verification", async () => {
			const e = environmentHarness();
			e.breakStart();
			const checks = vi.spyOn(factoryLocal, "verifyFactoryChecks");
			try {
				const task = await e.create();
				await e.h.start(task);
				const blocked = await e.settle(task.taskId);
				expect((await e.h.manager.getTask(task.taskId))?.status).toBe("failed");
				expect(blocked).toMatchObject({ phase: "blocked", repairRound: 0 });
				expect(blocked?.error).toContain(
					"Verifier app environment failed (start)",
				);
				expect(blocked?.error).toContain("boot failure");
				expect(
					blocked?.attempts?.filter((attempt) => attempt.role !== "builder"),
				).toEqual([]);
				expect(e.prompts).toEqual([]);
				expect(e.h.reviews()).toBe(0);
				expect(blocked?.verifierEnvironment).toBeUndefined();
				expect(e.events().at(-1)).toMatch(/^cleanup \d+$/);

				e.fixStart();
				await e.h.manager.runTask(
					task.taskId,
					{ kind: "user" },
					task.revision,
					"test",
				);
				const resumed = await e.settle(task.taskId);
				expect((await e.h.manager.getTask(task.taskId))?.status).toBe(
					"completed",
				);
				expect(resumed?.repairRound).toBe(0);
				expect(e.prompts).toHaveLength(1);
				expect(e.h.builds()).toBe(1);
				expect(checks).toHaveBeenCalledTimes(1);
			} finally {
				checks.mockRestore();
			}
		});

		it("stops an app left running by an interrupted run before resuming", async () => {
			const e = environmentHarness();
			const task = await e.create();
			await e.h.start(task);
			const finished = await e.settle(task.taskId);
			const run = e.h.manager.getTaskRuns(task.taskId)[0];
			if (!run || !finished) throw new Error("Missing finished run");
			const leftover = plantLeftover();
			let state: FactoryRunState = {
				...finished,
				verifierEnvironment: leftover.record,
			};
			const current = await e.h.manager.getTask(task.taskId);
			if (!current) throw new Error("Missing task");
			const sessions = vi.mocked(e.h.runtime.runSession).mock.calls.length;
			const result = await runFactoryWorkflow({
				task: current,
				run,
				state,
				runtime: e.h.runtime,
				storageDir: join(e.h.root, "factory"),
				signal: new AbortController().signal,
				save: (next) => {
					state = next;
				},
				sessionStarted: () => {},
			});
			expect(result.status).toBe("completed");
			await expect(leftover.exited).resolves.toBe("SIGKILL");
			expect(e.events().at(-1)).toBe("cleanup 45678");
			expect(state.verifierEnvironment).toBeUndefined();
			expect(e.h.runtime.runSession).toHaveBeenCalledTimes(sessions);
		});

		it("blocks before the verifier when setup leaves files in the candidate worktree", async () => {
			const e = environmentHarness();
			const task = await e.create({
				...e.environment,
				setup: "echo generated > generated.txt",
			});
			await e.h.start(task);
			const blocked = await e.settle(task.taskId);
			expect(blocked?.phase).toBe("blocked");
			expect(blocked?.error).toContain(
				"Verifier app environment failed (worktree)",
			);
			expect(blocked?.error).toContain("?? generated.txt");
			expect(e.prompts).toEqual([]);
			expect(e.events().at(-1)).toMatch(/^cleanup \d+$/);
			expect(blocked?.verifierEnvironment).toBeUndefined();
		});

		it("stops a recorded app when the hub's restart sweep interrupts its run", async () => {
			const e = environmentHarness();
			const task = await e.create();
			await e.h.start(task);
			await e.settle(task.taskId);
			const run = e.h.manager.getTaskRuns(task.taskId)[0];
			if (!run?.factory) throw new Error("Missing run");
			const leftover = plantLeftover();
			const store = new SqliteAgendaTaskStore({
				dbPath: join(e.h.root, "tasks.db"),
			});
			try {
				store.updateRun(run.runId, {
					status: "running",
					claimToken: "crashed-hub",
					claimUntilAt: new Date(Date.now() - 60_000).toISOString(),
					factory: { ...run.factory, verifierEnvironment: leftover.record },
				});
			} finally {
				store.close();
			}
			await e.h.manager.start();
			await expect(leftover.exited).resolves.toBe("SIGKILL");
			await vi.waitFor(() =>
				expect(
					e.h.manager.getTaskRuns(task.taskId)[0]?.factory?.verifierEnvironment,
				).toBeUndefined(),
			);
			expect(e.h.manager.getTaskRuns(task.taskId)[0]?.status).toBe(
				"interrupted",
			);
			expect(e.events().at(-1)).toBe("cleanup 45678");
		});

		it("stops a recorded app when an idle task is cancelled or archived", async () => {
			const e = environmentHarness();
			e.breakStart();
			const plant = async (taskId: string) => {
				const run = e.h.manager.getTaskRuns(taskId)[0];
				if (!run?.factory) throw new Error("Missing run");
				const leftover = plantLeftover();
				const store = new SqliteAgendaTaskStore({
					dbPath: join(e.h.root, "tasks.db"),
				});
				try {
					store.updateRun(run.runId, {
						factory: { ...run.factory, verifierEnvironment: leftover.record },
					});
				} finally {
					store.close();
				}
				return leftover;
			};
			const cancelled = await e.create();
			await e.h.start(cancelled);
			await e.settle(cancelled.taskId);
			const first = await plant(cancelled.taskId);
			await e.h.manager.cancelTask(
				cancelled.taskId,
				{ kind: "user" },
				cancelled.revision,
			);
			await expect(first.exited).resolves.toBe("SIGKILL");
			expect(
				e.h.manager.getTaskRuns(cancelled.taskId)[0]?.factory
					?.verifierEnvironment,
			).toBeUndefined();

			const archived = await e.create();
			await e.h.start(archived);
			await e.settle(archived.taskId);
			const second = await plant(archived.taskId);
			await e.h.manager.archiveTask(
				archived.taskId,
				{ kind: "user" },
				archived.revision,
			);
			await expect(second.exited).resolves.toBe("SIGKILL");
		});

		it("carries the source app environment into replay variants unless a variant sets its own", async () => {
			const { h, create } = verifiedCriteria(async () =>
				verification([
					{ criterionId: "visible", outcome: "passed", evidence: "Saw after" },
				]),
			);
			const source = await create();
			await h.start(source);
			await vi.waitFor(
				async () =>
					expect((await h.manager.getTask(source.taskId))?.status).toBe(
						"completed",
					),
				{ timeout: 15000 },
			);
			const completed = h.manager.getTaskRuns(source.taskId)[0];
			const snapshot = completed?.factory?.inputSnapshot;
			const agents = snapshot?.factory.agents;
			if (!completed?.factory || !snapshot || !agents?.verifier)
				throw new Error("Missing source run");
			const environment = { setup: "bun install", start: "bun run dev" };
			const run = {
				...completed,
				factory: {
					...completed.factory,
					inputSnapshot: {
						...snapshot,
						factory: {
							...snapshot.factory,
							agents: {
								...agents,
								verifier: { ...agents.verifier, environment },
							},
						},
					},
				},
			};
			const otherModel = {
				modelSelection: { providerId: "test-provider", modelId: "other" },
			};
			const recipe = (name: string, verifier: Record<string, unknown>) =>
				createFactoryWorkflowRecipe({
					name,
					config: { agents: { reviewers: [{}], verifier } },
				});
			const [inherited, own] = createFactoryReplayInputs({
				source,
				run,
				request: {
					taskId: source.taskId,
					runId: run.runId,
					comparisonId: "environment",
					variants: [
						{ label: "Inherited", recipe: recipe("Other model", otherModel) },
						{
							label: "Own environment",
							recipe: recipe("Own environment", {
								...otherModel,
								environment: { start: "npm start" },
							}),
						},
					],
					actor: { kind: "user" },
				},
			});
			expect(inherited?.factory?.agents?.verifier?.environment).toEqual(
				environment,
			);
			expect(own?.factory?.agents?.verifier?.environment).toEqual({
				start: "npm start",
			});
		});
	},
);

describe.skipIf(process.platform === "win32")(
	"Repository verification profile in the workflow",
	() => {
		const exercise = "Open the board and drag a card to Done.";
		const ruleKeys = ["no-floating-promises"];

		/** Calls the workflow directly with a frozen profile, as the manager will once it materialises one. */
		async function profileRun(
			options: {
				profile?: boolean;
				setup?: string;
				proven?: boolean;
				knownRuleKeys?: readonly string[];
				factory?: Partial<FactoryTaskConfig>;
				agents?: NonNullable<FactoryTaskConfig["agents"]>;
				state?: Partial<FactoryRunState>;
				review?: string;
				builder?: (task: AgendaTaskRecord, build: number) => void;
			} = {},
		) {
			const e = environmentHarness();
			const withProfile = options.profile ?? true;
			const profile = factoryVerificationProfileSchema.parse({
				schemaVersion: 1,
				environment: {
					...e.environment,
					...(options.setup ? { setup: options.setup } : {}),
				},
				exercise,
			});
			const hash = factoryVerificationProfileHash(profile);
			const created = await e.h.create(2, {
				...options.factory,
				agents: options.agents ?? {
					designer: {},
					planReviewers: [],
					implementers: [{}],
					reviewers: [{}],
				},
			});
			const config = created.factory;
			if (!config?.agents) throw new Error("Missing Factory configuration");
			const agents = withProfile
				? applyFactoryVerificationProfile(config.agents, profile)
				: config.agents;
			const task: AgendaTaskRecord = {
				...created,
				factory: {
					...config,
					agents,
					...(withProfile
						? {
								verificationProfile: {
									profile,
									hash,
									origin: "proposed" as const,
								},
							}
						: {}),
				},
			};
			const storageDir = join(e.h.root, "factory");
			const workspace = await factoryLocal.prepareFactoryWorkspace({
				sourceRoot: e.h.repo,
				taskId: task.taskId,
				storageDir,
			});
			const now = new Date().toISOString();
			const run: AgendaTaskRunRecord = {
				runId: `run_${task.taskId}`,
				taskId: task.taskId,
				taskRevision: task.revision,
				attempt: 1,
				status: "running",
				claimedAt: now,
				createdAt: now,
				updatedAt: now,
			};
			let state: FactoryRunState = {
				phase: "implementing",
				repairRound: 0,
				workspace,
				sessions: [],
				agents,
				...options.state,
			};
			const sessions: Array<{ role: string; task: AgendaTaskRecord }> = [];
			let builds = 0;
			const original = e.h.runtime.runSession;
			e.h.runtime.runSession = vi.fn<AgendaTaskRuntime["runSession"]>(
				async (id, session, sessionRun) => {
					const role = session.instructions.startsWith(
						"Verify the approved behavior",
					)
						? "verifier"
						: session.instructions.startsWith("Independently review")
							? "reviewer"
							: "builder";
					sessions.push({ role, task: session });
					if (role === "builder") options.builder?.(session, ++builds);
					if (role === "reviewer" && options.review)
						return { status: "completed", summary: options.review };
					return original(id, session, sessionRun);
				},
			);
			const proven = vi.fn(async (_hash: string) => {});
			return {
				e,
				profile,
				hash,
				workspace,
				sessions,
				proven,
				state: () => state,
				execute: () =>
					runFactoryWorkflow({
						task,
						run,
						state,
						runtime: e.h.runtime,
						storageDir,
						signal: new AbortController().signal,
						save: (next) => {
							state = next;
						},
						sessionStarted: () => {},
						verificationProfileProven: options.proven,
						onVerificationProfileProven: proven,
						knownRuleKeys: options.knownRuleKeys,
					}),
				status: () =>
					execFileSync(
						"git",
						[
							"-C",
							workspace.path,
							"status",
							"--porcelain",
							"--untracked-files=all",
						],
						{ encoding: "utf8" },
					),
			};
		}

		it("writes the frozen profile before the first builder, overwrites builder edits and preflights it once", async () => {
			let seen: string | undefined;
			let eventsAtBuild = -1;
			const p = await profileRun({
				knownRuleKeys: ruleKeys,
				// The Factory-written file is outside the design's paths without escalating review.
				state: {
					reviewSelection: {
						impact: "local",
						rationale: "Only the feature file changes.",
						affectedPaths: ["feature.txt"],
						consumers: ["feature readers"],
						planReviewerIndices: [],
						reviewerIndices: [0],
					},
				},
				builder: (task) => {
					const file = join(task.cwd ?? "", FACTORY_VERIFICATION_PROFILE_PATH);
					seen = readFileSync(file, "utf8");
					eventsAtBuild = p.e.events().length;
					writeFileSync(file, '{"schemaVersion":1,"exercise":"edited"}\n');
				},
			});
			expect((await p.execute()).status).toBe("completed");
			const content = factoryVerificationProfileFileContent(p.profile);
			expect(seen).toBe(content);
			const commit = p.state().candidate?.commit ?? "";
			expect(
				execFileSync(
					"git",
					[
						"-C",
						p.workspace.path,
						"show",
						`${commit}:${FACTORY_VERIFICATION_PROFILE_PATH}`,
					],
					{ encoding: "utf8" },
				),
			).toBe(content);
			expect(p.status()).toBe("");
			expect(p.state().reviewEscalation).toBeUndefined();
			expect(p.state().verificationProfile).toEqual({
				hash: p.hash,
				preflight: "passed",
			});
			expect(p.proven).toHaveBeenCalledTimes(1);
			expect(p.proven).toHaveBeenCalledWith(p.hash);
			// Preflight (setup, start, cleanup) finished before the builder; the verifier started its own app.
			const port = Number(p.e.events()[0]?.split(" ")[1]);
			expect(p.e.events().slice(0, 3)).toEqual([
				`setup ${port}`,
				`start ${port} ${port}`,
				`cleanup ${port}`,
			]);
			expect(eventsAtBuild).toBe(3);
			expect(p.e.events()).toHaveLength(6);

			// The materialised verifier carries one fenced exercise block, in its role instructions only.
			const verifier = p.sessions.find(
				(session) => session.role === "verifier",
			)?.task;
			expect(
				verifier?.systemPrompt?.split(FACTORY_VERIFICATION_EXERCISE_HEADING),
			).toHaveLength(2);
			expect(verifier?.systemPrompt?.match(/```/g)).toHaveLength(2);
			expect(verifier?.systemPrompt).toContain(exercise);
			expect(verifier?.instructions).not.toContain(
				FACTORY_VERIFICATION_EXERCISE_HEADING,
			);
			const reviewer = p.sessions.find((session) => session.role === "reviewer")
				?.task.instructions;
			expect(reviewer).toContain(
				`never publish it.\n\n${formatFactoryVerificationProfileForFinalReviewer(p.hash)}\n\nREVIEW SELECTION AND ESCALATION:`,
			);
			// Rule nominations are off unless the card opts into repoRules.
			expect(reviewer).not.toContain(FACTORY_RULE_NOMINATION_INSTRUCTION);

			// Resuming the finished run neither preflights nor reports proof again.
			const sessions = p.sessions.length;
			expect((await p.execute()).status).toBe("completed");
			expect(p.proven).toHaveBeenCalledTimes(1);
			expect(p.e.events()).toHaveLength(6);
			expect(p.sessions).toHaveLength(sessions);
		});

		it("skips the preflight for a proven profile", async () => {
			const p = await profileRun({ proven: true });
			expect((await p.execute()).status).toBe("completed");
			expect(p.state().verificationProfile).toBeUndefined();
			expect(p.proven).not.toHaveBeenCalled();
			expect(p.e.events()).toHaveLength(3);
		});

		it("stops an unproven profile whose preflight fails before any builder session", async () => {
			const p = await profileRun();
			p.e.breakStart();
			const error = await p.execute().catch((caught: unknown) => caught);
			expect(error).toBeInstanceOf(FactoryVerificationProfileError);
			expect(error).toBeInstanceOf(FactoryDecisionError);
			expect(error).toMatchObject({
				stage: "start",
				detail: expect.stringContaining("boot failure"),
			});
			expect(p.state()).toMatchObject({
				phase: "blocked",
				repairRound: 0,
				error: expect.stringContaining("Verification profile failed (start)"),
				verificationProfile: {
					hash: p.hash,
					preflight: "failed",
					stage: "start",
					detail: expect.stringContaining("boot failure"),
				},
			});
			expect(p.state().attempts ?? []).toEqual([]);
			expect(p.sessions).toEqual([]);
			expect(p.proven).not.toHaveBeenCalled();
			expect(p.state().verifierEnvironment).toBeUndefined();
			expect(p.e.events().at(-1)).toMatch(/^cleanup \d+$/);
			expect(p.status()).toBe("");
		});

		it("fails the preflight when setup dirties the base worktree and restores it", async () => {
			const p = await profileRun({ setup: "echo generated > generated.txt" });
			await expect(p.execute()).rejects.toMatchObject({
				name: "FactoryVerificationProfileError",
				stage: "worktree",
			});
			expect(p.state().verificationProfile).toMatchObject({
				preflight: "failed",
				stage: "worktree",
				detail: expect.stringContaining("?? generated.txt"),
			});
			expect(p.sessions).toEqual([]);
			expect(existsSync(join(p.workspace.path, "generated.txt"))).toBe(false);
			expect(p.status()).toBe("");
		});

		it("routes a proven profile's start failure on a candidate to the builder", async () => {
			const p = await profileRun({
				proven: true,
				builder: (_task, build) => {
					if (build === 2) p.e.fixStart();
				},
			});
			p.e.breakStart();
			expect((await p.execute()).status).toBe("completed");
			expect(p.state()).toMatchObject({ phase: "ready", repairRound: 1 });
			// The broken candidate spent no verifier or reviewer session.
			expect(p.state().candidateHistory).toMatchObject([{ reviews: [] }]);
			expect(p.state().candidateHistory?.[0]?.verification).toBeUndefined();
			const roles = p.sessions.map((session) => session.role);
			expect(roles.slice(0, 2)).toEqual(["builder", "builder"]);
			expect(roles.slice(2).sort()).toEqual(["reviewer", "verifier"]);
			const repair = p.sessions[1]?.task.instructions ?? "";
			expect(repair).toContain(
				"Verification app: the repository verification profile runs at the base commit but not on this candidate. Verifier app environment failed (start)",
			);
			expect(repair).toContain("boot failure");
		});

		it.each([
			{
				impact: "local" as const,
				profile: false,
				note: undefined,
			},
			{
				impact: "shared_contract" as const,
				profile: true,
				note: `- Adds or changes the app setup Factory uses for testing, \`${FACTORY_VERIFICATION_PROFILE_PATH}\`.`,
			},
		])("keeps the $impact card's review requirement out of the draft PR body", async ({
			impact,
			profile,
			note,
		}) => {
			const p = await profileRun({
				profile,
				factory: { publishPullRequest: true, autonomy: "hands_off" },
				// Nothing seeds humanReview: the workflow computes it before publishing.
				state: {
					reviewSelection: {
						impact,
						rationale: "Only the feature file changes.",
						affectedPaths: ["feature.txt"],
						consumers: ["feature readers"],
						planReviewerIndices: [],
						reviewerIndices: [0],
					},
				},
			});
			const publish = vi
				.spyOn(factoryLocal, "publishFactoryPullRequest")
				.mockResolvedValue("https://github.com/example/project/pull/1");
			const updateBody = vi
				.spyOn(factoryLocal, "updateFactoryPullRequestBody")
				.mockResolvedValue();
			try {
				expect((await p.execute()).status).toBe("completed");
				expect(publish).toHaveBeenCalledTimes(1);
				const body = publish.mock.calls[0]?.[0].body ?? "";
				expect(body).not.toMatch(/review required|should review|preflight/i);
				if (note) expect(body).toContain(note);
				else expect(body).not.toContain("Notes for reviewers");
				expect(updateBody).not.toHaveBeenCalled();
			} finally {
				publish.mockRestore();
				updateBody.mockRestore();
			}
		});

		describe("marking the draft PR ready", () => {
			const model = (providerId: string, modelId: string) => ({
				modelSelection: { providerId, modelId },
			});
			const independent = {
				designer: model("anthropic", "claude-opus-5"),
				planReviewers: [],
				implementers: [model("anthropic", "claude-opus-5")],
				reviewers: [model("openai", "gpt-6")],
			};
			const local: Partial<FactoryRunState> = {
				reviewSelection: {
					impact: "local",
					rationale: "Only the feature file changes.",
					affectedPaths: ["feature.txt"],
					consumers: ["feature readers"],
					planReviewerIndices: [],
					reviewerIndices: [0],
				},
			};
			const spies = () => {
				const publish = vi
					.spyOn(factoryLocal, "publishFactoryPullRequest")
					.mockResolvedValue("https://github.com/example/project/pull/1");
				const updateBody = vi
					.spyOn(factoryLocal, "updateFactoryPullRequestBody")
					.mockResolvedValue();
				const ready = vi
					.spyOn(factoryLocal, "markFactoryPullRequestReady")
					.mockResolvedValue(true);
				cleanup.unshift(async () => {
					publish.mockRestore();
					updateBody.mockRestore();
					ready.mockRestore();
				});
				return { publish, ready };
			};

			it.each([
				{
					label: "leaves the PR a draft by default",
					factory: {},
					marked: false,
				},
				{
					label: "marks a clean delivery's new draft ready once",
					factory: { pullRequestReady: "when_no_review_required" as const },
					marked: true,
				},
				{
					label: "keeps the draft when the delivery needs human review",
					factory: {
						pullRequestReady: "when_no_review_required" as const,
						humanStamp: "always" as const,
					},
					marked: false,
				},
				{
					label: "keeps the draft without an independent code reviewer",
					factory: { pullRequestReady: "when_no_review_required" as const },
					agents: {
						...independent,
						reviewers: [model("anthropic", "claude-opus-5")],
					},
					marked: false,
				},
			])("$label", async ({ factory, agents, marked }) => {
				const p = await profileRun({
					profile: false,
					agents: agents ?? independent,
					factory: {
						publishPullRequest: true,
						autonomy: "hands_off",
						...factory,
					},
					state: local,
				});
				const { publish, ready } = spies();
				const result = await p.execute();
				expect(result.status).toBe("completed");
				expect(publish).toHaveBeenCalledTimes(1);
				expect(ready).toHaveBeenCalledTimes(marked ? 1 : 0);
				expect(p.state().pullRequestReady).toBe(marked ? true : undefined);
				expect(result.summary).toContain(
					marked
						? "Pull request published and marked ready for review"
						: "Draft pull request published",
				);
				// Resuming the delivered run never asks again.
				await p.execute();
				expect(ready).toHaveBeenCalledTimes(marked ? 1 : 0);
			});

			it("keeps the draft that opens with unresolved review findings", async () => {
				const p = await profileRun({
					profile: false,
					agents: independent,
					factory: {
						publishPullRequest: true,
						autonomy: "hands_off",
						pullRequestReady: "when_no_review_required",
						maxRepairRounds: 0,
					},
					state: local,
					review: JSON.stringify({
						verdict: "changes_requested",
						findings: ["Remove the second check."],
						summary: "Reviewed.",
					}),
				});
				const { publish, ready } = spies();
				await expect(p.execute()).rejects.toThrow("draft PR stays open");
				expect(publish).toHaveBeenCalledTimes(1);
				expect(ready).not.toHaveBeenCalled();
				expect(p.state().pullRequestReady).toBeUndefined();
			});
		});

		it.each([
			{
				ruleCard: false,
				repoRules: true,
				nominate: true,
				label: "asks an opted-in card's reviewers for rule nominations",
			},
			{
				ruleCard: false,
				repoRules: undefined,
				nominate: false,
				label: "gives reviewers no nomination prompt while rule cards are off",
			},
			{
				ruleCard: true,
				repoRules: true,
				nominate: false,
				label: "gives a rule card's reviewers no nomination prompt",
			},
		])("$label and keeps their rule candidates", async ({
			ruleCard,
			repoRules,
			nominate,
		}) => {
			const ruleCandidates = [
				{
					key: "no-floating-promises",
					kind: "lint",
					pattern: "Promises created without await or handling.",
					suggestion: "Enable no-floating-promises.",
				},
			];
			const p = await profileRun({
				profile: false,
				knownRuleKeys: ruleKeys,
				factory: {
					repoRules,
					...(ruleCard
						? {
								intake: {
									source: FACTORY_REPO_RULES_SOURCE,
									key: "no-floating-promises",
								},
							}
						: {}),
				},
				review: JSON.stringify({
					verdict: "pass",
					summary: "Reviewed behavior and maintainability.",
					findings: [],
					ruleCandidates,
				}),
			});
			expect((await p.execute()).status).toBe("completed");
			const prompt =
				p.sessions.find((session) => session.role === "reviewer")?.task
					.instructions ?? "";
			expect(prompt.includes(FACTORY_RULE_NOMINATION_INSTRUCTION)).toBe(
				nominate,
			);
			expect(prompt.includes(formatFactoryKnownRuleKeys(ruleKeys))).toBe(
				nominate,
			);
			expect(prompt).not.toContain("VERIFICATION PROFILE:");
			expect(p.state().candidate?.reviews[0]?.review.ruleCandidates).toEqual(
				ruleCandidates,
			);
			expect(
				existsSync(join(p.workspace.path, FACTORY_VERIFICATION_PROFILE_PATH)),
			).toBe(false);
		});
	},
);

describe("Factory PR evidence", () => {
	it("updates the PR description best-effort for a verified candidate and never for a blocked one", async () => {
		const h = harness();
		const task = await h.create(0);
		await h.start(task);
		await vi.waitFor(
			async () =>
				expect((await h.manager.getTask(task.taskId))?.status).toBe(
					"completed",
				),
			{ timeout: 15000 },
		);
		const run = h.manager.getTaskRuns(task.taskId)[0];
		const verified = run?.factory;
		if (!run || !verified?.candidate) throw new Error("Missing verified run");
		const url = "https://github.com/example/project/pull/1";
		const published: FactoryRunState = {
			...verified,
			pullRequestUrl: url,
			pullRequestWatch: {
				headCommit: verified.candidate.commit,
				handledFeedbackIds: [],
			},
		};
		const updateBody = vi
			.spyOn(factoryLocal, "updateFactoryPullRequestBody")
			.mockRejectedValue(new Error("gh is not authenticated"));
		const workflow = (state: FactoryRunState) =>
			runFactoryWorkflow({
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
				save: () => {},
				sessionStarted: () => {},
			});
		try {
			await expect(workflow(published)).resolves.toEqual({
				status: "completed",
				summary: expect.stringMatching(
					/ PR description could not be updated\.$/,
				),
			});
			expect(updateBody).toHaveBeenCalledWith(
				expect.objectContaining({
					url,
					section: expect.stringContaining("## Changes"),
				}),
			);
			updateBody.mockClear();
			await expect(
				workflow({
					...published,
					candidate: {
						...verified.candidate,
						reviews: [
							{
								reviewerIndex: 0,
								sessionId: "reviewer",
								review: {
									verdict: "changes_requested",
									summary: "Broken",
									findings: ["Handle empty input"],
								},
							},
						],
					},
				}),
			).rejects.toThrow(
				"Repair limit (0) reached; the draft PR stays open with 1 unresolved finding.\n- Reviewer 1: Handle empty input\nPR description could not be updated.",
			);
			// The open findings stay in Factory, never in the PR description.
			expect(updateBody).toHaveBeenCalledWith(
				expect.objectContaining({
					url,
					section: expect.not.stringMatching(/finding|empty input/i),
				}),
			);
		} finally {
			updateBody.mockRestore();
		}
	});

	it("keeps a published draft PR open with its findings when review outlasts the repair rounds, and a person's retry grants one more round", async () => {
		const h = harness();
		const original = h.runtime.runSession;
		h.runtime.runSession = vi.fn<AgendaTaskRuntime["runSession"]>(
			async (id, task, run) => {
				const result = await original(id, task, run);
				if (task.instructions.startsWith("Independently review"))
					return {
						status: "completed",
						summary: JSON.stringify({
							verdict: "changes_requested",
							findings: [
								`Redundant gate call in ${task.cwd}/feature.txt. Remove the second check.`,
							],
							summary: "Reviewed.",
						}),
					};
				// Each build changes the candidate, as a real repair would.
				writeFileSync(
					join(task.cwd ?? "", "notes.txt"),
					`build ${h.builds()}\n`,
				);
				return result;
			},
		);
		const url = "https://github.com/example/project/pull/9";
		const publish = vi
			.spyOn(factoryLocal, "publishFactoryPullRequest")
			.mockResolvedValue(url);
		const updateBody = vi
			.spyOn(factoryLocal, "updateFactoryPullRequestBody")
			.mockResolvedValue();
		cleanup.unshift(async () => {
			publish.mockRestore();
			updateBody.mockRestore();
		});
		const task = await h.create(1, { publishPullRequest: true });
		await h.start(task);
		const stopped = async () => {
			await vi.waitFor(
				async () => {
					const current = await h.manager.getTask(task.taskId);
					expect(current?.status).toBe("failed");
					expect(current?.currentRunId).toBeUndefined();
				},
				{ timeout: 15000 },
			);
			const current = await h.manager.getTask(task.taskId);
			const run = h.manager
				.getTaskRuns(task.taskId)
				.find((entry) => entry.runId === current?.lastRunId);
			if (!current || !run?.factory) throw new Error("Missing stopped run");
			return { task: current, state: run.factory };
		};
		const first = await stopped();
		expect(h.builds()).toBe(2);
		const worktree = first.state.workspace.path;
		expect(first.task.error).toBe(
			"Repair limit (1) reached; the draft PR stays open with 1 unresolved finding.\n- Reviewer 1: Redundant gate call in feature.txt. Remove the second check.",
		);
		expect(first.state).toMatchObject({
			phase: "blocked",
			pullRequestUrl: url,
			unresolvedFindings: {
				commit: first.state.candidate?.commit,
				findings: [
					"Reviewer 1: Redundant gate call in feature.txt. Remove the second check.",
				],
				pullRequestOpen: true,
			},
			humanReview: { required: true, reason: "review findings unresolved" },
		});
		// Not delivered: no sample is queued for a result with open findings.
		expect(first.state.audit).toBeUndefined();
		// Nothing was published for the first candidate; the open-findings
		// outcome opens the draft PR once, with the findings.
		expect(publish).toHaveBeenCalledTimes(1);
		expect(publish.mock.calls[0]?.[0].candidateCommit).toBe(
			first.state.candidate?.commit,
		);
		expect(updateBody).not.toHaveBeenCalled();
		const section = publish.mock.calls[0]?.[0].body ?? "";
		// The open findings stay in Factory; the PR reads as a normal PR.
		expect(section).toContain("## Changes");
		expect(section).not.toMatch(/finding|Redundant gate|should review/i);
		expect(`${section}${first.task.error}`).not.toContain(worktree);

		// A queue restart that no person asked for spends nothing and stops
		// at the same limit.
		await h.manager.startFactoryQueue(
			[{ taskId: task.taskId, expectedRevision: task.revision }],
			{ kind: "system", id: "task_manager" },
		);
		const automatic = await stopped();
		expect(h.builds()).toBe(2);
		expect(automatic.state.extraRepairRounds).toBeUndefined();
		expect(automatic.task.error).toContain("Repair limit (1) reached");
		// The PR already shows this candidate: only its description is rewritten.
		expect(publish).toHaveBeenCalledTimes(1);
		expect(updateBody).toHaveBeenCalledTimes(1);

		// A person's Try again gives the builder exactly one more round.
		await h.manager.startFactoryQueue(
			[{ taskId: task.taskId, expectedRevision: task.revision }],
			{ kind: "user", id: "desktop" },
		);
		const retried = await stopped();
		expect(h.builds()).toBe(3);
		expect(retried.state.extraRepairRounds).toBe(1);
		expect(retried.state.repairRound).toBe(2);
		expect(retried.task.error).toContain(
			"Repair limit (2) reached; the draft PR stays open",
		);
		expect(retried.state.unresolvedFindings?.commit).toBe(
			retried.state.candidate?.commit,
		);
		expect(retried.state.candidate?.commit).not.toBe(
			first.state.candidate?.commit,
		);
		// The repaired candidate moves the same PR, with the remaining findings.
		expect(publish).toHaveBeenCalledTimes(2);
		expect(publish.mock.calls[1]?.[0].candidateCommit).toBe(
			retried.state.candidate?.commit,
		);
		expect(publish.mock.calls[1]?.[0].body).not.toMatch(/finding/i);
		expect(retried.state.pullRequestUrl).toBe(url);

		// Mark as reviewed: a person accepts the open findings on the open PR.
		const head = retried.state.candidate?.commit ?? "";
		const read = vi
			.spyOn(factoryPullRequest, "readFactoryPullRequest")
			.mockResolvedValue({
				state: "OPEN",
				headCommit: head,
				branch: "feature",
				feedback: [],
				commentBodies: [],
				requiredChecks: { headCommit: head, status: "passed", checks: [] },
			});
		cleanup.unshift(async () => read.mockRestore());
		await expect(
			h.manager.stampFactoryTask(
				task.taskId,
				first.state.candidate?.commit ?? "",
			),
		).rejects.toThrow("not ready");
		await h.manager.stampFactoryTask(task.taskId, head);
		const reviewed = await stopped();
		expect(reviewed.task.status).toBe("failed");
		expect(reviewed.state.humanApproval?.commit).toBe(head);
	});

	it("grants a person's first Try again one more round on a run an older build stopped at its repair limit", async () => {
		const h = harness();
		const original = h.runtime.runSession;
		h.runtime.runSession = vi.fn<AgendaTaskRuntime["runSession"]>(
			async (id, task, run) => {
				const result = await original(id, task, run);
				if (task.instructions.startsWith("Independently review"))
					return {
						status: "completed",
						summary: JSON.stringify({
							verdict: "changes_requested",
							findings: ["Remove the second check."],
							summary: "Reviewed.",
						}),
					};
				writeFileSync(
					join(task.cwd ?? "", "notes.txt"),
					`build ${h.builds()}\n`,
				);
				return result;
			},
		);
		const url = "https://github.com/example/project/pull/9";
		const publish = vi
			.spyOn(factoryLocal, "publishFactoryPullRequest")
			.mockResolvedValue(url);
		const updateBody = vi
			.spyOn(factoryLocal, "updateFactoryPullRequestBody")
			.mockResolvedValue();
		cleanup.unshift(async () => {
			publish.mockRestore();
			updateBody.mockRestore();
		});
		const task = await h.create(1, { publishPullRequest: true });
		await h.start(task);
		const stopped = async () => {
			await vi.waitFor(
				async () => {
					const current = await h.manager.getTask(task.taskId);
					expect(current?.status).toBe("failed");
					expect(current?.currentRunId).toBeUndefined();
				},
				{ timeout: 15000 },
			);
			const current = await h.manager.getTask(task.taskId);
			const run = h.manager
				.getTaskRuns(task.taskId)
				.find((entry) => entry.runId === current?.lastRunId);
			if (!current || !run?.factory) throw new Error("Missing stopped run");
			return { task: current, run, state: run.factory };
		};
		const first = await stopped();
		expect(h.builds()).toBe(2);
		// What an older build recorded: the stop, its candidate and the open
		// PR, but no unresolved findings or review requirement.
		const {
			unresolvedFindings: _unresolved,
			humanReview: _review,
			...legacy
		} = first.state;
		expect(legacy.error).toContain("Repair limit (1) reached");
		const store = new SqliteAgendaTaskStore({
			dbPath: join(h.root, "tasks.db"),
		});
		try {
			store.updateRun(first.run.runId, { factory: legacy });
		} finally {
			store.close();
		}

		await h.manager.startFactoryQueue(
			[{ taskId: task.taskId, expectedRevision: task.revision }],
			{ kind: "user", id: "desktop" },
		);
		const retried = await stopped();
		expect(h.builds()).toBe(3);
		expect(retried.state.extraRepairRounds).toBe(1);
		expect(retried.state.repairRound).toBe(2);
		expect(retried.task.error).toContain("Repair limit (2) reached");
	});
});

describe.skipIf(process.platform === "win32")(
	"publishing after verification and review",
	() => {
		const url = "https://github.com/example/project/pull/5";
		/**
		 * A fake `gh` over the harness's bare origin: `pr list` reports the
		 * card's PR at the branch's current remote head once `pr create` ran.
		 */
		function fakeGitHub(h: ReturnType<typeof harness>) {
			const bin = join(h.root, "bin");
			mkdirSync(bin);
			const origin = join(h.root, "origin.git");
			const calls = join(h.root, "gh-calls.jsonl");
			const marker = join(h.root, "gh-pr");
			writeFileSync(
				join(bin, "gh"),
				`#!/usr/bin/env node
const fs = require("fs");
const { execFileSync } = require("child_process");
const args = process.argv.slice(2);
const file = args.includes("--body-file") ? args[args.indexOf("--body-file") + 1] : undefined;
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ args, body: file ? fs.readFileSync(file, "utf8") : undefined }) + "\\n");
if (args[0] === "--version" || args[0] === "auth") {}
else if (args[1] === "list") {
  const head = args[args.indexOf("--head") + 1];
  if (!fs.existsSync(${JSON.stringify(marker)})) process.stdout.write("[]");
  else process.stdout.write(JSON.stringify([{ url: ${JSON.stringify(url)}, number: 5, state: "OPEN", baseRefName: "main", headRefOid: execFileSync("git", ["--git-dir", ${JSON.stringify(origin)}, "rev-parse", "refs/heads/" + head], { encoding: "utf8" }).trim() }]));
} else if (args[1] === "create") fs.writeFileSync(${JSON.stringify(marker)}, args[args.indexOf("--head") + 1]);
else if (args[1] === "view") process.stdout.write(JSON.stringify({ state: "OPEN", headRefName: fs.existsSync(${JSON.stringify(marker)}) ? fs.readFileSync(${JSON.stringify(marker)}, "utf8") : "", body: "Human summary." }));
else if (args[1] === "edit") {}
else process.exitCode = 2;
`,
				{ mode: 0o755 },
			);
			vi.stubEnv("PATH", `${bin}:${process.env.PATH ?? ""}`);
			cleanup.unshift(async () => {
				vi.unstubAllEnvs();
			});
			const ghCalls = () =>
				existsSync(calls)
					? readFileSync(calls, "utf8")
							.trim()
							.split("\n")
							.map(
								(line) => JSON.parse(line) as { args: string[]; body?: string },
							)
					: [];
			return {
				creates: () => ghCalls().filter((call) => call.args[1] === "create"),
				edits: () => ghCalls().filter((call) => call.args[1] === "edit"),
				/** The card branches origin has, as `<sha> <ref>` lines. */
				remoteBranches: () =>
					execFileSync(
						"git",
						["--git-dir", origin, "for-each-ref", "refs/heads/factory"],
						{ encoding: "utf8" },
					).trim(),
			};
		}
		const stopped = async (h: ReturnType<typeof harness>, taskId: string) => {
			await vi.waitFor(
				async () => {
					const current = await h.manager.getTask(taskId);
					expect(current?.status).toBe("failed");
					expect(current?.currentRunId).toBeUndefined();
				},
				{ timeout: 15000 },
			);
			const current = await h.manager.getTask(taskId);
			const state = h.manager
				.getTaskRuns(taskId)
				.find((entry) => entry.runId === current?.lastRunId)?.factory;
			if (!current || !state) throw new Error("Missing stopped run");
			return { task: current, state };
		};

		it("pushes nothing and opens no PR until verification and review pass, then opens one", async () => {
			const h = harness({
				reviewFailures: 1,
				verifier: async () => verification(),
			});
			const github = fakeGitHub(h);
			const seenAtReview: string[] = [];
			const original = h.runtime.runSession;
			h.runtime.runSession = vi.fn<AgendaTaskRuntime["runSession"]>(
				async (...args) => {
					if (args[1].instructions.startsWith("Independently review"))
						seenAtReview.push(
							`${github.remoteBranches()}|${github.creates().length}`,
						);
					return original(...args);
				},
			);
			const task = await h.create(2, {
				publishPullRequest: true,
				agents: {
					designer: {},
					planReviewers: [],
					implementers: [{}],
					reviewers: [{}],
					verifier: { instructions: "Exercise the feature." },
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
			// Two review rounds: the first requested a repair; neither saw a
			// pushed branch or a PR.
			expect(seenAtReview).toEqual(["|0", "|0"]);
			const state = h.manager.getTaskRuns(task.taskId)[0]?.factory;
			const commit = state?.candidate?.commit ?? "";
			expect(state).toMatchObject({
				phase: "watching",
				pullRequestUrl: url,
				pullRequestWatch: { headCommit: commit },
			});
			expect(github.creates()).toHaveLength(1);
			expect(github.creates()[0]?.body).toContain("## Changes");
			expect(github.remoteBranches()).toBe(
				`${commit} commit\trefs/heads/${state?.workspace.branch}`,
			);
		});

		it.each([
			{
				label: "failed",
				response: JSON.stringify({
					verdict: "changes_requested",
					summary: "The card still shows before.",
					findings: ["The card still shows before."],
				}),
				error: "Repair limit (1) reached.",
			},
			{
				label: "unavailable",
				response: JSON.stringify({
					verdict: "changes_requested",
					summary: "No browser.",
					findings: [],
					coverage: {
						static: [],
						exercised: [],
						requiredGaps: ["Could not start a browser"],
						limitations: [],
					},
				}),
				error: "Required verification remains unavailable",
			},
		])("leaves no PR and no remote branch when verification is $label", async ({
			response,
			error,
		}) => {
			const h = harness({ verifier: async () => response });
			const github = fakeGitHub(h);
			const task = await h.create(1, {
				publishPullRequest: true,
				agents: {
					designer: {},
					planReviewers: [],
					implementers: [{}],
					reviewers: [{}],
					verifier: { instructions: "Exercise the feature." },
				},
			});
			await h.start(task);
			const { task: failed, state } = await stopped(h, task.taskId);
			expect(failed.error).toContain(error);
			expect(state.pullRequestUrl).toBeUndefined();
			expect(state.unresolvedFindings?.pullRequestOpen).toBeUndefined();
			expect(github.creates()).toHaveLength(0);
			expect(github.remoteBranches()).toBe("");
		});

		it("publishes the open-findings outcome once, and a person's retry moves the same PR", async () => {
			const h = harness({
				review: JSON.stringify({
					verdict: "changes_requested",
					findings: ["Remove the second check."],
					summary: "Reviewed.",
				}),
			});
			const github = fakeGitHub(h);
			const original = h.runtime.runSession;
			h.runtime.runSession = vi.fn<AgendaTaskRuntime["runSession"]>(
				async (id, task, run) => {
					const result = await original(id, task, run);
					// Each build changes the candidate, as a real repair would.
					if (!task.instructions.startsWith("Independently review"))
						writeFileSync(
							join(task.cwd ?? "", "notes.txt"),
							`build ${h.builds()}\n`,
						);
					return result;
				},
			);
			const task = await h.create(1, { publishPullRequest: true });
			await h.start(task);
			const first = await stopped(h, task.taskId);
			const firstCommit = first.state.candidate?.commit ?? "";
			expect(h.builds()).toBe(2);
			expect(first.task.error).toContain(
				"the draft PR stays open with 1 unresolved finding",
			);
			expect(first.state).toMatchObject({
				pullRequestUrl: url,
				unresolvedFindings: { commit: firstCommit, pullRequestOpen: true },
				humanReview: { required: true, reason: "review findings unresolved" },
			});
			expect(github.creates()).toHaveLength(1);
			// Open findings stay in Factory, never in the PR description.
			expect(github.creates()[0]?.body).not.toContain(
				"Remove the second check",
			);
			expect(github.remoteBranches()).toContain(firstCommit);

			await h.manager.startFactoryQueue(
				[{ taskId: task.taskId, expectedRevision: task.revision }],
				{ kind: "user", id: "desktop" },
			);
			const retried = await stopped(h, task.taskId);
			const retriedCommit = retried.state.candidate?.commit ?? "";
			expect(h.builds()).toBe(3);
			expect(retriedCommit).not.toBe(firstCommit);
			expect(retried.state).toMatchObject({
				pullRequestUrl: url,
				unresolvedFindings: { commit: retriedCommit, pullRequestOpen: true },
			});
			// One PR per card: the retry pushed to it and rewrote its findings.
			expect(github.creates()).toHaveLength(1);
			expect(github.remoteBranches()).toContain(retriedCommit);
			expect(github.edits().at(-1)?.body).toContain("## Changes");
		});
	},
);

describe("hands-off Factory", () => {
	const url = "https://github.com/example/project/pull/7";
	const featureCheck = {
		name: "Feature behavior",
		kind: "api" as const,
		command: `node -e "if(require('fs').readFileSync('feature.txt','utf8').trim()!=='after')process.exit(1)"`,
		artifacts: [],
	};
	/** Submits raw config the way a Hub client does, before schema defaults. */
	const submit = (
		h: ReturnType<typeof harness>,
		factory: Record<string, unknown> = {},
		queueFactoryDesign?: boolean,
	) =>
		h.manager.createTask({
			title: "Update feature",
			type: "follow-up",
			instructions: "Acceptance: feature.txt contains after.",
			scope: "workspace",
			workspaceRoot: h.repo,
			expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
			createdBy: { kind: "user" },
			queueFactoryDesign,
			factory: {
				autonomy: "hands_off",
				// These cards use fixed review, so their impact is unknown and
				// by-risk would ask for a stamp instead of sampling the delivery.
				humanStamp: "never",
				maxRepairRounds: 2,
				checks: [featureCheck],
				acceptanceCriteria: [
					{
						id: "feature-after",
						text: "feature.txt contains after",
						check: featureCheck.name,
					},
				],
				...factory,
			} as unknown as FactoryTaskConfig,
		});
	const spyPublishing = (publish?: () => Promise<string>) => {
		const published = vi
			.spyOn(factoryLocal, "publishFactoryPullRequest")
			.mockImplementation(publish ?? (async () => url));
		const body = vi
			.spyOn(factoryLocal, "updateFactoryPullRequestBody")
			.mockResolvedValue();
		cleanup.unshift(async () => {
			published.mockRestore();
			body.mockRestore();
		});
		return published;
	};
	const status = async (h: ReturnType<typeof harness>, taskId: string) =>
		(await h.manager.getTask(taskId))?.status;
	const liveRuns = (h: ReturnType<typeof harness>, taskId: string) =>
		h.manager
			.getTaskRuns(taskId)
			.filter((run) => run.status === "starting" || run.status === "running");

	it("resumes a failed run's saved state, publishes once and does not reopen its PR or rerun finished sessions", async () => {
		const h = harness();
		const task = await h.create();
		await h.start(task);
		await vi.waitFor(
			async () => expect(await status(h, task.taskId)).toBe("completed"),
			{ timeout: 15000 },
		);
		const run = h.manager.getTaskRuns(task.taskId)[0];
		if (!run?.factory?.candidate) throw new Error("Missing verified run");
		// Rewind to the verified build: checks passed, review not yet recorded.
		let state: FactoryRunState = {
			...run.factory,
			phase: "verifying",
			candidate: { ...run.factory.candidate, reviews: [] },
			attempts: run.factory.attempts?.filter(
				(attempt) => attempt.role === "builder",
			),
		};
		const publish = spyPublishing();
		const real = factoryLocal.assertFactoryCandidate;
		let failed = false;
		const reviewsBefore = h.reviews();
		const assertCandidate = vi
			.spyOn(factoryLocal, "assertFactoryCandidate")
			.mockImplementation(async (input) => {
				// Fail after the review session finished, before its result is kept.
				if (h.reviews() > reviewsBefore && !failed) {
					failed = true;
					throw new Error("fatal: Unable to create index.lock: File exists");
				}
				return real(input);
			});
		cleanup.unshift(async () => assertCandidate.mockRestore());
		const sessionsBefore = vi.mocked(h.runtime.runSession).mock.calls.length;
		const input = {
			task: {
				...task,
				factory: factoryTaskConfigSchema.parse({
					...task.factory,
					publishPullRequest: true,
				}),
			},
			run,
			runtime: h.runtime,
			storageDir: h.root,
			signal: new AbortController().signal,
			save: (next: FactoryRunState) => {
				state = next;
			},
			sessionStarted: () => {},
		};
		await expect(runFactoryWorkflow({ ...input, state })).rejects.toThrow(
			"index.lock",
		);
		// Nothing is published before review passes.
		expect(state.phase).toBe("blocked");
		expect(state.pullRequestUrl).toBeUndefined();
		expect(publish).not.toHaveBeenCalled();
		const reviewSessions =
			vi.mocked(h.runtime.runSession).mock.calls.length - sessionsBefore;
		expect(reviewSessions).toBe(1);
		// The retry resumes the failed run's state, as hands-off recovery does.
		const result = await runFactoryWorkflow({
			...input,
			state: { ...state, error: undefined },
		});
		expect(result.status).toBe("completed");
		expect(state).toMatchObject({ phase: "watching", pullRequestUrl: url });
		expect(publish).toHaveBeenCalledTimes(1);
		expect(h.runtime.runSession).toHaveBeenCalledTimes(
			sessionsBefore + reviewSessions,
		);
		expect(h.builds()).toBe(1);
		// Resuming the delivered run does not open another PR.
		await runFactoryWorkflow({ ...input, state });
		expect(publish).toHaveBeenCalledTimes(1);
	});

	it("stops before building when the PR base is unpublished, and a retry after it is published redoes only publishing", async () => {
		const h = harness();
		const task = await h.create();
		await h.start(task);
		await vi.waitFor(
			async () => expect(await status(h, task.taskId)).toBe("completed"),
			{ timeout: 15000 },
		);
		const run = h.manager.getTaskRuns(task.taskId)[0];
		if (!run?.factory?.candidate) throw new Error("Missing verified run");
		const unpublished = new FactoryPublishError(
			"The base branch main is not on GitHub and has unpublished commits. Push it, or start this work from a published branch.",
		);
		const input = {
			task: {
				...task,
				factory: factoryTaskConfigSchema.parse({
					...task.factory,
					publishPullRequest: true,
				}),
			},
			run,
			runtime: h.runtime,
			storageDir: h.root,
			signal: new AbortController().signal,
			sessionStarted: () => {},
		};
		// A fresh card that cannot publish stops before any builder session.
		const builds = h.builds();
		resolveBase.mockRejectedValueOnce(unpublished);
		await expect(
			runFactoryWorkflow({
				...input,
				state: {
					phase: "implementing",
					repairRound: 0,
					workspace: run.factory.workspace,
					sessions: [],
					agents: run.factory.agents,
				},
				save: () => {},
			}),
		).rejects.toBe(unpublished);
		expect(h.builds()).toBe(builds);
		// A verified candidate whose first publish failed on the base branch.
		let state: FactoryRunState = {
			...run.factory,
			phase: "verifying",
			candidate: { ...run.factory.candidate, reviews: [] },
			attempts: run.factory.attempts?.filter(
				(attempt) => attempt.role === "builder",
			),
		};
		let published = 0;
		const publish = spyPublishing(async () => {
			if (!published++) throw unpublished;
			return url;
		});
		const save = (next: FactoryRunState) => {
			state = next;
		};
		await expect(runFactoryWorkflow({ ...input, state, save })).rejects.toBe(
			unpublished,
		);
		expect(state.pullRequestUrl).toBeUndefined();
		// The user pushed the base; Try again resumes and only publishes.
		const result = await runFactoryWorkflow({
			...input,
			state: { ...state, error: undefined },
			save,
		});
		expect(result.status).toBe("completed");
		expect(state).toMatchObject({
			pullRequestUrl: url,
			pullRequestBase: "main",
		});
		expect(publish).toHaveBeenCalledTimes(2);
		expect(publish.mock.calls[1]?.[0].baseBranch).toBe("main");
		expect(h.builds()).toBe(builds);
	});

	it("does not spend the hands-off retry on a publish decision", async () => {
		const h = harness({ independentReviewer: true });
		const publish = spyPublishing(async () => {
			throw new FactoryPublishError(
				"The GitHub CLI is not signed in; run gh auth login, then try again.",
			);
		});
		await h.manager.start();
		const task = await submit(h, { approval: "automatic" });
		await vi.waitFor(
			async () => expect(await status(h, task.taskId)).toBe("failed"),
			{ timeout: 15000 },
		);
		expect(publish).toHaveBeenCalledTimes(1);
		const runs = h.manager.getTaskRuns(task.taskId);
		expect(runs).toHaveLength(1);
		expect(runs[0]?.factory?.autoRecovery).toBeUndefined();
		expect((await h.manager.getTask(task.taskId))?.error).toContain(
			"not signed in",
		);
	});

	it("defaults publishing on and PR watching off, keeping explicit choices", async () => {
		const h = harness();
		const defaults = await submit(h, {}, false);
		expect(defaults.factory).toMatchObject({
			autonomy: "hands_off",
			publishPullRequest: true,
			watchPullRequest: false,
		});
		const optedOut = await submit(
			h,
			{ publishPullRequest: false, watchPullRequest: true },
			false,
		);
		expect(optedOut.factory).toMatchObject({
			publishPullRequest: false,
			watchPullRequest: true,
		});
	});

	it("runs a submission through scoping, automatic approval and execution to a draft PR with no manual calls", async () => {
		const h = harness({ independentReviewer: true });
		const publish = spyPublishing();
		await h.manager.start();
		const task = await submit(h, { approval: "automatic" });
		await vi.waitFor(
			async () => expect(await status(h, task.taskId)).toBe("completed"),
			{ timeout: 15000 },
		);
		expect(h.runtime.startDesignSession).toHaveBeenCalledTimes(1);
		expect(publish).toHaveBeenCalledTimes(1);
		expect(h.builds()).toBe(1);
		const runs = h.manager.getTaskRuns(task.taskId);
		expect(runs).toHaveLength(1);
		expect(runs[0]?.factory).toMatchObject({
			pullRequestUrl: url,
			phase: "watching",
			// Delivery queues the result for feedback without a manual pick.
			audit: { selectionReason: "delivered" },
		});
		expect(runs[0]?.factory?.audit?.reviewedAt).toBeUndefined();
		expect(runs[0]?.factory?.autoRecovery).toBeUndefined();
		// Hands-off scoping attempts the work instead of asking.
		const design = h.runtime.runDesignSession;
		if (!design) throw new Error("Missing design runtime");
		const designer = vi.mocked(design).mock.calls[0]?.[1].instructions ?? "";
		expect(designer).toContain(
			'Do not ask the user about anything you can decide; choose the recommended default and proceed. List every such choice in the instructions under an "Assumptions" heading',
		);
		expect(designer).not.toContain(
			"Use ask_question only for unresolved scope",
		);
	});

	it("records feedback on a delivered sample like any other sample", async () => {
		const h = harness();
		spyPublishing();
		const task = await submit(h, {}, false);
		await h.manager.start();
		await h.manager.approveTask(task.taskId, { kind: "user" }, task.revision);
		await vi.waitFor(
			async () => expect(await status(h, task.taskId)).toBe("completed"),
			{ timeout: 15000 },
		);
		const delivered = h.manager.getTaskRuns(task.taskId)[0]?.factory?.audit;
		expect(delivered).toMatchObject({ selectionReason: "delivered" });
		// The pull request watch may still hold the run briefly.
		await vi.waitFor(() =>
			h.manager.recordFactoryAudit(task.taskId, "Empty titles still match"),
		);
		const state = h.manager.getTaskRuns(task.taskId)[0]?.factory;
		// Feedback never changes the delivery.
		expect(state?.phase).not.toBe("blocked");
		expect(state?.error).toBeUndefined();
		expect(state).toMatchObject({
			audit: {
				selectedAt: delivered?.selectedAt,
				selectionReason: "delivered",
				finding: "Empty titles still match",
			},
		});
		expect(state?.audit?.reviewedAt).toBeDefined();
		// Only feedback is recorded; no improvement work is created for it.
		expect(await h.manager.listTasks()).toHaveLength(1);
	});

	it("repairs a plan that is not ready before approving and running it", async () => {
		const h = harness({ independentReviewer: true });
		const publish = spyPublishing();
		const uiCheck = { ...featureCheck, kind: "ui" as const, artifacts: [] };
		let designs = 0;
		h.runtime.runDesignSession = vi.fn(async (_id, task) => ({
			status: "completed" as const,
			summary: JSON.stringify({
				instructions: task.instructions,
				// A UI check without evidence is not approvable; the repair fixes it.
				checks: [++designs === 1 ? uiCheck : featureCheck],
				acceptanceCriteria: task.factory?.acceptanceCriteria,
			}),
		}));
		await h.manager.start();
		const task = await submit(h, { approval: "automatic" });
		await vi.waitFor(
			async () => expect(await status(h, task.taskId)).toBe("completed"),
			{ timeout: 15000 },
		);
		expect(designs).toBe(2);
		const design = h.runtime.runDesignSession;
		if (!design) throw new Error("Missing design runtime");
		expect(vi.mocked(design).mock.calls[1]?.[1].instructions).toContain(
			'UI check "Feature behavior" requires fresh screenshot',
		);
		expect(publish).toHaveBeenCalledTimes(1);
		expect(h.builds()).toBe(1);
	});

	it("waits for a person with the reason once plan repair cannot make it ready", async () => {
		const h = harness();
		h.runtime.runDesignSession = vi.fn(async (_id, task) => ({
			status: "completed" as const,
			summary: JSON.stringify({
				instructions: task.instructions,
				checks: [{ ...featureCheck, kind: "ui", artifacts: [] }],
				acceptanceCriteria: task.factory?.acceptanceCriteria,
			}),
		}));
		await h.manager.start();
		const task = await submit(h, {
			approval: "automatic",
			maxRepairRounds: 1,
		});
		await vi.waitFor(async () =>
			expect((await h.manager.getTask(task.taskId))?.error).toContain(
				"Automatic approval is waiting: Plan repair limit (1) reached;",
			),
		);
		const waiting = await h.manager.getTask(task.taskId);
		expect(waiting?.status).toBe("pending_approval");
		expect(waiting?.error).toContain('UI check "Feature behavior"');
		expect(h.runtime.runDesignSession).toHaveBeenCalledTimes(2);
		expect(h.manager.getTaskRuns(task.taskId)).toEqual([]);
	});

	it("leaves automatic approval waiting with a readable reason when the plan is not ready", async () => {
		const h = harness();
		// The configured implementer became unavailable while scoping ran.
		h.runtime.validateFactoryAgents = vi
			.fn<NonNullable<AgendaTaskRuntime["validateFactoryAgents"]>>()
			.mockImplementationOnce(() => {})
			.mockImplementation(() => {
				throw new Error(
					"Implementer model test-provider/gone is not available",
				);
			});
		await h.manager.start();
		const task = await submit(h, {
			approval: "automatic",
			publishPullRequest: false,
		});
		await vi.waitFor(async () =>
			expect((await h.manager.getTask(task.taskId))?.error).toContain(
				"Automatic approval is waiting: Implementer model test-provider/gone is not available",
			),
		);
		expect(await status(h, task.taskId)).toBe("pending_approval");
		expect(h.runtime.startSession).not.toHaveBeenCalled();
		expect(h.manager.getTaskRuns(task.taskId)).toEqual([]);
	});

	it("runs a manually approved card without a separate queue start", async () => {
		const h = harness();
		await h.manager.start();
		const task = await h.create();
		await vi.waitFor(async () =>
			expect(
				(await h.manager.getTask(task.taskId))?.factoryDesignProgress?.phase,
			).toBe("complete"),
		);
		const scoped = await h.manager.getTask(task.taskId);
		if (!scoped) throw new Error("Missing scoped task");
		expect(scoped.status).toBe("pending_approval");
		await h.manager.approveTask(task.taskId, { kind: "user" }, scoped.revision);
		await vi.waitFor(
			async () => expect(await status(h, task.taskId)).toBe("completed"),
			{ timeout: 15000 },
		);
		expect(h.builds()).toBe(1);
		// Only hands-off delivery selects a sample by itself.
		expect(
			h.manager.getTaskRuns(task.taskId)[0]?.factory?.audit,
		).toBeUndefined();
	});

	it("retries a transient failure once from saved state without a second PR or writer", async () => {
		const h = harness();
		const publish = spyPublishing(async () => {
			expect(liveRuns(h, taskId)).toHaveLength(1);
			return url;
		});
		const real = factoryLocal.assertFactoryCandidate;
		let failed = false;
		const assertCandidate = vi
			.spyOn(factoryLocal, "assertFactoryCandidate")
			.mockImplementation(async (input) => {
				// Fail after the review session, before anything is published.
				if (h.reviews() > 0 && !failed) {
					failed = true;
					throw new Error("fatal: Unable to create index.lock: File exists");
				}
				return real(input);
			});
		cleanup.unshift(async () => assertCandidate.mockRestore());
		const task = await submit(h, {}, false);
		const taskId = task.taskId;
		await h.manager.start();
		await h.manager.approveTask(taskId, { kind: "user" }, task.revision);
		await vi.waitFor(
			async () => expect(await status(h, taskId)).toBe("completed"),
			{ timeout: 15000 },
		);
		expect(failed).toBe(true);
		expect(publish).toHaveBeenCalledTimes(1);
		expect(h.builds()).toBe(1);
		const [retry, first] = h.manager.getTaskRuns(taskId);
		expect(first?.factory?.pullRequestUrl).toBeUndefined();
		expect(first).toMatchObject({
			status: "failed",
			factory: {
				autoRecovery: {
					attempts: 1,
					reason: "fatal: Unable to create index.lock: File exists",
				},
			},
		});
		expect(retry).toMatchObject({
			status: "completed",
			factory: {
				pullRequestUrl: url,
				autoRecovery: { attempts: 1 },
				audit: { selectionReason: "delivered" },
			},
		});
		expect(first?.factory?.audit).toBeUndefined();
		expect(retry?.factory?.workspace).toEqual(first?.factory?.workspace);
	});

	it("retries a persisting transient failure exactly once and then stops", async () => {
		const h = harness();
		const publish = spyPublishing(async () => {
			throw new Error("gh: connection reset by peer");
		});
		const task = await submit(h, {}, false);
		await h.manager.start();
		await h.manager.approveTask(task.taskId, { kind: "user" }, task.revision);
		await vi.waitFor(
			async () => {
				expect(await status(h, task.taskId)).toBe("failed");
				expect(h.manager.getTaskRuns(task.taskId)).toHaveLength(2);
			},
			{ timeout: 15000 },
		);
		// Give a mistaken third attempt the chance to start before asserting.
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(h.manager.getTaskRuns(task.taskId)).toHaveLength(2);
		expect(publish).toHaveBeenCalledTimes(2);
		expect(h.builds()).toBe(1);
		const latest = await h.manager.getTask(task.taskId);
		expect(latest?.error).toContain("gh: connection reset by peer");
		expect(
			h.manager.getTaskRuns(task.taskId)[0]?.factory?.autoRecovery,
		).toEqual(expect.objectContaining({ attempts: 1 }));
	});

	it("does not retry an exhausted repair budget", async () => {
		const h = harness({ failures: 10 });
		const task = await submit(h, { maxRepairRounds: 1 }, false);
		await h.manager.start();
		await h.manager.approveTask(task.taskId, { kind: "user" }, task.revision);
		await vi.waitFor(
			async () => expect(await status(h, task.taskId)).toBe("failed"),
			{ timeout: 15000 },
		);
		await new Promise((resolve) => setTimeout(resolve, 100));
		const runs = h.manager.getTaskRuns(task.taskId);
		expect(runs).toHaveLength(1);
		expect(runs[0]?.factory?.autoRecovery).toBeUndefined();
		expect((await h.manager.getTask(task.taskId))?.error).toContain(
			"Repair limit (1) reached",
		);
		expect(h.builds()).toBe(2);
	});

	it("does not start queued recovery while another writer holds the run", async () => {
		const h = harness({ hold: true });
		const task = await submit(h, { publishPullRequest: false }, false);
		await h.start(task);
		await vi.waitFor(() => expect(h.builds()).toBe(1));
		const dbPath = join(h.root, "tasks.db");
		const store = new SqliteAgendaTaskStore({ dbPath });
		try {
			store.enqueueFactory({
				taskId: task.taskId,
				expectedRevision: task.revision,
				actor: { kind: "system" },
			});
		} finally {
			store.close();
		}
		// Same host: its own controller is live. Another host: the claim is live.
		await h.manager.start();
		const other = new AgendaTaskManager({
			runtime: h.runtime,
			dbPath,
			globalSpecsDir: join(h.root, "specs"),
			watchFiles: false,
			automationEnabled: false,
		});
		cleanup.unshift(() => other.dispose());
		await other.start();
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(h.builds()).toBe(1);
		expect(h.runtime.startSession).toHaveBeenCalledTimes(1);
		expect(h.manager.getTaskRuns(task.taskId)).toHaveLength(1);
		expect(liveRuns(h, task.taskId)).toHaveLength(1);
		await h.manager.cancelTask(task.taskId, { kind: "user" }, task.revision);
	});
});

describe("Factory working limit", () => {
	const submitHandsOff = (h: ReturnType<typeof harness>, title: string) =>
		h.manager.createTask({
			title,
			type: "follow-up",
			instructions: "Acceptance: feature.txt contains after.",
			scope: "workspace",
			workspaceRoot: h.repo,
			expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
			createdBy: { kind: "user" },
			factory: {
				autonomy: "hands_off",
				approval: "automatic",
				publishPullRequest: false,
				watchPullRequest: false,
				maxRepairRounds: 2,
				checks: [
					{
						name: "Feature behavior",
						kind: "api",
						command: `node -e "if(require('fs').readFileSync('feature.txt','utf8').trim()!=='after')process.exit(1)"`,
						artifacts: [],
					},
				],
				acceptanceCriteria: [
					{
						id: "feature-after",
						text: "feature.txt contains after",
						check: "Feature behavior",
					},
				],
			} as unknown as FactoryTaskConfig,
		});
	/** Tracks which cards have a live designer or role session. */
	const trackWorking = (h: ReturnType<typeof harness>) => {
		const working = new Map<string, number>();
		let peak = 0;
		const gates: Array<() => void> = [];
		let gated = true;
		const enter = (taskId: string) => {
			working.set(taskId, (working.get(taskId) ?? 0) + 1);
			peak = Math.max(peak, working.size);
		};
		const leave = (taskId: string) => {
			const left = (working.get(taskId) ?? 1) - 1;
			if (left) working.set(taskId, left);
			else working.delete(taskId);
		};
		const design = h.runtime.runDesignSession;
		const run = h.runtime.runSession;
		if (!design) throw new Error("Missing design runtime");
		h.runtime.runDesignSession = vi.fn(async (id, task, ...rest) => {
			enter(task.taskId);
			try {
				if (gated) await new Promise<void>((resolve) => gates.push(resolve));
				return await design(id, task, ...rest);
			} finally {
				leave(task.taskId);
			}
		});
		h.runtime.runSession = vi.fn(async (id, task, runRecord) => {
			enter(task.taskId);
			try {
				return await run(id, task, runRecord);
			} finally {
				leave(task.taskId);
			}
		});
		cleanup.unshift(async () => {
			gated = false;
			for (const open of gates.splice(0)) open();
		});
		return {
			working: () => [...working.keys()],
			peak: () => peak,
			waiting: () => gates.length,
			releaseOne: () => gates.shift()?.(),
			ungate: () => {
				gated = false;
				for (const open of gates.splice(0)) open();
			},
		};
	};

	it("works one card at a time under a limit of 1, scoping and execution included, and keeps the rest queued", async () => {
		const h = harness({ independentReviewer: true, factoryConcurrency: 1 });
		const tracker = trackWorking(h);
		await h.manager.start();
		const cards = [
			await submitHandsOff(h, "First"),
			await submitHandsOff(h, "Second"),
			await submitHandsOff(h, "Third"),
		];
		await vi.waitFor(() => expect(tracker.waiting()).toBe(1));
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(tracker.waiting()).toBe(1);
		const [active] = tracker.working();
		const others = cards.filter((card) => card.taskId !== active);
		expect(others).toHaveLength(2);
		for (const card of others) {
			const queued = await h.manager.getTask(card.taskId);
			expect(queued?.factoryQueued).toBe("design");
			expect(queued?.factoryDesignProgress).toBeUndefined();
		}
		tracker.ungate();
		for (const card of cards)
			await vi.waitFor(
				async () =>
					expect((await h.manager.getTask(card.taskId))?.status).toBe(
						"completed",
					),
				{ timeout: 20000 },
			);
		// Scoping and execution of different cards never overlapped.
		expect(tracker.peak()).toBe(1);
		expect(h.builds()).toBe(3);
	}, 30000);

	it("starts more queued cards at once when the limit is raised and stops nothing when it is lowered", async () => {
		const h = harness({ factoryConcurrency: 1 });
		const tracker = trackWorking(h);
		await h.manager.start();
		for (const title of ["First", "Second", "Third"])
			await submitHandsOff(h, title);
		await vi.waitFor(() => expect(tracker.waiting()).toBe(1));
		expect(h.manager.setFactoryConcurrency(3)).toBe(3);
		await vi.waitFor(() => expect(tracker.waiting()).toBe(3));
		expect(tracker.working()).toHaveLength(3);
		// Lowering keeps the three live designers running.
		expect(h.manager.setFactoryConcurrency(1)).toBe(1);
		expect(h.manager.setFactoryConcurrency(20)).toBe(8);
		h.manager.setFactoryConcurrency(1);
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(tracker.working()).toHaveLength(3);
		expect(h.runtime.abortSession).not.toHaveBeenCalled();
	});

	it("loads the persisted limit at start, before queued work begins", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-factory-limit-"));
		cleanup.push(async () => rmSync(root, { recursive: true, force: true }));
		const { FileFactoryDefaultsStore } = await import("./factory-defaults");
		const path = join(root, "factory-defaults.json");
		await new FileFactoryDefaultsStore(path).setConcurrency(1);
		const resolveFactoryConcurrency = () =>
			new FileFactoryDefaultsStore(path).getConcurrency();
		const first = harness({ resolveFactoryConcurrency });
		expect(first.manager.getFactoryConcurrency()).toBe(2);
		await first.manager.start();
		expect(first.manager.getFactoryConcurrency()).toBe(1);
		await first.manager.dispose();
		const restarted = harness({ resolveFactoryConcurrency });
		const tracker = trackWorking(restarted);
		await restarted.manager.start();
		expect(restarted.manager.getFactoryConcurrency()).toBe(1);
		for (const title of ["First", "Second"])
			await submitHandsOff(restarted, title);
		await vi.waitFor(() => expect(tracker.waiting()).toBe(1));
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(tracker.working()).toHaveLength(1);
	});

	it("stops queued runs but leaves queued scoping in place", async () => {
		const h = harness();
		const scoping = await h.create();
		const approved = await h.create();
		await h.manager.approveTask(
			approved.taskId,
			{ kind: "user" },
			approved.revision,
		);
		expect((await h.manager.getTask(scoping.taskId))?.factoryQueued).toBe(
			"design",
		);
		expect((await h.manager.getTask(approved.taskId))?.factoryQueued).toBe(
			"run",
		);
		h.manager.stopFactoryQueue();
		// Dropping scoping would leave the card pending, unqueued and unheld.
		expect((await h.manager.getTask(scoping.taskId))?.factoryQueued).toBe(
			"design",
		);
		expect(
			(await h.manager.getTask(approved.taskId))?.factoryQueued,
		).toBeUndefined();
	});

	it("starts no scoping or run while paused, keeps the pause across a restart and starts queued work on resume", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-factory-pause-"));
		cleanup.push(async () => rmSync(root, { recursive: true, force: true }));
		const { FileFactoryDefaultsStore } = await import("./factory-defaults");
		const path = join(root, "factory-defaults.json");
		await new FileFactoryDefaultsStore(path).setPaused(true);
		const resolveFactoryPaused = () =>
			new FileFactoryDefaultsStore(path).getPaused();
		const first = harness({ resolveFactoryPaused });
		expect(first.manager.getFactoryPaused()).toBe(false);
		await first.manager.start();
		expect(first.manager.getFactoryPaused()).toBe(true);
		const scoping = await submitHandsOff(first, "Scope me");
		const approved = await first.create();
		await first.manager.approveTask(
			approved.taskId,
			{ kind: "user" },
			approved.revision,
		);
		// A direct run request is refused too; nothing starts.
		await expect(
			first.manager.runTask(
				approved.taskId,
				{ kind: "user" },
				approved.revision,
			),
		).rejects.toThrow("Factory is paused");
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(first.runtime.startDesignSession).not.toHaveBeenCalled();
		expect(first.runtime.runSession).not.toHaveBeenCalled();
		expect((await first.manager.getTask(scoping.taskId))?.factoryQueued).toBe(
			"design",
		);
		expect(await first.manager.getTask(approved.taskId)).toMatchObject({
			status: "approved",
			factoryQueued: "run",
		});
		expect(first.manager.getFactoryQueueState()).toMatchObject({
			paused: true,
			working: [],
			queued: expect.arrayContaining([
				{ taskId: scoping.taskId, stage: "design" },
				{ taskId: approved.taskId, stage: "run" },
			]),
		});
		await first.manager.dispose();

		// A new Hub reads the pause from the same defaults file.
		const restarted = harness({ resolveFactoryPaused });
		const tracker = trackWorking(restarted);
		await restarted.manager.start();
		expect(restarted.manager.getFactoryPaused()).toBe(true);
		const queuedAgain = await submitHandsOff(restarted, "Queued while paused");
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(tracker.working()).toHaveLength(0);
		expect(restarted.runtime.startDesignSession).not.toHaveBeenCalled();

		await new FileFactoryDefaultsStore(path).setPaused(false);
		expect(restarted.manager.setFactoryPaused(false)).toBe(false);
		await vi.waitFor(() =>
			expect(restarted.runtime.startDesignSession).toHaveBeenCalled(),
		);
		expect(
			(await restarted.manager.getTask(queuedAgain.taskId))?.factoryQueued,
		).toBe("design");
	});
});

describe("Factory backlog adoption", () => {
	/** A card a previous build left pending with an empty queue. */
	const legacy = async (
		h: ReturnType<typeof harness>,
		factory: Partial<FactoryTaskConfig> = {},
	) => {
		const task = await h.create(2, factory);
		const store = new SqliteAgendaTaskStore({
			dbPath: join(h.root, "tasks.db"),
		});
		try {
			store.dequeueFactory(task.taskId);
		} finally {
			store.close();
		}
		return task;
	};
	const held = (h: ReturnType<typeof harness>) =>
		h.manager.createTask({
			title: "Held feature",
			type: "follow-up",
			instructions: "Acceptance: feature.txt contains after.",
			scope: "workspace",
			workspaceRoot: h.repo,
			expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
			createdBy: { kind: "user" },
			queueFactoryDesign: false,
			factory: factoryTaskConfigSchema.parse({
				checks: [{ name: "API", kind: "api", command: "true" }],
				acceptanceCriteria: [{ id: "api", text: "API passes", check: "API" }],
			}),
		});

	it("defers adopting policy-less legacy cards until a default is received, and logs a held card once", async () => {
		let received = false;
		const log = vi.fn();
		const h = harness({
			resolveFactoryDefaultsReceived: async () => received,
			logger: { log },
		});
		const task = await legacy(h);
		const hold = await held(h);
		await h.manager.start();
		await h.manager.adoptFactoryBacklog();
		const untouched = await h.manager.getTask(task.taskId);
		expect(untouched?.factory?.adoptedPolicy).toBeUndefined();
		expect(untouched?.factory?.autonomy).toBeUndefined();
		expect(untouched?.factoryQueued).toBeUndefined();
		expect(untouched?.revision).toBe(task.revision);
		expect(log).toHaveBeenCalledWith(
			"factory backlog adoption deferred until a default workflow is received",
			{ cards: 1 },
		);
		// The held card's reason is logged once per process, not per sweep.
		expect(
			log.mock.calls.filter(
				([message, meta]) =>
					message === "factory backlog card not adopted" &&
					(meta as { taskId?: string }).taskId === hold.taskId,
			),
		).toHaveLength(1);

		// The first default push (here: a clear) lets the sweep adopt it.
		received = true;
		const adopted = await h.manager.adoptFactoryBacklog();
		expect(adopted.map((card) => card.taskId)).toEqual([task.taskId]);
		expect((await h.manager.getTask(task.taskId))?.factory).toMatchObject({
			adoptedPolicy: { source: "built_in" },
		});
	});

	it("adopts never-scoped legacy cards on start and runs them to a result with the built-in policy", async () => {
		const h = harness({ independentReviewer: true });
		const published = vi
			.spyOn(factoryLocal, "publishFactoryPullRequest")
			.mockResolvedValue("https://github.com/acme/app/pull/7");
		const body = vi
			.spyOn(factoryLocal, "updateFactoryPullRequestBody")
			.mockResolvedValue();
		cleanup.unshift(async () => {
			published.mockRestore();
			body.mockRestore();
		});
		const task = await legacy(h);
		expect(task.factory?.autonomy).toBeUndefined();
		expect(task.factory?.approval).toBe("required");
		const hold = await held(h);
		expect(hold.factory?.hold).toBe(true);
		expect(hold.factoryQueued).toBeUndefined();
		const archived = await legacy(h);
		await h.manager.archiveTask(
			archived.taskId,
			{ kind: "user" },
			archived.revision,
		);
		await h.manager.start();
		await vi.waitFor(
			async () =>
				expect((await h.manager.getTask(task.taskId))?.status).toBe(
					"completed",
				),
			{ timeout: 15000 },
		);
		const done = await h.manager.getTask(task.taskId);
		expect(done?.factory).toMatchObject({
			autonomy: "hands_off",
			approval: "automatic",
			// Adoption keeps the card's stored publish setting (off here).
			publishPullRequest: false,
			watchPullRequest: false,
			maxRepairRounds: 2,
			adoptedPolicy: { source: "built_in" },
		});
		expect(h.builds()).toBe(1);
		// Held and archived cards are left exactly as they were.
		const stillHeld = await h.manager.getTask(hold.taskId);
		expect(stillHeld).toMatchObject({
			status: "pending_approval",
			revision: hold.revision,
			factory: { hold: true },
		});
		expect(stillHeld?.factoryDesignProgress).toBeUndefined();
		expect(stillHeld?.factoryQueued).toBeUndefined();
		const stillArchived = await h.manager.getTask(archived.taskId);
		expect(stillArchived?.factory?.adoptedPolicy).toBeUndefined();
		expect(stillArchived?.factoryDesignProgress).toBeUndefined();
		// A later sweep, such as a new Hub default, changes nothing.
		await expect(h.manager.adoptFactoryBacklog()).resolves.toEqual([]);
		expect((await h.manager.getTask(task.taskId))?.revision).toBe(
			done?.revision,
		);
	});

	it("queues a card once, exposes its queue stage, and leaves cards with plans or approval alone", async () => {
		const h = harness();
		const task = await legacy(h);
		const approved = await legacy(h);
		await h.manager.approveTask(
			approved.taskId,
			{ kind: "user" },
			approved.revision,
		);
		const store = new SqliteAgendaTaskStore({
			dbPath: join(h.root, "tasks.db"),
		});
		try {
			// Approval queued it for execution; empty the queue as a crash would.
			store.dequeueFactory(approved.taskId);
		} finally {
			store.close();
		}
		const approvedBefore = await h.manager.getTask(approved.taskId);
		// Start without pumping design so the queued state is observable.
		let releaseDesign = () => {};
		const design = new Promise<void>((resolve) => {
			releaseDesign = resolve;
		});
		h.runtime.startDesignSession = vi.fn(async () => {
			await design;
			return { sessionId: "held-designer" };
		});
		cleanup.unshift(async () => releaseDesign());
		await h.manager.start();
		await vi.waitFor(async () =>
			expect(
				(await h.manager.getTask(task.taskId))?.factory?.adoptedPolicy,
			).toBeDefined(),
		);
		const [first, second] = await Promise.all([
			h.manager.adoptFactoryBacklog(),
			h.manager.adoptFactoryBacklog(),
		]);
		expect([...first, ...second]).toEqual([]);
		const adopted = await h.manager.getTask(task.taskId);
		expect(
			adopted?.factoryQueued === "design" ||
				adopted?.factoryDesignProgress?.phase === "designing",
		).toBe(true);
		expect(await h.manager.getTask(approved.taskId)).toMatchObject({
			status: "approved",
			revision: approvedBefore?.revision,
		});
		expect(
			(await h.manager.getTask(approved.taskId))?.factory?.adoptedPolicy,
		).toBeUndefined();
	});

	it("adopts the Hub default's automatic fields and keeps plan approval for a repository workflow", async () => {
		const reviewed = createFactoryWorkflowRecipe({
			name: "Reviewed delivery",
			config: { approval: "required", maxRepairRounds: 1 },
		});
		const h = harness({ defaultWorkflow: reviewed });
		const task = await legacy(h);
		const repository = await legacy(h, {
			workflow: { name: "Repo recipe", revision: "f".repeat(64) },
			workflowSource: "repository",
		});
		await h.manager.start();
		await vi.waitFor(async () =>
			expect(
				(await h.manager.getTask(task.taskId))?.factoryDesignProgress?.phase,
			).toBe("complete"),
		);
		const waiting = await h.manager.getTask(task.taskId);
		// A default without hands-off scopes the card and waits for approval.
		expect(waiting).toMatchObject({
			status: "pending_approval",
			factory: {
				approval: "required",
				maxRepairRounds: 2,
				adoptedPolicy: { source: "hub_default", workflow: "Reviewed delivery" },
			},
		});
		expect(waiting?.factory?.autonomy).toBeUndefined();
		expect(h.builds()).toBe(0);
		await vi.waitFor(async () =>
			expect(
				(await h.manager.getTask(repository.taskId))?.factory?.adoptedPolicy,
			).toBeDefined(),
		);
		expect(
			(await h.manager.getTask(repository.taskId))?.factory?.approval,
		).toBe("required");
	});

	it("never relaxes approval for a repository workflow even when the default is automatic", () => {
		const automatic = createFactoryWorkflowRecipe({
			name: "Hands-off",
			config: { autonomy: "hands_off", approval: "automatic" },
		});
		const task = {
			createdBy: { kind: "agent" },
		} as unknown as AgendaTaskRecord;
		const config = factoryTaskConfigSchema.parse({
			workflow: { name: "Hands-off", revision: automatic.revision },
			workflowSource: "repository",
		});
		const at = "2026-11-11T00:00:00Z";
		expect(adoptFactoryPolicy(task, config, automatic, at)).toMatchObject({
			autonomy: "hands_off",
			approval: "required",
		});
		// An agent card naming a workflow that is not the Hub default is not trusted.
		const named = factoryTaskConfigSchema.parse({
			workflow: { name: "Hands-off", revision: "0".repeat(64) },
		});
		expect(adoptFactoryPolicy(task, named, automatic, at).approval).toBe(
			"required",
		);
		// Without any workflow the built-in policy applies, publishing included,
		// but an agent's card is not trusted to approve plans automatically.
		const bare = factoryTaskConfigSchema
			.omit({ publishPullRequest: true })
			.parse({});
		expect(
			adoptFactoryPolicy(task, bare as FactoryTaskConfig, undefined, at),
		).toMatchObject({
			autonomy: "hands_off",
			approval: "required",
			publishPullRequest: true,
			watchPullRequest: false,
			maxCostUsd: 10,
			adoptedPolicy: { source: "built_in", at },
		});
		const person = {
			createdBy: { kind: "user" },
		} as unknown as AgendaTaskRecord;
		expect(
			adoptFactoryPolicy(person, bare as FactoryTaskConfig, undefined, at)
				.approval,
		).toBe("automatic");
		// A stored publish opt-out is kept.
		expect(
			adoptFactoryPolicy(
				person,
				factoryTaskConfigSchema.parse({ publishPullRequest: false }),
				undefined,
				at,
			).publishPullRequest,
		).toBe(false);
	});

	it("adopts a card whose scoping stalled in an earlier build and logs why", async () => {
		const logs: Array<[string, unknown]> = [];
		const h = harness({
			independentReviewer: true,
			logger: { log: (m, d) => logs.push([m, d]) },
		});
		const published = vi
			.spyOn(factoryLocal, "publishFactoryPullRequest")
			.mockResolvedValue("https://github.com/acme/app/pull/8");
		const body = vi
			.spyOn(factoryLocal, "updateFactoryPullRequestBody")
			.mockResolvedValue();
		cleanup.unshift(async () => {
			published.mockRestore();
			body.mockRestore();
		});
		const task = await legacy(h);
		const store = new SqliteAgendaTaskStore({
			dbPath: join(h.root, "tasks.db"),
		});
		try {
			// An old interactive designer recorded its session and a question,
			// but never design progress, then the Hub restarted.
			store.updateTaskState(task.taskId, {
				factoryDesignSessionIds: ["factory_design_old"],
				originSessionId: "factory_design_old",
				factoryQuestions: [
					{
						questionId: "factory_question_old",
						revision: task.revision,
						sessionId: "factory_design_old",
						question: "Should the brief authorize changes?",
						createdAt: "2026-11-10T00:00:00Z",
						status: "pending",
					},
				],
			});
		} finally {
			store.close();
		}
		const hold = await held(h);
		await h.manager.start();
		await vi.waitFor(
			async () =>
				expect((await h.manager.getTask(task.taskId))?.status).toBe(
					"completed",
				),
			{ timeout: 15000 },
		);
		const done = await h.manager.getTask(task.taskId);
		expect(done?.factory?.adoptedPolicy).toBeDefined();
		expect(done?.factoryQuestions ?? []).toEqual([]);
		expect(logs).toContainEqual([
			"factory backlog card adopted and queued for scoping",
			expect.objectContaining({
				taskId: task.taskId,
				reason: "stalled scoping from an earlier build",
			}),
		]);
		expect(logs).toContainEqual([
			"factory backlog card not adopted",
			{ taskId: hold.taskId, reason: "held" },
		]);
	});

	it("clears an explicit hold when scoping starts", async () => {
		const h = harness();
		const hold = await held(h);
		await h.manager.start();
		await h.manager.startFactoryDesign(hold.taskId);
		const started = await h.manager.getTask(hold.taskId);
		expect(started?.factory?.hold).toBeUndefined();
		expect(started?.factoryDesignProgress?.revision).toBe(started?.revision);
	});
});

describe("factoryResumeState", () => {
	const legacy = {
		phase: "blocked",
		repairRound: 1,
		candidate: { commit: "abc", checks: [], reviews: [] },
		error: "Repair limit (1) reached.\n- Reviewer 1: Remove the second check.",
		pullRequestUrl: "https://github.com/example/project/pull/9",
	} as unknown as FactoryRunState;

	it("grants a person one round on a repair-limit stop recorded without findings", () => {
		const granted = factoryResumeState(legacy, { kind: "user", id: "desktop" });
		expect(granted?.extraRepairRounds).toBe(1);
		expect(granted?.error).toBeUndefined();
		// The cleared error keeps a later retry from granting it again.
		expect(
			factoryResumeState(granted, { kind: "user", id: "desktop" })
				?.extraRepairRounds,
		).toBe(1);
		// The run's own error also identifies the stop.
		expect(
			factoryResumeState(
				{ ...legacy, error: undefined },
				{ kind: "user", id: "desktop" },
				"Repair limit (1) reached.",
			)?.extraRepairRounds,
		).toBe(1);
	});

	it("never grants system or agent actors, other stops, or stops without a candidate", () => {
		for (const actor of [
			{ kind: "system", id: "task_manager" },
			{ kind: "agent", id: "agent" },
		] as const)
			expect(factoryResumeState(legacy, actor)).toBe(legacy);
		const user = { kind: "user", id: "desktop" } as const;
		const other = { ...legacy, error: "Plan repair limit (1) reached." };
		expect(factoryResumeState(other, user)).toBe(other);
		const noCandidate = { ...legacy, candidate: undefined };
		expect(factoryResumeState(noCandidate, user)).toBe(noCandidate);
	});
});
