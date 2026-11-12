/**
 * Characterisation of the Factory card state the task manager persists.
 *
 * Drives the real AgendaTaskManager over a real SqliteAgendaTaskStore through
 * each public operation and a few crash points, and pins, read back from the
 * database after each step, the tuple
 * (task status, error class, queue entry, design phase, last run status and
 * phase, claim present) plus what `factoryCardState` says about the records.
 * These tests describe today's behaviour, suspected bugs included (marked
 * "CURRENT BEHAVIOUR, suspected bug:"); a change that moves one of them is a
 * behaviour change and should say so.
 *
 * The invariant "a card that is not terminal, not held and not waiting on a
 * person is either queued or working" is checked after every step in
 * log-only form: a violation never fails a test, it is logged and must be
 * listed in KNOWN_INVARIANT_VIOLATIONS.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AgendaTaskRecord,
	AgendaTaskRunStatus,
	AgendaTaskStatus,
	FactoryCardReasonCode,
	FactoryCardState,
	FactoryRunState,
} from "@cline/shared";
import {
	factoryCardState,
	factoryErrorReasonCode,
	factoryPlanHoldReason,
	factoryTaskConfigSchema,
} from "@cline/shared";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
	AgendaTaskManager,
	type AgendaTaskRuntime,
	type AgendaTaskRuntimeResult,
} from "./agenda-task-manager";
import {
	FactoryDecisionError,
	FactoryPlanConfigurationError,
	FactoryPublishError,
	FactoryVerificationProfileError,
} from "./factory-errors";
import * as factoryLocal from "./factory-local";
import * as factoryWorkflow from "./factory-workflow";
import { SqliteAgendaTaskStore } from "./store/sqlite-task-store";

/**
 * Scenarios whose persisted state breaks the invariant today. Log-only: each
 * is reported, none fails. Keep this list in step with the log below.
 */
const KNOWN_INVARIANT_VIOLATIONS: readonly string[] = [
	// A Hub that died mid-run leaves the run `running` with a claim valid for
	// up to 90 s; the next Hub skips it until the claim lapses (the
	// maintenance timer then recovers it), so the card reads in progress with
	// nobody working it.
	"hard crash during a run: restarted Hub before the claim lapses",
];

const observedViolations: string[] = [];
afterAll(() => {
	const unexpected = observedViolations.filter(
		(entry) => !KNOWN_INVARIANT_VIOLATIONS.includes(entry),
	);
	const gone = KNOWN_INVARIANT_VIOLATIONS.filter(
		(entry) => !observedViolations.includes(entry),
	);
	if (unexpected.length || gone.length)
		console.warn("factory invariant log differs from the known list", {
			unexpected,
			gone,
		});
});

const disposals: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const dispose of disposals.splice(0)) await dispose();
	vi.restoreAllMocks();
});

const check = { name: "Behavior", kind: "test", command: "true" } as const;
const checkCriterion = {
	id: "behavior",
	text: "The behavior check passes",
	required: true,
	check: "Behavior",
};
const independentModel = { providerId: "other", modelId: "reviewer" };
const pass = JSON.stringify({
	verdict: "pass",
	findings: [],
	summary: "Independent review passed",
});
const design = (extra: Record<string, unknown> = {}) => ({
	instructions: "Proposed brief",
	checks: [check],
	acceptanceCriteria: [checkCriterion],
	...extra,
});

type Designer = (
	sessionId: string,
	task: AgendaTaskRecord,
	call: number,
) => Promise<AgendaTaskRuntimeResult> | AgendaTaskRuntimeResult;

/** A runtime whose sessions settle when `abortSession` names them. */
function makeRuntime(
	designer: () => Designer | undefined,
	planReview: () => string = () => pass,
) {
	const blocked = new Map<string, () => void>();
	let call = 0;
	const runtime: AgendaTaskRuntime = {
		startSession: vi.fn(async () => ({ sessionId: "unused" })),
		runSession: vi.fn(async () => ({ status: "completed" as const })),
		abortSession: vi.fn(async (sessionId: string) => {
			blocked.get(sessionId)?.();
			blocked.delete(sessionId);
		}),
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
			async (sessionId: string, task: AgendaTaskRecord) => {
				if (sessionId.startsWith("factory_plan_review_"))
					return { status: "completed" as const, summary: planReview() };
				const custom = designer();
				if (custom) return custom(sessionId, task, call++);
				call++;
				return {
					status: "completed" as const,
					summary: JSON.stringify(design()),
				};
			},
		),
	};
	/** A designer turn that ends only when its session is aborted. */
	const hang = (sessionId: string) =>
		new Promise<AgendaTaskRuntimeResult>((resolve) =>
			blocked.set(sessionId, () =>
				resolve({ status: "cancelled", error: "aborted" }),
			),
		);
	return { runtime, hang };
}

async function harness(
	options: {
		approval?: "required" | "automatic";
		planReviewers?: number;
		concurrency?: number;
	} = {},
) {
	const root = realpathSync(
		mkdtempSync(join(tmpdir(), "cline-factory-characterisation-")),
	);
	const workspaceRoot = join(root, "repo");
	mkdirSync(workspaceRoot);
	// The backlog sweep only adopts cards in a git repository.
	execFileSync("git", ["init", "-q", workspaceRoot]);
	const dbPath = join(root, "tasks.db");
	let designer: Designer | undefined;
	let planReview = pass;
	const managers: AgendaTaskManager[] = [];
	const build = () => {
		const { runtime, hang } = makeRuntime(
			() => designer,
			() => planReview,
		);
		const manager = new AgendaTaskManager({
			runtime,
			dbPath,
			globalSpecsDir: join(root, "specs"),
			watchFiles: false,
			automationEnabled: false,
			factoryStorageDir: join(root, "factory"),
			factoryConcurrency: options.concurrency ?? 2,
			factorySettlePolling: { intervalMs: 1, attempts: 1 },
		});
		managers.push(manager);
		return { manager, runtime, hang };
	};
	let current = build();
	disposals.push(async () => {
		for (const manager of managers) await manager.dispose();
		rmSync(root, { recursive: true, force: true });
	});
	const h = {
		get manager() {
			return current.manager;
		},
		get runtime() {
			return current.runtime;
		},
		hang: (sessionId: string) => current.hang(sessionId),
		workspaceRoot,
		dbPath,
		setDesigner(next: Designer | undefined) {
			designer = next;
		},
		/** The JSON every plan reviewer returns. */
		setPlanReview(next: string) {
			planReview = next;
		},
		/**
		 * The Hub stops (gracefully, or by dying without cleanup) and a new one
		 * starts on the same database. A dead Hub's in-memory work is abandoned.
		 */
		async restart({
			graceful,
			start = true,
		}: {
			graceful: boolean;
			start?: boolean;
		}) {
			if (graceful) await current.manager.dispose();
			current = build();
			if (start) await current.manager.start();
		},
		create(
			title: string,
			factory: Record<string, unknown> = {},
			queueFactoryDesign?: boolean,
			createdBy: AgendaTaskRecord["createdBy"] = { kind: "user" },
		) {
			return current.manager.createTask({
				title,
				type: "follow-up",
				instructions: `Brief for ${title}`,
				scope: "workspace",
				workspaceRoot,
				expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
				createdBy,
				...(queueFactoryDesign === undefined ? {} : { queueFactoryDesign }),
				factory: factoryTaskConfigSchema.parse({
					autonomy: "hands_off",
					approval: options.approval ?? "required",
					reviewMode: "fixed",
					checks: [check],
					acceptanceCriteria: [checkCriterion],
					agents: {
						planReviewers: Array.from(
							{ length: options.planReviewers ?? 0 },
							() => ({}),
						),
						reviewers: [{ modelSelection: independentModel }],
					},
					...factory,
				}),
			});
		},
		async get(taskId: string) {
			const task = await current.manager.getTask(taskId);
			if (!task) throw new Error("Task disappeared");
			return task;
		},
		/** Opens the database directly, as another process would. */
		withStore<T>(read: (store: SqliteAgendaTaskStore) => T): T {
			const store = new SqliteAgendaTaskStore({ dbPath });
			try {
				return read(store);
			} finally {
				store.close();
			}
		},
		/** Scopes a card directly and waits until the plan settles or records an error. */
		async designed(task: AgendaTaskRecord) {
			await current.manager.startFactoryDesign(task.taskId);
			await vi.waitFor(async () => {
				const latest = await h.get(task.taskId);
				expect(
					latest.factoryDesignProgress?.phase === "complete" ||
						Boolean(latest.error),
				).toBe(true);
			});
			await settle();
			return h.get(task.taskId);
		},
	};
	return h;
}
type Harness = Awaited<ReturnType<typeof harness>>;

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

type WorkflowInput = Parameters<typeof factoryWorkflow.runFactoryWorkflow>[0];

/** Replaces the worktree and the workflow, so a run takes no git or model. */
function stubRuns(
	behave: (
		input: WorkflowInput,
		call: number,
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
	let call = 0;
	return vi
		.spyOn(factoryWorkflow, "runFactoryWorkflow")
		.mockImplementation((input) => behave(input, call++));
}

/** A workflow step that waits until the run is aborted, then throws its reason. */
const untilAborted = (input: WorkflowInput) =>
	new Promise<never>((_, reject) => {
		if (input.signal.aborted) reject(input.signal.reason);
		input.signal.addEventListener("abort", () => reject(input.signal.reason));
	});

/** A run in flight: approved by a person, started directly (not through the pump). */
async function startRun(h: Harness, task: AgendaTaskRecord) {
	const approved =
		task.status === "approved"
			? task
			: await h.manager.approveTask(
					task.taskId,
					{ kind: "user" },
					task.revision,
				);
	return h.manager.runTask(
		approved.taskId,
		{ kind: "user" },
		approved.revision,
	);
}

async function waitForRunEnd(h: Harness, taskId: string, runId?: string) {
	await vi.waitFor(() => {
		const run = h.manager
			.getTaskRuns(taskId)
			.find((entry) => !runId || entry.runId === runId);
		expect(["completed", "failed", "interrupted", "cancelled"]).toContain(
			run?.status,
		);
	});
	await settle();
}

/** The persisted tuple each scenario pins. */
type Persisted = {
	status: AgendaTaskStatus;
	/** The task error's reason code (`none` when there is no error). */
	error: FactoryCardReasonCode;
	queued?: "design" | "run";
	/** Design progress phase at the current revision. */
	design?: "designing" | "reviewing" | "complete";
	/** The current (else last) run's status and Factory phase. */
	run?: { status: AgendaTaskRunStatus; phase?: FactoryRunState["phase"] };
	/** The run carries a claim token. */
	claim: boolean;
};

function readState(h: Harness, taskId: string, live: boolean) {
	return h.withStore((store) => {
		const task = store.getTask(taskId);
		if (!task) throw new Error("Task missing from the database");
		const runs = store.listRuns({ taskId, limit: 100 });
		const runId = task.currentRunId ?? task.lastRunId;
		const run = runs.find((entry) => entry.runId === runId) ?? runs[0];
		const queue = live ? h.manager.getFactoryQueueState() : undefined;
		const working = queue?.working.includes(taskId) ?? false;
		const runLive =
			working && Boolean(run && ["starting", "running"].includes(run.status));
		const card = factoryCardState({
			task,
			lastRun: run,
			live: {
				designLive: working && !runLive,
				runLive,
				paused: queue?.paused,
				slotsFull: queue ? queue.working.length >= queue.concurrency : false,
			},
		});
		const design =
			task.factoryDesignProgress?.revision === task.revision
				? task.factoryDesignProgress.phase
				: undefined;
		const persisted: Persisted = {
			status: task.status,
			error: factoryErrorReasonCode(task.error),
			...(task.factoryQueued ? { queued: task.factoryQueued } : {}),
			...(design ? { design } : {}),
			...(run
				? {
						run: {
							status: run.status,
							...(run.factory ? { phase: run.factory.phase } : {}),
						},
					}
				: {}),
			claim: Boolean(run?.claimToken),
		};
		return { task, persisted, card, working };
	});
}

/**
 * Log-only: a card that is not terminal, not held and not waiting on a person
 * is either queued or working. Returns whether it holds.
 */
function checkInvariant(
	scenario: string,
	task: AgendaTaskRecord,
	card: FactoryCardState,
	working: boolean,
): boolean {
	const terminal =
		Boolean(task.archivedAt) ||
		["completed", "cancelled", "expired"].includes(task.status);
	const holds =
		terminal ||
		card.kind === "held" ||
		card.waitingOn === "person" ||
		task.factoryQueued !== undefined ||
		working;
	if (!holds) {
		observedViolations.push(scenario);
		console.warn(`factory invariant violated: ${scenario}`, {
			status: task.status,
			kind: card.kind,
			waitingOn: card.waitingOn,
		});
	}
	return holds;
}

/** Pins the persisted tuple and the card state; checks the invariant (log-only). */
function pin(
	h: Harness,
	scenario: string,
	taskId: string,
	persisted: Persisted,
	card: Partial<FactoryCardState>,
	{ live = true }: { live?: boolean } = {},
) {
	const state = readState(h, taskId, live);
	expect(state.persisted, scenario).toEqual(persisted);
	expect(state.card, scenario).toMatchObject(card);
	// The derivation is stable: the same records give the same answer.
	expect(readState(h, taskId, live).card).toEqual(state.card);
	return {
		...state,
		invariant: checkInvariant(scenario, state.task, state.card, state.working),
	};
}

describe("create", () => {
	it("queues a hands-off card for scoping", async () => {
		const h = await harness();
		const task = await h.create("Hands-off");
		pin(
			h,
			"create hands-off",
			task.taskId,
			{
				status: "pending_approval",
				error: "none",
				queued: "design",
				claim: false,
			},
			{
				kind: "queued",
				waitingOn: "slot",
				reasonCode: "none",
				stage: "waiting",
			},
		);
	});

	it("queues a manual card for scoping too", async () => {
		const h = await harness();
		const task = await h.create("Manual", { autonomy: undefined });
		pin(
			h,
			"create manual",
			task.taskId,
			{
				status: "pending_approval",
				error: "none",
				queued: "design",
				claim: false,
			},
			{ kind: "queued", waitingOn: "slot" },
		);
	});

	it("holds a card created without scoping", async () => {
		const h = await harness();
		const task = await h.create("Held", {}, false);
		expect(task.factory?.hold).toBe(true);
		pin(
			h,
			"create held",
			task.taskId,
			{ status: "pending_approval", error: "none", claim: false },
			{ kind: "held", waitingOn: "start", reasonCode: "held" },
		);
	});
});

describe("scoping", () => {
	it("keeps the scoping queue entry while the designer works, and drops it when the plan is ready", async () => {
		const h = await harness();
		let release: (() => void) | undefined;
		h.setDesigner(async () => {
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			return { status: "completed", summary: JSON.stringify(design()) };
		});
		await h.manager.start();
		const task = await h.create("Scoping");
		await vi.waitFor(() => expect(release).toBeDefined());
		// The queue entry is scoping's only persisted trace of who works it.
		pin(
			h,
			"scoping start",
			task.taskId,
			{
				status: "pending_approval",
				error: "none",
				queued: "design",
				design: "designing",
				claim: false,
			},
			{ kind: "scoping", waitingOn: "nobody", stage: "scope" },
		);
		release?.();
		await vi.waitFor(async () =>
			expect((await h.get(task.taskId)).factoryDesignProgress?.phase).toBe(
				"complete",
			),
		);
		await settle();
		pin(
			h,
			"scoping finish: plan ready",
			task.taskId,
			{
				status: "pending_approval",
				error: "none",
				design: "complete",
				claim: false,
			},
			{
				kind: "awaiting_approval",
				waitingOn: "person",
				reasonCode: "plan_approval",
			},
		);
	});

	it("records why automatic approval refused a settled plan, and dequeues it", async () => {
		const h = await harness({ approval: "automatic" });
		const task = await h.create("Same model", { agents: { reviewers: [{}] } });
		const designed = await h.designed(task);
		expect(designed.error).toMatch(/^Automatic approval is waiting: /);
		pin(
			h,
			"scoping finish: auto-approval blocked",
			task.taskId,
			{
				status: "pending_approval",
				error: "plan_held",
				design: "complete",
				claim: false,
			},
			{
				kind: "awaiting_approval",
				waitingOn: "person",
				reasonCode: "plan_held",
			},
		);
	});

	it("approves a settled plan automatically and queues its run", async () => {
		const h = await harness({ approval: "automatic" });
		// The pump runs queued work even before start(); paused keeps the run queued.
		h.manager.setFactoryPaused(true);
		const task = await h.create("Automatic");
		await h.designed(task);
		pin(
			h,
			"scoping finish: automatic approval",
			task.taskId,
			{
				status: "approved",
				error: "none",
				queued: "run",
				design: "complete",
				claim: false,
			},
			{ kind: "queued", waitingOn: "slot", reasonCode: "factory_paused" },
		);
	});

	it("waits on a person while a scoping question is pending, then settles once answered", async () => {
		const h = await harness();
		h.setDesigner(async (sessionId, task) => {
			const answer = await h.manager.requestFactoryQuestion({
				taskId: task.taskId,
				sessionId,
				question: "Which page?",
			});
			return {
				status: "completed",
				summary: JSON.stringify(design({ instructions: `Brief: ${answer}` })),
			};
		});
		const task = await h.create("Asking", {}, false);
		await h.manager.startFactoryDesign(task.taskId);
		await vi.waitFor(async () =>
			expect((await h.get(task.taskId)).factoryQuestions?.[0]?.status).toBe(
				"pending",
			),
		);
		pin(
			h,
			"scoping: question pending",
			task.taskId,
			{
				status: "pending_approval",
				error: "none",
				queued: "design",
				design: "designing",
				claim: false,
			},
			{ kind: "scoping", waitingOn: "person", reasonCode: "question" },
		);
		const asked = await h.get(task.taskId);
		const questionId = asked.factoryQuestions?.[0]?.questionId ?? "";
		await h.manager.answerFactoryQuestion(task.taskId, questionId, "Home");
		await vi.waitFor(async () =>
			expect((await h.get(task.taskId)).factoryDesignProgress?.phase).toBe(
				"complete",
			),
		);
		await settle();
		pin(
			h,
			"scoping: question answered",
			task.taskId,
			{
				status: "pending_approval",
				error: "none",
				design: "complete",
				claim: false,
			},
			{ kind: "awaiting_approval", reasonCode: "plan_approval" },
		);
	});

	it("leaves a designer conclusion for a person and never queues it", async () => {
		const h = await harness({ approval: "automatic" });
		h.setDesigner(() => ({
			status: "completed",
			summary: JSON.stringify({
				conclusion: {
					outcome: "already_fixed",
					rationale: "Fixed in abc123.",
					evidence: ["src/form.ts:12"],
				},
			}),
		}));
		const task = await h.create("Triage", {
			intake: { source: "agent", key: "triage-1" },
		});
		await h.manager.startFactoryDesign(task.taskId);
		await vi.waitFor(async () =>
			expect(
				(await h.get(task.taskId)).factoryDesignProgress?.conclusion,
			).toBeDefined(),
		);
		await settle();
		pin(
			h,
			"scoping finish: designer conclusion",
			task.taskId,
			{
				status: "pending_approval",
				error: "none",
				design: "complete",
				claim: false,
			},
			{ kind: "concluded", waitingOn: "person", reasonCode: "conclusion" },
		);
	});

	it("scopes the new brief again, once, after an edit during live scoping", async () => {
		const h = await harness();
		h.setDesigner((sessionId) => h.hang(sessionId));
		await h.manager.start();
		const task = await h.create("Edited mid-scoping");
		await vi.waitFor(async () =>
			expect((await h.get(task.taskId)).factoryDesignProgress?.phase).toBe(
				"designing",
			),
		);
		await settle();
		const current = await h.get(task.taskId);
		await h.manager.updateTask({
			taskId: task.taskId,
			expectedRevision: current.revision,
			instructions: "A different brief",
			updatedBy: { kind: "user" },
		});
		pin(
			h,
			"edit during live scoping: old designer still running",
			task.taskId,
			{
				status: "pending_approval",
				error: "none",
				queued: "design",
				claim: false,
			},
			{ kind: "scoping", waitingOn: "nobody" },
		);
		// The designer of the old brief keeps running until it ends on its own;
		// its result is discarded and the new brief is scoped without a person.
		h.setDesigner(undefined);
		const live = (await h.get(task.taskId)).originSessionId ?? "";
		await h.runtime.abortSession(live, "test ends the old designer");
		await vi.waitFor(async () =>
			expect((await h.get(task.taskId)).factoryDesignProgress?.phase).toBe(
				"complete",
			),
		);
		await settle();
		pin(
			h,
			"edit during live scoping",
			task.taskId,
			{
				status: "pending_approval",
				error: "none",
				design: "complete",
				claim: false,
			},
			{ kind: "awaiting_approval", waitingOn: "person" },
		);
		// One more designer, for the edited brief.
		expect(h.runtime.startDesignSession).toHaveBeenCalledTimes(2);
		expect(
			vi.mocked(h.runtime.runDesignSession)?.mock.calls.at(-1)?.[1]
				.instructions,
		).toContain("A different brief");
		expect(
			vi.mocked(h.runtime.runDesignSession)?.mock.calls.at(-1)?.[1]
				.instructions,
		).not.toContain("Brief for Edited mid-scoping");
	});
});

describe("approval and runs", () => {
	it("queues the run when a person approves", async () => {
		const h = await harness();
		const task = await h.create("Approve", {}, false);
		const approved = await h.manager.approveTask(
			task.taskId,
			{ kind: "user" },
			task.revision,
		);
		expect(approved.status).toBe("approved");
		pin(
			h,
			"approve",
			task.taskId,
			{ status: "approved", error: "none", queued: "run", claim: false },
			{ kind: "queued", waitingOn: "slot", reasonCode: "none" },
		);
	});

	it("claims the run and leaves the queue when it starts", async () => {
		const h = await harness();
		stubRuns((input) => untilAborted(input));
		const task = await h.create("Run start", {}, false);
		await startRun(h, task);
		await settle();
		pin(
			h,
			"run start",
			task.taskId,
			{
				status: "in_progress",
				error: "none",
				run: { status: "running", phase: "implementing" },
				claim: true,
			},
			{ kind: "running", waitingOn: "nobody", stage: "build" },
		);
	});

	it("completes a delivered run, releases the claim and asks for a stamp when impact is unknown", async () => {
		const h = await harness();
		stubRuns(async (input) => {
			input.save({
				...input.state,
				phase: "ready",
				pullRequestUrl: "https://github.com/o/r/pull/7",
				candidate: { commit: "abc", checks: [], reviews: [] },
			});
			return { status: "completed", summary: "done" };
		});
		const task = await h.create("Delivered", {}, false);
		const { run } = await startRun(h, task);
		await waitForRunEnd(h, task.taskId, run?.runId);
		pin(
			h,
			"run success: delivered",
			task.taskId,
			{
				status: "completed",
				error: "none",
				run: { status: "completed", phase: "ready" },
				claim: false,
			},
			{
				kind: "delivered",
				waitingOn: "person",
				reasonCode: "review_required",
				reasonText: "impact unknown",
				deliverable: { kind: "draft_pr", url: "https://github.com/o/r/pull/7" },
			},
		);
	});

	it("fails a run stopped at its repair limit with the draft PR open, which reads as delivered with findings", async () => {
		const h = await harness();
		stubRuns(async (input) => {
			input.save({
				...input.state,
				phase: "blocked",
				pullRequestUrl: "https://github.com/o/r/pull/8",
				unresolvedFindings: {
					commit: "abc",
					findings: ["Reviewer 1: a"],
					pullRequestOpen: true,
				},
			});
			throw new FactoryDecisionError(
				"Repair limit (2) reached; the draft PR stays open with 1 unresolved finding.\n- Reviewer 1: a",
			);
		});
		const task = await h.create("Open findings", {}, false);
		const { run } = await startRun(h, task);
		await waitForRunEnd(h, task.taskId, run?.runId);
		pin(
			h,
			"run success: delivered with open findings",
			task.taskId,
			{
				status: "failed",
				error: "repair_limit",
				run: { status: "failed", phase: "blocked" },
				claim: false,
			},
			{
				kind: "delivered_with_findings",
				waitingOn: "person",
				reasonCode: "open_findings",
			},
		);
	});
});

describe("run failures", () => {
	it("re-queues a hands-off run once after an ordinary failure", async () => {
		const h = await harness();
		stubRuns(async () => {
			// Paused, so the retry stays queued where the test can see it.
			h.manager.setFactoryPaused(true);
			return { status: "failed", error: "socket hang up" };
		});
		const task = await h.create("Flaky", {}, false);
		const { run } = await startRun(h, task);
		await waitForRunEnd(h, task.taskId, run?.runId);
		pin(
			h,
			"run failure: auto-recovered",
			task.taskId,
			{
				status: "approved",
				error: "none",
				queued: "run",
				run: { status: "failed", phase: "implementing" },
				claim: false,
			},
			{
				kind: "queued",
				waitingOn: "slot",
				reasonCode: "factory_paused",
			},
		);
		expect(
			h.manager.getTaskRuns(task.taskId)[0]?.factory?.autoRecovery,
		).toMatchObject({
			attempts: 1,
			reason: "socket hang up",
		});
	});

	it("stops on a Factory decision without a retry", async () => {
		const h = await harness();
		stubRuns(async () => {
			throw new FactoryDecisionError(
				"PR feedback needs a maintainer to confirm it.",
			);
		});
		const task = await h.create("Decision", {}, false);
		const { run } = await startRun(h, task);
		await waitForRunEnd(h, task.taskId, run?.runId);
		pin(
			h,
			"run failure: decision error",
			task.taskId,
			{
				status: "failed",
				error: "unknown",
				run: { status: "failed", phase: "implementing" },
				claim: false,
			},
			{ kind: "stopped", waitingOn: "person", reasonCode: "unknown" },
		);
	});

	it("CURRENT BEHAVIOUR, suspected bug: a run that fails before its first state write is finished as an ordinary agenda run, keeping its claim and skipping recovery", async () => {
		const h = await harness();
		vi.spyOn(factoryLocal, "prepareFactoryWorkspace").mockRejectedValue(
			new Error("git worktree add failed"),
		);
		const task = await h.create("No workspace", {}, false);
		const approved = await h.manager.approveTask(
			task.taskId,
			{ kind: "user" },
			task.revision,
		);
		await expect(
			h.manager.runTask(task.taskId, { kind: "user" }, approved.revision),
		).rejects.toThrow("git worktree add failed");
		// Hands-off, yet no automatic retry; the failed run still holds its claim.
		pin(
			h,
			"run failure: workspace preparation",
			task.taskId,
			{
				status: "failed",
				error: "unknown",
				queued: "run",
				run: { status: "failed" },
				claim: true,
			},
			{ kind: "stopped", waitingOn: "person", reasonCode: "unknown" },
		);
	});

	it("stops at the review repair limit", async () => {
		const h = await harness();
		stubRuns(async (input) => {
			input.save({
				...input.state,
				phase: "blocked",
				repairRound: 2,
				candidate: {
					commit: "abc",
					checks: [],
					reviews: [
						{
							reviewerIndex: 0,
							sessionId: "review",
							review: {
								verdict: "changes_requested",
								summary: "No",
								findings: ["Redundant gate"],
							},
						},
					],
				},
				unresolvedFindings: { commit: "abc", findings: ["Redundant gate"] },
			});
			throw new FactoryDecisionError(
				"Repair limit (2) reached.\n- Reviewer 1: Redundant gate",
			);
		});
		const task = await h.create("Repair limit", {}, false);
		const { run } = await startRun(h, task);
		await waitForRunEnd(h, task.taskId, run?.runId);
		pin(
			h,
			"run failure: repair limit",
			task.taskId,
			{
				status: "failed",
				error: "repair_limit",
				run: { status: "failed", phase: "blocked" },
				claim: false,
			},
			{
				kind: "stopped",
				waitingOn: "person",
				reasonCode: "repair_limit",
				stage: "review",
			},
		);
	});

	it("stops when the draft PR cannot be opened", async () => {
		const h = await harness();
		stubRuns(async (input) => {
			input.save({ ...input.state, phase: "publishing" });
			throw new FactoryPublishError("Add an origin remote, then try again.");
		});
		const task = await h.create("Publish", {}, false);
		const { run } = await startRun(h, task);
		await waitForRunEnd(h, task.taskId, run?.runId);
		pin(
			h,
			"run failure: publish failure",
			task.taskId,
			{
				status: "failed",
				error: "publish_failed",
				run: { status: "failed", phase: "publishing" },
				claim: false,
			},
			{
				kind: "stopped",
				waitingOn: "person",
				reasonCode: "publish_failed",
				stage: "review",
			},
		);
	});

	it("sends a hands-off plan fault back to scoping in one write", async () => {
		const h = await harness();
		stubRuns(async () => {
			h.manager.setFactoryPaused(true);
			throw new FactoryPlanConfigurationError([
				'Check "Behavior" artifact "/tmp/behavior.log" is outside the worktree.',
			]);
		});
		const task = await h.designed(await h.create("Plan fault", {}, false));
		const { run } = await startRun(h, task);
		await waitForRunEnd(h, task.taskId, run?.runId);
		pin(
			h,
			"run failure: plan fault redesign",
			task.taskId,
			{
				status: "pending_approval",
				error: "none",
				queued: "design",
				design: "designing",
				run: { status: "failed", phase: "implementing" },
				claim: false,
			},
			{ kind: "queued", waitingOn: "slot", reasonCode: "factory_paused" },
		);
	});

	it("sends a broken verification profile back to scoping in one write", async () => {
		const h = await harness();
		stubRuns(async () => {
			h.manager.setFactoryPaused(true);
			throw new FactoryVerificationProfileError("start", "port 3000 in use");
		});
		const task = await h.designed(await h.create("Profile", {}, false));
		const { run } = await startRun(h, task);
		await waitForRunEnd(h, task.taskId, run?.runId);
		pin(
			h,
			"run failure: profile failure redesign",
			task.taskId,
			{
				status: "pending_approval",
				error: "none",
				queued: "design",
				design: "designing",
				run: { status: "failed", phase: "implementing" },
				claim: false,
			},
			{ kind: "queued", waitingOn: "slot" },
		);
		expect(h.manager.getTaskRuns(task.taskId)[0]?.error).toBe(
			"Verification profile failed (start): port 3000 in use",
		);
	});
});

describe("hold, start and retry", () => {
	it("holds a queued unscoped card, then queues it again on start", async () => {
		const h = await harness();
		const task = await h.create("Hold me");
		const held = await h.manager.holdFactoryTask(task.taskId);
		expect(held.factory?.hold).toBe(true);
		pin(
			h,
			"hold",
			task.taskId,
			{ status: "pending_approval", error: "none", claim: false },
			{ kind: "held", waitingOn: "start" },
		);
		const started = await h.manager.queueFactoryScoping(task.taskId, {
			kind: "user",
		});
		expect(started.factory?.hold).toBeUndefined();
		pin(
			h,
			"start (queue scoping)",
			task.taskId,
			{
				status: "pending_approval",
				error: "none",
				queued: "design",
				claim: false,
			},
			{ kind: "queued", waitingOn: "slot" },
		);
	});

	it("reads a retried stopped card as approved and queued while it waits", async () => {
		const h = await harness();
		stubRuns(async () => ({ status: "failed", error: "Builder failed" }));
		// Manual, so no automatic retry adds runs.
		const task = await h.create("Retry", { autonomy: undefined }, false);
		const { run } = await startRun(h, task);
		await waitForRunEnd(h, task.taskId, run?.runId);
		pin(
			h,
			"retry: stopped",
			task.taskId,
			{
				status: "failed",
				error: "unknown",
				run: { status: "failed", phase: "implementing" },
				claim: false,
			},
			{ kind: "stopped", waitingOn: "person", stage: "build" },
		);
		h.manager.setFactoryPaused(true);
		const stopped = await h.get(task.taskId);
		await h.manager.startFactoryQueue(
			[{ taskId: task.taskId, expectedRevision: stopped.revision }],
			{ kind: "user" },
		);
		// Queued to run again: the stop no longer stands.
		pin(
			h,
			"retry: queued",
			task.taskId,
			{
				status: "approved",
				error: "none",
				queued: "run",
				run: { status: "failed", phase: "implementing" },
				claim: false,
			},
			{ kind: "queued", waitingOn: "slot", reasonCode: "factory_paused" },
		);
		// The retry runs the plan again; it stops again on the same failure.
		h.manager.setFactoryPaused(false);
		await h.manager.start();
		await vi.waitFor(async () => {
			expect(h.manager.getTaskRuns(task.taskId)).toHaveLength(2);
			expect((await h.get(task.taskId)).status).toBe("failed");
		});
	});
});

describe("edits", () => {
	it("re-queues a hands-off card whose plan an edit discarded; leaves a manual one for Start", async () => {
		const h = await harness();
		const handsOff = await h.designed(
			await h.create("Hands-off edit", {}, false),
		);
		const manual = await h.designed(
			await h.create("Manual edit", { autonomy: undefined }, false),
		);
		for (const task of [handsOff, manual])
			await h.manager.updateTask({
				taskId: task.taskId,
				expectedRevision: task.revision,
				instructions: "Edited brief",
				// A person's edit releases an explicit hold only by starting it.
				factory: { ...task.factory, hold: undefined } as never,
				updatedBy: { kind: "user" },
			});
		pin(
			h,
			"edit invalidates plan: hands-off",
			handsOff.taskId,
			{
				status: "pending_approval",
				error: "none",
				queued: "design",
				claim: false,
			},
			{ kind: "queued", waitingOn: "slot" },
		);
		pin(
			h,
			"edit invalidates plan: manual",
			manual.taskId,
			{ status: "pending_approval", error: "none", claim: false },
			{ kind: "not_started", waitingOn: "start" },
		);
	});

	it("keeps a card queued for scoping queued for its edited brief, then scopes it", async () => {
		const h = await harness();
		h.manager.setFactoryPaused(true);
		await h.manager.start();
		const task = await h.create("Queued edit");
		await settle();
		await h.manager.updateTask({
			taskId: task.taskId,
			expectedRevision: task.revision,
			instructions: "Edited while queued",
			updatedBy: { kind: "user" },
		});
		const edited = await h.get(task.taskId);
		expect(edited.revision).toBe(task.revision + 1);
		const entry = h.withStore((store) =>
			store.listFactoryQueue().find((queued) => queued.taskId === task.taskId),
		);
		expect(entry).toMatchObject({
			stage: "design",
			expectedRevision: edited.revision,
		});
		pin(
			h,
			"edit of a card queued for scoping: before the pump",
			task.taskId,
			{
				status: "pending_approval",
				error: "none",
				queued: "design",
				claim: false,
			},
			{ kind: "queued" },
		);
		h.manager.setFactoryPaused(false);
		await vi.waitFor(async () =>
			expect((await h.get(task.taskId)).factoryDesignProgress?.phase).toBe(
				"complete",
			),
		);
		await settle();
		pin(
			h,
			"edit of a card queued for scoping: after the pump",
			task.taskId,
			{
				status: "pending_approval",
				error: "none",
				design: "complete",
				claim: false,
			},
			{ kind: "awaiting_approval", waitingOn: "person" },
		);
		expect(h.runtime.startDesignSession).toHaveBeenCalledTimes(1);
		expect(
			vi.mocked(h.runtime.runDesignSession)?.mock.calls[0]?.[1].instructions,
		).toContain("Edited while queued");
	});
});

describe("cancel, archive and restore", () => {
	it("cancels a queued card and drops its queue entry", async () => {
		const h = await harness();
		const task = await h.create("Cancel");
		await h.manager.cancelTask(task.taskId, { kind: "user" }, task.revision);
		pin(
			h,
			"cancel",
			task.taskId,
			{ status: "cancelled", error: "none", claim: false },
			{ kind: "closed", waitingOn: "nobody", reasonCode: "cancelled" },
		);
	});

	it("cancels a running card and its run", async () => {
		const h = await harness();
		stubRuns((input) => untilAborted(input));
		const task = await h.create("Cancel running", {}, false);
		await startRun(h, task);
		await settle();
		const running = await h.get(task.taskId);
		await h.manager.cancelTask(task.taskId, { kind: "user" }, running.revision);
		await settle();
		pin(
			h,
			"cancel running",
			task.taskId,
			{
				status: "cancelled",
				error: "none",
				run: { status: "cancelled", phase: "implementing" },
				claim: true,
			},
			{ kind: "closed", waitingOn: "nobody", stage: "build" },
		);
	});

	it("queues a restored hands-off card for scoping at once", async () => {
		const h = await harness();
		const task = await h.create("Archive me");
		const archived = await h.manager.archiveTask(
			task.taskId,
			{ kind: "user" },
			task.revision,
		);
		pin(
			h,
			"archive and restore: archived",
			task.taskId,
			{ status: "pending_approval", error: "none", claim: false },
			{ kind: "archived", waitingOn: "nobody" },
		);
		await h.manager.restoreTask(
			task.taskId,
			{ kind: "user" },
			archived.revision,
		);
		pin(
			h,
			"archive and restore: restored hands-off card",
			task.taskId,
			{
				status: "pending_approval",
				error: "none",
				queued: "design",
				claim: false,
			},
			{ kind: "queued", waitingOn: "slot" },
		);
	});

	it("leaves a restored manual card that never adopted a policy for Start", async () => {
		const h = await harness();
		const task = await h.create("Archive manual", { autonomy: undefined });
		const archived = await h.manager.archiveTask(
			task.taskId,
			{ kind: "user" },
			task.revision,
		);
		await h.manager.restoreTask(
			task.taskId,
			{ kind: "user" },
			archived.revision,
		);
		pin(
			h,
			"archive and restore: restored manual card",
			task.taskId,
			{ status: "pending_approval", error: "none", claim: false },
			{ kind: "not_started", waitingOn: "start" },
		);
	});

	it("restores an automatically approved plan as waiting for a person's approval", async () => {
		const h = await harness({ approval: "automatic" });
		h.manager.setFactoryPaused(true);
		const task = await h.designed(await h.create("Approved", {}, false));
		expect(task.status).toBe("approved");
		const archived = await h.manager.archiveTask(
			task.taskId,
			{ kind: "user" },
			task.revision,
		);
		await h.manager.restoreTask(
			task.taskId,
			{ kind: "user" },
			archived.revision,
		);
		pin(
			h,
			"archive and restore: approved plan",
			task.taskId,
			{
				status: "pending_approval",
				error: "none",
				design: "complete",
				claim: false,
			},
			{
				kind: "awaiting_approval",
				waitingOn: "person",
				reasonCode: "plan_approval",
			},
		);
	});
});

describe("pause, spend limits and backlog", () => {
	it("keeps queued work queued while paused and starts it on resume", async () => {
		const h = await harness();
		h.setDesigner((sessionId) => h.hang(sessionId));
		h.manager.setFactoryPaused(true);
		await h.manager.start();
		const task = await h.create("Paused");
		await settle();
		pin(
			h,
			"pause",
			task.taskId,
			{
				status: "pending_approval",
				error: "none",
				queued: "design",
				claim: false,
			},
			{ kind: "queued", waitingOn: "slot", reasonCode: "factory_paused" },
		);
		h.manager.setFactoryPaused(false);
		await vi.waitFor(async () =>
			expect((await h.get(task.taskId)).factoryDesignProgress?.phase).toBe(
				"designing",
			),
		);
		await settle();
		pin(
			h,
			"resume",
			task.taskId,
			{
				status: "pending_approval",
				error: "none",
				queued: "design",
				design: "designing",
				claim: false,
			},
			{ kind: "scoping", waitingOn: "nobody" },
		);
	});

	const usage = (totalCost: number) => ({
		inputTokens: 1,
		outputTokens: 1,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		totalCost,
	});

	it("fails a card the queue could not scope at its spending limit", async () => {
		const h = await harness();
		h.manager.setFactoryPaused(true);
		const task = await h.create("Costly", { maxCostUsd: 1 });
		h.withStore((store) =>
			store.updateTaskState(task.taskId, {
				factoryDesignSessionIds: ["factory_design_1"],
			}),
		);
		h.runtime.getSessionUsage = vi.fn(async () => usage(1.25));
		await h.manager.start();
		h.manager.setFactoryPaused(false);
		await vi.waitFor(async () =>
			expect((await h.get(task.taskId)).error).toBeDefined(),
		);
		await settle();
		// The queue path fails the card; startFactoryDesign alone only records the error.
		pin(
			h,
			"spend limit: scoping through the queue",
			task.taskId,
			{ status: "failed", error: "spend_limit", claim: false },
			{
				kind: "stopped",
				waitingOn: "person",
				reasonCode: "spend_limit",
				stage: "scope",
			},
		);
	});

	it("records the spending limit on a pending card when scoping is started directly", async () => {
		const h = await harness();
		const task = await h.create("Costly direct", { maxCostUsd: 1 }, false);
		h.withStore((store) =>
			store.updateTaskState(task.taskId, {
				factoryDesignSessionIds: ["factory_design_1"],
			}),
		);
		h.runtime.getSessionUsage = vi.fn(async () => usage(1.25));
		await expect(h.manager.startFactoryDesign(task.taskId)).rejects.toThrow(
			"spending limit",
		);
		pin(
			h,
			"spend limit: scoping started directly",
			task.taskId,
			{ status: "pending_approval", error: "spend_limit", claim: false },
			// A recorded stop outranks the hold: Try again is the way on.
			{ kind: "stopped", waitingOn: "person", stage: "scope" },
		);
	});

	it("fails a run refused at the card's spending limit", async () => {
		const h = await harness();
		stubRuns(async (input) => {
			input.save({
				...input.state,
				attempts: [
					{
						id: "s1",
						key: "build",
						role: "builder",
						repairRound: 0,
						createdAt: new Date().toISOString(),
						sessionId: "builder_1",
						instructions: "",
						agent: {},
						status: "failed",
						failure: "runtime",
						error: "boom",
						completedAt: new Date().toISOString(),
						usage: usage(12),
					},
				],
			});
			return { status: "failed", error: "Builder failed" };
		});
		// Manual, so no automatic retry runs between the tries.
		const task = await h.create(
			"Costly run",
			{ autonomy: undefined, maxCostUsd: 10 },
			false,
		);
		const { run } = await startRun(h, task);
		await waitForRunEnd(h, task.taskId, run?.runId);
		const stopped = await h.get(task.taskId);
		await expect(
			h.manager.runTask(task.taskId, { kind: "user" }, stopped.revision),
		).rejects.toThrow("This card reached its $10 spending limit");
		pin(
			h,
			"spend limit: run",
			task.taskId,
			{
				status: "failed",
				error: "spend_limit",
				run: { status: "failed", phase: "implementing" },
				claim: false,
			},
			{ kind: "stopped", waitingOn: "person", reasonCode: "spend_limit" },
		);
	});

	it("adopts a never-scoped unqueued card on start", async () => {
		const h = await harness();
		const task = await h.create("Backlog");
		// As an older build left it: never scoped, not queued, not held.
		h.withStore((store) => store.dequeueFactory(task.taskId));
		h.manager.setFactoryPaused(true);
		await h.manager.start();
		await vi.waitFor(async () =>
			expect((await h.get(task.taskId)).factoryQueued).toBe("design"),
		);
		pin(
			h,
			"backlog adoption",
			task.taskId,
			{
				status: "pending_approval",
				error: "none",
				queued: "design",
				claim: false,
			},
			{ kind: "queued", waitingOn: "slot", reasonCode: "factory_paused" },
		);
	});
});

describe("crash points", () => {
	it("keeps the scoping queue entry when the Hub stops mid-scoping, and resumes scoping on restart (refutes 'idle with nothing queued')", async () => {
		const h = await harness();
		h.setDesigner((sessionId) => h.hang(sessionId));
		await h.manager.start();
		const task = await h.create("Scoping crash");
		await vi.waitFor(async () =>
			expect((await h.get(task.taskId)).factoryDesignProgress?.phase).toBe(
				"designing",
			),
		);
		await settle();
		await h.restart({ graceful: true, start: false });
		pin(
			h,
			"graceful stop during scoping: stopped",
			task.taskId,
			{
				status: "pending_approval",
				error: "none",
				queued: "design",
				design: "designing",
				claim: false,
			},
			{ kind: "queued", waitingOn: "slot" },
			{ live: false },
		);
		h.setDesigner(undefined);
		await h.manager.start();
		await vi.waitFor(async () =>
			expect((await h.get(task.taskId)).factoryDesignProgress?.phase).toBe(
				"complete",
			),
		);
		await settle();
		pin(
			h,
			"graceful stop during scoping: restarted",
			task.taskId,
			{
				status: "pending_approval",
				error: "none",
				design: "complete",
				claim: false,
			},
			{ kind: "awaiting_approval" },
		);
	});

	it("keeps a card queued when the Hub stops while the pump is starting scoping, and scopes it on restart", async () => {
		const h = await harness();
		let sessionRequested: (() => void) | undefined;
		const requested = new Promise<void>((resolve) => {
			sessionRequested = resolve;
		});
		// The designer session takes a moment to start; the Hub stops meanwhile.
		vi.mocked(h.runtime.startDesignSession)?.mockImplementation(
			async (_task, _client, _agent, sessionId?: string) => {
				sessionRequested?.();
				await new Promise((resolve) => setTimeout(resolve, 20));
				return { sessionId: sessionId ?? "designer" };
			},
		);
		await h.manager.start();
		const task = await h.create("Stopped while starting");
		await requested;
		await h.restart({ graceful: true, start: false });
		// A shutdown is not the card's failure: it stays queued.
		pin(
			h,
			"graceful stop while the pump starts scoping",
			task.taskId,
			{
				status: "pending_approval",
				error: "none",
				queued: "design",
				design: "designing",
				claim: false,
			},
			{ kind: "queued", waitingOn: "slot" },
			{ live: false },
		);
		await h.manager.start();
		await vi.waitFor(async () =>
			expect((await h.get(task.taskId)).factoryDesignProgress?.phase).toBe(
				"complete",
			),
		);
		expect((await h.get(task.taskId)).error).toBeUndefined();
	});

	it("resumes scoping after a Hub dies mid-scoping without cleanup", async () => {
		const h = await harness();
		h.setDesigner((sessionId) => h.hang(sessionId));
		await h.manager.start();
		const task = await h.create("Scoping death");
		await vi.waitFor(async () =>
			expect((await h.get(task.taskId)).factoryDesignProgress?.phase).toBe(
				"designing",
			),
		);
		await settle();
		// The dead Hub's designer never returns; nothing was cleaned up.
		h.setDesigner(undefined);
		await h.restart({ graceful: false, start: false });
		pin(
			h,
			"hard crash during scoping: before restart",
			task.taskId,
			{
				status: "pending_approval",
				error: "none",
				queued: "design",
				design: "designing",
				claim: false,
			},
			{ kind: "queued" },
			{ live: false },
		);
		await h.manager.start();
		await vi.waitFor(async () =>
			expect((await h.get(task.taskId)).factoryDesignProgress?.phase).toBe(
				"complete",
			),
		);
	});

	it("keeps a pending question across a Hub stop and asks it again", async () => {
		const h = await harness();
		h.setDesigner(async (sessionId, task) => {
			await h.manager.requestFactoryQuestion({
				taskId: task.taskId,
				sessionId,
				question: "Which page?",
			});
			return { status: "completed", summary: JSON.stringify(design()) };
		});
		await h.manager.start();
		const task = await h.create("Question crash");
		await vi.waitFor(async () =>
			expect((await h.get(task.taskId)).factoryQuestions?.[0]?.status).toBe(
				"pending",
			),
		);
		await h.restart({ graceful: true, start: false });
		pin(
			h,
			"graceful stop with a question pending",
			task.taskId,
			{
				status: "pending_approval",
				error: "none",
				queued: "design",
				design: "designing",
				claim: false,
			},
			{ kind: "scoping", waitingOn: "person", reasonCode: "question" },
			{ live: false },
		);
		await h.manager.start();
		await vi.waitFor(() =>
			expect(h.runtime.runDesignSession).toHaveBeenCalled(),
		);
		await settle();
		const after = await h.get(task.taskId);
		expect(after.factoryQuestions).toHaveLength(1);
		expect(after.factoryQuestions?.[0]?.status).toBe("pending");
	});

	it("marks a run interrupted and re-queues it when the Hub stops mid-run, then runs it again", async () => {
		const h = await harness();
		const runs = stubRuns(async (input, call) => {
			if (call === 0) return untilAborted(input);
			return { status: "completed", summary: "done" };
		});
		await h.manager.start();
		const task = await h.create("Run crash", {}, false);
		const { run } = await startRun(h, task);
		await settle();
		await h.restart({ graceful: true, start: false });
		pin(
			h,
			"graceful stop during a run",
			task.taskId,
			{
				status: "approved",
				error: "none",
				queued: "run",
				run: { status: "interrupted", phase: "implementing" },
				claim: false,
			},
			{ kind: "queued", waitingOn: "slot", reasonCode: "interrupted" },
			{ live: false },
		);
		expect(h.withStore((store) => store.getRun(run?.runId ?? ""))?.status).toBe(
			"interrupted",
		);
		await h.manager.start();
		await vi.waitFor(async () =>
			expect((await h.get(task.taskId)).status).toBe("completed"),
		);
		expect(runs).toHaveBeenCalledTimes(2);
	});

	it("leaves a dead Hub's run in progress until its claim lapses, then recovers it", async () => {
		const h = await harness();
		stubRuns(async (input, call) => {
			if (call === 0) return untilAborted(input);
			return untilAborted(input);
		});
		const task = await h.create("Run death", {}, false);
		const { run } = await startRun(h, task);
		await settle();
		h.manager.setFactoryPaused(true);
		await h.restart({ graceful: false, start: false });
		h.manager.setFactoryPaused(true);
		await h.manager.start();
		const { invariant } = pin(
			h,
			"hard crash during a run: restarted Hub before the claim lapses",
			task.taskId,
			{
				status: "in_progress",
				error: "none",
				run: { status: "running", phase: "implementing" },
				claim: true,
			},
			// CURRENT BEHAVIOUR, suspected bug: reads as running; nobody works it.
			{ kind: "running", waitingOn: "nobody" },
		);
		expect(invariant).toBe(false);
		// The claim lapses; the maintenance pass recovers the run.
		h.withStore((store) =>
			store.updateRun(run?.runId ?? "", {
				claimUntilAt: new Date(0).toISOString(),
			}),
		);
		(
			h.manager as unknown as {
				recoverInterruptedRuns(factoryOnly?: boolean): void;
			}
		).recoverInterruptedRuns(true);
		pin(
			h,
			"hard crash during a run: claim lapsed",
			task.taskId,
			{
				status: "approved",
				error: "none",
				queued: "run",
				run: { status: "interrupted", phase: "implementing" },
				claim: false,
			},
			{ kind: "queued", reasonCode: "factory_paused" },
		);
	});

	it("recovers a run created without its task write (between run creation's two writes)", async () => {
		const h = await harness();
		const task = await h.create("Half-created run", {}, false);
		const approved = await h.manager.approveTask(
			task.taskId,
			{ kind: "user" },
			task.revision,
		);
		// runTask's first write landed (the run row with a claim); the second
		// (task.currentRunId) did not. Both are synchronous in one tick, so a
		// Hub stop cannot fall between them; only a process death can.
		const orphan = h.withStore((store) =>
			store.createRun({
				taskId: task.taskId,
				taskRevision: approved.revision,
				claimToken: "dead-hub",
				claimUntilAt: new Date(0).toISOString(),
			}),
		);
		pin(
			h,
			"crash between run creation's writes: before restart",
			task.taskId,
			{
				status: "approved",
				error: "none",
				queued: "run",
				run: { status: "starting" },
				claim: true,
			},
			{ kind: "queued" },
			{ live: false },
		);
		h.manager.setFactoryPaused(true);
		await h.restart({ graceful: true, start: false });
		h.manager.setFactoryPaused(true);
		await h.manager.start();
		pin(
			h,
			"crash between run creation's writes: restarted",
			task.taskId,
			{
				status: "approved",
				error: "none",
				queued: "run",
				run: { status: "interrupted" },
				claim: false,
			},
			{ kind: "queued", reasonCode: "factory_paused" },
		);
		expect((await h.get(task.taskId)).lastRunId).toBe(orphan.runId);
	});

	it("re-queues a run stopped mid-publish and resumes it at publishing", async () => {
		const h = await harness();
		const phases: string[] = [];
		stubRuns(async (input, call) => {
			phases.push(input.state.phase);
			if (call === 0) {
				input.save({ ...input.state, phase: "publishing" });
				return untilAborted(input);
			}
			return { status: "completed", summary: "done" };
		});
		await h.manager.start();
		const task = await h.create("Publish crash", {}, false);
		await startRun(h, task);
		await vi.waitFor(() =>
			expect(h.manager.getTaskRuns(task.taskId)[0]?.factory?.phase).toBe(
				"publishing",
			),
		);
		await h.restart({ graceful: true, start: false });
		pin(
			h,
			"graceful stop during publish",
			task.taskId,
			{
				status: "approved",
				error: "none",
				queued: "run",
				run: { status: "interrupted", phase: "publishing" },
				claim: false,
			},
			{ kind: "queued", reasonCode: "interrupted" },
			{ live: false },
		);
		await h.manager.start();
		await vi.waitFor(async () =>
			expect((await h.get(task.taskId)).status).toBe("completed"),
		);
		expect(phases).toEqual(["implementing", "publishing"]);
	});
});

describe("restart", () => {
	it("resumes queued scoping, a queued run, live scoping and a live run after a Hub stop, within the working limit", async () => {
		const h = await harness({ concurrency: 2 });
		stubRuns(async (input, call) =>
			call === 0
				? untilAborted(input)
				: { status: "completed", summary: "done" },
		);
		h.setDesigner((sessionId) => h.hang(sessionId));
		await h.manager.start();
		// Two cards take both working slots...
		const scoping = await h.create("Mid-scoping");
		await vi.waitFor(async () =>
			expect((await h.get(scoping.taskId)).factoryDesignProgress?.phase).toBe(
				"designing",
			),
		);
		const running = await h.create("Mid-run", {}, false);
		await startRun(h, running);
		await settle();
		// ...so these two wait in the queue.
		const queuedScoping = await h.create("Queued for scoping");
		const queuedRun = await h.create("Queued run", {}, false);
		await h.manager.approveTask(
			queuedRun.taskId,
			{ kind: "user" },
			queuedRun.revision,
		);
		await settle();
		expect(h.manager.getFactoryQueueState().working).toHaveLength(2);
		expect((await h.get(queuedScoping.taskId)).factoryQueued).toBe("design");
		expect((await h.get(queuedRun.taskId)).factoryQueued).toBe("run");
		h.setDesigner(undefined);
		await h.restart({ graceful: true });
		// No person acts: every card moves on, two at a time.
		await vi.waitFor(
			async () => {
				for (const task of [scoping, queuedScoping])
					expect((await h.get(task.taskId)).factoryDesignProgress?.phase).toBe(
						"complete",
					);
				for (const task of [running, queuedRun])
					expect((await h.get(task.taskId)).status).toBe("completed");
			},
			{ timeout: 5000 },
		);
		for (const task of [scoping, queuedScoping, running, queuedRun])
			expect((await h.get(task.taskId)).error).toBeUndefined();
	});

	it("leaves held, cancelled and deliberately stopped cards exactly as they were across a restart", async () => {
		const h = await harness();
		const spend = {
			inputTokens: 1,
			outputTokens: 1,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 12,
		};
		stubRuns(async (input) => {
			switch (input.task.title) {
				case "Repair limit":
					input.save({
						...input.state,
						phase: "blocked",
						repairRound: 2,
						candidate: { commit: "abc", checks: [], reviews: [] },
						unresolvedFindings: { commit: "abc", findings: ["Redundant gate"] },
					});
					throw new FactoryDecisionError(
						"Repair limit (2) reached.\n- Reviewer 1: Redundant gate",
					);
				case "Publish":
					input.save({ ...input.state, phase: "publishing" });
					throw new FactoryPublishError(
						"Add an origin remote, then try again.",
					);
				case "Needs review":
					input.save({
						...input.state,
						phase: "ready",
						pullRequestUrl: "https://github.com/o/r/pull/7",
						candidate: { commit: "abc", checks: [], reviews: [] },
					});
					return { status: "completed", summary: "done" };
				default:
					input.save({
						...input.state,
						attempts: [
							{
								id: "s1",
								key: "build",
								role: "builder",
								repairRound: 0,
								createdAt: new Date().toISOString(),
								sessionId: "builder_1",
								instructions: "",
								agent: {},
								status: "failed",
								failure: "runtime",
								error: "boom",
								completedAt: new Date().toISOString(),
								usage: spend,
							},
						],
					});
					return { status: "failed", error: "Builder failed" };
			}
		});
		await h.manager.start();
		const held = await h.create("Held", {}, false);
		const cancelled = await h.create("Cancelled");
		await h.manager.cancelTask(
			cancelled.taskId,
			{ kind: "user" },
			cancelled.revision,
		);
		const planWaiting = await h.designed(
			await h.create(
				"Plan waits",
				{ approval: "automatic", agents: { reviewers: [{}] } },
				false,
			),
		);
		expect(planWaiting.error).toMatch(/^Automatic approval is waiting: /);
		const stopped: AgendaTaskRecord[] = [];
		for (const title of ["Repair limit", "Publish", "Needs review"]) {
			const task = await h.create(title, {}, false);
			const { run } = await startRun(h, task);
			await waitForRunEnd(h, task.taskId, run?.runId);
			stopped.push(task);
		}
		// Manual, so no automatic retry runs between the tries.
		const costly = await h.create(
			"Spend limit",
			{ autonomy: undefined, maxCostUsd: 10 },
			false,
		);
		const { run: costlyRun } = await startRun(h, costly);
		await waitForRunEnd(h, costly.taskId, costlyRun?.runId);
		await expect(
			h.manager.runTask(
				costly.taskId,
				{ kind: "user" },
				(await h.get(costly.taskId)).revision,
			),
		).rejects.toThrow("spending limit");
		const cards = [held, cancelled, planWaiting, ...stopped, costly];
		const snapshot = () =>
			h.withStore((store) =>
				cards.map((card) => ({
					task: store.getTask(card.taskId),
					runs: store.listRuns({ taskId: card.taskId, limit: 100 }),
				})),
			);
		const before = snapshot();
		expect(
			before.map(({ task }) => factoryErrorReasonCode(task?.error)),
		).toEqual([
			"none",
			"none",
			"plan_held",
			"repair_limit",
			"publish_failed",
			"none",
			"spend_limit",
		]);
		expect(before[5]?.task?.status).toBe("completed");
		await h.restart({ graceful: true });
		await settle();
		await h.manager.adoptFactoryBacklog();
		await settle();
		expect(snapshot()).toEqual(before);
		expect(h.runtime.startDesignSession).not.toHaveBeenCalled();
	});

	it("keeps queued work queued across a restart while Factory is paused", async () => {
		const h = await harness();
		h.manager.setFactoryPaused(true);
		await h.manager.start();
		const task = await h.create("Paused");
		await h.restart({ graceful: true, start: false });
		// As the Hub restores the stored pause before starting.
		h.manager.setFactoryPaused(true);
		await h.manager.start();
		await settle();
		pin(
			h,
			"restart while paused",
			task.taskId,
			{
				status: "pending_approval",
				error: "none",
				queued: "design",
				claim: false,
			},
			{ kind: "queued", reasonCode: "factory_paused" },
		);
		expect(h.runtime.startDesignSession).not.toHaveBeenCalled();
	});
});

describe("plan approval holds", () => {
	const objection = JSON.stringify({
		verdict: "changes_requested",
		findings: ["Enumerate the dead-code path"],
		summary: "Blocking",
	});
	/** Every Factory record of the card, to show nothing moved. */
	const records = (h: Harness, taskId: string) =>
		h.withStore((store) => ({
			task: store.getTask(taskId),
			runs: store.listRuns({ taskId, limit: 100 }),
			queued: store
				.listFactoryQueue()
				.filter((entry) => entry.taskId === taskId),
		}));
	/** A restart without a person leaves the waiting plan exactly as it was. */
	async function restartLeavesAlone(h: Harness, taskId: string) {
		const before = records(h, taskId);
		await h.restart({ graceful: true });
		await settle();
		expect(records(h, taskId)).toEqual(before);
		expect(h.runtime.startDesignSession).not.toHaveBeenCalled();
	}
	/** A person's approval queues the run (paused, so it stays visible). */
	async function personApprovalRuns(h: Harness, taskId: string) {
		h.manager.setFactoryPaused(true);
		const waiting = await h.get(taskId);
		await expect(
			h.manager.approveTask(taskId, { kind: "agent" }, waiting.revision),
		).rejects.toThrow(/^Automatic approval is waiting: /);
		await h.manager.approveTask(taskId, { kind: "user" }, waiting.revision);
		pin(
			h,
			`plan hold approved: ${taskId}`,
			taskId,
			{
				status: "approved",
				error: "none",
				queued: "run",
				design: "complete",
				claim: false,
			},
			{ kind: "queued", reasonCode: "factory_paused" },
		);
	}
	const waitingPlan = {
		status: "pending_approval",
		error: "plan_held",
		design: "complete",
		claim: false,
	} as const;
	const waitingCard = {
		kind: "awaiting_approval",
		waitingOn: "person",
		reasonCode: "plan_held",
	} as const;

	it("keeps the plan with its open findings at the plan repair limit, for a person to approve", async () => {
		const h = await harness({ approval: "automatic", planReviewers: 1 });
		h.setPlanReview(objection);
		const task = await h.designed(
			await h.create("Objections", { maxRepairRounds: 1 }, false),
		);
		const { task: waiting } = pin(
			h,
			"plan repair limit",
			task.taskId,
			waitingPlan,
			waitingCard,
		);
		expect(factoryPlanHoldReason(waiting.error)).toBe("open_findings");
		// The latest plan is the card's plan, readable and editable.
		expect(waiting.instructions).toBe("Proposed brief");
		expect(waiting.factory?.checks).toMatchObject([check]);
		// Its open findings, flat and per reviewer.
		expect(waiting.factoryDesignProgress?.findings).toEqual([
			"Plan reviewer 1: Enumerate the dead-code path",
		]);
		expect(waiting.factoryDesignReview).toMatchObject({
			revision: waiting.revision,
			reviews: [{ review: { verdict: "changes_requested" } }],
		});
		await restartLeavesAlone(h, task.taskId);
		await personApprovalRuns(h, task.taskId);
	});

	it("scopes a plan a person edited at the repair limit again, and holds the result for them", async () => {
		const h = await harness({ approval: "automatic", planReviewers: 1 });
		h.setPlanReview(objection);
		const task = await h.designed(
			await h.create("Edited at the limit", { maxRepairRounds: 1 }, false),
		);
		h.setPlanReview(pass);
		await h.manager.start();
		await h.manager.updateTask({
			taskId: task.taskId,
			expectedRevision: task.revision,
			instructions: "Proposed brief, with the dead-code path enumerated",
			updatedBy: { kind: "user" },
		});
		expect((await h.get(task.taskId)).factoryQueued).toBe("design");
		await vi.waitFor(async () =>
			expect(factoryPlanHoldReason((await h.get(task.taskId)).error)).toBe(
				"changed_by_you",
			),
		);
		await settle();
		const { task: waiting } = pin(
			h,
			"plan changed by a person",
			task.taskId,
			waitingPlan,
			waitingCard,
		);
		expect(waiting.factory?.changedByPerson).toBe(true);
		expect(waiting.factoryDesignProgress?.findings).toEqual([]);
		await restartLeavesAlone(h, task.taskId);
		await personApprovalRuns(h, task.taskId);
	});

	it("approves automatically when the person only wrote the request before scoping", async () => {
		const h = await harness({ approval: "automatic" });
		h.manager.setFactoryPaused(true);
		const created = await h.create("Written first", {}, false);
		const edited = await h.manager.updateTask({
			taskId: created.taskId,
			expectedRevision: created.revision,
			instructions: "The request, reworded before scoping",
			updatedBy: { kind: "user" },
		});
		expect(edited.factory?.changedByPerson).toBeUndefined();
		await h.designed(edited);
		pin(
			h,
			"edit before scoping",
			created.taskId,
			{
				status: "approved",
				error: "none",
				queued: "run",
				design: "complete",
				claim: false,
			},
			{ kind: "queued", reasonCode: "factory_paused" },
		);
	});

	const adaptive = {
		reviewMode: "adaptive",
		agents: {
			planReviewers: [{}],
			reviewers: [
				{ modelSelection: independentModel },
				{ modelSelection: independentModel },
			],
		},
	};
	const selection = (size: "local" | "shared_contract") => ({
		impact: size,
		size,
		rationale: "Rated by the designer",
		affectedPaths: ["src/feature.ts"],
		consumers: ["the feature"],
		planReviewerIndices: size === "local" ? [] : [0],
		reviewerIndices: size === "local" ? [0] : [0, 1],
	});

	it("holds a large plan for a person and approves a local one automatically", async () => {
		const h = await harness({ approval: "automatic" });
		h.manager.setFactoryPaused(true);
		h.setDesigner((_sessionId, task) => ({
			status: "completed",
			summary: JSON.stringify(
				design({
					reviewSelection: selection(
						task.title === "Large" ? "shared_contract" : "local",
					),
				}),
			),
		}));
		const large = await h.designed(await h.create("Large", adaptive, false));
		const { task: waiting } = pin(
			h,
			"large plan",
			large.taskId,
			waitingPlan,
			waitingCard,
		);
		expect(factoryPlanHoldReason(waiting.error)).toBe("large_change");
		expect(waiting.error).toBe(
			"Automatic approval is waiting: Large change: plan needs your approval",
		);
		const local = await h.designed(await h.create("Local", adaptive, false));
		pin(
			h,
			"local plan",
			local.taskId,
			{
				status: "approved",
				error: "none",
				queued: "run",
				design: "complete",
				claim: false,
			},
			{ kind: "queued", reasonCode: "factory_paused" },
		);
		h.setDesigner(undefined);
		await h.restart({ graceful: true, start: false });
		h.manager.setFactoryPaused(true);
		await h.manager.start();
		await settle();
		expect(records(h, large.taskId).task).toEqual(waiting);
		await personApprovalRuns(h, large.taskId);
	});
});
