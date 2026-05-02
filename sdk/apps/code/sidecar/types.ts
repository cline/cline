import type {
	AgentToolContext,
	ClineCore,
	NodeHubClient,
	ToolApprovalResult,
} from "@clinebot/core";

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
		| "fork"
		| "reset"
		| "restore_checkpoint"
		| "pending_prompts"
		| "steer_prompt"
		| "update_pending_prompt"
		| "remove_pending_prompt";
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
	item: ToolApprovalRequestItem;
	resolve: (result: ToolApprovalResult) => void;
};

export type AskQuestionRequestItem = {
	requestId: string;
	createdAt: string;
	question: string;
	options: string[];
	context?: Pick<
		AgentToolContext,
		"agentId" | "conversationId" | "iteration" | "metadata"
	>;
};

export type PendingAskQuestion = {
	item: AskQuestionRequestItem;
	resolve: (answer: string) => void;
	reject: (error: Error) => void;
	timeoutId?: ReturnType<typeof setTimeout>;
};

export type SidecarWebSocketClient = {
	send: (message: string) => void;
	close?: () => void;
};

export type SidecarContext = {
	liveSessions: Map<string, LiveSession>;
	streamIndices: Map<string, number>;
	wsClients: Set<SidecarWebSocketClient>;
	pendingApprovals: Map<string, PendingToolApproval>;
	pendingQuestions: Map<string, PendingAskQuestion>;
	sessionManager: ClineCore | null;
	hubClient: NodeHubClient | null;
	workspaceRoot: string;
	unsubscribeSessionEvents: (() => void) | null;
};
export type BunRuntimeApi = {
	serve: (options: unknown) => { port: number; stop?: () => void };
};

export const BunRuntime = (globalThis as { Bun?: BunRuntimeApi }).Bun;

export const SIDECAR_PORT = Number(process.env.CLINE_SIDECAR_PORT) || 3126;
export const SIDECAR_MODE = "sidecar";
