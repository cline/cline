/**
 * Z.AI Models
 */

import { getGeneratedModelsForProvider } from "../../generated-access";
import type { ModelCollection, ModelInfo } from "../../types/index";

export const ZAI_MODELS: Record<string, ModelInfo> =
	getGeneratedModelsForProvider("zai");

export const ZAI_DEFAULT_MODEL = Object.keys(ZAI_MODELS)[0];

export const ZAI_PROVIDER: ModelCollection = {
	provider: {
		id: "zai",
		name: "Z.AI",
		description: "Z.AI's family of LLMs",
		protocol: "openai-chat",
		baseUrl: "https://api.z.ai/api/paas/v4",
		defaultModelId: ZAI_DEFAULT_MODEL,
		capabilities: ["reasoning"],
		env: ["ZHIPU_API_KEY"],
	},
	models: ZAI_MODELS,
};
