/**
 * Cerebras Provider
 */

import { getGeneratedModelsForProvider } from "../../generated-access";
import type { ModelCollection, ModelInfo } from "../../types/index";

export const CEREBRAS_MODELS: Record<string, ModelInfo> =
	getGeneratedModelsForProvider("cerebras");
export const CEREBRAS_DEFAULT_MODEL =
	Object.keys(CEREBRAS_MODELS)[0] ?? "llama3.1-70b";

export const CEREBRAS_PROVIDER: ModelCollection = {
	provider: {
		id: "cerebras",
		name: "Cerebras",
		description: "Fast inference on Cerebras wafer-scale chips",
		protocol: "openai-chat",
		baseUrl: "https://api.cerebras.ai/v1",
		defaultModelId: CEREBRAS_DEFAULT_MODEL,
		env: ["CEREBRAS_API_KEY"],
		client: "openai-compatible",
	},
	models: CEREBRAS_MODELS,
};
