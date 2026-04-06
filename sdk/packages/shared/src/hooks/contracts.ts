export type HookStage =
	| "input"
	| "runtime_event"
	| "session_start"
	| "run_start"
	| "iteration_start"
	| "turn_start"
	| "before_agent_start"
	| "tool_call_before"
	| "tool_call_after"
	| "turn_end"
	| "stop_error"
	| "iteration_end"
	| "run_end"
	| "session_shutdown"
	| "error";

export type HookMode = "blocking" | "async";
export type HookFailureMode = "fail_open" | "fail_closed";

export interface HookControl {
	cancel?: boolean;
	review?: boolean;
	context?: string;
	overrideInput?: unknown;
	systemPrompt?: string;
	appendMessages?: unknown[];
}

export interface HookStagePolicy {
	mode: HookMode;
	timeoutMs: number;
	retries: number;
	retryDelayMs: number;
	failureMode: HookFailureMode;
	maxConcurrency: number;
	queueLimit: number;
}

export type HookStagePolicyInput = Partial<HookStagePolicy>;

export interface HookPolicies {
	defaultPolicy?: HookStagePolicyInput;
	stages?: Partial<Record<HookStage, HookStagePolicyInput>>;
	handlers?: Record<string, HookStagePolicyInput>;
}

export interface HookEventEnvelope<TPayload = unknown> {
	eventId: string;
	stage: HookStage;
	createdAt: Date;
	sequence: number;
	runId: string;
	agentId: string;
	conversationId: string;
	parentAgentId: string | null;
	iteration?: number;
	parentEventId?: string;
	payload: TPayload;
}

export type HookAttemptStatus = "ok" | "timeout" | "error" | "skipped";

export interface HookHandlerResult {
	handlerName: string;
	stage: HookStage;
	status: HookAttemptStatus;
	attempts: number;
	durationMs: number;
	error?: Error;
	control?: HookControl;
}

export interface HookDispatchResult {
	event: HookEventEnvelope;
	queued: boolean;
	dropped: boolean;
	control?: HookControl;
	results: HookHandlerResult[];
}
