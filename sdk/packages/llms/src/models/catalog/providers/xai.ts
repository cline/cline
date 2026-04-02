/**
 * xAI Models
 */

import { getGeneratedModelsForProvider } from "../../generated-access";
import type { ModelCollection, ModelInfo } from "../../types/index";

export const XAI_MODELS: Record<string, ModelInfo> =
	getGeneratedModelsForProvider("xai");

export const XAI_DEFAULT_MODEL = Object.keys(XAI_MODELS)[0];

export const XAI_PROVIDER: ModelCollection = {
	provider: {
		id: "xai",
		name: "xAI",
		description: "Creator of Grok AI assistant",
		protocol: "openai-chat",
		baseUrl: "https://api.x.ai/v1",
		defaultModelId: XAI_DEFAULT_MODEL,
		capabilities: ["reasoning"],
		env: ["XAI_API_KEY"],
		client: "openai-compatible",
	},
	models: XAI_MODELS,
};

export function getActiveXAIModels(): Record<string, ModelInfo> {
	return Object.fromEntries(
		Object.entries(XAI_MODELS).filter(
			([, info]) =>
				!info.status || info.status === "active" || info.status === "preview",
		),
	);
}
