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

export const ModelInfoSchema = z.object({
	maxTokens: z.number().optional(),
	contextWindow: z.number().optional(),
	inputPrice: z.number().optional(),
	outputPrice: z.number().optional(),
	supportsImages: z.boolean().optional(),
})

export const OpenAiModelInfoSchema = z.object({
	temperature: z.number().optional(),
	isR1FormatRequired: z.boolean().optional(),
})

// OpenAiCompatible specific settings
export const OpenAiCompatibleSchema = z.object({
	// A list of the allowed models.
	modelIds: z.array(z.string()).default([]),
	// OpenAiCompatible specific settings:
	openAiBaseUrl: z.string().optional(),
	openAiHeaders: z.record(z.string(), z.string()).default({}),
	azureApiVersion: z.string().optional(),
})

// AWS Bedrock specific settings
export const AwsBedrockSettingsSchema = z.object({
	// A list of the allowed models.
	modelIds: z.array(z.string()).default([]),
	// AWS Bedrock specific settings:
	awsBedrockCustomSelected: z.boolean().optional(),
	awsBedrockCustomModelBaseId: z.string().optional(),
	awsRegion: z.string().optional(),
	awsUseCrossRegionInference: z.boolean().optional(),
	awsBedrockUsePromptCache: z.boolean().optional(),
	awsBedrockEndpoint: z.string().optional(),
})

// Map of provider names to their schemas
// To add a new provider, simply add it to this map
const providerSchemasMap = {
	OpenAiCompatible: OpenAiCompatibleSchema,
	AwsBedrock: AwsBedrockSettingsSchema,
} as const

// Generate ProviderSettingsSchema from the map
// Each provider becomes an optional field
const ProviderSettingsSchema = z.object(
	Object.fromEntries(Object.entries(providerSchemasMap).map(([key, schema]) => [key, schema.optional()])),
)

// The supported providers (derived from the map keys)
export const ProviderSchema = z.enum(Object.keys(providerSchemasMap) as [string, ...string[]])

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
	// Other top-level settings can be added here later.

	// Provider specific settings
	// Each provider in providerSchemasMap is automatically available as an optional field
	providerSettings: ProviderSettingsSchema.optional(),
})

// Type inference from schemas
export type Provider = z.infer<typeof ProviderSchema>
export type ModelInfo = z.infer<typeof ModelInfoSchema>
export type OpenAiModelInfo = z.infer<typeof OpenAiModelInfoSchema>
export type OpenAiCompatible = z.infer<typeof OpenAiCompatibleSchema>
export type AwsBedrockSettings = z.infer<typeof AwsBedrockSettingsSchema>
export type ProviderSettings = z.infer<typeof ProviderSettingsSchema>
export type RemoteConfig = z.infer<typeof RemoteConfigSchema>
