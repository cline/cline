import type { AgentExtension, AgentTool } from "@cline/shared";
import { createTool, zodToJsonSchema } from "@cline/shared";
import { z } from "zod";
import {
	executeScheduleOperation,
	ScheduledTaskInputSchema,
	type ScheduledTaskResult,
	type ScheduleTaskOperationOptions,
} from "../cron/service/schedule-tool";
import {
	executeTodoTaskOperation,
	TodoTaskInputSchema,
	type TodoTaskOperationOptions,
	type TodoTaskResult,
} from "./agenda-task-tool";

export const TASKS_TOOL_NAME = "tasks";

export const TASKS_SYSTEM_PROMPT_RULE = `# Tasks

Use the \`tasks\` tool to manage durable Todo items and explicitly requested scheduled agent work.

- Use \`kind: "todo"\` for meaningful follow-ups, handoffs, ideas, reminders, and other work that should remain visible after this session. This includes useful work you identify and suggest proactively. Agent-created Todos require user approval; Todos created directly by the user are approved immediately. Todo \`available_at\` controls availability in the list; it never schedules execution.
- Use \`kind: "scheduled"\` only when the user explicitly asks Cline to execute work once at a future time or on a recurrence. One-time schedules require an exact future ISO 8601 \`run_at\` with an offset or Z. Recurring schedules require a five-field \`cron_pattern\` and may include an IANA \`timezone\`.
- "Remind me" is ambiguous: ask whether the user wants a reviewed Todo note or an agent to execute work at that time when intent is unclear.
- Never create both kinds for the same request unless the user explicitly requests both. Check existing items before creating a likely duplicate.
- Todo instructions and scheduled prompts must be self-contained. Include the goal, constraints, relevant project context, and expected output.
- Never approve or start a Todo yourself. Only mutate schedules from an interactive user session, and only update, pause, resume, delete, or run one immediately when the user asks.`;

const TodoRequestSchema = TodoTaskInputSchema.extend({
	kind: z.literal("todo"),
}).strict();

const ScheduledRequestSchema = ScheduledTaskInputSchema.extend({
	kind: z.literal("scheduled"),
}).strict();

export const TasksToolInputSchema = z.discriminatedUnion("kind", [
	TodoRequestSchema,
	ScheduledRequestSchema,
]);

// Anthropic requires a plain object at the top level of a tool input schema and
// rejects the oneOf emitted by a discriminated union. Advertise the union of
// both domains' fields as one object, then retain strict domain validation with
// TasksToolInputSchema inside execute().
const TasksToolProviderInputSchema = z
	.object({
		...ScheduledTaskInputSchema.shape,
		...TodoTaskInputSchema.shape,
		kind: z.enum(["todo", "scheduled"]),
		operation: z.enum([
			"create",
			"update",
			"list",
			"get",
			"pause",
			"resume",
			"delete",
			"run_now",
		]),
	})
	.strict();

export type TasksToolInput = z.infer<typeof TasksToolInputSchema>;

export type TasksToolResult =
	| ({ kind: "todo" } & TodoTaskResult)
	| ({ kind: "scheduled" } & ScheduledTaskResult)
	| {
			ok: false;
			kind?: TasksToolInput["kind"];
			error: { code: "invalid_tasks_input"; message: string };
	  };

export interface CreateTasksToolOptions {
	todo: TodoTaskOperationOptions;
	scheduled: ScheduleTaskOperationOptions;
}

/**
 * One agent-facing task tool backed by distinct Todo and schedule domains.
 * The discriminator selects the domain; each handler retains its own storage,
 * authorization, scope, and execution lifecycle.
 */
export function createTasksTool(
	options: CreateTasksToolOptions,
): AgentTool<TasksToolInput, TasksToolResult> {
	return createTool<TasksToolInput, TasksToolResult>({
		name: TASKS_TOOL_NAME,
		description:
			"Create and manage reviewed Todo items or explicitly requested scheduled agent work. " +
			'Use kind "todo" for durable Agenda items that require user or automation approval. ' +
			'Use kind "scheduled" for one-time or recurring autonomous execution. ' +
			"Todo available_at is not an execution timer; schedules use run_at or cron_pattern.",
		inputSchema: zodToJsonSchema(TasksToolProviderInputSchema),
		retryable: false,
		maxRetries: 0,
		execute: async (rawInput, context) => {
			const parsed = TasksToolInputSchema.safeParse(rawInput);
			if (!parsed.success) {
				return {
					ok: false,
					kind:
						typeof rawInput === "object" &&
						rawInput !== null &&
						"kind" in rawInput &&
						(rawInput.kind === "todo" || rawInput.kind === "scheduled")
							? rawInput.kind
							: undefined,
					error: {
						code: "invalid_tasks_input",
						message: parsed.error.issues[0]?.message ?? "Invalid tasks input",
					},
				};
			}

			if (parsed.data.kind === "todo") {
				const result = await executeTodoTaskOperation(
					options.todo,
					parsed.data,
					context,
				);
				return { kind: "todo", ...result };
			}

			const result = await executeScheduleOperation(
				options.scheduled,
				parsed.data,
				context,
			);
			return { kind: "scheduled", ...result };
		},
	});
}

/** Adds selection and safety guidance only when the unified tool is enabled. */
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
