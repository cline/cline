/**
 * Hugging Face Provider
 */

import { getGeneratedModelsForProvider } from "../../generated-access";
import type { ModelCollection, ModelInfo } from "../../types/index";

export const HUGGINGFACE_MODELS: Record<string, ModelInfo> =
	getGeneratedModelsForProvider("huggingface");

export const HUGGINGFACE_PROVIDER: ModelCollection = {
	provider: {
		id: "huggingface",
		name: "Hugging Face",
		description: "Hugging Face inference API",
		protocol: "openai-chat",
		baseUrl: "https://api-inference.huggingface.co/v1",
		defaultModelId: Object.keys(HUGGINGFACE_MODELS)[0],
		env: ["HF_TOKEN"],
		client: "openai-compatible",
	},
	models: HUGGINGFACE_MODELS,
};
