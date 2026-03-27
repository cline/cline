/**
 * @clinebot/providers
 *
 * SDK-like package for creating and managing LLM provider handlers.
 *
 * This package provides a unified interface for interacting with various LLM providers.
 * It standardizes configuration, message formats, and streaming responses.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { createHandler, type ProviderConfig } from "@clinebot/providers"
 *
 * const config: ProviderConfig = {
 *   providerId: "anthropic",
 *   apiKey: process.env.ANTHROPIC_API_KEY,
 *   modelId: "claude-sonnet-4-20250514",
 * }
 *
 * const handler = createHandler(config)
 * const stream = handler.createMessage("You are a helpful assistant.", messages)
 *
 * for await (const chunk of stream) {
 *   if (chunk.type === "text") {
 *     process.stdout.write(chunk.text)
 *   }
 * }
 * ```
 *
 * ## Supported Providers
 *
 * - **anthropic**: Anthropic's Claude models
 * - **claude-code**: Claude Code local subscription provider
 * - **gemini**: Google's Gemini models (including Vertex AI)
 * - **openai**: OpenAI's GPT models
 * - **openai-compat**: Any OpenAI-compatible API (DeepSeek, xAI, Together, etc.)
 *
 * @module
 */

// =============================================================================
// Types
// =============================================================================

export {
	ApiFormat,
	// Handler types
	type ApiHandler,
	// Stream types
	type ApiStream,
	type ApiStreamChunk,
	type ApiStreamReasoningChunk,
	type ApiStreamTextChunk,
	type ApiStreamToolCall,
	type ApiStreamToolCallsChunk,
	type ApiStreamUsageChunk,
	type AuthConfig,
	type AuthSettings,
	AuthSettingsSchema,
	type AwsConfig,
	type AwsSettings,
	AwsSettingsSchema,
	type AzureConfig,
	type AzureSettings,
	AzureSettingsSchema,
	type BuiltInProviderId,
	type CloudConfig,
	type ContentBlock,
	createConfig,
	createProviderConfig,
	type EndpointConfig,
	type FileContent,
	type GcpConfig,
	type GcpSettings,
	GcpSettingsSchema,
	getModelPricing,
	type HandlerFactory,
	type HandlerModelInfo,
	hasCapability,
	hasModelCapability,
	type ImageContent,
	type LazyHandlerFactory,
	// Message types
	type Message,
	type MessageRole,
	type MessageWithMetadata,
	type ModelCapability,
	type ModelCatalogConfig,
	type ModelCatalogSettings,
	ModelCatalogSettingsSchema,
	type ModelConfig,
	// Model types
	type ModelInfo,
	type ModelPricing,
	type ModelWithId,
	type OcaConfig,
	type OcaSettings,
	OcaSettingsSchema,
	type OpenAICompatibleModelInfo,
	type ProviderCapability,
	type ProviderCategory,
	type ProviderConfig,
	type ProviderDefaultsConfig,
	// Config types
	type ProviderId,
	// Settings types and functions (Zod-based validation)
	ProviderIdSchema,
	type ProviderOptions,
	type ProviderSettings,
	ProviderSettingsSchema,
	type ProviderSpecificConfig,
	parseSettings,
	type ReasoningConfig,
	type ReasoningSettings,
	ReasoningSettingsSchema,
	type RedactedThinkingContent,
	type RegionConfig,
	type SapConfig,
	type SapSettings,
	SapSettingsSchema,
	type SimpleProviderConfig,
	type SingleCompletionHandler,
	safeCreateProviderConfig,
	safeParseSettings,
	supportsPromptCache,
	supportsReasoning,
	type TextContent,
	type ThinkingConfig,
	type ThinkingContent,
	type TokenConfig,
	type ToolDefinition,
	type ToolResultContent,
	type ToolUseContent,
	toProviderConfig,
} from "./types";

// =============================================================================
// Handlers
// =============================================================================

export {
	// Provider-specific handlers
	AnthropicHandler,
	AskSageHandler,
	// Base classes (for extension)
	BaseHandler,
	ClaudeCodeHandler,
	CodexHandler,
	clearLiveModelsCatalogCache,
	clearPrivateModelsCatalogCache,
	// Custom handler registry
	clearRegistry,
	createAnthropicHandler,
	createAskSageHandler,
	createClaudeCodeHandler,
	createCodexHandler,
	createDifyHandler,
	createGeminiHandler,
	createMistralHandler,
	createOpenAIHandler,
	createOpenAIResponsesHandler,
	createOpenCodeHandler,
	createR1Handler,
	createSapAiCoreHandler,
	createVertexHandler,
	DEFAULT_MODELS_CATALOG_URL,
	DifyHandler,
	GeminiHandler,
	getLiveModelsCatalog,
	getMissingApiKeyError,
	getProviderConfig,
	getRegisteredHandler,
	getRegisteredHandlerAsync,
	getRegisteredProviderIds,
	hasRegisteredHandler,
	isOpenAICompatibleProvider,
	isRegisteredHandlerAsync,
	MistralHandler,
	normalizeProviderId,
	// Provider configs
	OPENAI_COMPATIBLE_PROVIDERS,
	// OpenAI Chat Completions API handler
	OpenAIBaseHandler,
	// OpenAI Responses API handler
	OpenAIResponsesHandler,
	OpenCodeHandler,
	// R1-based handlers (DeepSeek Reasoner, etc.)
	R1BaseHandler,
	registerAsyncHandler,
	registerHandler,
	resolveProviderConfig,
	SapAiCoreHandler,
	unregisterHandler,
	// Vertex AI handler
	VertexHandler,
} from "./handlers";

// =============================================================================
// Transform utilities
// =============================================================================

export {
	convertToAnthropicMessages,
	convertToGeminiMessages,
	convertToOpenAIMessages,
	convertToolsToAnthropic,
	convertToolsToGemini,
	convertToolsToOpenAI,
	// R1 format (DeepSeek Reasoner, etc.)
	convertToR1Messages,
	getOpenAIToolParams,
	type R1Message,
} from "./transform";

// =============================================================================
// Utilities
// =============================================================================

export {
	type AssistantContentBlock,
	type AssistantRedactedThinkingBlock,
	type AssistantTextBlock,
	type AssistantThinkingBlock,
	type AssistantToolUseBlock,
	calculateRetryDelay,
	isRetriableError,
	type ProcessedResponse,
	type ReasoningDetailParam,
	RetriableError,
	type RetryOptions,
	retryAsync,
	retryStream,
	// Stream processor
	StreamResponseProcessor,
	sleep,
	ToolCallProcessor,
	type UsageInfo,
} from "./utils";

import { CLINE_PROVIDER } from "../models";
import {
	DEFAULT_EXTERNAL_OCA_BASE_URL,
	DEFAULT_INTERNAL_OCA_BASE_URL,
} from "../models/providers/oca";
// =============================================================================
// Main Factory Function
// =============================================================================

import { AnthropicHandler } from "./handlers/anthropic-base";
import { AskSageHandler } from "./handlers/asksage";
import { BedrockHandler } from "./handlers/bedrock-base";
import {
	ClaudeCodeHandler,
	CodexHandler,
	DifyHandler,
	MistralHandler,
	OpenCodeHandler,
	SapAiCoreHandler,
} from "./handlers/community-sdk";
import { GeminiHandler } from "./handlers/gemini-base";
import { OpenAIBaseHandler } from "./handlers/openai-base";
import { OpenAIResponsesHandler } from "./handlers/openai-responses";
import {
	isOpenAICompatibleProvider,
	OPENAI_COMPATIBLE_PROVIDERS,
	type ProviderDefaults,
	resolveProviderConfig,
} from "./handlers/providers";
import {
	getRegisteredHandler,
	getRegisteredHandlerAsync,
	hasRegisteredHandler,
	isRegisteredHandlerAsync,
} from "./handlers/registry";
import { VertexHandler } from "./handlers/vertex";
import {
	ApiFormat,
	type ApiHandler,
	BUILT_IN_PROVIDER,
	normalizeProviderId,
	type ProviderConfig,
	type ProviderId,
	resolveRoutingProviderId,
} from "./types";

function withNormalizedProviderId(config: ProviderConfig): ProviderConfig {
	const normalizedProviderId = normalizeProviderId(config.providerId);
	if (normalizedProviderId === config.providerId) {
		return config;
	}
	return {
		...config,
		providerId: normalizedProviderId,
	};
}

function resolveOcaBaseUrl(
	config: ProviderConfig,
	providerDefaults?: { baseUrl: string },
): string {
	if (config.baseUrl) {
		return config.baseUrl;
	}
	if (config.oca?.mode === "internal") {
		return DEFAULT_INTERNAL_OCA_BASE_URL;
	}
	return providerDefaults?.baseUrl ?? DEFAULT_EXTERNAL_OCA_BASE_URL;
}

function resolveOcaApiFormat(config: ProviderConfig): string | undefined {
	const modelId = config.modelId;
	return (
		config.modelInfo?.apiFormat ??
		(modelId ? config.knownModels?.[modelId]?.apiFormat : undefined)
	);
}

function createOcaHandler(config: ProviderConfig): ApiHandler {
	const apiFormat = resolveOcaApiFormat(config);
	if (apiFormat === ApiFormat.OPENAI_RESPONSES) {
		return new OpenAIResponsesHandler(config);
	}
	return new OpenAIBaseHandler(config);
}

function mergeProviderDefaults(
	config: ProviderConfig,
	defaults: ProviderDefaults,
): ProviderConfig {
	return {
		...config,
		baseUrl:
			resolveRoutingProviderId(config) === BUILT_IN_PROVIDER.OCA
				? resolveOcaBaseUrl(config, defaults)
				: (config.baseUrl ?? defaults.baseUrl),
		modelId: config.modelId ?? defaults.modelId,
		knownModels: config.knownModels ?? defaults.knownModels,
		capabilities: config.capabilities ?? defaults.capabilities,
	};
}

type HandlerFactory = (config: ProviderConfig) => ApiHandler;

const BUILT_IN_HANDLER_FACTORIES: Record<string, HandlerFactory> = {
	[BUILT_IN_PROVIDER.ASKSAGE]: (config) => new AskSageHandler(config),
	[BUILT_IN_PROVIDER.ANTHROPIC]: (config) => new AnthropicHandler(config),
	[BUILT_IN_PROVIDER.BEDROCK]: (config) => new BedrockHandler(config),
	[BUILT_IN_PROVIDER.CLAUDE_CODE]: (config) => new ClaudeCodeHandler(config),
	[BUILT_IN_PROVIDER.GEMINI]: (config) => new GeminiHandler(config),
	[BUILT_IN_PROVIDER.VERTEX]: (config) => new VertexHandler(config),
	[BUILT_IN_PROVIDER.OPENCODE]: (config) => new OpenCodeHandler(config),
	[BUILT_IN_PROVIDER.OPENAI_NATIVE]: (config) =>
		new OpenAIResponsesHandler(config),
	[BUILT_IN_PROVIDER.MISTRAL]: (config) => new MistralHandler(config),
	[BUILT_IN_PROVIDER.DIFY]: (config) => new DifyHandler(config),
};

function createOpenAICompatibleHandler(config: ProviderConfig): ApiHandler {
	const routingProviderId = resolveRoutingProviderId(config);
	if (routingProviderId === BUILT_IN_PROVIDER.OPENAI_CODEX) {
		return new CodexHandler(config);
	}
	if (routingProviderId === BUILT_IN_PROVIDER.SAPAICORE) {
		return new SapAiCoreHandler(config);
	}
	if (routingProviderId === BUILT_IN_PROVIDER.OCA) {
		return createOcaHandler(config);
	}
	return new OpenAIBaseHandler(config);
}

function createBuiltInHandler(config: ProviderConfig): ApiHandler | undefined {
	const factory = BUILT_IN_HANDLER_FACTORIES[resolveRoutingProviderId(config)];
	return factory ? factory(config) : undefined;
}

/**
 * Create an API handler for the specified provider
 *
 * This is the main entry point for creating handlers. It automatically
 * selects the appropriate handler class based on the provider ID.
 *
 * Custom handlers registered via `registerHandler()` take precedence over
 * built-in handlers.
 *
 * @param config - Provider configuration
 * @returns An API handler instance
 * @throws Error if the provider has an async handler - use `createHandlerAsync()` instead
 *
 * @example
 * ```typescript
 * const handler = createHandler({
 *   providerId: "anthropic",
 *   apiKey: "sk-...",
 *   modelId: "claude-sonnet-4-20250514",
 * })
 * ```
 */
export function createHandler(config: ProviderConfig): ApiHandler {
	const normalizedConfig = withNormalizedProviderId(config);
	const { providerId } = normalizedConfig;
	const routingProviderId = resolveRoutingProviderId(normalizedConfig);

	// Check custom registry first (allows overriding built-in handlers)
	if (hasRegisteredHandler(providerId)) {
		if (isRegisteredHandlerAsync(providerId)) {
			throw new Error(
				`Handler for "${providerId}" is registered as async. Use createHandlerAsync() instead.`,
			);
		}
		const handler = getRegisteredHandler(providerId, normalizedConfig);
		if (handler) {
			return handler;
		}
	}

	const builtInHandler = createBuiltInHandler({
		...normalizedConfig,
		routingProviderId,
	});
	if (builtInHandler) {
		return builtInHandler;
	}

	// Check if it's an OpenAI-compatible provider
	if (isOpenAICompatibleProvider(routingProviderId)) {
		if (
			normalizedConfig.modelCatalog?.loadLatestOnInit ||
			normalizedConfig.modelCatalog?.loadPrivateOnAuth
		) {
			throw new Error(
				`Provider "${providerId}" has runtime model refresh enabled. Use createHandlerAsync() to allow async model refresh.`,
			);
		}
		const providerDefaults = OPENAI_COMPATIBLE_PROVIDERS[routingProviderId];
		return createOpenAICompatibleHandler(
			mergeProviderDefaults(
				{ ...normalizedConfig, routingProviderId },
				providerDefaults,
			),
		);
	}

	// Fall back to OpenAI-compatible with custom base URL
	return normalizedConfig.baseUrl
		? new OpenAIBaseHandler({ ...normalizedConfig, routingProviderId })
		: new OpenAIResponsesHandler({
				...normalizedConfig,
				routingProviderId,
				baseUrl: "https://api.openai.com/v1",
			});
}

/**
 * Create an API handler asynchronously
 *
 * Use this when you have handlers registered with `registerAsyncHandler()`.
 * This function works with both sync and async registered handlers.
 *
 * @param config - Provider configuration
 * @returns Promise resolving to an API handler instance
 *
 * @example
 * ```typescript
 * // Register an async handler for lazy loading
 * registerAsyncHandler("my-provider", async (config) => {
 *   const { MyHandler } = await import("./my-handler")
 *   return new MyHandler(config)
 * })
 *
 * // Use createHandlerAsync to get the handler
 * const handler = await createHandlerAsync({
 *   providerId: "my-provider",
 *   modelId: "my-model",
 * })
 * ```
 */
export async function createHandlerAsync(
	config: ProviderConfig,
): Promise<ApiHandler> {
	const normalizedConfig = withNormalizedProviderId(config);
	const { providerId } = normalizedConfig;
	const routingProviderId = resolveRoutingProviderId(normalizedConfig);

	// Check custom registry first (allows overriding built-in handlers)
	if (hasRegisteredHandler(providerId)) {
		const handler = await getRegisteredHandlerAsync(
			providerId,
			normalizedConfig,
		);
		if (handler) {
			return handler;
		}
	}

	if (isOpenAICompatibleProvider(routingProviderId)) {
		const providerDefaults = await resolveProviderConfig(
			routingProviderId,
			normalizedConfig.modelCatalog,
			{ ...normalizedConfig, routingProviderId },
		);
		if (providerDefaults) {
			return createOpenAICompatibleHandler(
				mergeProviderDefaults(
					{ ...normalizedConfig, routingProviderId },
					providerDefaults,
				),
			);
		}
	}

	// Fall back to sync handler creation for built-in providers
	return createHandler(normalizedConfig);
}

/**
 * List of all built-in provider IDs
 */
export const BUILT_IN_PROVIDERS: ProviderId[] = [
	...new Set<ProviderId>([
		CLINE_PROVIDER.provider.id,
		BUILT_IN_PROVIDER.ANTHROPIC,
		BUILT_IN_PROVIDER.ASKSAGE,
		BUILT_IN_PROVIDER.BEDROCK,
		BUILT_IN_PROVIDER.CLAUDE_CODE,
		BUILT_IN_PROVIDER.OPENCODE,
		BUILT_IN_PROVIDER.MISTRAL,
		BUILT_IN_PROVIDER.DIFY,
		BUILT_IN_PROVIDER.OPENAI_NATIVE,
		BUILT_IN_PROVIDER.GEMINI,
		BUILT_IN_PROVIDER.VERTEX,
		...(Object.keys(OPENAI_COMPATIBLE_PROVIDERS) as ProviderId[]),
	]),
];

const BUILT_IN_PROVIDER_SET = new Set<string>(BUILT_IN_PROVIDERS);

/**
 * Check if a provider ID is supported (built-in or registered)
 */
export function isProviderSupported(providerId: string): boolean {
	const normalizedProviderId = normalizeProviderId(providerId);
	return (
		BUILT_IN_PROVIDER_SET.has(normalizedProviderId) ||
		hasRegisteredHandler(normalizedProviderId) ||
		hasRegisteredHandler(providerId)
	);
}
