import { modelRegistry } from "../registry"
import type { ModelInfo } from "../types"

const PROVIDER_NAME = "nebius"

const MODELS: Record<string, ModelInfo> = {
	"Qwen/Qwen2.5-32B-Instruct-fast": {
		maxOutputTokens: 8_192,
		contextWindow: 32_768,
		pricing: {
			input: 0.13,
			output: 0.4,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"deepseek-ai/DeepSeek-V3": {
		maxOutputTokens: 32_000,
		contextWindow: 96_000,
		pricing: {
			input: 0.5,
			output: 1.5,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"deepseek-ai/DeepSeek-V3-0324-fast": {
		maxOutputTokens: 128_000,
		contextWindow: 128_000,
		pricing: {
			input: 2,
			output: 6,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"deepseek-ai/DeepSeek-R1": {
		maxOutputTokens: 32_000,
		contextWindow: 96_000,
		pricing: {
			input: 0.8,
			output: 2.4,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"deepseek-ai/DeepSeek-R1-fast": {
		maxOutputTokens: 32_000,
		contextWindow: 96_000,
		pricing: {
			input: 2,
			output: 6,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"deepseek-ai/DeepSeek-R1-0528": {
		maxOutputTokens: 128_000,
		contextWindow: 163_840,
		pricing: {
			input: 0.8,
			output: 2.4,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"meta-llama/Llama-3.3-70B-Instruct-fast": {
		maxOutputTokens: 32_000,
		contextWindow: 96_000,
		pricing: {
			input: 0.25,
			output: 0.75,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"Qwen/Qwen2.5-Coder-32B-Instruct-fast": {
		maxOutputTokens: 128_000,
		contextWindow: 128_000,
		pricing: {
			input: 0.1,
			output: 0.3,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"Qwen/Qwen3-4B-fast": {
		maxOutputTokens: 32_000,
		contextWindow: 41_000,
		pricing: {
			input: 0.08,
			output: 0.24,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"Qwen/Qwen3-30B-A3B-fast": {
		maxOutputTokens: 32_000,
		contextWindow: 41_000,
		pricing: {
			input: 0.3,
			output: 0.9,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"Qwen/Qwen3-235B-A22B": {
		maxOutputTokens: 32_000,
		contextWindow: 41_000,
		pricing: {
			input: 0.2,
			output: 0.6,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"openai/gpt-oss-120b": {
		maxOutputTokens: 32766, // Quantization: fp4
		contextWindow: 131_000,
		pricing: {
			input: 0.15,
			output: 0.6,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"moonshotai/Kimi-K2-Instruct": {
		maxOutputTokens: 16384, // Quantization: fp4
		contextWindow: 131_000,
		pricing: {
			input: 0.5,
			output: 2.4,
		},
		capabilities: {
			images: false,
			promptCache: true,
		},
	},
	"Qwen/Qwen3-Coder-480B-A35B-Instruct": {
		maxOutputTokens: 163800, // Quantization: fp8
		contextWindow: 262_000,
		pricing: {
			input: 0.4,
			output: 1.8,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"openai/gpt-oss-20b": {
		maxOutputTokens: 32766, // Quantization: fp4
		contextWindow: 131_000,
		pricing: {
			input: 0.05,
			output: 0.2,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"zai-org/GLM-4.5": {
		maxOutputTokens: 98304, // Quantization: fp8
		contextWindow: 128_000,
		pricing: {
			input: 0.6,
			output: 2.2,
		},
		capabilities: {
			images: false,
			promptCache: true,
		},
	},
	"zai-org/GLM-4.5-Air": {
		maxOutputTokens: 98304, // Quantization: fp8
		contextWindow: 128_000,
		pricing: {
			input: 0.2,
			output: 1.2,
		},
		capabilities: {
			images: false,
			promptCache: true,
		},
	},
	"deepseek-ai/DeepSeek-R1-0528-fast": {
		maxOutputTokens: 128000, // Quantization: fp4
		contextWindow: 164_000,
		pricing: {
			input: 2.0,
			output: 6.0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"Qwen/Qwen3-235B-A22B-Instruct-2507": {
		maxOutputTokens: 64000, // Quantization: fp8
		contextWindow: 262_000,
		pricing: {
			input: 0.2,
			output: 0.6,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"Qwen/Qwen3-30B-A3B": {
		maxOutputTokens: 32000, // Quantization: fp8
		contextWindow: 41_000,
		pricing: {
			input: 0.1,
			output: 0.3,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"Qwen/Qwen3-32B": {
		maxOutputTokens: 16384, // Quantization: fp8
		contextWindow: 41_000,
		pricing: {
			input: 0.1,
			output: 0.3,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
	"Qwen/Qwen3-32B-fast": {
		maxOutputTokens: 16384, // Quantization: fp8
		contextWindow: 41_000,
		pricing: {
			input: 0.2,
			output: 0.6,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
	},
}

modelRegistry.registerProvider(PROVIDER_NAME, MODELS)
