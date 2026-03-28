/**
 * OpenAI Models
 */

import { getGeneratedModelsForProvider } from "../../generated-access";
import type { ModelCollection, ModelInfo } from "../../types/index";

export const OPENAI_MODELS: Record<string, ModelInfo> =
	getGeneratedModelsForProvider("openai");

export const OPENAI_DEFAULT_MODEL =
	Object.keys(OPENAI_MODELS)[0] ?? "gpt-5.3-codex";

export const OPENAI_PROVIDER: ModelCollection = {
	provider: {
		id: "openai-native",
		name: "OpenAI",
		description: "Creator of GPT and ChatGPT",
		protocol: "openai-responses",
		baseUrl: "https://api.openai.com/v1",
		defaultModelId: OPENAI_DEFAULT_MODEL,
		capabilities: ["reasoning"],
		env: ["OPENAI_API_KEY"],
	},
	models: OPENAI_MODELS,
};

export function getActiveOpenAIModels(): Record<string, ModelInfo> {
	return Object.fromEntries(
		Object.entries(OPENAI_MODELS).filter(
			([, info]) =>
				!info.status || info.status === "active" || info.status === "preview",
		),
	);
}

export function getOpenAIReasoningModels(): Record<string, ModelInfo> {
	return Object.fromEntries(
		Object.entries(OPENAI_MODELS).filter(([, info]) =>
			info.capabilities?.includes("reasoning"),
		),
	);
}
