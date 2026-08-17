import type { AgendaTaskRecord } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import type { AgendaTaskManagerApi } from "./agenda-task-api";
import {
	createTodoListPromptExtension,
	createTodoListTool,
	TODO_LIST_SYSTEM_PROMPT_RULE,
} from "./agenda-task-tool";

function task(overrides: Partial<AgendaTaskRecord> = {}): AgendaTaskRecord {
	return {
		taskId: "task_1",
		type: "todo",
		status: "pending_approval",
		title: "Review the change",
		instructions: "Review it carefully.",
		scope: "workspace",
		workspaceRoot: "/repo",
		resourcePaths: [],
		priority: 2,
		availableAt: "2035-01-01T00:00:00.000Z",
		expiresAt: "2035-01-02T00:00:00.000Z",
		automationEligible: true,
		revision: 1,
		createdBy: { kind: "agent" },
		updatedBy: { kind: "agent" },
		createdAt: "2035-01-01T00:00:00.000Z",
		updatedAt: "2035-01-01T00:00:00.000Z",
		...overrides,
	};
}

function managerMock(): AgendaTaskManagerApi {
	return {
		createTask: vi.fn(async (input) =>
			task({
				title: input.title,
				workspaceRoot: input.workspaceRoot,
				createdBy: input.createdBy,
				updatedBy: input.createdBy,
			}),
		),
		listTasks: vi.fn(async () => []),
		getTask: vi.fn(async () => task()),
		updateTask: vi.fn(async () => task()),
		approveTask: vi.fn(async () => task()),
		cancelTask: vi.fn(async () => task()),
		runTask: vi.fn(async () => ({ task: task() })),
		getAutomationPolicy: vi.fn(async () => ({
			scopeKey: "global",
			mode: "manual" as const,
			applyToAgentCreated: true,
			maxConcurrentRuns: 1,
			maxChainDepth: 1,
			maxStartsPerHour: 20,
			updatedAt: "2035-01-01T00:00:00.000Z",
		})),
		setAutomationPolicy: vi.fn(async (policy) => ({
			...policy,
			updatedAt: "2035-01-01T00:00:00.000Z",
		})),
	};
}

const context = {
	sessionId: "session_1",
	agentId: "agent_1",
	iteration: 1,
};

describe("todo_list", () => {
	it("pins list and create operations to the current session workspace", async () => {
		const manager = managerMock();
		const tool = createTodoListTool({
			manager,
			resolveSessionDefaults: async () => ({
				workspaceRoot: "/repo",
				cwd: "/repo",
			}),
		});

		await expect(
			tool.execute({ operation: "list" }, context),
		).resolves.toMatchObject({
			ok: true,
		});
		expect(manager.listTasks).toHaveBeenCalledWith(
			expect.objectContaining({ scope: "workspace", workspaceRoot: "/repo" }),
		);

		const escaped = await tool.execute(
			{ operation: "list", workspace_root: "/another-repo" },
			context,
		);
		expect(escaped).toMatchObject({
			ok: false,
			error: { code: "task_operation_failed" },
		});
		expect(manager.listTasks).toHaveBeenCalledTimes(1);
	});

	it("cannot inspect another scope or request cancellation", async () => {
		const manager = managerMock();
		vi.mocked(manager.getTask).mockResolvedValueOnce(
			task({ scope: "global", workspaceRoot: undefined }),
		);
		const tool = createTodoListTool({
			manager,
			resolveSessionDefaults: async () => ({ workspaceRoot: "/repo" }),
		});

		expect(
			await tool.execute({ operation: "get", task_id: "global_task" }, context),
		).toMatchObject({ ok: false, error: { code: "task_operation_failed" } });
		expect(
			await tool.execute(
				{ operation: "cancel", task_id: "task_1" } as never,
				context,
			),
		).toMatchObject({ ok: false, error: { code: "invalid_task_input" } });
		expect(manager.cancelTask).not.toHaveBeenCalled();
	});

	it("registers prompt guidance conditional on the todo_list tool", async () => {
		const extension = createTodoListPromptExtension();
		const registerRule = vi.fn();
		await extension.setup?.({ registerRule } as never, {});

		expect(registerRule).toHaveBeenCalledWith({
			id: "agenda-task:todo-list-guidance",
			content: TODO_LIST_SYSTEM_PROMPT_RULE,
			whenToolAvailable: "todo_list",
		});
	});
});
