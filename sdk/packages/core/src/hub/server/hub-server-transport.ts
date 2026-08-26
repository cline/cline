import { resolve } from "node:path";
import type {
	AgendaTaskRecord,
	AgendaTaskRunRecord,
	AgentExtension,
	AgentTool,
	HubClientRecord,
	HubCommandEnvelope,
	HubEventEnvelope,
	HubReplyEnvelope,
	ToolApprovalRequest,
} from "@cline/shared";
import {
	CLINE_DEFAULT_MODEL_ID,
	captureSdkError,
	createSessionId,
	HUB_CLIENT_TOOL_APPROVAL_CAPABILITY,
} from "@cline/shared";
import { isChatWorkspacePath } from "@cline/shared/storage";
import { CronService } from "../../cron/service/cron-service";
import { HubScheduleCommandService } from "../../cron/service/schedule-command-service";
import { HubScheduleService } from "../../cron/service/schedule-service";
import { LocalRuntimeHost } from "../../runtime/host/local-runtime-host";
import type {
	CommandExecutionRuntimeService,
	PendingPromptsRuntimeService,
	RuntimeHost,
} from "../../runtime/host/runtime-host";
import { SqliteSessionStore } from "../../services/storage/sqlite-session-store";
import { withSessionHistoryOriginMetadata } from "../../session/history-origin";
import { CoreSessionService } from "../../session/services/session-service";
import {
	type CoreSettingsListInput,
	CoreSettingsService,
	type CoreSettingsToggleInput,
	type CoreSettingsType,
} from "../../settings";
import {
	AgendaTaskManager,
	type AgendaTaskRuntimeResult,
	createTasksPromptExtension,
	createTasksTool,
} from "../../tasks";
import { SessionSource } from "../../types/common";
import type { CoreSessionEvent } from "../../types/events";
import type { HubConnectionAuthority } from "./command-transport";
import {
	handleApprovalRespond,
	pendingApprovalEvents,
	requestToolApproval as requestToolApprovalHandler,
	resolvePendingApproval,
} from "./handlers/approval-handlers";
import {
	cancelPendingCapabilityRequests,
	handleCapabilityProgress,
	handleCapabilityRequest,
	handleCapabilityRespond,
	requestCapability as requestCapabilityHandler,
} from "./handlers/capability-handlers";
import {
	handleClientList,
	handleClientRegister,
	handleClientUnregister,
	handleClientUpdate,
} from "./handlers/client-handlers";
import { handleConnectorCommand } from "./handlers/connector-handlers";
import {
	buildHubEvent,
	type HubTransportContext,
	okReply,
	type PendingApproval,
	type PendingCapabilityRequest,
} from "./handlers/context";
import {
	handleRunAbort,
	handleRunProceedWhileRunning,
	handleSessionHook,
	handleSessionInput,
} from "./handlers/run-handlers";
import {
	drainingReply,
	HubRunExecutor,
	handleRunEnqueue,
	handleRunList,
	isDrainRefusedCommand,
} from "./handlers/run-queue-handlers";
import { projectSessionEvent } from "./handlers/session-event-projector";
import {
	handleSessionAttach,
	handleSessionCompactionGet,
	handleSessionCompactionUpdate,
	handleSessionCreate,
	handleSessionDelete,
	handleSessionDetach,
	handleSessionGet,
	handleSessionList,
	handleSessionMessages,
	handleSessionPendingPrompts,
	handleSessionRemovePendingPrompt,
	handleSessionRestore,
	handleSessionUpdate,
	handleSessionUpdateConnection,
	handleSessionUpdatePendingPrompt,
} from "./handlers/session-handlers";
import { HubEventLogStore } from "./hub-event-log";
import { HubRunQueue } from "./hub-run-queue";
import { eventNameForScheduleCommand } from "./hub-schedule-events";
import { logHubBoundaryError, logHubMessage } from "./hub-server-logging";
import type { HubWebSocketServerOptions } from "./hub-server-options";
import type { HubSessionState } from "./hub-session-records";
import type { NativeHubTransport } from "./native-transport";
import {
	HubAgendaTaskCommandService,
	isAgendaTaskCommand,
} from "./task-command-service";

/**
 * The agent-facing `kind: "todo"` half of the `tasks` tool and the Agenda
 * automation pump are temporarily disabled while the Agenda UX is reworked;
 * the desktop Agenda UI is hidden for the same reason. Automation must stay
 * off with the UI hidden: a previously persisted `auto_start`/`unattended`
 * policy would otherwise keep starting eligible tasks with no surface left to
 * inspect, pause, or cancel them. The Agenda backend (manager, `task.*` Hub
 * commands, storage, persisted policies) stays fully wired so flipping this
 * back on restores the feature.
 */
const AGENDA_TODO_TOOL_ENABLED = false;

const SETTINGS_TYPES = new Set<CoreSettingsType>([
	"skills",
	"workflows",
	"rules",
	"plugins",
	"tools",
	"mcp",
]);

function isPayloadObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireOptionalString(
	payload: Record<string, unknown>,
	key: "cwd" | "workspaceRoot" | "id" | "path" | "name",
): string | undefined {
	const value = payload[key];
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "string") {
		throw new Error(`settings payload '${key}' must be a string.`);
	}
	return value;
}

function requireOptionalBoolean(
	payload: Record<string, unknown>,
	key: "enabled",
): boolean | undefined {
	const value = payload[key];
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "boolean") {
		throw new Error(`settings payload '${key}' must be a boolean.`);
	}
	return value;
}

function parseSettingsListInput(payload: unknown): CoreSettingsListInput {
	if (payload === undefined) {
		return {};
	}
	if (!isPayloadObject(payload)) {
		throw new Error("settings.list payload must be an object.");
	}
	return {
		cwd: requireOptionalString(payload, "cwd"),
		workspaceRoot: requireOptionalString(payload, "workspaceRoot"),
		availabilityContext: isPayloadObject(payload.availabilityContext)
			? (payload.availabilityContext as CoreSettingsListInput["availabilityContext"])
			: undefined,
	};
}

function parseSettingsToggleInput(payload: unknown): CoreSettingsToggleInput {
	if (!isPayloadObject(payload)) {
		throw new Error("settings.toggle payload must be an object.");
	}
	const { type } = payload;
	if (
		typeof type !== "string" ||
		!SETTINGS_TYPES.has(type as CoreSettingsType)
	) {
		throw new Error(
			"settings.toggle payload 'type' must be one of: skills, workflows, rules, plugins, tools, mcp.",
		);
	}
	return {
		...parseSettingsListInput(payload),
		type: type as CoreSettingsType,
		id: requireOptionalString(payload, "id"),
		path: requireOptionalString(payload, "path"),
		name: requireOptionalString(payload, "name"),
		enabled: requireOptionalBoolean(payload, "enabled"),
	};
}

/** @internal Exported for unit testing fetch/runtime wiring. */
export class HubServerTransport implements NativeHubTransport {
	private readonly clients = new Map<string, HubClientRecord>();
	private readonly listeners = new Map<
		string,
		Set<{ sessionId?: string; listener: (event: HubEventEnvelope) => void }>
	>();
	private readonly sessionState = new Map<string, HubSessionState>();
	private readonly pendingApprovals = new Map<string, PendingApproval>();
	private readonly pendingCapabilityRequests = new Map<
		string,
		PendingCapabilityRequest
	>();
	private readonly suppressNextTerminalEventBySession = new Map<
		string,
		string
	>();
	private readonly activeRpcTurnCountBySession = new Map<string, number>();
	private readonly schedules: HubScheduleService;
	private readonly scheduleCommands: HubScheduleCommandService;
	private readonly tasks: AgendaTaskManager;
	private readonly taskCommands: HubAgendaTaskCommandService;
	private readonly sessionTools: AgentTool[] = [];
	private readonly sessionExtensions: AgentExtension[] = [];
	private readonly settings: CoreSettingsService;
	private readonly cronService?: CronService;
	private readonly sessionHost: RuntimeHost &
		Partial<PendingPromptsRuntimeService & CommandExecutionRuntimeService>;
	private readonly hubId = createSessionId("hub_");
	private readonly ctx: HubTransportContext;
	/** Durable event log; created on start(), absent in never-started tests. */
	private eventLog?: HubEventLogStore;
	private eventLogPruneTimer?: ReturnType<typeof setInterval>;
	/** Durable run queue + serial per-session executor (run.enqueue). */
	private runQueue?: HubRunQueue;
	private runExecutor?: HubRunExecutor;
	private draining = false;

	constructor(readonly options: HubWebSocketServerOptions) {
		this.sessionHost =
			options.sessionHost ??
			new LocalRuntimeHost({
				sessionService: new CoreSessionService(new SqliteSessionStore()),
				fetch: options.fetch,
				logger: options.logger,
				telemetry: options.telemetry,
			});
		this.ctx = {
			isDraining: () => this.draining,
			clients: this.clients,
			sessionState: this.sessionState,
			pendingApprovals: this.pendingApprovals,
			pendingCapabilityRequests: this.pendingCapabilityRequests,
			suppressNextTerminalEventBySession:
				this.suppressNextTerminalEventBySession,
			activeRpcTurnCountBySession: this.activeRpcTurnCountBySession,
			telemetry: options.telemetry,
			sessionTools: this.sessionTools,
			sessionExtensions: this.sessionExtensions,
			sessionHost: this.sessionHost,
			publish: (event) => this.publish(event),
			buildEvent: buildHubEvent,
			requestCapability: (
				sessionId,
				capabilityName,
				payload,
				targetClientId,
				onProgress,
			) =>
				requestCapabilityHandler(
					this.ctx,
					sessionId,
					capabilityName,
					payload,
					targetClientId,
					onProgress,
				),
		};
		this.tasks = new AgendaTaskManager({
			...options.taskOptions,
			automationEnabled: AGENDA_TODO_TOOL_ENABLED,
			runtime: {
				isInteractiveClientAvailable: () =>
					[...this.clients.values()].some((client) =>
						client.capabilities.some(
							(capability) =>
								capability.name === HUB_CLIENT_TOOL_APPROVAL_CAPABILITY,
						),
					),
				startSession: (task, run, requestedByClientId, runtimeOptions) =>
					this.startAgendaTaskSession(
						task,
						run,
						requestedByClientId,
						runtimeOptions?.unattended === true,
					),
				runSession: (sessionId, task, run) =>
					this.runAgendaTaskSession(sessionId, task, run),
				abortSession: async (sessionId, reason) => {
					await this.sessionHost.abort(sessionId, reason);
				},
			},
			logger: options.taskOptions?.logger ?? options.logger,
			publish: (event, payload, sessionId) => {
				this.publish(buildHubEvent(event, payload, sessionId));
			},
		});
		this.taskCommands = new HubAgendaTaskCommandService(this.tasks);
		this.schedules = new HubScheduleService({
			...options.scheduleOptions,
			runtimeHandlers: options.runtimeHandlers,
			eventPublisher: (eventType, payload) => {
				const mapped =
					eventType === "schedule.execution.completed"
						? "schedule.execution_completed"
						: eventType === "schedule.execution.failed"
							? "schedule.execution_failed"
							: undefined;
				if (!mapped) {
					return;
				}
				this.publish(
					buildHubEvent(
						mapped,
						payload && typeof payload === "object"
							? (payload as Record<string, unknown>)
							: undefined,
					),
				);
			},
		});
		this.scheduleCommands = new HubScheduleCommandService(this.schedules);
		this.sessionTools.push(
			createTasksTool({
				todo: AGENDA_TODO_TOOL_ENABLED
					? {
							manager: this.tasks,
							telemetry: options.telemetry,
							resolveSessionDefaults: async (sessionId) => {
								const session = await this.sessionHost.getSession(sessionId);
								if (!session) return undefined;
								const projectWorkspace = !isChatWorkspacePath(
									session.workspaceRoot,
								)
									? session.workspaceRoot
									: undefined;
								return {
									workspaceRoot: projectWorkspace,
									cwd: projectWorkspace ? session.cwd : undefined,
									modelSelection: {
										providerId: session.provider,
										modelId: session.model,
									},
									originTaskId:
										typeof session.metadata?.agendaTaskId === "string"
											? session.metadata.agendaTaskId
											: undefined,
								};
							},
						}
					: undefined,
				scheduled: {
					schedules: this.schedules,
					telemetry: options.telemetry,
					publish: (event, payload, sessionId) => {
						this.publish(buildHubEvent(event, payload, sessionId));
					},
					resolveSessionDefaults: async (sessionId) => {
						const session = await this.sessionHost.getSession(sessionId);
						if (!session) return undefined;
						return {
							workspaceRoot: session.workspaceRoot,
							cwd: session.cwd,
							modelSelection: {
								providerId: session.provider,
								modelId: session.model,
							},
							interactive: session.interactive,
						};
					},
				},
			}) as AgentTool,
		);
		this.sessionExtensions.push(
			createTasksPromptExtension({ todoEnabled: AGENDA_TODO_TOOL_ENABLED }),
		);
		this.settings = options.settingsService ?? new CoreSettingsService();
		if (options.cronOptions) {
			this.cronService = new CronService({
				runtimeHandlers: options.runtimeHandlers,
				...options.cronOptions,
			});
		}
		this.sessionHost.subscribe((event: CoreSessionEvent) => {
			void projectSessionEvent(this.ctx, event).catch((error) => {
				logHubBoundaryError("session event handling failed", error);
				captureSdkError(this.options.telemetry, {
					component: "core",
					operation: "hub.session_event_project",
					error,
					severity: "error",
					handled: true,
					context: {
						eventType: event.type,
						sessionId: event.payload.sessionId,
					},
				});
			});
		});
	}

	private async startAgendaTaskSession(
		task: AgendaTaskRecord,
		run: AgendaTaskRunRecord,
		requestedByClientId?: string,
		unattended = false,
	): Promise<{ sessionId: string }> {
		const originSession = task.originSessionId
			? await this.sessionHost.getSession(task.originSessionId)
			: undefined;
		const inheritedAutoApproveTools =
			originSession?.metadata?.autoApproveTools === true;
		const autoApproveTools = unattended || inheritedAutoApproveTools;
		const providerId = task.modelSelection?.providerId?.trim() || "cline";
		const modelId =
			task.modelSelection?.modelId?.trim() ||
			(providerId === "cline" ? CLINE_DEFAULT_MODEL_ID : "");
		const metadata = withSessionHistoryOriginMetadata(
			{
				title: task.title,
				agendaTaskId: task.taskId,
				agendaTaskRunId: run.runId,
				agendaTaskAssignee: task.assignee,
				interactive: !unattended,
				source: SessionSource.CORE,
			},
			{ mode: "task", trigger: "agenda_task" },
		);
		const clientId = requestedByClientId?.trim() || "agenda-task-manager";
		const reply = await handleSessionCreate(
			this.ctx,
			{
				version: "v1",
				command: "session.create",
				requestId: createSessionId("task_session_"),
				clientId,
				payload: {
					workspaceRoot: task.workspaceRoot,
					cwd: task.cwd,
					sessionConfig: {
						providerId,
						modelId,
						systemPrompt: task.systemPrompt ?? "",
						mode: task.mode ?? "act",
						maxIterations: task.maxIterations,
						enableTools: true,
						enableSpawnAgent: true,
						enableAgentTeams: true,
					},
					metadata,
					runtimeOptions: {
						mode: task.mode ?? "act",
						maxIterations: task.maxIterations,
						enableTools: true,
						enableSpawn: true,
						enableTeams: true,
					},
					toolPolicies: {
						"*": { autoApprove: autoApproveTools, enabled: true },
					},
				},
			},
			(request) => requestToolApprovalHandler(this.ctx, request),
		);
		if (!reply.ok) {
			throw new Error(reply.error?.message ?? "failed to create task session");
		}
		const session = reply.payload?.session as
			| { sessionId?: unknown }
			| undefined;
		const snapshot = reply.payload?.snapshot as
			| { sessionId?: unknown }
			| undefined;
		const sessionId =
			typeof snapshot?.sessionId === "string"
				? snapshot.sessionId
				: typeof session?.sessionId === "string"
					? session.sessionId
					: "";
		if (!sessionId) throw new Error("task session did not return a session id");
		return { sessionId };
	}

	private async runAgendaTaskSession(
		sessionId: string,
		task: AgendaTaskRecord,
		run: AgendaTaskRunRecord,
	): Promise<AgendaTaskRuntimeResult> {
		const resources = task.resourcePaths.length
			? `\n\nRelevant resources (paths are relative to workspace root ${task.workspaceRoot}):\n${task.resourcePaths
					.map(
						(path) =>
							`- ${path} (absolute: ${resolve(task.workspaceRoot ?? task.cwd ?? "", path)})`,
					)
					.join("\n")}`
			: "";
		const assignment = task.assignee
			? `\nAssigned agent: ${task.assignee}. If a configured agent or subagent with this name is available, delegate the work to it and oversee completion; otherwise execute it directly and mention the fallback in the summary.`
			: "";
		const prompt = `Execute this approved agenda task.\n\nTitle: ${task.title}\nType: ${task.type}\nPriority: P${task.priority}${assignment}\n\n${task.instructions}${resources}`;
		const reply = await handleSessionInput(this.ctx, {
			version: "v1",
			command: "run.start",
			requestId: createSessionId("task_run_"),
			clientId: run.requestedByClientId ?? "agenda-task-manager",
			sessionId,
			payload: {
				sessionId,
				input: prompt,
				mode: task.mode ?? "act",
				timeoutSeconds: task.timeoutSeconds,
			},
		});
		if (!reply.ok) {
			return {
				status: "failed",
				error: reply.error?.message ?? "task session run failed",
			};
		}
		const result = reply.payload?.result as
			| { finishReason?: unknown; text?: unknown }
			| undefined;
		const finishReason =
			typeof result?.finishReason === "string"
				? result.finishReason
				: undefined;
		const summary =
			typeof result?.text === "string" && result.text.trim()
				? result.text.trim()
				: undefined;
		if (finishReason === "completed") {
			return { status: "completed", summary };
		}
		if (finishReason === "aborted") {
			return { status: "cancelled", summary };
		}
		return {
			status: "failed",
			summary,
			error:
				summary ??
				(finishReason
					? `Task session ended with ${finishReason}`
					: "Task session did not return a completion result"),
		};
	}

	getCronService(): CronService | undefined {
		return this.cronService;
	}

	getHubId(): string {
		return this.hubId;
	}

	async start(): Promise<void> {
		await this.tasks.start();
		await this.schedules.start();
		if (this.cronService) {
			try {
				await this.cronService.start();
			} catch (err) {
				console.error("[hub] cron service start failed", err);
			}
		}
		this.startEventLog();
		this.startRunQueue();
	}

	private startEventLog(): void {
		if (this.options.eventLog === false || this.eventLog) {
			return;
		}
		try {
			const eventLog = new HubEventLogStore({
				ownerId: this.options.owner?.ownerId,
				...(this.options.eventLog ?? {}),
			});
			eventLog.prune();
			this.eventLog = eventLog;
			this.eventLogPruneTimer = setInterval(
				() => {
					try {
						eventLog.prune();
					} catch {
						// A failed sweep retries on the next interval.
					}
				},
				60 * 60 * 1000,
			);
			this.eventLogPruneTimer.unref?.();
		} catch (error) {
			// Degrade to live-only fan-out (the pre-log behavior) rather than
			// refusing to serve; replay cursors are then best-effort no-ops.
			logHubMessage("error", "event_log.start_failed", { error });
		}
	}

	private startRunQueue(): void {
		if (this.options.runQueue === false || this.runQueue) {
			return;
		}
		try {
			this.runQueue = new HubRunQueue({
				ownerId: this.options.owner?.ownerId,
				...(this.options.runQueue ?? {}),
			});
			this.runExecutor = new HubRunExecutor(this.ctx, this.runQueue);
			const recovered = this.runQueue.recoverOnStartup();
			for (const run of recovered.interrupted) {
				this.publish(
					buildHubEvent(
						"run.interrupted",
						{
							runId: run.runId,
							error: run.error,
							reason: "hub_restart",
						},
						run.sessionId,
					),
				);
			}
			const sessions = new Set(recovered.requeued.map((run) => run.sessionId));
			for (const sessionId of sessions) {
				this.runExecutor.pump(sessionId);
			}
			if (recovered.interrupted.length > 0 || recovered.requeued.length > 0) {
				logHubMessage("info", "run.queue.recovered", {
					interrupted: recovered.interrupted.length,
					requeued: recovered.requeued.length,
				});
			}
		} catch (error) {
			logHubMessage("error", "run.queue.start_failed", { error });
		}
	}

	async stop(): Promise<void> {
		if (this.eventLogPruneTimer) {
			clearInterval(this.eventLogPruneTimer);
			this.eventLogPruneTimer = undefined;
		}
		for (const approvalId of this.pendingApprovals.keys()) {
			resolvePendingApproval(this.ctx, approvalId, {
				approved: false,
				reason: "Hub shutting down before approval was resolved.",
			});
		}
		cancelPendingCapabilityRequests(
			this.ctx,
			() => true,
			"Hub shutting down before capability request was resolved.",
		);
		await this.tasks.dispose();
		await this.sessionHost.dispose("hub_server_stop");
		await this.schedules.dispose();
		if (this.cronService) {
			try {
				await this.cronService.dispose();
			} catch (err) {
				console.error("[hub] cron service stop failed", err);
			}
		}
		this.eventLog?.close();
		this.eventLog = undefined;
		this.runQueue?.close();
		this.runQueue = undefined;
		this.runExecutor = undefined;
	}

	async handleCommand(
		envelope: HubCommandEnvelope,
		authority?: HubConnectionAuthority | null,
	): Promise<HubReplyEnvelope> {
		try {
			const clientId = envelope.clientId?.trim();
			// Omitted authority is reserved for trusted in-process callers. A remote
			// transport passes null until registration so caller-controlled envelope
			// fields can never acquire daemon workspace authority implicitly.
			const effectiveAuthority =
				authority === undefined
					? this.options.workspaceRoot?.trim() && clientId
						? {
								clientId,
								workspaceContext: {
									workspaceRoot: this.options.workspaceRoot,
									cwd: this.options.workspaceRoot,
								},
							}
						: undefined
					: (authority ?? undefined);
			const reply = await this.dispatchCommand(envelope, effectiveAuthority);
			this.captureFailedReply(envelope, reply);
			return reply;
		} catch (error) {
			captureSdkError(this.options.telemetry, {
				component: "core",
				operation: "hub.command",
				error,
				severity: "error",
				handled: false,
				context: this.commandTelemetryContext(envelope),
			});
			throw error;
		}
	}

	private async dispatchCommand(
		envelope: HubCommandEnvelope,
		authority?: HubConnectionAuthority,
	): Promise<HubReplyEnvelope> {
		if (this.draining && isDrainRefusedCommand(envelope.command)) {
			return drainingReply(envelope);
		}
		if (isAgendaTaskCommand(envelope.command)) {
			return await this.taskCommands.handleCommand(envelope, authority);
		}
		switch (envelope.command) {
			case "client.register": {
				const reply = handleClientRegister(this.ctx, envelope);
				this.tasks.notifyAutomationReadinessChanged();
				return reply;
			}
			case "client.update": {
				const reply = handleClientUpdate(this.ctx, envelope);
				this.tasks.notifyAutomationReadinessChanged();
				return reply;
			}
			case "client.unregister": {
				const reply = handleClientUnregister(this.ctx, envelope, (clientId) => {
					this.listeners.delete(clientId);
					this.detachClientFromSessions(clientId);
				});
				this.tasks.notifyAutomationReadinessChanged();
				return reply;
			}
			case "client.list":
				return handleClientList(this.ctx, envelope);
			case "session.create":
				return await handleSessionCreate(
					this.ctx,
					envelope,
					(request: ToolApprovalRequest) =>
						requestToolApprovalHandler(this.ctx, request),
				);
			case "session.restore":
				return await handleSessionRestore(
					this.ctx,
					envelope,
					(request: ToolApprovalRequest) =>
						requestToolApprovalHandler(this.ctx, request),
				);
			case "session.attach":
				return await handleSessionAttach(this.ctx, envelope);
			case "session.detach":
				return await handleSessionDetach(this.ctx, envelope);
			case "session.get":
				return await handleSessionGet(this.ctx, envelope);
			case "session.messages":
				return await handleSessionMessages(this.ctx, envelope);
			case "session.compaction.get":
				return await handleSessionCompactionGet(this.ctx, envelope);
			case "session.list":
				return await handleSessionList(this.ctx, envelope);
			case "session.update":
				return await handleSessionUpdate(this.ctx, envelope);
			case "session.update_connection":
				return await handleSessionUpdateConnection(this.ctx, envelope);
			case "session.compaction.update":
				return await handleSessionCompactionUpdate(this.ctx, envelope);
			case "session.pending_prompts":
				return await handleSessionPendingPrompts(this.ctx, envelope);
			case "session.update_pending_prompt":
				return await handleSessionUpdatePendingPrompt(this.ctx, envelope);
			case "session.remove_pending_prompt":
				return await handleSessionRemovePendingPrompt(this.ctx, envelope);
			case "session.delete":
				return await handleSessionDelete(this.ctx, envelope);
			case "session.hook":
				return await handleSessionHook(this.ctx, envelope);
			case "run.start":
			case "session.send_input":
				return await handleSessionInput(this.ctx, envelope);
			case "run.enqueue": {
				if (!this.runQueue || !this.runExecutor) {
					return {
						version: envelope.version,
						requestId: envelope.requestId,
						ok: false,
						error: {
							code: "run_queue_unavailable",
							message:
								"This hub has no durable run queue; use run.start instead.",
						},
					};
				}
				return handleRunEnqueue(
					this.ctx,
					envelope,
					this.runQueue,
					this.runExecutor,
				);
			}
			case "run.list": {
				if (!this.runQueue) {
					return okReply(envelope, { runs: [] });
				}
				return handleRunList(envelope, this.runQueue);
			}
			case "hub.drain":
				return this.handleHubDrain(envelope);
			case "hub.status":
				return this.handleHubStatus(envelope);
			case "run.abort":
				return await handleRunAbort(this.ctx, envelope);
			case "run.proceed_while_running":
				return await handleRunProceedWhileRunning(this.ctx, envelope);
			case "capability.request":
				return await handleCapabilityRequest(this.ctx, envelope);
			case "approval.respond":
				return await handleApprovalRespond(this.ctx, envelope);
			case "capability.respond":
				return handleCapabilityRespond(this.ctx, envelope);
			case "capability.progress":
				return handleCapabilityProgress(this.ctx, envelope);
			case "ui.notify":
				this.publish(buildHubEvent("ui.notify", envelope.payload ?? {}));
				return okReply(envelope);
			case "ui.show_window":
				this.publish(buildHubEvent("ui.show_window", envelope.payload ?? {}));
				return okReply(envelope);
			case "settings.list":
				return await this.handleSettingsList(envelope);
			case "settings.toggle":
				return await this.handleSettingsToggle(envelope);
			case "connector.channels":
			case "connector.configure":
			case "connector.delete_config":
			case "connector.start":
			case "connector.stop":
			case "connector.supervised":
				return await handleConnectorCommand(this.ctx, envelope);
			case "settings.get":
			case "settings.patch":
				return {
					version: envelope.version,
					requestId: envelope.requestId,
					ok: false,
					error: {
						code: "not_implemented",
						message: `${envelope.command} is not implemented yet.`,
					},
				};
			default: {
				const reply = await this.scheduleCommands.handleCommand(
					envelope,
					authority,
				);
				if (reply.ok) {
					const event = eventNameForScheduleCommand(envelope.command);
					if (event) {
						this.publish(buildHubEvent(event, reply.payload));
					}
				}
				return reply;
			}
		}
	}

	private captureFailedReply(
		envelope: HubCommandEnvelope,
		reply: HubReplyEnvelope,
	): void {
		if (
			reply.ok ||
			!reply.error ||
			!shouldCaptureHubReplyError(reply.error.code)
		) {
			return;
		}
		captureSdkError(this.options.telemetry, {
			component: "core",
			operation: "hub.command_reply",
			error: new Error(reply.error.message),
			severity: reply.error.code === "session_not_found" ? "warn" : "error",
			handled: true,
			context: {
				...this.commandTelemetryContext(envelope),
				errorCode: reply.error.code,
			},
		});
	}

	private commandTelemetryContext(envelope: HubCommandEnvelope) {
		return {
			command: envelope.command,
			requestId: envelope.requestId,
			clientId: envelope.clientId,
			sessionId:
				typeof envelope.payload?.sessionId === "string"
					? envelope.payload.sessionId
					: envelope.sessionId,
		};
	}

	private async handleSettingsList(
		envelope: HubCommandEnvelope,
	): Promise<HubReplyEnvelope> {
		try {
			const snapshot = await this.settings.list(
				parseSettingsListInput(envelope.payload),
			);
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: true,
				payload: { snapshot },
			};
		} catch (error) {
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: false,
				error: {
					code: "settings_list_failed",
					message: error instanceof Error ? error.message : String(error),
				},
			};
		}
	}

	private async handleSettingsToggle(
		envelope: HubCommandEnvelope,
	): Promise<HubReplyEnvelope> {
		try {
			const result = await this.settings.toggle(
				parseSettingsToggleInput(envelope.payload),
			);
			this.publish(
				buildHubEvent("settings.changed", {
					types: result.changedTypes,
					snapshot: result.snapshot,
				}),
			);
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: true,
				payload: {
					snapshot: result.snapshot,
					changedTypes: result.changedTypes,
				},
			};
		} catch (error) {
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: false,
				error: {
					code: "settings_toggle_failed",
					message: error instanceof Error ? error.message : String(error),
				},
			};
		}
	}

	/**
	 * Explicit drain: refuse new mutating work while accepted runs finish.
	 * This is the graceful half of an upgrade — replacement happens at a
	 * boundary an operator chose, never as an ambush under a live turn.
	 */
	private handleHubDrain(envelope: HubCommandEnvelope): HubReplyEnvelope {
		const requested = envelope.payload?.draining !== false;
		const reason =
			typeof envelope.payload?.reason === "string"
				? envelope.payload.reason
				: undefined;
		if (this.draining !== requested) {
			this.draining = requested;
			this.publish(
				buildHubEvent("hub.drain_changed", {
					draining: this.draining,
					...(reason ? { reason } : {}),
				}),
			);
			logHubMessage("info", "hub.drain_changed", {
				draining: this.draining,
				reason,
			});
		}
		return okReply(envelope, this.describeStatus());
	}

	private handleHubStatus(envelope: HubCommandEnvelope): HubReplyEnvelope {
		return okReply(envelope, this.describeStatus());
	}

	private describeStatus(): Record<string, unknown> {
		let activeRpcTurns = 0;
		for (const count of this.activeRpcTurnCountBySession.values()) {
			activeRpcTurns += count;
		}
		return {
			hubId: this.hubId,
			draining: this.draining,
			activeRpcTurns,
			pendingRuns: this.runQueue?.countPending() ?? 0,
			eventLog: this.eventLog
				? { lastSequence: this.eventLog.lastSequence() }
				: undefined,
			// Idle = safe to stop: nothing executing and nothing accepted-but-unstarted.
			idle: activeRpcTurns === 0 && (this.runQueue?.countPending() ?? 0) === 0,
		};
	}

	/** Whether the hub is currently draining (exposed for the HTTP status). */
	isDraining(): boolean {
		return this.draining;
	}

	/** Durable events after a cursor — the adapter's replay source. */
	replayEventsAfter(
		sinceSequence: number,
		options: { sessionId?: string; limit: number },
	): HubEventEnvelope[] {
		if (!this.eventLog) {
			return [];
		}
		return this.eventLog.listAfter(
			sinceSequence,
			{ sessionId: options.sessionId },
			options.limit,
		);
	}

	lastEventSequence(): number {
		return this.eventLog?.lastSequence() ?? 0;
	}

	subscribe(
		clientId: string,
		listener: (event: HubEventEnvelope) => void,
		options?: { sessionId?: string },
	): () => void {
		const current = this.listeners.get(clientId) ?? new Set();
		const entry = { sessionId: options?.sessionId, listener };
		current.add(entry);
		this.listeners.set(clientId, current);
		// Re-issue pending approvals so a (re)connecting client can answer a
		// request raised while it was away instead of leaving the turn parked.
		const pending = pendingApprovalEvents(this.ctx, options?.sessionId);
		if (pending.length > 0) {
			queueMicrotask(() => {
				const listeners = this.listeners.get(clientId);
				if (!listeners?.has(entry)) {
					return;
				}
				for (const event of pending) {
					try {
						entry.listener(event);
					} catch (error) {
						logHubBoundaryError(
							"listener threw while re-issuing pending approval",
							error,
						);
					}
				}
			});
		}
		return () => {
			const listeners = this.listeners.get(clientId);
			if (!listeners) {
				return;
			}
			listeners.delete(entry);
			if (listeners.size === 0) {
				this.listeners.delete(clientId);
			}
		};
	}

	private detachClientFromSessions(clientId: string): void {
		for (const [sessionId, state] of this.sessionState.entries()) {
			state.participants.delete(clientId);
			if (state.createdByClientId === clientId) {
				state.createdByClientId = undefined;
			}
			if (state.participants.size === 0) {
				this.sessionState.delete(sessionId);
			}
		}
		cancelPendingCapabilityRequests(
			this.ctx,
			(request) => request.targetClientId === clientId,
			`Capability owner client ${clientId} disconnected before request was resolved.`,
		);
	}

	private publish(event: HubEventEnvelope): void {
		// Durability before delivery: append to the event log and fan out the
		// sequence-stamped envelope, so live listeners and replaying clients
		// observe identical frames and the cursor is always meaningful.
		if (this.eventLog) {
			try {
				event = this.eventLog.append(event);
			} catch (error) {
				logHubBoundaryError(
					`event log append failed for ${event.event}`,
					error,
				);
			}
		}
		for (const entries of this.listeners.values()) {
			for (const entry of entries) {
				if (entry.sessionId && entry.sessionId !== event.sessionId) {
					continue;
				}
				try {
					entry.listener(event);
				} catch (error) {
					logHubBoundaryError(
						`listener threw while publishing ${event.event}`,
						error,
					);
					captureSdkError(this.options.telemetry, {
						component: "core",
						operation: "hub.publish",
						error,
						severity: "warn",
						handled: true,
						context: {
							event: event.event,
							sessionId: event.sessionId,
						},
					});
				}
			}
		}
	}
}

function shouldCaptureHubReplyError(code: string): boolean {
	return (
		code === "session_not_found" ||
		code === "session_messages_not_found" ||
		code === "hub_command_timeout" ||
		code.endsWith("_failed")
	);
}
