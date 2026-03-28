/**
 * Settings Schema
 *
 * User-friendly settings interface with Zod validation.
 * Converts to internal ProviderConfig for handler creation.
 */

import { resolveProviderModelCatalogKeys } from "@clinebot/shared";
import { z } from "zod";
import {
	DEFAULT_EXTERNAL_OCA_BASE_URL,
	DEFAULT_INTERNAL_OCA_BASE_URL,
} from "../../models/catalog/providers/oca";
import { getGeneratedModelsForProvider } from "../../models/generated-access";
import type {
	ProviderCapability,
	ProviderConfig,
	ProviderId,
} from "../config/provider-config";
import { normalizeProviderId } from "../config/provider-ids";
import { OPENAI_COMPATIBLE_PROVIDERS } from "../runtime/provider-defaults";

// =============================================================================
// Provider ID Schema
// =============================================================================

/**
 * All supported provider IDs as a Zod enum
 */
export const ProviderIdSchema = z
	.string()
	.min(1)
	.regex(/^[a-z0-9][a-z0-9-]*$/i);

// =============================================================================
// Authentication Schema
// =============================================================================

/**
 * Authentication settings
 */
export const AuthSettingsSchema = z.object({
	/** API key (most common) */
	apiKey: z.string().optional(),
	/** OAuth access token */
	accessToken: z.string().optional(),
	/** OAuth refresh token */
	refreshToken: z.string().optional(),
	/** OAuth access token expiry (unix epoch ms) */
	expiresAt: z.number().int().positive().optional(),
	/** Account ID (for account-based auth) */
	accountId: z.string().optional(),
});

export type AuthSettings = z.infer<typeof AuthSettingsSchema>;

// =============================================================================
// Reasoning/Thinking Schema
// =============================================================================

/**
 * Reasoning/thinking configuration
 */
const ReasoningLevelSchema = z.enum(["none", "low", "medium", "high", "xhigh"]);

export const ReasoningSettingsSchema = z.object({
	/** Enable thinking with provider/model defaults when supported */
	enabled: z.boolean().optional(),
	/** Unified reasoning/thinking level */
	effort: ReasoningLevelSchema.optional(),
	/** Extended thinking budget in tokens */
	budgetTokens: z.number().int().positive().optional(),
});

export type ReasoningSettings = z.infer<typeof ReasoningSettingsSchema>;

// =============================================================================
// AWS/Bedrock Schema
// =============================================================================

/**
 * AWS Bedrock configuration
 */
export const AwsSettingsSchema = z.object({
	accessKey: z.string().optional(),
	secretKey: z.string().optional(),
	sessionToken: z.string().optional(),
	region: z.string().optional(),
	profile: z.string().optional(),
	authentication: z.enum(["iam", "api-key", "profile"]).optional(),
	usePromptCache: z.boolean().optional(),
	useCrossRegionInference: z.boolean().optional(),
	useGlobalInference: z.boolean().optional(),
	endpoint: z.string().url().optional(),
	customModelBaseId: z.string().optional(),
});

export type AwsSettings = z.infer<typeof AwsSettingsSchema>;

// =============================================================================
// GCP/Vertex Schema
// =============================================================================

/**
 * Google Cloud Vertex AI configuration
 */
export const GcpSettingsSchema = z.object({
	projectId: z.string().optional(),
	region: z.string().optional(),
});

export type GcpSettings = z.infer<typeof GcpSettingsSchema>;

// =============================================================================
// Azure Schema
// =============================================================================

/**
 * Azure OpenAI configuration
 */
export const AzureSettingsSchema = z.object({
	apiVersion: z.string().optional(),
	useIdentity: z.boolean().optional(),
});

export type AzureSettings = z.infer<typeof AzureSettingsSchema>;

// =============================================================================
// SAP AI Core Schema
// =============================================================================

/**
 * SAP AI Core configuration
 */
export const SapSettingsSchema = z.object({
	clientId: z.string().optional(),
	clientSecret: z.string().optional(),
	tokenUrl: z.string().url().optional(),
	resourceGroup: z.string().optional(),
	deploymentId: z.string().optional(),
	useOrchestrationMode: z.boolean().optional(),
	api: z.enum(["orchestration", "foundation-models"]).optional(),
	defaultSettings: z.record(z.string(), z.unknown()).optional(),
});

export type SapSettings = z.infer<typeof SapSettingsSchema>;

// =============================================================================
// OCA Schema
// =============================================================================

/**
 * Oracle Cloud AI configuration
 */
export const OcaSettingsSchema = z.object({
	mode: z.enum(["internal", "external"]).optional(),
	usePromptCache: z.boolean().optional(),
});

export type OcaSettings = z.infer<typeof OcaSettingsSchema>;

// =============================================================================
// Model Catalog Schema
// =============================================================================

/**
 * Runtime model catalog refresh configuration
 */
export const ModelCatalogSettingsSchema = z.object({
	/** Fetch latest catalog at handler initialization */
	loadLatestOnInit: z.boolean().optional(),
	/** Fetch provider-private models when auth is available */
	loadPrivateOnAuth: z.boolean().optional(),
	/** Catalog endpoint URL */
	url: z.string().url().optional(),
	/** Cache TTL for live catalog in milliseconds */
	cacheTtlMs: z.number().int().positive().optional(),
	/** Throw when live catalog refresh fails */
	failOnError: z.boolean().optional(),
});

export type ModelCatalogSettings = z.infer<typeof ModelCatalogSettingsSchema>;

// =============================================================================
// Main Settings Schema
// =============================================================================

/**
 * Main provider settings schema
 *
 * This is the user-friendly interface for configuring providers.
 * Use `parseSettings()` or `toProviderConfig()` to convert to ProviderConfig.
 */
export const ProviderSettingsSchema = z.object({
	// =========================================================================
	// Required
	// =========================================================================

	/** Provider ID - determines which handler to use */
	provider: ProviderIdSchema,

	// =========================================================================
	// Authentication (can use shorthand or detailed)
	// =========================================================================

	/** API key (shorthand for auth.apiKey) */
	apiKey: z.string().optional(),

	/** Detailed authentication settings */
	auth: AuthSettingsSchema.optional(),

	// =========================================================================
	// Model Configuration
	// =========================================================================

	/** Model identifier (uses provider default if not specified) */
	model: z.string().optional(),

	/** Maximum output tokens (overrides model default) */
	maxTokens: z.number().int().positive().optional(),

	/** Maximum context window tokens (overrides model default) */
	contextWindow: z.number().int().positive().optional(),

	// =========================================================================
	// Endpoint Configuration
	// =========================================================================

	/** Base URL for the API (uses provider default if not specified) */
	baseUrl: z.string().url().optional(),

	/** Custom headers to include in requests */
	headers: z.record(z.string(), z.string()).optional(),

	/** Request timeout in milliseconds */
	timeout: z.number().int().positive().optional(),

	// =========================================================================
	// Reasoning/Thinking Configuration
	// =========================================================================

	/** Reasoning/thinking settings */
	reasoning: ReasoningSettingsSchema.optional(),

	// =========================================================================
	// Cloud Provider Configuration
	// =========================================================================

	/** AWS/Bedrock configuration */
	aws: AwsSettingsSchema.optional(),

	/** Google Cloud/Vertex configuration */
	gcp: GcpSettingsSchema.optional(),

	/** Azure OpenAI configuration */
	azure: AzureSettingsSchema.optional(),

	/** SAP AI Core configuration */
	sap: SapSettingsSchema.optional(),

	/** Oracle Cloud AI configuration */
	oca: OcaSettingsSchema.optional(),

	// =========================================================================
	// Region Configuration
	// =========================================================================

	/** Cloud region */
	region: z.string().optional(),

	/** API line for region-specific routing (e.g., Qwen) */
	apiLine: z.enum(["china", "international"]).optional(),

	// =========================================================================
	// Capabilities
	// =========================================================================

	/** Explicit capabilities (usually auto-detected from provider) */
	capabilities: z
		.array(
			z.enum([
				"reasoning",
				"prompt-cache",
				"streaming",
				"tools",
				"vision",
				"computer-use",
				"oauth",
			]),
		)
		.optional(),

	/** Runtime model catalog refresh settings */
	modelCatalog: ModelCatalogSettingsSchema.optional(),
});

export type ProviderSettings = z.infer<typeof ProviderSettingsSchema>;

// =============================================================================
// Validation and Conversion Functions
// =============================================================================

/**
 * Parse and validate settings
 *
 * @param input - Raw settings input (unknown type)
 * @returns Validated ProviderSettings
 * @throws ZodError if validation fails
 *
 * @example
 * ```typescript
 * const settings = parseSettings({
 *   provider: "anthropic",
 *   apiKey: "sk-...",
 *   model: "claude-sonnet-4-20250514",
 * })
 * ```
 */
export function parseSettings(input: unknown): ProviderSettings {
	return ProviderSettingsSchema.parse(input);
}

/**
 * Safely parse settings without throwing
 *
 * @param input - Raw settings input (unknown type)
 * @returns SafeParseResult with success/error info
 *
 * @example
 * ```typescript
 * const result = safeParseSettings({ provider: "anthropic" })
 * if (result.success) {
 *   console.log(result.data)
 * } else {
 *   console.error(result.error.issues)
 * }
 * ```
 */
export function safeParseSettings(
	input: unknown,
): ReturnType<typeof ProviderSettingsSchema.safeParse> {
	return ProviderSettingsSchema.safeParse(input);
}

/**
 * Convert validated settings to ProviderConfig
 *
 * This function takes validated ProviderSettings and converts them
 * to the internal ProviderConfig format used by handlers.
 *
 * @param settings - Validated provider settings
 * @returns ProviderConfig ready for handler creation
 *
 * @example
 * ```typescript
 * const settings = parseSettings({ provider: "openai", apiKey: "sk-..." })
 * const config = toProviderConfig(settings)
 * const handler = createHandler(config)
 * ```
 */
export function toProviderConfig(settings: ProviderSettings): ProviderConfig {
	const providerId = settings.provider as ProviderId;
	const normalizedProviderId = normalizeProviderId(providerId);
	const unifiedReasoningLevel = settings.reasoning?.effort;
	const reasoningEffort =
		unifiedReasoningLevel && unifiedReasoningLevel !== "none"
			? unifiedReasoningLevel
			: undefined;

	// Get provider defaults if available
	const providerDefaults = OPENAI_COMPATIBLE_PROVIDERS[normalizedProviderId];
	const generatedKnownModels = Object.assign(
		{},
		...resolveProviderModelCatalogKeys(normalizedProviderId).map((catalogKey) =>
			getGeneratedModelsForProvider(catalogKey),
		),
	);

	// Resolve API key: OAuth access token wins (most recent), then shorthand apiKey, then auth.apiKey
	const apiKey =
		settings.auth?.accessToken ?? settings.apiKey ?? settings.auth?.apiKey;
	const resolvedBaseUrl =
		settings.baseUrl ??
		(normalizedProviderId === "oca"
			? settings.oca?.mode === "internal"
				? DEFAULT_INTERNAL_OCA_BASE_URL
				: DEFAULT_EXTERNAL_OCA_BASE_URL
			: providerDefaults?.baseUrl);

	// Build the config
	const config: ProviderConfig = {
		// Provider identification
		providerId,

		// Model configuration
		modelId: settings.model ?? providerDefaults?.modelId ?? "default",
		knownModels:
			providerDefaults?.knownModels ??
			(Object.keys(generatedKnownModels).length > 0
				? generatedKnownModels
				: undefined),

		// Authentication
		apiKey,
		accessToken: settings.auth?.accessToken,
		refreshToken: settings.auth?.refreshToken,
		accountId: settings.auth?.accountId,

		// Endpoint configuration
		baseUrl: resolvedBaseUrl,
		headers: settings.headers,
		timeoutMs: settings.timeout,

		// Token limits
		maxOutputTokens: settings.maxTokens,
		maxContextTokens: settings.contextWindow,

		// Reasoning configuration
		thinking: settings.reasoning?.enabled,
		reasoningEffort,
		thinkingBudgetTokens: settings.reasoning?.budgetTokens,

		// Region configuration
		region: settings.region ?? settings.aws?.region ?? settings.gcp?.region,
		apiLine: settings.apiLine,
		useCrossRegionInference: settings.aws?.useCrossRegionInference,
		useGlobalInference: settings.aws?.useGlobalInference,

		// AWS configuration
		aws: settings.aws
			? {
					accessKey: settings.aws.accessKey,
					secretKey: settings.aws.secretKey,
					sessionToken: settings.aws.sessionToken,
					authentication: settings.aws.authentication,
					profile: settings.aws.profile,
					usePromptCache: settings.aws.usePromptCache,
					endpoint: settings.aws.endpoint,
					customModelBaseId: settings.aws.customModelBaseId,
				}
			: undefined,

		// GCP configuration
		gcp: settings.gcp
			? {
					projectId: settings.gcp.projectId,
					region: settings.gcp.region,
				}
			: undefined,

		// Azure configuration
		azure: settings.azure,

		// SAP configuration
		sap: settings.sap,

		// OCA configuration
		oca: settings.oca,

		// Capabilities
		capabilities: (settings.capabilities ?? providerDefaults?.capabilities) as
			| ProviderCapability[]
			| undefined,

		// Runtime model catalog refresh
		modelCatalog: settings.modelCatalog
			? {
					loadLatestOnInit: settings.modelCatalog.loadLatestOnInit,
					loadPrivateOnAuth: settings.modelCatalog.loadPrivateOnAuth,
					url: settings.modelCatalog.url,
					cacheTtlMs: settings.modelCatalog.cacheTtlMs,
					failOnError: settings.modelCatalog.failOnError,
				}
			: undefined,
	};

	// Remove undefined values for cleaner config
	return Object.fromEntries(
		Object.entries(config).filter(([_, v]) => v !== undefined),
	) as ProviderConfig;
}

/**
 * Parse settings and convert to ProviderConfig in one step
 *
 * This is a convenience function that combines `parseSettings()` and `toProviderConfig()`.
 *
 * @param input - Raw settings input (unknown type)
 * @returns ProviderConfig ready for handler creation
 * @throws ZodError if validation fails
 *
 * @example
 * ```typescript
 * import { createHandler, createProviderConfig } from "@clinebot/providers"
 *
 * const config = createProviderConfig({
 *   provider: "anthropic",
 *   apiKey: process.env.ANTHROPIC_API_KEY,
 *   model: "claude-sonnet-4-20250514",
 *   reasoning: { effort: "high" },
 * })
 *
 * const handler = createHandler(config)
 * ```
 */
export function createProviderConfig(input: unknown): ProviderConfig {
	const settings = parseSettings(input);
	return toProviderConfig(settings);
}

/**
 * Safely create ProviderConfig without throwing
 *
 * @param input - Raw settings input
 * @returns Object with either `config` on success or `error` on failure
 *
 * @example
 * ```typescript
 * const result = safeCreateProviderConfig({ provider: "openai" })
 * if (result.success) {
 *   const handler = createHandler(result.config)
 * } else {
 *   console.error("Invalid settings:", result.error.issues)
 * }
 * ```
 */
export function safeCreateProviderConfig(
	input: unknown,
):
	| { success: true; config: ProviderConfig }
	| { success: false; error: z.ZodError } {
	const result = safeParseSettings(input);
	if (result.success) {
		return { success: true, config: toProviderConfig(result.data) };
	}
	return { success: false, error: result.error };
}
