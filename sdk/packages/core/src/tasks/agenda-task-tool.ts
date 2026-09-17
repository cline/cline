import { resolve } from "node:path";
import type {
	AgendaTaskActor,
	AgendaTaskCreateInput,
	AgendaTaskListInput,
	AgendaTaskPriority,
	AgendaTaskStatus,
	AgendaTaskType,
	AgentTool,
	GatewayModelSelection,
	ITelemetryService,
} from "@cline/shared";
import { z } from "zod";
import { captureToolUsage } from "../services/telemetry/core-events";
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

export const TodoTaskInputSchema = z.object({
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

export type TodoTaskInput = z.infer<typeof TodoTaskInputSchema>;

export interface AgendaTaskSessionDefaults {
	workspaceRoot?: string;
	cwd?: string;
	modelSelection?: GatewayModelSelection;
	originTaskId?: string;
}

export interface TodoTaskOperationOptions {
	manager: AgendaTaskManagerApi;
	telemetry?: ITelemetryService;
	resolveSessionDefaults: (
		sessionId: string,
	) => Promise<AgendaTaskSessionDefaults | undefined>;
}

const MUTATING_OPERATIONS = new Set<TodoTaskInput["operation"]>([
	"create",
	"update",
]);

function captureTodoTaskMutation(
	options: TodoTaskOperationOptions,
	input: TodoTaskInput,
	context: Parameters<AgentTool<TodoTaskInput, TodoTaskResult>["execute"]>[1],
	success: boolean,
): void {
	if (!MUTATING_OPERATIONS.has(input.operation)) return;
	captureToolUsage(options.telemetry, {
		ulid: context.sessionId ?? context.conversationId ?? context.agentId,
		tool: `tasks.todo.${input.operation}`,
		success,
		agentId: context.agentId,
	});
}

export type TodoTaskResult =
	| {
			ok: true;
			operation: TodoTaskInput["operation"];
			task?: Awaited<ReturnType<AgendaTaskManagerApi["getTask"]>>;
			tasks?: Awaited<ReturnType<AgendaTaskManagerApi["listTasks"]>>;
	  }
	| {
			ok: false;
			operation?: TodoTaskInput["operation"];
			error: { code: string; message: string };
	  };

function requiredString(value: string | undefined, field: string): string {
	const normalized = value?.trim();
	if (!normalized) throw new Error(`${field} is required for this operation`);
	return normalized;
}

function modelSelectionOf(
	value: TodoTaskInput["model_selection"],
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
	input: TodoTaskInput,
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

/** Execute a Todo operation while preserving Agenda scope and authority rules. */
export async function executeTodoTaskOperation(
	options: TodoTaskOperationOptions,
	rawInput: unknown,
	context: Parameters<AgentTool<TodoTaskInput, TodoTaskResult>["execute"]>[1],
): Promise<TodoTaskResult> {
	const parsed = TodoTaskInputSchema.safeParse(rawInput);
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
			throw new Error("tasks requires a Hub session");
		}
		const defaults = await options.resolveSessionDefaults(context.sessionId);
		if (!defaults) {
			throw new Error("tasks could not resolve the current session");
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
						modelSelectionOf(input.model_selection) ?? defaults.modelSelection,
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
				const result = {
					ok: true,
					operation: input.operation,
					task: await options.manager.createTask(createInput),
				} as const;
				captureTodoTaskMutation(options, input, context, true);
				return result;
			}
			case "update": {
				const taskId = requiredString(input.task_id, "task_id");
				assertSessionScope(await options.manager.getTask(taskId), defaults);
				if (!input.expected_revision) {
					throw new Error("expected_revision is required for update");
				}
				const result = {
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
				} as const;
				captureTodoTaskMutation(options, input, context, true);
				return result;
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
		captureTodoTaskMutation(options, input, context, false);
		return {
			ok: false,
			operation: input.operation,
			error: {
				code: "task_operation_failed",
				message: error instanceof Error ? error.message : String(error),
			},
		};
	}
}
