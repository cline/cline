import { modelRegistry } from "../registry"
import type { ModelInfo } from "../types"

const PROVIDER_NAME = "huggingface"

const MODELS: Record<string, ModelInfo> = {
	"openai/gpt-oss-120b": {
		contextWindow: 131_072,
		maxOutputTokens: 32766,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		description:
			"Large open-weight reasoning model for high-end desktops and data centers, built for complex coding, math, and general AI tasks.",
	},
	"openai/gpt-oss-20b": {
		contextWindow: 131_072,
		maxOutputTokens: 32766,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		description:
			"Medium open-weight reasoning model that runs on most desktops, balancing strong reasoning with broad accessibility.",
	},
	"moonshotai/Kimi-K2-Instruct": {
		contextWindow: 131_072,
		maxOutputTokens: 131_072,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		description: "Advanced reasoning model with superior performance across coding, math, and general capabilities.",
	},
	"deepseek-ai/DeepSeek-V3-0324": {
		contextWindow: 64_000,
		maxOutputTokens: 8192,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		description: "Advanced reasoning model with superior performance across coding, math, and general capabilities.",
	},
	"deepseek-ai/DeepSeek-R1": {
		contextWindow: 64_000,
		maxOutputTokens: 8192,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		description: "DeepSeek's reasoning model with step-by-step thinking capabilities.",
	},
	"deepseek-ai/DeepSeek-R1-0528": {
		contextWindow: 64_000,
		maxOutputTokens: 64_000,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		description: "DeepSeek's reasoning model's latest version with step-by-step thinking capabilities",
	},
	"meta-llama/Llama-3.1-8B-Instruct": {
		contextWindow: 128_000,
		maxOutputTokens: 8192,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		description: "Efficient 8B parameter Llama model for general-purpose tasks.",
	},
}

modelRegistry.registerProvider(PROVIDER_NAME, MODELS)
