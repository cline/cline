import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgendaTaskActor, AgendaTaskCreateInput } from "@cline/shared";
import { factoryTaskConfigSchema } from "@cline/shared";
import { loadSqliteDb } from "@cline/shared/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

	it("migrates existing tasks and preserves factory intent and evidence across reopen", () => {
		const oldTask = store.createTask(createInput("existing"));
		store.close();
		const dbPath = join(directory, "tasks.db");
		const oldDb = loadSqliteDb(dbPath);
		oldDb.exec("ALTER TABLE agenda_tasks DROP COLUMN factory_json");
		oldDb.exec("ALTER TABLE agenda_task_runs DROP COLUMN factory_json");
		oldDb.close?.();
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
		store.updateRun(run.runId, {
			factory: {
				phase: "verifying",
				repairRound: 1,
				workspace: {
					path: "/workspace/feature",
					branch: "feat/feature",
					baseBranch: "main",
					baseCommit: "base",
				},
				sessions: [{ sessionId: "builder", role: "builder" }],
				candidateCommit: "candidate",
				checks: [],
			},
		});
		store.updateTaskState(task.taskId, { originSessionId: "design" });
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
			candidateCommit: "candidate",
		});
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
