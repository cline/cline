import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
	AgendaAutomationPolicy,
	AgendaTaskRecord,
	HubCommandEnvelope,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import type { AgendaTaskManagerApi } from "../../tasks/agenda-task-api";
import { AgendaTaskManager } from "../../tasks/agenda-task-manager";
import { FileFactoryDefaultsStore } from "../../tasks/factory-defaults";
import { createFactoryWorkflowRecipe } from "../../tasks/factory-workflow-recipe";
import { HubAgendaTaskCommandService } from "./task-command-service";

function task(overrides: Partial<AgendaTaskRecord> = {}): AgendaTaskRecord {
	return {
		taskId: "task_1",
		type: "follow-up",
		status: "pending_approval",
		title: "Review the PR",
		instructions: "Review the open pull request.",
		scope: "workspace",
		workspaceRoot: "/repo",
		resourcePaths: [],
		priority: 2,
		availableAt: "2026-08-13T00:00:00.000Z",
		expiresAt: "2026-08-20T00:00:00.000Z",
		automationEligible: true,
		revision: 1,
		createdBy: { kind: "user", clientId: "desktop" },
		updatedBy: { kind: "user", clientId: "desktop" },
		createdAt: "2026-08-13T00:00:00.000Z",
		updatedAt: "2026-08-13T00:00:00.000Z",
		...overrides,
	};
}

const policy: AgendaAutomationPolicy = {
	scopeKey: "global",
	mode: "manual",
	applyToAgentCreated: true,
	maxConcurrentRuns: 1,
	maxChainDepth: 3,
	maxStartsPerHour: 20,
	updatedAt: "2026-08-13T00:00:00.000Z",
};

const AUTHORITY = {
	clientId: "desktop",
	workspaceContext: { workspaceRoot: "/repo", cwd: "/repo" },
};

function managerMock(): AgendaTaskManagerApi {
	return {
		createTask: vi.fn(async (input) =>
			task({ createdBy: input.createdBy, updatedBy: input.createdBy }),
		),
		listTasks: vi.fn(async () => [task()]),
		getTask: vi.fn(async () => task()),
		updateTask: vi.fn(async (input) => task({ updatedBy: input.updatedBy })),
		approveTask: vi.fn(async (_id, actor) =>
			task({ status: "approved", approvedRevision: 1, updatedBy: actor }),
		),
		cancelTask: vi.fn(async (_id, actor) =>
			task({ status: "cancelled", updatedBy: actor }),
		),
		archiveTask: vi.fn(async () => task()),
		restoreTask: vi.fn(async () => task()),
		deleteTask: vi.fn(async () => {}),
		runTask: vi.fn(async () => ({
			task: task({ status: "in_progress" }),
		})),
		getAutomationPolicy: vi.fn(async () => policy),
		setAutomationPolicy: vi.fn(async (input, actor) => ({
			...input,
			enabledBy: actor,
			updatedAt: "2026-08-13T00:00:01.000Z",
		})),
	};
}

function envelope(
	command: HubCommandEnvelope["command"],
	payload: Record<string, unknown> = {},
): HubCommandEnvelope {
	return {
		version: "v1",
		command,
		requestId: "request_1",
		clientId: "desktop",
		payload,
	};
}

describe("HubAgendaTaskCommandService", () => {
	it("validates and applies factoryOnly through the task.list command", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-hub-factory-list-"));
		const manager = new AgendaTaskManager({
			runtime: {
				startSession: vi.fn(async () => ({ sessionId: "unused" })),
				runSession: vi.fn(async () => ({ status: "completed" as const })),
				abortSession: vi.fn(async () => {}),
			},
			dbPath: join(root, "tasks.db"),
			globalSpecsDir: join(root, "specs"),
			watchFiles: false,
			automationEnabled: false,
		});
		try {
			const expiresAt = "2027-01-01T00:00:00.000Z";
			const ordinary = await manager.createTask({
				type: "todo",
				title: "Ordinary note",
				instructions: "Not Factory work",
				scope: "workspace",
				workspaceRoot: root,
				expiresAt,
				createdBy: { kind: "user" },
			});
			const factory = await manager.createTask({
				type: "todo",
				title: "Factory card",
				instructions: "Factory work",
				scope: "workspace",
				workspaceRoot: root,
				expiresAt,
				createdBy: { kind: "user" },
				factory: {
					execution: "local",
					approval: "required",
					maxRepairRounds: 2,
					checks: [],
					publishPullRequest: false,
				},
			});
			const service = new HubAgendaTaskCommandService(manager);
			const listed = await service.handleCommand(
				envelope("task.list", { factoryOnly: true }),
				{ ...AUTHORITY, workspaceContext: { workspaceRoot: root, cwd: root } },
			);
			expect(listed.payload?.tasks).toMatchObject([
				{ taskId: factory.taskId, title: "Factory card" },
			]);
			expect(listed.payload?.tasks).not.toContainEqual(
				expect.objectContaining({ taskId: ordinary.taskId }),
			);
			const invalid = await service.handleCommand(
				envelope("task.list", { factoryOnly: "true" }),
				{ ...AUTHORITY, workspaceContext: { workspaceRoot: root, cwd: root } },
			);
			expect(invalid.ok).toBe(false);
		} finally {
			await manager.dispose();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("scopes replay creation and rejects malformed variants before creating tasks", async () => {
		const manager = managerMock();
		const replay = vi.fn(async () => [task({ taskId: "replay_1" })]);
		manager.replayFactoryTask = replay;
		const service = new HubAgendaTaskCommandService(manager);
		const input = {
			taskId: "task_1",
			runId: "run_1",
			comparisonId: "comparison_1",
			variants: [{ label: "Original workflow" }],
		};
		expect(
			(
				await service.handleCommand(envelope("task.factory.replay", input), {
					...AUTHORITY,
					workspaceContext: { workspaceRoot: "/other-repo" },
				})
			).ok,
		).toBe(false);
		expect(
			(
				await service.handleCommand(
					envelope("task.factory.replay", {
						...input,
						variants: [],
					}),
					AUTHORITY,
				)
			).ok,
		).toBe(false);
		expect(replay).not.toHaveBeenCalled();
		const reply = await service.handleCommand(
			envelope("task.factory.replay", {
				...input,
				actor: { kind: "system", id: "untrusted" },
			}),
			AUTHORITY,
		);
		expect(reply).toMatchObject({
			ok: true,
			payload: { tasks: [{ taskId: "replay_1" }] },
		});
		expect(replay).toHaveBeenCalledWith({
			...input,
			actor: { kind: "user", id: "desktop", clientId: "desktop" },
		});
	});

	it("passes queue-only creation intent to the manager and rejects a nonboolean flag", async () => {
		const manager = managerMock();
		const service = new HubAgendaTaskCommandService(manager);
		const payload = { factory: {}, queueFactoryDesign: false };
		expect(
			(await service.handleCommand(envelope("task.create", payload), AUTHORITY))
				.ok,
		).toBe(true);
		expect(manager.createTask).toHaveBeenCalledWith(
			expect.objectContaining({
				queueFactoryDesign: false,
				requiresApproval: true,
				createdBy: expect.objectContaining({
					kind: "user",
					clientId: "desktop",
				}),
			}),
		);
		vi.mocked(manager.createTask).mockClear();
		expect(
			(
				await service.handleCommand(
					envelope("task.create", { ...payload, queueFactoryDesign: "false" }),
					AUTHORITY,
				)
			).ok,
		).toBe(false);
		expect(manager.createTask).not.toHaveBeenCalled();
	});

	it("opens the draft PR for an automatically approved card unless the caller turns it off", async () => {
		const manager = managerMock();
		const service = new HubAgendaTaskCommandService(manager);
		const create = async (factory: Record<string, unknown>) => {
			vi.mocked(manager.createTask).mockClear();
			await service.handleCommand(
				envelope("task.create", { factory }),
				AUTHORITY,
			);
			return vi.mocked(manager.createTask).mock.calls[0]?.[0].factory;
		};
		expect(await create({ approval: "automatic" })).toMatchObject({
			publishPullRequest: true,
			watchPullRequest: false,
		});
		expect(
			await create({ approval: "automatic", publishPullRequest: false }),
		).toMatchObject({ publishPullRequest: false });
		expect(await create({})).toMatchObject({ publishPullRequest: false });
	});

	it.each([
		"task.archive",
		"task.restore",
		"task.delete",
	] as const)("scopes %s and derives its actor from the trusted client", async (command) => {
		const manager = managerMock();
		const service = new HubAgendaTaskCommandService(manager);
		const request = envelope(command, {
			taskId: "task_1",
			expectedRevision: 1,
			actor: { kind: "system" },
		});
		const denied = await service.handleCommand(request, {
			...AUTHORITY,
			workspaceContext: { workspaceRoot: "/other-repo" },
		});
		expect(denied.ok).toBe(false);
		expect(manager.archiveTask).not.toHaveBeenCalled();
		expect(manager.restoreTask).not.toHaveBeenCalled();
		expect(manager.deleteTask).not.toHaveBeenCalled();
		const reply = await service.handleCommand(request, AUTHORITY);
		expect(manager.getTask).toHaveBeenCalledWith("task_1", {
			reconcile: false,
		});
		expect(reply).toMatchObject({
			ok: true,
			payload:
				command === "task.delete"
					? { taskId: "task_1" }
					: { task: { taskId: "task_1" } },
		});
		const mutation =
			command === "task.archive"
				? manager.archiveTask
				: command === "task.restore"
					? manager.restoreTask
					: manager.deleteTask;
		expect(mutation).toHaveBeenCalledWith(
			"task_1",
			expect.objectContaining({ kind: "user", clientId: "desktop" }),
			1,
		);
	});

	it("honors selected repositories only for authenticated cross-workspace clients", async () => {
		const manager = managerMock();
		const service = new HubAgendaTaskCommandService(manager);
		const payload = {
			allWorkspaces: true,
			workspaceRoot: "/selected",
			factory: {},
		};
		const denied = await service.handleCommand(
			envelope("task.create", payload),
			AUTHORITY,
		);
		expect(denied.ok).toBe(false);
		expect(manager.createTask).not.toHaveBeenCalled();
		const authority = { ...AUTHORITY, crossWorkspace: true };
		expect(
			(await service.handleCommand(envelope("task.create", payload), authority))
				.ok,
		).toBe(true);
		expect(manager.createTask).toHaveBeenCalledWith(
			expect.objectContaining({
				workspaceRoot: resolve("/selected"),
				cwd: resolve("/selected"),
				requiresApproval: true,
			}),
		);
		vi.mocked(manager.getTask).mockResolvedValue(
			task({ workspaceRoot: "/selected" }),
		);
		expect(
			(
				await service.handleCommand(
					envelope("task.get", { taskId: "task_1", allWorkspaces: true }),
					authority,
				)
			).ok,
		).toBe(true);
		expect(
			(
				await service.handleCommand(
					envelope("task.get", { taskId: "task_1", allWorkspaces: true }),
					AUTHORITY,
				)
			).ok,
		).toBe(false);
		await service.handleCommand(
			envelope("task.list", { allWorkspaces: true }),
			authority,
		);
		expect(manager.listTasks).toHaveBeenCalledWith(
			expect.objectContaining({ scope: undefined, workspaceRoot: undefined }),
		);
	});

	it("uses the authenticated Hub client as the create actor", async () => {
		const manager = managerMock();
		const service = new HubAgendaTaskCommandService(manager);
		const reply = await service.handleCommand(
			envelope("task.create", {
				type: "follow-up",
				title: "Review the PR",
				instructions: "Review it",
				scope: "workspace",
				workspaceRoot: "/repo",
				expiresAt: "2026-08-20T00:00:00.000Z",
				createdBy: { kind: "system", id: "spoofed" },
			}),
			AUTHORITY,
		);

		expect(reply.ok).toBe(true);
		expect(manager.createTask).toHaveBeenCalledWith(
			expect.objectContaining({
				requiresApproval: false,
				createdBy: {
					kind: "user",
					id: "desktop",
					clientId: "desktop",
				},
			}),
		);
	});

	it("routes approval and execution through the manager", async () => {
		const manager = managerMock();
		const service = new HubAgendaTaskCommandService(manager);

		const approved = await service.handleCommand(
			envelope("task.approve", { taskId: "task_1", expectedRevision: 1 }),
			AUTHORITY,
		);
		const started = await service.handleCommand(
			envelope("task.run", { taskId: "task_1", expectedRevision: 1 }),
			AUTHORITY,
		);
		const cancelled = await service.handleCommand(
			envelope("task.cancel", {
				taskId: "task_1",
				expectedRevision: 1,
				reason: "No longer needed",
			}),
			AUTHORITY,
		);

		expect(approved.payload?.task).toMatchObject({ status: "approved" });
		expect(started.payload?.task).toMatchObject({ status: "in_progress" });
		expect(cancelled.payload?.task).toMatchObject({ status: "cancelled" });
		expect(manager.approveTask).toHaveBeenCalledWith(
			"task_1",
			expect.objectContaining({ kind: "user", clientId: "desktop" }),
			1,
		);
		expect(manager.runTask).toHaveBeenCalledWith(
			"task_1",
			expect.objectContaining({ kind: "user", clientId: "desktop" }),
			1,
			"desktop",
		);
		expect(manager.cancelTask).toHaveBeenCalledWith(
			"task_1",
			expect.objectContaining({ kind: "user", clientId: "desktop" }),
			1,
			"No longer needed",
		);
	});

	it("rejects task access outside the Hub-authorized workspace", async () => {
		const manager = managerMock();
		const service = new HubAgendaTaskCommandService(manager);
		const reply = await service.handleCommand(
			envelope("task.get", { taskId: "task_1" }),
			{
				clientId: "desktop",
				workspaceContext: { workspaceRoot: "/other-repo" },
			},
		);

		expect(reply).toMatchObject({
			ok: false,
			error: {
				code: "task_command_failed",
				message: "task does not exist in this workspace",
			},
		});
	});

	it("lists and permits access to global tasks from a workspace client", async () => {
		const globalTask = task({
			taskId: "task_global",
			scope: "global",
			workspaceRoot: undefined,
		});
		const manager = managerMock();
		vi.mocked(manager.listTasks).mockImplementation(async (input) =>
			input?.scope === "global" ? [globalTask] : [task()],
		);
		vi.mocked(manager.getTask).mockResolvedValue(globalTask);
		vi.mocked(manager.updateTask).mockResolvedValue(globalTask);
		const service = new HubAgendaTaskCommandService(manager);

		const listed = await service.handleCommand(
			envelope("task.list"),
			AUTHORITY,
		);
		const fetched = await service.handleCommand(
			envelope("task.get", { taskId: globalTask.taskId }),
			AUTHORITY,
		);
		await service.handleCommand(
			envelope("task.update", {
				taskId: globalTask.taskId,
				title: "Updated global task",
			}),
			AUTHORITY,
		);

		expect(listed.payload?.tasks).toEqual([task(), globalTask]);
		expect(fetched.payload?.task).toEqual(globalTask);
		expect(manager.updateTask).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: globalTask.taskId,
				scope: "global",
				workspaceRoot: null,
				cwd: null,
			}),
		);
	});

	it.each([
		"task.approve",
		"task.cancel",
		"task.archive",
		"task.restore",
		"task.delete",
		"task.run",
	] as const)("rejects %s without a revision", async (command) => {
		const manager = managerMock();
		const service = new HubAgendaTaskCommandService(manager);
		const reply = await service.handleCommand(
			envelope(command, { taskId: "task_1" }),
			AUTHORITY,
		);

		expect(reply).toMatchObject({
			ok: false,
			error: {
				code: "task_command_failed",
				message: "expectedRevision must be a positive integer",
			},
		});
	});

	it("returns a structured Hub error for invalid policy input", async () => {
		const service = new HubAgendaTaskCommandService(managerMock());
		const reply = await service.handleCommand(
			envelope("task.automation.set", {}),
			AUTHORITY,
		);

		expect(reply).toMatchObject({
			ok: false,
			error: { code: "task_command_failed" },
		});
	});

	it("binds automation policy access to the Hub-authorized workspace", async () => {
		const manager = managerMock();
		const service = new HubAgendaTaskCommandService(manager);
		await service.handleCommand(envelope("task.automation.get"), AUTHORITY);
		await service.handleCommand(
			envelope("task.automation.set", {
				policy: { ...policy, scopeKey: "/spoofed" },
			}),
			AUTHORITY,
		);

		expect(manager.getAutomationPolicy).toHaveBeenCalledWith(resolve("/repo"));
		expect(manager.setAutomationPolicy).toHaveBeenCalledWith(
			expect.objectContaining({ scopeKey: resolve("/repo") }),
			expect.anything(),
		);
	});

	it("round-trips the default Factory workflow only for trusted clients", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-factory-defaults-cmd-"));
		try {
			const store = new FileFactoryDefaultsStore(
				join(root, "factory-defaults.json"),
			);
			const manager = {
				...managerMock(),
				adoptFactoryBacklog: vi.fn(async () => []),
			};
			const service = new HubAgendaTaskCommandService(manager, store);
			const trusted = { ...AUTHORITY, crossWorkspace: true };
			const recipe = createFactoryWorkflowRecipe({
				name: "Hands-off",
				config: { approval: "automatic", autonomy: "hands_off" },
			});

			// Unregistered and workspace-scoped clients cannot change the default.
			await expect(
				service.handleCommand(
					envelope("task.factory.defaults.set", { workflow: recipe }),
				),
			).resolves.toMatchObject({
				ok: false,
				error: {
					message: "task commands require a Hub-authorized workspace",
				},
			});
			await expect(
				service.handleCommand(
					envelope("task.factory.defaults.set", { workflow: recipe }),
					AUTHORITY,
				),
			).resolves.toMatchObject({
				ok: false,
				error: { message: expect.stringContaining("authenticated local") },
			});
			await expect(
				service.handleCommand(envelope("task.factory.defaults.get")),
			).resolves.toMatchObject({ ok: false });
			await expect(store.getDefaultWorkflow()).resolves.toBeUndefined();

			await expect(
				service.handleCommand(
					envelope("task.factory.defaults.set", { workflow: recipe }),
					trusted,
				),
			).resolves.toMatchObject({ ok: true, payload: { workflow: recipe } });
			// A new default lets never-scoped backlog adopt it and start.
			expect(manager.adoptFactoryBacklog).toHaveBeenCalledTimes(1);
			await expect(
				service.handleCommand(envelope("task.factory.defaults.get"), AUTHORITY),
			).resolves.toMatchObject({ ok: true, payload: { workflow: recipe } });

			// An invalid recipe or a missing workflow field is rejected unchanged.
			await expect(
				service.handleCommand(
					envelope("task.factory.defaults.set", {
						workflow: {
							...recipe,
							config: { ...recipe.config, approval: "required" },
						},
					}),
					trusted,
				),
			).resolves.toMatchObject({
				ok: false,
				error: {
					message: "Workflow revision does not match its configuration",
				},
			});
			await expect(
				service.handleCommand(envelope("task.factory.defaults.set"), trusted),
			).resolves.toMatchObject({ ok: false });
			await expect(store.getDefaultWorkflow()).resolves.toEqual(recipe);

			await expect(
				service.handleCommand(
					envelope("task.factory.defaults.set", { workflow: null }),
					trusted,
				),
			).resolves.toMatchObject({ ok: true, payload: {} });
			// Rejected sets adopt nothing; clearing does.
			expect(manager.adoptFactoryBacklog).toHaveBeenCalledTimes(2);
			const cleared = await service.handleCommand(
				envelope("task.factory.defaults.get"),
				trusted,
			);
			expect(cleared.ok).toBe(true);
			expect(cleared.payload?.workflow).toBeUndefined();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("sweeps the backlog only for the first or a changed default", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-factory-defaults-sweep-"));
		try {
			const store = new FileFactoryDefaultsStore(
				join(root, "factory-defaults.json"),
			);
			const manager = {
				...managerMock(),
				adoptFactoryBacklog: vi.fn(async () => []),
			};
			const service = new HubAgendaTaskCommandService(manager, store);
			const trusted = { ...AUTHORITY, crossWorkspace: true };
			const set = (workflow: unknown) =>
				service.handleCommand(
					envelope("task.factory.defaults.set", { workflow }),
					trusted,
				);
			const recipe = createFactoryWorkflowRecipe({
				name: "Reviewed",
				config: { approval: "required" },
			});
			// First push, even a clear that changes nothing, establishes the default.
			await set(null);
			expect(manager.adoptFactoryBacklog).toHaveBeenCalledTimes(1);
			await set(null);
			expect(manager.adoptFactoryBacklog).toHaveBeenCalledTimes(1);
			await set(recipe);
			expect(manager.adoptFactoryBacklog).toHaveBeenCalledTimes(2);
			// Each new connection resends the same default.
			await set(recipe);
			await set(recipe);
			expect(manager.adoptFactoryBacklog).toHaveBeenCalledTimes(2);
			await set(null);
			expect(manager.adoptFactoryBacklog).toHaveBeenCalledTimes(3);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("round-trips the Factory working limit, persisting it and changing it only for trusted clients", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-factory-limits-cmd-"));
		try {
			const path = join(root, "factory-defaults.json");
			const store = new FileFactoryDefaultsStore(path);
			let current = 2;
			const manager = {
				...managerMock(),
				getFactoryConcurrency: vi.fn(() => current),
				setFactoryConcurrency: vi.fn((value: number) => {
					current = value;
					return value;
				}),
			};
			const service = new HubAgendaTaskCommandService(manager, store);
			const trusted = { ...AUTHORITY, crossWorkspace: true };

			await expect(
				service.handleCommand(envelope("task.factory.limits.get"), AUTHORITY),
			).resolves.toMatchObject({ ok: true, payload: { concurrency: 2 } });
			// A workspace-scoped client cannot change a limit shared by every project.
			await expect(
				service.handleCommand(
					envelope("task.factory.limits.set", { concurrency: 1 }),
					AUTHORITY,
				),
			).resolves.toMatchObject({
				ok: false,
				error: { message: expect.stringContaining("authenticated local") },
			});
			for (const concurrency of [0, 9, 1.5, "3", undefined])
				await expect(
					service.handleCommand(
						envelope("task.factory.limits.set", { concurrency }),
						trusted,
					),
				).resolves.toMatchObject({
					ok: false,
					error: {
						message: "Factory concurrency must be an integer from 1 to 8",
					},
				});
			expect(manager.setFactoryConcurrency).not.toHaveBeenCalled();
			await expect(store.getConcurrency()).resolves.toBeUndefined();

			await expect(
				service.handleCommand(
					envelope("task.factory.limits.set", { concurrency: 5 }),
					trusted,
				),
			).resolves.toMatchObject({ ok: true, payload: { concurrency: 5 } });
			expect(manager.setFactoryConcurrency).toHaveBeenCalledWith(5);
			await expect(
				service.handleCommand(envelope("task.factory.limits.get"), AUTHORITY),
			).resolves.toMatchObject({ ok: true, payload: { concurrency: 5 } });
			await expect(
				new FileFactoryDefaultsStore(path).getConcurrency(),
			).resolves.toBe(5);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("round-trips the Factory pause beside the limit, alone or with it", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-factory-pause-cmd-"));
		try {
			const path = join(root, "factory-defaults.json");
			const store = new FileFactoryDefaultsStore(path);
			let concurrency = 2;
			let paused = false;
			const manager = {
				...managerMock(),
				getFactoryConcurrency: vi.fn(() => concurrency),
				setFactoryConcurrency: vi.fn((value: number) => {
					concurrency = value;
					return value;
				}),
				getFactoryPaused: vi.fn(() => paused),
				setFactoryPaused: vi.fn((value: boolean) => {
					paused = value;
					return value;
				}),
			};
			const service = new HubAgendaTaskCommandService(manager, store);
			const trusted = { ...AUTHORITY, crossWorkspace: true };

			await expect(
				service.handleCommand(envelope("task.factory.limits.get"), AUTHORITY),
			).resolves.toMatchObject({
				ok: true,
				payload: { concurrency: 2, paused: false },
			});
			await expect(
				service.handleCommand(
					envelope("task.factory.limits.set", { paused: true }),
					AUTHORITY,
				),
			).resolves.toMatchObject({ ok: false });
			await expect(
				service.handleCommand(
					envelope("task.factory.limits.set", { paused: "yes" }),
					trusted,
				),
			).resolves.toMatchObject({ ok: false });
			expect(manager.setFactoryPaused).not.toHaveBeenCalled();

			// Pause alone leaves the limit as it is.
			await expect(
				service.handleCommand(
					envelope("task.factory.limits.set", { paused: true }),
					trusted,
				),
			).resolves.toMatchObject({
				ok: true,
				payload: { concurrency: 2, paused: true },
			});
			expect(manager.setFactoryConcurrency).not.toHaveBeenCalled();
			expect(manager.setFactoryPaused).toHaveBeenCalledWith(true);
			await expect(
				new FileFactoryDefaultsStore(path).getPaused(),
			).resolves.toBe(true);
			// An older client's limit-only set keeps the pause.
			await expect(
				service.handleCommand(
					envelope("task.factory.limits.set", { concurrency: 3 }),
					trusted,
				),
			).resolves.toMatchObject({
				ok: true,
				payload: { concurrency: 3, paused: true },
			});
			await expect(
				service.handleCommand(
					envelope("task.factory.limits.set", {
						concurrency: 4,
						paused: false,
					}),
					trusted,
				),
			).resolves.toMatchObject({
				ok: true,
				payload: { concurrency: 4, paused: false },
			});
			const reread = new FileFactoryDefaultsStore(path);
			await expect(reread.getPaused()).resolves.toBe(false);
			await expect(reread.getConcurrency()).resolves.toBe(4);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
	it("round-trips the daily spending limit, reports today's spend and pushes the stored limit to the manager", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-factory-daily-cmd-"));
		try {
			const path = join(root, "factory-defaults.json");
			const store = new FileFactoryDefaultsStore(path);
			let spent = 12;
			const manager = {
				...managerMock(),
				getFactoryConcurrency: vi.fn(() => 2),
				getFactoryPaused: vi.fn(() => false),
				setFactoryDailyCostUsd: vi.fn((value: number) => value),
				getFactorySpentTodayUsd: vi.fn(async () => spent),
			};
			const service = new HubAgendaTaskCommandService(manager, store);
			const trusted = { ...AUTHORITY, crossWorkspace: true };

			await expect(
				service.handleCommand(envelope("task.factory.limits.get"), AUTHORITY),
			).resolves.toMatchObject({
				ok: true,
				payload: {
					concurrency: 2,
					paused: false,
					dailyCostUsd: 50,
					spentTodayUsd: 12,
					spendingLimitReached: false,
				},
			});
			expect(manager.setFactoryDailyCostUsd).toHaveBeenLastCalledWith(50);
			// Workspace clients cannot change it; invalid amounts are refused.
			await expect(
				service.handleCommand(
					envelope("task.factory.limits.set", { dailyCostUsd: 5 }),
					AUTHORITY,
				),
			).resolves.toMatchObject({ ok: false });
			for (const dailyCostUsd of [0, -3, "5"])
				await expect(
					service.handleCommand(
						envelope("task.factory.limits.set", { dailyCostUsd }),
						trusted,
					),
				).resolves.toMatchObject({ ok: false });
			// Alone, it leaves the working limit and the pause as they are.
			await expect(
				service.handleCommand(
					envelope("task.factory.limits.set", { dailyCostUsd: 10 }),
					trusted,
				),
			).resolves.toMatchObject({
				ok: true,
				payload: {
					concurrency: 2,
					dailyCostUsd: 10,
					spentTodayUsd: 12,
					spendingLimitReached: true,
				},
			});
			expect(manager.setFactoryDailyCostUsd).toHaveBeenLastCalledWith(10);
			await expect(
				new FileFactoryDefaultsStore(path).getDailyCostUsd(),
			).resolves.toBe(10);
			// null restores the default.
			spent = 1;
			await expect(
				service.handleCommand(
					envelope("task.factory.limits.set", { dailyCostUsd: null }),
					trusted,
				),
			).resolves.toMatchObject({
				ok: true,
				payload: { dailyCostUsd: 50, spendingLimitReached: false },
			});
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("hides the fail-closed stand-in workflow from defaults.get", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-factory-corrupt-cmd-"));
		try {
			const path = join(root, "factory-defaults.json");
			writeFileSync(path, "{ corrupt");
			const store = new FileFactoryDefaultsStore(path, {
				logger: { debug: () => {}, log: () => {} },
			});
			const service = new HubAgendaTaskCommandService(managerMock(), store);
			await expect(
				service.handleCommand(envelope("task.factory.defaults.get"), AUTHORITY),
			).resolves.toMatchObject({ ok: true, payload: {} });
			await expect(
				service.handleCommand(envelope("task.factory.limits.get"), AUTHORITY),
			).resolves.toMatchObject({ ok: true, payload: { paused: true } });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("task.factory.audit.resolve", () => {
	it("saves a proposed rule only for a client trusted across workspaces", async () => {
		const analysis = {
			status: "saved" as const,
			trigger: "feedback" as const,
			startedAt: "2026-08-13T00:00:00.000Z",
		};
		const resolveFactoryFeedback = vi.fn(async () => ({
			task: task(),
			analysis,
		}));
		const service = new HubAgendaTaskCommandService({
			...managerMock(),
			resolveFactoryFeedback,
		});
		const save = envelope("task.factory.audit.resolve", {
			taskId: "task_1",
			decision: "save",
			expectedHash: "abc",
		});
		await expect(service.handleCommand(save, AUTHORITY)).resolves.toMatchObject(
			{
				ok: false,
				error: { message: expect.stringContaining("authenticated local") },
			},
		);
		expect(resolveFactoryFeedback).not.toHaveBeenCalled();
		await expect(
			service.handleCommand(save, { ...AUTHORITY, crossWorkspace: true }),
		).resolves.toMatchObject({ ok: true, payload: { analysis } });
		expect(resolveFactoryFeedback).toHaveBeenCalledWith(
			"task_1",
			"save",
			"abc",
		);
		// Discarding writes no guidance, so the card's workspace is enough.
		await expect(
			service.handleCommand(
				envelope("task.factory.audit.resolve", {
					taskId: "task_1",
					decision: "discard",
				}),
				AUTHORITY,
			),
		).resolves.toMatchObject({ ok: true });
		await expect(
			service.handleCommand(
				envelope("task.factory.audit.resolve", {
					taskId: "task_1",
					decision: "apply",
				}),
				AUTHORITY,
			),
		).resolves.toMatchObject({ ok: false });
	});
});

describe("repository stage commands", () => {
	it("lists the checkout's stages and records a trusted client's decision for the shown hash only", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-hub-factory-stages-"));
		const repo = join(root, "repo");
		mkdirSync(join(repo, ".cline/factory"), { recursive: true });
		const stage = {
			id: "no-todo-left",
			name: "No TODO left",
			kind: "command",
			command: "true",
		};
		writeFileSync(
			join(repo, ".cline/factory/stages.json"),
			JSON.stringify({ schemaVersion: 1, stages: [stage] }),
		);
		const manager = new AgendaTaskManager({
			runtime: {
				startSession: vi.fn(async () => ({ sessionId: "unused" })),
				runSession: vi.fn(async () => ({ status: "completed" as const })),
				abortSession: vi.fn(async () => {}),
			},
			dbPath: join(root, "tasks.db"),
			globalSpecsDir: join(root, "specs"),
			watchFiles: false,
			automationEnabled: false,
		});
		const service = new HubAgendaTaskCommandService(manager);
		const scoped = {
			clientId: "desktop",
			crossWorkspace: false,
			workspaceContext: { workspaceRoot: repo, cwd: repo },
		};
		const trusted = { ...AUTHORITY, crossWorkspace: true };
		try {
			const listed = await service.handleCommand(
				envelope("task.factory.stages.get"),
				scoped,
			);
			expect(listed).toMatchObject({
				ok: true,
				payload: {
					file: "present",
					stages: [{ stage, status: "needs_approval" }],
				},
			});
			const hash = (listed.payload as { stages: Array<{ hash: string }> })
				.stages[0]?.hash;
			// Another workspace needs a client trusted across workspaces.
			await expect(
				service.handleCommand(
					envelope("task.factory.stages.get", { workspaceRoot: repo }),
					AUTHORITY,
				),
			).resolves.toMatchObject({ ok: false });
			const decide = (payload: Record<string, unknown>, authority = trusted) =>
				service.handleCommand(
					envelope("task.factory.stages.set", {
						workspaceRoot: repo,
						stageId: stage.id,
						...payload,
					}),
					authority,
				);
			await expect(
				decide({ expectedHash: hash, decision: "approved" }, scoped),
			).resolves.toMatchObject({
				ok: false,
				error: { message: expect.stringContaining("authenticated local") },
			});
			await expect(
				decide({ expectedHash: "0".repeat(64), decision: "approved" }),
			).resolves.toMatchObject({
				ok: false,
				error: { message: expect.stringContaining("changed since") },
			});
			await expect(
				decide({ expectedHash: hash, decision: "approved" }),
			).resolves.toMatchObject({
				ok: true,
				payload: {
					listing: { stages: [{ status: "approved" }] },
					record: { hash, decision: "approved" },
				},
			});
			await expect(
				decide({ expectedHash: hash, decision: "undecided" }),
			).resolves.toMatchObject({
				ok: true,
				payload: { listing: { stages: [{ status: "needs_approval" }] } },
			});
		} finally {
			await manager.dispose();
			rmSync(root, { recursive: true, force: true });
		}
	});
});
