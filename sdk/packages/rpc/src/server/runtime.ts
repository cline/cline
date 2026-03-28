import { randomUUID } from "node:crypto";
import type { SchedulerService } from "@clinebot/scheduler";
import type {
	RpcChatStartSessionRequest,
	RpcProviderActionRequest,
} from "@clinebot/shared";
import type * as grpc from "@grpc/grpc-js";
import { fromProtoStruct, fromProtoValue, toProtoValue } from "../proto/serde";
import type { RpcRuntimeHandlers, RpcSessionBackend } from "../types";
import { RPC_PROTOCOL_VERSION } from "../version";
import {
	messageToRow,
	normalizeMetadataMap,
	normalizeStatus,
	nowIso,
	rowToMessage,
	safeString,
} from "./helpers";
import type {
	AbortRuntimeSessionRequest,
	AbortRuntimeSessionResponse,
	ClaimSpawnRequestRequest,
	ClaimSpawnRequestResponse,
	CompleteTaskRequest,
	CreateScheduleRequest,
	CreateScheduleResponse,
	DeleteScheduleRequest,
	DeleteScheduleResponse,
	DeleteSessionRequest,
	DeleteSessionResponse,
	EnqueueSpawnRequestRequest,
	EnqueueSpawnRequestResponse,
	EnsureSessionRequest,
	EnsureSessionResponse,
	GetActiveScheduledExecutionsRequest,
	GetActiveScheduledExecutionsResponse,
	GetScheduleRequest,
	GetScheduleResponse,
	GetScheduleStatsRequest,
	GetScheduleStatsResponse,
	GetSessionRequest,
	GetSessionResponse,
	GetUpcomingScheduledRunsRequest,
	GetUpcomingScheduledRunsResponse,
	HealthResponse,
	ListPendingApprovalsRequest,
	ListPendingApprovalsResponse,
	ListScheduleExecutionsRequest,
	ListScheduleExecutionsResponse,
	ListSchedulesRequest,
	ListSchedulesResponse,
	ListSessionsRequest,
	ListSessionsResponse,
	PauseScheduleRequest,
	PauseScheduleResponse,
	PublishEventRequest,
	PublishEventResponse,
	RegisterClientRequest,
	RegisterClientResponse,
	RequestToolApprovalRequest,
	RequestToolApprovalResponse,
	RespondToolApprovalRequest,
	RespondToolApprovalResponse,
	ResumeScheduleRequest,
	ResumeScheduleResponse,
	RoutedEventMessage,
	RunProviderActionRequest,
	RunProviderActionResponse,
	RunProviderOAuthLoginRequest,
	RunProviderOAuthLoginResponse,
	SendRuntimeSessionRequest,
	SendRuntimeSessionResponse,
	StartRuntimeSessionRequest,
	StartRuntimeSessionResponse,
	StartTaskRequest,
	StopRuntimeSessionRequest,
	StopRuntimeSessionResponse,
	StreamEventsRequest,
	TaskResponse,
	TriggerScheduleNowRequest,
	TriggerScheduleNowResponse,
	UpdateScheduleRequest,
	UpdateScheduleResponse,
	UpdateSessionRequest,
	UpdateSessionResponse,
	UpsertSessionRequest,
	UpsertSessionResponse,
} from "./proto-types";
import { RuntimeApprovalService } from "./runtime-approvals";
import { RuntimeEventService } from "./runtime-events";
import { RuntimeScheduleService } from "./runtime-schedules";

interface SessionState {
	sessionId: string;
	status: string;
	workspaceRoot?: string;
	clientId?: string;
	metadata?: Record<string, unknown>;
}

interface TaskState {
	sessionId: string;
	taskId: string;
	title?: string;
	status: string;
	payload?: Record<string, unknown>;
	result?: Record<string, unknown>;
}

interface RegisteredClientState {
	clientId: string;
	clientType?: string;
	metadata?: Record<string, string>;
	firstRegisteredAt: string;
	lastRegisteredAt: string;
	activationCount: number;
}

export class ClineGatewayRuntime {
	private readonly serverId = randomUUID();
	private readonly address: string;
	private readonly startedAt: string;
	private readonly runtimeHandlers?: RpcRuntimeHandlers;
	private readonly sessions = new Map<string, SessionState>();
	private readonly tasks = new Map<string, TaskState>();
	private readonly clients = new Map<string, RegisteredClientState>();
	private readonly store: RpcSessionBackend;
	private readonly eventService = new RuntimeEventService();
	private readonly approvalService = new RuntimeApprovalService((request) =>
		this.eventService.publishEvent(request),
	);
	private readonly scheduleService: RuntimeScheduleService;

	constructor(
		address: string,
		sessionBackend: RpcSessionBackend,
		runtimeHandlers?: RpcRuntimeHandlers,
		scheduler?: SchedulerService,
	) {
		this.address = address;
		this.startedAt = nowIso();
		this.store = sessionBackend;
		this.runtimeHandlers = runtimeHandlers;
		this.scheduleService = new RuntimeScheduleService(scheduler);
		this.store.init();
	}

	public health(): HealthResponse {
		return {
			serverId: this.serverId,
			address: this.address,
			running: true,
			startedAt: this.startedAt,
			rpcVersion: RPC_PROTOCOL_VERSION,
		};
	}

	public registerClient(
		request: RegisterClientRequest,
	): RegisterClientResponse {
		const requested = safeString(request.clientId).trim();
		const clientId = requested || `client_${randomUUID()}`;
		const clientType = safeString(request.clientType).trim() || undefined;
		const metadata = normalizeMetadataMap(
			request as unknown as { metadata?: unknown },
		);
		const now = nowIso();
		const existing = this.clients.get(clientId);
		const nextState: RegisteredClientState = existing
			? {
					...existing,
					clientType: clientType ?? existing.clientType,
					metadata:
						Object.keys(metadata).length > 0
							? { ...(existing.metadata ?? {}), ...metadata }
							: existing.metadata,
					lastRegisteredAt: now,
					activationCount: existing.activationCount + 1,
				}
			: {
					clientId,
					clientType,
					metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
					firstRegisteredAt: now,
					lastRegisteredAt: now,
					activationCount: 1,
				};
		this.clients.set(clientId, nextState);
		this.broadcastServerEvent("rpc.client.activated", {
			clientId: nextState.clientId,
			clientType: nextState.clientType,
			metadata: nextState.metadata ?? {},
			firstRegisteredAt: nextState.firstRegisteredAt,
			lastRegisteredAt: nextState.lastRegisteredAt,
			activationCount: nextState.activationCount,
		});
		return { clientId, registered: true };
	}

	public ensureSession(request: EnsureSessionRequest): EnsureSessionResponse {
		const sessionId = safeString(request.sessionId).trim();
		if (!sessionId) {
			throw new Error("sessionId is required");
		}
		const existing = this.sessions.get(sessionId);
		if (existing) {
			existing.status = safeString(request.status).trim() || existing.status;
			existing.workspaceRoot =
				safeString(request.workspaceRoot).trim() || existing.workspaceRoot;
			existing.clientId =
				safeString(request.clientId).trim() || existing.clientId;
			existing.metadata =
				fromProtoStruct(request.metadata) ?? existing.metadata;
			return { sessionId, created: false, status: existing.status };
		}
		const status = safeString(request.status).trim() || "running";
		this.sessions.set(sessionId, {
			sessionId,
			status,
			workspaceRoot: safeString(request.workspaceRoot).trim() || undefined,
			clientId: safeString(request.clientId).trim() || undefined,
			metadata: fromProtoStruct(request.metadata),
		});
		return { sessionId, created: true, status };
	}

	public upsertSession(request: UpsertSessionRequest): UpsertSessionResponse {
		if (!request.session) {
			throw new Error("session is required");
		}
		this.store.upsertSession(messageToRow(request.session));
		return { persisted: true };
	}

	public getSession(request: GetSessionRequest): GetSessionResponse {
		const sessionId = safeString(request.sessionId).trim();
		if (!sessionId) {
			throw new Error("sessionId is required");
		}
		const row = this.store.getSession(sessionId);
		if (!row) {
			return {};
		}
		return { session: rowToMessage(row) };
	}

	public listSessions(request: ListSessionsRequest): ListSessionsResponse {
		const limit =
			typeof request.limit === "number" && request.limit > 0
				? Math.floor(request.limit)
				: 200;
		const rows = this.store.listSessions({
			limit,
			parentSessionId: safeString(request.parentSessionId).trim() || undefined,
			status: safeString(request.status).trim() || undefined,
		});
		return { sessions: rows.map((row) => rowToMessage(row)) };
	}

	public updateSession(request: UpdateSessionRequest): UpdateSessionResponse {
		const sessionId = safeString(request.sessionId).trim();
		if (!sessionId) {
			throw new Error("sessionId is required");
		}
		return this.store.updateSession({
			sessionId,
			status: request.status ? normalizeStatus(request.status) : undefined,
			endedAt: request.endedAt ? request.endedAt : undefined,
			exitCode: request.hasExitCode ? (request.exitCode ?? null) : undefined,
			prompt: request.hasPrompt ? (request.prompt ?? null) : undefined,
			metadata: request.hasMetadata
				? ((fromProtoStruct(request.metadata) ?? null) as Record<
						string,
						unknown
					> | null)
				: undefined,
			parentSessionId: request.hasParentSessionId
				? (request.parentSessionId ?? null)
				: undefined,
			parentAgentId: request.hasParentAgentId
				? (request.parentAgentId ?? null)
				: undefined,
			agentId: request.hasAgentId ? (request.agentId ?? null) : undefined,
			conversationId: request.hasConversationId
				? (request.conversationId ?? null)
				: undefined,
			expectedStatusLock: request.hasExpectedStatusLock
				? request.expectedStatusLock
				: undefined,
			setRunning: request.setRunning === true,
		});
	}

	public deleteSession(request: DeleteSessionRequest): DeleteSessionResponse {
		const sessionId = safeString(request.sessionId).trim();
		if (!sessionId) {
			throw new Error("sessionId is required");
		}
		const deleted = this.store.deleteSession(sessionId);
		if (request.cascade === true) {
			this.store.deleteSessionsByParent(sessionId);
		}
		return { deleted };
	}

	public enqueueSpawnRequest(
		request: EnqueueSpawnRequestRequest,
	): EnqueueSpawnRequestResponse {
		const rootSessionId = safeString(request.rootSessionId).trim();
		const parentAgentId = safeString(request.parentAgentId).trim();
		if (!rootSessionId || !parentAgentId) {
			throw new Error("rootSessionId and parentAgentId are required");
		}
		this.store.enqueueSpawnRequest({
			rootSessionId,
			parentAgentId,
			task: safeString(request.task).trim() || undefined,
			systemPrompt: safeString(request.systemPrompt).trim() || undefined,
		});
		return { enqueued: true };
	}

	public claimSpawnRequest(
		request: ClaimSpawnRequestRequest,
	): ClaimSpawnRequestResponse {
		const rootSessionId = safeString(request.rootSessionId).trim();
		const parentAgentId = safeString(request.parentAgentId).trim();
		if (!rootSessionId || !parentAgentId) {
			throw new Error("rootSessionId and parentAgentId are required");
		}
		const item = this.store.claimSpawnRequest(rootSessionId, parentAgentId);
		if (!item) {
			return {};
		}
		return {
			item: {
				id: String(item.id),
				rootSessionId: item.rootSessionId,
				parentAgentId: item.parentAgentId,
				task: item.task ?? "",
				systemPrompt: item.systemPrompt ?? "",
				createdAt: item.createdAt,
				consumedAt: item.consumedAt ?? "",
			},
		};
	}

	public async startRuntimeSession(
		request: StartRuntimeSessionRequest,
	): Promise<StartRuntimeSessionResponse> {
		const handler = this.runtimeHandlers?.startSession;
		if (!handler) {
			throw new Error("runtime start handler is not configured");
		}
		const payload: RpcChatStartSessionRequest | undefined = request.request
			? {
					sessionId: safeString(request.request.sessionId),
					workspaceRoot: safeString(request.request.workspaceRoot),
					cwd: safeString(request.request.cwd),
					provider: safeString(request.request.provider),
					model: safeString(request.request.model),
					mode: safeString(request.request.mode) as "act" | "plan",
					apiKey: safeString(request.request.apiKey),
					systemPrompt: safeString(request.request.systemPrompt),
					maxIterations: request.request.hasMaxIterations
						? request.request.maxIterations
						: undefined,
					enableTools: request.request.enableTools === true,
					enableSpawn: request.request.enableSpawn === true,
					enableTeams: request.request.enableTeams === true,
					autoApproveTools: request.request.hasAutoApproveTools
						? request.request.autoApproveTools === true
						: undefined,
					teamName: safeString(request.request.teamName),
					missionStepInterval: request.request.missionStepInterval ?? 3,
					missionTimeIntervalMs:
						request.request.missionTimeIntervalMs ?? 120000,
					toolPolicies: Object.fromEntries(
						Object.entries(request.request.toolPolicies ?? {}).map(
							([name, policy]) => [
								name,
								{
									enabled: policy?.enabled === true,
									autoApprove: policy?.autoApprove === true,
								},
							],
						),
					),
					initialMessages: (request.request.initialMessages ?? []).map(
						(message) => ({
							role: safeString(message.role),
							content: fromProtoValue(message.content),
						}),
					),
					logger: request.request.logger
						? {
								enabled: request.request.logger.enabled === true,
								level: safeString(request.request.logger.level) as
									| "trace"
									| "debug"
									| "info"
									| "warn"
									| "error"
									| "fatal"
									| "silent",
								destination: safeString(request.request.logger.destination),
								name: safeString(request.request.logger.name),
								bindings: fromProtoStruct(request.request.logger.bindings) as
									| Record<string, string | number | boolean>
									| undefined,
							}
						: undefined,
				}
			: undefined;
		if (!payload) {
			throw new Error("runtime start request is required");
		}
		const result = await handler(payload);
		const sessionId = safeString(result.sessionId).trim();
		if (!sessionId) {
			throw new Error("runtime start handler returned empty sessionId");
		}
		return {
			sessionId,
			startResult: result.startResult
				? {
						sessionId: safeString(result.startResult.sessionId),
						manifestPath: safeString(result.startResult.manifestPath),
						transcriptPath: safeString(result.startResult.transcriptPath),
						hookPath: safeString(result.startResult.hookPath),
						messagesPath: safeString(result.startResult.messagesPath),
					}
				: undefined,
		};
	}

	public async sendRuntimeSession(
		request: SendRuntimeSessionRequest,
	): Promise<SendRuntimeSessionResponse> {
		const handler = this.runtimeHandlers?.sendSession;
		if (!handler) {
			throw new Error("runtime send handler is not configured");
		}
		const sessionId = safeString(request.sessionId).trim();
		if (!sessionId) {
			throw new Error("sessionId is required");
		}
		const delivery: "queue" | "steer" | undefined =
			request.request?.delivery === "queue" ||
			request.request?.delivery === "steer"
				? request.request.delivery
				: undefined;
		const payload = request.request
			? {
					config: {
						workspaceRoot: safeString(request.request.config?.workspaceRoot),
						cwd: safeString(request.request.config?.cwd),
						provider: safeString(request.request.config?.provider),
						model: safeString(request.request.config?.model),
						mode: safeString(request.request.config?.mode) as "act" | "plan",
						apiKey: safeString(request.request.config?.apiKey),
						systemPrompt: safeString(request.request.config?.systemPrompt),
						maxIterations: request.request.config?.hasMaxIterations
							? request.request.config?.maxIterations
							: undefined,
						enableTools: request.request.config?.enableTools === true,
						enableSpawn: request.request.config?.enableSpawn === true,
						enableTeams: request.request.config?.enableTeams === true,
						autoApproveTools: request.request.config?.hasAutoApproveTools
							? request.request.config?.autoApproveTools === true
							: undefined,
						teamName: safeString(request.request.config?.teamName),
						missionStepInterval:
							request.request.config?.missionStepInterval ?? 3,
						missionTimeIntervalMs:
							request.request.config?.missionTimeIntervalMs ?? 120000,
						toolPolicies: Object.fromEntries(
							Object.entries(request.request.config?.toolPolicies ?? {}).map(
								([name, policy]) => [
									name,
									{
										enabled: policy?.enabled === true,
										autoApprove: policy?.autoApprove === true,
									},
								],
							),
						),
						initialMessages: (
							request.request.config?.initialMessages ?? []
						).map((message) => ({
							role: safeString(message.role),
							content: fromProtoValue(message.content),
						})),
						logger: request.request.config?.logger
							? {
									enabled: request.request.config.logger.enabled === true,
									level: safeString(request.request.config.logger.level) as
										| "trace"
										| "debug"
										| "info"
										| "warn"
										| "error"
										| "fatal"
										| "silent",
									destination: safeString(
										request.request.config.logger.destination,
									),
									name: safeString(request.request.config.logger.name),
									bindings: fromProtoStruct(
										request.request.config.logger.bindings,
									) as Record<string, string | number | boolean> | undefined,
								}
							: undefined,
					},
					messages: (request.request.messages ?? []).map((message) => ({
						role: safeString(message.role),
						content: fromProtoValue(message.content),
					})),
					prompt: safeString(request.request.prompt),
					delivery,
					attachments: request.request.attachments
						? {
								userImages: request.request.attachments.userImages ?? [],
								userFiles: (request.request.attachments.userFiles ?? []).map(
									(file) => ({
										name: safeString(file.name),
										content: safeString(file.content),
									}),
								),
							}
						: undefined,
				}
			: undefined;
		if (!payload) {
			throw new Error("runtime send request is required");
		}
		const result = await handler(sessionId, payload);
		if (!result.result) {
			return {};
		}
		return {
			result: {
				text: safeString(result.result.text),
				usage: {
					inputTokens: result.result.usage.inputTokens,
					outputTokens: result.result.usage.outputTokens,
					cacheReadTokens: result.result.usage.cacheReadTokens ?? 0,
					hasCacheReadTokens:
						typeof result.result.usage.cacheReadTokens === "number",
					cacheWriteTokens: result.result.usage.cacheWriteTokens ?? 0,
					hasCacheWriteTokens:
						typeof result.result.usage.cacheWriteTokens === "number",
					totalCost: result.result.usage.totalCost ?? 0,
					hasTotalCost: typeof result.result.usage.totalCost === "number",
				},
				inputTokens: result.result.inputTokens,
				outputTokens: result.result.outputTokens,
				iterations: result.result.iterations,
				finishReason: safeString(result.result.finishReason),
				messages: (result.result.messages ?? []).map((message) => ({
					role: safeString(message.role),
					content: toProtoValue(message.content),
				})),
				toolCalls: (result.result.toolCalls ?? []).map((toolCall) => ({
					name: safeString(toolCall.name),
					input: toProtoValue(toolCall.input),
					hasInput: toolCall.input !== undefined,
					output: toProtoValue(toolCall.output),
					hasOutput: toolCall.output !== undefined,
					error: safeString(toolCall.error),
					durationMs: toolCall.durationMs ?? 0,
					hasDurationMs: typeof toolCall.durationMs === "number",
				})),
			},
		};
	}

	public async stopRuntimeSession(
		request: StopRuntimeSessionRequest,
	): Promise<StopRuntimeSessionResponse> {
		const handler = this.runtimeHandlers?.stopSession;
		if (!handler) {
			throw new Error("runtime stop handler is not configured");
		}
		const sessionId = safeString(request.sessionId).trim();
		if (!sessionId) {
			throw new Error("sessionId is required");
		}
		const result = await handler(sessionId);
		return { applied: result.applied === true };
	}

	public async abortRuntimeSession(
		request: AbortRuntimeSessionRequest,
	): Promise<AbortRuntimeSessionResponse> {
		const handler = this.runtimeHandlers?.abortSession;
		if (!handler) {
			throw new Error("runtime abort handler is not configured");
		}
		const sessionId = safeString(request.sessionId).trim();
		if (!sessionId) {
			throw new Error("sessionId is required");
		}
		const result = await handler(sessionId);
		return { applied: result.applied === true };
	}

	public async runProviderAction(
		request: RunProviderActionRequest,
	): Promise<RunProviderActionResponse> {
		const handler = this.runtimeHandlers?.runProviderAction;
		if (!handler) {
			throw new Error("provider action handler is not configured");
		}
		if (!request.request) {
			throw new Error("provider action request is required");
		}
		let payload: RpcProviderActionRequest;
		if (request.request.listProviders) {
			payload = { action: "listProviders" };
		} else if (request.request.getProviderModels) {
			payload = {
				action: "getProviderModels",
				providerId: safeString(request.request.getProviderModels.providerId),
			};
		} else if (request.request.addProvider) {
			payload = {
				action: "addProvider",
				providerId: safeString(request.request.addProvider.providerId),
				name: safeString(request.request.addProvider.name),
				baseUrl: safeString(request.request.addProvider.baseUrl),
				apiKey: safeString(request.request.addProvider.apiKey) || undefined,
				headers: request.request.addProvider.headers ?? undefined,
				timeoutMs: request.request.addProvider.hasTimeoutMs
					? request.request.addProvider.timeoutMs
					: undefined,
				models: request.request.addProvider.models ?? undefined,
				defaultModelId:
					safeString(request.request.addProvider.defaultModelId) || undefined,
				modelsSourceUrl:
					safeString(request.request.addProvider.modelsSourceUrl) || undefined,
				capabilities: request.request.addProvider.capabilities as
					| Array<
							"reasoning" | "prompt-cache" | "streaming" | "tools" | "vision"
					  >
					| undefined,
			};
		} else if (request.request.saveProviderSettings) {
			payload = {
				action: "saveProviderSettings",
				providerId: safeString(request.request.saveProviderSettings.providerId),
				enabled: request.request.saveProviderSettings.hasEnabled
					? request.request.saveProviderSettings.enabled
					: undefined,
				apiKey: request.request.saveProviderSettings.hasApiKey
					? request.request.saveProviderSettings.apiKey
					: undefined,
				baseUrl: request.request.saveProviderSettings.hasBaseUrl
					? request.request.saveProviderSettings.baseUrl
					: undefined,
			};
		} else {
			const operation = safeString(request.request.clineAccount?.operation);
			if (operation === "fetchMe") {
				payload = { action: "clineAccount", operation: "fetchMe" };
			} else if (operation === "fetchBalance") {
				payload = {
					action: "clineAccount",
					operation: "fetchBalance",
					userId: safeString(request.request.clineAccount?.userId) || undefined,
				};
			} else if (operation === "fetchUsageTransactions") {
				payload = {
					action: "clineAccount",
					operation: "fetchUsageTransactions",
					userId: safeString(request.request.clineAccount?.userId) || undefined,
				};
			} else if (operation === "fetchPaymentTransactions") {
				payload = {
					action: "clineAccount",
					operation: "fetchPaymentTransactions",
					userId: safeString(request.request.clineAccount?.userId) || undefined,
				};
			} else if (operation === "fetchUserOrganizations") {
				payload = {
					action: "clineAccount",
					operation: "fetchUserOrganizations",
				};
			} else if (operation === "fetchOrganizationBalance") {
				payload = {
					action: "clineAccount",
					operation: "fetchOrganizationBalance",
					organizationId: safeString(
						request.request.clineAccount?.organizationId,
					),
				};
			} else if (operation === "fetchOrganizationUsageTransactions") {
				payload = {
					action: "clineAccount",
					operation: "fetchOrganizationUsageTransactions",
					organizationId: safeString(
						request.request.clineAccount?.organizationId,
					),
					memberId:
						safeString(request.request.clineAccount?.memberId) || undefined,
				};
			} else {
				payload = {
					action: "clineAccount",
					operation: "switchAccount",
					organizationId: request.request.clineAccount?.clearOrganizationId
						? null
						: safeString(request.request.clineAccount?.organizationId) ||
							undefined,
				};
			}
		}
		const result = await handler(payload);
		return { result: toProtoValue(result.result) };
	}

	public async runProviderOAuthLogin(
		request: RunProviderOAuthLoginRequest,
	): Promise<RunProviderOAuthLoginResponse> {
		const handler = this.runtimeHandlers?.runProviderOAuthLogin;
		if (!handler) {
			throw new Error("provider oauth handler is not configured");
		}
		const provider = safeString(request.provider).trim();
		if (!provider) {
			throw new Error("provider is required");
		}
		const result = await handler(provider);
		return {
			provider: safeString(result.provider).trim(),
			apiKey: safeString(result.accessToken),
		};
	}

	public startTask(request: StartTaskRequest): TaskResponse {
		const sessionId = safeString(request.sessionId).trim();
		const taskId = safeString(request.taskId).trim();
		if (!sessionId || !taskId) {
			throw new Error("sessionId and taskId are required");
		}
		const key = `${sessionId}:${taskId}`;
		this.tasks.set(key, {
			sessionId,
			taskId,
			title: safeString(request.title).trim() || undefined,
			status: "running",
			payload: fromProtoStruct(request.payload) ?? undefined,
		});
		this.eventService.publishEvent({
			eventId: "",
			sessionId,
			taskId,
			eventType: "task.started",
			payload: fromProtoStruct(request.payload) ?? {},
			sourceClientId: "",
		});
		return { sessionId, taskId, status: "running", updated: true };
	}

	public completeTask(request: CompleteTaskRequest): TaskResponse {
		const sessionId = safeString(request.sessionId).trim();
		const taskId = safeString(request.taskId).trim();
		if (!sessionId || !taskId) {
			throw new Error("sessionId and taskId are required");
		}
		const key = `${sessionId}:${taskId}`;
		const nextStatus = safeString(request.status).trim() || "completed";
		const existing = this.tasks.get(key);
		if (!existing) {
			return { sessionId, taskId, status: nextStatus, updated: false };
		}
		existing.status = nextStatus;
		existing.result = fromProtoStruct(request.result) ?? undefined;
		this.eventService.publishEvent({
			eventId: "",
			sessionId,
			taskId,
			eventType: "task.completed",
			payload: fromProtoStruct(request.result) ?? {},
			sourceClientId: "",
		});
		return { sessionId, taskId, status: nextStatus, updated: true };
	}

	public publishEvent(request: PublishEventRequest): PublishEventResponse {
		return this.eventService.publishEvent(request);
	}

	public addSubscriber(
		call: grpc.ServerWritableStream<StreamEventsRequest, RoutedEventMessage>,
	): number {
		return this.eventService.addSubscriber(call);
	}

	public removeSubscriber(subscriberId: number): void {
		this.eventService.removeSubscriber(subscriberId);
	}

	public requestToolApproval(
		request: RequestToolApprovalRequest,
	): Promise<RequestToolApprovalResponse> {
		return this.approvalService.requestToolApproval(request);
	}

	public respondToolApproval(
		request: RespondToolApprovalRequest,
	): RespondToolApprovalResponse {
		return this.approvalService.respondToolApproval(request);
	}

	public listPendingApprovals(
		request: ListPendingApprovalsRequest,
	): ListPendingApprovalsResponse {
		return this.approvalService.listPendingApprovals(request);
	}

	public createSchedule(
		request: CreateScheduleRequest,
	): CreateScheduleResponse {
		return this.scheduleService.createSchedule(request);
	}

	public getSchedule(request: GetScheduleRequest): GetScheduleResponse {
		return this.scheduleService.getSchedule(request);
	}

	public listSchedules(request: ListSchedulesRequest): ListSchedulesResponse {
		return this.scheduleService.listSchedules(request);
	}

	public updateSchedule(
		request: UpdateScheduleRequest,
	): UpdateScheduleResponse {
		return this.scheduleService.updateSchedule(request);
	}

	public deleteSchedule(
		request: DeleteScheduleRequest,
	): DeleteScheduleResponse {
		return this.scheduleService.deleteSchedule(request);
	}

	public pauseSchedule(request: PauseScheduleRequest): PauseScheduleResponse {
		return this.scheduleService.pauseSchedule(request);
	}

	public resumeSchedule(
		request: ResumeScheduleRequest,
	): ResumeScheduleResponse {
		return this.scheduleService.resumeSchedule(request);
	}

	public triggerScheduleNow(
		request: TriggerScheduleNowRequest,
	): Promise<TriggerScheduleNowResponse> {
		return this.scheduleService.triggerScheduleNow(request);
	}

	public listScheduleExecutions(
		request: ListScheduleExecutionsRequest,
	): ListScheduleExecutionsResponse {
		return this.scheduleService.listScheduleExecutions(request);
	}

	public getScheduleStats(
		request: GetScheduleStatsRequest,
	): GetScheduleStatsResponse {
		return this.scheduleService.getScheduleStats(request);
	}

	public getActiveScheduledExecutions(
		request: GetActiveScheduledExecutionsRequest,
	): GetActiveScheduledExecutionsResponse {
		return this.scheduleService.getActiveScheduledExecutions(request);
	}

	public getUpcomingScheduledRuns(
		request: GetUpcomingScheduledRunsRequest,
	): GetUpcomingScheduledRunsResponse {
		return this.scheduleService.getUpcomingScheduledRuns(request);
	}

	public broadcastServerEvent(eventType: string, payload: unknown): void {
		this.eventService.broadcastServerEvent(eventType, payload);
	}
}
