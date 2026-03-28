/**
 * Groq Models
 */

import { getGeneratedModelsForProvider } from "../../generated-access";
import type { ModelCollection, ModelInfo } from "../../types/index";

export const GROQ_MODELS: Record<string, ModelInfo> =
	getGeneratedModelsForProvider("groq");

export const GROQ_DEFAULT_MODEL =
	Object.keys(GROQ_MODELS)[0] ?? "llama-3.3-70b-versatile";

export const GROQ_PROVIDER: ModelCollection = {
	provider: {
		id: "groq",
		name: "Groq",
		description: "Ultra-fast LPU inference",
		protocol: "openai-chat",
		baseUrl: "https://api.groq.com/openai/v1",
		defaultModelId: GROQ_DEFAULT_MODEL,
		env: ["GROQ_API_KEY"],
	},
	models: GROQ_MODELS,
};

export function getGroqVisionModels(): Record<string, ModelInfo> {
	return Object.fromEntries(
		Object.entries(GROQ_MODELS).filter(([, info]) =>
			info.capabilities?.includes("images"),
		),
	);
}
