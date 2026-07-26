import type {
	AgentMessage,
	AgentModelEvent,
	AgentToolDefinition,
} from "../agent";
import type { BasicLogger } from "../logging/logger";

export type ProviderCapability =
	| "reasoning"
	| "prompt-cache"
	| "tools"
	| "provider-tools"
	| "temperature"
	| "files"
	| "streaming"
	| "vision"
	| "computer-use";

export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue | undefined };

// AgentToolDefinition, AgentMessagePart, AgentMessage, AgentModelRequest,
// AgentModelFinishReason, AgentModelEvent, AgentModel, and AgentModelUsage
// previously lived here with gateway-local shapes. They have been retired in
// favor of the canonical AgentRuntime types in `../agent` (PLAN.md §3.6 Step 3,
// expanded). `AgentModelUsage` is superseded by `AgentUsage` (`AgentTokenUsage`
// + optional `totalCost`); usage deltas on `AgentModelEvent` are now
// `Partial<AgentUsage>`.

export type GatewayModelCapability =
	| "text"
	| "tools"
	| "reasoning"
	| "prompt-cache"
	| "images"
	| "audio"
	| "structured-output";

export type GatewayPromptCacheStrategy = "anthropic-automatic";
export const USAGE_COST_DISPLAYS = ["show", "hide"] as const;
export type GatewayUsageCostDisplay = (typeof USAGE_COST_DISPLAYS)[number];
export type GatewayPromptCacheFormat = "anthropic-cache-control";
export type GatewayReasoningFormat =
	| "anthropic-thinking"
	| "glm-thinking"
	| "minimax-thinking";
export type GatewayModelRoute =
	| { matcher: "anthropic-compatible" }
	| {
			matcher: "model-family";
			family: string;
			requiredCapability?: GatewayModelCapability;
	  }
	| {
			matcher: "model-id";
			modelId: string;
			requiredCapability?: GatewayModelCapability;
	  };
export interface GatewayProviderRouting {
	promptCache?: {
		format: GatewayPromptCacheFormat;
		routes: GatewayModelRoute[];
	};
	reasoning?: {
		format: GatewayReasoningFormat;
		routes: GatewayModelRoute[];
	};
}

export type GatewayStickySessionTransport = "json-body" | "header";

export interface GatewayStickySessionMetadata {
	/**
	 * Where the provider expects the sticky-session identifier on the wire.
	 * `field` is a JSON body property for `json-body`, and an HTTP header name
	 * for `header`.
	 */
	transport: GatewayStickySessionTransport;
	field: string;
	metadataKey: string;
}

export interface GatewayProviderMetadata {
	promptCacheStrategy?: GatewayPromptCacheStrategy;
	usageCostDisplay?: GatewayUsageCostDisplay;
	routing?: GatewayProviderRouting;
	stickySession?: GatewayStickySessionMetadata;
	[key: string]:
		| JsonValue
		| GatewayProviderRouting
		| GatewayStickySessionMetadata
		| undefined;
}

export interface GatewayModelDefinition {
	id: string;
	name: string;
	providerId: string;
	description?: string;
	contextWindow?: number;
	maxInputTokens?: number;
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
	capabilities?: readonly ProviderCapability[];
	env?: readonly ("browser" | "node")[];
	docsUrl?: string;
	metadata?: GatewayProviderMetadata;
}

export interface GatewayProviderSettings {
	timeoutMs?: number;
	options?: Record<string, unknown>;
	metadata?: GatewayProviderMetadata;
}

export interface GatewayResolvedProviderConfig extends GatewayProviderSettings {
	providerId: string;
}

export interface GatewayModelSelection {
	providerId: string;
	modelId?: string;
}

export interface GatewayProviderContext {
	provider: GatewayProviderManifest;
	model: GatewayModelDefinition;
	config: GatewayResolvedProviderConfig;
	signal?: AbortSignal;
	logger?: BasicLogger;
}

export interface GatewayStreamRequest {
	providerId: string;
	modelId: string;
	systemPrompt?: string;
	messages: readonly AgentMessage[];
	tools?: readonly AgentToolDefinition[];
	temperature?: number;
	maxTokens?: number;
	/**
	 * Set by the gateway when `maxTokens` was synthesized from gateway/model
	 * defaults rather than derived from an explicit caller cap. Providers can
	 * use this to avoid forwarding synthesized caps to backends that reject
	 * them, while still honoring explicit caps from any caller — including
	 * ones that reach the provider without going through the gateway.
	 */
	defaultedMaxTokens?: boolean;
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
