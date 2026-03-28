/**
 * SambaNova Provider
 */

import { getGeneratedModelsForProvider } from "../../generated-access";
import type { ModelCollection, ModelInfo } from "../../types/index";

export const SAMBANOVA_MODELS: Record<string, ModelInfo> =
	getGeneratedModelsForProvider("sambanova");
export const SAMBANOVA_DEFAULT_MODEL = Object.keys(SAMBANOVA_MODELS)[0];

export const SAMBANOVA_PROVIDER: ModelCollection = {
	provider: {
		id: "sambanova",
		name: "SambaNova",
		description: "High-performance AI inference",
		protocol: "openai-chat",
		baseUrl: "https://api.sambanova.ai/v1",
		defaultModelId: SAMBANOVA_DEFAULT_MODEL,
		env: ["SAMBANOVA_API_KEY"],
	},
	models: SAMBANOVA_MODELS,
};
