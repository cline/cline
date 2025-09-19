import type { ModelInfo } from "../model.js"

export type RooModelId = "xai/grok-code-fast-1" | "roo/code-supernova"

export const rooDefaultModelId: RooModelId = "xai/grok-code-fast-1"

export const rooModels = {
	"xai/grok-code-fast-1": {
		maxTokens: 16_384,
		contextWindow: 262_144,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"A reasoning model that is blazing fast and excels at agentic coding, accessible for free through Roo Code Cloud for a limited time. (Note: the free prompts and completions are logged by xAI and used to improve the model.)",
	},
	"roo/code-supernova": {
		maxTokens: 16_384,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"A versatile agentic coding stealth model that supports image inputs, accessible for free through Roo Code Cloud for a limited time. (Note: the free prompts and completions are logged by the model provider and used to improve the model.)",
	},
} as const satisfies Record<string, ModelInfo>
