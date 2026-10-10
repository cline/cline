import type { ModelInfo } from "../catalog/types";

/**
 * OpenLLM (https://www.openllm.sh) local gateway helpers.
 *
 * OpenLLM serves an OpenAI-compatible Chat Completions API. Inference reuses
 * the shared openai-compatible transport; this module only owns the
 * `/v1/models` card mapping and offline alias fallback.
 */

export const OPENLLM_PROVIDER_ID = "openllm";
export const OPENLLM_DEFAULT_BASE_URL = "http://127.0.0.1:8787/v1";

/** Server-side fallback aliases. Limits and capabilities come from `/v1/models`. */
export const OPENLLM_ALIAS_MODEL_IDS = ["ultra", "plus", "lite"] as const;

/** Subset of OpenLLM's ExtendedModelCard read by Cline. Unknown fields are ignored. */
export interface OpenLlmModelCard {
	id?: unknown;
	display_name?: unknown;
	capabilities?: unknown;
	context_window?: unknown;
	max_input_tokens?: unknown;
	max_output_tokens?: unknown;
	meta?: { n_ctx?: unknown } | null;
}

function positiveInteger(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? Math.floor(value)
		: undefined;
}

function stringList(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	return value.filter((item): item is string => typeof item === "string");
}

/**
 * Map one `/v1/models` card to a Cline chat model, or `undefined` when the
 * card is not usable in the coding/chat picker.
 *
 * - Cards advertising capabilities without `chat` (embeddings, speech,
 *   transcription, image or video generation, realtime) are skipped.
 * - Cards without a capability list (for example custom aliases on older
 *   daemons) are kept with no claimed capabilities.
 * - Model ids are kept verbatim, including `provider/model` slashes.
 */
export function toOpenLlmModelInfo(
	card: OpenLlmModelCard,
): ModelInfo | undefined {
	const id = typeof card.id === "string" ? card.id.trim() : "";
	if (!id) {
		return undefined;
	}
	const advertised = stringList(card.capabilities);
	if (advertised && advertised.length > 0 && !advertised.includes("chat")) {
		return undefined;
	}

	const contextWindow =
		positiveInteger(card.context_window) ??
		positiveInteger(card.max_input_tokens) ??
		positiveInteger(card.meta?.n_ctx);
	const maxInputTokens = positiveInteger(card.max_input_tokens);
	const maxTokens = positiveInteger(card.max_output_tokens);
	const displayName =
		typeof card.display_name === "string" && card.display_name.trim()
			? card.display_name.trim()
			: id;

	const info: ModelInfo = { id, name: displayName, status: "active" };
	if (contextWindow !== undefined) info.contextWindow = contextWindow;
	if (maxInputTokens !== undefined) info.maxInputTokens = maxInputTokens;
	if (maxTokens !== undefined) info.maxTokens = maxTokens;

	if (advertised && advertised.length > 0) {
		const capabilities: NonNullable<ModelInfo["capabilities"]> = ["streaming"];
		if (advertised.includes("tools")) capabilities.push("tools");
		if (advertised.includes("vision")) capabilities.push("images");
		if (advertised.includes("reasoning")) capabilities.push("reasoning");
		info.capabilities = capabilities;
		info.modalities = {
			input: advertised.includes("vision") ? ["text", "image"] : ["text"],
			output: ["text"],
		};
	}
	return info;
}

/** Map an OpenLLM `/v1/models` payload to chat-capable Cline models. */
export function parseOpenLlmModels(
	payload: unknown,
): Record<string, ModelInfo> {
	const data =
		payload && typeof payload === "object" && !Array.isArray(payload)
			? (payload as { data?: unknown }).data
			: undefined;
	if (!Array.isArray(data)) {
		throw new Error("OpenLLM /models response is missing a data array");
	}
	const models: Record<string, ModelInfo> = {};
	for (const card of data) {
		if (!card || typeof card !== "object") {
			continue;
		}
		const info = toOpenLlmModelInfo(card as OpenLlmModelCard);
		if (info) {
			models[info.id] = info;
		}
	}
	return models;
}

/**
 * Offline fallback used when the daemon cannot be reached. Aliases carry no
 * limits or capabilities: those are only known from the live catalog.
 */
export function buildOpenLlmFallbackModels(): Record<string, ModelInfo> {
	return Object.fromEntries(
		OPENLLM_ALIAS_MODEL_IDS.map((id) => [id, { id, name: id }]),
	);
}

/** Resolve `<baseUrl>/models`, keeping any configured path prefix. */
export function resolveOpenLlmModelsUrl(baseUrl: string | undefined): string {
	const base = (baseUrl?.trim() || OPENLLM_DEFAULT_BASE_URL).replace(
		/\/+$/,
		"",
	);
	return `${base}/models`;
}
