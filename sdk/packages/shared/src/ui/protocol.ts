import type { GeneratedMedia } from "../llms/media";
import type { ProviderListItem, ProviderModel } from "../rpc/runtime";

/**
 * Canonical, transport-neutral UI protocol.
 *
 * These contracts describe the conversation between a Cline UI surface
 * (browser webview, terminal UI, desktop shell, ...) and the host that owns
 * the runtime (extension host, hub server, CLI process, sidecar, ...).
 *
 * - `UiInboundMessage` travels from the UI to the host.
 * - `UiOutboundMessage` travels from the host to the UI.
 * - `UiConnection` is the minimal duplex surface a host adapter exposes.
 *
 * The protocol deliberately carries plain, serializable data only. Hosts own
 * transport (postMessage, WebSocket, in-process callbacks), session
 * lifecycle, persistence, approvals policy, and provider configuration.
 * Host-specific messages extend these unions locally in the host package;
 * the common agent-interaction lifecycle lives here so UIs can be reused
 * across hosts without incompatible protocol copies.
 */

export type UiReasonLevel = "none" | "low" | "medium" | "high";

export type UiPromptDelivery = "queue" | "steer";

export interface UiUsage {
	inputTokens?: number;
	outputTokens?: number;
	cacheCreationInputTokens?: number;
	cacheReadInputTokens?: number;
	totalCost?: number;
}

export type UiModelInfo = Pick<
	ProviderModel,
	| "id"
	| "name"
	| "operation"
	| "supportsReasoning"
	| "inputModalities"
	| "outputModalities"
> & {
	supportsThinking?: boolean;
};

export type UiProviderInfo = Pick<
	ProviderListItem,
	"defaultModelId" | "enabled" | "id" | "name"
>;

export interface UiToolEvent {
	toolCallId?: string;
	toolName?: string;
	status: "running" | "completed" | "failed";
	input?: unknown;
	output?: unknown;
	error?: string;
}

export interface UiChatToolCall {
	id: string;
	toolCallId?: string;
	name: string;
	text: string;
	state: "input-available" | "output-available" | "output-error";
	input?: unknown;
	output?: unknown;
	error?: string;
}

export interface UiCheckpointInfo {
	ref: string;
	createdAt: number;
	runCount: number;
	kind?: "stash" | "commit";
}

export type UiChatMessageBlock =
	| { id: string; type: "text"; text: string }
	| { id: string; type: "reasoning"; text: string; redacted?: boolean }
	| { id: string; type: "media"; media: GeneratedMedia }
	| { id: string; type: "tool"; toolEvent: UiChatToolCall };

export interface UiChatMessage {
	id: string;
	role: "user" | "assistant" | "error" | "meta";
	text: string;
	reasoning?: string;
	reasoningRedacted?: boolean;
	checkpoint?: UiCheckpointInfo;
	toolEvents?: UiChatToolCall[];
	blocks?: UiChatMessageBlock[];
}

export interface UiSessionConfig {
	provider?: string;
	model?: string;
	mode?: "act" | "plan";
	systemPrompt?: string;
	maxIterations?: number;
	reasonLevel?: UiReasonLevel;
	thinking?: boolean;
	enableTools?: boolean;
	enableSpawn?: boolean;
	enableTeams?: boolean;
	autoApproveTools?: boolean;
}

export interface UiChatAttachments {
	userImages?: string[];
}

export interface UiToolApprovalRequest {
	approvalId: string;
	sessionId: string;
	agentId: string;
	conversationId: string;
	iteration: number;
	toolCallId: string;
	toolName: string;
	input: unknown;
	policy?: Record<string, unknown>;
}

export interface UiDefaults {
	provider?: string;
	model?: string;
	workspaceRoot: string;
	cwd: string;
}

export interface UiSessionSummary {
	sessionId: string;
	title?: string;
	status?: string;
	source?: string;
	providerId?: string;
	model?: string;
	workspaceRoot?: string;
	createdAt?: number;
	updatedAt?: number;
	inputTokens?: number;
	outputTokens?: number;
	totalCost?: number;
}

export interface UiPendingPrompt {
	id: string;
	prompt: string;
	delivery: UiPromptDelivery;
	attachmentCount: number;
	userImages?: string[];
	userFiles?: string[];
}

export interface UiPendingPromptsState {
	sessionId: string;
	prompts: UiPendingPrompt[];
}

export interface UiPendingPromptSubmitted extends UiPendingPrompt {
	sessionId: string;
}

/** Messages sent by a UI surface to its host. */
export type UiInboundMessage =
	| { type: "ready" }
	| {
			type: "send";
			prompt: string;
			config?: UiSessionConfig;
			attachments?: UiChatAttachments;
			delivery?: UiPromptDelivery;
	  }
	| { type: "abort" }
	| { type: "reset" }
	| {
			type: "approval_response";
			approvalId: string;
			approved: boolean;
			reason?: string;
	  }
	| { type: "loadModels"; providerId: string }
	| { type: "attachSession"; sessionId: string }
	| { type: "deleteSession"; sessionId: string }
	| {
			type: "updateSessionMetadata";
			sessionId: string;
			metadata: Record<string, unknown>;
	  }
	| { type: "restore"; checkpointRunCount: number }
	| { type: "forkSession" }
	| {
			type: "update_pending_prompt";
			promptId: string;
			prompt?: string;
			delivery?: UiPromptDelivery;
	  };

/** Messages sent by a host to its UI surface. */
export type UiOutboundMessage =
	| { type: "status"; text: string }
	/**
	 * `recoverable: true` marks an in-run notice (e.g. a MistakeTracker
	 * mistake such as a plan-mode guard-blocked command) — the run continues,
	 * so peers should not treat it as the turn's outcome. Absent/false means
	 * a genuine failure.
	 */
	| { type: "error"; text: string; recoverable?: boolean }
	| { type: "session_started"; sessionId: string }
	| {
			type: "session_hydrated";
			sessionId: string;
			status?: string;
			providerId?: string;
			modelId?: string;
			messages: UiChatMessage[];
	  }
	| { type: "session_ended"; sessionId: string; reason?: string }
	| { type: "assistant_delta"; text: string }
	| { type: "reasoning_delta"; text: string; redacted?: boolean }
	| { type: "assistant_media"; media: GeneratedMedia }
	| { type: "tool_event"; text: string; event?: UiToolEvent }
	| ({ type: "approval_request" } & UiToolApprovalRequest)
	| {
			type: "approval_resolved";
			approvalId: string;
			approved: boolean;
			reason?: string;
	  }
	| {
			type: "turn_done";
			finishReason: string;
			iterations: number;
			usage?: UiUsage;
	  }
	| { type: "providers"; providers: UiProviderInfo[] }
	| { type: "models"; providerId: string; models: UiModelInfo[] }
	| { type: "sessions"; sessions: UiSessionSummary[] }
	| { type: "defaults"; defaults: UiDefaults }
	| { type: "reset_done" }
	| { type: "fork_done"; forkedFromSessionId: string; newSessionId: string }
	| { type: "fork_error"; text: string }
	| ({ type: "pending_prompts" } & UiPendingPromptsState)
	| ({ type: "pending_prompt_submitted" } & UiPendingPromptSubmitted);

/**
 * Minimal duplex connection between a UI surface and its host. Hosts adapt
 * their transport (postMessage, WebSocket, in-process emitter) to this
 * shape; UIs stay transport-agnostic.
 */
export interface UiConnection {
	send(message: UiInboundMessage): void | Promise<void>;
	subscribe(listener: (message: UiOutboundMessage) => void): () => void;
}
