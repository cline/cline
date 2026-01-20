import { modelRegistry } from "../registry"
import type { ModelInfo } from "../types"

const PROVIDER_NAME = "groq"

const MODELS: Record<string, ModelInfo> = {
	"openai/gpt-oss-120b": {
		maxOutputTokens: 32766, // Model fails if you try to use more than 32K tokens
		contextWindow: 131_072,
		pricing: {
			input: 0.15,
			output: 0.75,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		description:
			"A state-of-the-art 120B open-weight Mixture-of-Experts language model optimized for strong reasoning, tool use, and efficient deployment on large GPUs",
	},
	"openai/gpt-oss-20b": {
		maxOutputTokens: 32766, // Model fails if you try to use more than 32K tokens
		contextWindow: 131_072,
		pricing: {
			input: 0.1,
			output: 0.5,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		description:
			"A compact 20B open-weight Mixture-of-Experts language model designed for strong reasoning and tool use, ideal for edge devices and local inference.",
	},
	// Compound Beta Models - Hybrid architectures optimized for tool use
	"compound-beta": {
		maxOutputTokens: 8192,
		contextWindow: 128000,
		pricing: {
			input: 0.0,
			output: 0.0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		description:
			"Compound model using Llama 4 Scout for core reasoning with Llama 3.3 70B for routing and tool use. Excellent for plan/act workflows.",
	},
	"compound-beta-mini": {
		maxOutputTokens: 8192,
		contextWindow: 128000,
		pricing: {
			input: 0.0,
			output: 0.0,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		description: "Lightweight compound model for faster inference while maintaining tool use capabilities.",
	},
	// DeepSeek Models - Reasoning-optimized
	"deepseek-r1-distill-llama-70b": {
		maxOutputTokens: 131072,
		contextWindow: 131072,
		pricing: {
			input: 0.75,
			output: 0.99,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		description:
			"DeepSeek R1 reasoning capabilities distilled into Llama 70B architecture. Excellent for complex problem-solving and planning.",
	},
	// Llama 4 Models
	"meta-llama/llama-4-maverick-17b-128e-instruct": {
		maxOutputTokens: 8192,
		contextWindow: 131072,
		pricing: {
			input: 0.2,
			output: 0.6,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
		description: "Meta's Llama 4 Maverick 17B model with 128 experts, supports vision and multimodal tasks.",
	},
	"meta-llama/llama-4-scout-17b-16e-instruct": {
		maxOutputTokens: 8192,
		contextWindow: 131072,
		pricing: {
			input: 0.11,
			output: 0.34,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
		description: "Meta's Llama 4 Scout 17B model with 16 experts, optimized for fast inference and general tasks.",
	},
	// Llama 3.3 Models
	"llama-3.3-70b-versatile": {
		maxOutputTokens: 32768,
		contextWindow: 131072,
		pricing: {
			input: 0.59,
			output: 0.79,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		description: "Meta's latest Llama 3.3 70B model optimized for versatile use cases with excellent performance and speed.",
	},
	// Llama 3.1 Models - Fast inference
	"llama-3.1-8b-instant": {
		maxOutputTokens: 131072,
		contextWindow: 131072,
		pricing: {
			input: 0.05,
			output: 0.08,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		description: "Fast and efficient Llama 3.1 8B model optimized for speed, low latency, and reliable tool execution.",
	},
	// Moonshot Models
	"moonshotai/kimi-k2-instruct": {
		maxOutputTokens: 16384,
		contextWindow: 131072,
		pricing: {
			input: 1.0,
			output: 3.0,
			cacheRead: 0.5, // 50% discount for cached input tokens
		},
		capabilities: {
			images: false,
			promptCache: true,
		},
		description:
			"Kimi K2 is Moonshot AI's state-of-the-art Mixture-of-Experts (MoE) language model with 1 trillion total parameters and 32 billion activated parameters.",
	},
	"moonshotai/kimi-k2-instruct-0905": {
		maxOutputTokens: 16384,
		contextWindow: 262144,
		pricing: {
			input: 0.6,
			output: 2.5,
			cacheRead: 0.15,
		},
		capabilities: {
			images: false,
			promptCache: true,
		},
		description:
			"Kimi K2 model gets a new version update: Agentic coding: more accurate, better generalization across scaffolds. Frontend coding: improved aesthetics and functionalities on web, 3d, and other tasks. Context length: extended from 128k to 256k, providing better long-horizon support.",
	},
}

modelRegistry.registerProvider(PROVIDER_NAME, MODELS)
