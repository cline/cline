import type { ModelInfo } from "../model.js"

// Roo provider with single model
export type RooModelId = "roo/sonic"

export const rooDefaultModelId: RooModelId = "roo/sonic"

export const rooModels = {
	"roo/sonic": {
		maxTokens: 8192,
		contextWindow: 262_144,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"Stealth coding model with 262K context window, accessible for free through Roo Code Cloud for a limited time. (Note: prompts and completions are logged by the model creator and used to improve the model.)",
	},
} as const satisfies Record<string, ModelInfo>
