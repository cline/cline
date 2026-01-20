import { modelRegistry } from "../registry"
import type { ModelInfo } from "../types"

const PROVIDER_NAME = "nebius"

const MODELS: Record<string, ModelInfo> = {
	"Qwen/Qwen2.5-32B-Instruct-fast": {
		maxTokens: 8_192,
		contextWindow: 32_768,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.13,
		outputPrice: 0.4,
	},
	"deepseek-ai/DeepSeek-V3": {
		maxTokens: 32_000,
		contextWindow: 96_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.5,
		outputPrice: 1.5,
	},
	"deepseek-ai/DeepSeek-V3-0324-fast": {
		maxTokens: 128_000,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 2,
		outputPrice: 6,
	},
	"deepseek-ai/DeepSeek-R1": {
		maxTokens: 32_000,
		contextWindow: 96_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.8,
		outputPrice: 2.4,
	},
	"deepseek-ai/DeepSeek-R1-fast": {
		maxTokens: 32_000,
		contextWindow: 96_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 2,
		outputPrice: 6,
	},
	"deepseek-ai/DeepSeek-R1-0528": {
		maxTokens: 128_000,
		contextWindow: 163_840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.8,
		outputPrice: 2.4,
	},
	"meta-llama/Llama-3.3-70B-Instruct-fast": {
		maxTokens: 32_000,
		contextWindow: 96_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.25,
		outputPrice: 0.75,
	},
	"Qwen/Qwen2.5-Coder-32B-Instruct-fast": {
		maxTokens: 128_000,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.1,
		outputPrice: 0.3,
	},
	"Qwen/Qwen3-4B-fast": {
		maxTokens: 32_000,
		contextWindow: 41_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.08,
		outputPrice: 0.24,
	},
	"Qwen/Qwen3-30B-A3B-fast": {
		maxTokens: 32_000,
		contextWindow: 41_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.3,
		outputPrice: 0.9,
	},
	"Qwen/Qwen3-235B-A22B": {
		maxTokens: 32_000,
		contextWindow: 41_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.2,
		outputPrice: 0.6,
	},
	"openai/gpt-oss-120b": {
		maxTokens: 32766, // Quantization: fp4
		contextWindow: 131_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.15,
		outputPrice: 0.6,
	},
	"moonshotai/Kimi-K2-Instruct": {
		maxTokens: 16384, // Quantization: fp4
		contextWindow: 131_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.5,
		outputPrice: 2.4,
	},
	"Qwen/Qwen3-Coder-480B-A35B-Instruct": {
		maxTokens: 163800, // Quantization: fp8
		contextWindow: 262_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.4,
		outputPrice: 1.8,
	},
	"openai/gpt-oss-20b": {
		maxTokens: 32766, // Quantization: fp4
		contextWindow: 131_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.05,
		outputPrice: 0.2,
	},
	"zai-org/GLM-4.5": {
		maxTokens: 98304, // Quantization: fp8
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.6,
		outputPrice: 2.2,
	},
	"zai-org/GLM-4.5-Air": {
		maxTokens: 98304, // Quantization: fp8
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.2,
		outputPrice: 1.2,
	},
	"deepseek-ai/DeepSeek-R1-0528-fast": {
		maxTokens: 128000, // Quantization: fp4
		contextWindow: 164_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 2.0,
		outputPrice: 6.0,
	},
	"Qwen/Qwen3-235B-A22B-Instruct-2507": {
		maxTokens: 64000, // Quantization: fp8
		contextWindow: 262_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.2,
		outputPrice: 0.6,
	},
	"Qwen/Qwen3-30B-A3B": {
		maxTokens: 32000, // Quantization: fp8
		contextWindow: 41_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.1,
		outputPrice: 0.3,
	},
	"Qwen/Qwen3-32B": {
		maxTokens: 16384, // Quantization: fp8
		contextWindow: 41_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.1,
		outputPrice: 0.3,
	},
	"Qwen/Qwen3-32B-fast": {
		maxTokens: 16384, // Quantization: fp8
		contextWindow: 41_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.2,
		outputPrice: 0.6,
	},
}

modelRegistry.registerProvider(PROVIDER_NAME, MODELS)
