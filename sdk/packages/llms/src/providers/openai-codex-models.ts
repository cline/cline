import type { ModelInfo } from "../catalog/types";

/**
 * The ChatGPT/Codex backend starts rejecting requests around 95% of a
 * model's advertised input cap, so every model exposed through this
 * provider gets its maxInputTokens scaled down to the effective budget.
 *
 * REF: https://github.com/openai/codex/issues/19319
 */
export const CODEX_EFFECTIVE_CONTEXT_WINDOW_PERCENT = 0.95;

/**
 * Codex serves a 400K context / 272K input / 128K output budget regardless of
 * what the OpenAI API catalog advertises for the same model (the API lists
 * 1.05M for GPT-5.5+). Mirrors the Codex CLI so context tracking stays
 * consistent across clients.
 */
const CODEX_CONTEXT_WINDOW = 400_000;
const CODEX_MAX_INPUT_TOKENS = 272_000;
const CODEX_MAX_OUTPUT_TOKENS = 128_000;

/**
 * Eligibility mirrors opencode's ChatGPT-plan rules for the shared OpenAI
 * catalog: an explicit allow/deny list plus a "newer than GPT-5.4" version
 * rule. GPT-5.4 and GPT-5.4 mini were retired for ChatGPT accounts on
 * 2026-08-31 (replacements: GPT-5.6 Terra and GPT-5.6 Luna).
 *
 * REF: https://github.com/anomalyco/opencode/blob/v2/packages/core/src/plugin/provider/openai.ts
 * REF: https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan
 */
const OPENAI_CODEX_ALLOWED_MODELS = new Set(["gpt-5.5", "gpt-5.3-codex-spark"]);
// `gpt-5.6` is the API alias for the Sol variant; Codex only serves the named
// GPT-5.6 variants.
const OPENAI_CODEX_DISALLOWED_MODELS = new Set(["gpt-5.5-pro", "gpt-5.6"]);

const GPT_VERSION_REGEX = /^gpt-(\d+)(?:\.(\d+))?/;

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
	if (OPENAI_CODEX_ALLOWED_MODELS.has(id)) return true;
	if (OPENAI_CODEX_DISALLOWED_MODELS.has(id)) return false;
	// Must be newer than 5.4; an omitted minor version is zero (e.g. gpt-6-astra)
	const match = id.match(GPT_VERSION_REGEX);
	if (!match) return false;
	const major = Number(match[1]);
	const minor = Number(match[2] ?? 0);
	return major > 5 || (major === 5 && minor > 4);
}

function toOpenAICodexModel(model: ModelInfo): ModelInfo {
	return {
		...model,
		contextWindow: model.contextWindow
			? Math.min(model.contextWindow, CODEX_CONTEXT_WINDOW)
			: model.contextWindow,
		maxInputTokens: model.maxInputTokens
			? Math.min(model.maxInputTokens, CODEX_MAX_INPUT_TOKENS) *
				CODEX_EFFECTIVE_CONTEXT_WINDOW_PERCENT
			: model.maxInputTokens,
		maxTokens: model.maxTokens
			? Math.min(model.maxTokens, CODEX_MAX_OUTPUT_TOKENS)
			: model.maxTokens,
	};
}

export function filterOpenAICodexModels(
	models: Record<string, ModelInfo>,
): Record<string, ModelInfo> {
	const result: Record<string, ModelInfo> = {};
	for (const [id, model] of Object.entries(models)) {
		if (isOpenAICodexAllowedModel(id, model)) {
			result[id] = toOpenAICodexModel(model);
		}
	}
	return result;
}
