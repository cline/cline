/**
 * Live model-list normalization for OpenRouter (and the OpenRouter-backed
 * `cline` provider, which shares the same model id space).
 *
 * OpenRouter's own `/api/v1/models` endpoint is fresher than models.dev and
 * carries OpenRouter-specific metadata (descriptions, tiers, cache pricing,
 * global-endpoint support), so the live response is normalized here into the
 * SDK `ModelInfo` shape and layered on top of the bundled catalog by
 * `@cline/core`'s provider resolution. This replaces the per-host refresh
 * handlers that used to fetch and parse this endpoint independently
 * (ENG-2381), which is what let the settings picker and the task header
 * disagree about the same model (ENG-2345).
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

export const OPENROUTER_LIVE_MODELS_URL = "https://openrouter.ai/api/v1/models";

/**
 * Gemini Flash models misbehave with very large max output token values;
 * clamp to this cap (mirrors the long-standing host-side workaround).
 */
const GEMINI_FLASH_MAX_OUTPUT_TOKENS = 8_192;

/**
 * Catalog-id heuristic for Gemini Flash models as they appear in routed
 * catalogs ("google/gemini-2.5-flash", "gemini-flash-latest", ...). This is
 * intentionally id-based: live `/models` payloads carry no family metadata.
 */
export function isGeminiFlashModelId(modelId: string): boolean {
	const normalized = modelId.trim().toLowerCase();
	const isGooglePrefixedGemini = normalized.startsWith("google/gemini");
	const isDirectGemini = normalized.startsWith("gemini-");
	return (
		(isGooglePrefixedGemini || isDirectGemini) && normalized.includes("flash")
	);
}

/**
 * Stealth models are compatible with the OpenRouter API but not listed on
 * the OpenRouter website or API. They are part of the bundled OpenRouter
 * catalog (see `builtins.ts`) so they stay available even when the live
 * fetch fails.
 */
export const OPENROUTER_STEALTH_MODELS: Record<string, ModelInfo> = {
	"stealth/giga-potato": {
		id: "stealth/giga-potato",
		name: "Giga Potato",
		maxTokens: 8_192,
		contextWindow: 224_000,
		maxInputTokens: 224_000,
		capabilities: ["tools", "images", "prompt-cache"],
		pricing: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		description: "A stealth model for testing purposes. Not a real potato.",
	},
};

interface CuratedPricingOverride {
	promptCache?: boolean;
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	contextWindow?: number;
	maxTokens?: number;
}

const ANTHROPIC_SONNET_CACHE_PRICING: CuratedPricingOverride = {
	promptCache: true,
	cacheWrite: 3.75,
	cacheRead: 0.3,
};
const ANTHROPIC_HAIKU_CACHE_PRICING: CuratedPricingOverride = {
	promptCache: true,
	cacheWrite: 1.25,
	cacheRead: 0.1,
};
const ANTHROPIC_OPUS_CACHE_PRICING: CuratedPricingOverride = {
	promptCache: true,
	cacheWrite: 6.25,
	cacheRead: 0.5,
};
const ANTHROPIC_LEGACY_OPUS_CACHE_PRICING: CuratedPricingOverride = {
	promptCache: true,
	cacheWrite: 18.75,
	cacheRead: 1.5,
};

/**
 * Curated per-model corrections applied on top of the live OpenRouter
 * response. OpenRouter omits prompt-cache pricing for Anthropic models and
 * misreports a few limits; these keep the catalog usable for cost tracking
 * and context management. Formerly maintained host-side in the VS Code
 * extension's refreshOpenRouterModels handler.
 *
 * NOTE: OpenRouter reports the full 1m extended context window for recent
 * Anthropic models and we intentionally pass it through unchanged; the
 * legacy 200k restriction (with :1m opt-in variants) was dropped.
 */
const OPENROUTER_MODEL_OVERRIDES: Record<string, CuratedPricingOverride> = {
	"anthropic/claude-sonnet-4.6": ANTHROPIC_SONNET_CACHE_PRICING,
	"anthropic/claude-4.6-sonnet": ANTHROPIC_SONNET_CACHE_PRICING,
	"anthropic/claude-sonnet-4.5": ANTHROPIC_SONNET_CACHE_PRICING,
	"anthropic/claude-4.5-sonnet": ANTHROPIC_SONNET_CACHE_PRICING,
	"anthropic/claude-sonnet-4": ANTHROPIC_SONNET_CACHE_PRICING,
	"anthropic/claude-3-7-sonnet": ANTHROPIC_SONNET_CACHE_PRICING,
	"anthropic/claude-3-7-sonnet:beta": ANTHROPIC_SONNET_CACHE_PRICING,
	"anthropic/claude-3.7-sonnet": ANTHROPIC_SONNET_CACHE_PRICING,
	"anthropic/claude-3.7-sonnet:beta": ANTHROPIC_SONNET_CACHE_PRICING,
	"anthropic/claude-3.7-sonnet:thinking": ANTHROPIC_SONNET_CACHE_PRICING,
	"anthropic/claude-3.5-sonnet": ANTHROPIC_SONNET_CACHE_PRICING,
	"anthropic/claude-3.5-sonnet:beta": ANTHROPIC_SONNET_CACHE_PRICING,
	"anthropic/claude-3.5-sonnet-20240620": ANTHROPIC_SONNET_CACHE_PRICING,
	"anthropic/claude-3.5-sonnet-20240620:beta": ANTHROPIC_SONNET_CACHE_PRICING,
	"anthropic/claude-opus-4.7": ANTHROPIC_OPUS_CACHE_PRICING,
	"anthropic/claude-opus-4.6": ANTHROPIC_OPUS_CACHE_PRICING,
	"anthropic/claude-opus-4.5": ANTHROPIC_OPUS_CACHE_PRICING,
	"anthropic/claude-fable-5": {
		promptCache: true,
		input: 10,
		output: 50,
		cacheWrite: 12.5,
		cacheRead: 1,
	},
	"anthropic/claude-opus-4.1": ANTHROPIC_LEGACY_OPUS_CACHE_PRICING,
	"anthropic/claude-opus-4": ANTHROPIC_LEGACY_OPUS_CACHE_PRICING,
	"anthropic/claude-3-opus": ANTHROPIC_LEGACY_OPUS_CACHE_PRICING,
	"anthropic/claude-3-opus:beta": ANTHROPIC_LEGACY_OPUS_CACHE_PRICING,
	"anthropic/claude-haiku-4.5": ANTHROPIC_HAIKU_CACHE_PRICING,
	"anthropic/claude-4.5-haiku": ANTHROPIC_HAIKU_CACHE_PRICING,
	"anthropic/claude-3-5-haiku": ANTHROPIC_HAIKU_CACHE_PRICING,
	"anthropic/claude-3-5-haiku:beta": ANTHROPIC_HAIKU_CACHE_PRICING,
	"anthropic/claude-3-5-haiku-20241022": ANTHROPIC_HAIKU_CACHE_PRICING,
	"anthropic/claude-3-5-haiku-20241022:beta": ANTHROPIC_HAIKU_CACHE_PRICING,
	"anthropic/claude-3.5-haiku": ANTHROPIC_HAIKU_CACHE_PRICING,
	"anthropic/claude-3.5-haiku:beta": ANTHROPIC_HAIKU_CACHE_PRICING,
	"anthropic/claude-3.5-haiku-20241022": ANTHROPIC_HAIKU_CACHE_PRICING,
	"anthropic/claude-3.5-haiku-20241022:beta": ANTHROPIC_HAIKU_CACHE_PRICING,
	"anthropic/claude-3-haiku": {
		promptCache: true,
		cacheWrite: 0.3,
		cacheRead: 0.03,
	},
	"anthropic/claude-3-haiku:beta": {
		promptCache: true,
		cacheWrite: 0.3,
		cacheRead: 0.03,
	},
	// DeepSeek-specific OpenRouter pricing override; the native DeepSeek
	// provider is sourced from the bundled provider catalog.
	"deepseek/deepseek-chat": {
		promptCache: true,
		input: 0,
		cacheWrite: 0.14,
		cacheRead: 0.014,
	},
	"x-ai/grok-3-beta": {
		promptCache: true,
		cacheWrite: 0.75,
		cacheRead: 0,
	},
	"x-ai/grok-code-fast-1": {
		promptCache: true,
		cacheRead: 0.02,
	},
	// Forcing kimi-k2 to use the together provider for full context and best
	// throughput.
	"moonshotai/kimi-k2": {
		input: 1,
		output: 3,
		contextWindow: 131_000,
	},
	// OpenRouter reports 400k for gpt-5 but the input limit is actually
	// 400k-128k, and a 128k max output breaks context-window truncation.
	"openai/gpt-5": { maxTokens: 8_192, contextWindow: 272_000 },
	"openai/gpt-5-chat": { maxTokens: 8_192, contextWindow: 272_000 },
	"openai/gpt-5-mini": { maxTokens: 8_192, contextWindow: 272_000 },
	"openai/gpt-5-nano": { maxTokens: 8_192, contextWindow: 272_000 },
};

function readSupportedParameters(
	rawModel: Record<string, unknown>,
): readonly string[] {
	return Array.isArray(rawModel.supported_parameters)
		? rawModel.supported_parameters.filter(
				(value): value is string => typeof value === "string",
			)
		: [];
}

function readInputModalities(
	rawModel: Record<string, unknown>,
): readonly string[] {
	if (!isRecord(rawModel.architecture)) {
		return [];
	}
	const { modality, input_modalities } = rawModel.architecture as {
		modality?: unknown;
		input_modalities?: unknown;
	};
	const values: string[] = [];
	if (typeof modality === "string") {
		values.push(modality);
	}
	if (Array.isArray(input_modalities)) {
		values.push(
			...input_modalities.filter(
				(value): value is string => typeof value === "string",
			),
		);
	}
	return values;
}

function readOptionalPositiveInteger(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? Math.floor(value)
		: undefined;
}

function toOpenRouterModelInfo(
	rawModel: Record<string, unknown>,
	modelId: string,
): ModelInfo {
	const supportedParameters = readSupportedParameters(rawModel);
	const supportsReasoning =
		supportedParameters.includes("include_reasoning") ||
		supportedParameters.includes("reasoning");
	const inputModalities = readInputModalities(rawModel);
	const pricingPayload = isRecord(rawModel.pricing) ? rawModel.pricing : {};
	const topProvider = isRecord(rawModel.top_provider)
		? rawModel.top_provider
		: {};

	const contextWindow = readOptionalPositiveInteger(rawModel.context_length);
	const pricing: NonNullable<ModelInfo["pricing"]> = {
		input: parsePerTokenPrice(pricingPayload.prompt) ?? 0,
		output: parsePerTokenPrice(pricingPayload.completion) ?? 0,
		cacheRead: parsePerTokenPrice(pricingPayload.input_cache_read),
		cacheWrite: parsePerTokenPrice(pricingPayload.input_cache_write),
	};

	const capabilities: NonNullable<ModelInfo["capabilities"]> = [];
	includeCapability(
		capabilities,
		"images",
		inputModalities.some((value) => value.includes("image")),
	);
	includeCapability(
		capabilities,
		"tools",
		supportedParameters.includes("tools"),
	);
	includeCapability(capabilities, "reasoning", supportsReasoning);
	includeCapability(
		capabilities,
		"temperature",
		supportedParameters.includes("temperature"),
	);
	includeCapability(
		capabilities,
		"global-endpoint",
		rawModel.supports_global_endpoint === true,
	);

	const info: ModelInfo = {
		id: modelId,
		name: typeof rawModel.name === "string" ? rawModel.name : modelId,
		description:
			typeof rawModel.description === "string"
				? rawModel.description
				: undefined,
		maxTokens: readOptionalPositiveInteger(topProvider.max_completion_tokens),
		contextWindow,
		maxInputTokens: contextWindow,
		capabilities,
		pricing,
		// Placeholder budget so hosts know thinking is configurable even
		// though OpenRouter does not report a per-model budget.
		thinkingConfig: supportsReasoning
			? { maxBudget: LIVE_REASONING_PLACEHOLDER_THINKING_BUDGET }
			: undefined,
	};

	if (Array.isArray(rawModel.tiers) && rawModel.tiers.length > 0) {
		info.metadata = { tiers: rawModel.tiers };
	}

	return info;
}

function applyOpenRouterModelOverrides(info: ModelInfo): ModelInfo {
	const override = OPENROUTER_MODEL_OVERRIDES[info.id];
	const next: ModelInfo = { ...info };
	const capabilities = [...(next.capabilities ?? [])];
	const pricing: NonNullable<ModelInfo["pricing"]> = { ...next.pricing };

	if (override) {
		if (override.promptCache) {
			includeCapability(capabilities, "prompt-cache", true);
		}
		if (override.input !== undefined) {
			pricing.input = override.input;
		}
		if (override.output !== undefined) {
			pricing.output = override.output;
		}
		if (override.cacheRead !== undefined) {
			pricing.cacheRead = override.cacheRead;
		}
		if (override.cacheWrite !== undefined) {
			pricing.cacheWrite = override.cacheWrite;
		}
		if (override.contextWindow !== undefined) {
			next.contextWindow = override.contextWindow;
			next.maxInputTokens = override.contextWindow;
		}
		if (override.maxTokens !== undefined) {
			next.maxTokens = override.maxTokens;
		}
	} else if (
		(info.id.startsWith("openai/") || info.id.startsWith("google/")) &&
		pricing.cacheRead
	) {
		// OpenAI/Google models on OpenRouter support prompt caching whenever a
		// cache-read price is reported (OpenRouter charges no cache-write for
		// OpenAI models).
		includeCapability(capabilities, "prompt-cache", true);
	}

	if (isGeminiFlashModelId(info.id)) {
		next.maxTokens = Math.min(
			next.maxTokens || GEMINI_FLASH_MAX_OUTPUT_TOKENS,
			GEMINI_FLASH_MAX_OUTPUT_TOKENS,
		);
	}

	next.capabilities = capabilities;
	next.pricing = pricing;
	return next;
}

/**
 * Normalize OpenRouter's `/api/v1/models` payload into SDK `ModelInfo`
 * records. Malformed payloads or entries degrade to an empty result (the
 * bundled catalog remains the fallback); this never throws on bad data.
 */
export function normalizeOpenRouterLiveModels(
	payload: unknown,
): Record<string, ModelInfo> {
	const models: Record<string, ModelInfo> = {};
	for (const rawModel of readModelListPayload(payload)) {
		const modelId = readModelId(rawModel);
		if (!modelId) {
			continue;
		}
		models[modelId] = applyOpenRouterModelOverrides(
			toOpenRouterModelInfo(rawModel, modelId),
		);
	}
	return models;
}
