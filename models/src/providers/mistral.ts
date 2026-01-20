import { modelRegistry } from "../registry"
import type { ModelInfo } from "../types"

const PROVIDER_NAME = "mistral"

const MODELS: Record<string, ModelInfo> = {
	"devstral-2512": {
		contextWindow: 256_000,
		maxOutputTokens: 256_000,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"labs-devstral-small-2512": {
		contextWindow: 256_000,
		maxOutputTokens: 256_000,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"mistral-large-2512": {
		contextWindow: 256_000,
		maxOutputTokens: 256_000,
		pricing: {
			input: 0.5,
			output: 1.5,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"ministral-14b-2512": {
		contextWindow: 256_000,
		maxOutputTokens: 256_000,
		pricing: {
			input: 0.2,
			output: 0.2,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"mistral-large-2411": {
		contextWindow: 128_000,
		maxOutputTokens: 128_000,
		pricing: {
			input: 2.0,
			output: 6.0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"pixtral-large-2411": {
		contextWindow: 131_000,
		maxOutputTokens: 131_000,
		pricing: {
			input: 2.0,
			output: 6.0,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
	},
	"ministral-3b-2410": {
		contextWindow: 128_000,
		maxOutputTokens: 128_000,
		pricing: {
			input: 0.04,
			output: 0.04,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"ministral-8b-2410": {
		contextWindow: 128_000,
		maxOutputTokens: 128_000,
		pricing: {
			input: 0.1,
			output: 0.1,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"mistral-small-latest": {
		contextWindow: 128_000,
		maxOutputTokens: 128_000,
		pricing: {
			input: 0.1,
			output: 0.3,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
	},
	"mistral-medium-latest": {
		contextWindow: 128_000,
		maxOutputTokens: 128_000,
		pricing: {
			input: 0.4,
			output: 2.0,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
	},
	"mistral-small-2501": {
		contextWindow: 32_000,
		maxOutputTokens: 32_000,
		pricing: {
			input: 0.1,
			output: 0.3,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"pixtral-12b-2409": {
		contextWindow: 128_000,
		maxOutputTokens: 128_000,
		pricing: {
			input: 0.15,
			output: 0.15,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
	},
	"open-mistral-nemo-2407": {
		contextWindow: 128_000,
		maxOutputTokens: 128_000,
		pricing: {
			input: 0.15,
			output: 0.15,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"open-codestral-mamba": {
		contextWindow: 256_000,
		maxOutputTokens: 256_000,
		pricing: {
			input: 0.15,
			output: 0.15,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"codestral-2501": {
		contextWindow: 256_000,
		maxOutputTokens: 256_000,
		pricing: {
			input: 0.3,
			output: 0.9,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"devstral-small-2505": {
		contextWindow: 131_072,
		maxOutputTokens: 128_000,
		pricing: {
			input: 0.1,
			output: 0.3,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"devstral-medium-latest": {
		contextWindow: 131_072,
		maxOutputTokens: 128_000,
		pricing: {
			input: 0.4,
			output: 2.0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
}

modelRegistry.registerProvider(PROVIDER_NAME, MODELS)
