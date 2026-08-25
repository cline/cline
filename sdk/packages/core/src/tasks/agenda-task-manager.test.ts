import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	renameSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgendaTaskRecord } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	AgendaTaskManager,
	type AgendaTaskRuntime,
} from "./agenda-task-manager";
import { AgendaTaskSpecFileStore } from "./specs/task-spec-file-store";
import { SqliteAgendaTaskStore } from "./store/sqlite-task-store";

const managers: AgendaTaskManager[] = [];

afterEach(async () => {
	await Promise.all(managers.splice(0).map((manager) => manager.dispose()));
});

function future(days = 7): string {
	return new Date(Date.now() + days * 86_400_000).toISOString();
}

function createHarness(
	result: "completed" | "failed" = "completed",
	options: {
		interactiveClientAvailable?: boolean;
		automationEnabled?: boolean;
	} = {},
) {
	const root = mkdtempSync(join(tmpdir(), "cline-agenda-manager-"));
	const events: string[] = [];
	let interactiveClientAvailable = options.interactiveClientAvailable ?? true;
	const runtime: AgendaTaskRuntime = {
		isInteractiveClientAvailable: vi.fn(() => interactiveClientAvailable),
		startSession: vi.fn(async (_task, run) => ({
			sessionId: `session_${run.runId}`,
		})),
		runSession: vi.fn(async () => ({
			status: result,
			summary: result === "completed" ? "done" : undefined,
			error: result === "failed" ? "failed on purpose" : undefined,
		})),
		abortSession: vi.fn(async () => {}),
	};
	const manager = new AgendaTaskManager({
		runtime,
		dbPath: join(root, "tasks.db"),
		globalSpecsDir: join(root, "specs"),
		watchFiles: false,
		automationEnabled: options.automationEnabled,
		publish: (event) => events.push(event),
	});
	managers.push(manager);
	return {
		root,
		manager,
		runtime,
		events,
		setInteractiveClientAvailable(value: boolean) {
			interactiveClientAvailable = value;
		},
	};
}

async function createPending(
	manager: AgendaTaskManager,
	overrides: Partial<AgendaTaskRecord> = {},
) {
	return await manager.createTask({
		type: overrides.type ?? "follow-up",
		title: overrides.title ?? "Review the pull request",
		instructions: overrides.instructions ?? "Review the pull request.",
		scope: "global",
		priority: overrides.priority,
		expiresAt: overrides.expiresAt ?? future(),
		createdBy: { kind: "user", clientId: "desktop" },
	});
}

describe("AgendaTaskManager", () => {
	it("requires approval, links a session, and completes the task", async () => {
		const { manager, runtime, events } = createHarness();
		await manager.start();
		const pending = await createPending(manager);

		await expect(
			manager.runTask(pending.taskId, { kind: "user" }, pending.revision),
		).rejects.toThrow("must be approved");
		const approved = await manager.approveTask(
			pending.taskId,
			{ kind: "user", clientId: "desktop" },
			pending.revision,
		);
		const started = await manager.runTask(
			approved.taskId,
			{ kind: "user", clientId: "desktop" },
			approved.revision,
			"desktop",
		);

		expect(started.task).toMatchObject({
			status: "in_progress",
			approvedRevision: approved.revision,
		});
		expect(started.task.lastSessionId).toMatch(/^session_run_/);
		expect(runtime.startSession).toHaveBeenCalledTimes(1);
		await vi.waitFor(async () => {
			expect((await manager.getTask(pending.taskId))?.status).toBe("completed");
		});
		expect(events).toContain("task.run.started");
		expect(events).toContain("task.run.completed");
	});

	it("does not revive a task cancelled while its session is starting", async () => {
		const { manager, runtime } = createHarness();
		let finishStarting: ((value: { sessionId: string }) => void) | undefined;
		vi.mocked(runtime.startSession).mockImplementationOnce(
			async () =>
				await new Promise<{ sessionId: string }>((resolve) => {
					finishStarting = resolve;
				}),
		);
		await manager.start();
		const pending = await createPending(manager);
		const approved = await manager.approveTask(
			pending.taskId,
			{ kind: "user" },
			pending.revision,
		);

		const starting = manager.runTask(
			approved.taskId,
			{ kind: "user" },
			approved.revision,
		);
		await vi.waitFor(() => expect(runtime.startSession).toHaveBeenCalledOnce());
		await manager.cancelTask(
			approved.taskId,
			{ kind: "user" },
			approved.revision,
			"Changed my mind",
		);
		finishStarting?.({ sessionId: "late-session" });

		await expect(starting).rejects.toThrow("cancelled while starting");
		expect(runtime.runSession).not.toHaveBeenCalled();
		expect(runtime.abortSession).toHaveBeenCalledWith(
			"late-session",
			"Agenda task was cancelled while its session was starting",
		);
		expect(await manager.getTask(approved.taskId)).toMatchObject({
			status: "cancelled",
			currentRunId: undefined,
		});
	});

	it("increments revision and revokes approval when editable fields change", async () => {
		const { manager } = createHarness();
		await manager.start();
		const pending = await createPending(manager);
		const approved = await manager.approveTask(
			pending.taskId,
			{ kind: "user" },
			pending.revision,
		);

		const updated = await manager.updateTask({
			taskId: approved.taskId,
			expectedRevision: approved.revision,
			title: "Review the updated pull request",
			updatedBy: { kind: "agent", agentId: "agent_1" },
		});

		expect(updated).toMatchObject({
			revision: approved.revision + 1,
			status: "pending_approval",
			title: "Review the updated pull request",
		});
		expect(updated.approvedRevision).toBeUndefined();
	});

	it("binds approval and execution to the current valid Markdown intent", async () => {
		const { root, manager, runtime } = createHarness();
		await manager.start();
		const pending = await createPending(manager, {
			title: "Original intent",
			instructions: "Perform the original work.",
		});
		if (!pending.specPath) throw new Error("task has no spec path");
		const files = new AgendaTaskSpecFileStore({
			scope: "global",
			taskSpecsDir: join(root, "specs"),
		});
		const source = files.readSpec(pending.specPath);
		if (!source.ok || !source.spec.taskId) {
			throw new Error("task spec fixture is invalid");
		}
		files.writeSpec(
			{
				...source.spec,
				taskId: source.spec.taskId,
				title: "Edited intent",
				instructions: "Perform the edited work.",
			},
			{
				specPath: source.specPath,
				expectedContentHash: source.contentHash,
			},
		);

		await expect(
			manager.approveTask(pending.taskId, { kind: "user" }, pending.revision),
		).rejects.toThrow("requested revision is stale");
		const edited = await manager.getTask(pending.taskId);
		expect(edited).toMatchObject({
			title: "Edited intent",
			instructions: "Perform the edited work.",
			revision: pending.revision + 1,
			status: "pending_approval",
		});
		if (!edited) throw new Error("edited task was not persisted");
		const approved = await manager.approveTask(
			edited.taskId,
			{ kind: "user" },
			edited.revision,
		);
		writeFileSync(approved.specPath ?? "", "not valid task Markdown");

		await expect(
			manager.runTask(approved.taskId, { kind: "user" }, approved.revision),
		).rejects.toThrow("task spec is invalid");
		expect(runtime.startSession).not.toHaveBeenCalled();
	});

	it("rehydrates known workspaces and watches their task specs after restart", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-agenda-workspace-"));
		const workspaceRoot = join(root, "workspace");
		const dbPath = join(root, "tasks.db");
		const globalSpecsDir = join(root, "global-specs");
		mkdirSync(workspaceRoot);
		const runtime: AgendaTaskRuntime = {
			isInteractiveClientAvailable: () => true,
			startSession: vi.fn(),
			runSession: vi.fn(),
			abortSession: vi.fn(),
		};
		const first = new AgendaTaskManager({
			runtime,
			dbPath,
			globalSpecsDir,
			watchFiles: false,
		});
		managers.push(first);
		await first.start();
		const created = await first.createTask({
			type: "todo",
			title: "Before restart",
			instructions: "Keep this workspace task synchronized.",
			scope: "workspace",
			workspaceRoot,
			expiresAt: future(),
			createdBy: { kind: "user" },
		});
		await first.dispose();
		if (!created.specPath) throw new Error("workspace task has no spec path");
		const files = new AgendaTaskSpecFileStore({
			scope: "workspace",
			workspaceRoot,
		});
		const beforeRestart = files.readSpec(created.specPath);
		if (!beforeRestart.ok || !beforeRestart.spec.taskId) {
			throw new Error("workspace task spec fixture is invalid");
		}
		files.writeSpec(
			{
				...beforeRestart.spec,
				taskId: beforeRestart.spec.taskId,
				title: "Reconciled at restart",
			},
			{
				specPath: beforeRestart.specPath,
				expectedContentHash: beforeRestart.contentHash,
			},
		);

		const events: string[] = [];
		const restarted = new AgendaTaskManager({
			runtime,
			dbPath,
			globalSpecsDir,
			watcherDebounceMs: 0,
			publish: (event) => events.push(event),
		});
		managers.push(restarted);
		await restarted.start();
		expect(await restarted.getTask(created.taskId)).toMatchObject({
			title: "Reconciled at restart",
			revision: created.revision + 1,
		});

		events.length = 0;
		const afterRestart = files.readSpec(created.specPath);
		if (!afterRestart.ok || !afterRestart.spec.taskId) {
			throw new Error("restarted task spec fixture is invalid");
		}
		files.writeSpec(
			{
				...afterRestart.spec,
				taskId: afterRestart.spec.taskId,
				title: "Updated by watcher",
			},
			{
				specPath: afterRestart.specPath,
				expectedContentHash: afterRestart.contentHash,
			},
		);
		await vi.waitFor(() => expect(events).toContain("task.updated"), {
			timeout: 5_000,
		});
		expect(await restarted.getTask(created.taskId)).toMatchObject({
			title: "Updated by watcher",
			revision: created.revision + 2,
		});
	});

	it("does not recreate a missing historical workspace during startup", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-agenda-missing-root-"));
		const workspaceRoot = join(root, "workspace");
		const movedWorkspaceRoot = join(root, "workspace-moved");
		const dbPath = join(root, "tasks.db");
		mkdirSync(workspaceRoot);
		const runtime: AgendaTaskRuntime = {
			isInteractiveClientAvailable: () => true,
			startSession: vi.fn(),
			runSession: vi.fn(),
			abortSession: vi.fn(),
		};
		const first = new AgendaTaskManager({
			runtime,
			dbPath,
			globalSpecsDir: join(root, "global-specs"),
			watchFiles: false,
		});
		managers.push(first);
		await first.start();
		const created = await first.createTask({
			type: "todo",
			title: "Historical workspace task",
			instructions: "Keep the task without recreating its project.",
			scope: "workspace",
			workspaceRoot,
			expiresAt: future(),
			createdBy: { kind: "user" },
		});
		await first.dispose();
		renameSync(workspaceRoot, movedWorkspaceRoot);
		expect(existsSync(workspaceRoot)).toBe(false);

		const restarted = new AgendaTaskManager({
			runtime,
			dbPath,
			globalSpecsDir: join(root, "global-specs"),
		});
		managers.push(restarted);
		await restarted.start();

		expect(existsSync(workspaceRoot)).toBe(false);
		expect(await restarted.getTask(created.taskId)).toMatchObject({
			title: "Historical workspace task",
		});
	});

	it.skipIf(process.platform === "win32")(
		"isolates an unsafe task source while starting other Hub task scopes",
		async () => {
			const root = mkdtempSync(
				join(tmpdir(), "cline-agenda-source-isolation-"),
			);
			const badWorkspace = join(root, "bad-workspace");
			const goodWorkspace = join(root, "good-workspace");
			const dbPath = join(root, "tasks.db");
			const globalSpecsDir = join(root, "global-specs");
			mkdirSync(badWorkspace);
			mkdirSync(goodWorkspace);
			const runtime: AgendaTaskRuntime = {
				isInteractiveClientAvailable: () => true,
				startSession: vi.fn(),
				runSession: vi.fn(),
				abortSession: vi.fn(),
			};
			const first = new AgendaTaskManager({
				runtime,
				dbPath,
				globalSpecsDir,
				watchFiles: false,
			});
			managers.push(first);
			await first.start();
			await first.createTask({
				type: "todo",
				title: "Unsafe source task",
				instructions: "This source should be isolated.",
				scope: "workspace",
				workspaceRoot: badWorkspace,
				expiresAt: future(),
				createdBy: { kind: "user" },
			});
			const good = await first.createTask({
				type: "todo",
				title: "Good source task",
				instructions: "This source should still reconcile.",
				scope: "workspace",
				workspaceRoot: goodWorkspace,
				expiresAt: future(),
				createdBy: { kind: "user" },
			});
			await first.dispose();

			const goodFiles = new AgendaTaskSpecFileStore({
				scope: "workspace",
				workspaceRoot: goodWorkspace,
			});
			if (!good.specPath) throw new Error("good task has no spec path");
			const goodSource = goodFiles.readSpec(good.specPath);
			if (!goodSource.ok || !goodSource.spec.taskId) {
				throw new Error("good task spec fixture is invalid");
			}
			goodFiles.writeSpec(
				{
					...goodSource.spec,
					taskId: goodSource.spec.taskId,
					title: "Good source reconciled",
				},
				{
					specPath: goodSource.specPath,
					expectedContentHash: goodSource.contentHash,
				},
			);
			const badSpecsDir = join(badWorkspace, ".cline", "tasks");
			const badSpecsBackup = join(badWorkspace, ".cline", "tasks-real");
			renameSync(badSpecsDir, badSpecsBackup);
			symlinkSync(badSpecsBackup, badSpecsDir, "dir");

			const logError = vi.fn();
			const restarted = new AgendaTaskManager({
				runtime,
				dbPath,
				globalSpecsDir,
				logger: { log: vi.fn(), debug: vi.fn(), error: logError },
			});
			managers.push(restarted);
			await expect(restarted.start()).resolves.toBeUndefined();
			expect(await restarted.getTask(good.taskId)).toMatchObject({
				title: "Good source reconciled",
				revision: good.revision + 1,
			});
			expect(logError).toHaveBeenCalledWith(
				"agenda task source startup reconciliation failed",
				expect.objectContaining({
					scope: "workspace",
					workspaceRoot: badWorkspace,
					error: expect.anything(),
				}),
			);
			await expect(createPending(restarted)).resolves.toMatchObject({
				scope: "global",
				status: "pending_approval",
			});
		},
	);

	it("does not leave a task spec behind when task validation fails", async () => {
		const { root, manager } = createHarness();
		await manager.start();
		await expect(
			manager.createTask({
				taskId: "invalid_window",
				type: "todo",
				title: "Impossible window",
				instructions: "This task must not be persisted.",
				scope: "global",
				availableAt: future(2),
				expiresAt: future(1),
				createdBy: { kind: "user" },
			}),
		).rejects.toThrow("availableAt must be before expiresAt");

		const files = new AgendaTaskSpecFileStore({
			scope: "global",
			taskSpecsDir: join(root, "specs"),
		});
		expect(files.listSpecPaths()).toEqual([]);
		expect(await manager.getTask("invalid_window")).toBeUndefined();
	});

	it("imports and reconciles user-edited Markdown specs", async () => {
		const { root, manager } = createHarness();
		await manager.start();
		const files = new AgendaTaskSpecFileStore({
			scope: "global",
			taskSpecsDir: join(root, "specs"),
		});
		const spec = files.writeSpec({
			taskId: "task_from_file",
			type: "reminder",
			title: "Check CI",
			instructions: "Check the CI result.",
			priority: 1,
			expiresAt: future(),
		});

		let imported = (await manager.listTasks({ scope: "global" })).find(
			(task) => task.taskId === "task_from_file",
		);
		expect(imported).toMatchObject({
			status: "pending_approval",
			priority: 1,
		});
		files.writeSpec(
			{ ...spec, title: "Check CI and release notes" },
			{ specPath: spec.specPath },
		);
		await manager.listTasks({ scope: "global" });
		imported = await manager.getTask("task_from_file");

		expect(imported).toMatchObject({
			revision: 2,
			title: "Check CI and release notes",
			status: "pending_approval",
		});

		files.writeSpec(
			{
				...spec,
				taskId: "replacement_id",
				title: "Check CI without changing identity",
			},
			{ specPath: spec.specPath },
		);
		await manager.listTasks({ scope: "global" });
		expect(await manager.getTask("replacement_id")).toBeUndefined();
		expect(await manager.getTask("task_from_file")).toMatchObject({
			revision: 3,
			title: "Check CI without changing identity",
		});
		expect(files.readSpec(spec.specPath)).toMatchObject({
			ok: true,
			spec: { taskId: "task_from_file" },
		});
	});

	it("discovers the first task file in a selected workspace", async () => {
		const { root, manager } = createHarness();
		const workspaceRoot = join(root, "selected-workspace");
		mkdirSync(workspaceRoot);
		await manager.start();
		const globalTask = await createPending(manager, { title: "General task" });
		const files = new AgendaTaskSpecFileStore({
			scope: "workspace",
			workspaceRoot,
		});
		files.writeSpec({
			taskId: "first_workspace_task",
			type: "suggestion",
			title: "First workspace suggestion",
			instructions: "Discover this file when the workspace is selected.",
			expiresAt: future(),
		});

		const visible = await manager.listTasks({ workspaceRoot });
		expect(new Set(visible.map((task) => task.taskId))).toEqual(
			new Set([globalTask.taskId, "first_workspace_task"]),
		);
	});

	it("isolates stale hand-authored specs during startup reconciliation", async () => {
		const { root, manager } = createHarness();
		const files = new AgendaTaskSpecFileStore({
			scope: "global",
			taskSpecsDir: join(root, "specs"),
		});
		files.writeSpec({
			taskId: "stale_task",
			type: "reminder",
			title: "Old reminder",
			instructions: "This reminder is already stale.",
			expiresAt: "2020-01-01T00:00:00.000Z",
		});
		files.writeSpec({
			taskId: "valid_task",
			type: "todo",
			title: "Current task",
			instructions: "Keep processing other valid files.",
			expiresAt: future(),
		});

		await expect(manager.start()).resolves.toBeUndefined();
		expect(await manager.getTask("stale_task")).toMatchObject({
			status: "expired",
		});
		expect(await manager.getTask("valid_task")).toMatchObject({
			status: "pending_approval",
		});
	});

	it("auto-approves and starts eligible work only after automation is enabled", async () => {
		const { manager, runtime } = createHarness();
		await manager.start();
		await manager.setAutomationPolicy(
			{
				scopeKey: "global",
				mode: "auto_start",
				applyToAgentCreated: true,
				maxConcurrentRuns: 1,
				maxChainDepth: 3,
				maxStartsPerHour: 20,
			},
			{ kind: "user", clientId: "desktop" },
		);
		const task = await createPending(manager);

		await vi.waitFor(async () => {
			expect((await manager.getTask(task.taskId))?.status).toBe("completed");
		});
		expect(runtime.startSession).toHaveBeenCalledTimes(1);
	});

	it("keeps a persisted automation policy idle when automation is disabled", async () => {
		const { root, manager, runtime } = createHarness("completed", {
			automationEnabled: false,
		});
		await manager.start();
		await manager.setAutomationPolicy(
			{
				scopeKey: "global",
				mode: "unattended",
				applyToAgentCreated: true,
				maxConcurrentRuns: 1,
				maxChainDepth: 3,
				maxStartsPerHour: 20,
			},
			{ kind: "user", clientId: "desktop" },
		);
		const task = await createPending(manager);
		manager.notifyAutomationReadinessChanged();
		await new Promise((resolve) => setTimeout(resolve, 100));

		expect((await manager.getTask(task.taskId))?.status).toBe(
			"pending_approval",
		);
		expect(runtime.startSession).not.toHaveBeenCalled();
		await manager.dispose();

		// A restarted Hub with the same store and the flag still off must not
		// pick the persisted unattended policy back up either.
		const restarted = new AgendaTaskManager({
			runtime,
			dbPath: join(root, "tasks.db"),
			globalSpecsDir: join(root, "specs"),
			watchFiles: false,
			automationEnabled: false,
		});
		managers.push(restarted);
		await restarted.start();
		await new Promise((resolve) => setTimeout(resolve, 100));

		expect((await restarted.getTask(task.taskId))?.status).toBe(
			"pending_approval",
		);
		expect(runtime.startSession).not.toHaveBeenCalled();
	});

	it("only automates tasks in the policy workspace", async () => {
		const { root, manager, runtime } = createHarness();
		await manager.start();
		const repoA = join(root, "repo-a");
		const repoB = join(root, "repo-b");
		mkdirSync(repoA, { recursive: true });
		mkdirSync(repoB, { recursive: true });
		const createWorkspaceTask = (workspaceRoot: string, title: string) =>
			manager.createTask({
				type: "follow-up",
				title,
				instructions: title,
				scope: "workspace",
				workspaceRoot,
				cwd: workspaceRoot,
				expiresAt: future(),
				createdBy: { kind: "user", clientId: "desktop" },
			});
		const inScope = await createWorkspaceTask(repoA, "In scope");
		const outOfScope = await createWorkspaceTask(repoB, "Out of scope");

		await manager.setAutomationPolicy(
			{
				scopeKey: repoA,
				mode: "auto_start",
				applyToAgentCreated: true,
				maxConcurrentRuns: 1,
				maxChainDepth: 3,
				maxStartsPerHour: 20,
			},
			{ kind: "user", clientId: "desktop" },
		);

		await vi.waitFor(async () => {
			expect((await manager.getTask(inScope.taskId))?.status).toBe("completed");
		});
		expect((await manager.getTask(outOfScope.taskId))?.status).toBe(
			"pending_approval",
		);
		expect(runtime.startSession).toHaveBeenCalledTimes(1);
	});

	it("keeps auto-start work approved until an interactive client is available", async () => {
		const { manager, runtime, setInteractiveClientAvailable } = createHarness(
			"completed",
			{ interactiveClientAvailable: false },
		);
		await manager.start();
		await manager.setAutomationPolicy(
			{
				scopeKey: "global",
				mode: "auto_start",
				applyToAgentCreated: true,
				maxConcurrentRuns: 1,
				maxChainDepth: 3,
				maxStartsPerHour: 20,
			},
			{ kind: "user" },
		);
		const task = await createPending(manager);

		await vi.waitFor(async () => {
			expect((await manager.getTask(task.taskId))?.status).toBe("approved");
		});
		expect(runtime.startSession).not.toHaveBeenCalled();

		setInteractiveClientAvailable(true);
		manager.notifyAutomationReadinessChanged();
		await vi.waitFor(async () => {
			expect((await manager.getTask(task.taskId))?.status).toBe("completed");
		});
	});

	it("drains saturated automation scopes without a microtask loop", async () => {
		const { manager, runtime } = createHarness();
		await manager.start();
		await manager.setAutomationPolicy(
			{
				scopeKey: "global",
				mode: "auto_start",
				applyToAgentCreated: true,
				maxConcurrentRuns: 1,
				maxChainDepth: 3,
				maxStartsPerHour: 20,
			},
			{ kind: "user" },
		);
		const task = await createPending(manager);
		await vi.waitFor(async () => {
			expect((await manager.getTask(task.taskId))?.status).toBe("completed");
		});

		const saturatedPolicy = (scopeKey: string) =>
			manager.setAutomationPolicy(
				{
					scopeKey,
					mode: "auto_start",
					applyToAgentCreated: true,
					maxConcurrentRuns: 1,
					maxChainDepth: 3,
					maxStartsPerHour: 1,
				},
				{ kind: "user" },
			);
		await Promise.all([
			saturatedPolicy("/workspace-a"),
			saturatedPolicy("/workspace-b"),
		]);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(runtime.startSession).toHaveBeenCalledTimes(1);
	});

	it("does not auto-approve agent-edited or raw-file intent", async () => {
		const { root, manager, runtime } = createHarness();
		await manager.start();
		const userTask = await createPending(manager);
		const edited = await manager.updateTask({
			taskId: userTask.taskId,
			expectedRevision: userTask.revision,
			title: "Agent changed the requested work",
			updatedBy: { kind: "agent", agentId: "agent_1" },
		});
		const files = new AgendaTaskSpecFileStore({
			scope: "global",
			taskSpecsDir: join(root, "specs"),
		});
		files.writeSpec({
			taskId: "raw_file_task",
			type: "todo",
			title: "Raw file task",
			instructions: "Do not infer that this came from a user.",
			expiresAt: future(),
		});
		await manager.listTasks({ scope: "global" });
		await manager.setAutomationPolicy(
			{
				scopeKey: "global",
				mode: "auto_start",
				applyToAgentCreated: false,
				maxConcurrentRuns: 2,
				maxChainDepth: 3,
				maxStartsPerHour: 20,
			},
			{ kind: "user" },
		);

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(await manager.getTask(edited.taskId)).toMatchObject({
			status: "pending_approval",
		});
		expect(await manager.getTask("raw_file_task")).toMatchObject({
			status: "pending_approval",
		});
		expect(runtime.startSession).not.toHaveBeenCalled();
	});

	it("stops claiming candidates when automation is paused mid-pump", async () => {
		const { manager, runtime } = createHarness();
		let finishStarting: ((value: { sessionId: string }) => void) | undefined;
		vi.mocked(runtime.startSession).mockImplementationOnce(
			async () =>
				await new Promise<{ sessionId: string }>((resolve) => {
					finishStarting = resolve;
				}),
		);
		await manager.start();
		const first = await createPending(manager, { title: "First" });
		const second = await createPending(manager, { title: "Second" });
		await manager.setAutomationPolicy(
			{
				scopeKey: "global",
				mode: "auto_start",
				applyToAgentCreated: true,
				maxConcurrentRuns: 2,
				maxChainDepth: 3,
				maxStartsPerHour: 20,
			},
			{ kind: "user" },
		);
		await vi.waitFor(() => expect(runtime.startSession).toHaveBeenCalledOnce());
		await manager.setAutomationPolicy(
			{
				scopeKey: "global",
				mode: "manual",
				applyToAgentCreated: true,
				maxConcurrentRuns: 2,
				maxChainDepth: 3,
				maxStartsPerHour: 20,
			},
			{ kind: "user" },
		);
		finishStarting?.({ sessionId: "first-session" });
		await vi.waitFor(async () => {
			expect((await manager.getTask(first.taskId))?.status).toBe("completed");
		});
		expect(runtime.startSession).toHaveBeenCalledTimes(1);
		expect((await manager.getTask(second.taskId))?.status).toBe(
			"pending_approval",
		);
	});

	it("recovers a crash during session startup back to approved", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-agenda-recovery-"));
		const store = new SqliteAgendaTaskStore({ dbPath: join(root, "tasks.db") });
		const files = new AgendaTaskSpecFileStore({
			scope: "global",
			taskSpecsDir: join(root, "specs"),
		});
		const spec = files.writeSpec({
			taskId: "recover_starting",
			type: "todo",
			title: "Recover me",
			instructions: "Retry after the Hub restarts.",
			expiresAt: future(),
		});
		const created = store.createTask({
			...spec,
			taskId: spec.taskId,
			createdBy: { kind: "user" },
		});
		const approved = store.updateTaskState(created.taskId, {
			status: "approved",
			approvedRevision: created.revision,
		});
		if (!approved) throw new Error("failed to approve recovery fixture");
		const run = store.createRun({
			taskId: approved.taskId,
			taskRevision: approved.revision,
		});
		store.updateTaskState(approved.taskId, {
			currentRunId: run.runId,
			lastRunId: run.runId,
		});
		const runtime: AgendaTaskRuntime = {
			isInteractiveClientAvailable: () => true,
			startSession: vi.fn(),
			runSession: vi.fn(),
			abortSession: vi.fn(),
		};
		const manager = new AgendaTaskManager({
			runtime,
			store,
			globalSpecsDir: join(root, "specs"),
			watchFiles: false,
		});
		managers.push(manager);

		await manager.start();
		expect(await manager.getTask(approved.taskId)).toMatchObject({
			status: "approved",
			currentRunId: undefined,
		});
		expect(store.getRun(run.runId)).toMatchObject({ status: "interrupted" });
	});

	it("preserves terminal tasks and last-known-good state across raw edits", async () => {
		const { manager, runtime } = createHarness();
		await manager.start();
		const pending = await createPending(manager);
		const approved = await manager.approveTask(
			pending.taskId,
			{ kind: "user" },
			pending.revision,
		);
		await manager.runTask(approved.taskId, { kind: "user" }, approved.revision);
		await vi.waitFor(async () => {
			expect((await manager.getTask(approved.taskId))?.status).toBe(
				"completed",
			);
		});
		const completed = await manager.getTask(approved.taskId);
		if (!completed) throw new Error("completed task was not persisted");
		await expect(
			manager.updateTask({
				taskId: completed.taskId,
				expectedRevision: completed.revision,
				title: "Do it again",
				updatedBy: { kind: "user" },
			}),
		).rejects.toThrow("cannot be edited from completed");
		if (!completed.specPath) throw new Error("completed task has no spec path");
		writeFileSync(completed.specPath, "not valid task Markdown");
		await manager.listTasks({ scope: "global" });
		expect(await manager.getTask(completed.taskId)).toMatchObject({
			status: "completed",
			revision: completed.revision,
			archivedAt: undefined,
		});
		expect(runtime.startSession).toHaveBeenCalledTimes(1);
	});
});
