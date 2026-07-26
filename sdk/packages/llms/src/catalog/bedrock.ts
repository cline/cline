import type { ModelCollection, ModelInfo } from "./types";

export const BEDROCK_DEFAULT_MODEL_ID = "anthropic.claude-sonnet-4-6";

export const BEDROCK_MODELS: Record<string, ModelInfo> = {
	"anthropic.claude-sonnet-4-6": {
		id: "anthropic.claude-sonnet-4-6",
		name: "Claude Sonnet 4.6",
		contextWindow: 1_000_000,
		maxInputTokens: 1_000_000,
		maxTokens: 64_000,
		capabilities: [
			"images",
			"files",
			"tools",
			"reasoning",
			"structured_output",
			"temperature",
			"prompt-cache",
		],
		pricing: {
			input: 3,
			output: 15,
			cacheRead: 0.3,
			cacheWrite: 3.75,
		},
		family: "claude-sonnet",
	},
	"anthropic.claude-opus-4-6-v1": {
		id: "anthropic.claude-opus-4-6-v1",
		name: "Claude Opus 4.6",
		contextWindow: 1_000_000,
		maxInputTokens: 1_000_000,
		maxTokens: 128_000,
		capabilities: ["images", "files", "tools", "reasoning", "prompt-cache"],
		pricing: {
			input: 5,
			output: 25,
			cacheRead: 0.5,
			cacheWrite: 6.25,
		},
		family: "claude-opus",
	},
	"anthropic.claude-haiku-4-5-20251001-v1:0": {
		id: "anthropic.claude-haiku-4-5-20251001-v1:0",
		name: "Claude Haiku 4.5",
		contextWindow: 200_000,
		maxInputTokens: 200_000,
		maxTokens: 64_000,
		capabilities: ["images", "files", "tools", "reasoning", "prompt-cache"],
		pricing: {
			input: 1,
			output: 5,
			cacheRead: 0.1,
			cacheWrite: 1.25,
		},
		family: "claude-haiku",
	},
};

export const BEDROCK_MODEL_COLLECTION: ModelCollection = {
	provider: {
		id: "bedrock",
		name: "AWS Bedrock",
		description: "Amazon Bedrock managed foundation models",
		defaultModelId: BEDROCK_DEFAULT_MODEL_ID,
		capabilities: ["tools", "reasoning", "prompt-cache", "streaming"],
		client: "bedrock",
		source: "system",
	},
	models: BEDROCK_MODELS,
};
