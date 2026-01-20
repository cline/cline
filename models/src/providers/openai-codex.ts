import { modelRegistry } from "../registry"
import { ApiFormat, type ModelInfo } from "../types"

const PROVIDER_NAME = "openai-codex"

const MODELS: Record<string, ModelInfo> = {
	"gpt-5.2-codex": {
		maxOutputTokens: 128_000,
		contextWindow: 400_000,
		pricing: {
			// Subscription-based: no per-token costs
			input: 0,
			output: 0,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		reasoning: {
			enabled: true,
		},
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		description: "GPT-5.2 Codex: OpenAI's flagship coding model via ChatGPT subscription",
	},
	"gpt-5.1-codex-max": {
		maxOutputTokens: 128_000,
		contextWindow: 400_000,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		reasoning: {
			enabled: true,
		},
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		description: "GPT-5.1 Codex Max: Maximum capability coding model via ChatGPT subscription",
	},
	"gpt-5.1-codex-mini": {
		maxOutputTokens: 128_000,
		contextWindow: 400_000,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		reasoning: {
			enabled: true,
		},
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		description: "GPT-5.1 Codex Mini: Faster version for coding tasks via ChatGPT subscription",
	},
	"gpt-5.2": {
		maxOutputTokens: 128_000,
		contextWindow: 400_000,
		pricing: {
			input: 0,
			output: 0,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		reasoning: {
			enabled: true,
		},
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		description: "GPT-5.2: Latest GPT model via ChatGPT subscription",
	},
}

modelRegistry.registerProvider(PROVIDER_NAME, MODELS)
