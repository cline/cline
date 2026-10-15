import { describe, expect, it, vi } from "vitest";
import {
	createTasksPromptExtension,
	createTasksTool,
	SCHEDULED_TASKS_SYSTEM_PROMPT_RULE,
	TASKS_SYSTEM_PROMPT_RULE,
} from "./task-tool";

const context = {
	sessionId: "session_1",
	agentId: "agent_1",
	iteration: 1,
};

function options() {
	const manager = {
		listTasks: vi.fn(async () => []),
	};
	const schedules = {
		listSchedules: vi.fn(() => []),
	};
	return {
		manager,
		schedules,
		tool: createTasksTool({
			todo: {
				manager: manager as never,
				resolveSessionDefaults: async () => ({
					workspaceRoot: process.cwd(),
				}),
			},
			scheduled: {
				schedules: schedules as never,
				resolveSessionDefaults: async () => ({
					workspaceRoot: process.cwd(),
					interactive: true,
				}),
			},
		}),
	};
}

describe("tasks agent tool", () => {
	it("routes Todo and scheduled operations through one tool", async () => {
		const { manager, schedules, tool } = options();

		await expect(
			tool.execute({ kind: "todo", operation: "list" }, context),
		).resolves.toMatchObject({ ok: true, kind: "todo", tasks: [] });
		expect(manager.listTasks).toHaveBeenCalledOnce();

		await expect(
			tool.execute({ kind: "scheduled", operation: "list" }, context),
		).resolves.toMatchObject({ ok: true, kind: "scheduled", schedules: [] });
		expect(schedules.listSchedules).toHaveBeenCalledOnce();
	});

	it("advertises an Anthropic-compatible top-level object schema", () => {
		const { tool } = options();
		const schema = tool.inputSchema as Record<string, unknown>;

		expect(schema.type).toBe("object");
		expect(schema).not.toHaveProperty("oneOf");
		expect(schema).not.toHaveProperty("anyOf");
		expect(schema).not.toHaveProperty("allOf");
		expect(schema.required).toEqual(
			expect.arrayContaining(["kind", "operation"]),
		);
		expect(schema.properties).toMatchObject({
			kind: { enum: ["todo", "scheduled"] },
			operation: {
				enum: [
					"create",
					"update",
					"list",
					"get",
					"pause",
					"resume",
					"delete",
					"run_now",
				],
			},
		});
	});

	it("rejects missing and mixed domain discriminators", async () => {
		const { tool } = options();
		await expect(
			tool.execute({ operation: "list" } as never, context),
		).resolves.toMatchObject({
			ok: false,
			error: { code: "invalid_tasks_input" },
		});
		await expect(
			tool.execute(
				{
					kind: "todo",
					operation: "create",
					type: "todo",
					title: "Ambiguous",
					instructions: "Do the work.",
					expires_at: "2035-01-02T00:00:00.000Z",
					run_at: "2035-01-01T00:00:00.000Z",
				} as never,
				context,
			),
		).resolves.toMatchObject({
			ok: false,
			kind: "todo",
			error: { code: "invalid_tasks_input" },
		});
	});

	it("registers one prompt rule conditional on the tasks tool", async () => {
		const extension = createTasksPromptExtension();
		const registerRule = vi.fn();
		await extension.setup?.({ registerRule } as never, {});

		expect(registerRule).toHaveBeenCalledWith({
			id: "hub:task-guidance",
			content: TASKS_SYSTEM_PROMPT_RULE,
			whenToolAvailable: "tasks",
		});
	});

	describe("with the Todo kind disabled", () => {
		function scheduledOnlyOptions() {
			const manager = {
				listTasks: vi.fn(async () => []),
			};
			const schedules = {
				listSchedules: vi.fn(() => []),
			};
			return {
				manager,
				schedules,
				tool: createTasksTool({
					scheduled: {
						schedules: schedules as never,
						resolveSessionDefaults: async () => ({
							workspaceRoot: process.cwd(),
							interactive: true,
						}),
					},
				}),
			};
		}

		it("advertises only the scheduled kind", () => {
			const { tool } = scheduledOnlyOptions();
			const schema = tool.inputSchema as Record<string, unknown>;

			expect(schema.type).toBe("object");
			expect(schema.properties).toMatchObject({
				kind: { enum: ["scheduled"] },
			});
			expect(schema.properties).not.toHaveProperty("title");
			expect(tool.description).not.toContain("Todo");
		});

		it("routes scheduled operations and rejects todo requests", async () => {
			const { manager, schedules, tool } = scheduledOnlyOptions();

			await expect(
				tool.execute({ kind: "scheduled", operation: "list" }, context),
			).resolves.toMatchObject({ ok: true, kind: "scheduled", schedules: [] });
			expect(schedules.listSchedules).toHaveBeenCalledOnce();

			await expect(
				tool.execute({ kind: "todo", operation: "list" } as never, context),
			).resolves.toMatchObject({
				ok: false,
				kind: "todo",
				error: { code: "invalid_tasks_input" },
			});
			expect(manager.listTasks).not.toHaveBeenCalled();
		});

		it("registers the schedule-only prompt rule", async () => {
			const extension = createTasksPromptExtension({ todoEnabled: false });
			const registerRule = vi.fn();
			await extension.setup?.({ registerRule } as never, {});

			expect(registerRule).toHaveBeenCalledWith({
				id: "hub:task-guidance",
				content: SCHEDULED_TASKS_SYSTEM_PROMPT_RULE,
				whenToolAvailable: "tasks",
			});
		});
	});
});
