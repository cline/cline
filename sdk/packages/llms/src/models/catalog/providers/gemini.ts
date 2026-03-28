/**
 * Google Gemini Models
 */

import { getGeneratedModelsForProvider } from "../../generated-access";
import type { ModelCollection, ModelInfo } from "../../types/index";

export const GEMINI_MODELS: Record<string, ModelInfo> =
	getGeneratedModelsForProvider("gemini");

export const GEMINI_DEFAULT_MODEL =
	Object.keys(GEMINI_MODELS)[0] ?? "gemini-3-pro";

export const GEMINI_PROVIDER: ModelCollection = {
	provider: {
		id: "gemini",
		name: "Google Gemini",
		description: "Google Gemini API",
		protocol: "gemini",
		baseUrl: "https://generativelanguage.googleapis.com",
		defaultModelId: GEMINI_DEFAULT_MODEL,
		capabilities: ["reasoning", "prompt-cache"],
		env: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
	},
	models: GEMINI_MODELS,
};

export function getActiveGeminiModels(): Record<string, ModelInfo> {
	return Object.fromEntries(
		Object.entries(GEMINI_MODELS).filter(
			([, info]) =>
				!info.status || info.status === "active" || info.status === "preview",
		),
	);
}

export function getGeminiThinkingModels(): Record<string, ModelInfo> {
	return Object.fromEntries(
		Object.entries(GEMINI_MODELS).filter(([, info]) =>
			info.capabilities?.includes("reasoning"),
		),
	);
}
