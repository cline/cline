import type {
	BasicLogger,
	RpcChatRunTurnRequest,
	RpcChatStartSessionRequest,
	RpcChatTurnResult,
	RpcProviderActionRequest,
} from "@clinebot/shared";

export interface RpcServerOptions {
	address?: string;
	sessionBackend: RpcSessionBackend;
	runtimeHandlers?: RpcRuntimeHandlers;
	scheduler?: {
		enabled?: boolean;
		sessionsDbPath?: string;
		pollIntervalMs?: number;
		globalMaxConcurrency?: number;
		logger?: BasicLogger;
	};
}

export interface RpcServerHandle {
	serverId: string;
	address: string;
	port: number;
	startedAt: string;
	stop: () => Promise<void>;
}

export interface RpcClientRegistrationInput {
	clientId?: string;
	clientType?: string;
	metadata?: Record<string, string>;
}

export interface RpcClientRegistrationResult {
	clientId: string;
	registered: boolean;
}

export interface RpcRuntimeHandlers {
	startSession?: (request: RpcChatStartSessionRequest) => Promise<{
		sessionId: string;
		startResult?: import("@clinebot/shared").RpcChatStartSessionArtifacts;
	}>;
	sendSession?: (
		sessionId: string,
		request: RpcChatRunTurnRequest,
	) => Promise<{ result?: RpcChatTurnResult; queued?: boolean }>;
	stopSession?: (sessionId: string) => Promise<{ applied: boolean }>;
	abortSession?: (sessionId: string) => Promise<{ applied: boolean }>;
	runProviderAction?: (
		request: RpcProviderActionRequest,
	) => Promise<{ result: unknown }>;
	runProviderOAuthLogin?: (provider: string) => Promise<{
		provider: string;
		accessToken: string;
	}>;
	enterpriseAuthenticate?: (
		request: import("@clinebot/shared").RpcEnterpriseAuthenticateRequest,
	) => Promise<import("@clinebot/shared").RpcEnterpriseAuthenticateResponse>;
	enterpriseSync?: (
		request: import("@clinebot/shared").RpcEnterpriseSyncRequest,
	) => Promise<import("@clinebot/shared").RpcEnterpriseSyncResponse>;
	enterpriseGetStatus?: (
		request: import("@clinebot/shared").RpcEnterpriseStatusRequest,
	) => Promise<import("@clinebot/shared").RpcEnterpriseStatusResponse>;
	dispose?: () => Promise<void>;
}

export interface RoutedEvent {
	eventId: string;
	sessionId: string;
	taskId?: string;
	eventType: string;
	payload: Record<string, unknown>;
	sourceClientId?: string;
	ts: string;
}

export interface PendingApproval {
	approvalId: string;
	sessionId: string;
	taskId?: string;
	toolCallId: string;
	toolName: string;
	inputJson: string;
	requesterClientId?: string;
	createdAt: string;
}

export type RpcSessionStatus = "running" | "completed" | "failed" | "cancelled";

export interface RpcSessionRow {
	sessionId: string;
	source: string;
	pid: number;
	startedAt: string;
	endedAt?: string | null;
	exitCode?: number | null;
	status: RpcSessionStatus;
	statusLock: number;
	interactive: boolean;
	provider: string;
	model: string;
	cwd: string;
	workspaceRoot: string;
	teamName?: string;
	enableTools: boolean;
	enableSpawn: boolean;
	enableTeams: boolean;
	parentSessionId?: string;
	parentAgentId?: string;
	agentId?: string;
	conversationId?: string;
	isSubagent: boolean;
	prompt?: string;
	metadata?: Record<string, unknown>;
	transcriptPath: string;
	hookPath: string;
	messagesPath?: string;
	updatedAt: string;
}

export interface RpcSpawnQueueItem {
	id: number;
	rootSessionId: string;
	parentAgentId: string;
	task?: string;
	systemPrompt?: string;
	createdAt: string;
	consumedAt?: string;
}

export type RpcScheduleMode = "act" | "plan" | "yolo";

export type RpcScheduleExecutionStatus =
	| "pending"
	| "running"
	| "success"
	| "failed"
	| "timeout"
	| "aborted";

export interface RpcScheduleRecord {
	scheduleId: string;
	name: string;
	cronPattern: string;
	prompt: string;
	provider: string;
	model: string;
	mode: RpcScheduleMode;
	workspaceRoot?: string;
	cwd?: string;
	systemPrompt?: string;
	maxIterations?: number;
	timeoutSeconds?: number;
	maxParallel: number;
	enabled: boolean;
	createdAt: string;
	updatedAt: string;
	lastRunAt?: string;
	nextRunAt?: string;
	createdBy?: string;
	tags?: string[];
	metadata?: Record<string, unknown>;
}

export interface RpcScheduleExecution {
	executionId: string;
	scheduleId: string;
	sessionId?: string;
	triggeredAt: string;
	startedAt?: string;
	endedAt?: string;
	status: RpcScheduleExecutionStatus;
	exitCode?: number;
	errorMessage?: string;
	iterations?: number;
	tokensUsed?: number;
	costUsd?: number;
}

export interface RpcSessionUpdateInput {
	sessionId: string;
	status?: RpcSessionStatus;
	endedAt?: string | null;
	exitCode?: number | null;
	prompt?: string | null;
	metadata?: Record<string, unknown> | null;
	parentSessionId?: string | null;
	parentAgentId?: string | null;
	agentId?: string | null;
	conversationId?: string | null;
	expectedStatusLock?: number;
	setRunning?: boolean;
}

export interface RpcSessionBackend {
	init(): void;
	upsertSession(row: RpcSessionRow): void;
	getSession(sessionId: string): RpcSessionRow | undefined;
	listSessions(options: {
		limit: number;
		parentSessionId?: string;
		status?: string;
	}): RpcSessionRow[];
	updateSession(input: RpcSessionUpdateInput): {
		updated: boolean;
		statusLock: number;
	};
	deleteSession(sessionId: string): boolean;
	deleteSessionsByParent(parentSessionId: string): void;
	enqueueSpawnRequest(input: {
		rootSessionId: string;
		parentAgentId: string;
		task?: string;
		systemPrompt?: string;
	}): void;
	claimSpawnRequest(
		rootSessionId: string,
		parentAgentId: string,
	): RpcSpawnQueueItem | undefined;
}
