/**
 * AIhubmix Provider
 */

import { getGeneratedModelsForProvider } from "../../generated-access";
import type { ModelCollection } from "../../types/index";

export const AIHUBMIX_PROVIDER: ModelCollection = {
	provider: {
		id: "aihubmix",
		name: "AI Hub Mix",
		description: "AI model aggregator",
		protocol: "openai-chat",
		baseUrl: "https://api.aihubmix.com/v1",
		defaultModelId: "gpt-4o",
		env: ["AIHUBMIX_API_KEY"],
	},
	models: getGeneratedModelsForProvider("aihubmix"),
};
