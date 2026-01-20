import { modelRegistry } from "../registry"
import { ApiFormat, type ModelInfo } from "../types"

const PROVIDER_NAME = "openai"

const OPENAI_MODELS: Record<string, ModelInfo> = {
	"gpt-5.2": {
		contextWindow: 272000,
		maxOutputTokens: 8_192,
		pricing: {
			input: 1.75,
			output: 14.0,
			cacheRead: 0.175,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		reasoning: {
			enabled: true,
			supportsEffortLevel: true,
		},
		temperature: 1,
		systemRole: "developer",
	},
	"gpt-5.2-codex": {
		contextWindow: 400000,
		maxOutputTokens: 8_192,
		pricing: {
			input: 1.75,
			output: 14.0,
			cacheRead: 0.175,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		reasoning: {
			enabled: true,
			supportsEffortLevel: true,
		},
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		temperature: 1,
		systemRole: "developer",
	},
	"gpt-5.1-2025-11-13": {
		contextWindow: 272000,
		maxOutputTokens: 8_192,
		pricing: {
			input: 1.25,
			output: 10.0,
			cacheRead: 0.125,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		reasoning: {
			enabled: true,
			supportsEffortLevel: true,
		},
		temperature: 1,
		systemRole: "developer",
	},
	"gpt-5.1": {
		contextWindow: 272000,
		maxOutputTokens: 8_192,
		pricing: {
			input: 1.25,
			output: 10.0,
			cacheRead: 0.125,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		reasoning: {
			enabled: true,
			supportsEffortLevel: true,
		},
		temperature: 1,
		systemRole: "developer",
	},
	"gpt-5.1-codex": {
		contextWindow: 400000,
		maxOutputTokens: 8_192,
		pricing: {
			input: 1.25,
			output: 10.0,
			cacheRead: 0.125,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		reasoning: {
			enabled: true,
			supportsEffortLevel: true,
		},
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		temperature: 1,
		systemRole: "developer",
	},
	"gpt-5.1-chat-latest": {
		contextWindow: 400000,
		maxOutputTokens: 8_192,
		pricing: {
			input: 1.25,
			output: 10,
			cacheRead: 0.125,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		reasoning: {
			enabled: true,
			supportsEffortLevel: true,
		},
		temperature: 1,
		systemRole: "developer",
	},
	"gpt-5-2025-08-07": {
		contextWindow: 272000,
		maxOutputTokens: 8_192,
		pricing: {
			input: 1.25,
			output: 10.0,
			cacheRead: 0.125,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		reasoning: {
			enabled: true,
			supportsEffortLevel: true,
		},
		temperature: 1,
		systemRole: "developer",
	},
	"gpt-5-codex": {
		contextWindow: 400000,
		maxOutputTokens: 8_192,
		pricing: {
			input: 1.25,
			output: 10.0,
			cacheRead: 0.125,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		reasoning: {
			enabled: true,
			supportsEffortLevel: true,
		},
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		temperature: 1,
		systemRole: "developer",
	},
	"gpt-5-mini-2025-08-07": {
		contextWindow: 272000,
		maxOutputTokens: 8_192,
		pricing: {
			input: 0.25,
			output: 2.0,
			cacheRead: 0.025,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		reasoning: {
			enabled: true,
			supportsEffortLevel: true,
		},
		temperature: 1,
		systemRole: "developer",
	},
	"gpt-5-nano-2025-08-07": {
		contextWindow: 272000,
		maxOutputTokens: 8_192,
		pricing: {
			input: 0.05,
			output: 0.4,
			cacheRead: 0.005,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		reasoning: {
			enabled: true,
			supportsEffortLevel: true,
		},
		temperature: 1,
		systemRole: "developer",
	},
	"gpt-5-chat-latest": {
		contextWindow: 400000,
		maxOutputTokens: 8_192,
		pricing: {
			input: 1.25,
			output: 10,
			cacheRead: 0.125,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		reasoning: {
			enabled: true,
			supportsEffortLevel: true,
		},
		temperature: 1,
		systemRole: "developer",
	},
	o3: {
		contextWindow: 200_000,
		maxOutputTokens: 100_000,
		pricing: {
			input: 2.0,
			output: 8.0,
			cacheRead: 0.5,
		},
		capabilities: {
			images: true,
			promptCache: true,
			tools: false,
		},
		reasoning: {
			enabled: true,
			supportsEffortLevel: true,
		},
		systemRole: "developer",
	},
	"o4-mini": {
		contextWindow: 200_000,
		maxOutputTokens: 100_000,
		pricing: {
			input: 1.1,
			output: 4.4,
			cacheRead: 0.275,
		},
		capabilities: {
			images: true,
			promptCache: true,
			tools: false,
		},
		reasoning: {
			enabled: true,
			supportsEffortLevel: true,
		},
		systemRole: "developer",
	},
	"gpt-4.1": {
		contextWindow: 1_047_576,
		maxOutputTokens: 32_768,
		pricing: {
			input: 2,
			output: 8,
			cacheRead: 0.5,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		temperature: 0,
	},
	"gpt-4.1-mini": {
		contextWindow: 1_047_576,
		maxOutputTokens: 32_768,
		pricing: {
			input: 0.4,
			output: 1.6,
			cacheRead: 0.1,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		temperature: 0,
	},
	"gpt-4.1-nano": {
		contextWindow: 1_047_576,
		maxOutputTokens: 32_768,
		pricing: {
			input: 0.1,
			output: 0.4,
			cacheRead: 0.025,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		temperature: 0,
	},
	"o3-mini": {
		contextWindow: 200_000,
		maxOutputTokens: 100_000,
		pricing: {
			input: 1.1,
			output: 4.4,
			cacheRead: 0.55,
		},
		capabilities: {
			images: false,
			promptCache: true,
			tools: false,
		},
		reasoning: {
			enabled: true,
			supportsEffortLevel: true,
		},
		systemRole: "developer",
	},
	// don't support tool use yet
	o1: {
		contextWindow: 200_000,
		maxOutputTokens: 100_000,
		pricing: {
			input: 15,
			output: 60,
			cacheRead: 7.5,
		},
		capabilities: {
			images: true,
			promptCache: false,
			streaming: false,
		},
	},
	"o1-preview": {
		contextWindow: 128_000,
		maxOutputTokens: 32_768,
		pricing: {
			input: 15,
			output: 60,
			cacheRead: 7.5,
		},
		capabilities: {
			images: true,
			promptCache: true,
			streaming: false,
		},
	},
	"o1-mini": {
		contextWindow: 128_000,
		maxOutputTokens: 65_536,
		pricing: {
			input: 1.1,
			output: 4.4,
			cacheRead: 0.55,
		},
		capabilities: {
			images: true,
			promptCache: true,
			streaming: false,
		},
	},
	"gpt-4o": {
		contextWindow: 128_000,
		maxOutputTokens: 4_096,
		pricing: {
			input: 2.5,
			output: 10,
			cacheRead: 1.25,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		temperature: 0,
	},
	"gpt-4o-mini": {
		contextWindow: 128_000,
		maxOutputTokens: 16_384,
		pricing: {
			input: 0.15,
			output: 0.6,
			cacheRead: 0.075,
		},
		capabilities: {
			images: true,
			promptCache: true,
		},
		temperature: 0,
	},
	"chatgpt-4o-latest": {
		contextWindow: 128_000,
		maxOutputTokens: 16_384,
		pricing: {
			input: 5,
			output: 15,
		},
		capabilities: {
			images: true,
			promptCache: false,
		},
		temperature: 0,
	},
}

// Register OpenAI models with the registry
modelRegistry.registerProvider(PROVIDER_NAME, OPENAI_MODELS)
