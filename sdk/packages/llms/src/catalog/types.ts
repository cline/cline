/**
 * Model Schema Definitions
 *
 * Re-exports model info types from @clinebot/shared (canonical source)
 * and defines provider-level schemas local to @clinebot/llms.
 */

import { z } from "zod";

// ModelInfo and dependencies — canonical home is @clinebot/shared
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
} from "@clinebot/shared";

// Re-import for use in local schemas
import { ModelInfoSchema, ProviderCapabilitySchema } from "@clinebot/shared";

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

export type ProviderClient = z.infer<typeof ProviderClientSchema>;
export type ProviderProtocol = z.infer<typeof ProviderProtocolSchema>;

export const ProviderInfoSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().optional(),
	protocol: ProviderProtocolSchema.optional(),
	baseUrl: z.string().optional(),
	defaultModelId: z.string(),
	capabilities: z.array(ProviderCapabilitySchema).optional(),
	env: z.array(z.string()).optional(),
	client: ProviderClientSchema,
});

export type ProviderInfo = z.infer<typeof ProviderInfoSchema>;

export const ModelCollectionSchema = z.object({
	provider: ProviderInfoSchema,
	models: z.record(z.string(), ModelInfoSchema),
});

export type ModelCollection = z.infer<typeof ModelCollectionSchema>;
