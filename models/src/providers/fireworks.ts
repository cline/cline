import { modelRegistry } from "../registry"
import type { ModelInfo } from "../types"

const PROVIDER_NAME = "fireworks"

const MODELS: Record<string, ModelInfo> = {
	"accounts/fireworks/models/kimi-k2-instruct-0905": {
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
	"accounts/fireworks/models/qwen3-235b-a22b-instruct-2507": {
		maxOutputTokens: 32768,
		contextWindow: 256000,
		pricing: {
			input: 0.22,
			output: 0.88,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		description: "Latest Qwen3 thinking model, competitive against the best closed source models in Jul 2025.",
	},
	"accounts/fireworks/models/qwen3-coder-480b-a35b-instruct": {
		maxOutputTokens: 32768,
		contextWindow: 256000,
		pricing: {
			input: 0.45,
			output: 1.8,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		description: "Qwen3's most agentic code model to date.",
	},
	"accounts/fireworks/models/deepseek-r1-0528": {
		maxOutputTokens: 20480,
		contextWindow: 160000,
		pricing: {
			input: 3,
			output: 8,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		description:
			"05/28 updated checkpoint of Deepseek R1. Its overall performance is now approaching that of leading models, such as O3 and Gemini 2.5 Pro. Compared to the previous version, the upgraded model shows significant improvements in handling complex reasoning tasks, and this version also offers a reduced hallucination rate, enhanced support for function calling, and better experience for vibe coding. Note that fine-tuning for this model is only available through contacting fireworks at https://fireworks.ai/company/contact-us.",
	},
	"accounts/fireworks/models/deepseek-v3": {
		maxOutputTokens: 16384,
		contextWindow: 128000,
		pricing: {
			input: 0.9,
			output: 0.9,
		},
		capabilities: {
			images: false,
			promptCache: false,
		},
		description:
			"A strong Mixture-of-Experts (MoE) language model with 671B total parameters with 37B activated for each token from Deepseek. Note that fine-tuning for this model is only available through contacting fireworks at https://fireworks.ai/company/contact-us.",
	},
}

modelRegistry.registerProvider(PROVIDER_NAME, MODELS)
