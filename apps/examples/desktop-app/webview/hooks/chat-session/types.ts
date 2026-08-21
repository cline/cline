import type { SessionHookEvent } from "@/lib/session-diff";

export type ProcessContext = {
	environmentId: string;
	workspaceRoot: string;
	cwd: string;
	homeDir?: string;
	platform?: string;
	appVersion?: string;
	activeEnvironmentId?: string;
	remoteEnvironment?: {
		id: string;
		name?: string;
		host?: string;
		workspaceRoot?: string;
		platform?: string;
		arch?: string;
	} | null;
};

export type AgentChunkEvent = {
	sessionId: string;
	stream: string;
	chunk: string;
	ts: number;
	index?: number;
};

export type ReasoningDeltaEvent = {
	text?: string;
	redacted?: boolean;
};

export type ChatUsageEvent = {
	/** Tokens consumed by the latest model request. */
	inputTokens?: number;
	/** Tokens produced by the latest model request. */
	outputTokens?: number;
	/** Input tokens served from the provider's prompt cache. */
	cacheReadTokens?: number;
	/** Cost of the latest model request. */
	cost?: number;
};

export type ImageDeltaEvent = {
	data?: string;
	mediaType?: string;
};

export type ToolCallStartEvent = {
	toolCallId?: string;
	toolName?: string;
	input?: unknown;
};

export type ToolCallEndEvent = {
	toolCallId?: string;
	toolName?: string;
	input?: unknown;
	output?: unknown;
	error?: string;
	durationMs?: number;
};

export type ToolCallUpdateEvent = {
	toolCallId?: string;
	toolName?: string;
	update?: unknown;
};

export type ToolApprovalRequestItem = {
	requestId: string;
	sessionId: string;
	createdAt: string;
	toolCallId: string;
	toolName: string;
	input?: unknown;
	iteration?: number;
	agentId?: string;
	conversationId?: string;
};

export type AskQuestionRequestItem = {
	requestId: string;
	sessionId: string;
	createdAt: string;
	question: string;
	options: string[];
	context?: {
		agentId?: string;
		conversationId?: string;
		iteration?: number;
		metadata?: Record<string, unknown>;
	};
};

export type ChatApiResult = {
	text: string;
	inputTokens?: number;
	outputTokens?: number;
	cacheReadTokens?: number;
	usage?: {
		inputTokens?: number;
		outputTokens?: number;
		cacheReadTokens?: number;
		totalCost?: number;
	};
	iterations?: number;
	finishReason?:
		| "completed"
		| "max_iterations"
		| "aborted"
		| "mistake_limit"
		| "error";
	toolCalls?: Array<{
		name: string;
		input?: unknown;
		output?: unknown;
		error?: string;
		durationMs?: number;
	}>;
	messages?: unknown[];
};

export type ChatSessionCommandResponse = {
	environmentId?: string;
	sessionId?: string;
	cwd?: string;
	workspaceRoot?: string;
	result?: ChatApiResult;
	ok?: boolean;
	queued?: boolean;
	recoveredAfterDisconnect?: boolean;
	status?: string;
	promptsInQueue?: PromptInQueue[];
	prompt?: PromptInQueue;
	updated?: boolean;
	removed?: boolean;
};

export type ChatPromptCompletion = {
	sessionId: string;
	queued: boolean;
	text?: string;
	result?: ChatApiResult;
};

export type ChatWsResponseEvent = {
	type: "chat_response";
	requestId: string;
	response?: {
		sessionId?: string;
		result?: ChatApiResult;
		ok?: boolean;
		queued?: boolean;
	};
	error?: string;
};

export type ChatWsChunkEvent = {
	type: "chat_event";
	event: AgentChunkEvent;
};

export type ChatTransportState =
	| "connecting"
	| "reconnecting"
	| "connected"
	| "unavailable";

export type CoreLogChunk = {
	level?: string;
	message?: string;
	metadata?: unknown;
};

export type ChatSessionHookEvent = SessionHookEvent & {
	inputTokens?: number;
	outputTokens?: number;
};

export type SerializedAttachmentFile = {
	name: string;
	content: string;
};

export type SerializedAttachments = {
	userImages: string[];
	userFiles: SerializedAttachmentFile[];
};

export type PromptInQueue = {
	id: string;
	prompt: string;
	steer: boolean;
	attachmentCount?: number;
};
