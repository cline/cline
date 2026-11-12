import { resolve } from "node:path";
import { createGateway, normalizeProviderId } from "@cline/llms";
import type {
	AgendaTaskRecord,
	AgendaTaskRunRecord,
	AgentExtension,
	AgentTool,
	FactoryAgent,
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
	DEFAULT_FACTORY_AGENTS,
	FACTORY_INTAKE_METADATA_KEY,
	factoryReviewMode,
	HUB_CLIENT_TOOL_APPROVAL_CAPABILITY,
	selectFactoryReviewAgents,
} from "@cline/shared";
import {
	isChatWorkspacePath,
	resolveAgentSchedulesDir,
} from "@cline/shared/storage";
import { z } from "zod";
import { CronService } from "../../cron/service/cron-service";
import { HubScheduleCommandService } from "../../cron/service/schedule-command-service";
import {
	type HubScheduleRuntimeHandlers,
	HubScheduleService,
} from "../../cron/service/schedule-service";
import { resolveConfiguredAgentToolName } from "../../extensions/tools/team/configured-agent-config";
import { LocalRuntimeHost } from "../../runtime/host/local-runtime-host";
import type {
	CommandExecutionRuntimeService,
	PendingPromptsRuntimeService,
	RuntimeHost,
	SessionConnectionRuntimeService,
	SessionUsageRuntimeService,
} from "../../runtime/host/runtime-host";
import { SessionNotFoundError } from "../../runtime/host/runtime-host";
import { SqliteSessionStore } from "../../services/storage/sqlite-session-store";
import { ensureAgentSchedulesWorkspace } from "../../services/workspace/agent-schedules-workspace";
import { withSessionHistoryOriginMetadata } from "../../session/history-origin";
import { SessionHistorySearchService } from "../../session/search";
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
	createFactoryGuidanceTool,
	createFactoryListTool,
	createFactoryManagerGuidanceExtension,
	createFactoryPromptExtension,
	createFactoryStagesTool,
	createFactoryStatusTool,
	createFactoryTool,
	createTasksPromptExtension,
	createTasksTool,
	FACTORY_GUIDANCE_TOOL_NAME,
	FACTORY_LIST_TOOL_NAME,
	FACTORY_STAGES_TOOL_NAME,
	FACTORY_STATUS_TOOL_NAME,
	FACTORY_TOOL_NAME,
	type FactoryGuidanceConfirmationRequest,
	FactoryGuidanceStore,
	type FactoryRoleGuidanceRole,
	type FactorySessionDefaults,
	type FactoryStagesConfirmationRequest,
	FileFactoryAgentCardLedger,
	FileFactoryDefaultsStore,
	FileFactoryStageTrustStore,
	FileFactoryVerificationProfileStore,
	isFactoryManagerSessionMetadata,
	parseFactoryIntakeContext,
	readFactoryManagerReadme,
	resolveFactoryAgentCardsPath,
	resolveFactoryDefaultsPath,
	resolveFactoryGuidanceDir,
	resolveFactoryStageTrustPath,
	resolveFactoryVerificationProfilesPath,
} from "../../tasks";
import {
	freezeFactoryAgent,
	resolveFactoryAgent,
} from "../../tasks/factory-agents";
import { SessionSource } from "../../types/common";
import type { CoreSessionEvent } from "../../types/events";
import type { HubConnectionAuthority } from "./command-transport";
import { FactoryActivityPublisher } from "./factory-activity";
import { reconcileFactorySession } from "./factory-session-reconcile";
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
	awaitHumanInput,
	cancelHumanInputWaits,
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
	handleSessionSearch,
	handleSessionSteerFirstPendingPrompt,
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

const factoryProviders = createGateway().listProviders();

function factoryDesignConfig(
	task: AgendaTaskRecord,
	agent?: FactoryAgent,
): string {
	return JSON.stringify({
		instructions: task.systemPrompt,
		agent,
		maxIterations: task.maxIterations,
	});
}

function assertFactoryProvider(task: AgendaTaskRecord): void {
	const providerId = normalizeProviderId(
		task.modelSelection?.providerId?.trim() || "cline",
	);
	const provider = factoryProviders.find((item) => item.id === providerId);
	if (!provider || provider.capabilities?.includes("provider-tools"))
		throw new Error(
			`Factory cannot enforce tool permissions and session limits for ${providerId} yet. Select a provider that uses Cline's agent tools.`,
		);
}

/**
 * The agent-facing `kind: "todo"` half of the `tasks` tool and the Agenda
 * automation pump are temporarily disabled while the Agenda UX is reworked;
 * the desktop Agenda UI is hidden for the same reason. Automation must stay
 * off with the UI hidden: a previously persisted `auto_start`/`unattended`
 * policy would otherwise keep starting eligible tasks with no surface left to
 * inspect, pause, or cancel them. The agenda spec-file watchers stay off for
 * the same reason: with the tool, UI, and automation all idle, nothing
 * consumes watcher-driven task events, and the `task.*` commands reconcile
 * spec files on demand anyway. The Agenda backend (manager, `task.*` Hub
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
	key: "enabled" | "includePluginTools",
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

function requireOptionalStringArray(
	payload: Record<string, unknown>,
	key: "agentPluginPaths",
): string[] | undefined {
	const value = payload[key];
	if (value === undefined) {
		return undefined;
	}
	if (
		!Array.isArray(value) ||
		!value.every((entry) => typeof entry === "string")
	) {
		throw new Error(`settings payload '${key}' must be an array of strings.`);
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
		agentPluginPaths: requireOptionalStringArray(payload, "agentPluginPaths"),
		includePluginTools: requireOptionalBoolean(payload, "includePluginTools"),
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
	private readonly abandonedRpcTurnCountBySession = new Map<string, number>();
	private readonly schedules: HubScheduleService;
	private readonly scheduleCommands: HubScheduleCommandService;
	private readonly tasks: AgendaTaskManager;
	/** Standing guidance for Factory roles, set from the Factory manager chat. */
	private readonly factoryGuidance: FactoryGuidanceStore;
	private readonly factoryActivity: FactoryActivityPublisher;
	private readonly taskCommands: HubAgendaTaskCommandService;
	private readonly sessionTools: AgentTool[] = [];
	private readonly sessionExtensions: AgentExtension[] = [];
	private readonly settings: CoreSettingsService;
	private readonly sessionSearch: SessionHistorySearchService;
	private readonly cronService?: CronService;
	private readonly sessionHost: RuntimeHost &
		Partial<
			PendingPromptsRuntimeService &
				CommandExecutionRuntimeService &
				SessionConnectionRuntimeService &
				SessionUsageRuntimeService
		>;
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
		this.sessionSearch = new SessionHistorySearchService(
			this.sessionHost,
			options.sessionSearchOptions ??
				(process.env.NODE_ENV === "test" ? { dbPath: ":memory:" } : {}),
		);
		const sessionSearchInitializationError =
			this.sessionSearch.getInitializationError();
		if (sessionSearchInitializationError !== undefined) {
			logHubBoundaryError(
				"session search is unavailable",
				sessionSearchInitializationError,
			);
		}
		this.ctx = {
			isDraining: () => this.draining,
			sessionSearch: this.sessionSearch,
			clients: this.clients,
			sessionState: this.sessionState,
			pendingApprovals: this.pendingApprovals,
			pendingCapabilityRequests: this.pendingCapabilityRequests,
			suppressNextTerminalEventBySession:
				this.suppressNextTerminalEventBySession,
			activeRpcTurnCountBySession: this.activeRpcTurnCountBySession,
			abandonedRpcTurnCountBySession: this.abandonedRpcTurnCountBySession,
			runDeadlinesBySession: new Map(),
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
		// The user's default Factory workflow sits beside the task database.
		// Hosts push it (task.factory.defaults.set); the Hub cannot read their
		// settings. A test Hub or an injected store without a path keeps it in memory.
		const taskDbPath = options.taskOptions?.dbPath;
		const hubLogger = options.taskOptions?.logger ?? options.logger;
		const factoryDefaults = new FileFactoryDefaultsStore(
			taskDbPath !== undefined
				? resolveFactoryDefaultsPath(taskDbPath)
				: options.taskOptions?.store || process.env.NODE_ENV === "test"
					? undefined
					: resolveFactoryDefaultsPath(),
			{ logger: hubLogger },
		);
		// Verification profiles trusted per workspace sit beside it too.
		const factoryVerificationProfiles = new FileFactoryVerificationProfileStore(
			taskDbPath !== undefined
				? resolveFactoryVerificationProfilesPath(taskDbPath)
				: options.taskOptions?.store || process.env.NODE_ENV === "test"
					? undefined
					: resolveFactoryVerificationProfilesPath(),
		);
		// Role guidance and the agent card count sit beside them as well.
		const inMemoryFactoryState =
			taskDbPath === undefined &&
			(!!options.taskOptions?.store || process.env.NODE_ENV === "test");
		this.factoryGuidance = new FactoryGuidanceStore(
			inMemoryFactoryState ? undefined : resolveFactoryGuidanceDir(taskDbPath),
			{ log: (line) => logHubMessage("warn", line) },
		);
		const factoryAgentCards = new FileFactoryAgentCardLedger(
			inMemoryFactoryState
				? undefined
				: resolveFactoryAgentCardsPath(taskDbPath),
		);
		this.tasks = new AgendaTaskManager({
			...options.taskOptions,
			factoryVerificationProfiles,
			// A person's decisions on repository stages, by hash.
			factoryStageTrust: new FileFactoryStageTrustStore(
				inMemoryFactoryState
					? undefined
					: resolveFactoryStageTrustPath(taskDbPath),
			),
			// Feedback on a delivered card may propose a rule into this store.
			factoryGuidance: this.factoryGuidance,
			resolveFactoryDefaultWorkflow: () => factoryDefaults.getDefaultWorkflow(),
			// The user's working limit (task.factory.limits.set) survives restarts.
			resolveFactoryConcurrency: () => factoryDefaults.getConcurrency(),
			// So does the pause (task.factory.limits.set with paused).
			resolveFactoryPaused: () => factoryDefaults.getPaused(),
			// Legacy cards adopt a policy only once a host has pushed the default.
			resolveFactoryDefaultsReceived: () =>
				factoryDefaults.getDefaultsReceived(),
			// And the Hub-wide daily spending limit (task.factory.limits.set).
			resolveFactoryDailyCostUsd: () => factoryDefaults.getDailyCostUsd(),
			automationEnabled: AGENDA_TODO_TOOL_ENABLED,
			watchFiles:
				AGENDA_TODO_TOOL_ENABLED && options.taskOptions?.watchFiles !== false,
			runtime: {
				resolveFactoryAgents: async (task) => {
					const agents = task.factory?.agents ?? DEFAULT_FACTORY_AGENTS;
					return {
						...agents,
						designer: freezeFactoryAgent(task, agents.designer),
						implementers: agents.implementers.map((agent) =>
							freezeFactoryAgent(task, agent),
						),
						verifier: agents.verifier
							? {
									...freezeFactoryAgent(task, agents.verifier),
									artifacts: agents.verifier.artifacts,
									environment: agents.verifier.environment,
								}
							: undefined,
						planReviewers: agents.planReviewers.map((agent) =>
							freezeFactoryAgent(task, agent),
						),
						reviewers: agents.reviewers.map((agent) =>
							freezeFactoryAgent(task, agent),
						),
					};
				},
				validateFactoryAgents: (task) => {
					const agents =
						(task.factoryDesignProgress?.revision === task.revision
							? selectFactoryReviewAgents(
									task.factoryDesignProgress.agents,
									task.factoryDesignProgress.reviewSelection,
								)
							: undefined) ??
						task.factory?.agents ??
						DEFAULT_FACTORY_AGENTS;
					const participants =
						factoryReviewMode(task.factory) === "adaptive" &&
						!(
							task.factoryDesignProgress?.revision === task.revision &&
							task.factoryDesignProgress.reviewSelection
						)
							? [agents.designer]
							: [
									agents.designer,
									...agents.planReviewers,
									...agents.implementers,
									...(agents.verifier ? [agents.verifier] : []),
									...agents.reviewers,
								];
					for (const agent of participants)
						assertFactoryProvider(resolveFactoryAgent(task, agent));
				},
				startDesignReviewSession: (task, clientId, agent, sessionId) =>
					this.startAgendaTaskSession(
						{ ...task, mode: "plan" },
						undefined,
						clientId,
						false,
						"reviewer",
						agent,
						sessionId,
						"plan_reviewer",
					),
				isInteractiveClientAvailable: () =>
					[...this.clients.values()].some((client) =>
						client.capabilities.some(
							(capability) =>
								capability.name === HUB_CLIENT_TOOL_APPROVAL_CAPABILITY,
						),
					),
				startDesignSession: async (
					task,
					requestedByClientId,
					agent,
					requestedSessionId,
				) => {
					if (requestedSessionId)
						return this.startAgendaTaskSession(
							{ ...task, mode: "plan" },
							undefined,
							requestedByClientId,
							false,
							"designer",
							agent,
							requestedSessionId,
						);
					if (agent) agent = freezeFactoryAgent(task, agent);
					if (task.originSessionId) {
						const previous = await this.sessionHost.getSession(
							task.originSessionId,
						);
						if (
							previous?.metadata?.factoryTaskId === task.taskId &&
							previous.metadata.factoryRole === "designer" &&
							previous.provider ===
								(task.modelSelection?.providerId || "cline") &&
							previous.model ===
								(task.modelSelection?.modelId || CLINE_DEFAULT_MODEL_ID) &&
							previous.metadata.factoryDesignConfig ===
								factoryDesignConfig(task, agent) &&
							this.sessionHost.updateSessionConnection
						) {
							try {
								// A persisted session may outlive its runtime after a Hub restart.
								await this.sessionHost.updateSessionConnection(
									task.originSessionId,
									{},
								);
								return { sessionId: task.originSessionId };
							} catch (error) {
								if (!(error instanceof SessionNotFoundError)) throw error;
							}
						}
					}
					return this.startAgendaTaskSession(
						{
							...task,
							mode: "plan",
						},
						undefined,
						requestedByClientId,
						false,
						"designer",
						agent,
					);
				},
				runDesignSession: (sessionId, task, requestedByClientId) =>
					this.runAgendaTaskSession(sessionId, task, { requestedByClientId }),
				startSession: (task, run, requestedByClientId, runtimeOptions) =>
					this.startAgendaTaskSession(
						task,
						run,
						requestedByClientId,
						runtimeOptions?.unattended === true,
						runtimeOptions?.factoryRole,
						runtimeOptions?.factoryAgent,
						runtimeOptions?.sessionId,
						undefined,
						runtimeOptions?.factoryStage,
					),
				reconcileSession: (sessionId) =>
					reconcileFactorySession(this.ctx, sessionId),
				getSessionUsage: async (sessionId) => {
					const live = await this.sessionHost.getAccumulatedUsage?.(sessionId);
					if (live?.aggregateUsage || live?.usage)
						return live.aggregateUsage ?? live.usage;
					const session = await this.sessionHost.getSession(sessionId);
					const usage = z
						.object({
							inputTokens: z.number(),
							outputTokens: z.number(),
							cacheReadTokens: z.number(),
							cacheWriteTokens: z.number(),
							totalCost: z.number(),
						})
						.safeParse(
							session?.metadata?.aggregateUsage ?? session?.metadata?.usage,
						);
					return usage.success ? usage.data : undefined;
				},
				getSessionModel: async (sessionId) => {
					const session = await this.sessionHost.getSession(sessionId);
					return session?.provider && session.model
						? { providerId: session.provider, modelId: session.model }
						: undefined;
				},
				runSession: (sessionId, task, run) =>
					this.runAgendaTaskSession(sessionId, task, run),
				abortSession: async (sessionId, reason) => {
					try {
						await this.sessionHost.abort(sessionId, reason);
					} finally {
						cancelHumanInputWaits(this.ctx, sessionId, reason);
					}
				},
			},
			logger: hubLogger,
			publish: (event, payload, sessionId) => {
				this.publish(buildHubEvent(event, payload, sessionId));
			},
		});
		this.taskCommands = new HubAgendaTaskCommandService(
			this.tasks,
			factoryDefaults,
		);
		const projectWorkspace = (workspaceRoot: string) =>
			!isChatWorkspacePath(workspaceRoot) &&
			resolve(workspaceRoot) !== resolve(resolveAgentSchedulesDir())
				? workspaceRoot
				: undefined;
		const factoryPrompt = createFactoryPromptExtension();
		// The Factory manager chat works across the user's projects: those of
		// their cards and of their own sessions. The Factory tools keep only
		// existing git repositories outside Cline's directories.
		const listProjects = async () => {
			const [cards, sessions] = await Promise.all([
				this.tasks.listTasks({
					scope: "workspace",
					factoryOnly: true,
					includeArchived: true,
					limit: 1000,
				}),
				this.sessionHost.listSessions(500, { rootOnly: true }),
			]);
			return [
				...cards.map((task) => task.workspaceRoot),
				...sessions
					.filter(
						(session) =>
							session.metadata?.factoryRole === undefined &&
							session.metadata?.factoryTaskId === undefined,
					)
					.map((session) => session.workspaceRoot),
			];
		};
		const factoryTools = (
			resolveSessionDefaults: (
				sessionId: string,
			) => Promise<FactorySessionDefaults | undefined>,
		): AgentTool[] => [
			createFactoryTool({
				manager: this.tasks,
				telemetry: options.telemetry,
				agentCards: factoryAgentCards,
				resolveSessionDefaults,
				listProjects,
				resolveDefaultWorkflow: () => factoryDefaults.getDefaultWorkflow(),
			}) as AgentTool,
			createFactoryListTool({
				manager: this.tasks,
				resolveSessionDefaults,
				listProjects,
			}) as AgentTool,
			createFactoryStatusTool({
				manager: this.tasks,
				resolveSessionDefaults,
				listProjects,
			}) as AgentTool,
		];
		const scheduledRuntime = options.runtimeHandlers;
		// Scheduled sessions run in the scheduler's own runtime host, so the
		// manager-backed Factory tools are added to each one here. They are
		// never intakes: only the host that starts a chat can supply that context.
		const runtimeHandlers: HubScheduleRuntimeHandlers = {
			startSession: (request, start) =>
				scheduledRuntime.startSession(request, {
					...start,
					localRuntime: {
						extensions: [factoryPrompt],
						extraTools: factoryTools(async () => ({
							// Scheduled sessions have no person in them.
							interactive: false,
							workspaceRoot: projectWorkspace(request.workspaceRoot),
							modelSelection: {
								providerId: normalizeProviderId(request.provider),
								modelId: request.model,
							},
						})),
					},
				}),
			sendSession: (sessionId, request) =>
				scheduledRuntime.sendSession(sessionId, request),
			abortSession: (sessionId) => scheduledRuntime.abortSession(sessionId),
			stopSession: (sessionId) => scheduledRuntime.stopSession(sessionId),
		};
		this.schedules = new HubScheduleService({
			...options.scheduleOptions,
			telemetry: options.telemetry,
			runtimeHandlers,
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
						// Agent-created schedules are user-level routines: anchor
						// them (and run their unattended sessions) in the stable
						// ~/.cline/schedules home instead of whichever chat
						// workspace created them, so they survive chat cleanup and
						// every chat manages the same set. Prompts must carry
						// absolute paths to any project they operate on.
						return {
							workspaceRoot: await ensureAgentSchedulesWorkspace(),
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
		// `factory_guidance` reaches only the user's Factory manager chat: an
		// interactive session the desktop marks only when the user creates it
		// in the local environment; never a Factory role, task, intake, remote
		// or scheduled session (scheduled sessions run in their own host
		// without this extension).
		const resolveFactoryManagerSession = async (sessionId: string) => {
			const session = await this.sessionHost.getSession(sessionId);
			if (
				!session ||
				!isFactoryManagerSessionMetadata(session.metadata) ||
				session.interactive === false
			)
				return undefined;
			return { workspaceRoot: projectWorkspace(session.workspaceRoot) };
		};
		// A guidance change is saved only after the user confirms it in their
		// app: the Hub raises a tool approval carrying the diff, answered by a
		// client that can show approvals. With none connected it fails closed.
		const canConfirm = () =>
			[...this.clients.values()].some((client) =>
				client.capabilities.some(
					(capability) =>
						capability.name === HUB_CLIENT_TOOL_APPROVAL_CAPABILITY,
				),
			);
		const noAppToConfirm = {
			approved: false,
			reason: "No app that can ask the user to confirm is connected.",
		};
		const confirmFactoryGuidance = async (
			request: FactoryGuidanceConfirmationRequest,
		) => {
			if (!canConfirm()) return noAppToConfirm;
			return requestToolApprovalHandler(this.ctx, {
				sessionId: request.sessionId,
				agentId: request.agentId,
				conversationId: request.conversationId ?? request.sessionId,
				iteration: request.iteration,
				toolCallId: request.toolCallId,
				toolName: FACTORY_GUIDANCE_TOOL_NAME,
				input: {
					// accept/discard change the wording the app shows; anything else is a normal save.
					action:
						request.origin === "accept" || request.origin === "discard"
							? request.origin
							: "apply",
					question: `Save this change to ${request.scope === "repository" ? "the repository's" : "your"} Factory ${request.role === "manager" ? "manager readme" : `${request.role === "factory" ? "routing" : request.role.replace("_", " ")} guidance`}?`,
					role: request.role,
					scope: request.scope,
					...(request.workspaceRoot
						? { workspaceRoot: request.workspaceRoot }
						: {}),
					...(request.path ? { path: request.path } : {}),
					summary: request.summary,
					diff: request.diff,
				},
				policy: { autoApprove: false },
			});
		};
		// A repository stages change the same way: saved, and its added or
		// changed stages approved, only after the user confirms the diff.
		const confirmFactoryStages = async (
			request: FactoryStagesConfirmationRequest,
		) => {
			if (!canConfirm()) return noAppToConfirm;
			return requestToolApprovalHandler(this.ctx, {
				sessionId: request.sessionId,
				agentId: request.agentId,
				conversationId: request.conversationId ?? request.sessionId,
				iteration: request.iteration,
				toolCallId: request.toolCallId,
				toolName: FACTORY_STAGES_TOOL_NAME,
				input: {
					action: "apply",
					question: `Change ${request.project}'s Factory stages?`,
					project: request.project,
					workspaceRoot: request.workspaceRoot,
					path: request.path,
					summary: request.summary,
					diff: request.diff,
					warnings: request.warnings,
				},
				policy: { autoApprove: false },
			});
		};
		this.sessionExtensions.push(
			createTasksPromptExtension({ todoEnabled: AGENDA_TODO_TOOL_ENABLED }),
			factoryPrompt,
			createFactoryManagerGuidanceExtension({
				tools: [
					createFactoryGuidanceTool({
						store: this.factoryGuidance,
						resolveManagerSession: resolveFactoryManagerSession,
						listProjects,
						confirm: confirmFactoryGuidance,
					}) as AgentTool,
					createFactoryStagesTool({
						manager: this.tasks,
						resolveManagerSession: resolveFactoryManagerSession,
						listProjects,
						confirm: confirmFactoryStages,
					}) as AgentTool,
				],
				isManagerSession: async (sessionId) =>
					(await resolveFactoryManagerSession(sessionId)) !== undefined,
				// The manager's readme goes into its instructions only when the
				// user's file passed tamper detection (or is the built-in default).
				readme: () => readFactoryManagerReadme(this.factoryGuidance).block,
			}),
		);
		this.sessionTools.push(
			...factoryTools(async (sessionId) => {
				const session = await this.sessionHost.getSession(sessionId);
				if (!session || session.metadata?.factoryRole) return undefined;
				return {
					interactive:
						session.interactive !== false &&
						session.metadata?.interactive !== false,
					manager:
						isFactoryManagerSessionMetadata(session.metadata) &&
						session.interactive !== false,
					workspaceRoot: projectWorkspace(session.workspaceRoot),
					modelSelection: {
						providerId: session.provider,
						modelId: session.model,
					},
					originTaskId:
						typeof session.metadata?.agendaTaskId === "string"
							? session.metadata.agendaTaskId
							: undefined,
					intake: parseFactoryIntakeContext(
						session.metadata?.[FACTORY_INTAKE_METADATA_KEY],
					),
				};
			}),
		);
		this.settings = options.settingsService ?? new CoreSettingsService();
		if (options.cronOptions) {
			this.cronService = new CronService({
				runtimeHandlers,
				...options.cronOptions,
				telemetry: options.telemetry,
			});
		}
		// Live activity for Factory role sessions (`task.factory.activity`):
		// one bounded, throttled event per tool start; never blocks the session.
		this.factoryActivity = new FactoryActivityPublisher({
			resolveSession: async (sessionId) => {
				const metadata = (await this.sessionHost.getSession(sessionId))
					?.metadata;
				const role = metadata?.factoryRole;
				const taskId = metadata?.factoryTaskId;
				return typeof taskId === "string" &&
					(role === "designer" ||
						role === "builder" ||
						role === "verifier" ||
						role === "reviewer")
					? { taskId, role }
					: undefined;
			},
			getTask: (taskId) => this.tasks.getTask(taskId, { reconcile: false }),
			publish: (payload) =>
				this.publish(buildHubEvent("task.factory.activity", { ...payload })),
			onError: (error) =>
				logHubBoundaryError("factory activity publishing failed", error),
		});
		this.sessionHost.subscribe((event: CoreSessionEvent) => {
			this.factoryActivity.handle(event);
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
			if (event.type === "ended") {
				void this.sessionSearch.refreshNow().catch((error) => {
					logHubBoundaryError("session search indexing failed", error);
				});
			}
		});
	}

	private async startAgendaTaskSession(
		task: AgendaTaskRecord,
		run: AgendaTaskRunRecord | undefined,
		requestedByClientId?: string,
		unattended = false,
		factoryRole?: "builder" | "reviewer" | "designer" | "verifier" | "analyst",
		factoryAgent?: FactoryAgent,
		requestedSessionId?: string,
		// The feedback analyst gets no guidance: it judges the guidance itself.
		guidanceRole: FactoryRoleGuidanceRole | undefined = factoryRole ===
		"analyst"
			? undefined
			: factoryRole,
		// A repository stage's session: the role's tools, but no role
		// guidance and no questions to a person.
		factoryStage?: string,
	): Promise<{ sessionId: string }> {
		if (factoryStage) guidanceRole = undefined;
		if (task.factory) assertFactoryProvider(task);
		if (factoryAgent) factoryAgent = freezeFactoryAgent(task, factoryAgent);
		const skills =
			factoryAgent?.skills ?? factoryAgent?.resolvedProfile?.skills;
		const profileTools =
			factoryAgent?.tools ?? factoryAgent?.resolvedProfile?.tools;
		const allowedProfileTools = profileTools
			? [
					...profileTools.map(resolveConfiguredAgentToolName),
					...(skills !== undefined ? ["skills"] : []),
				]
			: undefined;
		const roleTools =
			!factoryRole || factoryRole === "builder"
				? undefined
				: factoryRole === "analyst"
					? ["read_files", "search_codebase"]
					: [
							"read_files",
							"search_codebase",
							"skills",
							...(factoryRole === "verifier" ? ["run_commands"] : []),
						];
		const allowedTools = allowedProfileTools
			? allowedProfileTools.filter(
					(name) =>
						!roleTools ||
						roleTools.includes(name) ||
						(factoryRole === "verifier" &&
							![
								"editor",
								"apply_patch",
								"ask_question",
								"submit_and_exit",
								"spawn_agent",
							].includes(name)),
				)
			: roleTools;
		const desiredSessionId = requestedSessionId ?? createSessionId();
		const originSession = task.originSessionId
			? await this.sessionHost.getSession(task.originSessionId)
			: undefined;
		const inheritedAutoApproveTools =
			originSession?.metadata?.autoApproveTools === true;
		const autoApproveTools = task.factory
			? factoryRole !== "designer"
			: unattended || inheritedAutoApproveTools;
		const providerId = task.modelSelection?.providerId?.trim() || "cline";
		const modelId =
			task.modelSelection?.modelId?.trim() ||
			(providerId === "cline" ? CLINE_DEFAULT_MODEL_ID : "");
		const executionRule =
			task.factory &&
			task.cwd &&
			task.workspaceRoot &&
			resolve(task.cwd) !== resolve(task.workspaceRoot)
				? `Factory execution directory: ${task.cwd}. File-location references under the original project root ${task.workspaceRoot} refer to matching paths in this assigned worktree. Inspect, edit, and run checks against the candidate worktree; never edit the original project. Preserve literal code and data requirements unchanged; this mapping applies to file locations, not their contents.`
				: undefined;
		// The user's standing guidance for this role, then the repository's
		// (fenced as data). Read when the role session starts, so every later
		// card uses the current version; absent guidance adds nothing. A
		// scoping (designer) session gets the routing guidance first, ahead of
		// its role guidance; no other role sees it.
		const guidanceLocation = { workspaceRoot: task.workspaceRoot ?? task.cwd };
		const roleGuidance =
			task.factory && guidanceRole
				? [
						...(guidanceRole === "designer"
							? [this.factoryGuidance.routingGuidance(guidanceLocation).block]
							: []),
						this.factoryGuidance.promptBlock(guidanceRole, guidanceLocation),
					]
						.filter((block): block is string => !!block)
						.join("\n\n") || undefined
				: undefined;
		const basePrompt =
			executionRule && task.systemPrompt?.trim()
				? `${task.systemPrompt}\n\n${executionRule}`
				: (task.systemPrompt ?? "");
		const systemPrompt = roleGuidance
			? basePrompt
				? `${basePrompt}\n\n${roleGuidance}`
				: roleGuidance
			: basePrompt;
		const metadata = withSessionHistoryOriginMetadata(
			{
				title: task.title,
				agendaTaskId: task.taskId,
				agendaTaskRunId: run?.runId,
				factoryTaskId: task.factory ? task.taskId : undefined,
				factoryRole,
				...(factoryStage ? { factoryStage } : {}),
				factoryDesignConfig:
					factoryRole === "designer"
						? factoryDesignConfig(task, factoryAgent)
						: undefined,
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
					workspaceRoot: task.factory ? task.cwd : task.workspaceRoot,
					cwd: task.cwd,
					sessionConfig: {
						sessionId: desiredSessionId,
						configurationRoot: task.factory
							? (task.workspaceRoot ?? task.cwd)
							: undefined,
						skills,
						providerId,
						modelId,
						systemPrompt,
						rules: executionRule,
						mode: task.mode ?? "act",
						maxIterations: task.maxIterations,
						enableTools: true,
						enableSpawnAgent: !task.factory,
						enableAgentTeams: !task.factory,
					},
					metadata,
					...(requestedSessionId
						? {
								initialMessages:
									await this.sessionHost.readSessionMessages(
										requestedSessionId,
									),
							}
						: factoryRole === "designer" &&
								task.originSessionId &&
								originSession
							? {
									initialMessages: await this.sessionHost.readSessionMessages(
										task.originSessionId,
									),
								}
							: {}),
					runtimeOptions: {
						...(task.factory &&
						!factoryStage &&
						(factoryRole === "builder" || factoryRole === "designer")
							? {
									clientContributions: [
										{
											kind: "toolExecutor",
											executor: "askQuestion",
											capabilityName: "factory.askQuestion",
										},
									],
								}
							: {}),
						mode: task.mode ?? "act",
						maxIterations: task.maxIterations,
						enableTools: true,
						enableSpawn: !task.factory,
						enableTeams: !task.factory,
					},
					toolPolicies: {
						"*": {
							autoApprove: autoApproveTools,
							enabled: allowedTools === undefined,
						},
						...Object.fromEntries(
							(allowedTools ?? []).map((name) => [
								name,
								{ enabled: true, autoApprove: true },
							]),
						),
						...(task.factory &&
						!factoryStage &&
						(factoryRole === "builder" || factoryRole === "designer")
							? { ask_question: { enabled: true, autoApprove: true } }
							: {}),
						...(factoryStage ? { ask_question: { enabled: false } } : {}),
						// Factory roles never queue more Factory work; a builder's card
						// would also be committed into its candidate worktree.
						...(factoryRole
							? {
									[FACTORY_TOOL_NAME]: { enabled: false },
									[FACTORY_LIST_TOOL_NAME]: { enabled: false },
									[FACTORY_STATUS_TOOL_NAME]: { enabled: false },
									[FACTORY_GUIDANCE_TOOL_NAME]: { enabled: false },
									[FACTORY_STAGES_TOOL_NAME]: { enabled: false },
								}
							: {}),
					},
				},
			},
			(request) => requestToolApprovalHandler(this.ctx, request),
			async (
				sessionId,
				capabilityName,
				payload,
				targetClientId,
				onProgress,
			) => {
				if (task.factory && capabilityName === "factory.askQuestion") {
					const [question, options] = z
						.tuple([z.string(), z.array(z.string())])
						.parse(payload.args);
					return {
						result: await awaitHumanInput(
							this.ctx,
							sessionId,
							this.tasks.requestFactoryQuestion({
								taskId: task.taskId,
								sessionId,
								question,
								options,
							}),
						),
					};
				}
				return this.ctx.requestCapability(
					sessionId,
					capabilityName,
					payload,
					targetClientId,
					onProgress,
				);
			},
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
		run: Pick<AgendaTaskRunRecord, "requestedByClientId">,
	): Promise<AgendaTaskRuntimeResult> {
		const executionRoot = task.factory
			? task.cwd
			: (task.workspaceRoot ?? task.cwd);
		const resources = task.resourcePaths.length
			? `\n\nRelevant resources (paths are relative to workspace root ${executionRoot}):\n${task.resourcePaths
					.map(
						(resourcePath) =>
							`- ${resourcePath} (absolute: ${resolve(executionRoot ?? "", resourcePath)})`,
					)
					.join("\n")}`
			: "";
		const assignment = task.assignee
			? `\nAssigned agent: ${task.assignee}. If a configured agent or subagent with this name is available, delegate the work to it and oversee completion; otherwise execute it directly and mention the fallback in the summary.`
			: "";
		const prompt = `${task.factory && task.mode === "plan" ? "Design this feature. Implementation has not been approved." : "Execute this approved agenda task."}\n\nTitle: ${task.title}\nType: ${task.type}\nPriority: P${task.priority}${assignment}\n\n${task.instructions}${resources}`;
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
		const outcome: AgendaTaskRuntimeResult = !reply.ok
			? {
					status: "failed",
					error: reply.error?.message ?? "task session run failed",
				}
			: finishReason === "completed"
				? { status: "completed", summary }
				: finishReason === "aborted"
					? { status: "cancelled", summary }
					: {
							status: "failed",
							summary,
							error:
								summary ??
								(finishReason
									? `Task session ended with ${finishReason}`
									: "Task session did not return a completion result"),
						};
		if (task.factory) {
			const session = await this.sessionHost.getSession(sessionId);
			const stored = await this.sessionHost.updateSession(sessionId, {
				metadata: { ...session?.metadata, factoryRuntimeResult: outcome },
			});
			if (!stored.updated)
				throw new Error("Could not persist Factory session result");
		}
		return outcome;
	}

	getCronService(): CronService | undefined {
		return this.cronService;
	}

	getHubId(): string {
		return this.hubId;
	}

	async start(): Promise<void> {
		this.sessionSearch.start();
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
		await this.sessionSearch.dispose();
		this.factoryActivity.dispose();
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
					undefined,
					// Only a token-authenticated local client may start the
					// Factory manager; the Hub stamps its marker itself.
					{ mayStartFactoryManager: authority?.crossWorkspace === true },
				);
			case "session.restore":
				return await handleSessionRestore(
					this.ctx,
					envelope,
					(request: ToolApprovalRequest) =>
						requestToolApprovalHandler(this.ctx, request),
					{ mayStartFactoryManager: authority?.crossWorkspace === true },
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
			case "session.search":
				return await handleSessionSearch(this.ctx, envelope);
			case "session.update":
				return await handleSessionUpdate(this.ctx, envelope);
			case "session.update_connection":
				return await handleSessionUpdateConnection(this.ctx, envelope);
			case "session.compaction.update":
				return await handleSessionCompactionUpdate(this.ctx, envelope);
			case "session.pending_prompts":
				return await handleSessionPendingPrompts(this.ctx, envelope);
			case "session.steer_first_pending_prompt":
				return await handleSessionSteerFirstPendingPrompt(this.ctx, envelope);
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
