import type { ToolApprovalRequest, ToolApprovalResult } from "@clinebot/shared";

export type JsonRecord = Record<string, unknown>;

export type ChatTurnAttachments = {
	userImages?: string[];
	userFiles?: Array<{ name: string; content: string }>;
};

export type ChatSessionCommandRequest = {
	action:
		| "start"
		| "send"
		| "stop"
		| "abort"
		| "reset"
		| "restore_checkpoint"
		| "pending_prompts"
		| "steer_prompt";
	sessionId?: string;
	prompt?: string;
	promptId?: string;
	checkpointRunCount?: number;
	delivery?: "queue" | "steer";
	config?: JsonRecord;
	attachments?: ChatTurnAttachments;
};

export type PromptInQueue = {
	id: string;
	prompt: string;
	steer: boolean;
	attachmentCount?: number;
};

export type LiveSession = {
	config: JsonRecord;
	messages: unknown[];
	promptsInQueue: PromptInQueue[];
	busy: boolean;
	startedAt: number;
	endedAt?: number;
	status: string;
	prompt?: string;
	title?: string;
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

export type PendingToolApproval = {
	request: ToolApprovalRequest;
	resolve: (result: ToolApprovalResult) => void;
	item: ToolApprovalRequestItem;
};

export type SidecarContext = {
	liveSessions: Map<string, LiveSession>;
	wsClients: Set<any>;
	pendingApprovals: Map<string, PendingToolApproval>;
	sessionManager: import("@clinebot/core").DefaultSessionManager | null;
	workspaceRoot: string;
	unsubscribeSessionEvents: (() => void) | null;
};

export const BunRuntime = (globalThis as { Bun?: any }).Bun;

export const SIDECAR_PORT = Number(process.env.CLINE_SIDECAR_PORT) || 3126;
export const SIDECAR_MODE = "sidecar";
