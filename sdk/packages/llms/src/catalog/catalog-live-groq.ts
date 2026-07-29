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

const DEFAULT_MAX_TOKENS = 8_192;
const DEFAULT_CONTEXT_WINDOW = 8_192;

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

function generateModelDescription(
	rawModel: Record<string, unknown>,
	modelId: string,
	contextWindow: number,
	curated: ModelInfo | undefined,
): string {
	if (curated?.description) {
		return curated.description;
	}
	const ownedBy =
		typeof rawModel.owned_by === "string" ? rawModel.owned_by : "Unknown";
	if (modelId.includes("compound")) {
		return `${ownedBy}'s ${modelId} model with ${contextWindow.toLocaleString()} token context window - Advanced compound architecture`;
	}
	return `${ownedBy} model with ${contextWindow.toLocaleString()} token context window`;
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
			curated?.contextWindow ??
			DEFAULT_CONTEXT_WINDOW;

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
			name: curated?.name ?? modelId,
			description: generateModelDescription(
				rawModel,
				modelId,
				contextWindow,
				curated,
			),
			maxTokens:
				readOptionalPositiveInteger(rawModel.max_completion_tokens) ??
				curated?.maxTokens ??
				DEFAULT_MAX_TOKENS,
			contextWindow,
			maxInputTokens: contextWindow,
			capabilities,
			pricing: {
				input: curated?.pricing?.input ?? 0,
				output: curated?.pricing?.output ?? 0,
				cacheRead: curated?.pricing?.cacheRead ?? 0,
				cacheWrite: curated?.pricing?.cacheWrite ?? 0,
			},
			releaseDate: curated?.releaseDate,
		};
	}
	return models;
}
