/**
 * Live model-list normalization for Baseten.
 *
 * Baseten's `/v1/models` endpoint (API-key authenticated) reports served
 * models with limits, live pricing, and supported features; curated
 * catalog entries fill the gaps. Layered on top of the bundled catalog by
 * `@cline/core`'s provider resolution (see catalog-live-openrouter.ts for
 * the consolidation background).
 */

import {
	includeCapability,
	isRecord,
	LIVE_REASONING_PLACEHOLDER_THINKING_BUDGET,
	parsePerTokenPrice,
	readModelId,
	readModelListPayload,
} from "./catalog-live-shared";
import type { ModelInfo } from "./types";

export const BASETEN_LIVE_MODELS_URL = "https://inference.baseten.co/v1/models";

const NON_CHAT_MODEL_ID_FRAGMENTS = ["whisper", "tts", "embedding"];

function isValidChatModel(
	rawModel: Record<string, unknown>,
	modelId: string,
): boolean {
	if (
		NON_CHAT_MODEL_ID_FRAGMENTS.some((fragment) => modelId.includes(fragment))
	) {
		return false;
	}
	return rawModel.object === "model";
}

function readSupportedFeatures(
	rawModel: Record<string, unknown>,
): readonly string[] {
	return Array.isArray(rawModel.supported_features)
		? rawModel.supported_features.filter(
				(value): value is string => typeof value === "string",
			)
		: [];
}

function generateModelDescription(
	rawModel: Record<string, unknown>,
	curated: ModelInfo | undefined,
): string | undefined {
	if (curated?.description) {
		return curated.description;
	}

	const contextWindow =
		typeof rawModel.context_length === "number"
			? rawModel.context_length
			: undefined;

	if (typeof rawModel.description === "string" && rawModel.description) {
		const technicalDetails: string[] = [];
		if (contextWindow) {
			technicalDetails.push(`${contextWindow.toLocaleString()} token context`);
		}
		if (typeof rawModel.quantization === "string" && rawModel.quantization) {
			technicalDetails.push(`${rawModel.quantization} precision`);
		}
		const features = readSupportedFeatures(rawModel);
		if (features.length > 0) {
			technicalDetails.push(`supports ${features.join(", ")}`);
		}
		return technicalDetails.length > 0
			? `${rawModel.description} (${technicalDetails.join(", ")})`
			: rawModel.description;
	}
	return undefined;
}

function readOptionalPositiveInteger(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? Math.floor(value)
		: undefined;
}

/**
 * Normalize Baseten's `/v1/models` payload into SDK `ModelInfo` records,
 * enriching live entries with curated pricing/capabilities. Malformed
 * payloads degrade to an empty result; this never throws on bad data.
 */
export function normalizeBasetenLiveModels(
	payload: unknown,
	curatedModels: Record<string, ModelInfo> = {},
): Record<string, ModelInfo> {
	const models: Record<string, ModelInfo> = {};
	for (const rawModel of readModelListPayload(payload)) {
		const modelId = readModelId(rawModel);
		if (!modelId || !isValidChatModel(rawModel, modelId)) {
			continue;
		}

		const curated = curatedModels[modelId];
		const features = readSupportedFeatures(rawModel);
		const supportsReasoning =
			features.includes("reasoning") || features.includes("reasoning_effort");
		const pricingPayload = isRecord(rawModel.pricing) ? rawModel.pricing : {};
		const contextWindow =
			readOptionalPositiveInteger(rawModel.context_length) ??
			curated?.contextWindow;

		// Baseten model APIs do not support image input.
		const capabilities: NonNullable<ModelInfo["capabilities"]> = ["tools"];
		includeCapability(
			capabilities,
			"prompt-cache",
			curated?.capabilities?.includes("prompt-cache") ?? false,
		);
		includeCapability(capabilities, "reasoning", supportsReasoning);

		models[modelId] = {
			id: modelId,
			name: typeof rawModel.name === "string" ? rawModel.name : curated?.name,
			description: generateModelDescription(rawModel, curated),
			maxTokens:
				readOptionalPositiveInteger(rawModel.max_completion_tokens) ??
				curated?.maxTokens,
			contextWindow,
			maxInputTokens: contextWindow,
			capabilities,
			pricing: {
				input:
					parsePerTokenPrice(pricingPayload.prompt) ?? curated?.pricing?.input,
				output:
					parsePerTokenPrice(pricingPayload.completion) ??
					curated?.pricing?.output,
				cacheRead: curated?.pricing?.cacheRead,
				cacheWrite: curated?.pricing?.cacheWrite,
			},
			// Placeholder budget so hosts know thinking is configurable.
			thinkingConfig: supportsReasoning
				? { maxBudget: LIVE_REASONING_PLACEHOLDER_THINKING_BUDGET }
				: undefined,
			releaseDate: curated?.releaseDate,
		};
	}
	return models;
}
