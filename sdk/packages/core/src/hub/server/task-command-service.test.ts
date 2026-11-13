import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
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
import {
	FACTORY_GUIDANCE_EMPTY_HASH,
	FactoryGuidanceStore,
	factoryGuidanceHash,
} from "../../tasks/factory-guidance";
import { FileFactoryStageTrustStore } from "../../tasks/factory-stages";
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

	it("passes queue-only creation intent to the manager, never a part's parent link, and rejects a nonboolean flag", async () => {
		const manager = managerMock();
		const service = new HubAgendaTaskCommandService(manager);
		const payload = {
			factory: {},
			queueFactoryDesign: false,
			factoryParentTaskId: "task_parent",
		};
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
		expect(vi.mocked(manager.createTask).mock.calls[0]?.[0]).not.toHaveProperty(
			"factoryParentTaskId",
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
		const automatic = await create({ approval: "automatic" });
		expect(automatic).toMatchObject({ publishPullRequest: true });
		// PR follow-up is left to its one default (off: not hands-off).
		expect(automatic?.watchPullRequest).toBeUndefined();
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

	it("lets only a trusted local client approve a breakdown, cancel a parent's parts or start a waiting part", async () => {
		const manager = {
			...managerMock(),
			approveFactorySplit: vi.fn(async () => ({ task: task(), parts: [] })),
			cancelFactoryParts: vi.fn(async () => ({ task: task(), cancelled: [] })),
			startFactoryPartAnyway: vi.fn(async () => task()),
		};
		const service = new HubAgendaTaskCommandService(manager);
		const commands = [
			[
				"task.factory.split.approve",
				{ omit: [1] },
				manager.approveFactorySplit,
			],
			["task.factory.parts.cancel", {}, manager.cancelFactoryParts],
			["task.factory.part.start", {}, manager.startFactoryPartAnyway],
		] as const;
		for (const [command, extra, method] of commands) {
			const payload = { taskId: "task_1", expectedRevision: 1, ...extra };
			const denied = await service.handleCommand(
				envelope(command, payload),
				AUTHORITY,
			);
			expect(denied).toMatchObject({
				ok: false,
				error: {
					message: expect.stringContaining("authenticated local client"),
				},
			});
			expect(method).not.toHaveBeenCalled();
			expect(
				(
					await service.handleCommand(envelope(command, payload), {
						...AUTHORITY,
						crossWorkspace: true,
					})
				).ok,
			).toBe(true);
			expect(method).toHaveBeenCalledWith(
				"task_1",
				...(command === "task.factory.parts.cancel" ? [] : [1]),
				expect.objectContaining({ kind: "user", clientId: "desktop" }),
				...(command === "task.factory.split.approve" ? [[1]] : []),
			);
		}
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

	it("records a client's priority as the person's, on creation and through task.factory.priority", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-hub-factory-priority-"));
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
		const authority = {
			...AUTHORITY,
			workspaceContext: { workspaceRoot: root, cwd: root },
		};
		try {
			const service = new HubAgendaTaskCommandService(manager);
			const created = await service.handleCommand(
				envelope("task.create", {
					type: "follow-up",
					title: "Fix checkout",
					instructions: "Checkout fails",
					expiresAt: "2099-01-01T00:00:00.000Z",
					queueFactoryDesign: false,
					factory: { approval: "required", checks: [] },
					// A client cannot pass itself off as an agent or the scoper.
					factoryPriority: { level: "urgent", by: "scoper", reason: "spoof" },
				}),
				authority,
			);
			const task = created.payload?.task as AgendaTaskRecord;
			expect(task.factoryPriority).toEqual({
				level: "urgent",
				by: "person",
				at: expect.any(String),
			});
			const set = (payload: Record<string, unknown>, scope = authority) =>
				service.handleCommand(
					envelope("task.factory.priority", {
						taskId: task.taskId,
						...payload,
					}),
					scope,
				);
			await expect(set({ priority: "low" })).resolves.toMatchObject({
				ok: true,
				payload: {
					task: {
						revision: task.revision,
						factoryPriority: { level: "low", by: "person" },
					},
				},
			});
			await expect(set({ priority: "soon" })).resolves.toMatchObject({
				ok: false,
			});
			await expect(
				set(
					{ priority: "high" },
					{
						...AUTHORITY,
						workspaceContext: { workspaceRoot: "/other-repo", cwd: "/" },
					},
				),
			).resolves.toMatchObject({
				ok: false,
				error: { message: "task does not exist in this workspace" },
			});
			const cleared = await set({ priority: null });
			expect(
				(cleared.payload?.task as AgendaTaskRecord).factoryPriority,
			).toMatchObject({ level: "none", by: "person" });
		} finally {
			await manager.dispose();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("files Factory cards through the duplicate check and replies with the card that covers a repeat", async () => {
		const root = realpathSync(
			mkdtempSync(join(tmpdir(), "cline-hub-factory-duplicate-")),
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
		const authority = {
			...AUTHORITY,
			workspaceContext: { workspaceRoot: root, cwd: root },
		};
		const service = new HubAgendaTaskCommandService(manager);
		const create = (payload: Record<string, unknown> = {}) =>
			service.handleCommand(
				envelope("task.create", {
					type: "follow-up",
					title: "Fix checkout",
					instructions: "Checkout fails on submit.",
					expiresAt: "2099-01-01T00:00:00.000Z",
					queueFactoryDesign: false,
					factory: { approval: "required", checks: [] },
					...payload,
				}),
				authority,
			);
		try {
			const created = await create();
			expect(Object.keys(created.payload ?? {})).toEqual(["task"]);
			const original = created.payload?.task as AgendaTaskRecord;
			const repeat = await create();
			expect(repeat.payload).toEqual({
				task: expect.objectContaining({ taskId: original.taskId }),
				existing: true,
				duplicateOf: {
					taskId: original.taskId,
					factoryId: "F1",
					title: "Fix checkout",
					state: "On hold",
					at: original.updatedAt,
				},
				reason: "A card with the same title and brief already exists.",
				fileAnyway:
					"pass allow_duplicate: true only if the user says this is different work",
			});
			const allowed = await create({ allowDuplicate: true });
			expect(allowed.payload?.existing).toBeUndefined();
			expect((allowed.payload?.task as AgendaTaskRecord).taskId).not.toBe(
				original.taskId,
			);
			expect(
				(allowed.payload?.task as Record<string, unknown>).allowDuplicate,
			).toBeUndefined();
			await expect(create({ allowDuplicate: "yes" })).resolves.toMatchObject({
				ok: false,
			});
		} finally {
			await manager.dispose();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("round-trips the duplicate check switch beside the limits, on by default", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-factory-duplicate-cmd-"));
		try {
			const path = join(root, "factory-defaults.json");
			const store = new FileFactoryDefaultsStore(path);
			let enabled = true;
			const manager = {
				...managerMock(),
				getFactoryConcurrency: vi.fn(() => 2),
				setFactoryConcurrency: vi.fn((value: number) => value),
				getFactoryPaused: vi.fn(() => false),
				getFactoryDuplicateCheck: vi.fn(() => enabled),
				setFactoryDuplicateCheck: vi.fn((value: boolean) => {
					enabled = value;
					return value;
				}),
			};
			const service = new HubAgendaTaskCommandService(manager, store);
			const trusted = { ...AUTHORITY, crossWorkspace: true };
			await expect(
				service.handleCommand(envelope("task.factory.limits.get"), AUTHORITY),
			).resolves.toMatchObject({ ok: true, payload: { duplicateCheck: true } });
			for (const [scope, value] of [
				[AUTHORITY, false],
				[trusted, "off"],
			] as const)
				await expect(
					service.handleCommand(
						envelope("task.factory.limits.set", { duplicateCheck: value }),
						scope,
					),
				).resolves.toMatchObject({ ok: false });
			// Alone, it leaves the working limit as it is.
			await expect(
				service.handleCommand(
					envelope("task.factory.limits.set", { duplicateCheck: false }),
					trusted,
				),
			).resolves.toMatchObject({
				ok: true,
				payload: { concurrency: 2, duplicateCheck: false },
			});
			expect(manager.setFactoryConcurrency).not.toHaveBeenCalled();
			expect(manager.setFactoryDuplicateCheck).toHaveBeenLastCalledWith(false);
			await expect(
				new FileFactoryDefaultsStore(path).getDuplicateCheck(),
			).resolves.toBe(false);
			await service.handleCommand(
				envelope("task.factory.limits.set", { duplicateCheck: true }),
				trusted,
			);
			await expect(
				new FileFactoryDefaultsStore(path).getDuplicateCheck(),
			).resolves.toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
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
				setFactoryDailyCostUsd: vi.fn((value: number | null) => value),
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
			for (const dailyCostUsd of [-3, "5", 200_000])
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
			// null is "no daily limit", stored and pushed to the manager; 0
			// means the same; a later read reports null, never the default.
			spent = 1_000;
			for (const none of [null, 0]) {
				await expect(
					service.handleCommand(
						envelope("task.factory.limits.set", { dailyCostUsd: none }),
						trusted,
					),
				).resolves.toMatchObject({
					ok: true,
					payload: { dailyCostUsd: null, spendingLimitReached: false },
				});
				expect(manager.setFactoryDailyCostUsd).toHaveBeenLastCalledWith(null);
			}
			await expect(
				service.handleCommand(envelope("task.factory.limits.get"), AUTHORITY),
			).resolves.toMatchObject({
				ok: true,
				payload: { dailyCostUsd: null, spendingLimitReached: false },
			});
			await expect(
				new FileFactoryDefaultsStore(path).getDailyCostUsd(),
			).resolves.toBeNull();
			// Sending the default restores it.
			await expect(
				service.handleCommand(
					envelope("task.factory.limits.set", { dailyCostUsd: 50 }),
					trusted,
				),
			).resolves.toMatchObject({
				ok: true,
				payload: { dailyCostUsd: 50, spendingLimitReached: true },
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

describe("Factory settings commands", () => {
	function settingsHarness() {
		const root = realpathSync.native(
			mkdtempSync(join(tmpdir(), "cline-hub-factory-settings-")),
		);
		const repo = join(root, "repo");
		const elsewhere = join(root, "elsewhere");
		mkdirSync(elsewhere);
		mkdirSync(repo);
		execFileSync("git", ["init", "-q", "-b", "main", repo]);
		execFileSync("git", [
			"-C",
			repo,
			"remote",
			"add",
			"origin",
			"https://user:secret-token@github.com/o/r.git",
		]);
		mkdirSync(join(repo, ".cline/factory"), { recursive: true });
		mkdirSync(join(repo, ".cline/tasks"), { recursive: true });
		writeFileSync(join(repo, ".cline/tasks/one.task.md"), "# One\n");
		writeFileSync(
			join(repo, ".cline/factory/stages.json"),
			JSON.stringify({
				schemaVersion: 1,
				stages: [
					{ id: "lint", name: "Lint", kind: "command", command: "true" },
				],
			}),
		);
		const guidance = new FactoryGuidanceStore(join(root, "factory-guidance"));
		const stageTrust = new FileFactoryStageTrustStore();
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
			factoryGuidance: guidance,
			factoryStageTrust: stageTrust,
		});
		const store = new FileFactoryDefaultsStore(join(root, "defaults.json"));
		const service = new HubAgendaTaskCommandService(manager, store, {
			listProjects: async () => [repo, elsewhere, undefined],
		});
		const scoped = {
			clientId: "desktop",
			crossWorkspace: false,
			workspaceContext: { workspaceRoot: elsewhere, cwd: elsewhere },
		};
		const trusted = { ...scoped, crossWorkspace: true };
		const send = (
			command: HubCommandEnvelope["command"],
			payload: Record<string, unknown>,
			authority: typeof scoped = trusted,
		) => service.handleCommand(envelope(command, payload), authority);
		return {
			root,
			repo,
			elsewhere,
			manager,
			guidance,
			stageTrust,
			store,
			send,
			scoped,
			cleanup: async () => {
				await manager.dispose();
				rmSync(root, { recursive: true, force: true });
			},
		};
	}

	it("reads and edits guidance for a known project, refusing untrusted clients, unknown folders and stale hashes", async () => {
		const h = settingsHarness();
		try {
			await expect(
				h.send("task.factory.guidance.get", { workspaceRoot: h.repo }),
			).resolves.toMatchObject({
				ok: true,
				payload: {
					workspaceRoot: h.repo,
					userScope: true,
					targets: expect.arrayContaining([
						expect.objectContaining({
							role: "builder",
							user: expect.objectContaining({ status: "none" }),
							repository: expect.objectContaining({ status: "none" }),
						}),
					]),
				},
			});
			// Another project needs a client trusted across workspaces; a
			// folder that is not a project Factory knows is never read.
			await expect(
				h.send(
					"task.factory.guidance.get",
					{ workspaceRoot: h.repo },
					h.scoped,
				),
			).resolves.toMatchObject({
				ok: false,
				error: { code: "factory_settings_unauthorized" },
			});
			await expect(
				h.send("task.factory.guidance.get", { workspaceRoot: h.elsewhere }),
			).resolves.toMatchObject({ ok: true });
			await expect(
				h.send("task.factory.guidance.get", { workspaceRoot: h.root }),
			).resolves.toMatchObject({
				ok: false,
				error: { code: "factory_unknown_project" },
			});
			await expect(
				h.send("task.factory.guidance.get", { workspaceRoot: "repo" }),
			).resolves.toMatchObject({
				ok: false,
				error: { code: "factory_unknown_project" },
			});

			const edit = {
				role: "builder",
				scope: "repository",
				workspaceRoot: h.repo,
				expectedHash: FACTORY_GUIDANCE_EMPTY_HASH,
				content: "## Lint\nRun the linter before committing.\n",
			};
			// Writes need a trusted client even in the client's own workspace.
			await expect(
				h.send(
					"task.factory.guidance.set",
					{ ...edit, workspaceRoot: h.elsewhere },
					h.scoped,
				),
			).resolves.toMatchObject({
				ok: false,
				error: { code: "factory_settings_unauthorized" },
			});
			for (const invalid of [
				{ ...edit, role: "operator" },
				{ ...edit, expectedHash: "abc" },
				{ ...edit, path: "/etc/passwd" },
				{ ...edit, scope: "user" },
			])
				await expect(
					h.send("task.factory.guidance.set", invalid),
				).resolves.toMatchObject({
					ok: false,
					error: { code: "factory_settings_invalid_input" },
				});
			await expect(
				h.send("task.factory.guidance.set", {
					...edit,
					role: "manager",
				}),
			).resolves.toMatchObject({
				ok: false,
				error: { code: "factory_guidance_user_level_only" },
			});
			const saved = await h.send("task.factory.guidance.set", edit);
			expect(saved).toMatchObject({
				ok: true,
				payload: {
					target: {
						role: "builder",
						repository: { status: "current", accepted: true, inUse: true },
					},
					entry: { source: { kind: "settings" } },
				},
			});
			await expect(
				h.send("task.factory.guidance.set", {
					...edit,
					content: "## Other\nAgain.\n",
				}),
			).resolves.toMatchObject({
				ok: false,
				error: {
					code: "factory_guidance_stale",
					details: { currentHash: factoryGuidanceHash(edit.content) },
				},
			});
			await expect(
				h.send("task.factory.guidance.history", {
					role: "builder",
					workspaceRoot: h.repo,
				}),
			).resolves.toMatchObject({
				ok: true,
				payload: { more: false, entries: [{ scope: "repository" }] },
			});
			await expect(
				h.send("task.factory.guidance.resolve", {
					role: "builder",
					scope: "repository",
					workspaceRoot: h.repo,
					decision: "accept",
					expectedHash: factoryGuidanceHash(edit.content),
				}),
			).resolves.toMatchObject({
				ok: false,
				error: { code: "factory_guidance_nothing_to_resolve" },
			});
		} finally {
			await h.cleanup();
		}
	});

	it("approves a project's test setup by hash only for a trusted client", async () => {
		const h = settingsHarness();
		try {
			const profile = {
				schemaVersion: 1,
				environment: { start: "bun run dev" },
				exercise: "Open the home page.",
				artifacts: [],
			};
			writeFileSync(
				join(h.repo, ".cline/factory/verification.json"),
				JSON.stringify(profile),
			);
			const read = await h.send("task.factory.verification.get", {
				workspaceRoot: h.repo,
			});
			expect(read).toMatchObject({
				ok: true,
				payload: { status: "proposed", file: "present" },
			});
			const hash = (read.payload as { hash: string }).hash;
			await expect(
				h.send(
					"task.factory.verification.set",
					{
						workspaceRoot: h.elsewhere,
						decision: "approve",
						expectedHash: hash,
					},
					h.scoped,
				),
			).resolves.toMatchObject({
				ok: false,
				error: { code: "factory_settings_unauthorized" },
			});
			await expect(
				h.send("task.factory.verification.set", {
					workspaceRoot: h.repo,
					decision: "approve",
					expectedHash: "0".repeat(64),
				}),
			).resolves.toMatchObject({
				ok: false,
				error: { code: "factory_verification_stale" },
			});
			await expect(
				h.send("task.factory.verification.set", {
					workspaceRoot: h.repo,
					decision: "approve",
					expectedHash: hash,
				}),
			).resolves.toMatchObject({
				ok: true,
				payload: { status: "in_use", origin: "repository" },
			});
			await expect(
				h.send("task.factory.verification.set", {
					workspaceRoot: h.repo,
					decision: "remove",
					profile,
				}),
			).resolves.toMatchObject({
				ok: false,
				error: { code: "factory_settings_invalid_input" },
			});
		} finally {
			await h.cleanup();
		}
	});

	it("resets only what is named, in one project or all, never cards or repository files", async () => {
		const h = settingsHarness();
		try {
			const hash = "a".repeat(64);
			await h.stageTrust.decide(h.repo, "lint", hash, "approved");
			await h.stageTrust.decide(h.elsewhere, "scan", hash, "approved");
			await h.send("task.factory.limits.set", {
				concurrency: 5,
				dailyCostUsd: null,
				duplicateCheck: false,
			});
			await expect(
				h.send("task.factory.reset", { what: "stage_trust" }, h.scoped),
			).resolves.toMatchObject({
				ok: false,
				error: { code: "factory_settings_unauthorized" },
			});
			await expect(
				h.send("task.factory.reset", { what: "everything" }),
			).resolves.toMatchObject({
				ok: false,
				error: { code: "factory_settings_invalid_input" },
			});
			await expect(
				h.send("task.factory.reset", {
					what: "stage_trust",
					workspaceRoot: h.repo,
					dryRun: true,
				}),
			).resolves.toMatchObject({
				ok: true,
				payload: { what: "stage_trust", dryRun: true, stages: 1, projects: 1 },
			});
			await expect(h.stageTrust.get(h.repo)).resolves.toHaveProperty("lint");
			await expect(
				h.send("task.factory.reset", {
					what: "stage_trust",
					workspaceRoot: h.repo,
				}),
			).resolves.toMatchObject({ ok: true, payload: { stages: 1 } });
			await expect(h.stageTrust.get(h.repo)).resolves.toEqual({});
			await expect(h.stageTrust.get(h.elsewhere)).resolves.toHaveProperty(
				"scan",
			);
			expect(existsSync(join(h.repo, ".cline/factory/stages.json"))).toBe(true);
			await expect(
				h.send("task.factory.reset", {
					what: "user_guidance",
					workspaceRoot: h.repo,
				}),
			).resolves.toMatchObject({
				ok: false,
				error: { code: "factory_reset_invalid" },
			});
			await expect(
				h.send("task.factory.reset", { what: "settings" }),
			).resolves.toMatchObject({
				ok: true,
				payload: { concurrency: 2, dailyCostUsd: 50, duplicateCheck: true },
			});
			await expect(h.store.getConcurrency()).resolves.toBe(2);
			await expect(h.store.getDailyCostUsd()).resolves.toBe(50);
			await expect(h.store.getDuplicateCheck()).resolves.toBe(true);
			// The running manager has the reset values too.
			expect(h.manager.getFactoryDailyCostUsd()).toBe(50);
			expect(h.manager.getFactoryDuplicateCheck()).toBe(true);
		} finally {
			await h.cleanup();
		}
	});

	it("runs one removal of finished copies at a time and replies before a long one ends", async () => {
		const h = settingsHarness();
		try {
			const summary = await h.manager.getFactoryStorage();
			const measure = vi.spyOn(
				h.manager as unknown as {
					measureFactoryStorage(refresh: boolean): Promise<unknown>;
				},
				"measureFactoryStorage",
			);
			let finish: (value: unknown) => void = () => {};
			measure.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						finish = resolve;
					}),
			);
			for (let attempt = 0; attempt < 2; attempt++)
				await expect(
					h.manager.cleanFactoryStorage({ waitMs: 0 }),
				).resolves.toMatchObject({
					removed: 0,
					running: true,
					storage: { cleaning: true },
				});
			expect(measure.mock.calls.filter(([refresh]) => refresh)).toHaveLength(1);
			finish({ summary, worktrees: [] });
			await vi.waitFor(async () =>
				expect(await h.manager.getFactoryStorage()).not.toHaveProperty(
					"cleaning",
				),
			);
		} finally {
			await h.cleanup();
		}
	});

	it("lists known projects with their counts, no credentials, and storage for trusted clients", async () => {
		const h = settingsHarness();
		try {
			await expect(
				h.send("task.factory.projects.get", {}, h.scoped),
			).resolves.toMatchObject({
				ok: false,
				error: { code: "factory_settings_unauthorized" },
			});
			const listed = await h.send("task.factory.projects.get", {});
			expect(listed).toMatchObject({
				ok: true,
				payload: {
					userGuidanceChanged: [],
					projects: [
						{
							workspaceRoot: h.repo,
							name: "repo",
							remote: "https://github.com/o/r.git",
							cards: { open: 0, archived: 0 },
							stages: { file: "present", total: 1, inUse: 0, awaiting: 1 },
							verification: "none",
							guidance: { roles: [], changed: [] },
							taskFiles: 1,
						},
					],
				},
			});
			expect(JSON.stringify(listed)).not.toContain("secret-token");
			// Only existing git repositories are projects: not "elsewhere".
			expect((listed.payload as { projects: unknown[] }).projects).toHaveLength(
				1,
			);
			await expect(
				h.send("task.factory.storage.get", {}, h.scoped),
			).resolves.toMatchObject({ ok: false });
			await expect(
				h.send("task.factory.storage.get", { refresh: true }),
			).resolves.toMatchObject({
				ok: true,
				payload: {
					dataDir: h.root,
					worktreesDir: join(h.root, "factory", "factory-worktrees"),
					worktrees: { count: 0, finishedCount: 0 },
				},
			});
			await expect(
				h.send("task.factory.storage.clean", { what: "everything" }),
			).resolves.toMatchObject({
				ok: false,
				error: { code: "factory_settings_invalid_input" },
			});
			await expect(
				h.send("task.factory.storage.clean", { what: "finished_worktrees" }),
			).resolves.toMatchObject({
				ok: true,
				payload: { removed: 0, bytes: 0, storage: { worktrees: { count: 0 } } },
			});
		} finally {
			await h.cleanup();
		}
	});
});
