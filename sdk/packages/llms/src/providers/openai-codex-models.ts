import type { ModelInfo } from "../catalog/types";

const OPENAI_CODEX_ALLOWED_MODELS = new Set([
	"gpt-5.5",
	"gpt-5.2",
	"gpt-5.3-codex",
	"gpt-5.3-codex-spark",
	"gpt-5.4",
	"gpt-5.4-mini",
]);

function isOpenAICodexAllowedModel(id: string): boolean {
	if (OPENAI_CODEX_ALLOWED_MODELS.has(id)) return true;
	const match = id.match(/^gpt-(\d+\.\d+)/);
	return match ? Number.parseFloat(match[1]) > 5.4 : false;
}

function toOpenAICodexModel(id: string, model: ModelInfo): ModelInfo {
	if (!id.includes("gpt-5.5")) {
		return model;
	}
	return {
		...model,
		contextWindow: 400_000,
		maxInputTokens: 272_000,
		maxTokens: 128_000,
	};
}

export function filterOpenAICodexModels(
	models: Record<string, ModelInfo>,
): Record<string, ModelInfo> {
	return Object.fromEntries(
		Object.entries(models)
			.filter(([id]) => isOpenAICodexAllowedModel(id))
			.map(([id, model]) => [id, toOpenAICodexModel(id, model)]),
	);
}
