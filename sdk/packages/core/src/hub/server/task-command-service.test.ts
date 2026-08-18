import type {
	AgendaAutomationPolicy,
	AgendaTaskRecord,
	HubCommandEnvelope,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import type { AgendaTaskManagerApi } from "../../tasks/agenda-task-api";
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
		);
		const started = await service.handleCommand(
			envelope("task.run", { taskId: "task_1", expectedRevision: 1 }),
		);
		const cancelled = await service.handleCommand(
			envelope("task.cancel", {
				taskId: "task_1",
				expectedRevision: 1,
				reason: "No longer needed",
			}),
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

	it.each([
		"task.approve",
		"task.cancel",
		"task.run",
	] as const)("rejects %s without a revision", async (command) => {
		const manager = managerMock();
		const service = new HubAgendaTaskCommandService(manager);
		const reply = await service.handleCommand(
			envelope(command, { taskId: "task_1" }),
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
		);

		expect(reply).toMatchObject({
			ok: false,
			error: { code: "task_command_failed" },
		});
	});
});
