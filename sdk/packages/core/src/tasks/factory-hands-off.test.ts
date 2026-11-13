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
import type {
	AgendaTaskRecord,
	FactoryAttempt,
	FactoryRunState,
	FactoryVerificationProfile,
} from "@cline/shared";
import {
	FACTORY_AUTO_APPROVAL_WAITING_PREFIX,
	FACTORY_PLAN_FAULT_PREFIX,
	FACTORY_VERIFICATION_EXERCISE_HEADING,
	FACTORY_VERIFICATION_PROFILE_PATH,
	factoryTaskConfigSchema,
} from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	AgendaTaskManager,
	type AgendaTaskRuntime,
	type AgendaTaskRuntimeResult,
} from "./agenda-task-manager";
import {
	FactoryPlanConfigurationError,
	FactoryVerificationProfileError,
} from "./factory-errors";
import * as factoryLocal from "./factory-local";
import { FACTORY_REPO_RULES_SOURCE } from "./factory-repo-rules";
import { createFactoryStatusTool } from "./factory-tool";
import {
	FileFactoryVerificationProfileStore,
	factoryVerificationProfileHash,
} from "./factory-verification-profile";
import * as factoryWorkflow from "./factory-workflow";
import { SqliteAgendaTaskStore } from "./store/sqlite-task-store";

const disposals: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const dispose of disposals.splice(0)) await dispose();
	vi.restoreAllMocks();
});

const profile: FactoryVerificationProfile = {
	schemaVersion: 1,
	environment: {
		setup: "bun install",
		start: "bun run dev",
		healthcheck: 'curl -sf "http://localhost:$PORT/health"',
	},
	exercise: "Open the home page and click Save.",
	artifacts: [".evidence/home.png"],
};
const check = { name: "Behavior", kind: "test", command: "true" } as const;
const independentModel = { providerId: "other", modelId: "reviewer" };
/** Proven by the verifier, so it needs one: a profile supplies it. */
const verifierCriterion = {
	id: "saves",
	text: "Clicking Save stores the form",
	required: true,
};
const checkCriterion = {
	id: "behavior",
	text: "The behavior check passes",
	required: true,
	check: "Behavior",
};
const pass = JSON.stringify({
	verdict: "pass",
	findings: [],
	summary: "Independent review passed",
});

type Designer = (
	instructions: string,
	call: number,
) => Record<string, unknown> | undefined;

function design(extra: Record<string, unknown> = {}) {
	return {
		instructions: "Proposed brief",
		checks: [check],
		acceptanceCriteria: [checkCriterion],
		...extra,
	};
}

async function harness(
	options: {
		approval?: "required" | "automatic";
		reviewMode?: "fixed" | "adaptive";
		planReviewers?: number;
		reviewers?: number;
		designer?: Designer;
		repoProfile?: FactoryVerificationProfile;
		approvedProfile?: FactoryVerificationProfile;
		/** Rule cards are off unless a card's workflow turns them on. */
		repoRules?: boolean;
		logs?: Array<[string, unknown]>;
	} = {},
) {
	const root = realpathSync(
		mkdtempSync(join(tmpdir(), "cline-factory-hands-off-")),
	);
	const workspaceRoot = join(root, "repo");
	mkdirSync(workspaceRoot);
	// The backlog sweep only adopts cards in a git repository.
	execFileSync("git", ["init", "-q", workspaceRoot]);
	if (options.repoProfile) {
		mkdirSync(join(workspaceRoot, ".cline", "factory"), { recursive: true });
		writeFileSync(
			join(workspaceRoot, FACTORY_VERIFICATION_PROFILE_PATH),
			JSON.stringify(options.repoProfile),
		);
	}
	const profiles = new FileFactoryVerificationProfileStore();
	if (options.approvedProfile)
		await profiles.approve(workspaceRoot, options.approvedProfile);
	let designerCall = 0;
	const runtime: AgendaTaskRuntime &
		Required<
			Pick<
				AgendaTaskRuntime,
				"startDesignSession" | "startDesignReviewSession" | "runDesignSession"
			>
		> = {
		startSession: vi.fn(async () => ({ sessionId: "unused" })),
		runSession: vi.fn<AgendaTaskRuntime["runSession"]>(async () => ({
			status: "completed",
		})),
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
			async (sessionId, task): Promise<AgendaTaskRuntimeResult> => {
				if (sessionId.startsWith("factory_plan_review_"))
					return { status: "completed", summary: pass };
				const answer = options.designer?.(task.instructions, designerCall++);
				return {
					status: "completed",
					summary: JSON.stringify(answer ?? design()),
				};
			},
		),
	};
	const manager = new AgendaTaskManager({
		runtime,
		dbPath: join(root, "tasks.db"),
		globalSpecsDir: join(root, "specs"),
		watchFiles: false,
		automationEnabled: false,
		factoryStorageDir: join(root, "factory"),
		factoryVerificationProfiles: profiles,
		...(options.logs
			? {
					logger: {
						debug: () => {},
						log: (m: string, d?: unknown) => {
							options.logs?.push([m, d]);
						},
					},
				}
			: {}),
	});
	disposals.push(async () => {
		await manager.dispose();
		rmSync(root, { recursive: true, force: true });
	});
	const create = (
		title = "Save the form",
		factory: Record<string, unknown> = {},
		createdBy: AgendaTaskRecord["createdBy"] = { kind: "user" },
		/** Unheld and queued for scoping instead of held (pumped once started). */
		queued = false,
	) =>
		manager.createTask({
			title,
			type: "follow-up",
			instructions: `Brief for ${title}`,
			scope: "workspace",
			workspaceRoot,
			expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
			createdBy,
			queueFactoryDesign: queued,
			factory: factoryTaskConfigSchema.parse({
				autonomy: "hands_off",
				approval: options.approval ?? "required",
				reviewMode: options.reviewMode ?? "fixed",
				...(options.repoRules ? { repoRules: true } : {}),
				checks: [check],
				acceptanceCriteria: [checkCriterion],
				agents: {
					planReviewers: Array.from(
						{ length: options.planReviewers ?? 1 },
						() => ({}),
					),
					// On another model than the builder: automatic approval needs
					// an independent reviewer.
					reviewers: Array.from({ length: options.reviewers ?? 1 }, () => ({
						modelSelection: independentModel,
					})),
				},
				...factory,
			}),
		});
	const get = async (taskId: string) => {
		const value = await manager.getTask(taskId);
		if (!value) throw new Error("Task disappeared");
		return value;
	};
	const designerPrompts = () =>
		vi
			.mocked(runtime.runDesignSession)
			.mock.calls.filter(([id]) => !id.startsWith("factory_plan_review_"))
			.map(([, task]) => task.instructions);
	const reviewerPrompts = () =>
		vi
			.mocked(runtime.runDesignSession)
			.mock.calls.filter(([id]) => id.startsWith("factory_plan_review_"))
			.map(([, task]) => task.instructions);
	/** Designs the card and waits for the plan to settle (or wait). */
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
	/** Writes card state directly, as an earlier build or run left it. */
	const patch = (
		taskId: string,
		state: Parameters<SqliteAgendaTaskStore["updateTaskState"]>[1],
	) => {
		const store = new SqliteAgendaTaskStore({
			dbPath: join(root, "tasks.db"),
		});
		try {
			store.dequeueFactory(taskId);
			return store.updateTaskState(taskId, state);
		} finally {
			store.close();
		}
	};
	return {
		manager,
		runtime,
		profiles,
		workspaceRoot,
		patch,
		create,
		get,
		designed,
		designerPrompts,
		reviewerPrompts,
	};
}

type Harness = Awaited<ReturnType<typeof harness>>;

/** Replaces the worktree and the workflow, so a run takes no git or model. */
function stubRuns(
	behave: (
		input: Parameters<typeof factoryWorkflow.runFactoryWorkflow>[0],
	) => Promise<AgendaTaskRuntimeResult>,
) {
	vi.spyOn(factoryLocal, "prepareFactoryWorkspace").mockImplementation(
		async (input) => ({
			path: join(input.storageDir, input.taskId),
			branch: `factory/${input.taskId}`,
			baseBranch: "main",
			baseCommit: "base",
		}),
	);
	return vi
		.spyOn(factoryWorkflow, "runFactoryWorkflow")
		.mockImplementation(behave);
}

async function runToEnd(h: Harness, task: AgendaTaskRecord) {
	const approved =
		task.status === "approved"
			? task
			: await h.manager.approveTask(
					task.taskId,
					{ kind: "user" },
					task.revision,
				);
	const { run } = await h.manager.runTask(
		approved.taskId,
		{ kind: "user" },
		approved.revision,
	);
	await vi.waitFor(() => {
		const latest = h.manager
			.getTaskRuns(task.taskId)
			.find((candidate) => candidate.runId === run?.runId);
		expect(["completed", "failed"]).toContain(latest?.status);
	});
	return h.manager
		.getTaskRuns(task.taskId)
		.find((candidate) => candidate.runId === run?.runId);
}

describe("verification profile in design", () => {
	it("freezes a trusted repository profile and materialises the verifier only in the plan's agents", async () => {
		const h = await harness({
			repoProfile: profile,
			approvedProfile: profile,
			designer: () => design({ acceptanceCriteria: [verifierCriterion] }),
		});
		const task = await h.designed(await h.create());
		expect(task.error).toBeUndefined();
		expect(task.factory?.verificationProfile).toEqual({
			profile,
			hash: factoryVerificationProfileHash(profile),
			origin: "repository",
		});
		const verifier = task.factoryDesignProgress?.agents.verifier;
		expect(verifier?.environment).toEqual(profile.environment);
		expect(verifier?.artifacts).toEqual(profile.artifacts);
		expect(verifier?.instructions).toContain(
			FACTORY_VERIFICATION_EXERCISE_HEADING,
		);
		// The card config feeds the workflow revision, so it never carries it.
		expect(task.factory?.agents?.verifier).toBeUndefined();
		const [prompt] = h.designerPrompts();
		expect(prompt).toContain("Status: trusted");
		expect(prompt).toContain("Omit it to keep the current profile unchanged");
		// A trusted, unchanged profile needs no extra gate.
		expect(h.reviewerPrompts().join("\n")).not.toContain(
			"VERIFICATION PROFILE IN THIS PLAN",
		);
		// The verifier-proven criterion is approvable.
		const approved = await h.manager.approveTask(
			task.taskId,
			{ kind: "user" },
			task.revision,
		);
		expect(approved.status).toBe("approved");
	});

	it("truncates an exercise that would overflow the verifier instructions instead of failing", async () => {
		const long = { ...profile, exercise: "e".repeat(10_000) };
		const h = await harness({ approvedProfile: long });
		const task = await h.designed(
			await h.create("Long", {
				agents: {
					planReviewers: [{}],
					verifier: { instructions: "v".repeat(15_000) },
				},
			}),
		);
		expect(task.error).toBeUndefined();
		const instructions =
			task.factoryDesignProgress?.agents.verifier?.instructions ?? "";
		expect(instructions.length).toBeLessThanOrEqual(20_000);
		expect(instructions.startsWith("v".repeat(15_000))).toBe(true);
		expect(instructions).toContain("[Exercise truncated to fit");
	});

	it("uses the approved copy when the repository has no file, and passes the materialised verifier and proof hooks to the run", async () => {
		const h = await harness({ approvedProfile: profile });
		const hash = factoryVerificationProfileHash(profile);
		let input: Parameters<typeof factoryWorkflow.runFactoryWorkflow>[0] =
			undefined as never;
		stubRuns(async (received) => {
			input = received;
			await received.onVerificationProfileProven?.(hash);
			return { status: "completed", summary: "done" };
		});
		const task = await h.designed(await h.create());
		expect(task.factory?.verificationProfile?.origin).toBe("approved_local");
		const run = await runToEnd(h, task);
		expect(run?.status).toBe("completed");
		expect(input.verificationProfileProven).toBe(false);
		expect(input.state.agents?.verifier?.environment).toEqual(
			profile.environment,
		);
		expect(input.state.inputSnapshot?.factory.agents?.verifier).toBeDefined();
		expect((await h.profiles.get(h.workspaceRoot))?.provenAt).toBeDefined();
	});

	it("shows an unapproved repository file as a proposal and never adopts it on its own", async () => {
		const h = await harness({ repoProfile: profile });
		const task = await h.designed(await h.create());
		expect(task.factory?.verificationProfile).toBeUndefined();
		expect(task.factoryDesignProgress?.agents.verifier).toBeUndefined();
		const [prompt] = h.designerPrompts();
		expect(prompt).toContain("Status: not trusted");
		expect(prompt).toContain("Proposed profile from the repository file");
	});

	it("repairs deterministic profile findings, gates the proposal with a plan reviewer, and keeps it proposed after approval", async () => {
		const h = await harness({
			approval: "automatic",
			designer: (_instructions, call) =>
				design({
					verificationProfile:
						call === 0 ? { ...profile, artifacts: ["/tmp/home.png"] } : profile,
				}),
		});
		stubRuns(async () => ({ status: "completed" }));
		const task = await h.create();
		await h.manager.startFactoryDesign(task.taskId);
		await vi.waitFor(async () =>
			expect((await h.get(task.taskId)).status).not.toBe("pending_approval"),
		);
		const designed = await h.get(task.taskId);
		const prompts = h.designerPrompts();
		expect(prompts).toHaveLength(2);
		expect(prompts[1]).toContain(
			'Artifact path "/tmp/home.png" is an absolute path outside the task worktree',
		);
		expect(prompts[1]).toContain(
			"The current plan proposes this verification profile",
		);
		// Only the repaired plan reached the plan reviewer, with the profile block.
		expect(h.reviewerPrompts()).toHaveLength(1);
		expect(h.reviewerPrompts()[0]).toContain(
			"VERIFICATION PROFILE IN THIS PLAN",
		);
		expect(designed.approvedRevision).toBe(designed.revision);
		expect(designed.factory?.verificationProfile).toMatchObject({
			hash: factoryVerificationProfileHash(profile),
			origin: "proposed",
		});
		// Automatic approval runs the profile for this card but never trusts
		// it for the workspace: only a person's action does.
		expect(await h.profiles.get(h.workspaceRoot)).toBeUndefined();
		await vi.waitFor(async () =>
			expect((await h.get(task.taskId)).status).toBe("completed"),
		);
		await h.manager.recordFactoryAudit(task.taskId, "");
		expect(await h.profiles.get(h.workspaceRoot)).toMatchObject({
			hash: factoryVerificationProfileHash(profile),
		});
	});

	it("records a proposed profile as trusted when a person approves the plan", async () => {
		const h = await harness({
			designer: () => design({ verificationProfile: profile }),
		});
		const task = await h.designed(await h.create());
		expect(task.factory?.verificationProfile?.origin).toBe("proposed");
		expect(await h.profiles.get(h.workspaceRoot)).toBeUndefined();
		await h.manager.approveTask(task.taskId, { kind: "user" }, task.revision);
		expect(await h.profiles.get(h.workspaceRoot)).toMatchObject({
			hash: factoryVerificationProfileHash(profile),
		});
	});

	it("waits instead of approving automatically when no plan reviewer checked a proposed profile", async () => {
		const h = await harness({
			approval: "automatic",
			planReviewers: 0,
			designer: () => design({ verificationProfile: profile }),
		});
		const task = await h.designed(await h.create());
		expect(task.status).toBe("pending_approval");
		expect(task.error).toMatch(
			new RegExp(`^${FACTORY_AUTO_APPROVAL_WAITING_PREFIX}`),
		);
		expect(task.error).toContain("verification setup");
		expect(await h.profiles.get(h.workspaceRoot)).toBeUndefined();
		const approved = await h.manager.approveTask(
			task.taskId,
			{ kind: "user" },
			task.revision,
		);
		expect(approved.factory?.verificationProfile?.origin).toBe("proposed");
		expect((await h.profiles.get(h.workspaceRoot))?.hash).toBe(
			factoryVerificationProfileHash(profile),
		);
	});

	it("raises a local adaptive selection to shared contract when the plan changes the profile", async () => {
		const h = await harness({
			reviewMode: "adaptive",
			reviewers: 2,
			designer: () =>
				design({
					verificationProfile: profile,
					reviewSelection: {
						impact: "local",
						rationale: "Small change",
						affectedPaths: ["src/form.ts"],
						consumers: ["form"],
						planReviewerIndices: [],
						reviewerIndices: [0],
					},
				}),
		});
		const task = await h.designed(await h.create());
		expect(task.factoryDesignProgress?.reviewSelection).toMatchObject({
			impact: "shared_contract",
			planReviewerIndices: [0],
			reviewerIndices: [0, 1],
		});
		expect(h.reviewerPrompts()).toHaveLength(1);
	});
});

describe("broken verification profile", () => {
	it("reopens design once with the preflight failure, then waits for a person", async () => {
		const h = await harness({
			approval: "automatic",
			designer: () => design({ verificationProfile: profile }),
		});
		const hash = factoryVerificationProfileHash(profile);
		const runs = stubRuns(async (input) => {
			input.save({
				...input.state,
				verificationProfile: {
					hash,
					preflight: "failed",
					stage: "start",
					detail: "port 3000 already in use",
				},
			});
			throw new FactoryVerificationProfileError(
				"start",
				"port 3000 already in use",
			);
		});
		await h.manager.start();
		const task = await h.create();
		await h.manager.queueFactoryScoping(task.taskId);
		await vi.waitFor(
			async () => {
				const current = await h.get(task.taskId);
				expect(runs).toHaveBeenCalledTimes(2);
				expect(current.status).toBe("failed");
			},
			{ timeout: 10_000 },
		);
		const current = await h.get(task.taskId);
		expect(current.error).toContain("already reopened design once");
		const prompts = h.designerPrompts();
		expect(prompts).toHaveLength(2);
		expect(prompts[1]).toContain(
			"Factory preflight of the plan's verification profile failed at the start stage",
		);
		expect(prompts[1]).toContain(
			"The last preflight failed at the start stage",
		);
		const failed = h.manager.getTaskRuns(task.taskId);
		expect(failed.map((run) => run.status)).toEqual(["failed", "failed"]);
		// Neither failure was the hands-off blind retry.
		expect(failed.every((run) => !run.factory?.autoRecovery)).toBe(true);
	});
});

/** A check whose artifact can never be evidence: a plan fault. */
const faultyCheck = {
	...check,
	artifacts: ["/tmp/behavior.log"],
} as const;
const faultyFinding = 'Check "Behavior" artifact "/tmp/behavior.log"';

describe("plan faults", () => {
	it("reopens scoping once for a run-start check finding without spending a build, then stops with the reason", async () => {
		const logs: Array<[string, unknown]> = [];
		const h = await harness({ approval: "automatic", logs });
		const runs = stubRuns(async () => {
			throw new FactoryPlanConfigurationError([
				`${faultyFinding} is an absolute path outside the task worktree.`,
			]);
		});
		await h.manager.start();
		const task = await h.create();
		await h.manager.queueFactoryScoping(task.taskId);
		await vi.waitFor(
			async () => {
				expect(runs).toHaveBeenCalledTimes(2);
				expect((await h.get(task.taskId)).status).toBe("failed");
			},
			{ timeout: 10_000 },
		);
		const current = await h.get(task.taskId);
		expect(current.error?.split("\n")[0]).toBe(
			"The plan's checks still need fixing: Factory already sent the plan back to scoping once for these checks, so it waits for you: edit the plan's checks, then approve it again.",
		);
		const prompts = h.designerPrompts();
		expect(prompts).toHaveLength(2);
		expect(prompts[1]).toContain("no builder round was spent");
		expect(prompts[1]).toContain(faultyFinding);
		// No builder session and no blind hands-off retry.
		expect(h.runtime.runSession).not.toHaveBeenCalled();
		const failed = h.manager.getTaskRuns(task.taskId);
		expect(failed.every((run) => !run.factory?.autoRecovery)).toBe(true);
		expect(
			logs.filter(([m]) => m === "factory plan fault sent back to scoping"),
		).toHaveLength(1);
	});

	it("records a manual card's run-start plan fault for Try again instead of reopening by itself", async () => {
		const h = await harness({ planReviewers: 0 });
		stubRuns(async () => {
			throw new FactoryPlanConfigurationError([`${faultyFinding} escapes.`]);
		});
		const task = await h.create("Manual", { autonomy: undefined });
		const run = await runToEnd(h, task);
		expect(run?.status).toBe("failed");
		const current = await h.get(task.taskId);
		expect(current.status).toBe("failed");
		expect(current.error).toBe(
			`${FACTORY_PLAN_FAULT_PREFIX}${faultyFinding} escapes.`,
		);
		expect(h.designerPrompts()).toEqual([]);
		// Try again sends the plan back with the recorded findings.
		const retried = await h.manager.approveTask(
			task.taskId,
			{ kind: "user" },
			current.revision,
		);
		expect(retried.status).toBe("pending_approval");
		expect(retried.factoryDesignProgress?.findings[0]).toContain(
			`${faultyFinding} escapes.`,
		);
	});

	it.each([
		["startFactoryQueue", "queue"],
		["approveTask", "approve"],
		["factory_status retry", "tool"],
	] as const)("sends a stopped plan-fault card back to scoping through %s", async (_label, path) => {
		const h = await harness();
		// Not held: a card that ran is no longer held.
		const created = await h.create(
			"Faulty",
			{ autonomy: undefined, checks: [faultyCheck] },
			{ kind: "user" },
			true,
		);
		const task = h.patch(created.taskId, {
			status: "failed",
			approvedRevision: created.revision,
			error: "Repair limit (2) reached.",
		});
		if (!task) throw new Error("Missing task");
		if (path === "queue")
			await h.manager.startFactoryQueue(
				[{ taskId: task.taskId, expectedRevision: task.revision }],
				{ kind: "user" },
			);
		else if (path === "approve")
			await h.manager.approveTask(task.taskId, { kind: "user" }, task.revision);
		else {
			const result = await createFactoryStatusTool({
				manager: h.manager,
				resolveSessionDefaults: async () => ({
					workspaceRoot: h.workspaceRoot,
				}),
			}).execute({ task_id: task.taskId, action: "retry" } as never, {
				agentId: "chat-agent",
				iteration: 1,
				sessionId: "chat-1",
			});
			expect(JSON.stringify(result)).toContain(
				"The plan's checks need fixing, so it went back to scoping.",
			);
		}
		const current = await h.get(task.taskId);
		expect(current).toMatchObject({
			status: "pending_approval",
			factoryQueued: "design",
			factoryDesignProgress: {
				phase: "designing",
				revision: task.revision,
			},
		});
		expect(current.approvedRevision).toBeUndefined();
		expect(current.factoryDesignProgress?.findings[0]).toContain(faultyFinding);
		expect(h.manager.getTaskRuns(task.taskId)).toEqual([]);
	});
});

describe("scoping after an edit", () => {
	const submit = (h: Harness, factory: Record<string, unknown> = {}) =>
		h.manager.createTask({
			title: "Edited",
			type: "follow-up",
			instructions: "Brief for Edited",
			scope: "workspace",
			workspaceRoot: h.workspaceRoot,
			expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
			createdBy: { kind: "user" },
			factory: factoryTaskConfigSchema.parse({
				autonomy: "hands_off",
				checks: [check],
				acceptanceCriteria: [checkCriterion],
				...factory,
			}),
		});
	/** A card that ran once and whose queue entry is gone, as an older build left it. */
	const ran = (h: Harness, task: AgendaTaskRecord) => {
		const updated = h.patch(task.taskId, { lastRunId: "run_old" });
		if (!updated) throw new Error("Missing task");
		return updated;
	};

	it.each([
		{
			label: "re-queues scoping for a hands-off card",
			factory: {},
			queued: "design",
		},
		{
			label: "leaves a manual card for Start scoping",
			factory: { autonomy: undefined },
			queued: undefined,
		},
	])("$label a person edited after it ran", async ({ factory, queued }) => {
		const h = await harness();
		const task = ran(h, await submit(h, factory));
		expect(task.factoryQueued).toBeUndefined();
		const edited = await h.manager.updateTask({
			taskId: task.taskId,
			expectedRevision: task.revision,
			instructions: "Edited brief",
			updatedBy: { kind: "user" },
		});
		expect(edited.status).toBe("pending_approval");
		expect(edited.factoryQueued).toBe(queued);
	});

	it("sweeps an orphaned hands-off card that ran before, but not cards waiting on a person", async () => {
		const logs: Array<[string, unknown]> = [];
		const h = await harness({ logs });
		const orphan = ran(h, await submit(h));
		const failedScoping = ran(h, await submit(h));
		h.patch(failedScoping.taskId, {
			error: "Design did not complete: the designer gave up",
		});
		const asking = ran(h, await submit(h));
		h.patch(asking.taskId, {
			factoryQuestions: [
				{
					questionId: "q1",
					revision: asking.revision,
					sessionId: "factory_design_old",
					question: "Which page?",
					createdAt: "2026-11-10T00:00:00Z",
					status: "pending",
				},
			],
		});
		const manual = ran(h, await submit(h, { autonomy: undefined }));
		await h.manager.start();
		await vi.waitFor(() =>
			expect(logs).toContainEqual([
				"factory backlog card queued for scoping",
				{
					taskId: orphan.taskId,
					reason: "plan discarded after an earlier run",
				},
			]),
		);
		for (const waiting of [failedScoping, asking, manual]) {
			const current = await h.get(waiting.taskId);
			expect(current.factoryQueued).toBeUndefined();
			expect(current.factoryDesignProgress).toBeUndefined();
		}
	});
});

const nomination = (key: string) => ({
	key,
	kind: "lint" as const,
	pattern: `Pattern ${key}`,
	suggestion: `Add a rule for ${key}`,
});

/** A completed run whose final reviewer nominated these rule keys. */
function completedWith(
	keys: string[],
	reviewSelection?: FactoryRunState["reviewSelection"],
) {
	return async (
		input: Parameters<typeof factoryWorkflow.runFactoryWorkflow>[0],
	) => {
		input.save({
			...input.state,
			...(reviewSelection ? { reviewSelection } : {}),
			candidate: {
				commit: "candidate",
				checks: [],
				reviews: [
					{
						reviewerIndex: 0,
						sessionId: "review",
						review: {
							verdict: "pass",
							summary: "Looks good",
							findings: [],
							...(keys.length ? { ruleCandidates: keys.map(nomination) } : {}),
						},
					},
				],
			},
		});
		return { status: "completed" as const, summary: "done" };
	};
}

const local = {
	impact: "local" as const,
	rationale: "One file",
	affectedPaths: ["src/form.ts"],
	consumers: ["form"],
	planReviewerIndices: [],
	reviewerIndices: [0],
};

describe("run completion", () => {
	it("persists whether a stamp is required and samples only results that need none", async () => {
		const h = await harness({ planReviewers: 0 });
		let selection: FactoryRunState["reviewSelection"] = local;
		stubRuns(async (input) => completedWith([], selection)(input));
		const localRun = await runToEnd(h, await h.create("Local"));
		expect(localRun?.factory?.humanReview).toEqual({
			required: false,
			reason: "local change",
		});
		expect(localRun?.factory?.audit?.selectionReason).toBe("delivered");
		selection = {
			...local,
			impact: "shared_contract",
			planReviewerIndices: [0],
			reviewerIndices: [0, 1],
		};
		const sharedRun = await runToEnd(h, await h.create("Shared"));
		expect(sharedRun?.factory?.humanReview).toEqual({
			required: true,
			reason: "shared contract",
		});
		expect(sharedRun?.factory?.audit).toBeUndefined();
	});

	it("files a rule card once a pattern recurs on two cards, never refiles it and caps open rule cards", async () => {
		const h = await harness({ planReviewers: 0, repoRules: true });
		const nominations = new Map<string, string[]>();
		const knownKeys = new Map<string, readonly string[] | undefined>();
		stubRuns(async (input) => {
			knownKeys.set(input.task.taskId, input.knownRuleKeys);
			return completedWith(
				nominations.get(input.task.taskId) ?? [],
				local,
			)(input);
		});
		const ruleCards = async () =>
			(await h.manager.listTasks({ factoryOnly: true })).filter(
				(task) => task.factory?.intake?.source === FACTORY_REPO_RULES_SOURCE,
			);
		const runCard = async (title: string, keys: string[]) => {
			const task = await h.create(title);
			nominations.set(task.taskId, keys);
			await runToEnd(h, task);
			return task;
		};

		await runCard("First", ["no-floating-promises"]);
		expect(await ruleCards()).toHaveLength(0);
		const second = await runCard("Second", ["no-floating-promises"]);
		// The rule card is filed as the run completes and scoped in the
		// background; wait for that scoping to stop rather than assume it has
		// (under a loaded suite it may still be retrying the designer).
		await vi.waitFor(
			async () => expect((await ruleCards())[0]?.status).toBe("failed"),
			{ timeout: 10_000 },
		);
		const filed = await ruleCards();
		expect(filed).toHaveLength(1);
		expect(filed[0]).toMatchObject({
			createdBy: { kind: "system", id: "factory_repo_rules" },
			originTaskId: second.taskId,
			// This harness's designer gives no plan for the rule card: its
			// scoping stops after the designer's bounded retries.
			status: "failed",
			error: expect.stringMatching(
				/^Design did not complete: Designer recovery limit/,
			),
			factory: {
				autonomy: "hands_off",
				approval: "automatic",
				intake: {
					source: FACTORY_REPO_RULES_SOURCE,
					key: "no-floating-promises",
				},
			},
		});
		expect(knownKeys.get(second.taskId)).toEqual(["no-floating-promises"]);

		// The same pattern again is not refiled; a second recurring pattern
		// waits while a rule card is open.
		await runCard("Third", ["no-floating-promises", "prefer-const"]);
		await runCard("Fourth", ["prefer-const"]);
		expect(await ruleCards()).toHaveLength(1);
	});

	it("never counts or files from a rule card's own run", async () => {
		const h = await harness({ planReviewers: 0, repoRules: true });
		const knownKeys = new Map<string, readonly string[] | undefined>();
		stubRuns(async (input) => {
			knownKeys.set(input.task.taskId, input.knownRuleKeys);
			return completedWith(["rule-card-pattern"], local)(input);
		});
		const rule = await h.create("Add a lint rule", {
			intake: { source: FACTORY_REPO_RULES_SOURCE, key: "earlier-rule" },
		});
		expect((await runToEnd(h, rule))?.status).toBe("completed");
		expect(knownKeys.get(rule.taskId)).toBeUndefined();
		// Archived, it no longer holds the open-card cap.
		const completed = await h.get(rule.taskId);
		await h.manager.archiveTask(
			rule.taskId,
			{ kind: "user" },
			completed.revision,
		);
		const other = await h.create("Other");
		await runToEnd(h, other);
		expect(knownKeys.get(other.taskId)).toEqual(["earlier-rule"]);
		const filed = (await h.manager.listTasks({ factoryOnly: true })).filter(
			(task) =>
				task.factory?.intake?.source === FACTORY_REPO_RULES_SOURCE &&
				task.taskId !== rule.taskId,
		);
		expect(filed).toHaveLength(0);
	});

	it("files no rule cards and passes no rule keys while repository rules are off (the default)", async () => {
		const h = await harness({ planReviewers: 0 });
		const knownKeys = new Map<string, readonly string[] | undefined>();
		stubRuns(async (input) => {
			knownKeys.set(input.task.taskId, input.knownRuleKeys);
			return completedWith(["no-floating-promises"], local)(input);
		});
		await runToEnd(h, await h.create("First"));
		const second = await h.create("Second");
		await runToEnd(h, second);
		expect(knownKeys.get(second.taskId)).toBeUndefined();
		expect(
			(await h.manager.listTasks({ factoryOnly: true })).filter(
				(task) => task.factory?.intake?.source === FACTORY_REPO_RULES_SOURCE,
			),
		).toHaveLength(0);
	});

	it("completes the run when filing a rule card fails", async () => {
		const h = await harness({ planReviewers: 0, repoRules: true });
		stubRuns(completedWith(["no-floating-promises"], local));
		await runToEnd(h, await h.create("First"));
		const second = await h.create("Second");
		const create = vi
			.spyOn(h.manager, "createTask")
			.mockRejectedValue(new Error("disk full"));
		const run = await runToEnd(h, second);
		expect(create).toHaveBeenCalledTimes(1);
		expect(run?.status).toBe("completed");
	});
});

describe("safety gates", () => {
	const usage = (totalCost: number) => ({
		inputTokens: 1,
		outputTokens: 1,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		totalCost,
	});

	it("does not start scoping once the card's scoping spend reached its limit", async () => {
		const h = await harness({ approval: "automatic" });
		const task = await h.create("Costly", { maxCostUsd: 1 });
		h.patch(task.taskId, { factoryDesignSessionIds: ["factory_design_1"] });
		h.runtime.getSessionUsage = vi.fn(async () => usage(1.25));
		await expect(h.manager.startFactoryDesign(task.taskId)).rejects.toThrow(
			"This card reached its $1 spending limit. Raise the limit or stop here.",
		);
		expect((await h.get(task.taskId)).error).toBe(
			"This card reached its $1 spending limit. Raise the limit or stop here.",
		);
		expect(h.runtime.startDesignSession).not.toHaveBeenCalled();
	});

	it("counts nothing in the card's or the daily spend for sessions whose start failed", async () => {
		const h = await harness({ planReviewers: 0 });
		const failedStart = (sessionId: string): FactoryAttempt => ({
			id: sessionId,
			key: "build",
			role: "builder",
			repairRound: 0,
			createdAt: new Date().toISOString(),
			sessionId,
			instructions: "",
			agent: {},
			status: "failed",
			failure: "runtime",
			error: "Provider unavailable",
			completedAt: new Date().toISOString(),
		});
		let runs = 0;
		stubRuns(async (input) => {
			runs += 1;
			// Three starts threw; no session was ever listed as started.
			input.save({
				...input.state,
				attempts: [1, 2, 3].map((n) => failedStart(`never_${runs}_${n}`)),
			});
			return { status: "failed", error: "Provider unavailable" };
		});
		// Scoping reported its usage; the failed starts report none.
		h.runtime.getSessionUsage = vi.fn(async (sessionId: string) =>
			sessionId.startsWith("never_") ? undefined : usage(0.1),
		);
		const task = await h.create("Outage", {
			autonomy: undefined,
			maxCostUsd: 1,
		});
		expect((await runToEnd(h, task))?.status).toBe("failed");
		// The card is not stopped for spending: the next try starts.
		expect((await runToEnd(h, await h.get(task.taskId)))?.status).toBe(
			"failed",
		);
		expect(runs).toBe(2);
		expect(await h.manager.getFactorySpentTodayUsd()).toBeLessThan(1);
	});

	it("does not start a run or retry once earlier runs reached the card's limit, and carries their spend into a new run", async () => {
		const h = await harness({ planReviewers: 0 });
		const states: FactoryRunState[] = [];
		stubRuns(async (input) => {
			states.push(input.state);
			input.save({
				...input.state,
				attempts: [
					{
						id: "s1",
						key: "build",
						role: "builder",
						repairRound: 0,
						createdAt: new Date().toISOString(),
						sessionId: `builder_${states.length}`,
						instructions: "",
						agent: {},
						status: "failed",
						failure: "runtime",
						error: "boom",
						completedAt: new Date().toISOString(),
						usage: usage(6),
					},
				],
			});
			return { status: "failed", error: "Builder failed" };
		});
		// A manual card, so no automatic retry runs between the tries.
		const task = await h.create("Twice", {
			autonomy: undefined,
			maxCostUsd: 10,
		});
		expect((await runToEnd(h, task))?.status).toBe("failed");
		const second = await runToEnd(h, await h.get(task.taskId));
		expect(second?.status).toBe("failed");
		// The resumed run counts its own earlier sessions; nothing else ran.
		expect(states[1]?.priorCardCostUsd).toBe(0);
		// $12 recorded: the third try does not start.
		const stopped = await h.get(task.taskId);
		await expect(
			h.manager.runTask(task.taskId, { kind: "user" }, stopped.revision),
		).rejects.toThrow("This card reached its $10 spending limit");
		expect(states).toHaveLength(2);
		expect((await h.get(task.taskId)).status).toBe("failed");
	});

	it("starts no queued work once today's spend reached the daily limit, and resumes when it is raised", async () => {
		const logs: Array<[string, unknown]> = [];
		const h = await harness({ approval: "automatic", logs });
		const spent = await h.create("Spent today");
		h.patch(spent.taskId, {
			factoryDesignSessionIds: [`factory_design_${Date.now()}_abcde`],
		});
		h.runtime.getSessionUsage = vi.fn(async () => usage(3));
		h.manager.setFactoryDailyCostUsd(2);
		await h.manager.start();
		expect(await h.manager.getFactorySpentTodayUsd()).toBe(3);
		const waiting = await h.create("Waiting");
		await h.manager.queueFactoryScoping(waiting.taskId);
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(h.runtime.startDesignSession).not.toHaveBeenCalled();
		expect((await h.get(waiting.taskId)).factoryQueued).toBe("design");
		expect(
			logs.some(([m]) => m.startsWith("factory daily spending limit reached")),
		).toBe(true);
		h.manager.setFactoryDailyCostUsd(5);
		await vi.waitFor(() =>
			expect(h.runtime.startDesignSession).toHaveBeenCalled(),
		);
	});

	it("starts queued work whatever today's spend once the person chose no daily limit", async () => {
		const h = await harness({ approval: "automatic" });
		const spent = await h.create("Spent today");
		h.patch(spent.taskId, {
			factoryDesignSessionIds: [`factory_design_${Date.now()}_abcde`],
		});
		h.runtime.getSessionUsage = vi.fn(async () => usage(300));
		h.manager.setFactoryDailyCostUsd(2);
		expect(h.manager.setFactoryDailyCostUsd(null)).toBeNull();
		expect(h.manager.getFactoryDailyCostUsd()).toBeNull();
		await h.manager.start();
		expect(await h.manager.getFactorySpentTodayUsd()).toBe(300);
		const waiting = await h.create("Waiting");
		await h.manager.queueFactoryScoping(waiting.taskId);
		await vi.waitFor(() =>
			expect(h.runtime.startDesignSession).toHaveBeenCalled(),
		);
	});

	it("waits instead of approving automatically when no reviewer runs on another model", async () => {
		const h = await harness({ approval: "automatic", planReviewers: 0 });
		const task = await h.create("Same model", {
			agents: { reviewers: [{}] },
		});
		const designed = await h.designed(task);
		expect(designed.status).toBe("pending_approval");
		expect(designed.error).toBe(
			`${FACTORY_AUTO_APPROVAL_WAITING_PREFIX}no independent reviewer is configured: add a reviewer on a different model in Factory settings, or approve this plan yourself.`,
		);
		// An agent cannot approve it either; a person can.
		await expect(
			h.manager.approveTask(task.taskId, { kind: "agent" }, designed.revision),
		).rejects.toThrow("no independent reviewer");
		await expect(
			h.manager.approveTask(task.taskId, { kind: "user" }, designed.revision),
		).resolves.toMatchObject({ status: "approved" });
		// A workflow may turn the requirement off.
		const relaxed = await h.designed(
			await h.create("Relaxed", {
				agents: { reviewers: [{}] },
				requireIndependentReview: false,
			}),
		);
		expect(relaxed.approvedRevision).toBe(relaxed.revision);
	});

	it("restarts an interrupted run at most twice, then stops it for a person", async () => {
		const h = await harness({ planReviewers: 0 });
		const task = await h.create("Interrupted", { autonomy: undefined });
		const approved = await h.manager.approveTask(
			task.taskId,
			{ kind: "user" },
			task.revision,
		);
		const store = new SqliteAgendaTaskStore({
			dbPath: join(h.workspaceRoot, "..", "tasks.db"),
		});
		disposals.unshift(async () => store.close());
		/** What a crashed host leaves: a running run whose claim expired. */
		const crashMidRun = () => {
			const run = store.createRun({
				taskId: task.taskId,
				taskRevision: approved.revision,
				claimToken: "crashed-host",
				claimUntilAt: new Date(0).toISOString(),
			});
			store.updateRun(run.runId, { status: "running" });
			store.dequeueFactory(task.taskId);
			store.updateTaskState(task.taskId, {
				status: "in_progress",
				currentRunId: run.runId,
				lastRunId: run.runId,
			});
			(
				h.manager as unknown as {
					recoverInterruptedRuns(factoryOnly?: boolean): void;
				}
			).recoverInterruptedRuns(true);
			return run;
		};
		for (let restart = 1; restart <= 2; restart++) {
			crashMidRun();
			const current = await h.get(task.taskId);
			expect(current.status).toBe("approved");
			expect(current.factoryQueued).toBe("run");
		}
		const last = crashMidRun();
		const stopped = await h.get(task.taskId);
		expect(stopped.status).toBe("failed");
		expect(stopped.factoryQueued).toBeUndefined();
		expect(stopped.error).toBe(
			"Factory restarted this run 2 times after the Hub stopped mid-run, so it stops here: check the card's workspace, then try again.",
		);
		// The stop is a failed run, so a person's retry starts a new lineage.
		expect(store.getRun(last.runId)?.status).toBe("failed");
	});

	it("sends a plan back for plan faults at most twice per lineage, whatever the findings say", async () => {
		const h = await harness({ approval: "automatic" });
		let call = 0;
		const runs = stubRuns(async () => {
			call++;
			throw new FactoryPlanConfigurationError([
				`${faultyFinding} variant ${call} is an absolute path outside the task worktree.`,
			]);
		});
		await h.manager.start();
		const task = await h.create();
		await h.manager.queueFactoryScoping(task.taskId);
		await vi.waitFor(
			async () => {
				expect(runs).toHaveBeenCalledTimes(3);
				expect((await h.get(task.taskId)).status).toBe("failed");
			},
			{ timeout: 10_000 },
		);
		const current = await h.get(task.taskId);
		expect(current.error).toContain(
			"Factory already sent this plan back to scoping 2 times for its checks",
		);
		expect(current.factoryDesignProgress?.planFaultRedesigns).toBe(2);
	});

	it("lets an agent retry a stopped card twice, then leaves it to a person", async () => {
		const h = await harness({ planReviewers: 0 });
		stubRuns(async () => ({ status: "failed", error: "Builder failed" }));
		// A manual card, so no automatic retry adds runs.
		const task = await h.create("Flaky", { autonomy: undefined });
		await runToEnd(h, task);
		const agent = { kind: "agent" as const, id: "chat" };
		const retry = async () => {
			const current = await h.get(task.taskId);
			await h.manager.startFactoryQueue(
				[{ taskId: task.taskId, expectedRevision: current.revision }],
				agent,
			);
			await vi.waitFor(async () => {
				const latest = await h.get(task.taskId);
				expect(latest.status).toBe("failed");
				expect(latest.currentRunId).toBeUndefined();
			});
		};
		await h.manager.start();
		await retry();
		await vi.waitFor(() =>
			expect(h.manager.getTaskRuns(task.taskId)).toHaveLength(2),
		);
		await retry();
		await vi.waitFor(() =>
			expect(h.manager.getTaskRuns(task.taskId)).toHaveLength(3),
		);
		const current = await h.get(task.taskId);
		await expect(
			h.manager.startFactoryQueue(
				[{ taskId: task.taskId, expectedRevision: current.revision }],
				agent,
			),
		).rejects.toThrow("a person must try it again in Factory");
		// A person's retry is not capped and starts the count again.
		await h.manager.startFactoryQueue(
			[{ taskId: task.taskId, expectedRevision: current.revision }],
			{ kind: "user" },
		);
		await vi.waitFor(() =>
			expect(h.manager.getTaskRuns(task.taskId)).toHaveLength(4),
		);
		await vi.waitFor(async () =>
			expect((await h.get(task.taskId)).currentRunId).toBeUndefined(),
		);
		const latest = h.manager.getTaskRuns(task.taskId)[0];
		expect(latest?.factory?.agentRetries).toBeUndefined();
	});

	it("scales a trivial plan: no plan reviewer, one code reviewer, no verifier, repair budget 1", async () => {
		const h = await harness({
			approval: "automatic",
			reviewMode: "adaptive",
			planReviewers: 1,
			reviewers: 2,
			repoProfile: profile,
			approvedProfile: profile,
			designer: () =>
				design({
					reviewSelection: {
						impact: "local",
						size: "trivial",
						rationale: "One line",
						affectedPaths: ["src/a.ts"],
						consumers: ["none"],
						planReviewerIndices: [0],
						reviewerIndices: [0, 1],
					},
				}),
		});
		const inputs: Array<
			Parameters<typeof factoryWorkflow.runFactoryWorkflow>[0]
		> = [];
		stubRuns(async (input) => {
			inputs.push(input);
			return { status: "completed" };
		});
		await h.manager.start();
		const task = await h.create();
		await h.manager.queueFactoryScoping(task.taskId);
		await vi.waitFor(() => expect(inputs).toHaveLength(1), { timeout: 5_000 });
		const designed = await h.get(task.taskId);
		expect(designed.factoryDesignProgress?.reviewSelection).toMatchObject({
			size: "trivial",
			planReviewerIndices: [],
			reviewerIndices: [0],
		});
		expect(h.reviewerPrompts()).toHaveLength(0);
		const input = inputs[0];
		expect(input?.task.factory?.maxRepairRounds).toBe(1);
		expect(input?.state.agents?.reviewers).toHaveLength(1);
		expect(input?.state.agents?.verifier).toBeUndefined();
	});
});

describe("backlog sweep limits", () => {
	/** A pending card with no workflow policy, left unqueued by an older build. */
	const legacyCard = async (
		h: Harness,
		options: {
			createdBy?: AgendaTaskRecord["createdBy"];
			factory?: Record<string, unknown>;
			title?: string;
		} = {},
	) => {
		const task = await h.create(
			options.title ?? "Legacy",
			{ autonomy: undefined, approval: "required", ...options.factory },
			options.createdBy,
			true,
		);
		return h.patch(task.taskId, {}) ?? task;
	};

	it("adopts only recent cards in an existing git repository, at most ten per sweep", async () => {
		const logs: Array<[string, unknown]> = [];
		const h = await harness({ logs });
		const cards = [];
		for (let index = 0; index < 12; index++)
			cards.push(await legacyCard(h, { title: `Card ${index}` }));
		const old = await legacyCard(h, { title: "Old" });
		const store = new SqliteAgendaTaskStore({
			dbPath: join(h.workspaceRoot, "..", "tasks.db"),
		});
		try {
			(
				store as unknown as {
					db: { prepare(sql: string): { run(...args: unknown[]): void } };
				}
			).db
				.prepare("UPDATE agenda_tasks SET created_at = ? WHERE task_id = ?")
				.run(new Date(Date.now() - 20 * 86_400_000).toISOString(), old.taskId);
		} finally {
			store.close();
		}
		// Paused, so queued scoping stays queued.
		h.manager.setFactoryPaused(true);
		await h.manager.start();
		await vi.waitFor(() =>
			expect(
				logs.some(([m]) => m === "factory backlog sweep limit reached"),
			).toBe(true),
		);
		const queued = (
			await Promise.all(cards.map((card) => h.get(card.taskId)))
		).filter((card) => card.factoryQueued === "design");
		expect(queued).toHaveLength(10);
		// The oldest cards go first.
		expect(queued.map((card) => card.title)).toContain("Card 0");
		expect((await h.get(old.taskId)).factoryQueued).toBeUndefined();
		expect(logs).toContainEqual([
			"factory backlog card not adopted",
			{ taskId: old.taskId, reason: "created more than 14 days ago" },
		]);
	});

	it("skips cards whose workspace is no longer a git repository", async () => {
		const logs: Array<[string, unknown]> = [];
		const h = await harness({ logs });
		const card = await legacyCard(h);
		rmSync(join(h.workspaceRoot, ".git"), { recursive: true, force: true });
		await h.manager.start();
		await vi.waitFor(() =>
			expect(logs).toContainEqual([
				"factory backlog card not adopted",
				{
					taskId: card.taskId,
					reason: "its workspace is missing or not a git repository",
				},
			]),
		);
		expect((await h.get(card.taskId)).factory?.adoptedPolicy).toBeUndefined();
	});

	it("keeps a stored publish opt-out and trusts only people's cards for automatic approval", async () => {
		const h = await harness();
		const people = await legacyCard(h, {
			factory: { publishPullRequest: false },
		});
		const agents = await legacyCard(h, {
			title: "From an agent",
			createdBy: { kind: "agent" },
		});
		await h.manager.start();
		await vi.waitFor(async () =>
			expect((await h.get(agents.taskId)).factory?.adoptedPolicy).toBeDefined(),
		);
		await vi.waitFor(async () =>
			expect((await h.get(people.taskId)).factory?.adoptedPolicy).toBeDefined(),
		);
		expect((await h.get(people.taskId)).factory).toMatchObject({
			autonomy: "hands_off",
			approval: "automatic",
			publishPullRequest: false,
			maxCostUsd: 10,
		});
		expect((await h.get(agents.taskId)).factory).toMatchObject({
			autonomy: "hands_off",
			approval: "required",
		});
	});

	it("leaves a card that already has a plan waiting for a person", async () => {
		const logs: Array<[string, unknown]> = [];
		const h = await harness({ logs });
		const task = await h.designed(await legacyCard(h));
		expect(task.factoryDesignProgress?.phase).toBe("complete");
		h.patch(task.taskId, {});
		await h.manager.start();
		await vi.waitFor(() =>
			expect(logs).toContainEqual([
				"factory backlog card not adopted",
				{ taskId: task.taskId, reason: "scoping already has progress" },
			]),
		);
		const current = await h.get(task.taskId);
		expect(current.factory?.adoptedPolicy).toBeUndefined();
		expect(current.approvedRevision).toBeUndefined();
		expect(current.status).toBe("pending_approval");
	});
});

describe("settings and daily limit fail closed", () => {
	it("pauses when its stored pause turns on, and stops new sessions of a running card at the daily limit", async () => {
		const h = await harness({ planReviewers: 0 });
		let paused = false;
		(
			h.manager as unknown as {
				resolveFactoryPaused: () => Promise<boolean>;
			}
		).resolveFactoryPaused = async () => paused;
		await h.manager.start();
		paused = true;
		await (
			h.manager as unknown as { refreshFactorySettings(): Promise<void> }
		).refreshFactorySettings();
		expect(h.manager.getFactoryPaused()).toBe(true);
		paused = false;
		await (
			h.manager as unknown as { refreshFactorySettings(): Promise<void> }
		).refreshFactorySettings();
		expect(h.manager.getFactoryPaused()).toBe(false);

		// The runtime handed to runs refuses new sessions past the daily limit.
		const runtimes: AgendaTaskRuntime[] = [];
		stubRuns(async (input) => {
			runtimes.push(input.runtime);
			return { status: "completed" };
		});
		await runToEnd(h, await h.create("Running"));
		const admission = runtimes[0]?.factoryAdmissionBlocker;
		expect(admission).toBeDefined();
		await expect(admission?.()).resolves.toBeUndefined();
		h.manager.setFactoryDailyCostUsd(0.5);
		(
			h.manager as unknown as { factorySpendCache?: unknown }
		).factorySpendCache = undefined;
		// The finished run's sessions have no known usage: each counts $1.
		const spent = await h.manager.getFactorySpentTodayUsd();
		expect(spent).toBeGreaterThanOrEqual(0);
		h.patch((await h.create("Spent")).taskId, {
			factoryDesignSessionIds: [`factory_design_${Date.now()}_abcde`],
		});
		(
			h.manager as unknown as { factorySpendCache?: unknown }
		).factorySpendCache = undefined;
		await expect(admission?.()).resolves.toContain("$0.5 daily spending limit");
	});

	it("starts nothing new when today's spend cannot be computed", async () => {
		const h = await harness();
		vi.spyOn(h.manager, "getFactorySpentTodayUsd").mockRejectedValue(
			new Error("database locked"),
		);
		await h.manager.start();
		const task = await h.create("Waiting");
		await h.manager.queueFactoryScoping(task.taskId);
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(h.runtime.startDesignSession).not.toHaveBeenCalled();
	});
});
