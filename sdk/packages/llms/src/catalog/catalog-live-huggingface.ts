/**
 * Live model-list normalization for Hugging Face's inference router.
 *
 * The router's `/v1/models` endpoint lists which models are currently
 * routable (and through which upstream providers) but carries almost no
 * metadata, so its availability data is layered onto richer catalog entries.
 * Layered on top of the
 * bundled catalog by `@cline/core`'s provider resolution (see
 * catalog-live-openrouter.ts for the consolidation background).
 */

import {
	enrichModelInfo,
	includeCapability,
	isRecord,
	readModelId,
	readModelListPayload,
} from "./catalog-live-shared";
import type { ModelInfo } from "./types";

export const HUGGINGFACE_LIVE_MODELS_URL =
	"https://router.huggingface.co/v1/models";

function readProviders(rawModel: Record<string, unknown>): string[] {
	return Array.isArray(rawModel.providers)
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
}

function readInputModalities(rawModel: Record<string, unknown>): string[] {
	if (!isRecord(rawModel.architecture)) {
		return [];
	}
	return Array.isArray(rawModel.architecture.input_modalities)
		? rawModel.architecture.input_modalities.filter(
				(value): value is string => typeof value === "string",
			)
		: [];
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

		const providers = readProviders(rawModel);
		const capabilities: NonNullable<ModelInfo["capabilities"]> = [];
		includeCapability(
			capabilities,
			"images",
			readInputModalities(rawModel).includes("image"),
		);

		// The router does not report limits or pricing. Keep those fields
		// sparse so this availability layer cannot overwrite richer bundled or
		// models.dev facts. Always emit capabilities (even `[]`) so source-only
		// text models do not inherit the extension adapter's legacy
		// supportsImages=true default.
		models[modelId] = enrichModelInfo(curatedModels[modelId], {
			id: modelId,
			capabilities,
			metadata: { availableProviders: providers },
		});
	}
	return models;
}
