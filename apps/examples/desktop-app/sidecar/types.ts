import type {
	AgentToolContext,
	BasicLogger,
	ClineCore,
	ITelemetryService,
	ManagedHubBuildMismatchEvent,
	NodeHubClient,
	ToolApprovalResult,
} from "@cline/core";
import type { MessageWithMetadata } from "@cline/llms";

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
	forkBeforeRunCount?: number;
	delivery?: "queue" | "steer";
	config?: JsonRecord;
	attachments?: ChatTurnAttachments;
};

export type PromptInQueue = {
	id: string;
	prompt: string;
	steer: boolean;
	attachmentCount?: number;
	userImages?: string[];
};

export type LiveSession = {
	config: JsonRecord;
	messages: MessageWithMetadata[];
	promptsInQueue: PromptInQueue[];
	busy: boolean;
	startedAt: number;
	endedAt?: number;
	status: string;
	transitioningProvider?: boolean;
	prompt?: string;
	title?: string;
	attachedViaHub?: boolean;
	/** Materialized attachment files for prompts still waiting in the queue. */
	queuedAttachmentFiles?: Map<string, string[]>;
	/** Last prompt id announced via chat_queued_prompt_start, to dedupe emits. */
	lastQueuedPromptStartId?: string;
	/** Materialized attachment files whose prompt was submitted; deleted when the turn ends. */
	consumedAttachmentFiles?: Map<string, string[]>;
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
	sessionId: string;
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
	restoringWorkspacePaths: Set<string>;
	streamIndices: Map<string, number>;
	wsClients: Set<SidecarWebSocketClient>;
	pendingApprovals: Map<string, PendingToolApproval>;
	pendingQuestions: Map<string, PendingAskQuestion>;
	sessionManager: ClineCore | null;
	hubClient: NodeHubClient | null;
	workspaceRoot: string;
	logger?: BasicLogger;
	telemetry?: ITelemetryService;
	unsubscribeSessionEvents: (() => void) | null;
	/**
	 * Latest managed Hub build mismatch, broadcast as `hub_build_mismatch` and
	 * replayed to webviews that connect after the event fired.
	 */
	hubBuildMismatch: ManagedHubBuildMismatchEvent | null;
};
export type BunRuntimeApi = {
	serve: (options: unknown) => { port: number; stop?: () => void };
};

export const BunRuntime = (globalThis as { Bun?: BunRuntimeApi }).Bun;

export const SIDECAR_PORT = Number(process.env.CLINE_SIDECAR_PORT) || 3126;
// Loopback-only by default. Set CLINE_SIDECAR_HOST=0.0.0.0 to accept
// connections from outside the local host (e.g. Docker port publishing).
export const SIDECAR_HOST =
	process.env.CLINE_SIDECAR_HOST?.trim() || "127.0.0.1";
export const SIDECAR_MODE = "sidecar";
