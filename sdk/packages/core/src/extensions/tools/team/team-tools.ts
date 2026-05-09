import type { AgentResult } from "@clinebot/shared";
import {
	type AgentTool,
	createTool,
	TEAM_AWAIT_TIMEOUT_MS,
	TEAM_RUN_MESSAGE_PREVIEW_LIMIT,
	TEAM_RUN_TEXT_PREVIEW_LIMIT,
	TEAM_TASK_IGNORED_FIELDS_BY_ACTION,
	type TeamAttachOutcomeFragmentInput,
	TeamAttachOutcomeFragmentInputSchema,
	type TeamAwaitRunsInput,
	TeamAwaitRunsInputSchema,
	type TeamBroadcastInput,
	TeamBroadcastInputSchema,
	TeamBroadcastToolResultSchema,
	type TeamCancelRunInput,
	TeamCancelRunInputSchema,
	TeamCancelRunToolResultSchema,
	type TeamCleanupInput,
	TeamCleanupInputSchema,
	TeamCleanupToolResultSchema,
	type TeamCreateOutcomeInput,
	TeamCreateOutcomeInputSchema,
	type TeamCreateOutcomeToolResult,
	TeamCreateOutcomeToolResultSchema,
	type TeamFinalizeOutcomeInput,
	TeamFinalizeOutcomeInputSchema,
	TeamFinalizeOutcomeToolResultSchema,
	type TeamListOutcomesInput,
	TeamListOutcomesInputSchema,
	type TeamListRunsInput,
	TeamListRunsInputSchema,
	type TeamMailboxMessageToolResult,
	TeamMailboxMessageToolResultSchema,
	type TeamMissionLogInput,
	TeamMissionLogInputSchema,
	TeamMissionLogToolResultSchema,
	TeamOutcomeFragmentToolResultSchema,
	type TeamOutcomeToolResult,
	TeamOutcomeToolResultSchema,
	type TeamReadMailboxInput,
	TeamReadMailboxInputSchema,
	type TeamReviewOutcomeFragmentInput,
	TeamReviewOutcomeFragmentInputSchema,
	type TeamRunRecord,
	type TeamRunResultSummary,
	type TeamRunTaskInput,
	TeamRunTaskInputSchema,
	type TeamRunTaskToolResult,
	TeamRunTaskToolResultSchema,
	type TeamRunToolSummary,
	TeamRunToolSummarySchema,
	type TeamRuntimeState,
	type TeamSendMessageInput,
	TeamSendMessageInputSchema,
	TeamSendMessageToolResultSchema,
	type TeamShutdownTeammateInput,
	TeamShutdownTeammateInputSchema,
	TeamSimpleAgentStatusToolResultSchema,
	type TeamSpawnTeammateInput,
	TeamSpawnTeammateInputSchema,
	type TeamStatusInput,
	TeamStatusInputSchema,
	type TeamStatusToolResult,
	TeamStatusToolResultSchema,
	type TeamTaskInput,
	TeamTaskInputSchema,
	type TeamTaskToolResult,
	TeamTaskToolResultSchema,
	type TeamTeammateSpec,
	validateWithZod,
	zodToJsonSchema,
} from "@clinebot/shared";
import {
	buildDelegatedAgentConfig,
	type DelegatedAgentConfigProvider,
	type DelegatedAgentRuntimeConfig,
} from "./delegated-agent";
import type { AgentTeamsRuntime } from "./multi-agent";

function truncateText(value: string, maxLength: number): string {
	const normalized = value.replace(/\s+/g, " ").trim();
	if (normalized.length <= maxLength) {
		return normalized;
	}
	return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function requireInputField<T>(value: T | undefined, field: string): T {
	if (value === undefined) {
		throw new Error(`Missing required field: ${field}`);
	}
	return value;
}

function summarizeRunResult(
	run: TeamRunRecord,
): TeamRunResultSummary | undefined {
	const result = run.result as AgentResult | undefined;
	if (!result) {
		return undefined;
	}
	return {
		textPreview: truncateText(result.text, TEAM_RUN_TEXT_PREVIEW_LIMIT),
		iterations: result.iterations,
		finishReason: result.finishReason,
		durationMs: result.durationMs,
		usage: {
			inputTokens: result.usage.inputTokens,
			outputTokens: result.usage.outputTokens,
			cacheReadTokens: result.usage.cacheReadTokens,
			cacheWriteTokens: result.usage.cacheWriteTokens,
			totalCost: result.usage.totalCost,
		},
	};
}

function dateToIso(value: Date | undefined): string | undefined {
	return value?.toISOString();
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
		nextAttemptAt: dateToIso(run.nextAttemptAt),
		continueConversation: run.continueConversation,
		startedAt: run.startedAt.toISOString(),
		endedAt: dateToIso(run.endedAt),
		leaseOwner: run.leaseOwner,
		heartbeatAt: dateToIso(run.heartbeatAt),
		lastProgressAt: dateToIso(run.lastProgressAt),
		lastProgressMessage: run.lastProgressMessage,
		currentActivity: run.currentActivity,
		error: run.error,
		resultSummary: summarizeRunResult(run),
	};
}

function assertAwaitedRunSucceeded(run: TeamRunRecord): void {
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
}

export type TeamTeammateRuntimeConfig = DelegatedAgentRuntimeConfig;

export interface CreateAgentTeamsToolsOptions {
	runtime: AgentTeamsRuntime;
	requesterId: string;
	teammateConfigProvider: DelegatedAgentConfigProvider;
	createBaseTools?: () => AgentTool[];
	allowSpawn?: boolean;
	includeSpawnTool?: boolean;
	includeManagementTools?: boolean;
	onLeadToolsUnlocked?: (tools: AgentTool[]) => void;
}

export interface BootstrapAgentTeamsOptions {
	runtime: AgentTeamsRuntime;
	teammateConfigProvider: DelegatedAgentConfigProvider;
	createBaseTools?: () => AgentTool[];
	leadAgentId?: string;
	restoredTeammates?: TeamTeammateSpec[];
	restoredFromPersistence?: boolean;
	includeLeadSpawnTool?: boolean;
	includeLeadManagementTools?: boolean;
	onLeadToolsUnlocked?: (tools: AgentTool[]) => void;
}

export interface BootstrapAgentTeamsResult {
	tools: AgentTool[];
	restoredFromPersistence: boolean;
	restoredTeammates: string[];
}

export const TEAM_TOOL_NAMES = [
	"team_spawn_teammate",
	"team_shutdown_teammate",
	"team_status",
	"team_task",
	"team_run_task",
	"team_cancel_run",
	"team_list_runs",
	"team_await_runs",
	"team_send_message",
	"team_broadcast",
	"team_read_mailbox",
	"team_mission_log",
	"team_cleanup",
	"team_create_outcome",
	"team_attach_outcome_fragment",
	"team_review_outcome_fragment",
	"team_finalize_outcome",
	"team_list_outcomes",
] as const;

function spawnTeamTeammate(
	options: Omit<CreateAgentTeamsToolsOptions, "requesterId" | "allowSpawn"> & {
		requesterId: string;
		spec: TeamTeammateSpec;
	},
): void {
	const teammateTools: AgentTool[] = [];
	if (options.createBaseTools) {
		teammateTools.push(...options.createBaseTools());
	}
	teammateTools.push(
		...createAgentTeamsTools({
			runtime: options.runtime,
			requesterId: options.spec.agentId,
			teammateConfigProvider: options.teammateConfigProvider,
			createBaseTools: options.createBaseTools,
			allowSpawn: false,
		}),
	);
	options.runtime.spawnTeammate({
		agentId: options.spec.agentId,
		config: buildDelegatedAgentConfig({
			kind: "teammate",
			prompt: options.spec.rolePrompt,
			role: options.spec.rolePrompt,
			configProvider: options.teammateConfigProvider,
			tools: teammateTools,
			maxIterations: options.spec.maxIterations,
			cwd: options.teammateConfigProvider.getRuntimeConfig().cwd,
		}),
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
		teammateConfigProvider: options.teammateConfigProvider,
		createBaseTools: options.createBaseTools,
		allowSpawn: true,
		includeSpawnTool: options.includeLeadSpawnTool,
		includeManagementTools: options.includeLeadManagementTools,
		onLeadToolsUnlocked: options.onLeadToolsUnlocked,
	});

	const restoredTeammates: string[] = [];
	for (const spec of options.restoredTeammates ?? []) {
		if (options.runtime.isTeammateActive(spec.agentId)) {
			continue;
		}
		spawnTeamTeammate({
			runtime: options.runtime,
			requesterId: leadAgentId,
			teammateConfigProvider: options.teammateConfigProvider,
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
): AgentTool[] {
	const allowSpawn = options.allowSpawn ?? true;
	const includeSpawnTool = options.includeSpawnTool ?? true;
	const includeManagementTools = options.includeManagementTools ?? true;
	const tools: AgentTool[] = [];

	if (includeSpawnTool) {
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
					};
					spawnTeamTeammate({
						runtime: options.runtime,
						requesterId: options.requesterId,
						teammateConfigProvider: options.teammateConfigProvider,
						createBaseTools: options.createBaseTools,
						spec,
					});
					if (!includeManagementTools) {
						options.onLeadToolsUnlocked?.(
							createAgentTeamsTools({
								...options,
								includeSpawnTool: false,
								includeManagementTools: true,
								onLeadToolsUnlocked: undefined,
							}),
						);
					}
					return validateWithZod(TeamSimpleAgentStatusToolResultSchema, {
						agentId: validatedInput.agentId,
						status: "spawned",
					});
				},
			}) as AgentTool,
		);
	}

	if (!includeManagementTools) {
		return tools;
	}

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
				return validateWithZod(TeamSimpleAgentStatusToolResultSchema, {
					agentId: validatedInput.agentId,
					status: "stopped",
				});
			},
		}) as AgentTool,
	);

	tools.push(
		createTool<TeamStatusInput, TeamStatusToolResult>({
			name: "team_status",
			description:
				"Return a snapshot of team members, task counts, mailbox, and mission log stats.",
			inputSchema: zodToJsonSchema(TeamStatusInputSchema),
			execute: async (input) => {
				validateWithZod(TeamStatusInputSchema, input);
				return validateWithZod(
					TeamStatusToolResultSchema,
					options.runtime.getSnapshot(),
				);
			},
		}) as AgentTool,
	);

	tools.push(
		createTool<TeamTaskInput, TeamTaskToolResult>({
			name: "team_task",
			description:
				"Manage shared team tasks with action-specific payloads. " +
				"create requires title and description, with optional dependsOn and assignee. " +
				"list accepts optional status, assignee. " +
				"claim requires taskId. complete requires taskId and summary. block requires taskId and reason. " +
				"Do not include fields from other actions.",
			inputSchema: zodToJsonSchema(TeamTaskInputSchema),
			execute: async (input) => {
				const validatedInput = validateWithZod(TeamTaskInputSchema, input);
				switch (validatedInput.action) {
					case "create": {
						const ignoredFieldSet = new Set(
							TEAM_TASK_IGNORED_FIELDS_BY_ACTION.create ?? [],
						);
						const ignoredFields = Object.entries(
							input as Record<string, unknown>,
						)
							.filter(
								([field, value]) => ignoredFieldSet.has(field) && value != null,
							)
							.map(([field]) => field);
						const task = options.runtime.createTask({
							title: requireInputField(validatedInput.title, "title"),
							description: requireInputField(
								validatedInput.description,
								"description",
							),
							dependsOn: validatedInput.dependsOn,
							assignee: validatedInput.assignee,
							createdBy: options.requesterId,
						});
						return validateWithZod(TeamTaskToolResultSchema, {
							action: "create",
							taskId: task.id,
							status: task.status,
							...(ignoredFields.length > 0
								? {
										ignoredFields,
										note: `Ignored fields for action=create: ${ignoredFields.join(", ")}`,
									}
								: {}),
						});
					}
					case "list":
						return validateWithZod(TeamTaskToolResultSchema, {
							action: "list",
							tasks: options.runtime.listTaskItems({
								status: validatedInput.status,
								assignee: validatedInput.assignee,
							}),
						});
					case "claim": {
						const task = options.runtime.claimTask(
							requireInputField(validatedInput.taskId, "taskId"),
							options.requesterId,
						);
						return validateWithZod(TeamTaskToolResultSchema, {
							action: "claim",
							taskId: task.id,
							status: task.status,
							nextStep:
								"Task is now in_progress. Execute the work using team_run_task or your own tools, then call team_task with action=complete when done.",
						});
					}
					case "complete": {
						const task = options.runtime.completeTask(
							requireInputField(validatedInput.taskId, "taskId"),
							options.requesterId,
							requireInputField(validatedInput.summary, "summary"),
						);
						return validateWithZod(TeamTaskToolResultSchema, {
							action: "complete",
							taskId: task.id,
							status: task.status,
						});
					}
					case "block": {
						const task = options.runtime.blockTask(
							requireInputField(validatedInput.taskId, "taskId"),
							options.requesterId,
							requireInputField(validatedInput.reason, "reason"),
						);
						return validateWithZod(TeamTaskToolResultSchema, {
							action: "block",
							taskId: task.id,
							status: task.status,
						});
					}
				}
			},
		}) as AgentTool,
	);

	// Track in-flight sync runs per agent for dedup
	// (Claude sometimes emits duplicate tool_use blocks in a single response;
	//  duplicate sync calls should await the first dispatched run)
	const pendingSyncRuns = new Map<string, Promise<TeamRunTaskToolResult>>();

	tools.push(
		createTool<TeamRunTaskInput, TeamRunTaskToolResult>({
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
							taskId: validatedInput.taskId || undefined,
							fromAgentId: options.requesterId,
							continueConversation:
								validatedInput.continueConversation || undefined,
						},
					);
					return validateWithZod(TeamRunTaskToolResultSchema, {
						agentId: validatedInput.agentId,
						mode: "async",
						status: "queued",
						dispatched: true,
						message: `Task dispatched to ${validatedInput.agentId} and queued as ${run.id}.`,
						runId: run.id,
					});
				}

				// Deduplication guard: collapse a duplicate sync call for the same
				// agent onto the first in-flight dispatch in this parallel tool-call batch.
				const pendingRun = pendingSyncRuns.get(validatedInput.agentId);
				if (pendingRun) {
					const result = await pendingRun;
					return validateWithZod(TeamRunTaskToolResultSchema, {
						...result,
						status: "joined",
						deduped: true,
						message: `Task for ${validatedInput.agentId} was already dispatched in this tool batch; joined the existing in-flight run.`,
					});
				}
				const runPromise = options.runtime
					.routeToTeammate(validatedInput.agentId, validatedInput.task, {
						taskId: validatedInput.taskId || undefined,
						fromAgentId: options.requesterId,
						continueConversation:
							validatedInput.continueConversation || undefined,
					})
					.then((result) =>
						validateWithZod(TeamRunTaskToolResultSchema, {
							agentId: validatedInput.agentId,
							mode: "sync" as const,
							status: "running" as const,
							dispatched: true,
							message: `Task dispatched to ${validatedInput.agentId} and completed in sync mode.`,
							text: result.text,
							iterations: result.iterations,
						}),
					)
					.finally(() => {
						pendingSyncRuns.delete(validatedInput.agentId);
					});
				pendingSyncRuns.set(validatedInput.agentId, runPromise);
				return await runPromise;
			},
		}) as AgentTool,
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
				return validateWithZod(TeamCancelRunToolResultSchema, {
					runId: run.id,
					status: run.status,
				});
			},
		}) as AgentTool,
	);

	tools.push(
		createTool<TeamListRunsInput, TeamRunToolSummary[]>({
			name: "team_list_runs",
			description:
				"List teammate runs started with team_run_task in async mode, including live activity/progress fields when available.",
			inputSchema: zodToJsonSchema(TeamListRunsInputSchema),
			execute: async (input) =>
				validateWithZod(
					TeamRunToolSummarySchema.array(),
					options.runtime
						.listRuns(validateWithZod(TeamListRunsInputSchema, input))
						.map(summarizeRun),
				),
		}) as AgentTool,
	);

	tools.push(
		createTool<TeamAwaitRunsInput, TeamRunToolSummary | TeamRunToolSummary[]>({
			name: "team_await_runs",
			description:
				"Wait for async teammate runs. Provide runId to wait for one run, or omit it to wait for all active async runs. Uses a long timeout for legitimate teammate work.",
			inputSchema: zodToJsonSchema(TeamAwaitRunsInputSchema),
			timeoutMs: TEAM_AWAIT_TIMEOUT_MS,
			execute: async (input) => {
				const validatedInput = validateWithZod(TeamAwaitRunsInputSchema, input);
				if (validatedInput.runId) {
					const run = await options.runtime.awaitRun(validatedInput.runId);
					assertAwaitedRunSucceeded(run);
					return validateWithZod(TeamRunToolSummarySchema, summarizeRun(run));
				}
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
				return validateWithZod(
					TeamRunToolSummarySchema.array(),
					runs.map(summarizeRun),
				);
			},
		}) as AgentTool,
	);

	tools.push(
		createTool<TeamSendMessageInput, { id: string; toAgentId: string }>({
			name: "team_send_message",
			description: "Send a mailbox message to a specific teammate.",
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
					validatedInput.taskId ?? undefined,
				);
				return validateWithZod(TeamSendMessageToolResultSchema, {
					id: message.id,
					toAgentId: message.toAgentId,
				});
			},
		}) as AgentTool,
	);

	tools.push(
		createTool<TeamBroadcastInput, { delivered: number }>({
			name: "team_broadcast",
			description: "Broadcast a message to all teammates.",
			inputSchema: zodToJsonSchema(TeamBroadcastInputSchema),
			execute: async (input) => {
				const validatedInput = validateWithZod(TeamBroadcastInputSchema, input);
				const messages = options.runtime.broadcast(
					options.requesterId,
					validatedInput.subject,
					validatedInput.body,
					{
						taskId: validatedInput.taskId ?? undefined,
					},
				);
				return validateWithZod(TeamBroadcastToolResultSchema, {
					delivered: messages.length,
				});
			},
		}) as AgentTool,
	);

	tools.push(
		createTool<TeamReadMailboxInput, TeamMailboxMessageToolResult[]>({
			name: "team_read_mailbox",
			description: "Read the current agent mailbox.",
			inputSchema: zodToJsonSchema(TeamReadMailboxInputSchema),
			execute: async (input) => {
				const validatedInput = validateWithZod(
					TeamReadMailboxInputSchema,
					input,
				);
				return validateWithZod(
					TeamMailboxMessageToolResultSchema.array(),
					options.runtime.listMailbox(options.requesterId, {
						unreadOnly: validatedInput.unreadOnly,
						markRead: true,
					}),
				);
			},
		}) as AgentTool,
	);

	tools.push(
		createTool<TeamMissionLogInput, { id: string }>({
			name: "team_mission_log",
			description: "Append a mission log update for your team.",
			inputSchema: zodToJsonSchema(TeamMissionLogInputSchema),
			execute: async (input) => {
				const validatedInput = validateWithZod(
					TeamMissionLogInputSchema,
					input,
				);
				const entry = options.runtime.appendMissionLog({
					agentId: options.requesterId,
					taskId: validatedInput.taskId || undefined,
					kind: validatedInput.kind,
					summary: validatedInput.summary,
					evidence: validatedInput.evidence?.length
						? validatedInput.evidence
						: undefined,
					nextAction: validatedInput.nextAction || undefined,
				});
				return validateWithZod(TeamMissionLogToolResultSchema, {
					id: entry.id,
				});
			},
		}) as AgentTool,
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
				return validateWithZod(TeamCleanupToolResultSchema, {
					status: "cleaned",
				});
			},
		}) as AgentTool,
	);

	tools.push(
		createTool<TeamCreateOutcomeInput, TeamCreateOutcomeToolResult>({
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
				return validateWithZod(TeamCreateOutcomeToolResultSchema, {
					outcomeId: outcome.id,
					status: outcome.status,
					requiredSections: outcome.requiredSections,
				});
			},
		}) as AgentTool,
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
					sourceRunId: validatedInput.sourceRunId || undefined,
					content: validatedInput.content,
				});
				return validateWithZod(TeamOutcomeFragmentToolResultSchema, {
					fragmentId: fragment.id,
					status: fragment.status,
				});
			},
		}) as AgentTool,
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
				return validateWithZod(TeamOutcomeFragmentToolResultSchema, {
					fragmentId: fragment.id,
					status: fragment.status,
				});
			},
		}) as AgentTool,
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
					return validateWithZod(TeamFinalizeOutcomeToolResultSchema, {
						outcomeId: outcome.id,
						status: outcome.status,
					});
				},
			},
		) as AgentTool,
	);

	tools.push(
		createTool<TeamListOutcomesInput, TeamOutcomeToolResult[]>({
			name: "team_list_outcomes",
			description: "List team outcomes.",
			inputSchema: zodToJsonSchema(TeamListOutcomesInputSchema),
			execute: async (input) => {
				validateWithZod(TeamListOutcomesInputSchema, input);
				return validateWithZod(
					TeamOutcomeToolResultSchema.array(),
					options.runtime.listOutcomes(),
				);
			},
		}) as AgentTool,
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
