import {
	RPC_TEAM_LIFECYCLE_EVENT_TYPE,
	RPC_TEAM_PROGRESS_EVENT_TYPE,
	type RpcChatRunTurnRequest,
	type RpcChatStartSessionArtifacts,
	type RpcChatStartSessionRequest,
	type RpcChatStartSessionResponse,
	type RpcChatTurnResult,
	type RpcProviderActionRequest,
	type TeamProgressLifecycleEvent,
	type TeamProgressProjectionEvent,
} from "@clinebot/shared";
import type * as grpc from "@grpc/grpc-js";
import { createGatewayGenericClient } from "./gateway-client";
import type { AbortRuntimeSessionResponse__Output } from "./proto/generated/cline/rpc/v1/AbortRuntimeSessionResponse";
import type { ClaimSpawnRequestRequest } from "./proto/generated/cline/rpc/v1/ClaimSpawnRequestRequest";
import type { ClaimSpawnRequestResponse__Output } from "./proto/generated/cline/rpc/v1/ClaimSpawnRequestResponse";
import type { ClineGatewayClient } from "./proto/generated/cline/rpc/v1/ClineGateway";
import type { CreateScheduleResponse__Output } from "./proto/generated/cline/rpc/v1/CreateScheduleResponse";
import type { DeleteScheduleResponse__Output } from "./proto/generated/cline/rpc/v1/DeleteScheduleResponse";
import type { DeleteSessionResponse__Output } from "./proto/generated/cline/rpc/v1/DeleteSessionResponse";
import type { EnqueueSpawnRequestResponse__Output } from "./proto/generated/cline/rpc/v1/EnqueueSpawnRequestResponse";
import type { GetActiveScheduledExecutionsResponse__Output } from "./proto/generated/cline/rpc/v1/GetActiveScheduledExecutionsResponse";
import type { GetScheduleResponse__Output } from "./proto/generated/cline/rpc/v1/GetScheduleResponse";
import type { GetScheduleStatsResponse__Output } from "./proto/generated/cline/rpc/v1/GetScheduleStatsResponse";
import type { GetSessionResponse__Output } from "./proto/generated/cline/rpc/v1/GetSessionResponse";
import type { GetUpcomingScheduledRunsResponse__Output } from "./proto/generated/cline/rpc/v1/GetUpcomingScheduledRunsResponse";
import type { ListPendingApprovalsResponse__Output } from "./proto/generated/cline/rpc/v1/ListPendingApprovalsResponse";
import type { ListScheduleExecutionsResponse__Output } from "./proto/generated/cline/rpc/v1/ListScheduleExecutionsResponse";
import type { ListSchedulesResponse__Output } from "./proto/generated/cline/rpc/v1/ListSchedulesResponse";
import type { ListSessionsResponse__Output } from "./proto/generated/cline/rpc/v1/ListSessionsResponse";
import type { PauseScheduleResponse__Output } from "./proto/generated/cline/rpc/v1/PauseScheduleResponse";
import type { PublishEventResponse__Output } from "./proto/generated/cline/rpc/v1/PublishEventResponse";
import type { RequestToolApprovalRequest } from "./proto/generated/cline/rpc/v1/RequestToolApprovalRequest";
import type { RequestToolApprovalResponse__Output } from "./proto/generated/cline/rpc/v1/RequestToolApprovalResponse";
import type { RespondToolApprovalRequest } from "./proto/generated/cline/rpc/v1/RespondToolApprovalRequest";
import type { RespondToolApprovalResponse__Output } from "./proto/generated/cline/rpc/v1/RespondToolApprovalResponse";
import type { ResumeScheduleResponse__Output } from "./proto/generated/cline/rpc/v1/ResumeScheduleResponse";
import type { RoutedEvent__Output } from "./proto/generated/cline/rpc/v1/RoutedEvent";
import type { RunProviderActionResponse__Output } from "./proto/generated/cline/rpc/v1/RunProviderActionResponse";
import type { RunProviderOAuthLoginResponse__Output } from "./proto/generated/cline/rpc/v1/RunProviderOAuthLoginResponse";
import type { Schedule__Output } from "./proto/generated/cline/rpc/v1/Schedule";
import type { ScheduleExecution__Output } from "./proto/generated/cline/rpc/v1/ScheduleExecution";
import type { SendRuntimeSessionResponse__Output } from "./proto/generated/cline/rpc/v1/SendRuntimeSessionResponse";
import type {
	SessionRecord,
	SessionRecord__Output,
} from "./proto/generated/cline/rpc/v1/SessionRecord";
import type { StartRuntimeSessionResponse__Output } from "./proto/generated/cline/rpc/v1/StartRuntimeSessionResponse";
import type { StopRuntimeSessionResponse__Output } from "./proto/generated/cline/rpc/v1/StopRuntimeSessionResponse";
import type { TriggerScheduleNowResponse__Output } from "./proto/generated/cline/rpc/v1/TriggerScheduleNowResponse";
import type { UpcomingScheduledRun__Output } from "./proto/generated/cline/rpc/v1/UpcomingScheduledRun";
import type { UpdateScheduleRequest } from "./proto/generated/cline/rpc/v1/UpdateScheduleRequest";
import type { UpdateScheduleResponse__Output } from "./proto/generated/cline/rpc/v1/UpdateScheduleResponse";
import type { UpdateSessionRequest } from "./proto/generated/cline/rpc/v1/UpdateSessionRequest";
import type { UpdateSessionResponse__Output } from "./proto/generated/cline/rpc/v1/UpdateSessionResponse";
import type { UpsertSessionRequest } from "./proto/generated/cline/rpc/v1/UpsertSessionRequest";
import {
	fromProtoStruct,
	fromProtoValue,
	toProtoStruct,
	toProtoValue,
} from "./proto/serde";
import type {
	RpcScheduleExecution,
	RpcScheduleRecord,
	RpcSessionRow,
	RpcSessionUpdateInput,
} from "./types";

function toMessage(row: RpcSessionRow): SessionRecord {
	return {
		sessionId: row.sessionId,
		source: row.source,
		pid: row.pid,
		startedAt: row.startedAt,
		endedAt: row.endedAt ?? "",
		exitCode: row.exitCode ?? 0,
		status: row.status,
		statusLock: row.statusLock,
		interactive: row.interactive,
		provider: row.provider,
		model: row.model,
		cwd: row.cwd,
		workspaceRoot: row.workspaceRoot,
		teamName: row.teamName ?? "",
		enableTools: row.enableTools,
		enableSpawn: row.enableSpawn,
		enableTeams: row.enableTeams,
		parentSessionId: row.parentSessionId ?? "",
		parentAgentId: row.parentAgentId ?? "",
		agentId: row.agentId ?? "",
		conversationId: row.conversationId ?? "",
		isSubagent: row.isSubagent,
		prompt: row.prompt ?? "",
		transcriptPath: row.transcriptPath,
		hookPath: row.hookPath,
		messagesPath: row.messagesPath ?? "",
		updatedAt: row.updatedAt,
		metadata: toProtoStruct(row.metadata),
	};
}

function fromMessage(message: SessionRecord__Output): RpcSessionRow {
	return {
		sessionId: message.sessionId ?? "",
		source: message.source ?? "",
		pid: Number(message.pid ?? 0),
		startedAt: message.startedAt ?? "",
		endedAt: message.endedAt ? message.endedAt : null,
		exitCode: typeof message.exitCode === "number" ? message.exitCode : null,
		status: (message.status as RpcSessionRow["status"]) ?? "running",
		statusLock: Number(message.statusLock ?? 0),
		interactive: message.interactive === true,
		provider: message.provider ?? "",
		model: message.model ?? "",
		cwd: message.cwd ?? "",
		workspaceRoot: message.workspaceRoot ?? "",
		teamName: message.teamName || undefined,
		enableTools: message.enableTools === true,
		enableSpawn: message.enableSpawn === true,
		enableTeams: message.enableTeams === true,
		parentSessionId: message.parentSessionId || undefined,
		parentAgentId: message.parentAgentId || undefined,
		agentId: message.agentId || undefined,
		conversationId: message.conversationId || undefined,
		isSubagent: message.isSubagent === true,
		prompt: message.prompt || undefined,
		metadata: fromProtoStruct(message.metadata),
		transcriptPath: message.transcriptPath ?? "",
		hookPath: message.hookPath ?? "",
		messagesPath: message.messagesPath || undefined,
		updatedAt: message.updatedAt ?? "",
	};
}

function parseJsonArray(raw: string | undefined): string[] | undefined {
	const value = raw?.trim();
	if (!value) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!Array.isArray(parsed)) {
			return undefined;
		}
		const out = parsed
			.map((item) => (typeof item === "string" ? item.trim() : ""))
			.filter((item) => item.length > 0);
		return out.length > 0 ? out : undefined;
	} catch {
		return undefined;
	}
}

function fromSchedule(message: Schedule__Output): RpcScheduleRecord {
	return {
		scheduleId: message.scheduleId ?? "",
		name: message.name ?? "",
		cronPattern: message.cronPattern ?? "",
		prompt: message.prompt ?? "",
		provider: message.provider ?? "",
		model: message.model ?? "",
		mode: message.mode === "plan" ? "plan" : "act",
		workspaceRoot: message.workspaceRoot?.trim() || undefined,
		cwd: message.cwd?.trim() || undefined,
		systemPrompt: message.systemPrompt?.trim() || undefined,
		maxIterations: message.hasMaxIterations ? message.maxIterations : undefined,
		timeoutSeconds: message.hasTimeoutSeconds
			? message.timeoutSeconds
			: undefined,
		maxParallel:
			typeof message.maxParallel === "number" && message.maxParallel > 0
				? message.maxParallel
				: 1,
		enabled: message.enabled === true,
		createdAt: message.createdAt ?? "",
		updatedAt: message.updatedAt ?? "",
		lastRunAt: message.lastRunAt?.trim() || undefined,
		nextRunAt: message.nextRunAt?.trim() || undefined,
		createdBy: message.createdBy?.trim() || undefined,
		tags: parseJsonArray(message.tagsJson ?? undefined),
		metadata: fromProtoStruct(message.metadata),
	};
}

function fromScheduleExecution(
	message: ScheduleExecution__Output,
): RpcScheduleExecution {
	return {
		executionId: message.executionId ?? "",
		scheduleId: message.scheduleId ?? "",
		sessionId: message.sessionId?.trim() || undefined,
		triggeredAt: message.triggeredAt ?? "",
		startedAt: message.startedAt?.trim() || undefined,
		endedAt: message.endedAt?.trim() || undefined,
		status:
			message.status === "pending" ||
			message.status === "running" ||
			message.status === "success" ||
			message.status === "failed" ||
			message.status === "timeout" ||
			message.status === "aborted"
				? message.status
				: "failed",
		exitCode: message.hasExitCode ? message.exitCode : undefined,
		errorMessage: message.errorMessage?.trim() || undefined,
		iterations: message.hasIterations ? message.iterations : undefined,
		tokensUsed: message.hasTokensUsed ? message.tokensUsed : undefined,
		costUsd: message.hasCostUsd ? message.costUsd : undefined,
	};
}

export interface RpcSessionClientOptions {
	address: string;
}

export interface RpcStreamEventsInput {
	clientId?: string;
	sessionIds?: string[];
}

export interface RpcStreamEventsHandlers {
	onEvent?: (event: {
		eventId: string;
		sessionId: string;
		taskId?: string;
		eventType: string;
		payload: Record<string, unknown>;
		sourceClientId?: string;
		ts: string;
	}) => void;
	onError?: (error: Error) => void;
	onEnd?: () => void;
}

export interface RpcStreamTeamProgressHandlers {
	onProjection?: (event: TeamProgressProjectionEvent) => void;
	onLifecycle?: (event: TeamProgressLifecycleEvent) => void;
	onError?: (error: Error) => void;
	onEnd?: () => void;
}

export class RpcSessionClient {
	private readonly client: ClineGatewayClient;

	constructor(options: RpcSessionClientOptions) {
		this.client = createGatewayGenericClient(options.address);
	}

	public close(): void {
		this.client.close();
	}

	public async upsertSession(row: RpcSessionRow): Promise<void> {
		await this.unary((callback) => {
			const request: UpsertSessionRequest = { session: toMessage(row) };
			this.client.UpsertSession(request, callback);
		});
	}

	public async getSession(
		sessionId: string,
	): Promise<RpcSessionRow | undefined> {
		const response = await this.unary<GetSessionResponse__Output>(
			(callback) => {
				this.client.GetSession({ sessionId }, callback);
			},
		);
		if (!response.session) {
			return undefined;
		}
		return fromMessage(response.session);
	}

	public async listSessions(input: {
		limit: number;
		parentSessionId?: string;
		status?: string;
	}): Promise<RpcSessionRow[]> {
		const response = await this.unary<ListSessionsResponse__Output>(
			(callback) => {
				this.client.ListSessions(input, callback);
			},
		);
		return (response.sessions ?? []).map((item) => fromMessage(item));
	}

	public async updateSession(
		input: RpcSessionUpdateInput,
	): Promise<{ updated: boolean; statusLock: number }> {
		const request: UpdateSessionRequest = {
			sessionId: input.sessionId,
			status: input.status,
			endedAt: input.endedAt ?? undefined,
			setRunning: input.setRunning,
		};
		if (input.exitCode !== undefined) {
			request.hasExitCode = true;
			request.exitCode = input.exitCode ?? 0;
		}
		if (input.prompt !== undefined) {
			request.hasPrompt = true;
			request.prompt = input.prompt ?? "";
		}
		if (input.metadata !== undefined) {
			request.hasMetadata = true;
			request.metadata = toProtoStruct(input.metadata ?? undefined);
		}
		if (input.parentSessionId !== undefined) {
			request.hasParentSessionId = true;
			request.parentSessionId = input.parentSessionId ?? "";
		}
		if (input.parentAgentId !== undefined) {
			request.hasParentAgentId = true;
			request.parentAgentId = input.parentAgentId ?? "";
		}
		if (input.agentId !== undefined) {
			request.hasAgentId = true;
			request.agentId = input.agentId ?? "";
		}
		if (input.conversationId !== undefined) {
			request.hasConversationId = true;
			request.conversationId = input.conversationId ?? "";
		}
		if (input.expectedStatusLock !== undefined) {
			request.hasExpectedStatusLock = true;
			request.expectedStatusLock = input.expectedStatusLock;
		}
		const response = await this.unary<UpdateSessionResponse__Output>(
			(callback) => {
				this.client.UpdateSession(request, callback);
			},
		);
		return {
			updated: response.updated === true,
			statusLock: Number(response.statusLock ?? 0),
		};
	}

	public async deleteSession(
		sessionId: string,
		cascade = false,
	): Promise<boolean> {
		const response = await this.unary<DeleteSessionResponse__Output>(
			(callback) => {
				this.client.DeleteSession({ sessionId, cascade }, callback);
			},
		);
		return response.deleted === true;
	}

	public async enqueueSpawnRequest(input: {
		rootSessionId: string;
		parentAgentId: string;
		task?: string;
		systemPrompt?: string;
	}): Promise<void> {
		await this.unary<EnqueueSpawnRequestResponse__Output>((callback) => {
			this.client.EnqueueSpawnRequest(input, callback);
		});
	}

	public async claimSpawnRequest(
		rootSessionId: string,
		parentAgentId: string,
	): Promise<string | undefined> {
		const response = await this.unary<ClaimSpawnRequestResponse__Output>(
			(callback) => {
				const request: ClaimSpawnRequestRequest = {
					rootSessionId,
					parentAgentId,
				};
				this.client.ClaimSpawnRequest(request, callback);
			},
		);
		const task = response.item?.task?.trim();
		return task ? task : undefined;
	}

	public async startRuntimeSession(
		request: RpcChatStartSessionRequest,
	): Promise<RpcChatStartSessionResponse> {
		const runtimeRequest = {
			sessionId: request.sessionId ?? "",
			workspaceRoot: request.workspaceRoot,
			cwd: request.cwd ?? "",
			provider: request.provider,
			model: request.model,
			mode: request.mode,
			apiKey: request.apiKey,
			systemPrompt: request.systemPrompt ?? "",
			maxIterations: request.maxIterations ?? 0,
			hasMaxIterations: typeof request.maxIterations === "number",
			enableTools: request.enableTools,
			enableSpawn: request.enableSpawn,
			enableTeams: request.enableTeams,
			autoApproveTools: request.autoApproveTools ?? false,
			hasAutoApproveTools: typeof request.autoApproveTools === "boolean",
			teamName: request.teamName,
			missionStepInterval: request.missionStepInterval,
			missionTimeIntervalMs: request.missionTimeIntervalMs,
			toolPolicies: Object.fromEntries(
				Object.entries(request.toolPolicies ?? {}).map(([name, policy]) => [
					name,
					{
						enabled: policy.enabled !== false,
						autoApprove: policy.autoApprove ?? false,
					},
				]),
			),
			initialMessages: (request.initialMessages ?? []).map((message) => ({
				role: message.role ?? "",
				content: toProtoValue(message.content),
			})),
			logger: request.logger
				? {
						enabled: request.logger.enabled ?? false,
						level: request.logger.level ?? "",
						destination: request.logger.destination ?? "",
						name: request.logger.name ?? "",
						bindings: toProtoStruct(
							request.logger.bindings as Record<string, unknown> | undefined,
						),
					}
				: undefined,
		};
		const response = await this.unary<StartRuntimeSessionResponse__Output>(
			(callback) => {
				this.client.StartRuntimeSession({ request: runtimeRequest }, callback);
			},
		);
		const startResult: RpcChatStartSessionArtifacts | undefined =
			response.startResult
				? {
						sessionId: response.startResult.sessionId ?? "",
						manifestPath: response.startResult.manifestPath ?? "",
						transcriptPath: response.startResult.transcriptPath ?? "",
						hookPath: response.startResult.hookPath ?? "",
						messagesPath: response.startResult.messagesPath ?? "",
					}
				: undefined;
		return {
			sessionId: response.sessionId ?? "",
			startResult,
		};
	}

	public async sendRuntimeSession(
		sessionId: string,
		request: RpcChatRunTurnRequest,
	): Promise<{ result?: RpcChatTurnResult; queued?: boolean }> {
		const runtimeRequest = {
			config: {
				workspaceRoot: request.config.workspaceRoot,
				cwd: request.config.cwd ?? "",
				provider: request.config.provider,
				model: request.config.model,
				mode: request.config.mode,
				apiKey: request.config.apiKey,
				systemPrompt: request.config.systemPrompt ?? "",
				maxIterations: request.config.maxIterations ?? 0,
				hasMaxIterations: typeof request.config.maxIterations === "number",
				enableTools: request.config.enableTools,
				enableSpawn: request.config.enableSpawn,
				enableTeams: request.config.enableTeams,
				autoApproveTools: request.config.autoApproveTools ?? false,
				hasAutoApproveTools:
					typeof request.config.autoApproveTools === "boolean",
				teamName: request.config.teamName,
				missionStepInterval: request.config.missionStepInterval,
				missionTimeIntervalMs: request.config.missionTimeIntervalMs,
				toolPolicies: Object.fromEntries(
					Object.entries(request.config.toolPolicies ?? {}).map(
						([name, policy]) => [
							name,
							{
								enabled: policy.enabled !== false,
								autoApprove: policy.autoApprove ?? false,
							},
						],
					),
				),
				initialMessages: (request.config.initialMessages ?? []).map(
					(message) => ({
						role: message.role ?? "",
						content: toProtoValue(message.content),
					}),
				),
				logger: request.config.logger
					? {
							enabled: request.config.logger.enabled ?? false,
							level: request.config.logger.level ?? "",
							destination: request.config.logger.destination ?? "",
							name: request.config.logger.name ?? "",
							bindings: toProtoStruct(
								request.config.logger.bindings as
									| Record<string, unknown>
									| undefined,
							),
						}
					: undefined,
			},
			messages: (request.messages ?? []).map((message) => ({
				role: message.role ?? "",
				content: toProtoValue(message.content),
			})),
			prompt: request.prompt,
			delivery: request.delivery,
			attachments: request.attachments
				? {
						userImages: request.attachments.userImages ?? [],
						userFiles: (request.attachments.userFiles ?? []).map((file) => ({
							name: file.name,
							content: file.content,
						})),
					}
				: undefined,
		};
		const response = await this.unary<SendRuntimeSessionResponse__Output>(
			(callback) => {
				this.client.SendRuntimeSession(
					{ sessionId, request: runtimeRequest },
					callback,
				);
			},
		);
		if (!response.result) {
			return { queued: true };
		}
		return {
			result: {
				text: response.result.text ?? "",
				usage: {
					inputTokens: Number(response.result.usage?.inputTokens ?? 0),
					outputTokens: Number(response.result.usage?.outputTokens ?? 0),
					cacheReadTokens: response.result.usage?.hasCacheReadTokens
						? Number(response.result.usage?.cacheReadTokens ?? 0)
						: undefined,
					cacheWriteTokens: response.result.usage?.hasCacheWriteTokens
						? Number(response.result.usage?.cacheWriteTokens ?? 0)
						: undefined,
					totalCost: response.result.usage?.hasTotalCost
						? Number(response.result.usage?.totalCost ?? 0)
						: undefined,
				},
				inputTokens: Number(response.result.inputTokens ?? 0),
				outputTokens: Number(response.result.outputTokens ?? 0),
				iterations: Number(response.result.iterations ?? 0),
				finishReason: response.result.finishReason ?? "",
				messages: (response.result.messages ?? []).map((message) => ({
					role: message.role ?? "",
					content: fromProtoValue(message.content),
				})),
				toolCalls: (response.result.toolCalls ?? []).map((call) => ({
					name: call.name ?? "",
					input: call.hasInput ? fromProtoValue(call.input) : undefined,
					output: call.hasOutput ? fromProtoValue(call.output) : undefined,
					error: call.error?.trim() || undefined,
					durationMs: call.hasDurationMs
						? Number(call.durationMs ?? 0)
						: undefined,
				})),
			},
			queued: false,
		};
	}

	public async abortRuntimeSession(
		sessionId: string,
	): Promise<{ applied: boolean }> {
		const response = await this.unary<AbortRuntimeSessionResponse__Output>(
			(callback) => {
				this.client.AbortRuntimeSession({ sessionId }, callback);
			},
		);
		return { applied: response.applied === true };
	}

	public async requestToolApproval(input: {
		approvalId?: string;
		sessionId: string;
		taskId?: string;
		toolCallId: string;
		toolName: string;
		inputJson?: string;
		requesterClientId?: string;
		timeoutMs?: number;
	}): Promise<{
		approvalId: string;
		decided: boolean;
		approved: boolean;
		reason: string;
	}> {
		const request: RequestToolApprovalRequest = {
			approvalId: input.approvalId,
			sessionId: input.sessionId,
			taskId: input.taskId,
			toolCallId: input.toolCallId,
			toolName: input.toolName,
			inputJson: input.inputJson,
			requesterClientId: input.requesterClientId,
			timeoutMs: input.timeoutMs,
		};
		const response = await this.unary<RequestToolApprovalResponse__Output>(
			(callback) => {
				this.client.RequestToolApproval(request, callback);
			},
		);
		return {
			approvalId: response.approvalId ?? "",
			decided: response.decided === true,
			approved: response.approved === true,
			reason: response.reason ?? "",
		};
	}

	public async respondToolApproval(input: {
		approvalId: string;
		approved: boolean;
		reason?: string;
		responderClientId?: string;
	}): Promise<{ approvalId: string; applied: boolean }> {
		const request: RespondToolApprovalRequest = {
			approvalId: input.approvalId,
			approved: input.approved,
			reason: input.reason,
			responderClientId: input.responderClientId,
		};
		const response = await this.unary<RespondToolApprovalResponse__Output>(
			(callback) => {
				this.client.RespondToolApproval(request, callback);
			},
		);
		return {
			approvalId: response.approvalId ?? "",
			applied: response.applied === true,
		};
	}

	public async listPendingApprovals(sessionId?: string): Promise<
		Array<{
			approvalId: string;
			sessionId: string;
			taskId: string;
			toolCallId: string;
			toolName: string;
			inputJson: string;
			requesterClientId: string;
			createdAt: string;
		}>
	> {
		const response = await this.unary<ListPendingApprovalsResponse__Output>(
			(callback) => {
				this.client.ListPendingApprovals({ sessionId }, callback);
			},
		);
		const approvals = response.approvals ?? [];
		return approvals.map((approval) => ({
			approvalId: approval.approvalId ?? "",
			sessionId: approval.sessionId ?? "",
			taskId: approval.taskId ?? "",
			toolCallId: approval.toolCallId ?? "",
			toolName: approval.toolName ?? "",
			inputJson: approval.inputJson ?? "",
			requesterClientId: approval.requesterClientId ?? "",
			createdAt: approval.createdAt ?? "",
		}));
	}

	public async createSchedule(input: {
		name: string;
		cronPattern: string;
		prompt: string;
		provider: string;
		model: string;
		mode?: "act" | "plan";
		workspaceRoot?: string;
		cwd?: string;
		systemPrompt?: string;
		maxIterations?: number;
		timeoutSeconds?: number;
		maxParallel?: number;
		enabled?: boolean;
		createdBy?: string;
		tags?: string[];
		metadata?: Record<string, unknown>;
	}): Promise<RpcScheduleRecord | undefined> {
		const response = await this.unary<CreateScheduleResponse__Output>(
			(callback) => {
				this.client.CreateSchedule(
					{
						name: input.name,
						cronPattern: input.cronPattern,
						prompt: input.prompt,
						provider: input.provider,
						model: input.model,
						mode: input.mode ?? "act",
						workspaceRoot: input.workspaceRoot,
						cwd: input.cwd,
						systemPrompt: input.systemPrompt,
						maxIterations: input.maxIterations ?? 0,
						hasMaxIterations: typeof input.maxIterations === "number",
						timeoutSeconds: input.timeoutSeconds ?? 0,
						hasTimeoutSeconds: typeof input.timeoutSeconds === "number",
						maxParallel: input.maxParallel ?? 1,
						enabled: input.enabled ?? true,
						createdBy: input.createdBy,
						tagsJson: input.tags ? JSON.stringify(input.tags) : "",
						metadata: toProtoStruct(input.metadata),
					},
					callback,
				);
			},
		);
		return response.schedule ? fromSchedule(response.schedule) : undefined;
	}

	public async getSchedule(
		scheduleId: string,
	): Promise<RpcScheduleRecord | undefined> {
		const response = await this.unary<GetScheduleResponse__Output>(
			(callback) => {
				this.client.GetSchedule({ scheduleId }, callback);
			},
		);
		return response.schedule ? fromSchedule(response.schedule) : undefined;
	}

	public async listSchedules(input?: {
		limit?: number;
		enabled?: boolean;
		tags?: string[];
	}): Promise<RpcScheduleRecord[]> {
		const response = await this.unary<ListSchedulesResponse__Output>(
			(callback) => {
				this.client.ListSchedules(
					{
						limit: input?.limit ?? 100,
						hasEnabled: typeof input?.enabled === "boolean",
						enabled: input?.enabled ?? false,
						tagsJson: input?.tags ? JSON.stringify(input.tags) : "",
					},
					callback,
				);
			},
		);
		return (response.schedules ?? []).map((schedule) => fromSchedule(schedule));
	}

	public async updateSchedule(
		scheduleId: string,
		updates: {
			name?: string;
			cronPattern?: string;
			prompt?: string;
			provider?: string;
			model?: string;
			mode?: "act" | "plan";
			workspaceRoot?: string;
			cwd?: string;
			systemPrompt?: string;
			maxIterations?: number | null;
			timeoutSeconds?: number | null;
			maxParallel?: number;
			enabled?: boolean;
			createdBy?: string | null;
			tags?: string[];
			metadata?: Record<string, unknown>;
		},
	): Promise<RpcScheduleRecord | undefined> {
		const request: UpdateScheduleRequest = {
			scheduleId,
		};
		if (updates.name !== undefined) {
			request.hasName = true;
			request.name = updates.name;
		}
		if (updates.cronPattern !== undefined) {
			request.hasCronPattern = true;
			request.cronPattern = updates.cronPattern;
		}
		if (updates.prompt !== undefined) {
			request.hasPrompt = true;
			request.prompt = updates.prompt;
		}
		if (updates.provider !== undefined) {
			request.hasProvider = true;
			request.provider = updates.provider;
		}
		if (updates.model !== undefined) {
			request.hasModel = true;
			request.model = updates.model;
		}
		if (updates.mode !== undefined) {
			request.hasMode = true;
			request.mode = updates.mode;
		}
		if (updates.workspaceRoot !== undefined) {
			request.hasWorkspaceRoot = true;
			request.workspaceRoot = updates.workspaceRoot;
		}
		if (updates.cwd !== undefined) {
			request.hasCwd = true;
			request.cwd = updates.cwd;
		}
		if (updates.systemPrompt !== undefined) {
			request.hasSystemPrompt = true;
			request.systemPrompt = updates.systemPrompt;
		}
		if (updates.maxIterations === null) {
			request.clearMaxIterations = true;
		} else if (updates.maxIterations !== undefined) {
			request.hasMaxIterations = true;
			request.maxIterations = updates.maxIterations;
		}
		if (updates.timeoutSeconds === null) {
			request.clearTimeoutSeconds = true;
		} else if (updates.timeoutSeconds !== undefined) {
			request.hasTimeoutSeconds = true;
			request.timeoutSeconds = updates.timeoutSeconds;
		}
		if (updates.maxParallel !== undefined) {
			request.hasMaxParallel = true;
			request.maxParallel = updates.maxParallel;
		}
		if (updates.enabled !== undefined) {
			request.hasEnabled = true;
			request.enabled = updates.enabled;
		}
		if (updates.createdBy === null) {
			request.clearCreatedBy = true;
		} else if (updates.createdBy !== undefined) {
			request.hasCreatedBy = true;
			request.createdBy = updates.createdBy;
		}
		if (updates.tags !== undefined) {
			request.hasTagsJson = true;
			request.tagsJson = JSON.stringify(updates.tags);
		}
		if (updates.metadata !== undefined) {
			request.hasMetadata = true;
			request.metadata = toProtoStruct(updates.metadata);
		}

		const response = await this.unary<UpdateScheduleResponse__Output>(
			(callback) => {
				this.client.UpdateSchedule(request, callback);
			},
		);
		return response.schedule ? fromSchedule(response.schedule) : undefined;
	}

	public async deleteSchedule(scheduleId: string): Promise<boolean> {
		const response = await this.unary<DeleteScheduleResponse__Output>(
			(callback) => {
				this.client.DeleteSchedule({ scheduleId }, callback);
			},
		);
		return response.deleted === true;
	}

	public async pauseSchedule(
		scheduleId: string,
	): Promise<RpcScheduleRecord | undefined> {
		const response = await this.unary<PauseScheduleResponse__Output>(
			(callback) => {
				this.client.PauseSchedule({ scheduleId }, callback);
			},
		);
		return response.schedule ? fromSchedule(response.schedule) : undefined;
	}

	public async resumeSchedule(
		scheduleId: string,
	): Promise<RpcScheduleRecord | undefined> {
		const response = await this.unary<ResumeScheduleResponse__Output>(
			(callback) => {
				this.client.ResumeSchedule({ scheduleId }, callback);
			},
		);
		return response.schedule ? fromSchedule(response.schedule) : undefined;
	}

	public async triggerScheduleNow(
		scheduleId: string,
	): Promise<RpcScheduleExecution | undefined> {
		const response = await this.unary<TriggerScheduleNowResponse__Output>(
			(callback) => {
				this.client.TriggerScheduleNow({ scheduleId }, callback);
			},
		);
		return response.execution
			? fromScheduleExecution(response.execution)
			: undefined;
	}

	public async listScheduleExecutions(input: {
		scheduleId?: string;
		status?: string;
		limit?: number;
	}): Promise<RpcScheduleExecution[]> {
		const response = await this.unary<ListScheduleExecutionsResponse__Output>(
			(callback) => {
				this.client.ListScheduleExecutions(
					{
						scheduleId: input.scheduleId,
						status: input.status,
						limit: input.limit ?? 50,
					},
					callback,
				);
			},
		);
		return (response.executions ?? []).map((item) =>
			fromScheduleExecution(item),
		);
	}

	public async getScheduleStats(scheduleId: string): Promise<{
		totalRuns: number;
		successRate: number;
		avgDurationSeconds: number;
		lastFailure?: RpcScheduleExecution;
	}> {
		const response = await this.unary<GetScheduleStatsResponse__Output>(
			(callback) => {
				this.client.GetScheduleStats({ scheduleId }, callback);
			},
		);
		return {
			totalRuns: Number(response.totalRuns ?? 0),
			successRate: Number(response.successRate ?? 0),
			avgDurationSeconds: Number(response.avgDurationSeconds ?? 0),
			lastFailure: response.lastFailure
				? fromScheduleExecution(response.lastFailure)
				: undefined,
		};
	}

	public async getActiveScheduledExecutions(): Promise<
		Array<{
			executionId: string;
			scheduleId: string;
			sessionId: string;
			startedAt: string;
			timeoutAt?: string;
		}>
	> {
		const response =
			await this.unary<GetActiveScheduledExecutionsResponse__Output>(
				(callback) => {
					this.client.GetActiveScheduledExecutions({}, callback);
				},
			);
		return (response.executions ?? []).map((item) => ({
			executionId: item.executionId ?? "",
			scheduleId: item.scheduleId ?? "",
			sessionId: item.sessionId ?? "",
			startedAt: item.startedAt ?? "",
			timeoutAt: item.timeoutAt?.trim() || undefined,
		}));
	}

	public async getUpcomingScheduledRuns(
		limit = 20,
	): Promise<Array<{ scheduleId: string; name: string; nextRunAt: string }>> {
		const response = await this.unary<GetUpcomingScheduledRunsResponse__Output>(
			(callback) => {
				this.client.GetUpcomingScheduledRuns({ limit }, callback);
			},
		);
		return (response.runs ?? []).map((item: UpcomingScheduledRun__Output) => ({
			scheduleId: item.scheduleId ?? "",
			name: item.name ?? "",
			nextRunAt: item.nextRunAt ?? "",
		}));
	}

	public async stopRuntimeSession(
		sessionId: string,
	): Promise<{ applied: boolean }> {
		const response = await this.unary<StopRuntimeSessionResponse__Output>(
			(callback) => {
				this.client.StopRuntimeSession({ sessionId }, callback);
			},
		);
		return { applied: response.applied === true };
	}

	public async runProviderAction(
		request: RpcProviderActionRequest,
	): Promise<{ result: unknown }> {
		const rpcRequest =
			request.action === "listProviders"
				? { listProviders: {} }
				: request.action === "getProviderModels"
					? { getProviderModels: { providerId: request.providerId } }
					: request.action === "addProvider"
						? {
								addProvider: {
									providerId: request.providerId,
									name: request.name,
									baseUrl: request.baseUrl,
									apiKey: request.apiKey ?? "",
									headers: request.headers ?? {},
									timeoutMs: request.timeoutMs ?? 0,
									hasTimeoutMs: typeof request.timeoutMs === "number",
									models: request.models ?? [],
									defaultModelId: request.defaultModelId ?? "",
									modelsSourceUrl: request.modelsSourceUrl ?? "",
									capabilities: request.capabilities ?? [],
								},
							}
						: request.action === "saveProviderSettings"
							? {
									saveProviderSettings: {
										providerId: request.providerId,
										enabled: request.enabled ?? false,
										hasEnabled: typeof request.enabled === "boolean",
										apiKey: request.apiKey ?? "",
										hasApiKey: request.apiKey !== undefined,
										baseUrl: request.baseUrl ?? "",
										hasBaseUrl: request.baseUrl !== undefined,
									},
								}
							: {
									clineAccount: {
										operation: request.operation,
										userId: "userId" in request ? (request.userId ?? "") : "",
										organizationId:
											"organizationId" in request
												? (request.organizationId ?? "")
												: "",
										memberId:
											"memberId" in request ? (request.memberId ?? "") : "",
										clearOrganizationId:
											"organizationId" in request &&
											request.organizationId === null,
									},
								};
		const response = await this.unary<RunProviderActionResponse__Output>(
			(callback) => {
				this.client.RunProviderAction({ request: rpcRequest }, callback);
			},
		);
		return { result: fromProtoValue(response.result) };
	}

	public async runProviderOAuthLogin(
		provider: string,
	): Promise<{ provider: string; accessToken: string }> {
		const response = await this.unary<RunProviderOAuthLoginResponse__Output>(
			(callback) => {
				this.client.RunProviderOAuthLogin({ provider }, callback);
			},
		);
		return {
			provider: response.provider ?? "",
			accessToken: response.apiKey ?? "",
		};
	}

	public async publishEvent(input: {
		eventId?: string;
		sessionId: string;
		taskId?: string;
		eventType: string;
		payload: Record<string, unknown>;
		sourceClientId?: string;
	}): Promise<{ eventId: string; accepted: boolean }> {
		const response = await this.unary<PublishEventResponse__Output>(
			(callback) => {
				this.client.PublishEvent(
					{
						eventId: input.eventId,
						sessionId: input.sessionId,
						taskId: input.taskId,
						eventType: input.eventType,
						payload: toProtoStruct(input.payload),
						sourceClientId: input.sourceClientId,
					},
					callback,
				);
			},
		);
		return {
			eventId: response.eventId ?? "",
			accepted: response.accepted === true,
		};
	}

	public streamEvents(
		input: RpcStreamEventsInput,
		handlers: RpcStreamEventsHandlers = {},
	): () => void {
		let closing = false;
		const stream = this.client.StreamEvents({
			clientId: input.clientId ?? "",
			sessionIds: input.sessionIds ?? [],
		});
		const onData = (event: RoutedEvent__Output) => {
			handlers.onEvent?.({
				eventId: event.eventId ?? "",
				sessionId: event.sessionId ?? "",
				taskId: event.taskId?.trim() ? event.taskId : undefined,
				eventType: event.eventType ?? "",
				payload: fromProtoStruct(event.payload) ?? {},
				sourceClientId: event.sourceClientId?.trim()
					? event.sourceClientId
					: undefined,
				ts: event.ts ?? "",
			});
		};
		const onError = (error: Error) => {
			const grpcCode =
				typeof (error as { code?: unknown }).code === "number"
					? Number((error as { code?: unknown }).code)
					: undefined;
			const isCancelled = grpcCode === 1 || error.message.includes("CANCELLED");
			if (closing && isCancelled) {
				return;
			}
			handlers.onError?.(error);
		};
		const onEnd = () => {
			handlers.onEnd?.();
		};
		stream.on("data", onData);
		stream.on("error", onError);
		stream.on("end", onEnd);
		return () => {
			closing = true;
			stream.cancel();
		};
	}

	public streamTeamProgress(
		input: RpcStreamEventsInput,
		handlers: RpcStreamTeamProgressHandlers = {},
	): () => void {
		return this.streamEvents(input, {
			onEvent: (event) => {
				if (event.eventType === RPC_TEAM_PROGRESS_EVENT_TYPE) {
					try {
						const parsed =
							event.payload as unknown as TeamProgressProjectionEvent;
						if (
							parsed.type === "team_progress_projection" &&
							parsed.version === 1
						) {
							handlers.onProjection?.(parsed);
						}
					} catch {
						// Ignore malformed payloads; event stream remains best effort.
					}
					return;
				}
				if (event.eventType === RPC_TEAM_LIFECYCLE_EVENT_TYPE) {
					try {
						handlers.onLifecycle?.(
							event.payload as unknown as TeamProgressLifecycleEvent,
						);
					} catch {
						// Ignore malformed payloads; event stream remains best effort.
					}
				}
			},
			onError: handlers.onError,
			onEnd: handlers.onEnd,
		});
	}

	private async unary<TResponse = unknown>(
		invoke: (
			callback: (
				error: grpc.ServiceError | null,
				response: TResponse | undefined,
			) => void,
		) => void,
	): Promise<TResponse> {
		return await new Promise<TResponse>((resolve, reject) => {
			invoke((error, response) => {
				if (error) {
					reject(error);
					return;
				}
				resolve((response ?? ({} as TResponse)) as TResponse);
			});
		});
	}
}
