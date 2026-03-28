/**
 * Model Schema Definitions
 *
 * Zod schemas for validating model information, capabilities, and pricing.
 * These schemas are the source of truth for all model type definitions.
 */

import { z } from "zod";

// =============================================================================
// API Format
// =============================================================================

/**
 * API format variants for different provider protocols
 */
export const ApiFormatSchema = z.enum(["default", "openai-responses", "r1"]);

export type ApiFormat = z.infer<typeof ApiFormatSchema>;

export const ApiFormat = {
	DEFAULT: "default" as const,
	OPENAI_RESPONSES: "openai-responses" as const,
	R1: "r1" as const,
} as const;

// =============================================================================
// Model Capabilities
// =============================================================================

/**
 * Capabilities a model may support
 */
export const ModelCapabilitySchema = z.enum([
	"images", // Image/vision inputs
	"tools", // Tool/function calling
	"streaming", // Streaming responses
	"prompt-cache", // Prompt caching
	"reasoning", // Extended thinking/reasoning
	"reasoning-effort", // Reasoning effort parameter
	"computer-use", // Computer use tools
	"global-endpoint", // Global endpoint (Vertex AI)
	"structured_output", // Structured output formats
	"temperature", // Supports temperature parameter
	"files", // File inputs (e.g. PDFs)
]);

export type ModelCapability = z.infer<typeof ModelCapabilitySchema>;

// =============================================================================
// Model Status
// =============================================================================

/**
 * Model lifecycle status
 */
export const ModelStatusSchema = z.enum([
	"active", // Currently available and supported
	"preview", // Available but may change
	"deprecated", // Will be removed, use alternative
	"legacy", // Still works but not recommended
]);

export type ModelStatus = z.infer<typeof ModelStatusSchema>;

// =============================================================================
// Pricing
// =============================================================================

/**
 * Token pricing configuration (per million tokens)
 */
export const ModelPricingSchema = z.object({
	/** Input price per million tokens */
	input: z.number().optional(),
	/** Output price per million tokens */
	output: z.number().optional(),
	/** Cache write price per million tokens */
	cacheWrite: z.number().optional(),
	/** Cache read price per million tokens */
	cacheRead: z.number().optional(),
});

export type ModelPricing = z.infer<typeof ModelPricingSchema>;

// =============================================================================
// Thinking/Reasoning Config
// =============================================================================

/**
 * Configuration for models with thinking/reasoning capabilities
 */
export const ThinkingConfigSchema = z.object({
	/** Maximum thinking budget in tokens */
	maxBudget: z.number().optional(),
	/** Output price when thinking is enabled (per million tokens) */
	outputPrice: z.number().optional(),
	/** Gemini-specific thinking level */
	thinkingLevel: z.enum(["low", "high"]).optional(),
});

export type ThinkingConfig = z.infer<typeof ThinkingConfigSchema>;

// =============================================================================
// Model Info
// =============================================================================

/**
 * Complete model information schema
 */
export const ModelInfoSchema = z.object({
	/** Model identifier (e.g., "claude-sonnet-4-20250514") */
	id: z.string(),

	/** Human-readable model name */
	name: z.string().optional(),

	/** Model description */
	description: z.string().optional(),

	// === Token Limits ===

	/** Maximum output tokens */
	maxTokens: z.number().optional(),

	/** Context window size in tokens */
	contextWindow: z.number().optional(),

	// === Capabilities ===

	/** Model capabilities (images, tools, streaming, prompt-cache, reasoning, etc.) */
	capabilities: z.array(ModelCapabilitySchema).optional(),

	// === API Configuration ===

	/** API format required by this model */
	apiFormat: ApiFormatSchema.optional(),

	/** System message role override (for OpenAI-compatible) */
	systemRole: z.enum(["system", "developer"]).optional(),

	/** Default temperature for this model */
	temperature: z.number().optional(),

	// === Pricing ===

	/** Token pricing (per million tokens) */
	pricing: ModelPricingSchema.optional(),

	// === Thinking/Reasoning ===

	/** Thinking/reasoning configuration */
	thinkingConfig: ThinkingConfigSchema.optional(),

	// === Lifecycle ===

	/** Model status (active, preview, deprecated, legacy) */
	status: ModelStatusSchema.optional(),

	/** Deprecation notice if status is deprecated */
	deprecationNotice: z.string().optional(),

	/** Suggested replacement model ID if deprecated */
	replacedBy: z.string().optional(),

	/** Date when model was released (ISO 8601) */
	releaseDate: z.string().optional(),

	/** Date when model will be/was deprecated (ISO 8601) */
	deprecationDate: z.string().optional(),
});

export type ModelInfo = z.infer<typeof ModelInfoSchema>;

// =============================================================================
// Model Entry (with ID)
// =============================================================================

/**
 * A model entry with its ID and info
 */
export const ModelEntrySchema = z.object({
	/** Model identifier (e.g., "claude-sonnet-4-20250514") */
	id: z.string(),
	/** Model information */
	info: ModelInfoSchema,
});

export type ModelEntry = z.infer<typeof ModelEntrySchema>;

// =============================================================================
// Provider Info
// =============================================================================

/**
 * Provider capability (applies to all models from this provider)
 */
export const ProviderCapabilitySchema = z.enum([
	"reasoning",
	"prompt-cache",
	"tools",
	"oauth",
]);

export type ProviderCapability = z.infer<typeof ProviderCapabilitySchema>;

/**
 * Provider protocol/transport family
 */
export const ProviderProtocolSchema = z.enum([
	"anthropic",
	"gemini",
	"openai-chat",
	"openai-responses",
	"openai-r1",
]);

export type ProviderProtocol = z.infer<typeof ProviderProtocolSchema>;

/**
 * Provider configuration
 */
export const ProviderInfoSchema = z.object({
	/** Provider ID (e.g., "anthropic", "openai") */
	id: z.string(),
	/** Human-readable name */
	name: z.string(),
	/** Provider description */
	description: z.string().optional(),
	/** Provider protocol family used for handler routing */
	protocol: ProviderProtocolSchema.optional(),
	/** Base URL for API */
	baseUrl: z.string().optional(),
	/** Default model ID */
	defaultModelId: z.string(),
	/** Provider-level capabilities */
	capabilities: z.array(ProviderCapabilitySchema).optional(),
	/** Environment variables associated with this provider */
	env: z.array(z.string()).optional(),
});

export type ProviderInfo = z.infer<typeof ProviderInfoSchema>;

// =============================================================================
// Model Collection
// =============================================================================

/**
 * A collection of models from a provider
 */
export const ModelCollectionSchema = z.object({
	/** Provider information */
	provider: ProviderInfoSchema,
	/** Models keyed by ID */
	models: z.record(z.string(), ModelInfoSchema),
});

export type ModelCollection = z.infer<typeof ModelCollectionSchema>;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if a model has a specific capability
 */
export function hasCapability(
	info: ModelInfo,
	capability: ModelCapability,
): boolean {
	return info.capabilities?.includes(capability) ?? false;
}

/**
 * Check if a model is deprecated
 */
export function isDeprecated(info: ModelInfo): boolean {
	return info.status === "deprecated";
}

/**
 * Check if a model is active (not deprecated or legacy)
 */
export function isActive(info: ModelInfo): boolean {
	return !info.status || info.status === "active" || info.status === "preview";
}

/**
 * Get pricing for a model
 */
export function getPricing(info: ModelInfo): ModelPricing {
	return info.pricing ?? {};
}

/**
 * Validate model info against schema
 */
export function validateModelInfo(data: unknown): ModelInfo {
	return ModelInfoSchema.parse(data);
}

/**
 * Safely validate model info (returns undefined on failure)
 */
export function safeValidateModelInfo(data: unknown): ModelInfo | undefined {
	const result = ModelInfoSchema.safeParse(data);
	return result.success ? result.data : undefined;
}
