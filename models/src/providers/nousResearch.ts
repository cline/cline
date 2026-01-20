import { modelRegistry } from "../registry"
import type { ModelInfo } from "../types"

const PROVIDER_NAME = "nousResearch"

const MODELS: Record<string, ModelInfo> = {
	"Hermes-4-405B": {
		maxOutputTokens: 8192,
		contextWindow: 128_000,
		pricing: {
			input: 0.09,
			output: 0.37,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		description:
			"This is the largest model in the Hermes 4 family, and it is the fullest expression of our design, focused on advanced reasoning and creative depth rather than optimizing inference speed or cost.",
	},
	"Hermes-4-70B": {
		maxOutputTokens: 8192,
		contextWindow: 128_000,
		pricing: {
			input: 0.05,
			output: 0.2,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		description:
			"This incarnation of Hermes 4 balances scale and size. It handles complex reasoning tasks, while staying fast and cost effective. A versatile choice for many use cases.",
	},
}

modelRegistry.registerProvider(PROVIDER_NAME, MODELS)
