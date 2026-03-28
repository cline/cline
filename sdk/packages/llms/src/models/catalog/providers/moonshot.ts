/**
 * Moonshot Provider
 */

import { getGeneratedModelsForProvider } from "../../generated-access";
import type { ModelCollection, ModelInfo } from "../../types/index";

const DEFAULT_MOONSHOT_MODEL_ID = "kimi-k2-0905-preview";

export const MOONSHOT_MODELS: Record<string, ModelInfo> = {
	[DEFAULT_MOONSHOT_MODEL_ID]: {
		id: DEFAULT_MOONSHOT_MODEL_ID,
		name: "Kimi K2 Preview",
		capabilities: ["streaming", "tools", "reasoning"],
	},
	...getGeneratedModelsForProvider("moonshot"),
};

export const MOONSHOT_DEFAULT_MODEL =
	Object.keys(MOONSHOT_MODELS)[0] ?? DEFAULT_MOONSHOT_MODEL_ID;

export const MOONSHOT_PROVIDER: ModelCollection = {
	provider: {
		id: "moonshot",
		name: "Moonshot",
		description: "Moonshot AI Studio models",
		protocol: "openai-chat",
		baseUrl: "https://api.moonshot.ai/v1",
		defaultModelId: MOONSHOT_DEFAULT_MODEL,
		capabilities: ["reasoning", "prompt-cache"],
		env: ["MOONSHOT_API_KEY"],
	},
	models: MOONSHOT_MODELS,
};
