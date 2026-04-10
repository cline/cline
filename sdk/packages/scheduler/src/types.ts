import type {
	BasicLogger,
	RpcChatRunTurnRequest,
	RpcChatStartSessionRequest,
	RpcChatTurnResult,
} from "@clinebot/shared";

export type ScheduleMode = "act" | "plan";

export interface ScheduleAutonomousOptions {
	enabled?: boolean;
	idleTimeoutSeconds?: number;
	pollIntervalSeconds?: number;
}

export type ScheduleExecutionStatus =
	| "pending"
	| "running"
	| "success"
	| "failed"
	| "timeout"
	| "aborted";

export interface ScheduleRecord {
	scheduleId: string;
	name: string;
	cronPattern: string;
	prompt: string;
	provider: string;
	model: string;
	mode: ScheduleMode;
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

export interface CreateScheduleInput {
	name: string;
	cronPattern: string;
	prompt: string;
	provider: string;
	model: string;
	mode?: ScheduleMode;
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
}

export interface UpdateScheduleInput {
	name?: string;
	cronPattern?: string;
	prompt?: string;
	provider?: string;
	model?: string;
	mode?: ScheduleMode;
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
}

export interface ListSchedulesOptions {
	enabled?: boolean;
	limit?: number;
	tags?: string[];
}

export interface ScheduleExecutionRecord {
	executionId: string;
	scheduleId: string;
	sessionId?: string;
	triggeredAt: string;
	startedAt?: string;
	endedAt?: string;
	status: ScheduleExecutionStatus;
	exitCode?: number;
	errorMessage?: string;
	iterations?: number;
	tokensUsed?: number;
	costUsd?: number;
}

export interface ListScheduleExecutionsOptions {
	scheduleId?: string;
	status?: ScheduleExecutionStatus;
	limit?: number;
}

export interface ScheduleExecutionStats {
	totalRuns: number;
	successRate: number;
	avgDurationSeconds: number;
	lastFailure?: ScheduleExecutionRecord;
}

export interface SchedulerRuntimeStartResult {
	sessionId: string;
	startResult?: import("@clinebot/shared").RpcChatStartSessionArtifacts;
}

export interface SchedulerRuntimeSendResult {
	result: RpcChatTurnResult;
}

export interface SchedulerRuntimeHandlers {
	startSession(
		request: RpcChatStartSessionRequest,
	): Promise<SchedulerRuntimeStartResult>;
	sendSession(
		sessionId: string,
		request: RpcChatRunTurnRequest,
	): Promise<SchedulerRuntimeSendResult>;
	abortSession(sessionId: string): Promise<{ applied: boolean }>;
	stopSession(sessionId: string): Promise<{ applied: boolean }>;
}

export type SchedulerEventPublisher = (
	eventType: string,
	payload: unknown,
) => void;

export interface SchedulerServiceOptions {
	runtimeHandlers: SchedulerRuntimeHandlers;
	eventPublisher?: SchedulerEventPublisher;
	/** Optional structured logs for scheduler lifecycle and tick failures. */
	logger?: BasicLogger;
	sessionsDbPath?: string;
	pollIntervalMs?: number;
	globalMaxConcurrency?: number;
	claimLeaseSeconds?: number;
}

export interface ActiveScheduledExecution {
	executionId: string;
	scheduleId: string;
	sessionId: string;
	startedAt: string;
	timeoutAt?: string;
}

export interface UpcomingScheduledRun {
	scheduleId: string;
	name: string;
	nextRunAt: string;
}
