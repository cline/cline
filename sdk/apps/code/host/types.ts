import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { watch } from "node:fs";
import type { RpcChatTurnResult } from "@clinebot/core";
import { CLINE_DEFAULT_RPC_ADDRESS } from "@clinebot/shared";

export type JsonRecord = Record<string, unknown>;

export type ChatTurnAttachments = {
	userImages?: string[];
	userFiles?: Array<{
		name: string;
		content: string;
	}>;
};

export type ChatTurnResult = RpcChatTurnResult & {
	text?: string;
	usage?: {
		inputTokens?: number;
		outputTokens?: number;
		totalCost?: number;
	};
	inputTokens?: number;
	outputTokens?: number;
	totalCost?: number;
	finishReason?: string;
	messages?: unknown[];
	toolCalls?: unknown[];
};

export type ChatSessionCommandRequest = {
	action:
		| "start"
		| "send"
		| "stop"
		| "abort"
		| "reset"
		| "pending_prompts"
		| "steer_prompt";
	sessionId?: string;
	prompt?: string;
	promptId?: string;
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

export type PendingBridgeRequest = {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
};

export type HostContext = {
	liveSessions: Map<string, LiveSession>;
	wsClients: Set<any>;
	pendingBridge: Map<string, PendingBridgeRequest>;
	bridgeChild: ChildProcessWithoutNullStreams | null;
	bridgeReady: boolean;
	bridgeRequestId: number;
	approvalWatcher: ReturnType<typeof watch> | null;
	approvalBroadcastTimer: ReturnType<typeof setTimeout> | null;
	workspaceRoot: string;
	rpcAddress: string;
};

export const BunRuntime = (globalThis as { Bun?: any }).Bun;
export const DEFAULT_RPC_ADDRESS =
	process.env.CLINE_RPC_ADDRESS || CLINE_DEFAULT_RPC_ADDRESS;
export const DEFAULT_RPC_CLIENT_ID = "code-desktop";
export const DEFAULT_RPC_CLIENT_TYPE = "desktop";
export const HOST_MODE = "bun";
