/**
 * Registry of keyless per-provider live model sources.
 *
 * Each source pairs a public `/models` endpoint with a normalizer that
 * parses the payload into rich SDK `ModelInfo` records. `@cline/core`'s
 * provider resolution fetches the source for the provider being resolved
 * (when `loadLatestOnInit` is set) and layers the result on top of the
 * bundled catalog — unlike `modelsSourceUrl` (Ollama/LM Studio), which is
 * ids-only and authoritative-replace.
 *
 * Auth-required live sources (Groq, Baseten, Hicap, LiteLLM, ...) are not
 * registered here; they run through `@cline/core`'s private provider
 * model fetchers instead, reusing the same normalizers.
 */

import {
	HUGGINGFACE_LIVE_MODELS_URL,
	normalizeHuggingFaceLiveModels,
} from "./catalog-live-huggingface";
import {
	normalizeOpenRouterLiveModels,
	OPENROUTER_LIVE_MODELS_URL,
} from "./catalog-live-openrouter";
import {
	normalizeVercelAiGatewayLiveModels,
	VERCEL_AI_GATEWAY_LIVE_MODELS_URL,
} from "./catalog-live-vercel-ai-gateway";
import type { ModelInfo } from "./types";

export interface ProviderLiveModelsSource {
	/**
	 * Canonical provider id owning this source; also the id used to look up
	 * curated models passed to `normalize`.
	 */
	providerId: string;
	/** Public (keyless) endpoint listing the provider's live models. */
	url: string;
	/**
	 * Parse the endpoint payload into SDK `ModelInfo` records, optionally
	 * enriching entries from the provider's curated catalog. Must degrade
	 * to `{}` on malformed data rather than throw.
	 */
	normalize(
		payload: unknown,
		curatedModels?: Record<string, ModelInfo>,
	): Record<string, ModelInfo>;
}

const OPENROUTER_SOURCE: ProviderLiveModelsSource = {
	providerId: "openrouter",
	url: OPENROUTER_LIVE_MODELS_URL,
	normalize: (payload) => normalizeOpenRouterLiveModels(payload),
};

const VERCEL_AI_GATEWAY_SOURCE: ProviderLiveModelsSource = {
	providerId: "vercel-ai-gateway",
	url: VERCEL_AI_GATEWAY_LIVE_MODELS_URL,
	normalize: (payload) => normalizeVercelAiGatewayLiveModels(payload),
};

const HUGGINGFACE_SOURCE: ProviderLiveModelsSource = {
	providerId: "huggingface",
	url: HUGGINGFACE_LIVE_MODELS_URL,
	normalize: normalizeHuggingFaceLiveModels,
};

const PROVIDER_LIVE_MODEL_SOURCES: Record<string, ProviderLiveModelsSource> = {
	openrouter: OPENROUTER_SOURCE,
	// The `cline` provider's model list piggybacks on OpenRouter ids, so it
	// shares the OpenRouter source (and, by URL, its fetch cache).
	cline: OPENROUTER_SOURCE,
	"vercel-ai-gateway": VERCEL_AI_GATEWAY_SOURCE,
	huggingface: HUGGINGFACE_SOURCE,
};

export function getProviderLiveModelsSource(
	providerId: string,
): ProviderLiveModelsSource | undefined {
	return PROVIDER_LIVE_MODEL_SOURCES[providerId];
}
