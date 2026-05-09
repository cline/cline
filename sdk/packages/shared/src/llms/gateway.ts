import type {
	AgentMessage,
	AgentModelEvent,
	AgentToolDefinition,
} from "../agent";
import type { BasicLogger } from "../logging/logger";
import type { ProviderCapability } from "../rpc/runtime";

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
	| "images"
	| "audio"
	| "structured-output";

export type GatewayPromptCacheStrategy = "anthropic-automatic";

export interface GatewayProviderMetadata {
	promptCacheStrategy?: GatewayPromptCacheStrategy;
	[key: string]: JsonValue | undefined;
}

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
	capabilities?: readonly ProviderCapability[];
	env?: readonly ("browser" | "node")[];
	api?: string;
	apiKeyEnv?: readonly string[];
	docsUrl?: string;
	metadata?: GatewayProviderMetadata;
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
	metadata?: GatewayProviderMetadata;
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
	logger?: BasicLogger;
}
