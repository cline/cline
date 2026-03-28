/**
 * LiteLLM Provider
 */

import type { ModelCollection } from "../../types/index";

export const LITELLM_PROVIDER: ModelCollection = {
	provider: {
		id: "litellm",
		name: "LiteLLM",
		description: "Self-hosted LLM proxy",
		protocol: "openai-chat",
		baseUrl: "http://localhost:4000/v1",
		defaultModelId: "gpt-4o",
		capabilities: ["prompt-cache"],
		env: ["LITELLM_API_KEY"],
	},
	models: {},
};
