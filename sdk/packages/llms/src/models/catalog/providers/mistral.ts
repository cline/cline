/**
 * Mistral Provider
 */

import type { ModelCollection } from "../../types/index";

export const MISTRAL_PROVIDER: ModelCollection = {
	provider: {
		id: "mistral",
		name: "Mistral",
		description: "Mistral AI models via AI SDK provider",
		protocol: "openai-chat",
		baseUrl: "https://api.mistral.ai/v1",
		defaultModelId: "mistral-medium-latest",
		capabilities: ["reasoning"],
		env: ["MISTRAL_API_KEY"],
		client: "ai-sdk-community",
	},
	models: {},
};
