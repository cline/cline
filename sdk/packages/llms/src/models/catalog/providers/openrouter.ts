/**
 * OpenRouter Provider
 */

import { getGeneratedModelsForProvider } from "../../generated-access";
import type { ModelCollection, ModelInfo } from "../../types/index";

export const OPENROUTER_MODELS: Record<string, ModelInfo> =
	getGeneratedModelsForProvider("openrouter");
export const OPENROUTER_DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";

export const OPENROUTER_PROVIDER: ModelCollection = {
	provider: {
		id: "openrouter",
		name: "OpenRouter",
		description: "OpenRouter AI platform",
		protocol: "openai-chat",
		baseUrl: "https://openrouter.ai/api/v1",
		defaultModelId: OPENROUTER_DEFAULT_MODEL,
		capabilities: ["reasoning", "prompt-cache"],
		env: ["OPENROUTER_API_KEY"],
		client: "openai-compatible",
	},
	models: OPENROUTER_MODELS,
};
