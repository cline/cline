/**
 * Together AI Models
 */

import { getGeneratedModelsForProvider } from "../../generated-access";
import type { ModelCollection, ModelInfo } from "../../types/index";

export const TOGETHER_MODELS: Record<string, ModelInfo> =
	getGeneratedModelsForProvider("together");

export const TOGETHER_DEFAULT_MODEL =
	Object.keys(TOGETHER_MODELS)[0] ??
	"meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo";

export const TOGETHER_PROVIDER: ModelCollection = {
	provider: {
		id: "together",
		name: "Together AI",
		description: "Fast inference for open-source models",
		protocol: "openai-chat",
		baseUrl: "https://api.together.xyz/v1",
		defaultModelId: TOGETHER_DEFAULT_MODEL,
		capabilities: ["reasoning"],
		env: ["TOGETHER_API_KEY"],
	},
	models: TOGETHER_MODELS,
};

export function getTogetherLlamaModels(): Record<string, ModelInfo> {
	return Object.fromEntries(
		Object.entries(TOGETHER_MODELS).filter(([id]) =>
			id.toLowerCase().includes("llama"),
		),
	);
}
