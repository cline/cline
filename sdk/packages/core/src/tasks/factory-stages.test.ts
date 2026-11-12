import { execFileSync } from "node:child_process";
import {
	existsSync,
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
	AgendaTaskRunRecord,
	FactoryRepositoryStage,
	FactoryRunState,
	FactoryStageResult,
} from "@cline/shared";
import {
	FACTORY_STAGES_PATH,
	factoryActiveStage,
	factoryRecordedReviewIndependence,
	factoryRunRoute,
	factoryStagesFileSchema,
	factoryTaskConfigSchema,
} from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgendaTaskRuntime } from "./agenda-task-manager";
import { FactoryDecisionError } from "./factory-errors";
import * as factoryLocal from "./factory-local";
import { prepareFactoryWorkspace } from "./factory-local";
import {
	FactoryStageError,
	FileFactoryStageTrustStore,
	factoryStageHash,
	factoryStageSkipReason,
	listFactoryStages,
	matchesFactoryGlob,
	readFactoryStages,
	resolveFactoryStagePlan,
	runFactoryCommandStage,
} from "./factory-stages";
import { runFactoryWorkflow } from "./factory-workflow";

const roots: string[] = [];
afterEach(() => {
	vi.restoreAllMocks();
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "cline-factory-stages-"));
	roots.push(root);
	return root;
}

function gitRepo(root: string): string {
	const repo = join(root, "repo");
	execFileSync("git", ["init", "-q", "-b", "main", repo]);
	execFileSync("git", ["-C", repo, "config", "user.name", "Test"]);
	execFileSync("git", [
		"-C",
		repo,
		"config",
		"user.email",
		"test@example.invalid",
	]);
	writeFileSync(join(repo, "feature.txt"), "before\n");
	execFileSync("git", ["-C", repo, "add", "."]);
	execFileSync("git", ["-C", repo, "commit", "-q", "-m", "Initial"]);
	return repo;
}

function writeStages(repo: string, stages: unknown[]): void {
	mkdirSync(join(repo, ".cline/factory"), { recursive: true });
	writeFileSync(
		join(repo, FACTORY_STAGES_PATH),
		JSON.stringify({ schemaVersion: 1, stages }),
	);
}

const commandStage = (
	command: string,
	extra: Partial<Extract<FactoryRepositoryStage, { kind: "command" }>> = {},
): Extract<FactoryRepositoryStage, { kind: "command" }> => ({
	id: "no-todo-left",
	name: "No TODO left",
	kind: "command",
	command,
	...extra,
});

describe("repository stage definitions", () => {
	it("bounds the file strictly: no extra fields, unique ids, at most 8 stages", () => {
		const stage = commandStage("true");
		expect(
			factoryStagesFileSchema.safeParse({ schemaVersion: 1, stages: [stage] })
				.success,
		).toBe(true);
		for (const invalid of [
			{ schemaVersion: 1, stages: [{ ...stage, skipReview: true }] },
			{ schemaVersion: 1, stages: [stage], publish: false },
			{ schemaVersion: 1, stages: [stage, stage] },
			{ schemaVersion: 1, stages: Array(9).fill(stage) },
			{ schemaVersion: 1, stages: [{ ...stage, command: "x".repeat(2001) }] },
			{ schemaVersion: 1, stages: [{ ...stage, timeoutSeconds: 5 }] },
			{ schemaVersion: 1, stages: [{ ...stage, artifacts: ["../out.log"] }] },
			{ schemaVersion: 1, stages: [{ ...stage, when: {} }] },
		])
			expect(factoryStagesFileSchema.safeParse(invalid).success).toBe(false);
	});

	it("hashes the canonical definition: key order is irrelevant, any change is a new identity", () => {
		const stage = commandStage("true", { blocking: false });
		const reordered = {
			blocking: false,
			command: "true",
			kind: "command",
			name: "No TODO left",
			id: "no-todo-left",
		};
		expect(factoryStageHash(reordered)).toBe(factoryStageHash(stage));
		expect(factoryStageHash({ ...stage, command: "false" })).not.toBe(
			factoryStageHash(stage),
		);
	});

	it("reads the checkout's file and refuses unsafe commands", () => {
		const repo = gitRepo(tempRoot());
		expect(readFactoryStages(repo)).toEqual({ status: "absent" });
		writeStages(repo, [commandStage("bun run lint")]);
		expect(readFactoryStages(repo)).toMatchObject({
			status: "present",
			stages: [{ stage: { id: "no-todo-left" } }],
		});
		writeStages(repo, [commandStage("bun run build && git push origin HEAD")]);
		expect(readFactoryStages(repo)).toEqual({
			status: "invalid",
			reason: 'stage "no-todo-left" pushes to a git remote',
		});
		writeFileSync(join(repo, FACTORY_STAGES_PATH), "{");
		expect(readFactoryStages(repo)).toEqual({
			status: "invalid",
			reason: "the stages file is not valid JSON",
		});
	});

	it("resolves approved stages by hash; changed, declined and undecided ones are listed with a reason", async () => {
		const root = tempRoot();
		const repo = gitRepo(root);
		const path = join(root, "trust.json");
		const store = new FileFactoryStageTrustStore(path);
		expect(await resolveFactoryStagePlan(repo, store)).toBeUndefined();
		const approved = commandStage("true");
		const declined = { ...commandStage("true"), id: "declined", name: "Off" };
		const changed = { ...commandStage("true"), id: "changed", name: "Edited" };
		const fresh = { ...commandStage("true"), id: "fresh", name: "New" };
		writeStages(repo, [approved, declined, changed, fresh]);
		await store.decide(
			repo,
			approved.id,
			factoryStageHash(approved),
			"approved",
		);
		await store.decide(
			repo,
			declined.id,
			factoryStageHash(declined),
			"declined",
		);
		await store.decide(repo, changed.id, factoryStageHash(changed), "approved");
		writeStages(repo, [
			approved,
			declined,
			{ ...changed, command: "false" },
			fresh,
		]);
		// Decisions survive a new store instance on the same file.
		const plan = await resolveFactoryStagePlan(
			repo,
			new FileFactoryStageTrustStore(path),
		);
		expect(plan?.stages.map((entry) => entry.stage.id)).toEqual([
			"no-todo-left",
		]);
		expect(plan?.unapproved).toEqual([
			{
				id: "declined",
				name: "Off",
				reason: "it is turned off in Factory settings",
			},
			{
				id: "changed",
				name: "Edited",
				reason: "its definition changed and is not approved yet",
			},
			{
				id: "fresh",
				name: "New",
				reason: "its definition is not approved yet",
			},
		]);
		writeFileSync(join(repo, FACTORY_STAGES_PATH), "[]");
		expect(await resolveFactoryStagePlan(repo, store)).toMatchObject({
			stages: [],
			unapproved: [{ name: "Repository stages" }],
		});
		expect(await listFactoryStages(repo, store)).toMatchObject({
			file: "invalid",
		});
	});
});

describe("repository stage conditions", () => {
	it.each([
		["sdk/packages/core/src/a.ts", "sdk/**", true],
		["sdk/a.ts", "sdk/**/*.ts", true],
		["sdk/packages/core/src/a.ts", "sdk/**/*.ts", true],
		["sdk/a.tsx", "sdk/**/*.ts", false],
		["apps/a.ts", "sdk/**", false],
		["docs/guide.md", "docs/*.md", true],
		["docs/deep/guide.md", "docs/*.md", false],
		["CHANGELOG.md", "CHANGELOG.md", true],
		["a.b", "a?b", true],
		["a/b", "a?b", false],
		["sdk/packages/x/src/y.ts", "sdk/packages/*/src/**", true],
		["file.ts", "./file.ts", true],
	])("%s against %s is %s", (file, pattern, expected) => {
		expect(matchesFactoryGlob(file, pattern)).toBe(expected);
	});

	it("skips on unmatched paths or a smaller change, and runs without a size", () => {
		const stage = commandStage("true", {
			when: { paths: ["docs/**"], minSize: "shared_contract" },
		});
		expect(factoryStageSkipReason(stage, { changedPaths: ["src/a.ts"] })).toBe(
			"no matching files",
		);
		expect(
			factoryStageSkipReason(stage, {
				changedPaths: ["docs/a.md"],
				size: "local",
			}),
		).toBe("change smaller than shared contract");
		expect(
			factoryStageSkipReason(stage, {
				changedPaths: ["docs/a.md"],
				size: "cross_cutting",
			}),
		).toBeUndefined();
		expect(
			factoryStageSkipReason(stage, { changedPaths: ["docs/a.md"] }),
		).toBeUndefined();
	});
});

async function workspaceFor(repo: string, root: string) {
	return prepareFactoryWorkspace({
		sourceRoot: repo,
		taskId: `task-${Math.random()}`,
		storageDir: join(root, "storage"),
	});
}

describe("runFactoryCommandStage", () => {
	it("passes the allowlisted environment only, with the stage variables", async () => {
		const root = tempRoot();
		const workspace = await workspaceFor(gitRepo(root), root);
		const head = execFileSync("git", [
			"-C",
			workspace.path,
			"rev-parse",
			"HEAD",
		])
			.toString()
			.trim();
		vi.stubEnv("ANTHROPIC_API_KEY", "sk-secret-value");
		const result = await runFactoryCommandStage({
			stage: commandStage(
				'echo "key=[$ANTHROPIC_API_KEY] ci=$CI base=$FACTORY_BASE_COMMIT stage=$FACTORY_STAGE_ID"',
			),
			hash: "h",
			workspace,
			candidateCommit: head,
			storageDir: root,
			runId: "run",
			signal: new AbortController().signal,
		});
		vi.unstubAllEnvs();
		expect(result.status).toBe("passed");
		expect(result.output).toContain("key=[] ci=1");
		expect(result.output).toContain(`base=${workspace.baseCommit}`);
		expect(result.output).toContain("stage=no-todo-left");
		expect(result.output).not.toContain("sk-secret-value");
	});

	it("reports a changed worktree as an error and restores the candidate", async () => {
		const root = tempRoot();
		const workspace = await workspaceFor(gitRepo(root), root);
		const head = execFileSync("git", [
			"-C",
			workspace.path,
			"rev-parse",
			"HEAD",
		])
			.toString()
			.trim();
		const result = await runFactoryCommandStage({
			stage: commandStage("echo changed > feature.txt && touch new.txt"),
			hash: "h",
			workspace,
			candidateCommit: head,
			storageDir: root,
			runId: "run",
			signal: new AbortController().signal,
		});
		expect(result).toMatchObject({ status: "error" });
		expect(result.reason).toContain("changed the worktree");
		expect(readFileSync(join(workspace.path, "feature.txt"), "utf8")).toBe(
			"before\n",
		);
		expect(existsSync(join(workspace.path, "new.txt"))).toBe(false);
	});

	it("tells a failed command from one that could not run", async () => {
		const root = tempRoot();
		const workspace = await workspaceFor(gitRepo(root), root);
		const head = execFileSync("git", [
			"-C",
			workspace.path,
			"rev-parse",
			"HEAD",
		])
			.toString()
			.trim();
		const run = (command: string, timeoutSeconds?: number) =>
			runFactoryCommandStage({
				stage: commandStage(command, timeoutSeconds ? { timeoutSeconds } : {}),
				hash: "h",
				workspace,
				candidateCommit: head,
				storageDir: root,
				runId: "run",
				signal: new AbortController().signal,
			});
		await expect(run("echo found a TODO; exit 1")).resolves.toMatchObject({
			status: "failed",
			exitCode: 1,
			reason: "exit 1: found a TODO",
		});
		await expect(run("definitely-not-a-tool-xyz")).resolves.toMatchObject({
			status: "error",
			exitCode: 127,
		});
	});
});

// ---------------------------------------------------------------------------
// Workflow

type Harness = {
	root: string;
	repo: string;
	state: () => FactoryRunState;
	run: () => Promise<Awaited<ReturnType<typeof runFactoryWorkflow>>>;
	roles: string[];
	builds: () => number;
	runtime: AgendaTaskRuntime;
	/** Turn inputs of reviewer sessions, in order. */
	reviewInputs: string[];
};

type StageReply = {
	status: "completed" | "failed";
	summary?: string;
	error?: string;
};

/**
 * A run on a real worktree with a fake runtime: each builder session writes
 * `contents(round)` to feature.txt; reviewers pass.
 */
async function workflowHarness(options: {
	stages: FactoryRepositoryStage[];
	contents?: (build: number) => string;
	maxRepairRounds?: number;
	publishPullRequest?: boolean;
	reviewSelection?: FactoryRunState["reviewSelection"];
	maxRuntimeRetries?: number;
	maxCostUsd?: number;
	/** Each stage session's reply; `call` counts that stage's sessions from 1. */
	stage?: (stageId: string, cwd: string, call: number) => StageReply;
	/** Usage cost per session role. */
	cost?: Partial<Record<string, number>>;
	/** The model each session reports, by role or stage. */
	model?: (role: string, stageId?: string) => string;
}): Promise<Harness> {
	const root = tempRoot();
	const repo = gitRepo(root);
	const workspace = await workspaceFor(repo, root);
	const config = factoryTaskConfigSchema.parse({
		maxRepairRounds: options.maxRepairRounds ?? 2,
		publishPullRequest: options.publishPullRequest ?? false,
		maxRuntimeRetries: options.maxRuntimeRetries ?? 0,
		...(options.maxCostUsd ? { maxCostUsd: options.maxCostUsd } : {}),
	});
	const task = {
		taskId: "task-stages",
		title: "Stages",
		instructions: "Change feature.txt",
		revision: 1,
		workspaceRoot: repo,
		cwd: repo,
		factory: config,
	} as unknown as AgendaTaskRecord;
	const run = {
		runId: "run-stages",
		taskId: task.taskId,
		taskRevision: 1,
	} as unknown as AgendaTaskRunRecord;
	let state: FactoryRunState = {
		phase: "implementing",
		repairRound: 0,
		workspace,
		sessions: [],
		...(options.reviewSelection
			? { reviewSelection: options.reviewSelection }
			: {}),
		stagePlan: {
			stages: options.stages.map((stage) => ({
				stage,
				hash: factoryStageHash(stage),
			})),
			unapproved: [],
		},
	};
	const roles: string[] = [];
	const reviewInputs: string[] = [];
	const sessionRoles = new Map<string, string>();
	const sessionStages = new Map<string, string>();
	const stageCalls = new Map<string, number>();
	let builds = 0;
	let index = 0;
	const runtime: AgendaTaskRuntime = {
		startSession: vi.fn(async (_task, _run, _client, config) => {
			const sessionId = config?.sessionId ?? `s${++index}`;
			sessionRoles.set(sessionId, config?.factoryRole ?? "builder");
			if (config?.factoryStage)
				sessionStages.set(sessionId, config.factoryStage);
			return { sessionId };
		}),
		getSessionUsage: vi.fn(async (sessionId: string) => ({
			inputTokens: 1,
			outputTokens: 1,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost:
				options.cost?.[
					sessionStages.has(sessionId)
						? "stage"
						: (sessionRoles.get(sessionId) ?? "builder")
				] ?? 0,
		})),
		getSessionModel: vi.fn(async (sessionId: string) =>
			options.model
				? {
						providerId: "test",
						modelId: options.model(
							sessionRoles.get(sessionId) ?? "builder",
							sessionStages.get(sessionId),
						),
					}
				: undefined,
		),
		runSession: vi.fn(async (sessionId, assigned) => {
			const role = sessionRoles.get(sessionId) ?? "builder";
			const stageId = sessionStages.get(sessionId);
			if (stageId) {
				roles.push(`stage:${stageId}`);
				const call = (stageCalls.get(stageId) ?? 0) + 1;
				stageCalls.set(stageId, call);
				return (
					options.stage?.(stageId, assigned.cwd ?? "", call) ?? {
						status: "completed" as const,
						summary: JSON.stringify({
							verdict: "pass",
							summary: "Fine.",
							findings: [],
						}),
					}
				);
			}
			roles.push(role);
			if (role === "reviewer") reviewInputs.push(assigned.instructions);
			if (role === "builder") {
				builds++;
				writeFileSync(
					join(assigned.cwd ?? "", "feature.txt"),
					options.contents?.(builds) ?? `build ${builds}\n`,
				);
				return { status: "completed" as const, summary: "Changed it." };
			}
			return {
				status: "completed" as const,
				summary: JSON.stringify({
					verdict: "pass",
					summary: "Looks right.",
					findings: [],
				}),
			};
		}),
		abortSession: vi.fn(async () => {}),
		reconcileSession: vi.fn(async () => ({ status: "missing" as const })),
	} as unknown as AgendaTaskRuntime;
	return {
		root,
		repo,
		roles,
		builds: () => builds,
		runtime,
		reviewInputs,
		state: () => state,
		run: () =>
			runFactoryWorkflow({
				task,
				run,
				state,
				runtime,
				storageDir: join(root, "storage"),
				signal: new AbortController().signal,
				save: (next) => {
					state = next;
				},
				sessionStarted: () => {},
			}),
	};
}

const noTodo = commandStage(
	'! git diff "$FACTORY_BASE_COMMIT"..HEAD | grep -nE "^\\+.*TODO"',
);

describe("repository stages in the Factory workflow", () => {
	it("sends a failed blocking stage to the builder once and starts no reviewer in that round", async () => {
		const h = await workflowHarness({
			stages: [noTodo],
			contents: (build) => (build === 1 ? "TODO: later\n" : "done\n"),
		});
		await expect(h.run()).resolves.toMatchObject({ status: "completed" });
		const state = h.state();
		expect(state.repairRound).toBe(1);
		expect(h.roles).toEqual(["builder", "builder", "reviewer"]);
		expect(state.candidateHistory?.at(-1)?.stages).toMatchObject([
			{ id: "no-todo-left", status: "failed", exitCode: 1 },
		]);
		expect(
			state.attempts?.find((a) => a.key === "builder:1")?.instructions,
		).toContain('Repository stage "No TODO left" failed');
		expect(state.candidate?.stages).toMatchObject([
			{
				id: "no-todo-left",
				status: "passed",
				command: noTodo.command,
				blocking: true,
			},
		]);
		expect(factoryActiveStage(state)).toBeUndefined();
	});

	it("stops without a builder round when a blocking stage cannot run", async () => {
		const h = await workflowHarness({
			stages: [commandStage("definitely-not-a-tool-xyz --scan")],
		});
		const failure = h.run();
		await expect(failure).rejects.toBeInstanceOf(FactoryStageError);
		await expect(failure).rejects.not.toBeInstanceOf(FactoryDecisionError);
		await expect(failure).rejects.toThrow(
			/^Repository stage "No TODO left" could not run: exit 127/,
		);
		expect(h.builds()).toBe(1);
		expect(h.state()).toMatchObject({ phase: "blocked", repairRound: 0 });
		expect(h.state().candidate?.stages?.[0]?.status).toBe("error");
	});

	it("stops on a stage that times out", async () => {
		const h = await workflowHarness({
			stages: [commandStage("sleep 30", { timeoutSeconds: 10 })],
		});
		vi.spyOn(factoryLocal, "runFactoryShellCommand").mockResolvedValueOnce({
			exitCode: null,
			output: "",
			truncated: false,
			timedOut: true,
		});
		await expect(h.run()).rejects.toThrow(
			'Repository stage "No TODO left" could not run: timed out after 10 seconds',
		);
		expect(h.builds()).toBe(1);
	});

	it("does not rerun a finished stage after a restart", async () => {
		const counter = join(tmpdir(), `cline-stage-count-${Date.now()}`);
		roots.push(counter);
		const h = await workflowHarness({
			stages: [commandStage(`echo ran >> ${JSON.stringify(counter)}`)],
		});
		await h.run();
		expect(readFileSync(counter, "utf8")).toBe("ran\n");
		await expect(h.run()).resolves.toMatchObject({ status: "completed" });
		expect(readFileSync(counter, "utf8")).toBe("ran\n");
		expect(h.builds()).toBe(1);
	});

	it("never publishes at the repair limit when a blocking stage still fails", async () => {
		vi.spyOn(factoryLocal, "resolveFactoryPullRequestBase").mockResolvedValue(
			"main",
		);
		const publish = vi.spyOn(factoryLocal, "publishFactoryPullRequest");
		const h = await workflowHarness({
			stages: [commandStage("echo still broken; exit 2")],
			maxRepairRounds: 0,
			publishPullRequest: true,
		});
		await expect(h.run()).rejects.toThrow(/Repair limit \(0\) reached/);
		expect(publish).not.toHaveBeenCalled();
		expect(h.roles).toEqual(["builder"]);
		expect(h.state().unresolvedFindings?.findings[0]).toContain(
			'Repository stage "No TODO left" failed: exit 2: still broken',
		);
	});

	it("records a non-blocking failure and continues to review", async () => {
		const h = await workflowHarness({
			stages: [commandStage("exit 3", { blocking: false })],
		});
		await expect(h.run()).resolves.toMatchObject({ status: "completed" });
		expect(h.state().repairRound).toBe(0);
		expect(h.state().candidate?.stages?.[0]).toMatchObject({
			status: "failed",
			blocking: false,
		});
		expect(h.roles).toEqual(["builder", "reviewer"]);
	});

	it("skips a stage whose condition does not hold and records why", async () => {
		const h = await workflowHarness({
			stages: [
				commandStage("exit 1", { when: { paths: ["docs/**"] } }),
				{
					...commandStage("exit 1", { when: { minSize: "cross_cutting" } }),
					id: "big-only",
					name: "Big only",
				},
			],
			reviewSelection: {
				impact: "local",
				size: "local",
				affectedPaths: ["feature.txt"],
				consumers: ["tests"],
				reviewerIndices: [0],
				planReviewerIndices: [0],
				rationale: "Small change.",
			} as unknown as FactoryRunState["reviewSelection"],
		});
		await expect(h.run()).resolves.toMatchObject({ status: "completed" });
		expect(
			h
				.state()
				.candidate?.stages?.map((stage: FactoryStageResult) => [
					stage.id,
					stage.status,
					stage.reason,
				]),
		).toEqual([
			["no-todo-left", "skipped", "no matching files"],
			["big-only", "skipped", "change smaller than cross cutting"],
		]);
		expect(factoryRunRoute(h.state())?.stages).toBe(0);
	});
});

const readStage: FactoryRepositoryStage = {
	id: "license-headers",
	name: "License headers",
	kind: "agent",
	instruction: "Every new source file must start with the license header.",
};
const review = (verdict: "pass" | "changes_requested", findings: string[]) =>
	JSON.stringify({ verdict, summary: "Checked the new files.", findings });

describe("read-only agent stages", () => {
	it("passes on a pass verdict, as a reviewer-role stage session without guidance", async () => {
		const h = await workflowHarness({ stages: [readStage] });
		await expect(h.run()).resolves.toMatchObject({ status: "completed" });
		const state = h.state();
		expect(state.candidate?.stages).toMatchObject([
			{
				id: "license-headers",
				kind: "agent",
				access: "read",
				status: "passed",
				summary: "Fine.",
			},
		]);
		const attempt = state.attempts?.find((a) => a.stageId);
		expect(attempt?.key).toBe(
			`stage:license-headers:0:${state.candidate?.commit}`,
		);
		expect(attempt?.role).toBe("reviewer");
		expect(attempt?.agent.instructions).toContain("You are read-only.");
		expect(attempt?.agent.instructions).toContain(readStage.instruction);
		expect(attempt?.instructions).toContain("FULL DIFF:");
		const start = vi
			.mocked(h.runtime.startSession)
			.mock.calls.find(([, , , config]) => config?.factoryStage);
		// The Hub gives a stage session the role's read tools and no guidance.
		expect(start?.[3]).toMatchObject({
			factoryRole: "reviewer",
			factoryStage: "license-headers",
		});
		expect(h.roles).toEqual(["builder", "stage:license-headers", "reviewer"]);
		// The code reviewer sees the stage result.
		expect(h.reviewInputs[0]).toContain("REPOSITORY STAGE RESULTS");
	});

	it("sends findings to the builder, then passes on the repaired candidate", async () => {
		const h = await workflowHarness({
			stages: [readStage],
			stage: (_id, _cwd, call) => ({
				status: "completed",
				summary:
					call === 1
						? review("changes_requested", [
								"feature.txt:1 has no license header",
							])
						: review("pass", []),
			}),
		});
		await expect(h.run()).resolves.toMatchObject({ status: "completed" });
		expect(h.state().repairRound).toBe(1);
		expect(
			h.state().attempts?.find((a) => a.key === "builder:1")?.instructions,
		).toContain("- feature.txt:1 has no license header");
		expect(h.roles).toEqual([
			"builder",
			"stage:license-headers",
			"builder",
			"stage:license-headers",
			"reviewer",
		]);
	});

	it("stops without a repair when the stage says it could not run", async () => {
		const h = await workflowHarness({
			stages: [readStage],
			stage: () => ({
				status: "completed",
				summary: review("changes_requested", [
					"Stage could not run: there is no LICENSE file to compare against.",
				]),
			}),
		});
		await expect(h.run()).rejects.toThrow(
			'Repository stage "License headers" could not run: there is no LICENSE file to compare against.',
		);
		expect(h.builds()).toBe(1);
	});

	it("retries unparseable output with the existing output retry", async () => {
		const h = await workflowHarness({
			stages: [readStage],
			maxRuntimeRetries: 1,
			stage: (_id, _cwd, call) => ({
				status: "completed",
				summary: call === 1 ? "Looks fine to me." : review("pass", []),
			}),
		});
		await expect(h.run()).resolves.toMatchObject({ status: "completed" });
		expect(
			h
				.state()
				.attempts?.filter((a) => a.stageId)
				.map((a) => [a.status, a.status === "failed" ? a.failure : undefined]),
		).toEqual([
			["failed", "output"],
			["completed", undefined],
		]);
	});

	it("counts toward the card's spending limit and is refused at it", async () => {
		const h = await workflowHarness({
			stages: [readStage],
			maxCostUsd: 1,
			cost: { builder: 5 },
		});
		await expect(h.run()).rejects.toThrow(/reached its \$1/);
		expect(h.roles).toEqual(["builder"]);
		expect(h.state().attempts?.some((a) => a.stageId)).toBe(false);
	});
});

const docsStage: FactoryRepositoryStage = {
	id: "docs-update",
	name: "Docs update",
	kind: "agent",
	access: "write",
	instruction: "Add a line to docs/notes.md describing the change.",
};
const writeDocs = (cwd: string) => {
	mkdirSync(join(cwd, "docs"), { recursive: true });
	writeFileSync(join(cwd, "docs/notes.md"), "Changed feature.txt.\n");
	return { status: "completed" as const, summary: "Added docs/notes.md." };
};

describe("write-capable agent stages", () => {
	const selection = {
		impact: "local",
		size: "local",
		affectedPaths: ["feature.txt"],
		consumers: ["tests"],
		reviewerIndices: [0],
		planReviewerIndices: [0],
		rationale: "Small change.",
	} as unknown as FactoryRunState["reviewSelection"];

	it("puts the stage's edit in the candidate the reviewer sees, without a scope escalation", async () => {
		const h = await workflowHarness({
			stages: [docsStage],
			reviewSelection: selection,
			stage: (_id, cwd) => writeDocs(cwd),
		});
		await expect(h.run()).resolves.toMatchObject({ status: "completed" });
		const state = h.state();
		expect(state.reviewEscalation).toBeUndefined();
		expect(state.candidate?.stages).toMatchObject([
			{
				id: "docs-update",
				access: "write",
				status: "passed",
				changedPaths: ["docs/notes.md"],
				summary: "Added docs/notes.md.",
			},
		]);
		expect(
			execFileSync("git", [
				"-C",
				state.workspace.path,
				"show",
				`${state.candidate?.commit}:docs/notes.md`,
			]).toString(),
		).toBe("Changed feature.txt.\n");
		expect(h.reviewInputs[0]).toContain("docs/notes.md");
		const attempt = state.attempts?.find((a) => a.stageId);
		expect(attempt).toMatchObject({
			key: "stage:docs-update:0",
			role: "builder",
		});
		expect(h.roles).toEqual(["builder", "stage:docs-update", "reviewer"]);
	});

	it("does not rerun after the candidate is frozen, and reruns in a repair round", async () => {
		const h = await workflowHarness({
			stages: [docsStage, noTodo],
			contents: (build) => (build === 1 ? "TODO: later\n" : "done\n"),
			stage: (_id, cwd) => writeDocs(cwd),
		});
		await h.run();
		expect(h.roles).toEqual([
			"builder",
			"stage:docs-update",
			"builder",
			"stage:docs-update",
			"reviewer",
		]);
		await expect(h.run()).resolves.toMatchObject({ status: "completed" });
		expect(h.roles).toHaveLength(5);
		expect(
			h
				.state()
				.attempts?.filter((a) => a.stageId)
				.map((a) => a.key),
		).toEqual(["stage:docs-update:0", "stage:docs-update:1"]);
	});

	it("continues past a non-blocking stage whose session fails, without its partial edits", async () => {
		const h = await workflowHarness({
			stages: [{ ...docsStage, blocking: false }],
			stage: (_id, cwd) => {
				writeDocs(cwd);
				return { status: "failed", error: "model unavailable" };
			},
		});
		await expect(h.run()).resolves.toMatchObject({ status: "completed" });
		const state = h.state();
		expect(state.candidate?.stages?.[0]).toMatchObject({
			status: "error",
			blocking: false,
			changedPaths: [],
		});
		expect(state.candidate?.stages?.[0]?.reason).toContain("model unavailable");
		expect(existsSync(join(state.workspace.path, "docs/notes.md"))).toBe(false);
	});

	it("counts a write stage as an author for review independence", async () => {
		const h = await workflowHarness({
			stages: [docsStage],
			stage: (_id, cwd) => writeDocs(cwd),
			model: (role, stageId) =>
				stageId
					? "openai/gpt-x"
					: role === "reviewer"
						? "openai/gpt-x"
						: "anthropic/claude-x",
		});
		await h.run();
		expect(factoryRecordedReviewIndependence(h.state())).toMatchObject({
			independent: false,
		});
	});
});
