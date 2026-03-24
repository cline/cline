import type { SessionHookEvent } from "@/lib/session-diff";

export type ProcessContext = {
	workspaceRoot: string;
	cwd: string;
};

export type AgentChunkEvent = {
	sessionId: string;
	stream: string;
	chunk: string;
	ts: number;
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

export type ChatApiResult = {
	text: string;
	inputTokens?: number;
	outputTokens?: number;
	usage?: {
		inputTokens?: number;
		outputTokens?: number;
		totalCost?: number;
	};
	iterations?: number;
	finishReason?: "completed" | "max_iterations" | "aborted" | "error";
	toolCalls?: Array<{
		name: string;
		input?: unknown;
		output?: unknown;
		error?: string;
		durationMs?: number;
	}>;
	messages?: unknown[];
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

export type ChatTransportState = "connecting" | "reconnecting" | "connected";

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
