import type { ModelInfo } from "../catalog/types";
import { withAstra } from "./openai-astra";

/**
 * The ChatGPT/Codex backend starts rejecting requests around 95% of a
 * model's advertised input cap, so every model exposed through this
 * provider gets its maxInputTokens scaled down to the effective budget.
 *
 * REF: https://github.com/openai/codex/issues/19319
 */
export const CODEX_EFFECTIVE_CONTEXT_WINDOW_PERCENT = 0.95;

// Accept integer majors while preserving the original numeric > 5.3 threshold.
const GPT_VERSION_REGEX = /^gpt-(\d+)(?:\.(\d+))?(?=-|$)/;
const UNSUPPORTED_VARIANT_REGEX = /(?:^|[-_.])(pro|nano)(?:[-_.]|$)/i;

function isOpenAICodexAllowedModel(id: string, model: ModelInfo): boolean {
	// O, pro, and nano variants are not supported
	const family = model.family;
	if (
		UNSUPPORTED_VARIANT_REGEX.test(id) ||
		UNSUPPORTED_VARIANT_REGEX.test(model.id) ||
		(family &&
			(family.startsWith("o") ||
				family.includes("pro") ||
				family.includes("nano")))
	) {
		return false;
	}
	const match = id.match(GPT_VERSION_REGEX);
	if (!match) return false;
	const version = Number(`${match[1]}.${match[2] ?? 0}`);
	return Number.isSafeInteger(Number(match[1])) && version > 5.3;
}

/**
 * Applies the effective input budget to allowed GPT models. GPT-5.5
 * additionally gets hardcoded limits because the ChatGPT/Codex backend
 * enforces a 272K input / 128K output cap that is lower than what the
 * generated OpenAI API catalog reports.
 */
function toOpenAICodexModel(id: string, model: ModelInfo): ModelInfo {
	if (/^gpt-5\.5(?:-|$)/.test(id)) {
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
	for (const [id, model] of Object.entries(withAstra(models))) {
		if (isOpenAICodexAllowedModel(id, model)) {
			result[id] = toOpenAICodexModel(id, model);
		}
	}
	return result;
}
