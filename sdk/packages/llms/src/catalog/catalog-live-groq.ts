/**
 * Live model-list normalization for Groq.
 *
 * Groq's `/openai/v1/models` endpoint (API-key authenticated) reports which
 * models are currently served plus basic limits, but no pricing or
 * capability metadata — so live entries are enriched from the curated
 * catalog. Layered on top of the bundled catalog by `@cline/core`'s
 * provider resolution (see catalog-live-openrouter.ts for the
 * consolidation background).
 */

import {
	includeCapability,
	readModelId,
	readModelListPayload,
} from "./catalog-live-shared";
import type { ModelInfo } from "./types";

export const GROQ_LIVE_MODELS_URL = "https://api.groq.com/openai/v1/models";

const NON_CHAT_MODEL_ID_FRAGMENTS = [
	"whisper",
	"tts",
	"guard",
	"embedding",
	"moderation",
	"allam",
];

function isValidChatModel(
	rawModel: Record<string, unknown>,
	modelId: string,
): boolean {
	if (Object.hasOwn(rawModel, "active") && rawModel.active === false) {
		return false;
	}
	if (
		NON_CHAT_MODEL_ID_FRAGMENTS.some((fragment) => modelId.includes(fragment))
	) {
		return false;
	}
	return rawModel.object === "model";
}

function detectImageSupport(
	modelId: string,
	curated: ModelInfo | undefined,
): boolean {
	if (curated?.capabilities) {
		return curated.capabilities.includes("images");
	}
	const normalized = modelId.toLowerCase();
	return (
		normalized.includes("vision") ||
		normalized.includes("maverick") ||
		normalized.includes("scout")
	);
}

function readModelDescription(
	rawModel: Record<string, unknown>,
	curated: ModelInfo | undefined,
): string | undefined {
	return typeof rawModel.description === "string"
		? rawModel.description
		: curated?.description;
}

function readOptionalPositiveInteger(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? Math.floor(value)
		: undefined;
}

/**
 * Normalize Groq's `/openai/v1/models` payload into SDK `ModelInfo`
 * records, enriching live entries with curated pricing/capabilities.
 * Malformed payloads degrade to an empty result; this never throws on
 * bad data.
 */
export function normalizeGroqLiveModels(
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
		const contextWindow =
			readOptionalPositiveInteger(rawModel.context_window) ??
			curated?.contextWindow;

		const capabilities: NonNullable<ModelInfo["capabilities"]> = ["tools"];
		includeCapability(
			capabilities,
			"images",
			detectImageSupport(modelId, curated),
		);
		includeCapability(
			capabilities,
			"prompt-cache",
			curated?.capabilities?.includes("prompt-cache") ?? false,
		);
		includeCapability(
			capabilities,
			"reasoning",
			curated?.capabilities?.includes("reasoning") ?? false,
		);

		models[modelId] = {
			id: modelId,
			name: curated?.name,
			description: readModelDescription(rawModel, curated),
			maxTokens:
				readOptionalPositiveInteger(rawModel.max_completion_tokens) ??
				curated?.maxTokens,
			contextWindow,
			maxInputTokens: contextWindow,
			capabilities,
			pricing: {
				input: curated?.pricing?.input,
				output: curated?.pricing?.output,
				cacheRead: curated?.pricing?.cacheRead,
				cacheWrite: curated?.pricing?.cacheWrite,
			},
			releaseDate: curated?.releaseDate,
		};
	}
	return models;
}
