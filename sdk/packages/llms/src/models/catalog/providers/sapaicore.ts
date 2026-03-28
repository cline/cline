/**
 * SAP AI Core Provider
 */

import { getGeneratedModelsForProvider } from "../../generated-access";
import type { ModelCollection, ModelInfo } from "../../types/index";

const DEFAULT_SAP_AI_CORE_MODEL_ID = "anthropic--claude-3.5-sonnet";

export const SAP_AI_CORE_MODELS: Record<string, ModelInfo> = {
	[DEFAULT_SAP_AI_CORE_MODEL_ID]: {
		id: DEFAULT_SAP_AI_CORE_MODEL_ID,
		name: "Claude 3.5 Sonnet (SAP AI Core)",
		capabilities: ["streaming", "tools", "reasoning", "prompt-cache"],
	},
	...getGeneratedModelsForProvider("sapaicore"),
};

export const SAP_AI_CORE_DEFAULT_MODEL =
	Object.keys(SAP_AI_CORE_MODELS)[0] ?? DEFAULT_SAP_AI_CORE_MODEL_ID;

export const SAP_AI_CORE_PROVIDER: ModelCollection = {
	provider: {
		id: "sapaicore",
		name: "SAP AI Core",
		description: "SAP AI Core inference and orchestration platform",
		protocol: "openai-chat",
		baseUrl: "",
		defaultModelId: SAP_AI_CORE_DEFAULT_MODEL,
		capabilities: ["reasoning", "prompt-cache"],
		env: ["AICORE_SERVICE_KEY", "VCAP_SERVICES"],
	},
	models: SAP_AI_CORE_MODELS,
};
