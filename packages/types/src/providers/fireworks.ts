import type { ModelInfo } from "../model.js"

export type FireworksModelId =
	| "accounts/fireworks/models/kimi-k2-instruct"
	| "accounts/fireworks/models/qwen3-235b-a22b-instruct-2507"
	| "accounts/fireworks/models/qwen3-coder-480b-a35b-instruct"
	| "accounts/fireworks/models/deepseek-r1-0528"
	| "accounts/fireworks/models/deepseek-v3"
	| "accounts/fireworks/models/glm-4p5"
	| "accounts/fireworks/models/glm-4p5-air"
	| "accounts/fireworks/models/gpt-oss-20b"
	| "accounts/fireworks/models/gpt-oss-120b"

export const fireworksDefaultModelId: FireworksModelId = "accounts/fireworks/models/kimi-k2-instruct"

export const fireworksModels = {
	"accounts/fireworks/models/kimi-k2-instruct": {
		maxTokens: 16384,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.6,
		outputPrice: 2.5,
		description:
			"Kimi K2 is a state-of-the-art mixture-of-experts (MoE) language model with 32 billion activated parameters and 1 trillion total parameters. Trained with the Muon optimizer, Kimi K2 achieves exceptional performance across frontier knowledge, reasoning, and coding tasks while being meticulously optimized for agentic capabilities.",
	},
	"accounts/fireworks/models/qwen3-235b-a22b-instruct-2507": {
		maxTokens: 32768,
		contextWindow: 256000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.22,
		outputPrice: 0.88,
		description: "Latest Qwen3 thinking model, competitive against the best closed source models in Jul 2025.",
	},
	"accounts/fireworks/models/qwen3-coder-480b-a35b-instruct": {
		maxTokens: 32768,
		contextWindow: 256000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.45,
		outputPrice: 1.8,
		description: "Qwen3's most agentic code model to date.",
	},
	"accounts/fireworks/models/deepseek-r1-0528": {
		maxTokens: 20480,
		contextWindow: 160000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 3,
		outputPrice: 8,
		description:
			"05/28 updated checkpoint of Deepseek R1. Its overall performance is now approaching that of leading models, such as O3 and Gemini 2.5 Pro. Compared to the previous version, the upgraded model shows significant improvements in handling complex reasoning tasks, and this version also offers a reduced hallucination rate, enhanced support for function calling, and better experience for vibe coding. Note that fine-tuning for this model is only available through contacting fireworks at https://fireworks.ai/company/contact-us.",
	},
	"accounts/fireworks/models/deepseek-v3": {
		maxTokens: 16384,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.9,
		outputPrice: 0.9,
		description:
			"A strong Mixture-of-Experts (MoE) language model with 671B total parameters with 37B activated for each token from Deepseek. Note that fine-tuning for this model is only available through contacting fireworks at https://fireworks.ai/company/contact-us.",
	},
	"accounts/fireworks/models/glm-4p5": {
		maxTokens: 16384,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.55,
		outputPrice: 2.19,
		description:
			"Z.ai GLM-4.5 with 355B total parameters and 32B active parameters. Features unified reasoning, coding, and intelligent agent capabilities.",
	},
	"accounts/fireworks/models/glm-4p5-air": {
		maxTokens: 16384,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.55,
		outputPrice: 2.19,
		description:
			"Z.ai GLM-4.5-Air with 106B total parameters and 12B active parameters. Features unified reasoning, coding, and intelligent agent capabilities.",
	},
	"accounts/fireworks/models/gpt-oss-20b": {
		maxTokens: 16384,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.07,
		outputPrice: 0.3,
		description:
			"OpenAI gpt-oss-20b: Compact model for local/edge deployments. Optimized for low-latency and resource-constrained environments with chain-of-thought output, adjustable reasoning, and agentic workflows.",
	},
	"accounts/fireworks/models/gpt-oss-120b": {
		maxTokens: 16384,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.15,
		outputPrice: 0.6,
		description:
			"OpenAI gpt-oss-120b: Production-grade, general-purpose model that fits on a single H100 GPU. Features complex reasoning, configurable effort, full chain-of-thought transparency, and supports function calling, tool use, and structured outputs.",
	},
} as const satisfies Record<string, ModelInfo>
