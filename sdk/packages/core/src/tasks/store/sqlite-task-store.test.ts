import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
	AgendaTaskActor,
	AgendaTaskCreateInput,
	FactoryDesignReview,
	FactoryQuestion,
} from "@cline/shared";
import {
	factoryDesignProgressSchema,
	factoryReviewFindings,
	factoryRunStateSchema,
	factoryTaskConfigSchema,
} from "@cline/shared";
import { loadSqliteDb, nowIso } from "@cline/shared/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	AgendaTaskRevisionConflictError,
	SqliteAgendaTaskStore,
} from "./sqlite-task-store";

const USER: AgendaTaskActor = { kind: "user", id: "user-1" };
const AGENT: AgendaTaskActor = {
	kind: "agent",
	id: "agent-1",
	sessionId: "origin-session",
};
const WORKSPACE_ROOT = resolve("/workspace");
const OTHER_WORKSPACE_ROOT = resolve("/other-workspace");

describe("SqliteAgendaTaskStore", () => {
	let directory: string;
	let store: SqliteAgendaTaskStore;

	beforeEach(() => {
		directory = mkdtempSync(join(tmpdir(), "cline-task-store-"));
		store = new SqliteAgendaTaskStore({
			dbPath: join(directory, "tasks.db"),
		});
	});

	afterEach(() => {
		store.close();
		rmSync(directory, { recursive: true, force: true });
	});

	function createInput(
		taskId: string,
		priority: 0 | 1 | 2 | 3 | 4 | 5 = 3,
	): AgendaTaskCreateInput {
		return {
			taskId,
			type: "todo",
			title: `Task ${taskId}`,
			instructions: "Complete the task.",
			scope: "workspace",
			workspaceRoot: WORKSPACE_ROOT,
			resourcePaths: ["src/index.ts", "src/index.ts"],
			priority,
			availableAt: "2035-01-01T00:00:00.000Z",
			expiresAt: "2035-01-10T00:00:00.000Z",
			createdBy: AGENT,
			specPath: join(WORKSPACE_ROOT, ".cline", "tasks", `${taskId}.task.md`),
		};
	}

	it("advances design queue revision with the proposed brief and preserves it after reopening", () => {
		const task = store.createTask(
			{
				...createInput("design-revision"),
				factory: factoryTaskConfigSchema.parse({}),
			},
			true,
		);
		const progress = factoryDesignProgressSchema.parse({
			phase: "reviewing",
			revision: task.revision + 1,
			repairRound: 1,
			agents: {},
			designerSessionId: "designer",
			findings: [],
			reviewerSessions: [{ reviewerIndex: 0, sessionId: "reviewer" }],
			reviews: [],
		});
		const input = {
			taskId: task.taskId,
			expectedRevision: task.revision,
			instructions: "Proposed brief",
			updatedBy: USER,
		};
		const db = loadSqliteDb(join(directory, "tasks.db"));
		try {
			db.exec(
				"CREATE TRIGGER reject_design_revision BEFORE UPDATE ON factory_queue BEGIN SELECT RAISE(ABORT, 'queue update unavailable'); END;",
			);
			expect(() => store.updateTask(input, progress)).toThrow(
				"queue update unavailable",
			);
			expect(store.getTask(task.taskId)?.revision).toBe(task.revision);
			expect(store.getTask(task.taskId)?.factoryDesignProgress).toBeUndefined();
			db.exec("DROP TRIGGER reject_design_revision;");
		} finally {
			db.close?.();
		}
		store.updateTask(input, progress);
		store.close();
		store = new SqliteAgendaTaskStore({ dbPath: join(directory, "tasks.db") });
		expect(store.getTask(task.taskId)?.factoryDesignProgress).toEqual(progress);
		expect(store.listFactoryQueue()).toMatchObject([
			{
				taskId: task.taskId,
				expectedRevision: progress.revision,
				stage: "design",
			},
		]);
		const edited = store.updateTask({
			...input,
			expectedRevision: progress.revision,
			instructions: "User changed scope",
		});
		expect(edited?.factoryDesignProgress).toBeUndefined();
		expect(store.listFactoryQueue()[0]?.expectedRevision).toBe(
			progress.revision,
		);
		expect(edited?.revision).toBe(progress.revision + 1);
	});

	it("commits an answer with its resume intent and rolls both back if queue persistence fails", () => {
		const initial = store.createTask({
			...createInput("question"),
			factory: factoryTaskConfigSchema.parse({}),
		});
		const pending: FactoryQuestion = {
			questionId: "decision",
			revision: initial.revision,
			sessionId: "designer",
			question: "Which behavior?",
			options: ["Explain"],
			createdAt: "2035-01-01T00:00:00.000Z",
			status: "pending",
		};
		const task = store.updateTaskState(initial.taskId, {
			factoryQuestions: [pending],
		});
		if (!task) throw new Error("Task missing");
		const answered: FactoryQuestion = {
			...pending,
			status: "answered",
			answer: "Explain",
			answeredAt: "2035-01-01T00:00:01.000Z",
		};
		const db = loadSqliteDb(join(directory, "tasks.db"));
		try {
			db.exec(
				"CREATE TRIGGER reject_resume BEFORE INSERT ON factory_queue BEGIN SELECT RAISE(ABORT, 'queue unavailable'); END;",
			);
			expect(() => store.saveFactoryAnswer(task, [answered], USER)).toThrow(
				"queue unavailable",
			);
			expect(store.getTask(task.taskId)?.factoryQuestions).toEqual([pending]);
			expect(store.listFactoryQueue()).toEqual([]);
			db.exec("DROP TRIGGER reject_resume;");
		} finally {
			db.close?.();
		}
		store.saveFactoryAnswer(task, [answered], USER);
		store.close();
		store = new SqliteAgendaTaskStore({ dbPath: join(directory, "tasks.db") });
		const restored = store.getTask(task.taskId);
		expect(restored?.factoryQuestions).toEqual([answered]);
		expect(store.listFactoryQueue()).toMatchObject([
			{ taskId: task.taskId, expectedRevision: task.revision, stage: "design" },
		]);
		if (!restored) throw new Error("Task missing");
		store.dequeueFactory(task.taskId);
		store.saveFactoryAnswer(restored, [answered], USER);
		expect(store.listFactoryQueue()).toHaveLength(1);
		store.updateTaskState(task.taskId, { status: "cancelled" });
		expect(() => store.saveFactoryAnswer(restored, [answered], USER)).toThrow(
			"Factory question changed",
		);
	});

	it("finds an imported issue by exact workspace and identity beyond list limits", () => {
		const source = {
			provider: "github" as const,
			id: "I_source",
			url: "https://github.com/example/repo/issues/1",
		};
		const factory = factoryTaskConfigSchema.parse({ sourceIssue: source });
		store.createTask({
			...createInput("global"),
			scope: "global",
			workspaceRoot: undefined,
			resourcePaths: [],
			factory,
		});
		store.createTask({ ...createInput("target", 5), factory });
		for (let i = 0; i < 1001; i++)
			store.createTask(createInput(`unrelated_${i}`, 0));
		expect(
			store.findTaskBySourceIssue({
				scope: "workspace",
				workspaceRoot: WORKSPACE_ROOT,
				source,
			})?.taskId,
		).toBe("target");
		expect(
			store.findTaskBySourceIssue({
				scope: "workspace",
				workspaceRoot: OTHER_WORKSPACE_ROOT,
				source,
			}),
		).toBeUndefined();
		expect(
			store.findTaskBySourceIssue({ scope: "global", source })?.taskId,
		).toBe("global");
	});

	it("numbers Factory cards in order and never reuses a number", () => {
		const factory = factoryTaskConfigSchema.parse({});
		const first = store.createTask({ ...createInput("first"), factory });
		const second = store.createTask(
			{ ...createInput("second"), factory },
			true,
		);
		const plain = store.createTask(createInput("plain"));
		expect([first.factoryNumber, second.factoryNumber]).toEqual([1, 2]);
		expect(plain.factoryNumber).toBeUndefined();
		store.updateTaskState(second.taskId, { archivedAt: nowIso() });
		expect(store.getTask(second.taskId)?.factoryNumber).toBe(2);
		expect(store.deleteTask(second.taskId)).toBe(true);
		const third = store.createTask({ ...createInput("third"), factory });
		expect(third.factoryNumber).toBe(3);
		// A card that becomes a Factory card takes the next number then.
		const promoted = store.updateTask({
			taskId: plain.taskId,
			expectedRevision: plain.revision,
			factory,
			updatedBy: USER,
		});
		expect(promoted?.factoryNumber).toBe(4);
		expect(store.getTaskByFactoryNumber(3)?.taskId).toBe(third.taskId);
		expect(store.getTaskByFactoryNumber(2)).toBeUndefined();
		// Numbers survive reopening, and the counter remembers deleted ones.
		store.close();
		store = new SqliteAgendaTaskStore({ dbPath: join(directory, "tasks.db") });
		expect(store.getTask(first.taskId)?.factoryNumber).toBe(1);
		store.deleteTask(promoted?.taskId ?? "");
		expect(
			store.createTask({ ...createInput("fifth"), factory }).factoryNumber,
		).toBe(5);
	});

	it("numbers existing Factory cards in creation order once, including cards an older Hub adds later", () => {
		const factory = factoryTaskConfigSchema.parse({});
		const created = ["late", "early", "middle"].map((id) =>
			store.createTask({ ...createInput(id), factory }),
		);
		const replay = store.createTask({
			...createInput("replay"),
			factory: factoryTaskConfigSchema.parse({
				replay: {
					comparisonId: "cmp",
					variantIndex: 0,
					requestHash: "a".repeat(64),
					sourceTaskId: "late",
					sourceRunId: "run_x",
					sourceTaskRevision: 1,
					baseCommit: "abc",
					baseBranch: "main",
					label: "baseline",
				},
			}),
		});
		store.createTask(createInput("plain"));
		const dbPath = join(directory, "tasks.db");
		store.close();
		// A database from before short ids: no number column, index or counter,
		// and creation times that differ from insertion order.
		const oldDb = loadSqliteDb(dbPath);
		try {
			oldDb.exec("DROP INDEX agenda_tasks_factory_number_idx");
			oldDb.exec("DROP INDEX agenda_tasks_factory_unnumbered_idx");
			oldDb.exec("ALTER TABLE agenda_tasks DROP COLUMN factory_number");
			oldDb.exec("DROP TABLE factory_counter");
			const at = oldDb.prepare(
				"UPDATE agenda_tasks SET created_at = ? WHERE task_id = ?",
			);
			at.run("2030-01-03T00:00:00.000Z", "late");
			at.run("2030-01-01T00:00:00.000Z", "early");
			at.run("2030-01-02T00:00:00.000Z", "middle");
			at.run("2030-01-04T00:00:00.000Z", "replay");
		} finally {
			oldDb.close?.();
		}
		store = new SqliteAgendaTaskStore({ dbPath });
		const numbers = () =>
			Object.fromEntries(
				store
					.listTasks({ includeArchived: true })
					.map((task) => [task.taskId, task.factoryNumber]),
			);
		expect(numbers()).toEqual({
			early: 1,
			middle: 2,
			late: 3,
			replay: 4,
			plain: undefined,
		});
		expect(created).toHaveLength(3);
		expect(replay.factory?.replay).toBeDefined();
		// Idempotent: reopening renumbers nothing.
		store.close();
		store = new SqliteAgendaTaskStore({ dbPath });
		expect(numbers()).toMatchObject({
			early: 1,
			middle: 2,
			late: 3,
			replay: 4,
		});
		// A card an older Hub inserts without a number is numbered on the next
		// open, after the counter, even when the newest numbered card is gone.
		store.deleteTask("replay");
		store.close();
		const olderHub = loadSqliteDb(dbPath);
		try {
			olderHub
				.prepare(
					`INSERT INTO agenda_tasks (task_id, type, status, title, instructions, scope,
					workspace_root, available_at, expires_at, created_by_json, updated_by_json,
					created_at, updated_at, factory_json)
					VALUES ('older', 'todo', 'pending_approval', 'Older', 'Do it', 'workspace',
					?, '2035-01-01T00:00:00.000Z', '2035-01-10T00:00:00.000Z', '{}', '{}',
					'2030-01-05T00:00:00.000Z', '2030-01-05T00:00:00.000Z', '{}')`,
				)
				.run(WORKSPACE_ROOT);
		} finally {
			olderHub.close?.();
		}
		store = new SqliteAgendaTaskStore({ dbPath });
		expect(store.getTask("older")?.factoryNumber).toBe(5);
	});

	it("creates, reads, updates, and deletes a task", () => {
		const created = store.createTask(createInput("task_crud", 2));
		expect(created).toMatchObject({
			taskId: "task_crud",
			status: "pending_approval",
			priority: 2,
			revision: 1,
			resourcePaths: [join("src", "index.ts")],
			createdBy: AGENT,
		});
		expect(store.getTaskBySpecPath(created.specPath ?? "")).toEqual(created);

		const approved = store.updateTaskState(
			created.taskId,
			{
				status: "approved",
				approvedRevision: 1,
				updatedBy: USER,
			},
			1,
		);
		expect(approved).toMatchObject({ status: "approved", approvedRevision: 1 });

		const updated = store.updateTask({
			taskId: created.taskId,
			expectedRevision: 1,
			title: "Updated title",
			priority: 0,
			updatedBy: USER,
		});
		expect(updated).toMatchObject({
			title: "Updated title",
			priority: 0,
			revision: 2,
			status: "pending_approval",
		});
		expect(updated?.approvedRevision).toBeUndefined();

		expect(() =>
			store.updateTask({
				taskId: created.taskId,
				expectedRevision: 1,
				title: "Stale",
				updatedBy: USER,
			}),
		).toThrow(AgendaTaskRevisionConflictError);
		expect(store.deleteTask(created.taskId)).toBe(true);
		expect(store.getTask(created.taskId)).toBeUndefined();
	});

	it("persists queued work and fences completion after another owner claims an expired run", () => {
		const task = store.createTask(createInput("recovery"));
		store.updateTaskState(task.taskId, {
			status: "approved",
			approvedRevision: task.revision,
		});
		store.enqueueFactory({
			taskId: task.taskId,
			expectedRevision: task.revision,
			actor: USER,
		});
		store.enqueueFactory({
			taskId: task.taskId,
			expectedRevision: task.revision,
			actor: USER,
		});
		const run = store.createRun({
			taskId: task.taskId,
			taskRevision: task.revision,
			claimToken: "old",
			claimUntilAt: "2000-01-01T00:00:00.000Z",
		});
		store.updateTaskState(task.taskId, {
			status: "in_progress",
			currentRunId: run.runId,
			lastRunId: run.runId,
		});
		store.close();
		store = new SqliteAgendaTaskStore({ dbPath: join(directory, "tasks.db") });
		expect(store.listFactoryQueue()).toMatchObject([
			{ taskId: task.taskId, expectedRevision: task.revision },
		]);
		const until = new Date(Date.now() + 60_000).toISOString();
		expect(store.claimRun(run.runId, "new", until)?.claimToken).toBe("new");
		expect(store.claimRun(run.runId, "old", until)).toBeUndefined();
		expect(() =>
			store.finishFactoryRun(
				run.runId,
				"old",
				{ status: "completed" },
				{ status: "completed", currentRunId: null },
			),
		).toThrow("ownership was lost");
		expect(store.getTask(task.taskId)?.status).toBe("in_progress");
		const completed = store.finishFactoryRun(
			run.runId,
			"new",
			{ status: "completed", claimToken: null, claimUntilAt: null },
			{ status: "completed", currentRunId: null },
		);
		expect(completed.task.status).toBe("completed");
		expect(completed.run.claimToken).toBeUndefined();
		store.dequeueFactory(task.taskId);
		expect(store.listFactoryQueue()).toEqual([]);
	});

	it("rejects stale approval and sampling writes while preserving a current follow-up owner", () => {
		const task = store.createTask({
			...createInput("outcome"),
			factory: factoryTaskConfigSchema.parse({}),
		});
		const run = store.createRun({
			taskId: task.taskId,
			taskRevision: task.revision,
			claimToken: "worker",
			claimUntilAt: new Date(Date.now() + 60_000).toISOString(),
		});
		store.updateTaskState(task.taskId, {
			status: "in_progress",
			approvedRevision: task.revision,
			currentRunId: run.runId,
			lastRunId: run.runId,
		});
		const factory = factoryRunStateSchema.parse({
			phase: "ready",
			repairRound: 0,
			workspace: {
				path: "/workspace/outcome",
				branch: "feat/outcome",
				baseBranch: "main",
				baseCommit: "base",
			},
			sessions: [],
			candidate: { commit: "candidate", checks: [], reviews: [] },
		});
		const completed = store.finishFactoryRun(
			run.runId,
			"worker",
			{ status: "completed", claimToken: null, claimUntilAt: null, factory },
			{ status: "completed", currentRunId: null },
		);
		const sampled = store.updateFactoryOutcome(completed.task, completed.run, {
			...factory,
			phase: "blocked",
			audit: {
				selectedAt: new Date().toISOString(),
				finding: "Missing empty-input handling",
			},
		});
		expect(() =>
			store.updateFactoryOutcome(completed.task, completed.run, {
				...factory,
				humanApproval: {
					commit: "candidate",
					approvedAt: new Date().toISOString(),
				},
			}),
		).toThrow("outcome changed");
		expect(store.getRun(run.runId)?.factory?.audit?.finding).toBe(
			"Missing empty-input handling",
		);
		const claimed = store.claimRun(
			run.runId,
			"followup",
			new Date(Date.now() + 60_000).toISOString(),
		);
		expect(claimed?.claimToken).toBe("followup");
		expect(() =>
			store.updateFactoryOutcome(completed.task, sampled, {
				...factory,
				audit: { selectedAt: new Date().toISOString(), finding: "" },
			}),
		).toThrow("outcome changed");
		expect(store.getRun(run.runId)).toMatchObject({
			claimToken: "followup",
			factory: { audit: { finding: "Missing empty-input handling" } },
		});
		store.updateRun(
			run.runId,
			{ claimToken: null, claimUntilAt: null },
			"followup",
		);
		const current = store.getRun(run.runId);
		if (!current?.factory) throw new Error("Missing outcome");
		expect(
			store.updateFactoryOutcome(completed.task, current, {
				...current.factory,
				audit: {
					selectedAt: new Date().toISOString(),
					finding: "",
					reviewedAt: new Date().toISOString(),
				},
			}).factory?.audit?.finding,
		).toBe("");
	});

	it("migrates existing tasks and preserves factory intent and evidence across reopen", () => {
		const oldTask = store.createTask(createInput("existing"));
		const dbPath = join(directory, "tasks.db");
		const oldDb = loadSqliteDb(dbPath);
		try {
			// Older schemas had neither factory_json nor its expression indexes.
			for (const index of [
				"agenda_tasks_factory_intake_idx",
				"agenda_tasks_factory_replay_run_idx",
				"agenda_tasks_factory_comparison_idx",
				"agenda_tasks_factory_number_idx",
				"agenda_tasks_factory_unnumbered_idx",
			])
				oldDb.exec(`DROP INDEX ${index}`);
			oldDb.exec("ALTER TABLE agenda_tasks DROP COLUMN factory_json");
			oldDb.exec(
				"ALTER TABLE agenda_tasks DROP COLUMN factory_design_review_json",
			);
			oldDb.exec("ALTER TABLE agenda_task_runs DROP COLUMN factory_json");
		} finally {
			oldDb.close?.();
		}
		store.close();
		store = new SqliteAgendaTaskStore({ dbPath });
		expect(store.getTask(oldTask.taskId)).toEqual(oldTask);
		const factory = factoryTaskConfigSchema.parse({
			checks: [{ name: "API", command: "bun test", kind: "api" }],
		});
		const task = store.createTask({
			...createInput("feature"),
			factory,
			requiresApproval: false,
		});
		const run = store.createRun({
			taskId: task.taskId,
			taskRevision: task.revision,
		});
		const legacyFactory = {
			phase: "verifying",
			repairRound: 1,
			workspace: {
				path: "/workspace/feature",
				branch: "feat/feature",
				baseBranch: "main",
				baseCommit: "base",
			},
			sessions: [
				{ sessionId: "builder", role: "builder" },
				{ sessionId: "reviewer", role: "reviewer" },
			],
			candidateCommit: "candidate",
			checks: [
				{
					name: "API",
					kind: "api",
					command: "bun test",
					status: "passed",
					exitCode: 0,
					output: "passed",
					artifacts: [],
				},
			],
			review: {
				verdict: "pass",
				summary: "Reviewed",
				findings: [],
				coverage: {
					static: ["API"],
					exercised: [],
					unverified: ["Legacy required behavior"],
				},
			},
		};
		store.updateTaskState(task.taskId, { originSessionId: "design" });
		const legacyDb = loadSqliteDb(dbPath);
		try {
			legacyDb
				.prepare(
					"UPDATE agenda_task_runs SET factory_json = ? WHERE run_id = ?",
				)
				.run(JSON.stringify(legacyFactory), run.runId);
		} finally {
			legacyDb.close?.();
		}
		store.close();
		store = new SqliteAgendaTaskStore({ dbPath });
		expect(store.getTask(task.taskId)).toMatchObject({
			factory,
			originSessionId: "design",
			approvedRevision: 1,
		});
		expect(store.getRun(run.runId)?.factory).toMatchObject({
			phase: "verifying",
			repairRound: 1,
			candidate: {
				commit: "candidate",
				checks: legacyFactory.checks,
				reviews: [
					{
						reviewerIndex: 0,
						sessionId: "reviewer",
						review: {
							...legacyFactory.review,
							coverage: {
								static: ["API"],
								exercised: [],
								requiredGaps: ["Legacy required behavior"],
								limitations: [],
							},
						},
					},
				],
			},
		});
		expect(store.getRun(run.runId)?.factory).not.toHaveProperty(
			"candidateCommit",
		);
		const restoredFactory = store.getRun(run.runId)?.factory;
		const restoredReview = restoredFactory?.candidate?.reviews[0]?.review;
		if (!restoredReview) throw new Error("Missing persisted review");
		expect(factoryReviewFindings(restoredReview)).toEqual([
			"Unverified: Legacy required behavior",
		]);
		store.updateRun(run.runId, { factory: restoredFactory });
		store.close();
		store = new SqliteAgendaTaskStore({ dbPath });
		expect(store.getRun(run.runId)?.factory).toEqual(restoredFactory);
		const edited = store.updateTask({
			taskId: task.taskId,
			expectedRevision: 1,
			factory: { ...factory, maxRepairRounds: 0 },
			updatedBy: USER,
		});
		expect(edited).toMatchObject({
			status: "pending_approval",
			revision: 2,
			factory: { maxRepairRounds: 0 },
		});
		expect(edited?.approvedRevision).toBeUndefined();
	});

	it("persists design reviews for their revision and rejects stale review completion after an edit", () => {
		const task = store.createTask({
			...createInput("design-review"),
			factory: factoryTaskConfigSchema.parse({}),
		});
		const review: FactoryDesignReview = {
			revision: task.revision,
			reviews: [
				{
					reviewerIndex: 0,
					sessionId: "plan-review",
					review: {
						verdict: "pass",
						summary: "The plan covers the requirement.",
						findings: [],
						coverage: {
							static: ["Plan"],
							exercised: [],
							requiredGaps: ["Implementation"],
							limitations: [],
						},
					},
				},
			],
		};
		store.updateTaskState(
			task.taskId,
			{ factoryDesignReview: review },
			task.revision,
		);
		store.updateTaskState(
			task.taskId,
			{ originSessionId: "designer" },
			task.revision,
		);
		store.close();
		store = new SqliteAgendaTaskStore({ dbPath: join(directory, "tasks.db") });
		expect(store.getTask(task.taskId)?.factoryDesignReview).toEqual(review);
		const edited = store.updateTask({
			taskId: task.taskId,
			expectedRevision: task.revision,
			instructions: "Revise the requirement.",
			updatedBy: USER,
		});
		expect(edited?.factoryDesignReview).toBeUndefined();
		expect(() =>
			store.updateTaskState(
				task.taskId,
				{ factoryDesignReview: review },
				task.revision,
			),
		).toThrow(AgendaTaskRevisionConflictError);
		store.close();
		store = new SqliteAgendaTaskStore({ dbPath: join(directory, "tasks.db") });
		expect(store.getTask(task.taskId)?.factoryDesignReview).toBeUndefined();
		expect(store.getTask(task.taskId)?.instructions).toBe(
			"Revise the requirement.",
		);
	});

	it("auto-approves user-authored tasks but keeps agent suggestions pending", () => {
		const userTask = store.createTask({
			...createInput("user-authored"),
			createdBy: USER,
			requiresApproval: false,
		});
		const agentSuggestion = store.createTask(createInput("agent-suggestion"));

		expect(userTask).toMatchObject({
			status: "approved",
			approvedRevision: 1,
			createdBy: USER,
		});
		expect(agentSuggestion).toMatchObject({
			status: "pending_approval",
			createdBy: AGENT,
		});
		expect(agentSuggestion.approvedRevision).toBeUndefined();
	});

	it("orders ready work P0 first and applies workspace-view scope semantics", () => {
		store.createTask(createInput("p4", 4));
		store.createTask(createInput("p0", 0));
		store.createTask(createInput("p2", 2));
		store.createTask({
			...createInput("other-workspace", 1),
			workspaceRoot: OTHER_WORKSPACE_ROOT,
			specPath: join(
				OTHER_WORKSPACE_ROOT,
				".cline",
				"tasks",
				"other-workspace.task.md",
			),
		});
		store.createTask({
			...createInput("global-p0", 0),
			scope: "global",
			workspaceRoot: undefined,
			resourcePaths: [],
			availableAt: "2034-12-31T00:00:00.000Z",
			specPath: "/global/global-p0.task.md",
		});

		expect(store.listTasks().map((task) => task.taskId)).toEqual([
			"global-p0",
			"p0",
			"other-workspace",
			"p2",
			"p4",
		]);
		expect(
			store
				.listTasks({ workspaceRoot: WORKSPACE_ROOT })
				.map((task) => task.taskId),
		).toEqual(["global-p0", "p0", "p2", "p4"]);
		expect(
			store
				.listTasks({
					statuses: ["pending_approval"],
					scope: "workspace",
					workspaceRoot: WORKSPACE_ROOT,
				})
				.map((task) => task.taskId),
		).toEqual(["p0", "p2", "p4"]);
		expect(
			store
				.listTasks({ scope: "global", workspaceRoot: WORKSPACE_ROOT })
				.map((task) => task.taskId),
		).toEqual(["global-p0"]);
	});

	it("lists newest source replays before applying the limit without changing queue order", () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		try {
			for (const [index, taskId] of ["older", "newer"].entries()) {
				vi.setSystemTime(new Date(`2030-01-0${index + 1}T00:00:00Z`));
				store.createTask({
					...createInput(taskId, index === 0 ? 0 : 5),
					factory: factoryTaskConfigSchema.parse({
						replay: {
							comparisonId: `comparison_${index}`,
							variantIndex: 0,
							requestHash: "a".repeat(64),
							sourceTaskId: "source",
							sourceRunId: "source_run",
							sourceTaskRevision: 1,
							baseCommit: "b".repeat(40),
							baseBranch: "main",
							label: taskId,
						},
					}),
				});
			}
			expect(
				store
					.listTasks({ factoryReplaySourceRunId: "source_run", limit: 1 })
					.map((task) => task.taskId),
			).toEqual(["newer"]);
			expect(store.listTasks({ limit: 1 }).map((task) => task.taskId)).toEqual([
				"older",
			]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("lists distinct canonical workspace roots including archived tasks", () => {
		store.createTask(createInput("workspace-active"));
		const canonicalOther = resolve(directory, "other-workspace");
		const archived = store.createTask({
			...createInput("workspace-archived"),
			workspaceRoot: join(canonicalOther, "nested", ".."),
			specPath: join(
				canonicalOther,
				".cline",
				"tasks",
				"workspace-archived.task.md",
			),
		});
		store.createTask({
			...createInput("workspace-duplicate"),
			workspaceRoot: canonicalOther,
			specPath: join(
				canonicalOther,
				".cline",
				"tasks",
				"workspace-duplicate.task.md",
			),
		});
		store.updateTaskState(archived.taskId, {
			archivedAt: "2035-01-02T00:00:00.000Z",
		});

		expect(store.listWorkspaceRoots()).toEqual(
			[WORKSPACE_ROOT, canonicalOther].sort((left, right) =>
				left.localeCompare(right),
			),
		);
	});

	it("persists run attempts and prevents two active runs for one task", () => {
		const task = store.createTask(createInput("task_runs"));
		const first = store.createRun({
			taskId: task.taskId,
			taskRevision: task.revision,
			claimToken: "claim-1",
		});
		expect(first).toMatchObject({ attempt: 1, status: "starting" });
		expect(() =>
			store.createRun({
				taskId: task.taskId,
				taskRevision: task.revision,
			}),
		).toThrow();

		store.updateRun(first.runId, {
			status: "completed",
			sessionId: "session-1",
			completedAt: "2035-01-02T00:00:00.000Z",
		});
		const second = store.createRun({
			taskId: task.taskId,
			taskRevision: task.revision,
		});
		expect(second.attempt).toBe(2);
		expect(store.listRuns({ taskId: task.taskId })).toHaveLength(2);
	});

	it("provides and updates the global automation policy", () => {
		expect(store.getAutomationPolicy()).toMatchObject({
			scopeKey: "global",
			mode: "manual",
			maxConcurrentRuns: 2,
		});

		const policy = store.setAutomationPolicy({
			scopeKey: "global",
			mode: "unattended",
			applyToAgentCreated: true,
			maxConcurrentRuns: 3,
			maxChainDepth: 2,
			maxStartsPerHour: 30,
			enabledBy: USER,
			enabledAt: "2035-01-01T00:00:00.000Z",
		});
		expect(policy).toMatchObject({
			mode: "unattended",
			maxConcurrentRuns: 3,
			enabledBy: USER,
		});
	});
});
