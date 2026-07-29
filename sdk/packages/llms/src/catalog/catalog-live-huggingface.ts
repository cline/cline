/**
 * Live model-list normalization for Hugging Face's inference router.
 *
 * The router's `/v1/models` endpoint lists which models are currently
 * routable (and through which upstream providers) but carries almost no
 * metadata, so curated catalog entries are preferred when the id is known
 * and conservative defaults are used otherwise. Layered on top of the
 * bundled catalog by `@cline/core`'s provider resolution (see
 * catalog-live-openrouter.ts for the consolidation background).
 */

import { readModelId, readModelListPayload } from "./catalog-live-shared";
import type { ModelInfo } from "./types";

export const HUGGINGFACE_LIVE_MODELS_URL =
	"https://router.huggingface.co/v1/models";

const DEFAULT_MAX_TOKENS = 8_192;
const DEFAULT_CONTEXT_WINDOW = 128_000;

function readProvidersDescription(rawModel: Record<string, unknown>): string {
	const providers = Array.isArray(rawModel.providers)
		? rawModel.providers
				.map((provider) =>
					provider &&
					typeof provider === "object" &&
					typeof (provider as { provider?: unknown }).provider === "string"
						? (provider as { provider: string }).provider
						: undefined,
				)
				.filter((value): value is string => Boolean(value))
		: [];
	return `Available on providers: ${providers.length > 0 ? providers.join(", ") : "unknown"}`;
}

/**
 * Normalize the Hugging Face router `/v1/models` payload into SDK
 * `ModelInfo` records, enriching ids known to the curated catalog with
 * their curated metadata. Malformed payloads degrade to an empty result;
 * this never throws on bad data.
 */
export function normalizeHuggingFaceLiveModels(
	payload: unknown,
	curatedModels: Record<string, ModelInfo> = {},
): Record<string, ModelInfo> {
	const models: Record<string, ModelInfo> = {};
	for (const rawModel of readModelListPayload(payload)) {
		const modelId = readModelId(rawModel);
		if (!modelId) {
			continue;
		}

		const providersDescription = readProvidersDescription(rawModel);
		const curated = curatedModels[modelId];
		if (curated) {
			models[modelId] = {
				...curated,
				id: modelId,
				description: curated.description ?? providersDescription,
			};
			continue;
		}

		// The router does not report limits or pricing for unknown ids; use
		// conservative defaults so the model is still usable.
		models[modelId] = {
			id: modelId,
			name: modelId,
			description: providersDescription,
			maxTokens: DEFAULT_MAX_TOKENS,
			contextWindow: DEFAULT_CONTEXT_WINDOW,
			maxInputTokens: DEFAULT_CONTEXT_WINDOW,
			capabilities: ["tools"],
			pricing: { input: 0, output: 0 },
		};
	}
	return models;
}
