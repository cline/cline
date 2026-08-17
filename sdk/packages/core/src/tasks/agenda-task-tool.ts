import { resolve } from "node:path";
import type {
	AgendaTaskActor,
	AgendaTaskCreateInput,
	AgendaTaskListInput,
	AgendaTaskPriority,
	AgendaTaskStatus,
	AgendaTaskType,
	AgentExtension,
	AgentTool,
	GatewayModelSelection,
} from "@cline/shared";
import { createTool } from "@cline/shared";
import { z } from "zod";
import type { AgendaTaskManagerApi } from "./agenda-task-api";

const TaskTypeSchema = z.enum([
	"suggestion",
	"follow-up",
	"todo",
	"handoff",
	"idea",
	"reminder",
]);
const TaskStatusSchema = z.enum([
	"pending_approval",
	"approved",
	"in_progress",
	"completed",
	"failed",
	"cancelled",
	"expired",
]);
const TaskPrioritySchema = z.union([
	z.literal(0),
	z.literal(1),
	z.literal(2),
	z.literal(3),
	z.literal(4),
	z.literal(5),
]);
const ModelSelectionSchema = z.object({
	provider_id: z.string().min(1),
	model_id: z.string().min(1).optional(),
});

export const TODO_LIST_TOOL_NAME = "todo_list";

export const TODO_LIST_SYSTEM_PROMPT_RULE = `# Todo list

Use the \`todo_list\` tool to preserve meaningful work that should remain on the user's agenda after this session.

- Near completion, consider whether you discovered concrete follow-up work that is useful but outside the completed scope. Create a \`follow-up\` task when appropriate; do not create one merely to restate work you already finished.
- Create a \`handoff\` task when another agent or person should continue. Make its instructions self-contained: summarize completed work and current state, give exact next steps, and include relevant files, pull requests, commands, blockers, and risks.
- Use \`reminder\` for a time-sensitive item that belongs on the user's reviewed Agenda, and \`suggestion\` or \`idea\` only when it provides durable value. \`todo_list\` is not a clock: \`available_at\` controls Agenda availability but does not schedule execution. When \`schedule\` is available and the user explicitly wants an agent to run work at a future time or recurrence, use it instead. Ask if "remind me" is ambiguous, and never create both unless requested.
- Give every task a clear title, actionable instructions, an appropriate P0-P5 priority (P0 is most urgent), a future \`expires_at\`, and relevant workspace-relative \`resource_paths\`.
- Never approve or start a task yourself. The user or their explicit automation policy controls execution.`;

export const TodoListInputSchema = z.object({
	operation: z.enum(["create", "update", "list", "get"]),
	task_id: z.string().min(1).optional(),
	expected_revision: z.number().int().positive().optional(),
	type: TaskTypeSchema.optional(),
	title: z.string().min(1).optional(),
	description: z.string().nullable().optional(),
	instructions: z.string().min(1).optional(),
	scope: z.enum(["workspace", "global"]).optional(),
	workspace_root: z.string().min(1).nullable().optional(),
	cwd: z.string().min(1).nullable().optional(),
	resource_paths: z.array(z.string().min(1)).optional(),
	priority: TaskPrioritySchema.optional(),
	assignee: z.string().min(1).nullable().optional(),
	model_selection: ModelSelectionSchema.nullable().optional(),
	mode: z.enum(["act", "plan", "yolo"]).nullable().optional(),
	system_prompt: z.string().nullable().optional(),
	max_iterations: z.number().int().positive().nullable().optional(),
	timeout_seconds: z.number().int().positive().nullable().optional(),
	available_at: z.string().datetime().optional(),
	expires_at: z.string().datetime().optional(),
	automation_eligible: z.boolean().optional(),
	statuses: z.array(TaskStatusSchema).optional(),
	types: z.array(TaskTypeSchema).optional(),
	priorities: z.array(TaskPrioritySchema).optional(),
	limit: z.number().int().positive().max(500).optional(),
});

type TodoListInput = z.infer<typeof TodoListInputSchema>;

export interface AgendaTaskSessionDefaults {
	workspaceRoot?: string;
	cwd?: string;
	modelSelection?: GatewayModelSelection;
	originTaskId?: string;
}

export interface CreateTodoListToolOptions {
	manager: AgendaTaskManagerApi;
	resolveSessionDefaults: (
		sessionId: string,
	) => Promise<AgendaTaskSessionDefaults | undefined>;
}

type TodoListResult =
	| {
			ok: true;
			operation: TodoListInput["operation"];
			task?: Awaited<ReturnType<AgendaTaskManagerApi["getTask"]>>;
			tasks?: Awaited<ReturnType<AgendaTaskManagerApi["listTasks"]>>;
	  }
	| {
			ok: false;
			operation?: TodoListInput["operation"];
			error: { code: string; message: string };
	  };

function requiredString(value: string | undefined, field: string): string {
	const normalized = value?.trim();
	if (!normalized) throw new Error(`${field} is required for this operation`);
	return normalized;
}

function modelSelectionOf(
	value: TodoListInput["model_selection"],
): GatewayModelSelection | null | undefined {
	if (value === undefined || value === null) return value;
	return {
		providerId: value.provider_id,
		modelId: value.model_id,
	};
}

function sameWorkspace(left: string, right: string): boolean {
	return resolve(left) === resolve(right);
}

function assertSessionScope(
	task: Awaited<ReturnType<AgendaTaskManagerApi["getTask"]>>,
	defaults: AgendaTaskSessionDefaults,
): void {
	if (!task) throw new Error("task does not exist");
	if (defaults.workspaceRoot) {
		if (
			task.scope !== "workspace" ||
			!task.workspaceRoot ||
			!sameWorkspace(task.workspaceRoot, defaults.workspaceRoot)
		) {
			throw new Error("task is outside this session's workspace scope");
		}
		return;
	}
	if (task.scope !== "global") {
		throw new Error("task is outside this session's global scope");
	}
}

function assertRequestedScope(
	input: TodoListInput,
	defaults: AgendaTaskSessionDefaults,
): "workspace" | "global" {
	const scope = defaults.workspaceRoot ? "workspace" : "global";
	if (input.scope && input.scope !== scope) {
		throw new Error(`this session can only manage ${scope} tasks`);
	}
	if (input.workspace_root !== undefined) {
		if (
			!defaults.workspaceRoot ||
			input.workspace_root === null ||
			!sameWorkspace(input.workspace_root, defaults.workspaceRoot)
		) {
			throw new Error(`this session can only manage ${scope} tasks`);
		}
	}
	return scope;
}

/**
 * Creates the Hub-backed task management tool available to normal agent
 * sessions. Deliberately excludes approval, cancellation, and run operations: an agent may
 * propose or revise agenda work, while the user (or an explicit automation
 * policy) remains the approval authority.
 */
export function createTodoListTool(
	options: CreateTodoListToolOptions,
): AgentTool<TodoListInput, TodoListResult> {
	return createTool({
		name: TODO_LIST_TOOL_NAME,
		description:
			"Create, edit, inspect, or list file-backed agenda tasks in this session's scope. " +
			"Use this for meaningful follow-up work, reminders, handoffs, ideas, or todos that should remain visible after this session. " +
			"Every task needs an expiry timestamp. This tool cannot approve, cancel, or start tasks; those actions belong to the user or their explicit automation policy.",
		inputSchema: TodoListInputSchema,
		retryable: false,
		maxRetries: 0,
		execute: async (rawInput, context) => {
			const parsed = TodoListInputSchema.safeParse(rawInput);
			if (!parsed.success) {
				return {
					ok: false,
					error: {
						code: "invalid_task_input",
						message: parsed.error.issues[0]?.message ?? "Invalid task input",
					},
				};
			}
			const input = parsed.data;
			const actor: AgendaTaskActor = {
				kind: "agent",
				id: context.agentId,
				agentId: context.agentId,
				sessionId: context.sessionId,
			};
			try {
				if (!context.sessionId) {
					throw new Error("todo_list requires a Hub session");
				}
				const defaults = await options.resolveSessionDefaults(
					context.sessionId,
				);
				if (!defaults) {
					throw new Error("todo_list could not resolve the current session");
				}
				const sessionScope = assertRequestedScope(input, defaults);
				switch (input.operation) {
					case "create": {
						const createInput: AgendaTaskCreateInput = {
							type: requiredString(input.type, "type") as AgendaTaskType,
							title: requiredString(input.title, "title"),
							description: input.description ?? undefined,
							instructions: requiredString(input.instructions, "instructions"),
							scope: sessionScope,
							workspaceRoot: defaults.workspaceRoot,
							cwd:
								sessionScope === "workspace"
									? (input.cwd ?? defaults.cwd)?.trim() || undefined
									: undefined,
							resourcePaths: input.resource_paths,
							priority: input.priority,
							assignee: input.assignee ?? undefined,
							modelSelection:
								modelSelectionOf(input.model_selection) ??
								defaults.modelSelection,
							mode: input.mode ?? undefined,
							systemPrompt: input.system_prompt ?? undefined,
							maxIterations: input.max_iterations ?? undefined,
							timeoutSeconds: input.timeout_seconds ?? undefined,
							availableAt: input.available_at,
							expiresAt: requiredString(input.expires_at, "expires_at"),
							automationEligible: input.automation_eligible,
							createdBy: actor,
							originSessionId: context.sessionId,
							originTaskId: defaults.originTaskId,
						};
						return {
							ok: true,
							operation: input.operation,
							task: await options.manager.createTask(createInput),
						};
					}
					case "update": {
						const taskId = requiredString(input.task_id, "task_id");
						assertSessionScope(await options.manager.getTask(taskId), defaults);
						if (!input.expected_revision) {
							throw new Error("expected_revision is required for update");
						}
						return {
							ok: true,
							operation: input.operation,
							task: await options.manager.updateTask({
								taskId,
								expectedRevision: input.expected_revision,
								type: input.type,
								title: input.title,
								description: input.description,
								instructions: input.instructions,
								scope: sessionScope,
								workspaceRoot: defaults.workspaceRoot ?? null,
								cwd: input.cwd,
								resourcePaths: input.resource_paths,
								priority: input.priority,
								assignee: input.assignee,
								modelSelection: modelSelectionOf(input.model_selection),
								mode: input.mode,
								systemPrompt: input.system_prompt,
								maxIterations: input.max_iterations,
								timeoutSeconds: input.timeout_seconds,
								availableAt: input.available_at,
								expiresAt: input.expires_at,
								automationEligible: input.automation_eligible,
								updatedBy: actor,
							}),
						};
					}
					case "list": {
						const filters: AgendaTaskListInput = {
							statuses: input.statuses as AgendaTaskStatus[] | undefined,
							types: input.types as AgendaTaskType[] | undefined,
							scope: sessionScope,
							workspaceRoot: defaults.workspaceRoot,
							priorities: input.priorities as AgendaTaskPriority[] | undefined,
							automationEligible: input.automation_eligible,
							limit: input.limit,
						};
						return {
							ok: true,
							operation: input.operation,
							tasks: await options.manager.listTasks(filters),
						};
					}
					case "get": {
						const task = await options.manager.getTask(
							requiredString(input.task_id, "task_id"),
						);
						assertSessionScope(task, defaults);
						return {
							ok: true,
							operation: input.operation,
							task,
						};
					}
				}
			} catch (error) {
				return {
					ok: false,
					operation: input.operation,
					error: {
						code: "task_operation_failed",
						message: error instanceof Error ? error.message : String(error),
					},
				};
			}
		},
	});
}

/**
 * Adds usage guidance only when the paired todo_list tool survives the
 * session's enabled-tool filtering.
 */
export function createTodoListPromptExtension(): AgentExtension {
	return {
		name: "agenda-task-todo-list-guidance",
		manifest: { capabilities: ["rules"] },
		setup: (api) => {
			api.registerRule({
				id: "agenda-task:todo-list-guidance",
				content: TODO_LIST_SYSTEM_PROMPT_RULE,
				whenToolAvailable: TODO_LIST_TOOL_NAME,
			});
		},
	};
}
