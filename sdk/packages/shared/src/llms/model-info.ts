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

export type ChatModelModalities = {
	readonly input?: readonly ModelModality[];
	readonly output?: readonly ModelModality[];
};

/**
 * Returns whether a model can participate in a text chat turn.
 *
 * Missing modality metadata is treated as chat-compatible for backwards
 * compatibility. When a catalog does provide modalities, the model must both
 * accept text and produce text; dedicated transcription and media-generation
 * endpoints therefore stay available in the shared catalog without leaking
 * into chat model pickers.
 */
export function supportsChatModalities(
	modalities: ChatModelModalities | undefined,
): boolean {
	return (
		(modalities?.input === undefined || modalities.input.includes("text")) &&
		(modalities?.output === undefined || modalities.output.includes("text"))
	);
}

/**
 * Provider operation used to execute a model request.
 *
 * Modalities describe the values a model accepts and produces; they do not
 * identify the provider endpoint. Keeping the operation explicit prevents an
 * image-output model from being routed to a generic chat or compatible-image
 * endpoint merely because its catalog advertises an image modality.
 */
export const ModelOperationSchema = z.enum([
	"language",
	"image-generation",
	"speech-generation",
	"video-generation",
	"transcription",
]);

export type ModelOperation = z.infer<typeof ModelOperationSchema>;

export type ChatCompatibleModelDescriptor = {
	readonly operation?: ModelOperation;
	readonly modalities?: ChatModelModalities;
};

/**
 * Returns whether a model uses the language operation and supports a text chat
 * turn. Missing operation and modality metadata remain chat-compatible for
 * backwards compatibility, while any explicitly non-language operation is
 * excluded even when its modalities are absent.
 */
export function isChatCompatibleModel(
	model: ChatCompatibleModelDescriptor,
): boolean {
	return (
		(model.operation === undefined || model.operation === "language") &&
		supportsChatModalities(model.modalities)
	);
}

/**
 * Execution modes supported by a non-language model operation.
 *
 * The operation selects the provider transport; the mode describes how that
 * transport is consumed. Keeping this separate from generic model
 * capabilities prevents transcription-specific flags from spreading through
 * otherwise modality-agnostic clients.
 */
export const ModelOperationModeSchema = z.enum(["batch", "streaming"]);

export type ModelOperationMode = z.infer<typeof ModelOperationModeSchema>;

interface ImageOutputModelDescriptor {
	operation?: ModelOperation;
	modalities?: ModelModalities;
}

export function modelProducesImages(
	model: ImageOutputModelDescriptor,
): boolean {
	return (
		model.modalities?.input.includes("text") === true &&
		model.modalities.output.includes("image")
	);
}

export function usesImageGenerationOperation(
	model: ImageOutputModelDescriptor,
): boolean {
	return model.operation === "image-generation";
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
	operation: ModelOperationSchema.optional(),
	operationModes: z.array(ModelOperationModeSchema).optional(),
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
