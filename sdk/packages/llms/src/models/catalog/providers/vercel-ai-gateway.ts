/**
 * Vercel AI Gateway Provider
 */

import { getGeneratedModelsForProvider } from "../../generated-access";
import type { ModelCollection } from "../../types/index";

const VERCEL_AI_GATEWAY_MODELS =
	getGeneratedModelsForProvider("vercel-ai-gateway");

export const VERCEL_AI_GATEWAY_PROVIDER: ModelCollection = {
	provider: {
		id: "vercel-ai-gateway",
		name: "Vercel AI Gateway",
		description: "Vercel's AI gateway service",
		protocol: "openai-chat",
		baseUrl: "https://ai-gateway.vercel.sh/v1",
		defaultModelId: Object.keys(VERCEL_AI_GATEWAY_MODELS)[0],
		capabilities: ["reasoning"],
		env: ["AI_GATEWAY_API_KEY"],
		client: "openai-compatible",
	},
	models: getGeneratedModelsForProvider("vercel-ai-gateway"),
};
