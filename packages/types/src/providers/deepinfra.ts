import type { ModelInfo } from "../model.js"

// Default fallback values for DeepInfra when model metadata is not yet loaded.
export const deepInfraDefaultModelId = "Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo"

export const deepInfraDefaultModelInfo: ModelInfo = {
	maxTokens: 16384,
	contextWindow: 262144,
	supportsImages: false,
	supportsPromptCache: false,
	inputPrice: 0.3,
	outputPrice: 1.2,
	description: "Qwen 3 Coder 480B A35B Instruct Turbo model, 256K context.",
}
