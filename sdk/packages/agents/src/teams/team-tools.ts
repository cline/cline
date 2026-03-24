import { basename, resolve } from "node:path";
import type { LlmsProviders } from "@clinebot/llms";
import { type Tool, validateWithZod, zodToJsonSchema } from "@clinebot/shared";
import { z } from "zod";
import { getClineDefaultSystemPrompt } from "../prompts/cline.js";
import { createTool } from "../tools/create.js";
import type { AgentConfig, AgentHooks, BasicLogger } from "../types.js";
import type {
	AgentTeamsRuntime,
	TeamRunRecord,
	TeamRuntimeState,
	TeamTaskListItem,
} from "./multi-agent.js";

export interface TeamTeammateSpec {
	agentId: string;
	rolePrompt: string;
	modelId?: string;
	maxIterations?: number;
}

const TeamSpawnTeammateInputSchema = z
	.object({
		agentId: z.string().min(1).describe("Teammate identifier"),
		rolePrompt: z
			.string()
			.min(1)
			.describe("System prompt describing teammate role"),
		maxIterations: z
			.number()
			.int()
			.min(1)
			.optional()
			.describe("Max iterations per teammate run for spawn"),
	})
	.strict();

const TeamShutdownTeammateInputSchema = z.object({
	agentId: z.string().min(1).describe("Teammate identifier"),
	reason: z.string().min(1).optional().describe("Optional shutdown reason"),
});

const TeamStatusInputSchema = z.object({});

const TeamCreateTaskInputSchema = z.object({
	title: z.string().min(1).describe("Task title"),
	description: z.string().min(1).describe("Task details"),
	dependsOn: z
		.array(z.string().describe("Dependency task ID"))
		.optional()
		.describe("Array of the dependency task IDs"),
	assignee: z.string().min(1).optional().describe("Optional assignee"),
});

const TeamListTasksInputSchema = z.object({
	status: z
		.enum(["pending", "in_progress", "blocked", "completed"])
		.optional()
		.describe("Optional task status filter"),
	assignee: z.string().min(1).optional().describe("Optional assignee filter"),
	unassignedOnly: z
		.boolean()
		.optional()
		.describe("Only include tasks without an assignee"),
	readyOnly: z
		.boolean()
		.optional()
		.describe("Only include tasks ready to claim now"),
});

const TeamClaimTaskInputSchema = z.object({
	taskId: z.string().describe("Task ID"),
});

const TeamCompleteTaskInputSchema = z.object({
	taskId: z.string().describe("Task ID"),
	summary: z.string().min(1).describe("Completion summary"),
});

const TeamBlockTaskInputSchema = z.object({
	taskId: z.string().describe("Task ID"),
	reason: z.string().min(1).describe("Blocking reason"),
});

const TeamRunTaskInputSchema = z.object({
	agentId: z.string().describe("Teammate agent ID"),
	task: z.string().min(1).describe("Task instructions for the teammate"),
	taskId: z.string().optional().describe("Optional shared task list ID"),
	runMode: z
		.enum(["sync", "async"])
		.optional()
		.describe(
			"Execution mode: sync waits for result; async returns a runId immediately",
		),
	continueConversation: z
		.boolean()
		.optional()
		.describe(
			"If true, continue the teammate conversation; otherwise start fresh",
		),
});

const TeamListRunsInputSchema = z.object({
	status: z
		.enum([
			"queued",
			"running",
			"completed",
			"failed",
			"cancelled",
			"interrupted",
		])
		.nullable()
		.optional()
		.describe("Optional run status filter. Omit to include all statuses."),
	agentId: z
		.string()
		.min(1)
		.nullable()
		.optional()
		.describe("Optional teammate ID filter. Omit to include all teammates."),
	includeCompleted: z
		.boolean()
		.optional()
		.nullable()
		.describe("Include completed/failed runs (default true)"),
});

const TeamCancelRunInputSchema = z.object({
	runId: z.string().min(1).describe("Run ID"),
	reason: z.string().min(1).optional().describe("Optional cancellation reason"),
});

const TeamAwaitRunInputSchema = z.object({
	runId: z.string().min(1).describe("Async run ID to await"),
});

const TeamAwaitAllRunsInputSchema = z.object({});

const TeamSendMessageInputSchema = z.object({
	toAgentId: z.string().min(1).describe("Recipient agent ID"),
	subject: z.string().min(1).describe("Message subject"),
	body: z.string().min(1).describe("Message body"),
	taskId: z.string().min(1).optional().describe("Optional task ID context"),
});

const TeamBroadcastInputSchema = z.object({
	subject: z.string().min(1).describe("Message subject"),
	body: z.string().min(1).describe("Message body"),
	taskId: z.string().min(1).optional().describe("Optional task ID context"),
	includeLead: z
		.boolean()
		.optional()
		.describe("Include the lead agent in broadcast recipients"),
});

const TeamReadMailboxInputSchema = z.object({
	unreadOnly: z
		.boolean()
		.optional()
		.describe("Only unread messages for read action (default true)"),
	limit: z
		.number()
		.int()
		.min(1)
		.max(100)
		.optional()
		.describe("Optional max number of messages for read action"),
});

const TeamLogUpdateInputSchema = z.object({
	kind: z.enum(["progress", "handoff", "blocked", "decision", "done", "error"]),
	summary: z.string().min(1).describe("Update summary"),
	taskId: z.string().min(1).optional().describe("Optional task ID context"),
	evidence: z
		.array(z.string().min(1))
		.optional()
		.describe("Optional evidence links/snippets"),
	nextAction: z.string().min(1).optional().describe("Planned next step"),
});

const TeamCleanupInputSchema = z.object({});

const DEFAULT_OUTCOME_REQUIRED_SECTIONS = [
	"current_state",
	"boundary_analysis",
	"interface_proposal",
];
const TEAM_AWAIT_TIMEOUT_MS = 60 * 60 * 1000;
const TEAM_RUN_MESSAGE_PREVIEW_LIMIT = 240;
const TEAM_RUN_TEXT_PREVIEW_LIMIT = 400;

export interface TeamRunResultSummary {
	textPreview: string;
	iterations: number;
	finishReason: string;
	durationMs: number;
	usage: {
		inputTokens: number;
		outputTokens: number;
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
		totalCost?: number;
	};
}

export interface TeamRunToolSummary {
	id: string;
	agentId: string;
	taskId?: string;
	status: TeamRunRecord["status"];
	messagePreview: string;
	priority: number;
	retryCount: number;
	maxRetries: number;
	nextAttemptAt?: Date;
	continueConversation?: boolean;
	startedAt: Date;
	endedAt?: Date;
	leaseOwner?: string;
	heartbeatAt?: Date;
	lastProgressAt?: Date;
	lastProgressMessage?: string;
	currentActivity?: string;
	error?: string;
	resultSummary?: TeamRunResultSummary;
}

function truncateText(value: string, maxLength: number): string {
	const normalized = value.replace(/\s+/g, " ").trim();
	if (normalized.length <= maxLength) {
		return normalized;
	}
	return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function summarizeRunResult(
	run: TeamRunRecord,
): TeamRunResultSummary | undefined {
	if (!run.result) {
		return undefined;
	}
	return {
		textPreview: truncateText(run.result.text, TEAM_RUN_TEXT_PREVIEW_LIMIT),
		iterations: run.result.iterations,
		finishReason: run.result.finishReason,
		durationMs: run.result.durationMs,
		usage: {
			inputTokens: run.result.usage.inputTokens,
			outputTokens: run.result.usage.outputTokens,
			cacheReadTokens: run.result.usage.cacheReadTokens,
			cacheWriteTokens: run.result.usage.cacheWriteTokens,
			totalCost: run.result.usage.totalCost,
		},
	};
}

function summarizeRun(run: TeamRunRecord): TeamRunToolSummary {
	return {
		id: run.id,
		agentId: run.agentId,
		taskId: run.taskId,
		status: run.status,
		messagePreview: truncateText(run.message, TEAM_RUN_MESSAGE_PREVIEW_LIMIT),
		priority: run.priority,
		retryCount: run.retryCount,
		maxRetries: run.maxRetries,
		nextAttemptAt: run.nextAttemptAt,
		continueConversation: run.continueConversation,
		startedAt: run.startedAt,
		endedAt: run.endedAt,
		leaseOwner: run.leaseOwner,
		heartbeatAt: run.heartbeatAt,
		lastProgressAt: run.lastProgressAt,
		lastProgressMessage: run.lastProgressMessage,
		currentActivity: run.currentActivity,
		error: run.error,
		resultSummary: summarizeRunResult(run),
	};
}

const TeamCreateOutcomeInputSchema = z.object({
	title: z.string().describe("Outcome title"),
	requiredSections: z
		.array(z.string())
		.default(DEFAULT_OUTCOME_REQUIRED_SECTIONS)
		.describe(
			"Required sections for finalization gate (defaults to current_state,boundary_analysis,interface_proposal)",
		),
});

const TeamAttachOutcomeFragmentInputSchema = z.object({
	outcomeId: z.string().describe("Outcome ID"),
	section: z.string().describe("Section name"),
	sourceRunId: z.string().optional().describe("Optional source run ID"),
	content: z.string().describe("Section fragment content"),
});

const TeamReviewOutcomeFragmentInputSchema = z.object({
	fragmentId: z.string().describe("Fragment ID"),
	approved: z.boolean().describe("Review decision"),
});

const TeamFinalizeOutcomeInputSchema = z.object({
	outcomeId: z.string().describe("Outcome ID"),
});

const TeamListOutcomesInputSchema = z.object({});

type TeamSpawnTeammateInput = z.infer<typeof TeamSpawnTeammateInputSchema>;
type TeamShutdownTeammateInput = z.infer<
	typeof TeamShutdownTeammateInputSchema
>;
type TeamStatusInput = z.infer<typeof TeamStatusInputSchema>;
type TeamCreateTaskInput = z.infer<typeof TeamCreateTaskInputSchema>;
type TeamListTasksInput = z.infer<typeof TeamListTasksInputSchema>;
type TeamClaimTaskInput = z.infer<typeof TeamClaimTaskInputSchema>;
type TeamCompleteTaskInput = z.infer<typeof TeamCompleteTaskInputSchema>;
type TeamBlockTaskInput = z.infer<typeof TeamBlockTaskInputSchema>;
type TeamRunTaskInput = z.infer<typeof TeamRunTaskInputSchema>;
type TeamListRunsInput = z.infer<typeof TeamListRunsInputSchema>;
type TeamCancelRunInput = z.infer<typeof TeamCancelRunInputSchema>;
type TeamAwaitRunInput = z.infer<typeof TeamAwaitRunInputSchema>;
type TeamAwaitAllRunsInput = z.infer<typeof TeamAwaitAllRunsInputSchema>;
type TeamSendMessageInput = z.infer<typeof TeamSendMessageInputSchema>;
type TeamBroadcastInput = z.infer<typeof TeamBroadcastInputSchema>;
type TeamReadMailboxInput = z.infer<typeof TeamReadMailboxInputSchema>;
type TeamLogUpdateInput = z.infer<typeof TeamLogUpdateInputSchema>;
type TeamCleanupInput = z.infer<typeof TeamCleanupInputSchema>;
type TeamCreateOutcomeInput = z.infer<typeof TeamCreateOutcomeInputSchema>;
type TeamAttachOutcomeFragmentInput = z.infer<
	typeof TeamAttachOutcomeFragmentInputSchema
>;
type TeamReviewOutcomeFragmentInput = z.infer<
	typeof TeamReviewOutcomeFragmentInputSchema
>;
type TeamFinalizeOutcomeInput = z.infer<typeof TeamFinalizeOutcomeInputSchema>;
type TeamListOutcomesInput = z.infer<typeof TeamListOutcomesInputSchema>;

export interface TeamTeammateRuntimeConfig {
	providerId: string;
	modelId: string;
	cwd?: string;
	apiKey?: string;
	baseUrl?: string;
	headers?: Record<string, string>;
	providerConfig?: LlmsProviders.ProviderConfig;
	knownModels?: Record<string, LlmsProviders.ModelInfo>;
	thinking?: boolean;
	clineWorkspaceMetadata?: string;
	clineIdeName?: string;
	maxIterations?: number;
	hooks?: AgentHooks;
	extensions?: AgentConfig["extensions"];
	logger?: BasicLogger;
}

export interface CreateAgentTeamsToolsOptions {
	runtime: AgentTeamsRuntime;
	requesterId: string;
	teammateRuntime: TeamTeammateRuntimeConfig;
	createBaseTools?: () => Tool[];
	allowSpawn?: boolean;
}

export interface BootstrapAgentTeamsOptions {
	runtime: AgentTeamsRuntime;
	teammateRuntime: TeamTeammateRuntimeConfig;
	createBaseTools?: () => Tool[];
	leadAgentId?: string;
	restoredTeammates?: TeamTeammateSpec[];
	restoredFromPersistence?: boolean;
}

export interface BootstrapAgentTeamsResult {
	tools: Tool[];
	restoredFromPersistence: boolean;
	restoredTeammates: string[];
}

function buildFallbackWorkspaceMetadata(cwd: string): string {
	const rootPath = resolve(cwd);
	return `# Workspace Configuration\n${JSON.stringify(
		{
			workspaces: {
				[rootPath]: {
					hint: basename(rootPath),
				},
			},
		},
		null,
		2,
	)}`;
}

function buildTeammateSystemPrompt(
	spec: TeamTeammateSpec,
	teammateRuntime: TeamTeammateRuntimeConfig,
): string {
	if (teammateRuntime.providerId !== "cline") {
		return spec.rolePrompt;
	}
	const cwd = teammateRuntime.cwd?.trim() || process.cwd();
	const metadata =
		teammateRuntime.clineWorkspaceMetadata?.trim() ||
		buildFallbackWorkspaceMetadata(cwd);
	const rolePrompt = spec.rolePrompt.trim();
	const teammateRules = rolePrompt ? `# Team Teammate Role\n${rolePrompt}` : "";
	return getClineDefaultSystemPrompt(
		teammateRuntime.clineIdeName?.trim() || "Terminal Shell",
		cwd,
		metadata,
		teammateRules,
	);
}

function spawnTeamTeammate(
	options: Omit<CreateAgentTeamsToolsOptions, "requesterId" | "allowSpawn"> & {
		requesterId: string;
		spec: TeamTeammateSpec;
	},
): void {
	const teammateTools: Tool[] = [];
	if (options.createBaseTools) {
		teammateTools.push(...options.createBaseTools());
	}
	teammateTools.push(
		...createAgentTeamsTools({
			runtime: options.runtime,
			requesterId: options.spec.agentId,
			teammateRuntime: options.teammateRuntime,
			createBaseTools: options.createBaseTools,
			allowSpawn: false,
		}),
	);
	options.runtime.spawnTeammate({
		agentId: options.spec.agentId,
		config: {
			providerId: options.teammateRuntime.providerId,
			modelId: options.spec.modelId ?? options.teammateRuntime.modelId,
			apiKey: options.teammateRuntime.apiKey,
			baseUrl: options.teammateRuntime.baseUrl,
			headers: options.teammateRuntime.headers,
			providerConfig: options.teammateRuntime.providerConfig,
			knownModels: options.teammateRuntime.knownModels,
			thinking: options.teammateRuntime.thinking,
			systemPrompt: buildTeammateSystemPrompt(
				options.spec,
				options.teammateRuntime,
			),
			maxIterations:
				options.spec.maxIterations ?? options.teammateRuntime.maxIterations,
			tools: teammateTools,
			hooks: options.teammateRuntime.hooks,
			extensions: options.teammateRuntime.extensions,
			logger: options.teammateRuntime.logger,
		},
	});
}

export function bootstrapAgentTeams(
	options: BootstrapAgentTeamsOptions,
): BootstrapAgentTeamsResult {
	const leadAgentId = options.leadAgentId ?? "lead";
	const restoredFromPersistence = options.restoredFromPersistence === true;

	const tools = createAgentTeamsTools({
		runtime: options.runtime,
		requesterId: leadAgentId,
		teammateRuntime: options.teammateRuntime,
		createBaseTools: options.createBaseTools,
		allowSpawn: true,
	});

	const restoredTeammates: string[] = [];
	for (const spec of options.restoredTeammates ?? []) {
		if (options.runtime.isTeammateActive(spec.agentId)) {
			continue;
		}
		spawnTeamTeammate({
			runtime: options.runtime,
			requesterId: leadAgentId,
			teammateRuntime: options.teammateRuntime,
			createBaseTools: options.createBaseTools,
			spec,
		});
		restoredTeammates.push(spec.agentId);
	}

	return {
		tools,
		restoredFromPersistence,
		restoredTeammates,
	};
}

export function createAgentTeamsTools(
	options: CreateAgentTeamsToolsOptions,
): Tool[] {
	const allowSpawn = options.allowSpawn ?? true;
	const tools: Tool[] = [];

	tools.push(
		createTool<TeamSpawnTeammateInput, { agentId: string; status: string }>({
			name: "team_spawn_teammate",
			description: "Spawn a teammate with a required agentId and rolePrompt.",
			inputSchema: zodToJsonSchema(TeamSpawnTeammateInputSchema),
			execute: async (input) => {
				const validatedInput = validateWithZod(
					TeamSpawnTeammateInputSchema,
					input,
				);
				if (options.runtime.getMemberRole(options.requesterId) !== "lead") {
					throw new Error("Only the lead agent can manage teammates.");
				}
				if (!allowSpawn) {
					throw new Error("Spawning teammates is disabled in this context.");
				}
				const spec: TeamTeammateSpec = {
					agentId: validatedInput.agentId,
					rolePrompt: validatedInput.rolePrompt,
					maxIterations: validatedInput.maxIterations,
				};
				spawnTeamTeammate({
					runtime: options.runtime,
					requesterId: options.requesterId,
					teammateRuntime: options.teammateRuntime,
					createBaseTools: options.createBaseTools,
					spec,
				});
				return { agentId: validatedInput.agentId, status: "spawned" };
			},
		}) as Tool,
	);

	tools.push(
		createTool<TeamShutdownTeammateInput, { agentId: string; status: string }>({
			name: "team_shutdown_teammate",
			description: "Shutdown a teammate by agentId.",
			inputSchema: zodToJsonSchema(TeamShutdownTeammateInputSchema),
			execute: async (input) => {
				const validatedInput = validateWithZod(
					TeamShutdownTeammateInputSchema,
					input,
				);
				if (options.runtime.getMemberRole(options.requesterId) !== "lead") {
					throw new Error("Only the lead agent can manage teammates.");
				}
				options.runtime.shutdownTeammate(
					validatedInput.agentId,
					validatedInput.reason,
				);
				return { agentId: validatedInput.agentId, status: "stopped" };
			},
		}) as Tool,
	);

	tools.push(
		createTool<TeamStatusInput, ReturnType<AgentTeamsRuntime["getSnapshot"]>>({
			name: "team_status",
			description:
				"Return a snapshot of team members, task counts, mailbox, and mission log stats.",
			inputSchema: zodToJsonSchema(TeamStatusInputSchema),
			execute: async (input) => {
				validateWithZod(TeamStatusInputSchema, input);
				return options.runtime.getSnapshot();
			},
		}) as Tool,
	);

	tools.push(
		createTool<TeamCreateTaskInput, { taskId: string; status: string }>({
			name: "team_create_task",
			description: "Create a shared team task with title and description.",
			inputSchema: zodToJsonSchema(TeamCreateTaskInputSchema),
			execute: async (input) => {
				const validatedInput = validateWithZod(
					TeamCreateTaskInputSchema,
					input,
				);
				const task = options.runtime.createTask({
					title: validatedInput.title,
					description: validatedInput.description,
					dependsOn: validatedInput.dependsOn,
					assignee: validatedInput.assignee,
					createdBy: options.requesterId,
				});
				return { taskId: task.id, status: task.status };
			},
		}) as Tool,
	);

	tools.push(
		createTool<TeamListTasksInput, TeamTaskListItem[]>({
			name: "team_list_tasks",
			description:
				"List shared team tasks, including whether each task is ready to claim and which dependencies still block it.",
			inputSchema: zodToJsonSchema(TeamListTasksInputSchema),
			execute: async (input) => {
				const validatedInput = validateWithZod(TeamListTasksInputSchema, input);
				return options.runtime.listTaskItems({
					status: validatedInput.status,
					assignee: validatedInput.assignee,
					unassignedOnly: validatedInput.unassignedOnly,
					readyOnly: validatedInput.readyOnly,
				});
			},
		}) as Tool,
	);

	tools.push(
		createTool<
			TeamClaimTaskInput,
			{ taskId: string; status: string; nextStep: string }
		>({
			name: "team_claim_task",
			description: "Claim a task by taskId.",
			inputSchema: zodToJsonSchema(TeamClaimTaskInputSchema),
			execute: async (input) => {
				const validatedInput = validateWithZod(TeamClaimTaskInputSchema, input);
				const task = options.runtime.claimTask(
					validatedInput.taskId,
					options.requesterId,
				);
				return {
					taskId: task.id,
					status: task.status,
					nextStep:
						"Task is now in_progress. Execute the work using team_run_task or your own tools, then call team_complete_task when done.",
				};
			},
		}) as Tool,
	);

	tools.push(
		createTool<TeamCompleteTaskInput, { taskId: string; status: string }>({
			name: "team_complete_task",
			description: "Complete a task by taskId and provide a summary.",
			inputSchema: zodToJsonSchema(TeamCompleteTaskInputSchema),
			execute: async (input) => {
				const validatedInput = validateWithZod(
					TeamCompleteTaskInputSchema,
					input,
				);
				const task = options.runtime.completeTask(
					validatedInput.taskId,
					options.requesterId,
					validatedInput.summary,
				);
				return { taskId: task.id, status: task.status };
			},
		}) as Tool,
	);

	tools.push(
		createTool<TeamBlockTaskInput, { taskId: string; status: string }>({
			name: "team_block_task",
			description: "Block a task by taskId with a reason.",
			inputSchema: zodToJsonSchema(TeamBlockTaskInputSchema),
			execute: async (input) => {
				const validatedInput = validateWithZod(TeamBlockTaskInputSchema, input);
				const task = options.runtime.blockTask(
					validatedInput.taskId,
					options.requesterId,
					validatedInput.reason,
				);
				return { taskId: task.id, status: task.status };
			},
		}) as Tool,
	);

	tools.push(
		createTool<
			TeamRunTaskInput,
			{
				agentId: string;
				mode: "sync" | "async";
				runId?: string;
				text?: string;
				iterations?: number;
			}
		>({
			name: "team_run_task",
			description:
				"Route a delegated task to a teammate. Choose sync (wait) or async (run in background).",
			inputSchema: zodToJsonSchema(TeamRunTaskInputSchema),
			execute: async (input) => {
				const validatedInput = validateWithZod(TeamRunTaskInputSchema, input);
				if (validatedInput.runMode === "async") {
					const run = options.runtime.startTeammateRun(
						validatedInput.agentId,
						validatedInput.task,
						{
							taskId: validatedInput.taskId,
							fromAgentId: options.requesterId,
							continueConversation: validatedInput.continueConversation,
						},
					);
					return {
						agentId: validatedInput.agentId,
						mode: "async",
						runId: run.id,
					};
				}
				const result = await options.runtime.routeToTeammate(
					validatedInput.agentId,
					validatedInput.task,
					{
						taskId: validatedInput.taskId,
						fromAgentId: options.requesterId,
						continueConversation: validatedInput.continueConversation,
					},
				);
				return {
					agentId: validatedInput.agentId,
					mode: "sync",
					text: result.text,
					iterations: result.iterations,
				};
			},
		}) as Tool,
	);

	tools.push(
		createTool<TeamCancelRunInput, { runId: string; status: string }>({
			name: "team_cancel_run",
			description: "Cancel one async teammate run.",
			inputSchema: zodToJsonSchema(TeamCancelRunInputSchema),
			execute: async (input) => {
				const validatedInput = validateWithZod(TeamCancelRunInputSchema, input);
				const run = options.runtime.cancelRun(
					validatedInput.runId,
					validatedInput.reason,
				);
				return { runId: run.id, status: run.status };
			},
		}) as Tool,
	);

	tools.push(
		createTool<TeamListRunsInput, TeamRunToolSummary[]>({
			name: "team_list_runs",
			description:
				"List teammate runs started with team_run_task in async mode, including live activity/progress fields when available.",
			inputSchema: zodToJsonSchema(TeamListRunsInputSchema),
			execute: async (input) =>
				options.runtime
					.listRuns(validateWithZod(TeamListRunsInputSchema, input))
					.map(summarizeRun),
		}) as Tool,
	);

	tools.push(
		createTool<TeamAwaitRunInput, TeamRunToolSummary>({
			name: "team_await_run",
			description:
				"Wait for one async run by runId. Uses a long timeout for legitimate teammate work.",
			inputSchema: zodToJsonSchema(TeamAwaitRunInputSchema),
			timeoutMs: TEAM_AWAIT_TIMEOUT_MS,
			execute: async (input) => {
				const validatedInput = validateWithZod(TeamAwaitRunInputSchema, input);
				const run = await options.runtime.awaitRun(validatedInput.runId);
				if (run.status === "failed") {
					throw new Error(
						`Run "${run.id}" failed${run.error ? `: ${run.error}` : ""}`,
					);
				}
				if (run.status === "cancelled") {
					throw new Error(
						`Run "${run.id}" was cancelled${run.error ? `: ${run.error}` : ""}`,
					);
				}
				if (run.status === "interrupted") {
					throw new Error(
						`Run "${run.id}" was interrupted${run.error ? `: ${run.error}` : ""}`,
					);
				}
				return summarizeRun(run);
			},
		}) as Tool,
	);

	tools.push(
		createTool<TeamAwaitAllRunsInput, TeamRunToolSummary[]>({
			name: "team_await_all_runs",
			description:
				"Wait for all active async runs to complete. Uses a long timeout for legitimate teammate work.",
			inputSchema: zodToJsonSchema(TeamAwaitAllRunsInputSchema),
			timeoutMs: TEAM_AWAIT_TIMEOUT_MS,
			execute: async (input) => {
				validateWithZod(TeamAwaitAllRunsInputSchema, input);
				const runs = await options.runtime.awaitAllRuns();
				const failedRuns = runs.filter((run) =>
					["failed", "cancelled", "interrupted"].includes(run.status),
				);
				if (failedRuns.length > 0) {
					const details = failedRuns
						.map(
							(run) =>
								`${run.id}:${run.status}${run.error ? `(${run.error})` : ""}`,
						)
						.join(", ");
					throw new Error(
						`One or more runs did not complete successfully: ${details}`,
					);
				}
				return runs.map(summarizeRun);
			},
		}) as Tool,
	);

	tools.push(
		createTool<TeamSendMessageInput, { id: string; toAgentId: string }>({
			name: "team_send_message",
			description: "Send a direct mailbox message to one teammate.",
			inputSchema: zodToJsonSchema(TeamSendMessageInputSchema),
			execute: async (input) => {
				const validatedInput = validateWithZod(
					TeamSendMessageInputSchema,
					input,
				);
				const message = options.runtime.sendMessage(
					options.requesterId,
					validatedInput.toAgentId,
					validatedInput.subject,
					validatedInput.body,
					validatedInput.taskId,
				);
				return { id: message.id, toAgentId: message.toAgentId };
			},
		}) as Tool,
	);

	tools.push(
		createTool<TeamBroadcastInput, { delivered: number }>({
			name: "team_broadcast",
			description: "Broadcast a mailbox message to all teammates.",
			inputSchema: zodToJsonSchema(TeamBroadcastInputSchema),
			execute: async (input) => {
				const validatedInput = validateWithZod(TeamBroadcastInputSchema, input);
				const messages = options.runtime.broadcast(
					options.requesterId,
					validatedInput.subject,
					validatedInput.body,
					{
						taskId: validatedInput.taskId,
						includeLead: validatedInput.includeLead,
					},
				);
				return { delivered: messages.length };
			},
		}) as Tool,
	);

	tools.push(
		createTool<
			TeamReadMailboxInput,
			ReturnType<AgentTeamsRuntime["listMailbox"]>
		>({
			name: "team_read_mailbox",
			description: "Read the current agent mailbox.",
			inputSchema: zodToJsonSchema(TeamReadMailboxInputSchema),
			execute: async (input) => {
				const validatedInput = validateWithZod(
					TeamReadMailboxInputSchema,
					input,
				);
				return options.runtime.listMailbox(options.requesterId, {
					unreadOnly: validatedInput.unreadOnly,
					limit: validatedInput.limit,
					markRead: true,
				});
			},
		}) as Tool,
	);

	tools.push(
		createTool<TeamLogUpdateInput, { id: string }>({
			name: "team_log_update",
			description: "Append a mission log update for this agent.",
			inputSchema: zodToJsonSchema(TeamLogUpdateInputSchema),
			execute: async (input) => {
				const validatedInput = validateWithZod(TeamLogUpdateInputSchema, input);
				const entry = options.runtime.appendMissionLog({
					agentId: options.requesterId,
					taskId: validatedInput.taskId,
					kind: validatedInput.kind,
					summary: validatedInput.summary,
					evidence: validatedInput.evidence,
					nextAction: validatedInput.nextAction,
				});
				return { id: entry.id };
			},
		}) as Tool,
	);

	tools.push(
		createTool<TeamCleanupInput, { status: string }>({
			name: "team_cleanup",
			description:
				"Clean up the team runtime. Fails if teammates are still running.",
			inputSchema: zodToJsonSchema(TeamCleanupInputSchema),
			execute: async (input) => {
				validateWithZod(TeamCleanupInputSchema, input);
				if (options.runtime.getMemberRole(options.requesterId) !== "lead") {
					throw new Error("Only the lead agent can run cleanup.");
				}
				options.runtime.cleanup();
				return { status: "cleaned" };
			},
		}) as Tool,
	);

	tools.push(
		createTool<TeamCreateOutcomeInput, { outcomeId: string; status: string }>({
			name: "team_create_outcome",
			description: "Create a converged team outcome.",
			inputSchema: zodToJsonSchema(TeamCreateOutcomeInputSchema),
			execute: async (input) => {
				const validatedInput = validateWithZod(
					TeamCreateOutcomeInputSchema,
					input,
				);
				const outcome = options.runtime.createOutcome({
					title: validatedInput.title,
					requiredSections: validatedInput.requiredSections,
					createdBy: options.requesterId,
				});
				return { outcomeId: outcome.id, status: outcome.status };
			},
		}) as Tool,
	);

	tools.push(
		createTool<
			TeamAttachOutcomeFragmentInput,
			{ fragmentId: string; status: string }
		>({
			name: "team_attach_outcome_fragment",
			description: "Attach a fragment to an outcome section.",
			inputSchema: zodToJsonSchema(TeamAttachOutcomeFragmentInputSchema),
			execute: async (input) => {
				const validatedInput = validateWithZod(
					TeamAttachOutcomeFragmentInputSchema,
					input,
				);
				const fragment = options.runtime.attachOutcomeFragment({
					outcomeId: validatedInput.outcomeId,
					section: validatedInput.section,
					sourceAgentId: options.requesterId,
					sourceRunId: validatedInput.sourceRunId,
					content: validatedInput.content,
				});
				return { fragmentId: fragment.id, status: fragment.status };
			},
		}) as Tool,
	);

	tools.push(
		createTool<
			TeamReviewOutcomeFragmentInput,
			{ fragmentId: string; status: string }
		>({
			name: "team_review_outcome_fragment",
			description: "Review one outcome fragment.",
			inputSchema: zodToJsonSchema(TeamReviewOutcomeFragmentInputSchema),
			execute: async (input) => {
				const validatedInput = validateWithZod(
					TeamReviewOutcomeFragmentInputSchema,
					input,
				);
				const fragment = options.runtime.reviewOutcomeFragment({
					fragmentId: validatedInput.fragmentId,
					reviewedBy: options.requesterId,
					approved: validatedInput.approved,
				});
				return { fragmentId: fragment.id, status: fragment.status };
			},
		}) as Tool,
	);

	tools.push(
		createTool<TeamFinalizeOutcomeInput, { outcomeId: string; status: string }>(
			{
				name: "team_finalize_outcome",
				description: "Finalize one outcome.",
				inputSchema: zodToJsonSchema(TeamFinalizeOutcomeInputSchema),
				execute: async (input) => {
					const validatedInput = validateWithZod(
						TeamFinalizeOutcomeInputSchema,
						input,
					);
					const outcome = options.runtime.finalizeOutcome(
						validatedInput.outcomeId,
					);
					return { outcomeId: outcome.id, status: outcome.status };
				},
			},
		) as Tool,
	);

	tools.push(
		createTool<
			TeamListOutcomesInput,
			ReturnType<AgentTeamsRuntime["listOutcomes"]>
		>({
			name: "team_list_outcomes",
			description: "List team outcomes.",
			inputSchema: zodToJsonSchema(TeamListOutcomesInputSchema),
			execute: async (input) => {
				validateWithZod(TeamListOutcomesInputSchema, input);
				return options.runtime.listOutcomes();
			},
		}) as Tool,
	);

	return tools;
}

export function reviveTeamStateDates(
	state: TeamRuntimeState,
): TeamRuntimeState {
	return {
		...state,
		tasks: state.tasks.map((task) => ({
			...task,
			createdAt: new Date(task.createdAt),
			updatedAt: new Date(task.updatedAt),
		})),
		mailbox: state.mailbox.map((message) => ({
			...message,
			sentAt: new Date(message.sentAt),
			readAt: message.readAt ? new Date(message.readAt) : undefined,
		})),
		missionLog: state.missionLog.map((entry) => ({
			...entry,
			ts: new Date(entry.ts),
		})),
		runs: (state.runs ?? []).map((run) => ({
			...run,
			startedAt: new Date(run.startedAt),
			endedAt: run.endedAt ? new Date(run.endedAt) : undefined,
			nextAttemptAt: run.nextAttemptAt
				? new Date(run.nextAttemptAt)
				: undefined,
			heartbeatAt: run.heartbeatAt ? new Date(run.heartbeatAt) : undefined,
		})),
		outcomes: (state.outcomes ?? []).map((outcome) => ({
			...outcome,
			createdAt: new Date(outcome.createdAt),
			finalizedAt: outcome.finalizedAt
				? new Date(outcome.finalizedAt)
				: undefined,
		})),
		outcomeFragments: (state.outcomeFragments ?? []).map((fragment) => ({
			...fragment,
			createdAt: new Date(fragment.createdAt),
			reviewedAt: fragment.reviewedAt
				? new Date(fragment.reviewedAt)
				: undefined,
		})),
	};
}

export function sanitizeTeamName(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
}
