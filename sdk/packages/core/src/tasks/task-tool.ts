import type { AgentExtension, AgentTool } from "@cline/shared";
import { createTool, zodToJsonSchema } from "@cline/shared";
import {
	executeScheduleOperation,
	type ScheduledTaskInput,
	ScheduledTaskInputSchema,
	type ScheduledTaskResult,
	type ScheduleTaskOperationOptions,
} from "../cron/service/schedule-tool";

export const TASKS_TOOL_NAME = "tasks";

export const TASKS_SYSTEM_PROMPT_RULE = `# Tasks

Use the \`tasks\` tool only when the user explicitly asks Cline to execute work once at a future time or on a recurrence.

- One-time schedules require an exact future ISO 8601 \`run_at\` with an offset or Z. Recurring schedules require a five-field \`cron_pattern\` and may include an IANA \`timezone\`.
- Never create a schedule proactively. Check existing schedules before creating a likely duplicate.
- Make the scheduled \`prompt\` self-contained because it runs in a new unattended session. Include the goal, constraints, relevant project context, and expected output.
- Inherit the current workspace and model unless the user explicitly requests a different model. Only update, pause, resume, delete, or run a schedule immediately when the user asks for that action.`;

export type TasksToolInput = ScheduledTaskInput;

export type TasksToolResult = ScheduledTaskResult;

/** Agent-facing tool for explicitly requested scheduled work. */
export function createTasksTool(
	options: ScheduleTaskOperationOptions,
): AgentTool<TasksToolInput, TasksToolResult> {
	return createTool<TasksToolInput, TasksToolResult>({
		name: TASKS_TOOL_NAME,
		description:
			"Create and manage explicitly requested scheduled agent work: " +
			"one-time schedules use a future ISO 8601 run_at and recurring schedules use a five-field cron_pattern.",
		inputSchema: zodToJsonSchema(ScheduledTaskInputSchema.strict()),
		retryable: false,
		maxRetries: 0,
		execute: async (rawInput, context) =>
			await executeScheduleOperation(options, rawInput, context),
	});
}

/** Adds selection and safety guidance only when the tasks tool is enabled. */
export function createTasksPromptExtension(): AgentExtension {
	return {
		name: "hub-task-guidance",
		manifest: { capabilities: ["rules"] },
		setup: (api) => {
			api.registerRule({
				id: "hub:task-guidance",
				content: TASKS_SYSTEM_PROMPT_RULE,
				whenToolAvailable: TASKS_TOOL_NAME,
			});
		},
	};
}
