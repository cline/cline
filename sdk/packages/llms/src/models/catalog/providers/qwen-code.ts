/**
 * Qwen Code Provider
 */

import { getGeneratedModelsForProvider } from "../../generated-access";
import type { ModelCollection, ModelInfo } from "../../types/index";

const DEFAULT_QWEN_CODE_MODEL_ID = "qwen3-coder-plus";

export const QWEN_CODE_MODELS: Record<string, ModelInfo> = {
	[DEFAULT_QWEN_CODE_MODEL_ID]: {
		id: DEFAULT_QWEN_CODE_MODEL_ID,
		name: "Qwen3 Coder Plus",
		capabilities: ["streaming", "tools", "reasoning"],
	},
	...getGeneratedModelsForProvider("qwen-code"),
};

export const QWEN_CODE_DEFAULT_MODEL =
	Object.keys(QWEN_CODE_MODELS)[0] ?? DEFAULT_QWEN_CODE_MODEL_ID;

export const QWEN_CODE_PROVIDER: ModelCollection = {
	provider: {
		id: "qwen-code",
		name: "Qwen Code",
		description: "Qwen OAuth coding models",
		protocol: "openai-chat",
		baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
		defaultModelId: QWEN_CODE_DEFAULT_MODEL,
		capabilities: ["reasoning", "oauth"],
	},
	models: QWEN_CODE_MODELS,
};
