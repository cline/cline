/**
 * Model Schema Definitions
 *
 * Zod schemas for validating model information, capabilities, and pricing.
 * These schemas are the source of truth for all model type definitions.
 */

import { z } from "zod";

export const ApiFormatSchema = z.enum(["default", "openai-responses", "r1"]);

export type ApiFormat = z.infer<typeof ApiFormatSchema>;

export const ApiFormat = {
	DEFAULT: "default" as const,
	OPENAI_RESPONSES: "openai-responses" as const,
	R1: "r1" as const,
} as const;

export const ModelCapabilitySchema = z.enum([
	"images",
	"tools",
	"streaming",
	"prompt-cache",
	"reasoning",
	"reasoning-effort",
	"computer-use",
	"global-endpoint",
	"structured_output",
	"temperature",
	"files",
]);

export type ModelCapability = z.infer<typeof ModelCapabilitySchema>;

export const ModelStatusSchema = z.enum([
	"active",
	"preview",
	"deprecated",
	"legacy",
]);

export type ModelStatus = z.infer<typeof ModelStatusSchema>;

export const ModelPricingSchema = z.object({
	input: z.number().optional(),
	output: z.number().optional(),
	cacheWrite: z.number().optional(),
	cacheRead: z.number().optional(),
});

export type ModelPricing = z.infer<typeof ModelPricingSchema>;

export const ThinkingConfigSchema = z.object({
	maxBudget: z.number().optional(),
	outputPrice: z.number().optional(),
	thinkingLevel: z.enum(["low", "high"]).optional(),
});

export type ThinkingConfig = z.infer<typeof ThinkingConfigSchema>;

export const ModelInfoSchema = z.object({
	id: z.string(),
	name: z.string().optional(),
	description: z.string().optional(),
	maxTokens: z.number().optional(),
	contextWindow: z.number().optional(),
	capabilities: z.array(ModelCapabilitySchema).optional(),
	apiFormat: ApiFormatSchema.optional(),
	systemRole: z.enum(["system", "developer"]).optional(),
	temperature: z.number().optional(),
	pricing: ModelPricingSchema.optional(),
	thinkingConfig: ThinkingConfigSchema.optional(),
	status: ModelStatusSchema.optional(),
	deprecationNotice: z.string().optional(),
	replacedBy: z.string().optional(),
	releaseDate: z.string().optional(),
	deprecationDate: z.string().optional(),
});

export type ModelInfo = z.infer<typeof ModelInfoSchema>;

export const ModelEntrySchema = z.object({
	id: z.string(),
	info: ModelInfoSchema,
});

export type ModelEntry = z.infer<typeof ModelEntrySchema>;

export const ProviderCapabilitySchema = z.enum([
	"reasoning",
	"prompt-cache",
	"tools",
	"oauth",
	"temperature",
	"files",
]);

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
