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

/** Guidance used while the Todo kind is disabled and only schedules remain. */
export const SCHEDULED_TASKS_SYSTEM_PROMPT_RULE = `# Tasks

Use the \`tasks\` tool only when the user explicitly asks Cline to execute work once at a future time or on a recurrence. Always pass \`kind: "scheduled"\`.

- One-time schedules require an exact future ISO 8601 \`run_at\` with an offset or Z. Recurring schedules require a five-field \`cron_pattern\` and may include an IANA \`timezone\`.
- Never create a schedule proactively. Check existing schedules before creating a likely duplicate.
- Make the scheduled \`prompt\` self-contained because it runs in a new unattended session. Include the goal, constraints, relevant project context, and expected output.
- Only update, pause, resume, delete, or run a schedule immediately when the user asks for that action.`;

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

const ScheduledOnlyTasksToolInputSchema = z.discriminatedUnion("kind", [
	ScheduledRequestSchema,
]);

const TASKS_OPERATIONS = [
	"create",
	"update",
	"list",
	"get",
	"pause",
	"resume",
	"delete",
	"run_now",
] as const;

// Anthropic requires a plain object at the top level of a tool input schema and
// rejects the oneOf emitted by a discriminated union. Advertise the union of
// the enabled domains' fields as one object, then retain strict domain
// validation inside execute().
const TasksToolProviderInputSchema = z
	.object({
		...ScheduledTaskInputSchema.shape,
		...TodoTaskInputSchema.shape,
		kind: z.enum(["todo", "scheduled"]),
		operation: z.enum(TASKS_OPERATIONS),
	})
	.strict();

const ScheduledOnlyTasksToolProviderInputSchema = z
	.object({
		...ScheduledTaskInputSchema.shape,
		kind: z.enum(["scheduled"]),
		operation: z.enum(TASKS_OPERATIONS),
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
	/**
	 * Omit to disable the Todo kind: the tool then advertises and accepts only
	 * `kind: "scheduled"` while the Agenda backend stays intact for hosts that
	 * re-enable it.
	 */
	todo?: TodoTaskOperationOptions;
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
	const todoOptions = options.todo;
	return createTool<TasksToolInput, TasksToolResult>({
		name: TASKS_TOOL_NAME,
		description: todoOptions
			? "Create and manage reviewed Todo items or explicitly requested scheduled agent work. " +
				'Use kind "todo" for durable Agenda items that require user or automation approval. ' +
				'Use kind "scheduled" for one-time or recurring autonomous execution. ' +
				"Todo available_at is not an execution timer; schedules use run_at or cron_pattern."
			: 'Create and manage explicitly requested scheduled agent work with kind "scheduled". ' +
				"One-time schedules use a future ISO 8601 run_at; recurring schedules use a five-field cron_pattern.",
		inputSchema: zodToJsonSchema(
			todoOptions
				? TasksToolProviderInputSchema
				: ScheduledOnlyTasksToolProviderInputSchema,
		),
		retryable: false,
		maxRetries: 0,
		execute: async (rawInput, context) => {
			const parsed = (
				todoOptions ? TasksToolInputSchema : ScheduledOnlyTasksToolInputSchema
			).safeParse(rawInput);
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
				if (!todoOptions) {
					return {
						ok: false,
						kind: "todo",
						error: {
							code: "invalid_tasks_input",
							message: 'kind "todo" is not available in this session',
						},
					};
				}
				const result = await executeTodoTaskOperation(
					todoOptions,
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
export function createTasksPromptExtension(options?: {
	todoEnabled?: boolean;
}): AgentExtension {
	return {
		name: "hub-task-guidance",
		manifest: { capabilities: ["rules"] },
		setup: (api) => {
			api.registerRule({
				id: "hub:task-guidance",
				content:
					options?.todoEnabled === false
						? SCHEDULED_TASKS_SYSTEM_PROMPT_RULE
						: TASKS_SYSTEM_PROMPT_RULE,
				whenToolAvailable: TASKS_TOOL_NAME,
			});
		},
	};
}
