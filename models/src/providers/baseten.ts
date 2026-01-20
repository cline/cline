import { modelRegistry } from "../registry"
import type { ModelInfo } from "../types"

const PROVIDER_NAME = "baseten"

const MODELS: Record<string, ModelInfo> = {
	"zai-org/GLM-4.6": {
		maxOutputTokens: 200_000,
		contextWindow: 200_000,
		pricing: {
			input: 0.6,
			output: 2.2,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		reasoning: {
			enabled: true,
		},
		description: "Frontier open model with advanced agentic, reasoning and coding capabilities",
	},
	"moonshotai/Kimi-K2-Thinking": {
		maxOutputTokens: 163_800,
		contextWindow: 262_000,
		pricing: {
			input: 0.6,
			output: 2.5,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		reasoning: {
			enabled: true,
		},
		description: "Kimi K2 Thinking - A model with enhanced reasoning capabilities from Kimi K2",
	},
	"deepseek-ai/DeepSeek-R1": {
		maxOutputTokens: 131_072,
		contextWindow: 163_840,
		pricing: {
			input: 2.55,
			output: 5.95,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		reasoning: {
			enabled: true,
		},
		description: "DeepSeek's first-generation reasoning model",
	},
	"deepseek-ai/DeepSeek-R1-0528": {
		maxOutputTokens: 131_072,
		contextWindow: 163_840,
		pricing: {
			input: 2.55,
			output: 5.95,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		reasoning: {
			enabled: true,
		},
		description: "The latest revision of DeepSeek's first-generation reasoning model",
	},
	"deepseek-ai/DeepSeek-V3-0324": {
		maxOutputTokens: 131_072,
		contextWindow: 163_840,
		pricing: {
			input: 0.77,
			output: 0.77,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		reasoning: {
			enabled: true,
		},
		description: "Fast general-purpose LLM with enhanced reasoning capabilities",
	},
	"deepseek-ai/DeepSeek-V3.1": {
		maxOutputTokens: 131_072,
		contextWindow: 163_840,
		pricing: {
			input: 0.5,
			output: 1.5,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		reasoning: {
			enabled: true,
		},
		description: "Extremely capable general-purpose LLM with hybrid reasoning capabilities and advanced tool calling",
	},
	"deepseek-ai/DeepSeek-V3.2": {
		maxOutputTokens: 131_072,
		contextWindow: 163_840,
		pricing: {
			input: 0.3,
			output: 0.45,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		reasoning: {
			enabled: true,
		},
		description: "DeepSeek's hybrid reasoning model with efficient long context scaling with GPT-5 level performance",
	},
	"Qwen/Qwen3-235B-A22B-Instruct-2507": {
		maxOutputTokens: 262_144,
		contextWindow: 262_144,
		pricing: {
			input: 0.22,
			output: 0.8,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		description: "Mixture-of-experts LLM with math and reasoning capabilities",
	},
	"Qwen/Qwen3-Coder-480B-A35B-Instruct": {
		maxOutputTokens: 262_144,
		contextWindow: 262_144,
		pricing: {
			input: 0.38,
			output: 1.53,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		description: "Mixture-of-experts LLM with advanced coding and reasoning capabilities",
	},
	"openai/gpt-oss-120b": {
		maxOutputTokens: 128_072,
		contextWindow: 128_072,
		pricing: {
			input: 0.1,
			output: 0.5,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		reasoning: {
			enabled: true,
		},
		description: "Extremely capable general-purpose LLM with strong, controllable reasoning capabilities",
	},
	"moonshotai/Kimi-K2-Instruct-0905": {
		maxOutputTokens: 168_000,
		contextWindow: 262_000,
		pricing: {
			input: 0.6,
			output: 2.5,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		description: "State of the art language model for agentic and coding tasks. September Update.",
	},
}

modelRegistry.registerProvider(PROVIDER_NAME, MODELS)
