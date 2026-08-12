/**
 * Model Information Types
 *
 * Zod schemas and inferred types for model capabilities, pricing,
 * and metadata. These live in shared so that agent types can reference
 * ModelInfo without depending on @cline/llms.
 */

import { z } from "zod";
import { ModelReasoningOptionSchema } from "./reasoning-options";

export const ApiFormatSchema = z.enum(["default", "openai-responses", "r1"]);

export type ApiFormat = z.infer<typeof ApiFormatSchema>;

export const ApiFormat = {
	DEFAULT: "default" as const,
	OPENAI_RESPONSES: "openai-responses" as const,
	R1: "r1" as const,
} as const;

export const ModelCapabilitySchema = z.enum([
	"images",
	"video",
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

export const ModelMetadataSchema = z
	// Keep metadata open for catalog-defined facts while typing routing fields.
	.object({
		reasoningDefaultOn: z.boolean().optional(),
	})
	.catchall(z.unknown());

export type ModelMetadata = z.infer<typeof ModelMetadataSchema>;

export const ModelModalitySchema = z.enum([
	"text",
	"image",
	"audio",
	"video",
	"pdf",
]);

export type ModelModality = z.infer<typeof ModelModalitySchema>;

export const ModelModalitiesSchema = z.object({
	input: z.array(ModelModalitySchema),
	output: z.array(ModelModalitySchema),
});

export type ModelModalities = z.infer<typeof ModelModalitiesSchema>;

interface ImageGenerationModelDescriptor {
	modalities?: ModelModalities;
	family?: string;
	metadata?: Record<string, unknown>;
}

function resolveImageGenerationModelFamily(
	model: ImageGenerationModelDescriptor,
): string | undefined {
	const family =
		model.family ??
		(typeof model.metadata?.family === "string"
			? model.metadata.family
			: undefined);
	return family?.trim().toLowerCase();
}

export function isImageGenerationModel(
	model: ImageGenerationModelDescriptor,
): boolean {
	return (
		model.modalities?.input.includes("text") === true &&
		model.modalities.output.includes("image")
	);
}

export function isDedicatedImageGenerationModel(
	model: ImageGenerationModelDescriptor,
): boolean {
	const output = model.modalities?.output;
	return (
		isImageGenerationModel(model) &&
		(output?.includes("text") !== true ||
			resolveImageGenerationModelFamily(model) === "gpt-image")
	);
}

/**
 * Whether a model's capability metadata declares `capability`.
 *
 * Capability lists reach this check from sources of very different fidelity:
 * the generated catalog is complete, but host boundaries (VS Code's legacy
 * ModelInfo, user-authored overrides, dynamic provider listings) may carry
 * partial lists reconstructed from a handful of boolean flags. A missing or
 * empty list therefore carries no signal, and each check declares its own
 * default via `assumeWhenUnspecified` instead of treating absence as denial.
 *
 * Capability gates added by future model modes (audio, video, transcription,
 * …) should route through this helper rather than reading
 * `model.capabilities` directly, so the unspecified-list semantics stay
 * consistent across the codebase.
 */
export function modelHasCapability(
	model: { capabilities?: readonly string[] },
	capability: string,
	options?: { assumeWhenUnspecified?: boolean },
): boolean {
	const capabilities = model.capabilities;
	if (capabilities === undefined || capabilities.length === 0) {
		return options?.assumeWhenUnspecified ?? false;
	}
	return capabilities.includes(capability);
}

/**
 * Whether a model can receive function/tool definitions. Fails open when the
 * capability list is missing or empty (user-entered and dynamically
 * discovered models); a populated capability list without `tools` is
 * authoritative.
 */
export function modelSupportsToolCalling(model: {
	capabilities?: readonly string[];
}): boolean {
	return modelHasCapability(model, "tools", { assumeWhenUnspecified: true });
}
export const ModelInfoSchema = z.object({
	id: z.string(),
	name: z.string().optional(),
	description: z.string().optional(),
	maxTokens: z.number().optional(),
	contextWindow: z.number().optional(),
	maxInputTokens: z.number().optional(),
	capabilities: z.array(ModelCapabilitySchema).optional(),
	modalities: ModelModalitiesSchema.optional(),
	reasoningOptions: z.array(ModelReasoningOptionSchema).optional(),
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
	family: z.string().optional(),
	metadata: ModelMetadataSchema.optional(),
});

export type ModelInfo = z.infer<typeof ModelInfoSchema>;
