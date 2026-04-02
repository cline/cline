/**
 * Cline Provider
 */

import { getGeneratedModelsForProvider } from "../../generated-access";
import type { ModelCollection, ModelInfo } from "../../types/index";

export const CLINE_DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";
export const CLINE_MODELS: Record<string, ModelInfo> =
	getGeneratedModelsForProvider("vercel-ai-gateway");
export const CLINE_DEFAULT_MODELINFO = CLINE_MODELS[CLINE_DEFAULT_MODEL];

export const CLINE_PROVIDER: ModelCollection = {
	provider: {
		id: "cline",
		name: "Cline",
		description: "Cline API endpoint",
		protocol: "openai-chat",
		baseUrl: "https://api.cline.bot/api/v1",
		defaultModelId: CLINE_DEFAULT_MODEL,
		capabilities: ["reasoning", "prompt-cache", "tools", "oauth"],
		env: ["CLINE_API_KEY"],
		client: "openai-compatible",
	},
	models: CLINE_MODELS,
};
