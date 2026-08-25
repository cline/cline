import { describe, expect, it, vi } from "vitest";
import {
	createTasksPromptExtension,
	createTasksTool,
	TASKS_SYSTEM_PROMPT_RULE,
} from "./task-tool";

const context = {
	sessionId: "session_1",
	agentId: "agent_1",
	iteration: 1,
};

function options() {
	const schedules = {
		listSchedules: vi.fn(() => []),
	};
	return {
		schedules,
		tool: createTasksTool({
			schedules: schedules as never,
			resolveSessionDefaults: async () => ({
				workspaceRoot: process.cwd(),
				interactive: true,
			}),
		}),
	};
}

describe("tasks agent tool", () => {
	it("routes scheduled operations through the schedule service", async () => {
		const { schedules, tool } = options();

		await expect(
			tool.execute({ operation: "list" }, context),
		).resolves.toMatchObject({ ok: true, schedules: [] });
		expect(schedules.listSchedules).toHaveBeenCalledOnce();
	});

	it("advertises an Anthropic-compatible top-level object schema", () => {
		const { tool } = options();
		const schema = tool.inputSchema as Record<string, unknown>;

		expect(schema.type).toBe("object");
		expect(schema).not.toHaveProperty("oneOf");
		expect(schema).not.toHaveProperty("anyOf");
		expect(schema).not.toHaveProperty("allOf");
		expect(schema.required).toEqual(expect.arrayContaining(["operation"]));
		expect(schema.properties).toMatchObject({
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

	it("rejects invalid input", async () => {
		const { tool } = options();
		await expect(
			tool.execute({ operation: "explode" } as never, context),
		).resolves.toMatchObject({
			ok: false,
			error: { code: "invalid_schedule_input" },
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
});
