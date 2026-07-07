import type { ModelInfo } from "../catalog/types";

// REF: https://github.com/openai/codex/issues/19319
export const CODEX_EFFECTIVE_CONTEXT_WINDOW_PERCENT = 0.95;

const GPT_VERSION_REGEX = /^gpt-(\d+\.\d+)/;

function isOpenAICodexAllowedModel(id: string, model: ModelInfo): boolean {
	// O, pro, and nano variants are not supported
	const family = model.family;
	if (
		family &&
		(family.startsWith("o") ||
			family.includes("pro") ||
			family.includes("nano"))
	) {
		return false;
	}
	// Must be newer than 5.3
	const match = id.match(GPT_VERSION_REGEX);
	return match ? Number.parseFloat(match[1]) > 5.3 : false;
}

function toOpenAICodexModel(id: string, model: ModelInfo): ModelInfo {
	// The ChatGPT/Codex backend enforces lower GPT-5.5 limits than the
	// generated OpenAI API catalog. Requests start failing around 95% of
	// the 272K input cap, so expose the effective input budget here.
	if (id.includes("gpt-5.5")) {
		return {
			...model,
			contextWindow: 400_000,
			maxInputTokens: 272_000 * CODEX_EFFECTIVE_CONTEXT_WINDOW_PERCENT,
			maxTokens: 128_000,
		};
	}
	return {
		...model,
		maxInputTokens: model.maxInputTokens
			? model.maxInputTokens * CODEX_EFFECTIVE_CONTEXT_WINDOW_PERCENT
			: model.maxInputTokens,
	};
}

export function filterOpenAICodexModels(
	models: Record<string, ModelInfo>,
): Record<string, ModelInfo> {
	const result: Record<string, ModelInfo> = {};
	for (const [id, model] of Object.entries(models)) {
		if (isOpenAICodexAllowedModel(id, model)) {
			result[id] = toOpenAICodexModel(id, model);
		}
	}
	return result;
}
