import type { AgentResult } from "@clinebot/agents";
import {
	createTool,
	TEAM_AWAIT_TIMEOUT_MS,
	TEAM_RUN_MESSAGE_PREVIEW_LIMIT,
	TEAM_RUN_TEXT_PREVIEW_LIMIT,
	type TeamAttachOutcomeFragmentInput,
	TeamAttachOutcomeFragmentInputSchema,
	type TeamAwaitAllRunsInput,
	TeamAwaitAllRunsInputSchema,
	type TeamAwaitRunInput,
	TeamAwaitRunInputSchema,
	type TeamBroadcastInput,
	TeamBroadcastInputSchema,
	type TeamCancelRunInput,
	TeamCancelRunInputSchema,
	type TeamCleanupInput,
	TeamCleanupInputSchema,
	type TeamCreateOutcomeInput,
	TeamCreateOutcomeInputSchema,
	type TeamFinalizeOutcomeInput,
	TeamFinalizeOutcomeInputSchema,
	type TeamListOutcomesInput,
	TeamListOutcomesInputSchema,
	type TeamListRunsInput,
	TeamListRunsInputSchema,
	type TeamLogUpdateInput,
	TeamLogUpdateInputSchema,
	type TeamReadMailboxInput,
	TeamReadMailboxInputSchema,
	type TeamReviewOutcomeFragmentInput,
	TeamReviewOutcomeFragmentInputSchema,
	type TeamRunRecord,
	type TeamRunResultSummary,
	type TeamRunTaskInput,
	TeamRunTaskInputSchema,
	type TeamRunToolSummary,
	type TeamRuntimeState,
	type TeamSendMessageInput,
	TeamSendMessageInputSchema,
	type TeamShutdownTeammateInput,
	TeamShutdownTeammateInputSchema,
	type TeamSpawnTeammateInput,
	TeamSpawnTeammateInputSchema,
	type TeamStatusInput,
	TeamStatusInputSchema,
	type TeamTaskInput,
	TeamTaskInputSchema,
	type TeamTaskToolResult,
	type TeamTeammateSpec,
	type Tool,
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

export type TeamTeammateRuntimeConfig = DelegatedAgentRuntimeConfig;

export interface CreateAgentTeamsToolsOptions {
	runtime: AgentTeamsRuntime;
	requesterId: string;
	teammateConfigProvider: DelegatedAgentConfigProvider;
	createBaseTools?: () => Tool[];
	allowSpawn?: boolean;
	includeSpawnTool?: boolean;
	includeManagementTools?: boolean;
	onLeadToolsUnlocked?: (tools: Tool[]) => void;
}

export interface BootstrapAgentTeamsOptions {
	runtime: AgentTeamsRuntime;
	teammateConfigProvider: DelegatedAgentConfigProvider;
	createBaseTools?: () => Tool[];
	leadAgentId?: string;
	restoredTeammates?: TeamTeammateSpec[];
	restoredFromPersistence?: boolean;
	includeLeadSpawnTool?: boolean;
	includeLeadManagementTools?: boolean;
	onLeadToolsUnlocked?: (tools: Tool[]) => void;
}

export interface BootstrapAgentTeamsResult {
	tools: Tool[];
	restoredFromPersistence: boolean;
	restoredTeammates: string[];
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
): Tool[] {
	const allowSpawn = options.allowSpawn ?? true;
	const includeSpawnTool = options.includeSpawnTool ?? true;
	const includeManagementTools = options.includeManagementTools ?? true;
	const tools: Tool[] = [];

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
						maxIterations: validatedInput.maxIterations,
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
					return { agentId: validatedInput.agentId, status: "spawned" };
				},
			}) as Tool,
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
		createTool<TeamTaskInput, TeamTaskToolResult>({
			name: "team_task",
			description:
				"Manage shared team tasks. Use action=create|list|claim|complete|block.",
			inputSchema: zodToJsonSchema(TeamTaskInputSchema),
			execute: async (input) => {
				const validatedInput = validateWithZod(TeamTaskInputSchema, input);
				switch (validatedInput.action) {
					case "create": {
						const task = options.runtime.createTask({
							title: validatedInput.title!,
							description: validatedInput.description!,
							dependsOn: validatedInput.dependsOn,
							assignee: validatedInput.assignee,
							createdBy: options.requesterId,
						});
						return {
							action: "create",
							taskId: task.id,
							status: task.status,
						};
					}
					case "list":
						return {
							action: "list",
							tasks: options.runtime.listTaskItems({
								status: validatedInput.status,
								assignee: validatedInput.assignee,
								unassignedOnly: validatedInput.unassignedOnly,
								readyOnly: validatedInput.readyOnly,
							}),
						};
					case "claim": {
						const task = options.runtime.claimTask(
							validatedInput.taskId!,
							options.requesterId,
						);
						return {
							action: "claim",
							taskId: task.id,
							status: task.status,
							nextStep:
								"Task is now in_progress. Execute the work using team_run_task or your own tools, then call team_task with action=complete when done.",
						};
					}
					case "complete": {
						const task = options.runtime.completeTask(
							validatedInput.taskId!,
							options.requesterId,
							validatedInput.summary!,
						);
						return {
							action: "complete",
							taskId: task.id,
							status: task.status,
						};
					}
					case "block": {
						const task = options.runtime.blockTask(
							validatedInput.taskId!,
							options.requesterId,
							validatedInput.reason!,
						);
						return {
							action: "block",
							taskId: task.id,
							status: task.status,
						};
					}
				}
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
							taskId: validatedInput.taskId || undefined,
							fromAgentId: options.requesterId,
							continueConversation:
								validatedInput.continueConversation || undefined,
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
						taskId: validatedInput.taskId || undefined,
						fromAgentId: options.requesterId,
						continueConversation:
							validatedInput.continueConversation || undefined,
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
					validatedInput.taskId ?? undefined,
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
						taskId: validatedInput.taskId ?? undefined,
						includeLead: validatedInput.includeLead ?? undefined,
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
					taskId: validatedInput.taskId || undefined,
					kind: validatedInput.kind,
					summary: validatedInput.summary,
					evidence: validatedInput.evidence?.length
						? validatedInput.evidence
						: undefined,
					nextAction: validatedInput.nextAction || undefined,
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
				return {
					outcomeId: outcome.id,
					status: outcome.status,
					requiredSections: outcome.requiredSections,
				};
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
					sourceRunId: validatedInput.sourceRunId || undefined,
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
