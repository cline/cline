/**
 * Doubao Provider
 */

import { getGeneratedModelsForProvider } from "../../generated-access";
import type { ModelCollection, ModelInfo } from "../../types/index";

const DEFAULT_DOUBAO_MODEL_ID = "doubao-1-5-pro-256k-250115";

export const DOUBAO_MODELS: Record<string, ModelInfo> = {
	[DEFAULT_DOUBAO_MODEL_ID]: {
		id: DEFAULT_DOUBAO_MODEL_ID,
		name: "Doubao 1.5 Pro 256k",
		capabilities: ["streaming", "tools"],
	},
	...getGeneratedModelsForProvider("doubao"),
};

export const DOUBAO_DEFAULT_MODEL =
	Object.keys(DOUBAO_MODELS)[0] ?? DEFAULT_DOUBAO_MODEL_ID;

export const DOUBAO_PROVIDER: ModelCollection = {
	provider: {
		id: "doubao",
		name: "Doubao",
		description: "Volcengine Ark platform models",
		protocol: "openai-chat",
		baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
		defaultModelId: DOUBAO_DEFAULT_MODEL,
		env: ["DOUBAO_API_KEY"],
		client: "openai-compatible",
	},
	models: DOUBAO_MODELS,
};
