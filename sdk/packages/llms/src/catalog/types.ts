/**
 * Model Schema Definitions
 *
 * Re-exports model info types from @cline/shared (canonical source)
 * and defines provider-level schemas local to @cline/llms.
 */

import { z } from "zod";

// ModelInfo and dependencies have their canonical home in @cline/shared
export {
	ApiFormat,
	ApiFormatSchema,
	type ModelCapability,
	ModelCapabilitySchema,
	type ModelInfo,
	ModelInfoSchema,
	type ModelPricing,
	ModelPricingSchema,
	type ModelStatus,
	ModelStatusSchema,
	type ThinkingConfig,
	ThinkingConfigSchema,
} from "@cline/shared";

// Re-import for use in local schemas
import { ModelInfoSchema, ProviderCapabilitySchema } from "@cline/shared";

export const ModelEntrySchema = z.object({
	id: z.string(),
	info: ModelInfoSchema,
});

export type ModelEntry = z.infer<typeof ModelEntrySchema>;
export type ProviderCapability = z.infer<typeof ProviderCapabilitySchema>;

export const ProviderProtocolSchema = z.enum([
	"anthropic",
	"gemini",
	"openai-chat",
	"openai-responses",
	"openai-r1",
	"ai-sdk",
]);

const ProviderClientSchema = z.enum([
	"anthropic",
	"ai-sdk",
	"ai-sdk-community",
	"openai",
	"openai-compatible",
	"openai-r1",
	"gemini",
	"bedrock",
	"custom",
	"fetch",
	"vertex",
]);

/**
 * ProviderSource indicates how a provider was added to the system,
 * which can be useful for determining trust level and whether to prompt the user for confirmation before using it.
 * For example, providers with source "system" are built-in and can be trusted,
 * while providers with source "file" were added by the user using a local JSON file,
 * and providers with source "discovery" were found through network discovery.
 */
const ProviderSourceSchema = z.enum(["system", "file", "discovery"]);

export type ProviderClient = z.infer<typeof ProviderClientSchema>;
export type ProviderProtocol = z.infer<typeof ProviderProtocolSchema>;
export type ProviderSource = z.infer<typeof ProviderSourceSchema>;

export const ProviderInfoSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().optional(),
	protocol: ProviderProtocolSchema.optional(),
	baseUrl: z.string().optional(),
	modelsSourceUrl: z.string().optional(),
	defaultModelId: z.string(),
	capabilities: z.array(ProviderCapabilitySchema).optional(),
	env: z.array(z.string()).optional(),
	client: ProviderClientSchema,
	source: ProviderSourceSchema.default("system"),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ProviderInfo = z.infer<typeof ProviderInfoSchema>;

export const ModelCollectionSchema = z.object({
	provider: ProviderInfoSchema,
	models: z.record(z.string(), ModelInfoSchema),
});

export type ModelCollection = z.infer<typeof ModelCollectionSchema>;
