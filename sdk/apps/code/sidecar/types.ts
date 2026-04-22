import type { ClineCore, NodeHubClient } from "@clinebot/core";

export type JsonRecord = Record<string, unknown>;

export type ChatTurnAttachments = {
	userImages?: string[];
	userFiles?: Array<{ name: string; content: string }>;
};

export type ChatSessionCommandRequest = {
	action:
		| "start"
		| "attach"
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
	attachedViaHub?: boolean;
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
	approvalId: string;
	item: ToolApprovalRequestItem;
};

export type SidecarContext = {
	liveSessions: Map<string, LiveSession>;
	streamIndices: Map<string, number>;
	wsClients: Set<any>;
	pendingApprovals: Map<string, PendingToolApproval>;
	sessionManager: ClineCore | null;
	hubClient: NodeHubClient | null;
	workspaceRoot: string;
	unsubscribeSessionEvents: (() => void) | null;
};

export const BunRuntime = (globalThis as { Bun?: any }).Bun;

export const SIDECAR_PORT = Number(process.env.CLINE_SIDECAR_PORT) || 3126;
export const SIDECAR_MODE = "sidecar";
