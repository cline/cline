/**
 * Fireworks AI Models
 */

import { getGeneratedModelsForProvider } from "../../generated-access";
import type { ModelCollection, ModelInfo } from "../../types/index";

export const FIREWORKS_MODELS: Record<string, ModelInfo> =
	getGeneratedModelsForProvider("fireworks");

export const FIREWORKS_DEFAULT_MODEL =
	Object.keys(FIREWORKS_MODELS)[0] ??
	"accounts/fireworks/models/llama-v3p1-8b-instruct";

export const FIREWORKS_PROVIDER: ModelCollection = {
	provider: {
		id: "fireworks",
		name: "Fireworks AI",
		description: "High-performance inference platform",
		protocol: "openai-chat",
		baseUrl: "https://api.fireworks.ai/inference/v1",
		defaultModelId: FIREWORKS_DEFAULT_MODEL,
		env: ["FIREWORKS_API_KEY"],
		client: "openai-compatible",
	},
	models: FIREWORKS_MODELS,
};

export function getFireworksFunctionModels(): Record<string, ModelInfo> {
	return Object.fromEntries(
		Object.entries(FIREWORKS_MODELS).filter(([, info]) =>
			info.capabilities?.includes("tools"),
		),
	);
}
