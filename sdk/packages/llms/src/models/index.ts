/**
 * @clinebot/models
 *
 * Model definitions and registry for all supported AI providers.
 *
 * This package provides:
 * - Type-safe model definitions using Zod schemas
 * - A central registry for accessing models across providers
 * - Powerful query API for filtering models by capabilities, pricing, etc.
 * - Support for custom models and runtime registration
 *
 * @example
 * ```typescript
 * import {
 *   queryModels,
 *   createQuery,
 *   getModel,
 *   ANTHROPIC_MODELS,
 * } from "@clinebot/models"
 *
 * // Get all models with vision support
 * const visionModels = queryModels({
 *   capabilities: ["images"],
 * })
 *
 * // Use fluent query builder
 * const cheapModels = createQuery()
 *   .fromProviders(["anthropic", "openai"])
 *   .maxPrice({ input: 5 })
 *   .withCapabilities(["reasoning"])
 *   .execute()
 *
 * // Access specific model info
 * const claude = getModel("anthropic", "claude-sonnet-4-20250514")
 * ```
 *
 * @packageDocumentation
 */

// =============================================================================
// Schema Exports (Types & Validation)
// =============================================================================

export {
	// API Format
	ApiFormat,
	ApiFormatSchema,
	type ApiFormatType,
	getPricing,
	// Model Helpers
	hasCapability,
	isActive,
	isDeprecated,
	type ModelCapability,
	// Model Capabilities
	ModelCapabilitySchema,
	type ModelCollection,
	ModelCollectionSchema,
	type ModelEntry,
	// Model Entry
	ModelEntrySchema,
	type ModelInfo,
	// Model Info
	ModelInfoSchema,
	// Query Match
	type ModelMatch,
	type ModelPricing,
	// Pricing
	ModelPricingSchema,
	type ModelQueryConfig,
	// Query Config
	ModelQueryConfigSchema,
	type ModelQueryResult,
	// Query Result
	ModelQueryResultSchema,
	type ModelStatus,
	// Model Status
	ModelStatusSchema,
	// Query Helpers
	matchesQuery,
	type ProviderCapability,
	// Provider
	ProviderCapabilitySchema,
	type ProviderInfo,
	ProviderInfoSchema,
	safeValidateModelInfo,
	safeValidateQueryConfig,
	sortModels,
	type ThinkingConfig,
	// Thinking Config
	ThinkingConfigSchema,
	validateModelInfo,
	validateQueryConfig,
} from "./types/index";

// =============================================================================
// Registry Exports
// =============================================================================

export {
	clearCustomModels,
	deprecateModel,
	getAllModels,
	// Provider Access
	getAllProviders,
	getDefaultModel,
	getModel,
	getModelCount,
	// Model Access
	getModelsForProvider,
	getProvider,
	getProviderCollection,
	getProviderIds,
	hasProvider,
	registerModel,
	registerModels,
	// Registration
	registerProvider,
	resetRegistry,
	unregisterModel,
	unregisterProvider,
	// Updates
	updateModel,
} from "./registry";

// =============================================================================
// Query API Exports
// =============================================================================

export {
	createQuery,
	getActiveModels,
	getCachingModels,
	getComputerUseModels,
	getDeprecatedModels,
	// Statistics
	getModelStatistics,
	getModelsByProvider,
	getModelsInPriceRange,
	getModelsWithContextWindow,
	getReasoningModels,
	getToolModels,
	// Convenience Queries
	getVisionModels,
	// Query Builder
	ModelQueryBuilder,
	// Main Query Function
	queryModels,
	searchModels,
} from "./query";

// =============================================================================
// Generated Catalog Exports
// =============================================================================

export {
	getGeneratedModelsForProvider,
	getGeneratedModelsVersion,
	getGeneratedProviderModels,
} from "./generated-access";

// =============================================================================
// Provider Model Exports
// =============================================================================

export {
	AIHUBMIX_PROVIDER,
	ANTHROPIC_DEFAULT_MODEL,
	// Anthropic
	ANTHROPIC_MODELS,
	ANTHROPIC_PROVIDER,
	ASKSAGE_PROVIDER,
	// Other Providers
	BASETEN_PROVIDER,
	BEDROCK_DEFAULT_MODEL,
	BEDROCK_MODELS,
	BEDROCK_PROVIDER,
	CEREBRAS_DEFAULT_MODEL,
	// Cerebras
	CEREBRAS_MODELS,
	CEREBRAS_PROVIDER,
	CLAUDE_CODE_DEFAULT_MODEL,
	CLAUDE_CODE_MODELS,
	CLAUDE_CODE_PROVIDER,
	CLINE_DEFAULT_MODEL,
	CLINE_MODELS,
	CLINE_PROVIDER,
	DEEPSEEK_DEFAULT_MODEL,
	// DeepSeek
	DEEPSEEK_MODELS,
	DEEPSEEK_PROVIDER,
	DEFAULT_EXTERNAL_OCA_BASE_URL,
	DEFAULT_INTERNAL_OCA_BASE_URL,
	DIFY_PROVIDER,
	FIREWORKS_DEFAULT_MODEL,
	// Fireworks
	FIREWORKS_MODELS,
	FIREWORKS_PROVIDER,
	GEMINI_DEFAULT_MODEL,
	// Gemini
	GEMINI_MODELS,
	GEMINI_PROVIDER,
	GROQ_DEFAULT_MODEL,
	// Groq
	GROQ_MODELS,
	GROQ_PROVIDER,
	// Helpers
	getActiveAnthropicModels,
	getActiveGeminiModels,
	getActiveOpenAIModels,
	getActiveXAIModels,
	getAnthropicReasoningModels,
	getDeepSeekReasoningModels,
	getFireworksFunctionModels,
	getGeminiThinkingModels,
	getGroqVisionModels,
	getOpenAIReasoningModels,
	getTogetherLlamaModels,
	HICAP_PROVIDER,
	HUAWEI_CLOUD_MAAS_PROVIDER,
	HUGGINGFACE_PROVIDER,
	LITELLM_PROVIDER,
	LMSTUDIO_PROVIDER,
	MINIMAX_DEFAULT_MODEL,
	MINIMAX_MODELS,
	MINIMAX_PROVIDER,
	MISTRAL_PROVIDER,
	MOONSHOT_DEFAULT_MODEL,
	MOONSHOT_MODELS,
	MOONSHOT_PROVIDER,
	NEBIUS_DEFAULT_MODEL,
	// Nebius
	NEBIUS_MODELS,
	NEBIUS_PROVIDER,
	NOUS_RESEARCH_DEFAULT_MODEL,
	// Nous Research
	NOUS_RESEARCH_MODELS,
	NOUS_RESEARCH_PROVIDER,
	OCA_DEFAULT_MODEL,
	OCA_MODELS,
	OCA_PROVIDER,
	// Local Providers
	OLLAMA_PROVIDER,
	OPENAI_CODEX_DEFAULT_MODEL,
	OPENAI_CODEX_PROVIDER,
	OPENAI_DEFAULT_MODEL,
	// OpenAI
	OPENAI_MODELS,
	OPENAI_PROVIDER,
	OPENROUTER_DEFAULT_MODEL,
	OPENROUTER_MODELS,
	OPENROUTER_PROVIDER,
	// Gateway Providers
	REQUESTY_PROVIDER,
	SAMBANOVA_DEFAULT_MODEL,
	// SambaNova
	SAMBANOVA_MODELS,
	SAMBANOVA_PROVIDER,
	TOGETHER_DEFAULT_MODEL,
	// Together
	TOGETHER_MODELS,
	TOGETHER_PROVIDER,
	VERCEL_AI_GATEWAY_PROVIDER,
	VERTEX_DEFAULT_MODEL,
	VERTEX_MODELS,
	VERTEX_PROVIDER,
	XAI_DEFAULT_MODEL,
	// xAI
	XAI_MODELS,
	XAI_PROVIDER,
} from "./catalog/providers/index";
