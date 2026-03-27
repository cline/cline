/**
 * Provider Configuration Types
 *
 * Unified configuration interface for all providers.
 * This replaces the per-provider config chaos with a single structure.
 */

import type { ModelInfo } from "./model-info";
import {
	BUILT_IN_PROVIDER,
	BUILT_IN_PROVIDER_IDS,
	type BuiltInProviderId,
	isBuiltInProviderId,
	normalizeProviderId,
} from "./provider-ids";

// Re-export for convenience
export {
	BUILT_IN_PROVIDER,
	BUILT_IN_PROVIDER_IDS,
	type BuiltInProviderId,
	isBuiltInProviderId,
	normalizeProviderId,
};

/**
 * All supported provider IDs (built-in + custom)
 *
 * Custom provider IDs can be registered via `registerHandler()` or `registerAsyncHandler()`.
 * Any string is accepted to allow for custom handlers that extend BaseHandler.
 */
export type ProviderId = BuiltInProviderId | (string & {});

/**
 * Provider categories based on underlying SDK/protocol
 */
export type ProviderCategory =
	| "anthropic" // Anthropic SDK
	| "openai" // OpenAI SDK (native features)
	| "openai-compat" // OpenAI-compatible APIs
	| "openai-responses" // OpenAI-Responses APIs
	| "gemini" // Google GenAI SDK
	| "bedrock" // AWS Bedrock SDK
	| "custom"; // Custom implementations

// =============================================================================
// Provider Capabilities
// =============================================================================

/**
 * Capabilities that a provider/model may support
 */
export type ProviderCapability =
	| "reasoning" // Extended thinking/reasoning
	| "prompt-cache" // Prompt caching
	| "streaming" // Streaming responses
	| "tools" // Tool/function calling
	| "vision" // Image inputs
	| "computer-use" // Computer use tools
	| "oauth"; // OAuth authentication flow

// =============================================================================
// Configuration Components
// =============================================================================

/**
 * Authentication configuration
 */
export interface AuthConfig {
	/** API key (most common) */
	apiKey?: string;
	/** OAuth access token */
	accessToken?: string;
	/** Refresh token for OAuth */
	refreshToken?: string;
	/** Account ID (for account-based auth) */
	accountId?: string;
	/** OAuth callback path (e.g., for Qwen Code) */
	oauthPath?: string;
}

/**
 * Endpoint configuration
 */
export interface EndpointConfig {
	/** Base URL for the API */
	baseUrl?: string;
	/** Custom headers to include */
	headers?: Record<string, string>;
	/** Request timeout in milliseconds */
	timeoutMs?: number;
}

/**
 * Model configuration
 */
export interface ModelConfig {
	/** Model identifier */
	modelId: string;
	/** Pre-fetched model info (optional - will use defaults if not provided) */
	modelInfo?: ModelInfo;
	/** Known models for this provider with their info */
	knownModels?: Record<string, ModelInfo>;
}

/**
 * Token limits configuration
 */
export interface TokenConfig {
	/** Maximum context window tokens (overrides model default) */
	maxContextTokens?: number;
	/** Maximum output tokens (overrides model default) */
	maxOutputTokens?: number;
}

/**
 * Reasoning/thinking model configuration
 */
export interface ReasoningConfig {
	/** Reasoning effort level */
	reasoningEffort?: "low" | "medium" | "high" | "xhigh";
	/** Extended thinking budget in tokens */
	thinkingBudgetTokens?: number;
	/** Enable thinking with provider/model defaults when supported */
	thinking?: boolean;
}

/**
 * Region configuration (shared across cloud providers)
 */
export interface RegionConfig {
	/** Cloud region (AWS, GCP, Azure, or provider-specific like Qwen's china/international) */
	region?: string;
	/** API line for region-specific routing (e.g., "china" | "international" for Qwen) */
	apiLine?: "china" | "international";
	/** Use cross-region inference (Bedrock) */
	useCrossRegionInference?: boolean;
	/** Use global inference (Bedrock) */
	useGlobalInference?: boolean;
}

/**
 * AWS-specific configuration (for Bedrock)
 */
export interface AwsConfig {
	accessKey?: string;
	secretKey?: string;
	sessionToken?: string;
	authentication?: "iam" | "api-key" | "profile";
	profile?: string;
	usePromptCache?: boolean;
	endpoint?: string;
	customModelBaseId?: string;
}

/**
 * Google Cloud configuration (for Vertex AI)
 */
export interface GcpConfig {
	projectId?: string;
	region?: string;
}

/**
 * Azure configuration (for Azure OpenAI)
 */
export interface AzureConfig {
	apiVersion?: string;
	useIdentity?: boolean;
}

/**
 * SAP AI Core configuration
 */
export interface SapConfig {
	clientId?: string;
	clientSecret?: string;
	tokenUrl?: string;
	resourceGroup?: string;
	deploymentId?: string;
	useOrchestrationMode?: boolean;
	api?: "orchestration" | "foundation-models";
	defaultSettings?: Record<string, unknown>;
}

/**
 * OCA (Oracle Cloud AI) configuration
 */
export interface OcaConfig {
	mode?: "internal" | "external";
	usePromptCache?: boolean;
}

/**
 * Codex CLI provider options
 */
export interface CodexConfig {
	defaultSettings?: Record<string, unknown>;
	modelSettings?: Record<string, unknown>;
}

/**
 * Claude Code provider options
 */
export interface ClaudeCodeConfig {
	[key: string]: unknown;
}

/**
 * OpenCode provider options
 */
export interface OpenCodeConfig {
	hostname?: string;
	port?: number;
	autoStartServer?: boolean;
	serverTimeout?: number;
	defaultSettings?: Record<string, unknown>;
	modelSettings?: Record<string, unknown>;
}

/**
 * Cloud provider configurations (grouped)
 */
export interface CloudConfig {
	/** AWS/Bedrock options */
	aws?: AwsConfig;
	/** Google Cloud/Vertex options */
	gcp?: GcpConfig;
	/** Azure options */
	azure?: AzureConfig;
	/** SAP AI Core options */
	sap?: SapConfig;
	/** OCA options */
	oca?: OcaConfig;
}

/**
 * Provider-specific options that don't fit other categories
 */
export interface ProviderOptions {
	/** OpenRouter provider sorting preference */
	openRouterProviderSorting?: string;
	/** Runtime model catalog refresh configuration */
	modelCatalog?: ModelCatalogConfig;
}

/**
 * Provider-specific options that don't fit other categories
 */
import type { BasicLogger } from "@clinebot/shared";

/**
 * Runtime model catalog refresh options
 */
export interface ModelCatalogConfig {
	/** Fetch latest catalog at handler initialization */
	loadLatestOnInit?: boolean;
	/** Fetch provider-private models when auth is available */
	loadPrivateOnAuth?: boolean;
	/** Catalog endpoint URL */
	url?: string;
	/** Cache TTL for live catalog in milliseconds */
	cacheTtlMs?: number;
	/** Throw when live catalog refresh fails */
	failOnError?: boolean;
}

// =============================================================================
// Main Configuration Interface
// =============================================================================

/**
 * Unified provider configuration interface
 *
 * This is the single configuration interface that clients provide.
 * All provider-specific options are grouped into logical sub-interfaces.
 */
export interface ProviderConfig
	extends AuthConfig,
		EndpointConfig,
		ModelConfig,
		TokenConfig,
		ReasoningConfig,
		RegionConfig,
		CloudConfig,
		ProviderOptions {
	/** Provider ID - determines which handler to use */
	providerId: ProviderId;

	/**
	 * Optional built-in provider family to use for handler routing.
	 *
	 * This lets clients expose a custom provider ID and model catalog while
	 * reusing the runtime behavior of a built-in provider implementation.
	 */
	routingProviderId?: ProviderId;

	/** Capabilities this provider/model supports */
	capabilities?: ProviderCapability[];

	/** Task/session ID for telemetry */
	taskId?: string;

	/** Retry callback */
	onRetryAttempt?: (
		attempt: number,
		maxRetries: number,
		delay: number,
		error: unknown,
	) => void;

	/** AbortSignal for cancelling requests */
	abortSignal?: AbortSignal;

	/** Optional runtime logger for provider-level diagnostics */
	logger?: BasicLogger;

	/** Codex CLI-specific options */
	codex?: CodexConfig;

	/** Claude Code-specific options */
	claudeCode?: ClaudeCodeConfig;

	/** OpenCode-specific options */
	opencode?: OpenCodeConfig;
}

/**
 * Simplified configuration for common use cases
 */
export interface SimpleProviderConfig {
	providerId: ProviderId;
	apiKey: string;
	modelId: string;
	baseUrl?: string;
}

/**
 * Create a full ProviderConfig from a simple config
 */
export function createConfig(simple: SimpleProviderConfig): ProviderConfig {
	return {
		providerId: simple.providerId,
		apiKey: simple.apiKey,
		modelId: simple.modelId,
		baseUrl: simple.baseUrl,
	};
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if a provider config has a specific capability
 */
export function hasCapability(
	config: ProviderConfig,
	capability: ProviderCapability,
): boolean {
	return config.capabilities?.includes(capability) ?? false;
}

/**
 * Check if provider supports reasoning/thinking
 */
export function supportsReasoning(config: ProviderConfig): boolean {
	return hasCapability(config, "reasoning");
}

/**
 * Check if provider supports prompt caching
 */
export function supportsPromptCache(config: ProviderConfig): boolean {
	return hasCapability(config, "prompt-cache");
}

/**
 * Resolve the provider ID used for handler selection and built-in behavior.
 */
export function resolveRoutingProviderId(
	config: Pick<ProviderConfig, "providerId" | "routingProviderId">,
): string {
	return normalizeProviderId(config.routingProviderId ?? config.providerId);
}

// =============================================================================
// Deprecated Types (for backwards compatibility)
// =============================================================================

/**
 * @deprecated Use ProviderConfig directly - all fields are now unified
 */
export type ProviderSpecificConfig = Pick<
	ProviderConfig,
	| "aws"
	| "gcp"
	| "azure"
	| "sap"
	| "oca"
	| "maxContextTokens"
	| "apiLine"
	| "oauthPath"
	| "openRouterProviderSorting"
>;

/**
 * @deprecated Use ProviderConfig directly
 */
export type ProviderDefaultsConfig = Pick<
	ProviderConfig,
	"baseUrl" | "modelId" | "knownModels" | "headers" | "capabilities"
>;
