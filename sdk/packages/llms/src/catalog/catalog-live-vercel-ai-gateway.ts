/**
 * Live model-list normalization for the Vercel AI Gateway.
 *
 * The gateway's `/v1/models` endpoint reports pricing/limits that the
 * bundled models.dev catalog can lag behind; the response is normalized
 * here into SDK `ModelInfo` and layered on top of the bundled catalog by
 * `@cline/core`'s provider resolution (see catalog-live-openrouter.ts for
 * the consolidation background).
 */

import {
	enrichModelInfo,
	includeCapability,
	isRecord,
	parsePerTokenPrice,
	readModelId,
	readModelListPayload,
} from "./catalog-live-shared";
import type { ModelInfo } from "./types";

export const VERCEL_AI_GATEWAY_LIVE_MODELS_URL =
	"https://ai-gateway.vercel.sh/v1/models?include_mappings=true";

/**
 * The gateway only exposes a "reasoning" tag; derive a usable thinking
 * configuration from known model-id patterns (mirrors OpenRouter behavior
 * for the same models).
 */
function deriveThinkingConfig(
	modelId: string,
	tags: readonly string[],
): ModelInfo["thinkingConfig"] {
	if (!tags.includes("reasoning")) {
		return undefined;
	}
	if (modelId.startsWith("anthropic/claude")) {
		return { maxBudget: 8_192 };
	}
	if (modelId.includes("gemini-3")) {
		return { maxBudget: 32_767, thinkingLevel: "high" };
	}
	if (modelId.startsWith("deepseek/deepseek-r1")) {
		return { maxBudget: 8_192 };
	}
	if (modelId.startsWith("openai/o1") || modelId.startsWith("openai/o3")) {
		return { maxBudget: 32_000 };
	}
	if (modelId === "qwen/qwq-32b:free" || modelId === "qwen/qwq-32b") {
		return { maxBudget: 32_000 };
	}
	return { maxBudget: 32_000 };
}

/**
 * Recommended sampling temperature for specific model families; undefined
 * means "use the default".
 */
function deriveTemperature(modelId: string): number | undefined {
	if (
		modelId.startsWith("deepseek/deepseek-r1") ||
		modelId === "perplexity/sonar-reasoning" ||
		modelId === "qwen/qwq-32b:free" ||
		modelId === "qwen/qwq-32b"
	) {
		return 0.7;
	}
	if (modelId.startsWith("google/gemini-3")) {
		return 1.0;
	}
	return undefined;
}

function readOptionalPositiveInteger(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? Math.floor(value)
		: undefined;
}

/**
 * Normalize the Vercel AI Gateway `/v1/models` payload into SDK
 * `ModelInfo` records. Malformed payloads degrade to an empty result;
 * this never throws on bad data.
 */
export function normalizeVercelAiGatewayLiveModels(
	payload: unknown,
	curatedModels: Record<string, ModelInfo> = {},
): Record<string, ModelInfo> {
	const models: Record<string, ModelInfo> = {};
	for (const rawModel of readModelListPayload(payload)) {
		const modelId = readModelId(rawModel);
		// The endpoint also serves image/video generation, embeddings,
		// reranking, speech, transcription, and realtime-only models. Only
		// language models are valid in Cline's chat model picker. Older
		// endpoint versions omitted `type`, so keep missing types compatible.
		if (
			!modelId ||
			(typeof rawModel.type === "string" && rawModel.type !== "language")
		) {
			continue;
		}

		const pricingPayload = isRecord(rawModel.pricing) ? rawModel.pricing : {};
		const tags = Array.isArray(rawModel.tags)
			? rawModel.tags.filter(
					(value): value is string => typeof value === "string",
				)
			: [];

		const cacheRead = parsePerTokenPrice(pricingPayload.input_cache_read);
		const cacheWrite = parsePerTokenPrice(pricingPayload.input_cache_write);
		const contextWindow = readOptionalPositiveInteger(rawModel.context_window);
		const thinkingConfig = deriveThinkingConfig(modelId, tags);

		const capabilities: NonNullable<ModelInfo["capabilities"]> = [];
		includeCapability(capabilities, "tools", tags.includes("tool-use"));
		includeCapability(capabilities, "images", tags.includes("vision"));
		includeCapability(capabilities, "files", tags.includes("file-input"));
		includeCapability(
			capabilities,
			"prompt-cache",
			cacheRead !== undefined ||
				cacheWrite !== undefined ||
				tags.includes("implicit-caching") ||
				tags.includes("explicit-caching"),
		);
		includeCapability(capabilities, "reasoning", thinkingConfig !== undefined);

		models[modelId] = enrichModelInfo(curatedModels[modelId], {
			id: modelId,
			name: typeof rawModel.name === "string" ? rawModel.name : undefined,
			description:
				typeof rawModel.description === "string"
					? rawModel.description
					: undefined,
			maxTokens: readOptionalPositiveInteger(rawModel.max_tokens),
			contextWindow,
			maxInputTokens: contextWindow,
			capabilities,
			pricing: {
				input: parsePerTokenPrice(pricingPayload.input),
				output: parsePerTokenPrice(pricingPayload.output),
				cacheRead,
				cacheWrite,
			},
			thinkingConfig,
			temperature: deriveTemperature(modelId),
		});
	}
	return models;
}
