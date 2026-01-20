import { modelRegistry } from "../registry"
import type { ModelInfo } from "../types"

const PROVIDER_NAME = "cerebras"

const MODELS: Record<string, ModelInfo> = {
	"zai-glm-4.6": {
		maxOutputTokens: 40000,
		contextWindow: 131072,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		description: "Fast general-purpose model on Cerebras (up to 1,000 tokens/s). To be deprecated soon.",
	},
	"zai-glm-4.7": {
		maxOutputTokens: 40000,
		contextWindow: 131072,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		description:
			"Highly capable general-purpose model on Cerebras (up to 1,000 tokens/s), competitive with leading proprietary models on coding tasks.",
	},
	"gpt-oss-120b": {
		maxOutputTokens: 65536,
		contextWindow: 128000,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		description: "Intelligent general purpose model with 3,000 tokens/s",
	},
	"qwen-3-235b-a22b-instruct-2507": {
		maxOutputTokens: 64000,
		contextWindow: 64000,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		description: "Intelligent model with ~1400 tokens/s",
	},
	"llama-3.3-70b": {
		maxOutputTokens: 64000,
		contextWindow: 64000,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		description: "Powerful model with ~2600 tokens/s",
	},
	"qwen-3-32b": {
		maxOutputTokens: 64000,
		contextWindow: 64000,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		description: "SOTA coding performance with ~2500 tokens/s",
	},
}

modelRegistry.registerProvider(PROVIDER_NAME, MODELS)
