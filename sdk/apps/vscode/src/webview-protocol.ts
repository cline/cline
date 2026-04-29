import type {
	ChatMessage as CoreChatMessage,
	ProviderListItem,
	ProviderModel,
} from "@clinebot/core";

export type WebviewUsage = {
	inputTokens?: number;
	outputTokens?: number;
	cacheCreationInputTokens?: number;
	cacheReadInputTokens?: number;
	totalCost?: number;
};

export type WebviewProviderModel = Pick<
	ProviderModel,
	"id" | "name" | "supportsReasoning"
> & {
	supportsThinking?: boolean;
};

export type WebviewToolEvent = {
	toolCallId?: string;
	toolName?: string;
	status: "running" | "completed" | "failed";
	input?: unknown;
	output?: unknown;
	error?: string;
};

export type WebviewChatMessageBlock =
	| { id: string; type: "text"; text: string }
	| { id: string; type: "reasoning"; text: string; redacted?: boolean }
	| {
			id: string;
			type: "tool";
			toolEvent: NonNullable<WebviewChatMessage["toolEvents"]>[number];
	  };

export type WebviewChatMessage = Omit<
	CoreChatMessage,
	"content" | "createdAt" | "meta" | "role" | "sessionId"
> & {
	role:
		| Extract<CoreChatMessage["role"], "user" | "assistant" | "error">
		| "meta";
	text: string;
	reasoning?: string;
	reasoningRedacted?: boolean;
	checkpoint?: NonNullable<CoreChatMessage["meta"]>["checkpoint"];
	toolEvents?: Array<{
		id: string;
		toolCallId?: string;
		name: string;
		text: string;
		state: "input-available" | "output-available" | "output-error";
		input?: unknown;
		output?: unknown;
		error?: string;
	}>;
	blocks?: WebviewChatMessageBlock[];
};

export type WebviewConfig = {
	provider?: string;
	model?: string;
	mode?: "act" | "plan";
	systemPrompt?: string;
	maxIterations?: number;
	thinking?: boolean;
	enableTools?: boolean;
	enableSpawn?: boolean;
	enableTeams?: boolean;
	autoApproveTools?: boolean;
};

export type WebviewChatAttachments = {
	userImages?: string[];
};

export type WebviewDefaults = {
	provider?: string;
	model?: string;
	workspaceRoot: string;
	cwd: string;
};

export type WebviewSessionSummary = {
	sessionId: string;
	title?: string;
	status?: string;
	workspaceRoot?: string;
	updatedAt?: number;
};

export type WebviewInboundMessage =
	| { type: "ready" }
	| {
			type: "send";
			prompt: string;
			config?: WebviewConfig;
			attachments?: WebviewChatAttachments;
	  }
	| { type: "abort" }
	| { type: "reset" }
	| { type: "loadModels"; providerId: string }
	| { type: "attachSession"; sessionId: string }
	| { type: "deleteSession"; sessionId: string }
	| {
			type: "updateSessionMetadata";
			sessionId: string;
			metadata: Record<string, unknown>;
	  }
	| { type: "restore"; checkpointRunCount: number }
	| { type: "forkSession" };

export type WebviewOutboundMessage =
	| { type: "status"; text: string }
	| { type: "error"; text: string }
	| { type: "session_started"; sessionId: string }
	| {
			type: "session_hydrated";
			sessionId: string;
			status?: string;
			providerId?: string;
			modelId?: string;
			messages: WebviewChatMessage[];
	  }
	| { type: "assistant_delta"; text: string }
	| { type: "reasoning_delta"; text: string; redacted?: boolean }
	| { type: "tool_event"; text: string; event?: WebviewToolEvent }
	| {
			type: "turn_done";
			finishReason: string;
			iterations: number;
			usage?: WebviewUsage;
	  }
	| {
			type: "providers";
			providers: Array<
				Pick<ProviderListItem, "defaultModelId" | "enabled" | "id" | "name">
			>;
	  }
	| { type: "models"; providerId: string; models: WebviewProviderModel[] }
	| { type: "sessions"; sessions: WebviewSessionSummary[] }
	| { type: "defaults"; defaults: WebviewDefaults }
	| { type: "reset_done" }
	| {
			type: "fork_done";
			forkedFromSessionId: string;
			newSessionId: string;
	  }
	| { type: "fork_error"; text: string };
