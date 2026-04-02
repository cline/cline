import { getGeneratedModelsForProvider } from "../../generated-access";
import type { ModelCollection } from "../../types/index";

const WANDB_MODELS = getGeneratedModelsForProvider("wandb");

export const WANDB_PROVIDER: ModelCollection = {
	provider: {
		id: "wandb",
		name: "Wandb",
		description: "Weights & Biases",
		protocol: "openai-chat",
		baseUrl: "https://api.inference.wandb.ai/v1",
		defaultModelId: Object.keys(WANDB_MODELS)[0],
		capabilities: ["reasoning", "prompt-cache", "tools"],
		env: ["WANDB_API_KEY"],
		client: "openai-compatible",
	},
	models: WANDB_MODELS,
};
