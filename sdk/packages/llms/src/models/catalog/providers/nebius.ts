/**
 * Nebius Provider
 */

import { getGeneratedModelsForProvider } from "../../generated-access";
import type { ModelCollection, ModelInfo } from "../../types/index";

export const NEBIUS_MODELS: Record<string, ModelInfo> =
	getGeneratedModelsForProvider("nebius");
export const NEBIUS_DEFAULT_MODEL =
	Object.keys(NEBIUS_MODELS)[0] || "meta-llama/Meta-Llama-3.1-70B-Instruct";

export const NEBIUS_PROVIDER: ModelCollection = {
	provider: {
		id: "nebius",
		name: "Nebius",
		description: "European cloud AI infrastructure",
		protocol: "openai-chat",
		baseUrl: "https://api.studio.nebius.ai/v1",
		defaultModelId: NEBIUS_DEFAULT_MODEL,
		env: ["NEBIUS_API_KEY"],
		client: "openai-compatible",
	},
	models: NEBIUS_MODELS,
};
