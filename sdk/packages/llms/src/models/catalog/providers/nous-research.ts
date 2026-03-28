/**
 * Nous Research Provider
 */

import type { ModelCollection, ModelInfo } from "../../types/index";

export const NOUS_RESEARCH_MODELS: Record<string, ModelInfo> = {};
export const NOUS_RESEARCH_DEFAULT_MODEL = "DeepHermes-3-Llama-3-3-70B-Preview";

export const NOUS_RESEARCH_PROVIDER: ModelCollection = {
	provider: {
		id: "nousResearch",
		name: "Nous Research",
		description: "Open-source AI research lab",
		protocol: "openai-chat",
		baseUrl: "https://inference-api.nousresearch.com/v1",
		defaultModelId: NOUS_RESEARCH_DEFAULT_MODEL,
		env: ["NOUS_RESEARCH_API_KEY", "NOUSRESEARCH_API_KEY"],
	},
	models: NOUS_RESEARCH_MODELS,
};
