import type { ModelInfo, ProviderSettings } from "@roo-code/types"

import { ANTHROPIC_DEFAULT_MAX_TOKENS } from "../api/providers/constants"

export type ApiHandlerOptions = Omit<ProviderSettings, "apiProvider">

// Anthropic
// https://docs.anthropic.com/en/docs/about-claude/models
export type AnthropicModelId = keyof typeof anthropicModels
export const anthropicDefaultModelId: AnthropicModelId = "claude-sonnet-4-20250514"
export const anthropicModels = {
	"claude-sonnet-4-20250514": {
		maxTokens: 64_000, // Overridden to 8k if `enableReasoningEffort` is false.
		contextWindow: 200_000,
		supportsImages: true,
		supportsComputerUse: true,
		supportsPromptCache: true,
		inputPrice: 3.0, // $3 per million input tokens
		outputPrice: 15.0, // $15 per million output tokens
		cacheWritesPrice: 3.75, // $3.75 per million tokens
		cacheReadsPrice: 0.3, // $0.30 per million tokens
		supportsReasoningBudget: true,
	},
	"claude-opus-4-20250514": {
		maxTokens: 32_000, // Overridden to 8k if `enableReasoningEffort` is false.
		contextWindow: 200_000,
		supportsImages: true,
		supportsComputerUse: true,
		supportsPromptCache: true,
		inputPrice: 15.0, // $15 per million input tokens
		outputPrice: 75.0, // $75 per million output tokens
		cacheWritesPrice: 18.75, // $18.75 per million tokens
		cacheReadsPrice: 1.5, // $1.50 per million tokens
		supportsReasoningBudget: true,
	},
	"claude-3-7-sonnet-20250219:thinking": {
		maxTokens: 128_000, // Unlocked by passing `beta` flag to the model. Otherwise, it's 64k.
		contextWindow: 200_000,
		supportsImages: true,
		supportsComputerUse: true,
		supportsPromptCache: true,
		inputPrice: 3.0, // $3 per million input tokens
		outputPrice: 15.0, // $15 per million output tokens
		cacheWritesPrice: 3.75, // $3.75 per million tokens
		cacheReadsPrice: 0.3, // $0.30 per million tokens
		supportsReasoningBudget: true,
		requiredReasoningBudget: true,
	},
	"claude-3-7-sonnet-20250219": {
		maxTokens: 8192, // Since we already have a `:thinking` virtual model we aren't setting `supportsReasoningBudget: true` here.
		contextWindow: 200_000,
		supportsImages: true,
		supportsComputerUse: true,
		supportsPromptCache: true,
		inputPrice: 3.0, // $3 per million input tokens
		outputPrice: 15.0, // $15 per million output tokens
		cacheWritesPrice: 3.75, // $3.75 per million tokens
		cacheReadsPrice: 0.3, // $0.30 per million tokens
	},
	"claude-3-5-sonnet-20241022": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsComputerUse: true,
		supportsPromptCache: true,
		inputPrice: 3.0, // $3 per million input tokens
		outputPrice: 15.0, // $15 per million output tokens
		cacheWritesPrice: 3.75, // $3.75 per million tokens
		cacheReadsPrice: 0.3, // $0.30 per million tokens
	},
	"claude-3-5-haiku-20241022": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 1.0,
		outputPrice: 5.0,
		cacheWritesPrice: 1.25,
		cacheReadsPrice: 0.1,
	},
	"claude-3-opus-20240229": {
		maxTokens: 4096,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 15.0,
		outputPrice: 75.0,
		cacheWritesPrice: 18.75,
		cacheReadsPrice: 1.5,
	},
	"claude-3-haiku-20240307": {
		maxTokens: 4096,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.25,
		outputPrice: 1.25,
		cacheWritesPrice: 0.3,
		cacheReadsPrice: 0.03,
	},
} as const satisfies Record<string, ModelInfo> // as const assertion makes the object deeply readonly

// Amazon Bedrock
// https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html
export interface MessageContent {
	type: "text" | "image" | "video" | "tool_use" | "tool_result"
	text?: string
	source?: {
		type: "base64"
		data: string | Uint8Array // string for Anthropic, Uint8Array for Bedrock
		media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"
	}
	// Video specific fields
	format?: string
	s3Location?: {
		uri: string
		bucketOwner?: string
	}
	// Tool use and result fields
	toolUseId?: string
	name?: string
	input?: any
	output?: any // Used for tool_result type
}

export type BedrockModelId = keyof typeof bedrockModels
export const bedrockDefaultModelId: BedrockModelId = "anthropic.claude-sonnet-4-20250514-v1:0"
export const bedrockDefaultPromptRouterModelId: BedrockModelId = "anthropic.claude-3-sonnet-20240229-v1:0"

// March, 12 2025 - updated prices to match US-West-2 list price shown at https://aws.amazon.com/bedrock/pricing/
// including older models that are part of the default prompt routers AWS enabled for GA of the promot router feature
export const bedrockModels = {
	"amazon.nova-pro-v1:0": {
		maxTokens: 5000,
		contextWindow: 300_000,
		supportsImages: true,
		supportsComputerUse: false,
		supportsPromptCache: true,
		inputPrice: 0.8,
		outputPrice: 3.2,
		cacheWritesPrice: 0.8, // per million tokens
		cacheReadsPrice: 0.2, // per million tokens
		minTokensPerCachePoint: 1,
		maxCachePoints: 1,
		cachableFields: ["system"],
	},
	"amazon.nova-pro-latency-optimized-v1:0": {
		maxTokens: 5000,
		contextWindow: 300_000,
		supportsImages: true,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 1.0,
		outputPrice: 4.0,
		cacheWritesPrice: 1.0, // per million tokens
		cacheReadsPrice: 0.25, // per million tokens
		description: "Amazon Nova Pro with latency optimized inference",
	},
	"amazon.nova-lite-v1:0": {
		maxTokens: 5000,
		contextWindow: 300_000,
		supportsImages: true,
		supportsComputerUse: false,
		supportsPromptCache: true,
		inputPrice: 0.06,
		outputPrice: 0.24,
		cacheWritesPrice: 0.06, // per million tokens
		cacheReadsPrice: 0.015, // per million tokens
		minTokensPerCachePoint: 1,
		maxCachePoints: 1,
		cachableFields: ["system"],
	},
	"amazon.nova-micro-v1:0": {
		maxTokens: 5000,
		contextWindow: 128_000,
		supportsImages: false,
		supportsComputerUse: false,
		supportsPromptCache: true,
		inputPrice: 0.035,
		outputPrice: 0.14,
		cacheWritesPrice: 0.035, // per million tokens
		cacheReadsPrice: 0.00875, // per million tokens
		minTokensPerCachePoint: 1,
		maxCachePoints: 1,
		cachableFields: ["system"],
	},
	"anthropic.claude-sonnet-4-20250514-v1:0": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsComputerUse: true,
		supportsPromptCache: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
		minTokensPerCachePoint: 1024,
		maxCachePoints: 4,
		cachableFields: ["system", "messages", "tools"],
	},
	"anthropic.claude-opus-4-20250514-v1:0": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsComputerUse: true,
		supportsPromptCache: true,
		inputPrice: 15.0,
		outputPrice: 75.0,
		cacheWritesPrice: 18.75,
		cacheReadsPrice: 1.5,
		minTokensPerCachePoint: 1024,
		maxCachePoints: 4,
		cachableFields: ["system", "messages", "tools"],
	},
	"anthropic.claude-3-7-sonnet-20250219-v1:0": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsComputerUse: true,
		supportsPromptCache: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
		minTokensPerCachePoint: 1024,
		maxCachePoints: 4,
		cachableFields: ["system", "messages", "tools"],
	},
	"anthropic.claude-3-5-sonnet-20241022-v2:0": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsComputerUse: true,
		supportsPromptCache: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
		minTokensPerCachePoint: 1024,
		maxCachePoints: 4,
		cachableFields: ["system", "messages", "tools"],
	},
	"anthropic.claude-3-5-haiku-20241022-v1:0": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.8,
		outputPrice: 4.0,
		cacheWritesPrice: 1.0,
		cacheReadsPrice: 0.08,
		minTokensPerCachePoint: 2048,
		maxCachePoints: 4,
		cachableFields: ["system", "messages", "tools"],
	},
	"anthropic.claude-3-5-sonnet-20240620-v1:0": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 3.0,
		outputPrice: 15.0,
	},
	"anthropic.claude-3-opus-20240229-v1:0": {
		maxTokens: 4096,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 15.0,
		outputPrice: 75.0,
	},
	"anthropic.claude-3-sonnet-20240229-v1:0": {
		maxTokens: 4096,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 3.0,
		outputPrice: 15.0,
	},
	"anthropic.claude-3-haiku-20240307-v1:0": {
		maxTokens: 4096,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0.25,
		outputPrice: 1.25,
	},
	"anthropic.claude-2-1-v1:0": {
		maxTokens: 4096,
		contextWindow: 100_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 8.0,
		outputPrice: 24.0,
		description: "Claude 2.1",
	},
	"anthropic.claude-2-0-v1:0": {
		maxTokens: 4096,
		contextWindow: 100_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 8.0,
		outputPrice: 24.0,
		description: "Claude 2.0",
	},
	"anthropic.claude-instant-v1:0": {
		maxTokens: 4096,
		contextWindow: 100_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.8,
		outputPrice: 2.4,
		description: "Claude Instant",
	},
	"deepseek.r1-v1:0": {
		maxTokens: 32_768,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 1.35,
		outputPrice: 5.4,
	},
	"meta.llama3-3-70b-instruct-v1:0": {
		maxTokens: 8192,
		contextWindow: 128_000,
		supportsImages: false,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 0.72,
		outputPrice: 0.72,
		description: "Llama 3.3 Instruct (70B)",
	},
	"meta.llama3-2-90b-instruct-v1:0": {
		maxTokens: 8192,
		contextWindow: 128_000,
		supportsImages: true,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 0.72,
		outputPrice: 0.72,
		description: "Llama 3.2 Instruct (90B)",
	},
	"meta.llama3-2-11b-instruct-v1:0": {
		maxTokens: 8192,
		contextWindow: 128_000,
		supportsImages: true,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 0.16,
		outputPrice: 0.16,
		description: "Llama 3.2 Instruct (11B)",
	},
	"meta.llama3-2-3b-instruct-v1:0": {
		maxTokens: 8192,
		contextWindow: 128_000,
		supportsImages: false,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 0.15,
		outputPrice: 0.15,
		description: "Llama 3.2 Instruct (3B)",
	},
	"meta.llama3-2-1b-instruct-v1:0": {
		maxTokens: 8192,
		contextWindow: 128_000,
		supportsImages: false,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 0.1,
		outputPrice: 0.1,
		description: "Llama 3.2 Instruct (1B)",
	},
	"meta.llama3-1-405b-instruct-v1:0": {
		maxTokens: 8192,
		contextWindow: 128_000,
		supportsImages: false,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 2.4,
		outputPrice: 2.4,
		description: "Llama 3.1 Instruct (405B)",
	},
	"meta.llama3-1-70b-instruct-v1:0": {
		maxTokens: 8192,
		contextWindow: 128_000,
		supportsImages: false,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 0.72,
		outputPrice: 0.72,
		description: "Llama 3.1 Instruct (70B)",
	},
	"meta.llama3-1-70b-instruct-latency-optimized-v1:0": {
		maxTokens: 8192,
		contextWindow: 128_000,
		supportsImages: false,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 0.9,
		outputPrice: 0.9,
		description: "Llama 3.1 Instruct (70B) (w/ latency optimized inference)",
	},
	"meta.llama3-1-8b-instruct-v1:0": {
		maxTokens: 8192,
		contextWindow: 8_000,
		supportsImages: false,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 0.22,
		outputPrice: 0.22,
		description: "Llama 3.1 Instruct (8B)",
	},
	"meta.llama3-70b-instruct-v1:0": {
		maxTokens: 2048,
		contextWindow: 8_000,
		supportsImages: false,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 2.65,
		outputPrice: 3.5,
	},
	"meta.llama3-8b-instruct-v1:0": {
		maxTokens: 2048,
		contextWindow: 4_000,
		supportsImages: false,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 0.3,
		outputPrice: 0.6,
	},
	"amazon.titan-text-lite-v1:0": {
		maxTokens: 4096,
		contextWindow: 8_000,
		supportsImages: false,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 0.15,
		outputPrice: 0.2,
		description: "Amazon Titan Text Lite",
	},
	"amazon.titan-text-express-v1:0": {
		maxTokens: 4096,
		contextWindow: 8_000,
		supportsImages: false,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 0.2,
		outputPrice: 0.6,
		description: "Amazon Titan Text Express",
	},
	"amazon.titan-text-embeddings-v1:0": {
		maxTokens: 8192,
		contextWindow: 8_000,
		supportsImages: false,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 0.1,
		description: "Amazon Titan Text Embeddings",
	},
	"amazon.titan-text-embeddings-v2:0": {
		maxTokens: 8192,
		contextWindow: 8_000,
		supportsImages: false,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 0.02,
		description: "Amazon Titan Text Embeddings V2",
	},
} as const satisfies Record<string, ModelInfo>

// Glama
// https://glama.ai/models
export const glamaDefaultModelId = "anthropic/claude-3-7-sonnet"
export const glamaDefaultModelInfo: ModelInfo = {
	maxTokens: 8192,
	contextWindow: 200_000,
	supportsImages: true,
	supportsComputerUse: true,
	supportsPromptCache: true,
	inputPrice: 3.0,
	outputPrice: 15.0,
	cacheWritesPrice: 3.75,
	cacheReadsPrice: 0.3,
	description:
		"Claude 3.7 Sonnet is an advanced large language model with improved reasoning, coding, and problem-solving capabilities. It introduces a hybrid reasoning approach, allowing users to choose between rapid responses and extended, step-by-step processing for complex tasks. The model demonstrates notable improvements in coding, particularly in front-end development and full-stack updates, and excels in agentic workflows, where it can autonomously navigate multi-step processes. Claude 3.7 Sonnet maintains performance parity with its predecessor in standard mode while offering an extended reasoning mode for enhanced accuracy in math, coding, and instruction-following tasks. Read more at the [blog post here](https://www.anthropic.com/news/claude-3-7-sonnet)",
}

// Requesty
// https://requesty.ai/router-2
export const requestyDefaultModelId = "coding/claude-4-sonnet"
export const requestyDefaultModelInfo: ModelInfo = {
	maxTokens: 8192,
	contextWindow: 200_000,
	supportsImages: true,
	supportsComputerUse: true,
	supportsPromptCache: true,
	inputPrice: 3.0,
	outputPrice: 15.0,
	cacheWritesPrice: 3.75,
	cacheReadsPrice: 0.3,
	description:
		"The best coding model, optimized by Requesty, and automatically routed to the fastest provider. Claude 4 Sonnet is an advanced large language model with improved reasoning, coding, and problem-solving capabilities.",
}

// OpenRouter
// https://openrouter.ai/models?order=newest&supported_parameters=tools
export const openRouterDefaultModelId = "anthropic/claude-sonnet-4"
export const openRouterDefaultModelInfo: ModelInfo = {
	maxTokens: 8192,
	contextWindow: 200_000,
	supportsImages: true,
	supportsComputerUse: true,
	supportsPromptCache: true,
	inputPrice: 3.0,
	outputPrice: 15.0,
	cacheWritesPrice: 3.75,
	cacheReadsPrice: 0.3,
	description:
		"Claude 3.7 Sonnet is an advanced large language model with improved reasoning, coding, and problem-solving capabilities. It introduces a hybrid reasoning approach, allowing users to choose between rapid responses and extended, step-by-step processing for complex tasks. The model demonstrates notable improvements in coding, particularly in front-end development and full-stack updates, and excels in agentic workflows, where it can autonomously navigate multi-step processes. Claude 3.7 Sonnet maintains performance parity with its predecessor in standard mode while offering an extended reasoning mode for enhanced accuracy in math, coding, and instruction-following tasks. Read more at the [blog post here](https://www.anthropic.com/news/claude-3-7-sonnet)",
}

// Vertex AI
// https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude
export type VertexModelId = keyof typeof vertexModels
export const vertexDefaultModelId: VertexModelId = "claude-sonnet-4@20250514"
export const vertexModels = {
	"gemini-2.5-flash-preview-05-20:thinking": {
		maxTokens: 65_535,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.15,
		outputPrice: 3.5,
		maxThinkingTokens: 24_576,
		supportsReasoningBudget: true,
		requiredReasoningBudget: true,
	},
	"gemini-2.5-flash-preview-05-20": {
		maxTokens: 65_535,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.15,
		outputPrice: 0.6,
	},
	"gemini-2.5-flash-preview-04-17:thinking": {
		maxTokens: 65_535,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0.15,
		outputPrice: 3.5,
		maxThinkingTokens: 24_576,
		supportsReasoningBudget: true,
		requiredReasoningBudget: true,
	},
	"gemini-2.5-flash-preview-04-17": {
		maxTokens: 65_535,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0.15,
		outputPrice: 0.6,
	},
	"gemini-2.5-pro-preview-03-25": {
		maxTokens: 65_535,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 2.5,
		outputPrice: 15,
	},
	"gemini-2.5-pro-preview-05-06": {
		maxTokens: 65_535,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 2.5,
		outputPrice: 15,
	},
	"gemini-2.5-pro-exp-03-25": {
		maxTokens: 65_535,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
	},
	"gemini-2.0-pro-exp-02-05": {
		maxTokens: 8192,
		contextWindow: 2_097_152,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
	},
	"gemini-2.0-flash-001": {
		maxTokens: 8192,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.15,
		outputPrice: 0.6,
	},
	"gemini-2.0-flash-lite-001": {
		maxTokens: 8192,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0.075,
		outputPrice: 0.3,
	},
	"gemini-2.0-flash-thinking-exp-01-21": {
		maxTokens: 8192,
		contextWindow: 32_768,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
	},
	"gemini-1.5-flash-002": {
		maxTokens: 8192,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.075,
		outputPrice: 0.3,
	},
	"gemini-1.5-pro-002": {
		maxTokens: 8192,
		contextWindow: 2_097_152,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 1.25,
		outputPrice: 5,
	},
	"claude-sonnet-4@20250514": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsComputerUse: true,
		supportsPromptCache: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
		supportsReasoningBudget: true,
	},
	"claude-opus-4@20250514": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsComputerUse: true,
		supportsPromptCache: true,
		inputPrice: 15.0,
		outputPrice: 75.0,
		cacheWritesPrice: 18.75,
		cacheReadsPrice: 1.5,
	},
	"claude-3-7-sonnet@20250219:thinking": {
		maxTokens: 64_000,
		contextWindow: 200_000,
		supportsImages: true,
		supportsComputerUse: true,
		supportsPromptCache: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
		supportsReasoningBudget: true,
		requiredReasoningBudget: true,
	},
	"claude-3-7-sonnet@20250219": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsComputerUse: true,
		supportsPromptCache: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
	},
	"claude-3-5-sonnet-v2@20241022": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsComputerUse: true,
		supportsPromptCache: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
	},
	"claude-3-5-sonnet@20240620": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
	},
	"claude-3-5-haiku@20241022": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 1.0,
		outputPrice: 5.0,
		cacheWritesPrice: 1.25,
		cacheReadsPrice: 0.1,
	},
	"claude-3-opus@20240229": {
		maxTokens: 4096,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 15.0,
		outputPrice: 75.0,
		cacheWritesPrice: 18.75,
		cacheReadsPrice: 1.5,
	},
	"claude-3-haiku@20240307": {
		maxTokens: 4096,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.25,
		outputPrice: 1.25,
		cacheWritesPrice: 0.3,
		cacheReadsPrice: 0.03,
	},
} as const satisfies Record<string, ModelInfo>

export const openAiModelInfoSaneDefaults: ModelInfo = {
	maxTokens: -1,
	contextWindow: 128_000,
	supportsImages: true,
	supportsPromptCache: false,
	inputPrice: 0,
	outputPrice: 0,
}

// Gemini
// https://ai.google.dev/gemini-api/docs/models/gemini
export type GeminiModelId = keyof typeof geminiModels
export const geminiDefaultModelId: GeminiModelId = "gemini-2.0-flash-001"
export const geminiModels = {
	"gemini-2.5-flash-preview-04-17:thinking": {
		maxTokens: 65_535,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0.15,
		outputPrice: 3.5,
		maxThinkingTokens: 24_576,
		supportsReasoningBudget: true,
		requiredReasoningBudget: true,
	},
	"gemini-2.5-flash-preview-04-17": {
		maxTokens: 65_535,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0.15,
		outputPrice: 0.6,
	},
	"gemini-2.5-flash-preview-05-20:thinking": {
		maxTokens: 65_535,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.15,
		outputPrice: 3.5,
		cacheReadsPrice: 0.0375,
		cacheWritesPrice: 1.0,
		maxThinkingTokens: 24_576,
		supportsReasoningBudget: true,
		requiredReasoningBudget: true,
	},
	"gemini-2.5-flash-preview-05-20": {
		maxTokens: 65_535,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.15,
		outputPrice: 0.6,
		cacheReadsPrice: 0.0375,
		cacheWritesPrice: 1.0,
	},
	"gemini-2.5-pro-exp-03-25": {
		maxTokens: 65_535,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
	},
	"gemini-2.5-pro-preview-03-25": {
		maxTokens: 65_535,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 2.5, // This is the pricing for prompts above 200k tokens.
		outputPrice: 15,
		cacheReadsPrice: 0.625,
		cacheWritesPrice: 4.5,
		tiers: [
			{
				contextWindow: 200_000,
				inputPrice: 1.25,
				outputPrice: 10,
				cacheReadsPrice: 0.31,
			},
			{
				contextWindow: Infinity,
				inputPrice: 2.5,
				outputPrice: 15,
				cacheReadsPrice: 0.625,
			},
		],
	},
	"gemini-2.5-pro-preview-05-06": {
		maxTokens: 65_535,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 2.5, // This is the pricing for prompts above 200k tokens.
		outputPrice: 15,
		cacheReadsPrice: 0.625,
		cacheWritesPrice: 4.5,
		tiers: [
			{
				contextWindow: 200_000,
				inputPrice: 1.25,
				outputPrice: 10,
				cacheReadsPrice: 0.31,
			},
			{
				contextWindow: Infinity,
				inputPrice: 2.5,
				outputPrice: 15,
				cacheReadsPrice: 0.625,
			},
		],
	},
	"gemini-2.0-flash-001": {
		maxTokens: 8192,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.1,
		outputPrice: 0.4,
		cacheReadsPrice: 0.025,
		cacheWritesPrice: 1.0,
	},
	"gemini-2.0-flash-lite-preview-02-05": {
		maxTokens: 8192,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
	},
	"gemini-2.0-pro-exp-02-05": {
		maxTokens: 8192,
		contextWindow: 2_097_152,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
	},
	"gemini-2.0-flash-thinking-exp-01-21": {
		maxTokens: 65_536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
	},
	"gemini-2.0-flash-thinking-exp-1219": {
		maxTokens: 8192,
		contextWindow: 32_767,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
	},
	"gemini-2.0-flash-exp": {
		maxTokens: 8192,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
	},
	"gemini-1.5-flash-002": {
		maxTokens: 8192,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.15, // This is the pricing for prompts above 128k tokens.
		outputPrice: 0.6,
		cacheReadsPrice: 0.0375,
		cacheWritesPrice: 1.0,
		tiers: [
			{
				contextWindow: 128_000,
				inputPrice: 0.075,
				outputPrice: 0.3,
				cacheReadsPrice: 0.01875,
			},
			{
				contextWindow: Infinity,
				inputPrice: 0.15,
				outputPrice: 0.6,
				cacheReadsPrice: 0.0375,
			},
		],
	},
	"gemini-1.5-flash-exp-0827": {
		maxTokens: 8192,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
	},
	"gemini-1.5-flash-8b-exp-0827": {
		maxTokens: 8192,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
	},
	"gemini-1.5-pro-002": {
		maxTokens: 8192,
		contextWindow: 2_097_152,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
	},
	"gemini-1.5-pro-exp-0827": {
		maxTokens: 8192,
		contextWindow: 2_097_152,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
	},
	"gemini-exp-1206": {
		maxTokens: 8192,
		contextWindow: 2_097_152,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
	},
} as const satisfies Record<string, ModelInfo>

// OpenAI Native
// https://openai.com/api/pricing/
export type OpenAiNativeModelId = keyof typeof openAiNativeModels
export const openAiNativeDefaultModelId: OpenAiNativeModelId = "gpt-4.1"
export const openAiNativeModels = {
	"gpt-4.1": {
		maxTokens: 32_768,
		contextWindow: 1_047_576,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 2,
		outputPrice: 8,
		cacheReadsPrice: 0.5,
	},
	"gpt-4.1-mini": {
		maxTokens: 32_768,
		contextWindow: 1_047_576,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.4,
		outputPrice: 1.6,
		cacheReadsPrice: 0.1,
	},
	"gpt-4.1-nano": {
		maxTokens: 32_768,
		contextWindow: 1_047_576,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.1,
		outputPrice: 0.4,
		cacheReadsPrice: 0.025,
	},
	o3: {
		maxTokens: 100_000,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 10.0,
		outputPrice: 40.0,
		cacheReadsPrice: 2.5,
		supportsReasoningEffort: true,
		reasoningEffort: "medium",
	},
	"o3-high": {
		maxTokens: 100_000,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 10.0,
		outputPrice: 40.0,
		cacheReadsPrice: 2.5,
		reasoningEffort: "high",
	},
	"o3-low": {
		maxTokens: 100_000,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 10.0,
		outputPrice: 40.0,
		cacheReadsPrice: 2.5,
		reasoningEffort: "low",
	},
	"o4-mini": {
		maxTokens: 100_000,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 1.1,
		outputPrice: 4.4,
		cacheReadsPrice: 0.275,
		supportsReasoningEffort: true,
		reasoningEffort: "medium",
	},
	"o4-mini-high": {
		maxTokens: 100_000,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 1.1,
		outputPrice: 4.4,
		cacheReadsPrice: 0.275,
		reasoningEffort: "high",
	},
	"o4-mini-low": {
		maxTokens: 100_000,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 1.1,
		outputPrice: 4.4,
		cacheReadsPrice: 0.275,
		reasoningEffort: "low",
	},
	"o3-mini": {
		maxTokens: 100_000,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 1.1,
		outputPrice: 4.4,
		cacheReadsPrice: 0.55,
		supportsReasoningEffort: true,
		reasoningEffort: "medium",
	},
	"o3-mini-high": {
		maxTokens: 100_000,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 1.1,
		outputPrice: 4.4,
		cacheReadsPrice: 0.55,
		reasoningEffort: "high",
	},
	"o3-mini-low": {
		maxTokens: 100_000,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 1.1,
		outputPrice: 4.4,
		cacheReadsPrice: 0.55,
		reasoningEffort: "low",
	},
	o1: {
		maxTokens: 100_000,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 15,
		outputPrice: 60,
		cacheReadsPrice: 7.5,
	},
	"o1-preview": {
		maxTokens: 32_768,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 15,
		outputPrice: 60,
		cacheReadsPrice: 7.5,
	},
	"o1-mini": {
		maxTokens: 65_536,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 1.1,
		outputPrice: 4.4,
		cacheReadsPrice: 0.55,
	},
	"gpt-4.5-preview": {
		maxTokens: 16_384,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 75,
		outputPrice: 150,
		cacheReadsPrice: 37.5,
	},
	"gpt-4o": {
		maxTokens: 16_384,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 2.5,
		outputPrice: 10,
		cacheReadsPrice: 1.25,
	},
	"gpt-4o-mini": {
		maxTokens: 16_384,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.15,
		outputPrice: 0.6,
		cacheReadsPrice: 0.075,
	},
} as const satisfies Record<string, ModelInfo>

// DeepSeek
// https://platform.deepseek.com/docs/api
export type DeepSeekModelId = keyof typeof deepSeekModels
export const deepSeekDefaultModelId: DeepSeekModelId = "deepseek-chat"
export const deepSeekModels = {
	"deepseek-chat": {
		maxTokens: 8192,
		contextWindow: 64_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.27, // $0.27 per million tokens (cache miss)
		outputPrice: 1.1, // $1.10 per million tokens
		cacheWritesPrice: 0.27, // $0.27 per million tokens (cache miss)
		cacheReadsPrice: 0.07, // $0.07 per million tokens (cache hit).
		description: `DeepSeek-V3 achieves a significant breakthrough in inference speed over previous models. It tops the leaderboard among open-source models and rivals the most advanced closed-source models globally.`,
	},
	"deepseek-reasoner": {
		maxTokens: 8192,
		contextWindow: 64_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.55, // $0.55 per million tokens (cache miss)
		outputPrice: 2.19, // $2.19 per million tokens
		cacheWritesPrice: 0.55, // $0.55 per million tokens (cache miss)
		cacheReadsPrice: 0.14, // $0.14 per million tokens (cache hit)
		description: `DeepSeek-R1 achieves performance comparable to OpenAI-o1 across math, code, and reasoning tasks. Supports Chain of Thought reasoning with up to 32K tokens.`,
	},
} as const satisfies Record<string, ModelInfo>

// Azure OpenAI
// https://learn.microsoft.com/en-us/azure/ai-services/openai/api-version-deprecation
// https://learn.microsoft.com/en-us/azure/ai-services/openai/reference#api-specs
export const azureOpenAiDefaultApiVersion = "2024-08-01-preview"

// Mistral
// https://docs.mistral.ai/getting-started/models/models_overview/
export type MistralModelId = keyof typeof mistralModels
export const mistralDefaultModelId: MistralModelId = "codestral-latest"
export const mistralModels = {
	"codestral-latest": {
		maxTokens: 256_000,
		contextWindow: 256_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.3,
		outputPrice: 0.9,
	},
	"mistral-large-latest": {
		maxTokens: 131_000,
		contextWindow: 131_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 2.0,
		outputPrice: 6.0,
	},
	"ministral-8b-latest": {
		maxTokens: 131_000,
		contextWindow: 131_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.1,
		outputPrice: 0.1,
	},
	"ministral-3b-latest": {
		maxTokens: 131_000,
		contextWindow: 131_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.04,
		outputPrice: 0.04,
	},
	"mistral-small-latest": {
		maxTokens: 32_000,
		contextWindow: 32_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.2,
		outputPrice: 0.6,
	},
	"pixtral-large-latest": {
		maxTokens: 131_000,
		contextWindow: 131_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 2.0,
		outputPrice: 6.0,
	},
} as const satisfies Record<string, ModelInfo>

// Unbound Security
// https://www.unboundsecurity.ai/ai-gateway
export const unboundDefaultModelId = "anthropic/claude-3-7-sonnet-20250219"
export const unboundDefaultModelInfo: ModelInfo = {
	maxTokens: 8192,
	contextWindow: 200_000,
	supportsImages: true,
	supportsPromptCache: true,
	inputPrice: 3.0,
	outputPrice: 15.0,
	cacheWritesPrice: 3.75,
	cacheReadsPrice: 0.3,
}

// LiteLLM
// https://docs.litellm.ai/
export const litellmDefaultModelId = "claude-3-7-sonnet-20250219"
export const litellmDefaultModelInfo: ModelInfo = {
	maxTokens: 8192,
	contextWindow: 200_000,
	supportsImages: true,
	supportsComputerUse: true,
	supportsPromptCache: true,
	inputPrice: 3.0,
	outputPrice: 15.0,
	cacheWritesPrice: 3.75,
	cacheReadsPrice: 0.3,
}

export const LITELLM_COMPUTER_USE_MODELS = new Set([
	"claude-3-5-sonnet-latest",
	"claude-opus-4-20250514",
	"claude-sonnet-4-20250514",
	"claude-3-7-sonnet-latest",
	"claude-3-7-sonnet-20250219",
	"claude-3-5-sonnet-20241022",
	"vertex_ai/claude-3-5-sonnet",
	"vertex_ai/claude-3-5-sonnet-v2",
	"vertex_ai/claude-3-5-sonnet-v2@20241022",
	"vertex_ai/claude-3-7-sonnet@20250219",
	"vertex_ai/claude-opus-4@20250514",
	"vertex_ai/claude-sonnet-4@20250514",
	"openrouter/anthropic/claude-3.5-sonnet",
	"openrouter/anthropic/claude-3.5-sonnet:beta",
	"openrouter/anthropic/claude-3.7-sonnet",
	"openrouter/anthropic/claude-3.7-sonnet:beta",
	"anthropic.claude-opus-4-20250514-v1:0",
	"anthropic.claude-sonnet-4-20250514-v1:0",
	"anthropic.claude-3-7-sonnet-20250219-v1:0",
	"anthropic.claude-3-5-sonnet-20241022-v2:0",
	"us.anthropic.claude-3-5-sonnet-20241022-v2:0",
	"us.anthropic.claude-3-7-sonnet-20250219-v1:0",
	"us.anthropic.claude-opus-4-20250514-v1:0",
	"us.anthropic.claude-sonnet-4-20250514-v1:0",
	"eu.anthropic.claude-3-5-sonnet-20241022-v2:0",
	"eu.anthropic.claude-3-7-sonnet-20250219-v1:0",
	"eu.anthropic.claude-opus-4-20250514-v1:0",
	"eu.anthropic.claude-sonnet-4-20250514-v1:0",
	"snowflake/claude-3-5-sonnet",
])

// xAI
// https://docs.x.ai/docs/api-reference
export type XAIModelId = keyof typeof xaiModels
export const xaiDefaultModelId: XAIModelId = "grok-3"
export const xaiModels = {
	"grok-3-beta": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 3.0,
		outputPrice: 15.0,
		description: "xAI's Grok-3 beta model with 131K context window",
	},
	"grok-3-fast-beta": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 5.0,
		outputPrice: 25.0,
		description: "xAI's Grok-3 fast beta model with 131K context window",
	},
	"grok-3-mini-beta": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.3,
		outputPrice: 0.5,
		description: "xAI's Grok-3 mini beta model with 131K context window",
		supportsReasoningEffort: true,
	},
	"grok-3-mini-fast-beta": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.6,
		outputPrice: 4.0,
		description: "xAI's Grok-3 mini fast beta model with 131K context window",
		supportsReasoningEffort: true,
	},
	"grok-3": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 3.0,
		outputPrice: 15.0,
		description: "xAI's Grok-3 model with 131K context window",
	},
	"grok-3-fast": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 5.0,
		outputPrice: 25.0,
		description: "xAI's Grok-3 fast model with 131K context window",
	},
	"grok-3-mini": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.3,
		outputPrice: 0.5,
		description: "xAI's Grok-3 mini model with 131K context window",
		supportsReasoningEffort: true,
	},
	"grok-3-mini-fast": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.6,
		outputPrice: 4.0,
		description: "xAI's Grok-3 mini fast model with 131K context window",
		supportsReasoningEffort: true,
	},
	"grok-2-latest": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 2.0,
		outputPrice: 10.0,
		description: "xAI's Grok-2 model - latest version with 131K context window",
	},
	"grok-2": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 2.0,
		outputPrice: 10.0,
		description: "xAI's Grok-2 model with 131K context window",
	},
	"grok-2-1212": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 2.0,
		outputPrice: 10.0,
		description: "xAI's Grok-2 model (version 1212) with 131K context window",
	},
	"grok-2-vision-latest": {
		maxTokens: 8192,
		contextWindow: 32768,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 2.0,
		outputPrice: 10.0,
		description: "xAI's Grok-2 Vision model - latest version with image support and 32K context window",
	},
	"grok-2-vision": {
		maxTokens: 8192,
		contextWindow: 32768,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 2.0,
		outputPrice: 10.0,
		description: "xAI's Grok-2 Vision model with image support and 32K context window",
	},
	"grok-2-vision-1212": {
		maxTokens: 8192,
		contextWindow: 32768,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 2.0,
		outputPrice: 10.0,
		description: "xAI's Grok-2 Vision model (version 1212) with image support and 32K context window",
	},
	"grok-vision-beta": {
		maxTokens: 8192,
		contextWindow: 8192,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 5.0,
		outputPrice: 15.0,
		description: "xAI's Grok Vision Beta model with image support and 8K context window",
	},
	"grok-beta": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 5.0,
		outputPrice: 15.0,
		description: "xAI's Grok Beta model (legacy) with 131K context window",
	},
} as const satisfies Record<string, ModelInfo>

export type VscodeLlmModelId = keyof typeof vscodeLlmModels
export const vscodeLlmDefaultModelId: VscodeLlmModelId = "claude-3.5-sonnet"
export const vscodeLlmModels = {
	"gpt-3.5-turbo": {
		contextWindow: 12114,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		family: "gpt-3.5-turbo",
		version: "gpt-3.5-turbo-0613",
		name: "GPT 3.5 Turbo",
		supportsToolCalling: true,
		maxInputTokens: 12114,
	},
	"gpt-4o-mini": {
		contextWindow: 12115,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		family: "gpt-4o-mini",
		version: "gpt-4o-mini-2024-07-18",
		name: "GPT-4o mini",
		supportsToolCalling: true,
		maxInputTokens: 12115,
	},
	"gpt-4": {
		contextWindow: 28501,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		family: "gpt-4",
		version: "gpt-4-0613",
		name: "GPT 4",
		supportsToolCalling: true,
		maxInputTokens: 28501,
	},
	"gpt-4-0125-preview": {
		contextWindow: 63826,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		family: "gpt-4-turbo",
		version: "gpt-4-0125-preview",
		name: "GPT 4 Turbo",
		supportsToolCalling: true,
		maxInputTokens: 63826,
	},
	"gpt-4o": {
		contextWindow: 63827,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		family: "gpt-4o",
		version: "gpt-4o-2024-11-20",
		name: "GPT-4o",
		supportsToolCalling: true,
		maxInputTokens: 63827,
	},
	o1: {
		contextWindow: 19827,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		family: "o1-ga",
		version: "o1-2024-12-17",
		name: "o1 (Preview)",
		supportsToolCalling: true,
		maxInputTokens: 19827,
	},
	"o3-mini": {
		contextWindow: 63827,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		family: "o3-mini",
		version: "o3-mini-2025-01-31",
		name: "o3-mini",
		supportsToolCalling: true,
		maxInputTokens: 63827,
	},
	"claude-3.5-sonnet": {
		contextWindow: 81638,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		family: "claude-3.5-sonnet",
		version: "claude-3.5-sonnet",
		name: "Claude 3.5 Sonnet",
		supportsToolCalling: true,
		maxInputTokens: 81638,
	},
	"gemini-2.0-flash-001": {
		contextWindow: 127827,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		family: "gemini-2.0-flash",
		version: "gemini-2.0-flash-001",
		name: "Gemini 2.0 Flash",
		supportsToolCalling: false,
		maxInputTokens: 127827,
	},
	"gemini-2.5-pro": {
		contextWindow: 63830,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		family: "gemini-2.5-pro",
		version: "gemini-2.5-pro-preview-03-25",
		name: "Gemini 2.5 Pro (Preview)",
		supportsToolCalling: true,
		maxInputTokens: 63830,
	},
	"o4-mini": {
		contextWindow: 111446,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		family: "o4-mini",
		version: "o4-mini-2025-04-16",
		name: "o4-mini (Preview)",
		supportsToolCalling: true,
		maxInputTokens: 111446,
	},
	"gpt-4.1": {
		contextWindow: 111446,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		family: "gpt-4.1",
		version: "gpt-4.1-2025-04-14",
		name: "GPT-4.1 (Preview)",
		supportsToolCalling: true,
		maxInputTokens: 111446,
	},
} as const satisfies Record<
	string,
	ModelInfo & {
		family: string
		version: string
		name: string
		supportsToolCalling: boolean
		maxInputTokens: number
	}
>

// Groq
// https://console.groq.com/docs/models
export type GroqModelId =
	| "llama-3.1-8b-instant"
	| "llama-3.3-70b-versatile"
	| "meta-llama/llama-4-scout-17b-16e-instruct"
	| "meta-llama/llama-4-maverick-17b-128e-instruct"
	| "mistral-saba-24b"
	| "qwen-qwq-32b"
	| "deepseek-r1-distill-llama-70b"
export const groqDefaultModelId: GroqModelId = "llama-3.3-70b-versatile" // Defaulting to Llama3 70B Versatile
export const groqModels = {
	// Models based on API response: https://api.groq.com/openai/v1/models
	"llama-3.1-8b-instant": {
		maxTokens: 131072,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Meta Llama 3.1 8B Instant model, 128K context.",
	},
	"llama-3.3-70b-versatile": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Meta Llama 3.3 70B Versatile model, 128K context.",
	},
	"meta-llama/llama-4-scout-17b-16e-instruct": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Meta Llama 4 Scout 17B Instruct model, 128K context.",
	},
	"meta-llama/llama-4-maverick-17b-128e-instruct": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Meta Llama 4 Maverick 17B Instruct model, 128K context.",
	},
	"mistral-saba-24b": {
		maxTokens: 32768,
		contextWindow: 32768,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Mistral Saba 24B model, 32K context.",
	},
	"qwen-qwq-32b": {
		maxTokens: 131072,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Alibaba Qwen QwQ 32B model, 128K context.",
	},
	"deepseek-r1-distill-llama-70b": {
		maxTokens: 131072,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "DeepSeek R1 Distill Llama 70B model, 128K context.",
	},
} as const satisfies Record<string, ModelInfo>

// Chutes AI
// https://llm.chutes.ai/v1 (OpenAI compatible)
export type ChutesModelId =
	| "deepseek-ai/DeepSeek-R1-0528"
	| "deepseek-ai/DeepSeek-R1"
	| "deepseek-ai/DeepSeek-V3"
	| "unsloth/Llama-3.3-70B-Instruct"
	| "chutesai/Llama-4-Scout-17B-16E-Instruct"
	| "unsloth/Mistral-Nemo-Instruct-2407"
	| "unsloth/gemma-3-12b-it"
	| "NousResearch/DeepHermes-3-Llama-3-8B-Preview"
	| "unsloth/gemma-3-4b-it"
	| "nvidia/Llama-3_3-Nemotron-Super-49B-v1"
	| "nvidia/Llama-3_1-Nemotron-Ultra-253B-v1"
	| "chutesai/Llama-4-Maverick-17B-128E-Instruct-FP8"
	| "deepseek-ai/DeepSeek-V3-Base"
	| "deepseek-ai/DeepSeek-R1-Zero"
	| "deepseek-ai/DeepSeek-V3-0324"
	| "Qwen/Qwen3-235B-A22B"
	| "Qwen/Qwen3-32B"
	| "Qwen/Qwen3-30B-A3B"
	| "Qwen/Qwen3-14B"
	| "Qwen/Qwen3-8B"
	| "microsoft/MAI-DS-R1-FP8"
	| "tngtech/DeepSeek-R1T-Chimera"

export const chutesDefaultModelId: ChutesModelId = "deepseek-ai/DeepSeek-R1-0528"
export const chutesModels = {
	"deepseek-ai/DeepSeek-R1-0528": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "DeepSeek R1 0528 model.",
	},
	"deepseek-ai/DeepSeek-R1": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "DeepSeek R1 model.",
	},
	"deepseek-ai/DeepSeek-V3": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "DeepSeek V3 model.",
	},
	"unsloth/Llama-3.3-70B-Instruct": {
		maxTokens: 32768, // From Groq
		contextWindow: 131072, // From Groq
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Unsloth Llama 3.3 70B Instruct model.",
	},
	"chutesai/Llama-4-Scout-17B-16E-Instruct": {
		maxTokens: 32768,
		contextWindow: 512000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "ChutesAI Llama 4 Scout 17B Instruct model, 512K context.",
	},
	"unsloth/Mistral-Nemo-Instruct-2407": {
		maxTokens: 32768,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Unsloth Mistral Nemo Instruct model.",
	},
	"unsloth/gemma-3-12b-it": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Unsloth Gemma 3 12B IT model.",
	},
	"NousResearch/DeepHermes-3-Llama-3-8B-Preview": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Nous DeepHermes 3 Llama 3 8B Preview model.",
	},
	"unsloth/gemma-3-4b-it": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Unsloth Gemma 3 4B IT model.",
	},
	"nvidia/Llama-3_3-Nemotron-Super-49B-v1": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Nvidia Llama 3.3 Nemotron Super 49B model.",
	},
	"nvidia/Llama-3_1-Nemotron-Ultra-253B-v1": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Nvidia Llama 3.1 Nemotron Ultra 253B model.",
	},
	"chutesai/Llama-4-Maverick-17B-128E-Instruct-FP8": {
		maxTokens: 32768,
		contextWindow: 256000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "ChutesAI Llama 4 Maverick 17B Instruct FP8 model.",
	},
	"deepseek-ai/DeepSeek-V3-Base": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "DeepSeek V3 Base model.",
	},
	"deepseek-ai/DeepSeek-R1-Zero": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "DeepSeek R1 Zero model.",
	},
	"deepseek-ai/DeepSeek-V3-0324": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "DeepSeek V3 (0324) model.",
	},
	"Qwen/Qwen3-235B-A22B": {
		maxTokens: 32768,
		contextWindow: 40960,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Qwen3 235B A22B model.",
	},
	"Qwen/Qwen3-32B": {
		maxTokens: 32768,
		contextWindow: 40960,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Qwen3 32B model.",
	},
	"Qwen/Qwen3-30B-A3B": {
		maxTokens: 32768,
		contextWindow: 40960,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Qwen3 30B A3B model.",
	},
	"Qwen/Qwen3-14B": {
		maxTokens: 32768,
		contextWindow: 40960,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Qwen3 14B model.",
	},
	"Qwen/Qwen3-8B": {
		maxTokens: 32768,
		contextWindow: 40960,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Qwen3 8B model.",
	},
	"microsoft/MAI-DS-R1-FP8": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Microsoft MAI-DS-R1 FP8 model.",
	},
	"tngtech/DeepSeek-R1T-Chimera": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "TNGTech DeepSeek R1T Chimera model.",
	},
} as const satisfies Record<string, ModelInfo>

/**
 * Constants
 */

// These models support prompt caching.
export const OPEN_ROUTER_PROMPT_CACHING_MODELS = new Set([
	"anthropic/claude-3-haiku",
	"anthropic/claude-3-haiku:beta",
	"anthropic/claude-3-opus",
	"anthropic/claude-3-opus:beta",
	"anthropic/claude-3-sonnet",
	"anthropic/claude-3-sonnet:beta",
	"anthropic/claude-3.5-haiku",
	"anthropic/claude-3.5-haiku-20241022",
	"anthropic/claude-3.5-haiku-20241022:beta",
	"anthropic/claude-3.5-haiku:beta",
	"anthropic/claude-3.5-sonnet",
	"anthropic/claude-3.5-sonnet-20240620",
	"anthropic/claude-3.5-sonnet-20240620:beta",
	"anthropic/claude-3.5-sonnet:beta",
	"anthropic/claude-3.7-sonnet",
	"anthropic/claude-3.7-sonnet:beta",
	"anthropic/claude-3.7-sonnet:thinking",
	"anthropic/claude-sonnet-4",
	"anthropic/claude-opus-4",
	"google/gemini-2.5-pro-preview",
	"google/gemini-2.5-flash-preview",
	"google/gemini-2.5-flash-preview:thinking",
	"google/gemini-2.5-flash-preview-05-20",
	"google/gemini-2.5-flash-preview-05-20:thinking",
	"google/gemini-2.0-flash-001",
	"google/gemini-flash-1.5",
	"google/gemini-flash-1.5-8b",
])

// https://www.anthropic.com/news/3-5-models-and-computer-use
export const OPEN_ROUTER_COMPUTER_USE_MODELS = new Set([
	"anthropic/claude-3.5-sonnet",
	"anthropic/claude-3.5-sonnet:beta",
	"anthropic/claude-3.7-sonnet",
	"anthropic/claude-3.7-sonnet:beta",
	"anthropic/claude-3.7-sonnet:thinking",
	"anthropic/claude-sonnet-4",
	"anthropic/claude-opus-4",
])

export const OPEN_ROUTER_REASONING_BUDGET_MODELS = new Set([
	"anthropic/claude-3.7-sonnet:beta",
	"anthropic/claude-3.7-sonnet:thinking",
	"anthropic/claude-opus-4",
	"anthropic/claude-sonnet-4",
	"google/gemini-2.5-flash-preview-05-20",
	"google/gemini-2.5-flash-preview-05-20:thinking",
])

export const OPEN_ROUTER_REQUIRED_REASONING_BUDGET_MODELS = new Set([
	"anthropic/claude-3.7-sonnet:thinking",
	"google/gemini-2.5-flash-preview-05-20:thinking",
])

const routerNames = ["openrouter", "requesty", "glama", "unbound", "litellm"] as const

export type RouterName = (typeof routerNames)[number]

export const isRouterName = (value: string): value is RouterName => routerNames.includes(value as RouterName)

export function toRouterName(value?: string): RouterName {
	if (value && isRouterName(value)) {
		return value
	}

	throw new Error(`Invalid router name: ${value}`)
}

export type ModelRecord = Record<string, ModelInfo>

export type RouterModels = Record<RouterName, ModelRecord>

export const shouldUseReasoningBudget = ({
	model,
	settings,
}: {
	model: ModelInfo
	settings?: ProviderSettings
}): boolean => !!model.requiredReasoningBudget || (!!model.supportsReasoningBudget && !!settings?.enableReasoningEffort)

export const shouldUseReasoningEffort = ({
	model,
	settings,
}: {
	model: ModelInfo
	settings?: ProviderSettings
}): boolean => (!!model.supportsReasoningEffort && !!settings?.reasoningEffort) || !!model.reasoningEffort

export const DEFAULT_HYBRID_REASONING_MODEL_MAX_TOKENS = 16_384
export const DEFAULT_HYBRID_REASONING_MODEL_THINKING_TOKENS = 8_192

export const getModelMaxOutputTokens = ({
	modelId,
	model,
	settings,
}: {
	modelId: string
	model: ModelInfo
	settings?: ProviderSettings
}): number | undefined => {
	if (shouldUseReasoningBudget({ model, settings })) {
		return settings?.modelMaxTokens || DEFAULT_HYBRID_REASONING_MODEL_MAX_TOKENS
	}

	const isAnthropicModel = modelId.includes("claude")

	// For "Hybrid" reasoning models, we should discard the model's actual
	// `maxTokens` value if we're not using reasoning. We do this for Anthropic
	// models only for now. Should we do this for Gemini too?
	if (model.supportsReasoningBudget && isAnthropicModel) {
		return ANTHROPIC_DEFAULT_MAX_TOKENS
	}

	return model.maxTokens ?? undefined
}

/**
 * Options for fetching models from different providers.
 * This is a discriminated union type where the provider property determines
 * which other properties are required.
 */
export type GetModelsOptions =
	| { provider: "openrouter" }
	| { provider: "glama" }
	| { provider: "requesty"; apiKey?: string }
	| { provider: "unbound"; apiKey?: string }
	| { provider: "litellm"; apiKey: string; baseUrl: string }
