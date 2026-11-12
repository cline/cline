import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgendaTaskActor, AgendaTaskRecord } from "@cline/shared";
import {
	FACTORY_AUTO_APPROVAL_WAITING_PREFIX,
	factoryPlanHoldReason,
	factoryStampRequirement,
	factoryTaskConfigSchema,
} from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	AgendaTaskManager,
	type AgendaTaskRuntime,
	type AgendaTaskRuntimeResult,
} from "./agenda-task-manager";
import type { FactoryGuidanceStore } from "./factory-guidance";
import * as factoryLocal from "./factory-local";
import { FACTORY_PREPARED_SWEEP_LIMITS } from "./factory-prepared";
import { createFactoryTool, describeFactoryCard } from "./factory-tool";
import * as factoryWorkflow from "./factory-workflow";

const disposals: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const dispose of disposals.splice(0)) await dispose();
	vi.restoreAllMocks();
});

const pass = JSON.stringify({ verdict: "pass", findings: [], summary: "ok" });
const objection = JSON.stringify({
	verdict: "changes_requested",
	findings: ["The check greps the wrong file."],
	summary: "Wrong file",
});
/** Fails at the base commit (the typo is there) and passes once fixed. */
const fixCheck = {
	name: "Typo fixed",
	kind: "test",
	command: 'grep -q "hello world" src/greeting.txt',
	artifacts: [],
} as const;
const criterion = {
	id: "typo-fixed",
	text: "The greeting reads hello world",
	required: true,
	check: "Typo fixed",
};
const person: AgendaTaskActor = { kind: "user" };
const agent: AgendaTaskActor = { kind: "agent", id: "scheduled" };
const designSelection = {
	impact: "local",
	size: "local",
	rationale: "One file",
	affectedPaths: ["src"],
	consumers: ["greeting"],
	planReviewerIndices: [],
	reviewerIndices: [0],
};

function git(cwd: string, ...args: string[]) {
	execFileSync(
		"git",
		["-c", "user.email=f@example.com", "-c", "user.name=F", ...args],
		{ cwd, stdio: "ignore" },
	);
}

function openManager(
	root: string,
	runtime: AgendaTaskRuntime,
	guidanceTopics: string[] = [],
) {
	return new AgendaTaskManager({
		runtime,
		dbPath: join(root, "tasks.db"),
		globalSpecsDir: join(root, "specs"),
		watchFiles: false,
		automationEnabled: false,
		factoryStorageDir: join(root, "factory"),
		...(guidanceTopics.length
			? {
					factoryGuidance: {
						routingGuidance: () => ({
							block: "",
							snapshot: {
								userHash: "",
								repositoryHash: "",
								topics: guidanceTopics.map((topic) => ({
									source: "user",
									topic,
								})),
							},
						}),
					} as unknown as FactoryGuidanceStore,
				}
			: {}),
	});
}

async function harness(
	options: {
		planReviewers?: number;
		reviewers?: number;
		reviewer?: (call: number) => string;
		guidanceTopics?: string[];
	} = {},
) {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "cline-prepared-")));
	const workspaceRoot = join(root, "repo");
	mkdirSync(join(workspaceRoot, "src"), { recursive: true });
	writeFileSync(join(workspaceRoot, "src", "greeting.txt"), "helo world\n");
	execFileSync("git", ["init", "-q", "-b", "main", workspaceRoot]);
	git(workspaceRoot, "add", ".");
	git(workspaceRoot, "commit", "-q", "-m", "init");
	let reviewerCall = 0;
	const runtime: AgendaTaskRuntime &
		Required<
			Pick<
				AgendaTaskRuntime,
				"startDesignSession" | "startDesignReviewSession" | "runDesignSession"
			>
		> = {
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
		runDesignSession: vi.fn<NonNullable<AgendaTaskRuntime["runDesignSession"]>>(
			async (sessionId): Promise<AgendaTaskRuntimeResult> => {
				if (sessionId.startsWith("factory_plan_review_"))
					return {
						status: "completed",
						summary: options.reviewer?.(reviewerCall++) ?? pass,
					};
				return {
					status: "completed",
					summary: JSON.stringify({
						instructions: "Designer brief",
						checks: [fixCheck],
						acceptanceCriteria: [criterion],
						reviewSelection: designSelection,
					}),
				};
			},
		),
	};
	// Runs take no model: the plan, not the build, is under test.
	vi.spyOn(factoryWorkflow, "runFactoryWorkflow").mockResolvedValue({
		status: "completed",
		summary: "done",
	});
	let manager = openManager(root, runtime, options.guidanceTopics);
	disposals.push(async () => {
		await manager.dispose();
		rmSync(root, { recursive: true, force: true });
	});
	const create = (
		plan: {
			checks?: unknown[];
			acceptanceCriteria?: unknown[];
			paths?: string[];
		} = {},
		createdBy: AgendaTaskActor = person,
		extra: Record<string, unknown> = {},
	) =>
		manager.createTask({
			title: "Fix the greeting typo",
			type: "follow-up",
			instructions: "Fix the typo in src/greeting.txt.",
			scope: "workspace",
			workspaceRoot,
			expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
			createdBy,
			queueFactoryDesign: false,
			factory: factoryTaskConfigSchema.parse({
				autonomy: "hands_off",
				approval: "automatic",
				reviewMode: "adaptive",
				publishPullRequest: false,
				checks: plan.checks ?? [fixCheck],
				acceptanceCriteria: plan.acceptanceCriteria ?? [criterion],
				prepared: { paths: plan.paths ?? ["src/greeting.txt"] },
				agents: {
					planReviewers: Array.from(
						{ length: options.planReviewers ?? 1 },
						() => ({}),
					),
					reviewers: Array.from({ length: options.reviewers ?? 1 }, () => ({
						modelSelection: { providerId: "other", modelId: "reviewer" },
					})),
				},
				...extra,
			}),
		});
	const get = async (taskId: string) => {
		const value = await manager.getTask(taskId);
		if (!value) throw new Error("Task disappeared");
		return value;
	};
	const settled = async (taskId: string) => {
		await vi.waitFor(
			async () => {
				const current = await get(taskId);
				expect(
					(current.factoryDesignProgress?.phase === "complete" &&
						!current.factoryQueued) ||
						Boolean(current.error) ||
						current.status === "approved" ||
						current.status === "in_progress" ||
						current.status === "completed",
				).toBe(true);
			},
			{ timeout: 10_000 },
		);
		await new Promise((resolve) => setTimeout(resolve, 50));
		return get(taskId);
	};
	const scope = async (task: AgendaTaskRecord) => {
		await manager.startFactoryDesign(task.taskId);
		return settled(task.taskId);
	};
	const reviewerCalls = () =>
		vi
			.mocked(runtime.runDesignSession)
			.mock.calls.filter(([id]) => id.startsWith("factory_plan_review_"));
	const designerPrompts = () =>
		vi
			.mocked(runtime.runDesignSession)
			.mock.calls.filter(([id]) => !id.startsWith("factory_plan_review_"))
			.map(([, task]) => task.instructions);
	const reopen = async () => {
		await manager.dispose();
		manager = openManager(root, runtime, options.guidanceTopics);
		return manager;
	};
	return {
		root,
		workspaceRoot,
		runtime,
		get manager() {
			return manager;
		},
		create,
		get,
		scope,
		settled,
		reviewerCalls,
		designerPrompts,
		reopen,
	};
}

describe("prepared scope: quick check instead of the designer", () => {
	it("runs none of a person's plan commands before approval, then its checks at base first, with the allowlisted environment", async () => {
		const h = await harness();
		const shell = vi.spyOn(factoryLocal, "runFactoryShellCommand");
		// A person's own request still gets the quick model check.
		const held = await h.scope(
			await h.create({}, person, { approval: "required" }),
		);
		expect(h.runtime.startDesignSession).not.toHaveBeenCalled();
		expect(h.reviewerCalls()).toHaveLength(1);
		expect(shell).not.toHaveBeenCalled();
		expect(held.factoryDesignProgress?.route).toEqual({
			scoping: "prepared",
			paths: ["src/greeting.txt"],
			sweep: "model",
		});
		// The supplied plan is frozen as the card's plan, waiting for the person.
		expect(held.factory?.prepared).toBeUndefined();
		expect(held.factory?.checks).toEqual([fixCheck]);
		expect(held.approvedRevision).toBeUndefined();
		const approved = await h.manager.approveTask(
			held.taskId,
			person,
			held.revision,
		);
		await h.manager.runTask(approved.taskId, person, approved.revision);
		await vi.waitFor(() =>
			expect(factoryWorkflow.runFactoryWorkflow).toHaveBeenCalledTimes(1),
		);
		expect(shell).toHaveBeenCalledTimes(1);
		expect(shell.mock.calls[0]?.[0]).toMatchObject({
			command: fixCheck.command,
			environment: "allowlisted",
		});
		const task = await h.get(held.taskId);
		const route = task.factoryDesignProgress?.route;
		expect(route?.base).toMatchObject({
			outcome: "fails",
			checks: [{ name: "Typo fixed", status: "failed", exitCode: 1 }],
		});
		expect(route?.base?.commit).toMatch(/^[a-f0-9]{40}$/);
		expect(task.factoryDesignProgress?.reviewSelection).toMatchObject({
			size: "local",
			affectedPaths: ["src/greeting.txt"],
		});
		expect(
			describeFactoryCard(task, h.manager.getTaskRuns(task.taskId), undefined)
				.scope,
		).toBe("provided; quick check passed");
	});

	/** Approves and runs a supplied plan whose base run sends it back to scoping. */
	const runToRescope = async (
		h: Awaited<ReturnType<typeof harness>>,
		check: Omit<typeof fixCheck, "command"> & { command: string },
	) => {
		const approved = await h.scope(await h.create({ checks: [check] }));
		expect(approved.approvedRevision).toBe(approved.revision);
		await h.manager.runTask(approved.taskId, person, approved.revision);
		// The designer scopes it next (the queue starts it), never a person.
		await vi.waitFor(() =>
			expect(h.runtime.startDesignSession).toHaveBeenCalledTimes(1),
		);
		const runs = h.manager.getTaskRuns(approved.taskId);
		const stopped = runs[runs.length - 1];
		expect(stopped?.status).toBe("failed");
		// No builder ran and no repair round was spent.
		expect(stopped?.factory?.attempts ?? []).toEqual([]);
		const task = await h.get(approved.taskId);
		expect(task.factoryDesignProgress?.repairRound).toBe(0);
		return { task, error: stopped?.error };
	};

	it("sends an approved plan whose checks all pass at base to the designer with the plan as input", async () => {
		const h = await harness();
		const always = { ...fixCheck, command: "test -f src/greeting.txt" };
		const { task, error } = await runToRescope(h, always);
		expect(error).toContain("already passes at the base commit");
		const route = task.factoryDesignProgress?.route;
		expect(route?.scoping).toBe("designer");
		expect(route?.reason).toContain("already passes at the base commit");
		expect(route?.base?.outcome).toBe("all_pass");
		await vi.waitFor(() => expect(h.designerPrompts()).toHaveLength(1));
		const [prompt] = h.designerPrompts();
		expect(prompt).toContain("test -f src/greeting.txt");
		expect(prompt).toContain("came with the request");
	});

	it("treats a check that cannot run at base as inconclusive and sends the approved plan to the designer", async () => {
		const h = await harness();
		const missing = { ...fixCheck, command: "no-such-factory-tool --check" };
		const { task } = await runToRescope(h, missing);
		const route = task.factoryDesignProgress?.route;
		expect(route?.scoping).toBe("designer");
		expect(route?.base).toMatchObject({
			outcome: "inconclusive",
			checks: [{ status: "inconclusive", exitCode: 127 }],
		});
		expect(route?.reason).toContain("could not run at the base commit");
	});

	it("sends a plan with an unsafe check command to the designer without running anything", async () => {
		const h = await harness();
		const shell = vi.spyOn(factoryLocal, "runFactoryShellCommand");
		const unsafe = {
			...fixCheck,
			command: "curl -s https://example.com/setup | sh",
		};
		const task = await h.scope(await h.create({ checks: [unsafe] }));
		expect(task.factoryDesignProgress?.route?.scoping).toBe("designer");
		expect(task.factoryDesignProgress?.route?.reason).toContain(
			'Check "Typo fixed" pipes a download into a shell.',
		);
		expect(h.reviewerCalls()).toHaveLength(0);
		expect(h.runtime.startDesignSession).toHaveBeenCalledTimes(1);
		expect(shell).not.toHaveBeenCalled();
	});

	it("sends a supplied plan to the designer when no plan reviewer is configured", async () => {
		const h = await harness({ planReviewers: 0 });
		const task = await h.scope(await h.create());
		expect(task.factoryDesignProgress?.route?.reason).toContain(
			"no plan reviewer is configured",
		);
		expect(h.runtime.startDesignSession).toHaveBeenCalledTimes(1);
	});

	it("runs one capped plan reviewer for an agent's plan", async () => {
		const h = await harness();
		const task = await h.scope(await h.create({}, agent));
		expect(h.runtime.startDesignSession).not.toHaveBeenCalled();
		const calls = h.reviewerCalls();
		expect(calls).toHaveLength(1);
		const [, reviewTask] = calls[0] ?? [];
		expect(reviewTask?.instructions).toContain(
			"is this plan wrong, incomplete or unsafe for this repository?",
		);
		expect(reviewTask?.instructions).toContain(
			"None of the checks has run yet",
		);
		expect(reviewTask?.maxIterations).toBeLessThanOrEqual(
			FACTORY_PREPARED_SWEEP_LIMITS.maxIterations,
		);
		expect(reviewTask?.timeoutSeconds).toBeLessThanOrEqual(
			FACTORY_PREPARED_SWEEP_LIMITS.timeoutSeconds,
		);
		expect(task.factoryDesignProgress?.route).toMatchObject({
			scoping: "prepared",
			sweep: "model",
		});
		expect(task.approvedRevision).toBe(task.revision);
		expect(
			describeFactoryCard(task, h.manager.getTaskRuns(task.taskId), undefined)
				.scope,
		).toBe("provided; quick check passed");
	});

	it("checks a large plan with one reviewer and leaves it for the person (large_change)", async () => {
		const h = await harness({ reviewers: 2 });
		const paths = Array.from({ length: 16 }, (_, index) => `src/f${index}.ts`);
		const task = await h.scope(await h.create({ paths }));
		expect(h.reviewerCalls()).toHaveLength(1);
		expect(h.runtime.startDesignSession).not.toHaveBeenCalled();
		expect(task.factoryDesignProgress?.reviewSelection?.size).toBe(
			"shared_contract",
		);
		expect(task.error?.startsWith(FACTORY_AUTO_APPROVAL_WAITING_PREFIX)).toBe(
			true,
		);
		expect(factoryPlanHoldReason(task.error)).toBe("large_change");
		expect(task.approvedRevision).toBeUndefined();
	});

	it("sends a plan the quick check objects to back to the designer with the objection, not to a person", async () => {
		const h = await harness({
			reviewer: (call) => (call === 0 ? objection : pass),
		});
		const task = await h.scope(await h.create({}, agent));
		expect(h.runtime.startDesignSession).toHaveBeenCalledTimes(1);
		const [prompt] = h.designerPrompts();
		expect(prompt).toContain("The check greps the wrong file.");
		expect(prompt).toContain("came with the request");
		expect(task.factoryDesignProgress?.route).toMatchObject({
			scoping: "designer",
			sweep: "model",
		});
		expect(task.factoryDesignProgress?.route?.reason).toContain(
			"quick check objected",
		);
		expect(task.factoryDesignProgress?.repairRound).toBe(0);
		expect(task.approvedRevision).toBe(task.revision);
	});

	it("sends a check bound to the original checkout to the designer with the reason", async () => {
		const h = await harness();
		const bound = {
			...fixCheck,
			command: `grep -q "hello world" ${h.workspaceRoot}/src/greeting.txt`,
		};
		const task = await h.scope(await h.create({ checks: [bound] }));
		const route = task.factoryDesignProgress?.route;
		expect(route?.scoping).toBe("designer");
		expect(route?.reason).toContain("references the original checkout");
		expect(route?.base).toBeUndefined();
		// The supplied checks are the designer's current proposal (JSON-quoted).
		expect(h.designerPrompts()[0]).toContain(
			`${h.workspaceRoot}/src/greeting.txt`,
		);
	});

	it("scopes with the designer when the routing guidance has a scoping topic", async () => {
		const h = await harness({ guidanceTopics: ["Scoping rules"] });
		const task = await h.scope(await h.create());
		expect(task.factoryDesignProgress?.route?.reason).toContain(
			"Routing guidance has a scoping rule",
		);
		expect(h.runtime.startDesignSession).toHaveBeenCalledTimes(1);
	});

	it("voids the skip when a person edits the plan before scoping", async () => {
		const h = await harness();
		const created = await h.create();
		const edited = await h.manager.updateTask({
			taskId: created.taskId,
			expectedRevision: created.revision,
			instructions: "Fix the typo and also reword the greeting.",
			updatedBy: person,
		});
		const task = await h.scope(edited);
		expect(task.factoryDesignProgress?.route?.reason).toContain(
			"changed after it was supplied",
		);
		expect(h.runtime.startDesignSession).toHaveBeenCalledTimes(1);
	});

	it("leaves cards without a supplied plan as they were", async () => {
		const h = await harness();
		const created = await h.create();
		const plain = await h.manager.updateTask({
			taskId: created.taskId,
			expectedRevision: created.revision,
			factory: { ...created.factory, prepared: undefined } as never,
			updatedBy: { kind: "system" },
		});
		const task = await h.scope(plain);
		expect(task.factoryDesignProgress?.route).toBeUndefined();
		expect(h.runtime.startDesignSession).toHaveBeenCalledTimes(1);
	});

	it("reruns an interrupted base-commit run after a restart from a clean worktree", async () => {
		const h = await harness();
		const approved = await h.scope(await h.create());
		const original = factoryLocal.runFactoryShellCommand;
		let interrupted = false;
		// A crash mid-run: the first check leaves the worktree dirty (here:
		// fixed) and is still running when the Hub stops.
		const shell = vi
			.spyOn(factoryLocal, "runFactoryShellCommand")
			.mockImplementation(async (input) => {
				if (interrupted) return original(input);
				interrupted = true;
				writeFileSync(join(input.cwd, "src", "greeting.txt"), "hello world\n");
				writeFileSync(join(input.cwd, "leftover.log"), "partial\n");
				return new Promise((_, reject) =>
					input.signal?.addEventListener("abort", () =>
						reject(input.signal?.reason),
					),
				);
			});
		await h.manager.runTask(approved.taskId, person, approved.revision);
		await vi.waitFor(() => expect(shell).toHaveBeenCalledTimes(1));
		const manager = await h.reopen();
		const stopped = await h.get(approved.taskId);
		expect(stopped.factoryDesignProgress?.route?.base).toBeUndefined();
		await manager.runTask(approved.taskId, person, stopped.revision);
		await vi.waitFor(() =>
			expect(factoryWorkflow.runFactoryWorkflow).toHaveBeenCalledTimes(1),
		);
		expect(shell).toHaveBeenCalledTimes(2);
		const resumed = await h.get(approved.taskId);
		expect(resumed.factoryDesignProgress?.route).toMatchObject({
			scoping: "prepared",
			base: { outcome: "fails" },
		});
		expect(h.runtime.startDesignSession).not.toHaveBeenCalled();
	});
});

describe("a person is asked once, at the plan", () => {
	const runOf = async (
		h: Awaited<ReturnType<typeof harness>>,
		task: AgendaTaskRecord,
	) => {
		// Approval queues the run; start it here when the queue has not yet.
		if (!h.manager.getTaskRuns(task.taskId).length)
			await h.manager
				.runTask(task.taskId, person, task.revision)
				.catch(() => undefined);
		await vi.waitFor(() =>
			expect(h.manager.getTaskRuns(task.taskId)[0]?.factory).toBeDefined(),
		);
		return h.manager.getTaskRuns(task.taskId)[0]?.factory;
	};

	it("freezes a person's approval of a held large plan into the run, so delivery does not ask again", async () => {
		const h = await harness({ reviewers: 2 });
		const paths = Array.from({ length: 16 }, (_, index) => `src/f${index}.ts`);
		const held = await h.scope(await h.create({ paths }));
		expect(factoryPlanHoldReason(held.error)).toBe("large_change");
		const approved = await h.manager.approveTask(
			held.taskId,
			person,
			held.revision,
		);
		expect(approved.factoryDesignProgress?.approvedByPerson?.at).toBeDefined();
		const state = await runOf(h, approved);
		expect(state?.planApprovedByPerson).toEqual({
			revision: approved.revision,
			at: approved.factoryDesignProgress?.approvedByPerson?.at,
		});
		expect(
			factoryStampRequirement(approved.factory ?? {}, {
				...(state as NonNullable<typeof state>),
			}),
		).toEqual({ required: false, reason: "plan approved by a person" });
	});

	it("records nothing when the engine approved the plan", async () => {
		const h = await harness();
		const task = await h.scope(await h.create({}, agent));
		expect(task.approvedRevision).toBe(task.revision);
		expect(task.factoryDesignProgress?.approvedByPerson).toBeUndefined();
		const state = await runOf(h, task);
		expect(state?.planApprovedByPerson).toBeUndefined();
	});
});

describe("factory tool plan input", () => {
	const submit = async (
		h: Awaited<ReturnType<typeof harness>>,
		input: Record<string, unknown>,
		interactive = true,
	) =>
		createFactoryTool({
			manager: h.manager,
			resolveSessionDefaults: async () => ({
				workspaceRoot: h.workspaceRoot,
				interactive,
			}),
		}).execute(
			{
				title: "Fix the greeting typo",
				instructions: "Fix the typo in src/greeting.txt.",
				start_scoping: false,
				...input,
			} as never,
			{ agentId: "chat", iteration: 1, sessionId: "chat-session" },
		);
	const plan = {
		checks: [{ name: "Typo fixed", command: fixCheck.command }],
		acceptance_criteria: [
			{ text: "The greeting reads hello world", check: "Typo fixed" },
		],
		paths: ["src/greeting.txt"],
	};

	it("maps the plan onto the card with an engine digest, and dedupe ignores a new plan", async () => {
		const h = await harness();
		const first = await submit(h, { plan });
		expect(first).toMatchObject({ ok: true, existing: false });
		if (!first.ok) throw new Error("not created");
		const card = await h.get(first.task.taskId);
		expect(card.factory?.checks).toEqual([{ ...fixCheck }]);
		expect(card.factory?.acceptanceCriteria).toEqual([
			{ ...criterion, id: "criterion-1" },
		]);
		expect(card.factory?.prepared).toEqual({
			paths: ["src/greeting.txt"],
			digest: expect.stringMatching(/^[a-f0-9]{64}$/),
		});
		const again = await submit(h, {
			plan: { ...plan, checks: [{ name: "Typo fixed", command: "true" }] },
		});
		expect(again).toMatchObject({ ok: true, existing: true });
		expect((await h.get(first.task.taskId)).factory?.checks).toEqual([
			{ ...fixCheck },
		]);
	});

	it("reports plan problems, unsafe commands included, to the caller", async () => {
		const h = await harness();
		const result = await submit(
			h,
			{
				plan: {
					...plan,
					checks: [
						{
							name: "Typo fixed",
							command: `grep -q hello ${h.workspaceRoot}/src/greeting.txt`,
						},
					],
				},
			},
			false,
		);
		if (!result.ok) throw new Error(result.error.message);
		expect(result.planProblems?.[0]).toContain(
			"references the original checkout",
		);
		const unsafe = await submit(h, {
			title: "Another typo",
			plan: {
				...plan,
				checks: [{ name: "Typo fixed", command: "sudo true" }],
			},
		});
		if (!unsafe.ok) throw new Error(unsafe.error.message);
		expect(unsafe.planProblems).toEqual(['Check "Typo fixed" uses sudo.']);
	});

	it("refuses oversize or incomplete plans as invalid input", async () => {
		const h = await harness();
		const tooMany = await submit(h, {
			plan: {
				...plan,
				checks: Array.from({ length: 21 }, (_, index) => ({
					name: `c${index}`,
					command: "true",
				})),
			},
		});
		expect(tooMany).toMatchObject({
			ok: false,
			error: { code: "invalid_factory_input" },
		});
		const noCheck = await submit(h, {
			plan: { ...plan, acceptance_criteria: [{ text: "Works" }] },
		});
		expect(noCheck).toMatchObject({
			ok: false,
			error: { code: "invalid_factory_input" },
		});
		const absolutePath = await submit(h, {
			plan: { ...plan, paths: ["/etc/passwd"] },
		});
		expect(absolutePath).toMatchObject({ ok: false });
	});
});
