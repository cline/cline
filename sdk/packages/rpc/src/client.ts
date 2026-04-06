import type {
	RpcChatRunTurnRequest,
	RpcChatStartSessionRequest,
	RpcChatStartSessionResponse,
	RpcChatTurnResult,
	RpcEnterpriseAuthenticateRequest,
	RpcEnterpriseAuthenticateResponse,
	RpcEnterpriseStatusRequest,
	RpcEnterpriseStatusResponse,
	RpcEnterpriseSyncRequest,
	RpcEnterpriseSyncResponse,
	RpcProviderActionRequest,
} from "@clinebot/shared";
import { EnterpriseClient } from "./client/enterprise-client";
import { EventsClient } from "./client/events-client";
import { RuntimeSessionClient } from "./client/runtime-session-client";
import { ScheduleClient } from "./client/schedule-client";
import { SessionClient } from "./client/session-client";
import type {
	RpcSessionClientOptions,
	RpcStreamEventsHandlers,
	RpcStreamEventsInput,
	RpcStreamTeamProgressHandlers,
} from "./client/types";
import { createGatewayGenericClient } from "./gateway-client";
import type {
	RpcScheduleExecution,
	RpcScheduleRecord,
	RpcSessionRow,
	RpcSessionUpdateInput,
} from "./types";

export type {
	RpcSessionClientOptions,
	RpcStreamEventsHandlers,
	RpcStreamEventsInput,
	RpcStreamTeamProgressHandlers,
} from "./client/types";

export class RpcSessionClient {
	private readonly _client: ReturnType<typeof createGatewayGenericClient>;
	private readonly session: SessionClient;
	private readonly runtime: RuntimeSessionClient;
	private readonly enterprise: EnterpriseClient;
	private readonly schedule: ScheduleClient;
	private readonly events: EventsClient;

	constructor(options: RpcSessionClientOptions) {
		const client = createGatewayGenericClient(options.address);
		this._client = client;
		this.session = new SessionClient(client);
		this.runtime = new RuntimeSessionClient(client);
		this.enterprise = new EnterpriseClient(client);
		this.schedule = new ScheduleClient(client);
		this.events = new EventsClient(client);
	}

	public close(): void {
		this._client.close();
	}

	// ── Session ──────────────────────────────────────────────────────────────

	public upsertSession(row: RpcSessionRow): Promise<void> {
		return this.session.upsertSession(row);
	}

	public getSession(sessionId: string): Promise<RpcSessionRow | undefined> {
		return this.session.getSession(sessionId);
	}

	public listSessions(input: {
		limit: number;
		parentSessionId?: string;
		status?: string;
	}): Promise<RpcSessionRow[]> {
		return this.session.listSessions(input);
	}

	public updateSession(
		input: RpcSessionUpdateInput,
	): Promise<{ updated: boolean; statusLock: number }> {
		return this.session.updateSession(input);
	}

	public deleteSession(sessionId: string, cascade = false): Promise<boolean> {
		return this.session.deleteSession(sessionId, cascade);
	}

	public enqueueSpawnRequest(input: {
		rootSessionId: string;
		parentAgentId: string;
		task?: string;
		systemPrompt?: string;
	}): Promise<void> {
		return this.session.enqueueSpawnRequest(input);
	}

	public claimSpawnRequest(
		rootSessionId: string,
		parentAgentId: string,
	): Promise<string | undefined> {
		return this.session.claimSpawnRequest(rootSessionId, parentAgentId);
	}

	public requestToolApproval(input: {
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
		return this.session.requestToolApproval(input);
	}

	public respondToolApproval(input: {
		approvalId: string;
		approved: boolean;
		reason?: string;
		responderClientId?: string;
	}): Promise<{ approvalId: string; applied: boolean }> {
		return this.session.respondToolApproval(input);
	}

	public listPendingApprovals(sessionId?: string): Promise<
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
		return this.session.listPendingApprovals(sessionId);
	}

	// ── Runtime ───────────────────────────────────────────────────────────────

	public startRuntimeSession(
		request: RpcChatStartSessionRequest,
	): Promise<RpcChatStartSessionResponse> {
		return this.runtime.startRuntimeSession(request);
	}

	public sendRuntimeSession(
		sessionId: string,
		request: RpcChatRunTurnRequest,
	): Promise<{ result?: RpcChatTurnResult; queued?: boolean }> {
		return this.runtime.sendRuntimeSession(sessionId, request);
	}

	public abortRuntimeSession(sessionId: string): Promise<{ applied: boolean }> {
		return this.runtime.abortRuntimeSession(sessionId);
	}

	public stopRuntimeSession(sessionId: string): Promise<{ applied: boolean }> {
		return this.runtime.stopRuntimeSession(sessionId);
	}

	public runProviderAction(
		request: RpcProviderActionRequest,
	): Promise<{ result: unknown }> {
		return this.runtime.runProviderAction(request);
	}

	public runProviderOAuthLogin(
		provider: string,
	): Promise<{ provider: string; accessToken: string }> {
		return this.runtime.runProviderOAuthLogin(provider);
	}

	// ── Enterprise ────────────────────────────────────────────────────────────

	public enterpriseAuthenticate(
		request: RpcEnterpriseAuthenticateRequest,
	): Promise<RpcEnterpriseAuthenticateResponse> {
		return this.enterprise.authenticate(request);
	}

	public enterpriseSync(
		request: RpcEnterpriseSyncRequest,
	): Promise<RpcEnterpriseSyncResponse> {
		return this.enterprise.sync(request);
	}

	public enterpriseGetStatus(
		request: RpcEnterpriseStatusRequest,
	): Promise<RpcEnterpriseStatusResponse> {
		return this.enterprise.getStatus(request);
	}

	// ── Schedules ─────────────────────────────────────────────────────────────

	public createSchedule(input: {
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
		return this.schedule.createSchedule(input);
	}

	public getSchedule(
		scheduleId: string,
	): Promise<RpcScheduleRecord | undefined> {
		return this.schedule.getSchedule(scheduleId);
	}

	public listSchedules(input?: {
		limit?: number;
		enabled?: boolean;
		tags?: string[];
	}): Promise<RpcScheduleRecord[]> {
		return this.schedule.listSchedules(input);
	}

	public updateSchedule(
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
		return this.schedule.updateSchedule(scheduleId, updates);
	}

	public deleteSchedule(scheduleId: string): Promise<boolean> {
		return this.schedule.deleteSchedule(scheduleId);
	}

	public pauseSchedule(
		scheduleId: string,
	): Promise<RpcScheduleRecord | undefined> {
		return this.schedule.pauseSchedule(scheduleId);
	}

	public resumeSchedule(
		scheduleId: string,
	): Promise<RpcScheduleRecord | undefined> {
		return this.schedule.resumeSchedule(scheduleId);
	}

	public triggerScheduleNow(
		scheduleId: string,
	): Promise<RpcScheduleExecution | undefined> {
		return this.schedule.triggerScheduleNow(scheduleId);
	}

	public listScheduleExecutions(input: {
		scheduleId?: string;
		status?: string;
		limit?: number;
	}): Promise<RpcScheduleExecution[]> {
		return this.schedule.listScheduleExecutions(input);
	}

	public getScheduleStats(scheduleId: string): Promise<{
		totalRuns: number;
		successRate: number;
		avgDurationSeconds: number;
		lastFailure?: RpcScheduleExecution;
	}> {
		return this.schedule.getScheduleStats(scheduleId);
	}

	public getActiveScheduledExecutions(): Promise<
		Array<{
			executionId: string;
			scheduleId: string;
			sessionId: string;
			startedAt: string;
			timeoutAt?: string;
		}>
	> {
		return this.schedule.getActiveScheduledExecutions();
	}

	public getUpcomingScheduledRuns(
		limit?: number,
	): Promise<Array<{ scheduleId: string; name: string; nextRunAt: string }>> {
		return this.schedule.getUpcomingScheduledRuns(limit);
	}

	// ── Events ────────────────────────────────────────────────────────────────

	public publishEvent(input: {
		eventId?: string;
		sessionId: string;
		taskId?: string;
		eventType: string;
		payload: Record<string, unknown>;
		sourceClientId?: string;
	}): Promise<{ eventId: string; accepted: boolean }> {
		return this.events.publishEvent(input);
	}

	public streamEvents(
		input: RpcStreamEventsInput,
		handlers?: RpcStreamEventsHandlers,
	): () => void {
		return this.events.streamEvents(input, handlers);
	}

	public streamTeamProgress(
		input: RpcStreamEventsInput,
		handlers?: RpcStreamTeamProgressHandlers,
	): () => void {
		return this.events.streamTeamProgress(input, handlers);
	}
}
