import { getGeneratedModelsForProvider } from "../../generated-access";
import type { ModelCollection } from "../../types/index";

const KILO_MODELS = getGeneratedModelsForProvider("kilo");

export const KILO_PROVIDER: ModelCollection = {
	provider: {
		id: "kilo",
		name: "Kilo Gateway",
		description: "Kilo Gateway",
		protocol: "openai-responses",
		baseUrl: "https://api.kilo.ai/api/gateway",
		defaultModelId: "gpt-4o",
		capabilities: ["prompt-cache", "reasoning", "tools"],
		env: ["KILO_GATEWAY_API_KEY"],
		client: "openai-compatible",
	},
	models: KILO_MODELS,
};
