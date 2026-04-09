export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue | undefined };

export type AgentToolDefinition = {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
};

export type AgentMessagePart =
	| {
			type: "text";
			text: string;
	  }
	| {
			type: "reasoning";
			text: string;
			metadata?: Record<string, unknown>;
	  }
	| {
			type: "image";
			image: string | Uint8Array | ArrayBuffer | URL;
			mediaType?: string;
	  }
	| {
			type: "tool-call";
			toolCallId: string;
			toolName: string;
			input?: unknown;
			metadata?: Record<string, unknown>;
	  }
	| {
			type: "tool-result";
			toolCallId: string;
			toolName: string;
			output: unknown;
			isError?: boolean;
	  };

export interface AgentMessage {
	id?: string;
	role: "user" | "assistant" | "tool";
	content: AgentMessagePart[];
	createdAt?: number;
	metadata?: Record<string, unknown>;
}

export interface AgentModelRequest {
	systemPrompt?: string;
	messages: readonly AgentMessage[];
	tools?: readonly AgentToolDefinition[];
	signal?: AbortSignal;
	options?: {
		temperature?: number;
		maxTokens?: number;
		metadata?: Record<string, unknown>;
		reasoning?: {
			enabled?: boolean;
			effort?: "low" | "medium" | "high" | "xhigh";
			budgetTokens?: number;
		};
	};
}

export type AgentModelFinishReason =
	| "stop"
	| "tool-calls"
	| "max-tokens"
	| "error";

export interface AgentModelUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	totalCost?: number;
}

export type AgentModelEvent =
	| {
			type: "text-delta";
			text: string;
	  }
	| {
			type: "reasoning-delta";
			text: string;
			metadata?: Record<string, unknown>;
	  }
	| {
			type: "tool-call-delta";
			toolCallId?: string;
			toolName?: string;
			input?: unknown;
			inputText?: string;
			metadata?: Record<string, unknown>;
	  }
	| {
			type: "usage";
			usage: AgentModelUsage;
	  }
	| {
			type: "finish";
			reason: AgentModelFinishReason;
			error?: string;
	  };

export interface AgentModel {
	stream(request: AgentModelRequest): Promise<AsyncIterable<AgentModelEvent>>;
}

export type GatewayModelCapability =
	| "text"
	| "tools"
	| "reasoning"
	| "images"
	| "audio"
	| "structured-output";

export interface GatewayModelDefinition {
	id: string;
	name: string;
	providerId: string;
	description?: string;
	contextWindow?: number;
	maxOutputTokens?: number;
	capabilities?: readonly GatewayModelCapability[];
	metadata?: Record<string, JsonValue | undefined>;
}

export interface GatewayProviderManifest {
	id: string;
	name: string;
	description?: string;
	defaultModelId: string;
	models: readonly GatewayModelDefinition[];
	env?: readonly ("browser" | "node")[];
	api?: string;
	apiKeyEnv?: readonly string[];
	docsUrl?: string;
	metadata?: Record<string, JsonValue | undefined>;
}

export interface GatewayProviderSettings {
	apiKey?: string;
	apiKeyResolver?: () => string | undefined | Promise<string | undefined>;
	apiKeyEnv?: readonly string[];
	baseUrl?: string;
	headers?: Record<string, string>;
	timeoutMs?: number;
	fetch?: typeof fetch;
	options?: Record<string, unknown>;
}

export interface GatewayResolvedProviderConfig extends GatewayProviderSettings {
	providerId: string;
}

export interface GatewayProviderConfig extends GatewayProviderSettings {
	providerId: string;
	enabled?: boolean;
	defaultModelId?: string;
	models?: readonly Omit<GatewayModelDefinition, "providerId">[];
}

export interface GatewayModelSelection {
	providerId: string;
	modelId?: string;
}

export interface GatewayResolvedModel {
	provider: GatewayProviderManifest;
	model: GatewayModelDefinition;
}

export interface GatewayProviderContext {
	provider: GatewayProviderManifest;
	model: GatewayModelDefinition;
	config: GatewayResolvedProviderConfig;
	signal?: AbortSignal;
}

export interface GatewayStreamRequest {
	providerId: string;
	modelId: string;
	systemPrompt?: string;
	messages: readonly AgentMessage[];
	tools?: readonly AgentToolDefinition[];
	temperature?: number;
	maxTokens?: number;
	metadata?: Record<string, unknown>;
	reasoning?: {
		enabled?: boolean;
		effort?: "low" | "medium" | "high";
		budgetTokens?: number;
	};
	signal?: AbortSignal;
}

export interface GatewayProvider {
	stream(
		request: GatewayStreamRequest,
		context: GatewayProviderContext,
	): AsyncIterable<AgentModelEvent> | Promise<AsyncIterable<AgentModelEvent>>;
}

export type GatewayProviderFactory = (
	config: GatewayResolvedProviderConfig,
) => GatewayProvider | Promise<GatewayProvider>;

export interface GatewayProviderRegistration {
	manifest: GatewayProviderManifest;
	defaults?: GatewayProviderSettings;
	createProvider?: GatewayProviderFactory;
	loadProvider?: () => Promise<
		Pick<GatewayProviderRegistration, "createProvider">
	>;
}

export interface GatewayModelHandleOptions {
	tools?: readonly AgentToolDefinition[];
	temperature?: number;
	maxTokens?: number;
	metadata?: Record<string, unknown>;
	reasoning?: {
		enabled?: boolean;
		effort?: "low" | "medium" | "high";
		budgetTokens?: number;
	};
	signal?: AbortSignal;
}

export interface GatewayConfig {
	builtins?: false | readonly string[];
	providers?: readonly GatewayProviderRegistration[];
	providerConfigs?: readonly GatewayProviderConfig[];
	fetch?: typeof fetch;
}
