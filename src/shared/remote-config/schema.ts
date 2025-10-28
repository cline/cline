/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️  CRITICAL WARNING ⚠️
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * THE API SERVER MUST BE RE-DEPLOYED WHENEVER THIS SCHEMA IS UPDATED!
 *
 * This schema is used by both the extension and the API server for validation.
 * Any changes here require a coordinated deployment to avoid validation errors.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { z } from "zod"

// OpenAI Compatible model schema with per-model settings
export const OpenAiCompatibleModelSchema = z.object({
	id: z.string(), // The model ID is required
	temperature: z.number().optional(),
	isR1FormatRequired: z.boolean().optional(),
	maxTokens: z.number().optional(),
	contextWindow: z.number().optional(),
	inputPrice: z.number().optional(),
	outputPrice: z.number().optional(),
	supportsImages: z.boolean().optional(),
})

// OpenAiCompatible specific settings
export const OpenAiCompatibleSchema = z.object({
	// A list of the allowed models with their settings
	models: z.array(OpenAiCompatibleModelSchema).optional(),
	// OpenAiCompatible specific settings:
	openAiBaseUrl: z.string().optional(),
	openAiHeaders: z.record(z.string(), z.string()).optional(),
	azureApiVersion: z.string().optional(),
})

// AWS Bedrock model schema with per-model settings
export const AwsBedrockModelSchema = z.object({
	id: z.string(), // The model ID is required
	thinkingBudgetTokens: z.number().optional(),
})

// AWS Bedrock custom model schema (separate from regular models)
export const AwsBedrockCustomModelSchema = z.object({
	name: z.string(), // The model name is required
	baseModelId: z.string(), // The base model ID is required
	thinkingBudgetTokens: z.number().optional(),
})

// AWS Bedrock specific settings
export const AwsBedrockSettingsSchema = z.object({
	// A list of the allowed models with their settings
	models: z.array(AwsBedrockModelSchema).optional(),
	// Custom models
	customModels: z.array(AwsBedrockCustomModelSchema).optional(),
	// AWS Bedrock specific settings:
	awsRegion: z.string().optional(),
	awsUseCrossRegionInference: z.boolean().optional(),
	awsUseGlobalInference: z.boolean().optional(),
	awsBedrockUsePromptCache: z.boolean().optional(),
	awsBedrockEndpoint: z.string().optional(),
})

// Cline Provider model schema with per-model settings
export const ClineModelSchema = z.object({
	id: z.string(), // The model ID is required
})

// Cline Provider specific settings
export const ClineSettingsSchema = z.object({
	// A list of the allowed models with their settings
	models: z.array(ClineModelSchema).optional(),
})

// Provider settings schema
// Each provider becomes an optional field
const ProviderSettingsSchema = z.object({
	OpenAiCompatible: OpenAiCompatibleSchema.optional(),
	AwsBedrock: AwsBedrockSettingsSchema.optional(),
	Cline: ClineSettingsSchema.optional(),
})

export const RemoteConfigSchema = z.object({
	// The version of the remote config settings, e.g. v1
	// This field is for internal use only, and won't be visible to the administrator in the UI.
	version: z.string(),

	// General settings not specific to any provider
	telemetryEnabled: z.boolean().optional(),
	mcpMarketplaceEnabled: z.boolean().optional(),
	// If the user is allowed to enable YOLO mode. Note this is different from the extension setting
	// yoloModeEnabled, because we do not want to force YOLO enabled for the user.
	yoloModeAllowed: z.boolean().optional(),

	// OpenTelemetry configuration
	openTelemetryEnabled: z.boolean().optional(),
	openTelemetryMetricsExporter: z.string().optional(),
	openTelemetryLogsExporter: z.string().optional(),
	openTelemetryOtlpProtocol: z.string().optional(),
	openTelemetryOtlpEndpoint: z.string().optional(),
	openTelemetryOtlpMetricsProtocol: z.string().optional(),
	openTelemetryOtlpMetricsEndpoint: z.string().optional(),
	openTelemetryOtlpLogsProtocol: z.string().optional(),
	openTelemetryOtlpLogsEndpoint: z.string().optional(),
	openTelemetryMetricExportInterval: z.number().optional(),
	openTelemetryOtlpInsecure: z.boolean().optional(),
	openTelemetryLogBatchSize: z.number().optional(),
	openTelemetryLogBatchTimeout: z.number().optional(),
	openTelemetryLogMaxQueueSize: z.number().optional(),

	// Other top-level settings can be added here later.

	// Provider specific settings
	// Each provider in providerSchemasMap is automatically available as an optional field
	providerSettings: ProviderSettingsSchema.optional(),
})

// Type inference from schemas
export type OpenAiCompatibleModel = z.infer<typeof OpenAiCompatibleModelSchema>
export type OpenAiCompatible = z.infer<typeof OpenAiCompatibleSchema>
export type AwsBedrockModel = z.infer<typeof AwsBedrockModelSchema>
export type AwsBedrockCustomModel = z.infer<typeof AwsBedrockCustomModelSchema>
export type AwsBedrockSettings = z.infer<typeof AwsBedrockSettingsSchema>
export type ProviderSettings = z.infer<typeof ProviderSettingsSchema>
export type RemoteConfig = z.infer<typeof RemoteConfigSchema>
