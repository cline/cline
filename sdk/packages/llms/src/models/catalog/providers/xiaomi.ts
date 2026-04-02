import { getGeneratedModelsForProvider } from "../../generated-access";
import type { ModelCollection } from "../../types/index";

const XIAOMI_MODELS = getGeneratedModelsForProvider("xiaomi");
const XIAOMI_DEFAULT_MODEL =
	Object.keys(XIAOMI_MODELS)[0] ?? "xiaomi/mimo-v2-pro";

export const XIAOMI_PROVIDER: ModelCollection = {
	provider: {
		id: "xiaomi",
		name: "Xiaomi",
		description: "Xiaomi",
		protocol: "openai-responses",
		baseUrl: "https://api.xiaomimimo.com/v1",
		defaultModelId: XIAOMI_DEFAULT_MODEL,
		capabilities: ["prompt-cache", "tools", "reasoning"],
		env: ["XIAOMI_API_KEY"],
		client: "openai-compatible",
	},
	models: XIAOMI_MODELS,
};
