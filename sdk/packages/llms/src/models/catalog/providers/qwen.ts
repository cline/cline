/**
 * Qwen Provider
 */

import { getGeneratedModelsForProvider } from "../../generated-access";
import type { ModelCollection, ModelInfo } from "../../types/index";

const DEFAULT_QWEN_MODEL_ID = "qwen-plus-latest";

export const QWEN_MODELS: Record<string, ModelInfo> = {
	[DEFAULT_QWEN_MODEL_ID]: {
		id: DEFAULT_QWEN_MODEL_ID,
		name: "Qwen Plus Latest",
		capabilities: ["streaming", "tools", "reasoning"],
	},
	...getGeneratedModelsForProvider("qwen"),
};

export const QWEN_DEFAULT_MODEL =
	Object.keys(QWEN_MODELS)[0] ?? DEFAULT_QWEN_MODEL_ID;

export const QWEN_PROVIDER: ModelCollection = {
	provider: {
		id: "qwen",
		name: "Qwen",
		description: "Alibaba Qwen platform models",
		protocol: "openai-chat",
		baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
		defaultModelId: QWEN_DEFAULT_MODEL,
		capabilities: ["reasoning"],
		env: ["QWEN_API_KEY"],
		client: "openai-compatible",
	},
	models: QWEN_MODELS,
};
