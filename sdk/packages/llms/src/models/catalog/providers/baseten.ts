/**
 * Baseten Provider
 */

import { getGeneratedModelsForProvider } from "../../generated-access";
import type { ModelCollection } from "../../types/index";

const BASETEN_MODELS = getGeneratedModelsForProvider("baseten");

export const BASETEN_PROVIDER: ModelCollection = {
	provider: {
		id: "baseten",
		name: "Baseten",
		description: "ML inference platform",
		protocol: "openai-chat",
		baseUrl: "https://model-api.baseten.co/v1",
		defaultModelId: Object.keys(BASETEN_MODELS)[0],
		env: ["BASETEN_API_KEY"],
	},
	models: BASETEN_MODELS,
};
