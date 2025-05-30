import type { LanguageModelChatSelector } from "../api/providers/types"

export type ApiProvider =
	| "anthropic"
	| "openrouter"
	| "bedrock"
	| "vertex"
	| "openai"
	| "ollama"
	| "lmstudio"
	| "gemini"
	| "openai-native"
	| "requesty"
	| "together"
	| "deepseek"
	| "qwen"
	| "doubao"
	| "mistral"
	| "vscode-lm"
	| "cline"
	| "litellm"
	| "nebius"
	| "fireworks"
	| "asksage"
	| "xai"
	| "sambanova"
	| "cerebras"

export interface ApiHandlerOptions {
	apiModelId?: string
	apiKey?: string // anthropic
	clineApiKey?: string
	taskId?: string // Used to identify the task in API requests
	liteLlmBaseUrl?: string
	liteLlmModelId?: string
	liteLlmApiKey?: string
	liteLlmUsePromptCache?: boolean
	openAiHeaders?: Record<string, string> // Custom headers for OpenAI requests
	liteLlmModelInfo?: LiteLLMModelInfo
	anthropicBaseUrl?: string
	openRouterApiKey?: string
	openRouterModelId?: string
	openRouterModelInfo?: ModelInfo
	openRouterProviderSorting?: string
	awsAccessKey?: string
	awsSecretKey?: string
	awsSessionToken?: string
	awsRegion?: string
	awsUseCrossRegionInference?: boolean
	awsBedrockUsePromptCache?: boolean
	awsUseProfile?: boolean
	awsProfile?: string
	awsBedrockEndpoint?: string
	awsBedrockCustomSelected?: boolean
	awsBedrockCustomModelBaseId?: BedrockModelId
	vertexProjectId?: string
	vertexRegion?: string
	openAiBaseUrl?: string
	openAiApiKey?: string
	openAiModelId?: string
	openAiModelInfo?: OpenAiCompatibleModelInfo
	ollamaModelId?: string
	ollamaBaseUrl?: string
	ollamaApiOptionsCtxNum?: string
	lmStudioModelId?: string
	lmStudioBaseUrl?: string
	geminiApiKey?: string
	geminiBaseUrl?: string
	openAiNativeApiKey?: string
	deepSeekApiKey?: string
	requestyApiKey?: string
	requestyModelId?: string
	requestyModelInfo?: ModelInfo
	togetherApiKey?: string
	togetherModelId?: string
	fireworksApiKey?: string
	fireworksModelId?: string
	fireworksModelMaxCompletionTokens?: number
	fireworksModelMaxTokens?: number
	qwenApiKey?: string
	doubaoApiKey?: string
	mistralApiKey?: string
	azureApiVersion?: string
	vsCodeLmModelSelector?: LanguageModelChatSelector
	qwenApiLine?: string
	nebiusApiKey?: string
	asksageApiUrl?: string
	asksageApiKey?: string
	xaiApiKey?: string
	thinkingBudgetTokens?: number
	reasoningEffort?: string
	sambanovaApiKey?: string
	cerebrasApiKey?: string
	requestTimeoutMs?: number
	onRetryAttempt?: (attempt: number, maxRetries: number, delay: number, error: any) => void
}

export type ApiConfiguration = ApiHandlerOptions & {
	apiProvider?: ApiProvider
	favoritedModelIds?: string[]
}

// Models

interface PriceTier {
	tokenLimit: number // Upper limit (inclusive) of *input* tokens for this price. Use Infinity for the highest tier.
	price: number // Price per million tokens for this tier.
}

export interface ModelInfo {
	maxTokens?: number
	contextWindow?: number
	supportsImages?: boolean
	supportsPromptCache: boolean // this value is hardcoded for now
	inputPrice?: number // Keep for non-tiered input models
	outputPrice?: number // Keep for non-tiered output models
	thinkingConfig?: {
		maxBudget?: number // Max allowed thinking budget tokens
		outputPrice?: number // Output price per million tokens when budget > 0
		outputPriceTiers?: PriceTier[] // Optional: Tiered output price when budget > 0
	}
	supportsGlobalEndpoint?: boolean // Whether the model supports a global endpoint with Vertex AI
	cacheWritesPrice?: number
	cacheReadsPrice?: number
	description?: string
	tiers?: {
		contextWindow: number
		inputPrice?: number
		outputPrice?: number
		cacheWritesPrice?: number
		cacheReadsPrice?: number
	}[]
}

export interface OpenAiCompatibleModelInfo extends ModelInfo {
	temperature?: number
	isR1FormatRequired?: boolean
}

// Anthropic
// https://docs.anthropic.com/en/docs/about-claude/models // prices updated 2025-01-02
export type AnthropicModelId = keyof typeof anthropicModels
export const anthropicDefaultModelId: AnthropicModelId = "claude-sonnet-4-20250514"
export const anthropicModels = {
	"claude-sonnet-4-20250514": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,

		supportsPromptCache: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
	},
	"claude-opus-4-20250514": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 15.0,
		outputPrice: 75.0,
		cacheWritesPrice: 18.75,
		cacheReadsPrice: 1.5,
	},
	"claude-3-7-sonnet-20250219": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,

		supportsPromptCache: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
	},
	"claude-3-5-sonnet-20241022": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,

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
		inputPrice: 0.8,
		outputPrice: 4.0,
		cacheWritesPrice: 1.0,
		cacheReadsPrice: 0.08,
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

// AWS Bedrock
// https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html
export type BedrockModelId = keyof typeof bedrockModels
export const bedrockDefaultModelId: BedrockModelId = "anthropic.claude-sonnet-4-20250514-v1:0"
export const bedrockModels = {
	"anthropic.claude-sonnet-4-20250514-v1:0": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
	},
	"anthropic.claude-opus-4-20250514-v1:0": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 15.0,
		outputPrice: 75.0,
		cacheWritesPrice: 18.75,
		cacheReadsPrice: 1.5,
	},
	"amazon.nova-premier-v1:0": {
		maxTokens: 10_000,
		contextWindow: 1_000_000,
		supportsImages: true,

		supportsPromptCache: false,
		inputPrice: 2.5,
		outputPrice: 12.5,
	},
	"amazon.nova-pro-v1:0": {
		maxTokens: 5000,
		contextWindow: 300_000,
		supportsImages: true,

		supportsPromptCache: true,
		inputPrice: 0.8,
		outputPrice: 3.2,
		// cacheWritesPrice: 3.2, // not written
		cacheReadsPrice: 0.2,
	},
	"amazon.nova-lite-v1:0": {
		maxTokens: 5000,
		contextWindow: 300_000,
		supportsImages: true,

		supportsPromptCache: true,
		inputPrice: 0.06,
		outputPrice: 0.24,
		// cacheWritesPrice: 0.24, // not written
		cacheReadsPrice: 0.015,
	},
	"amazon.nova-micro-v1:0": {
		maxTokens: 5000,
		contextWindow: 128_000,
		supportsImages: false,

		supportsPromptCache: true,
		inputPrice: 0.035,
		outputPrice: 0.14,
		// cacheWritesPrice: 0.14, // not written
		cacheReadsPrice: 0.00875,
	},
	"anthropic.claude-3-7-sonnet-20250219-v1:0": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,

		supportsPromptCache: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
	},
	"anthropic.claude-3-5-sonnet-20241022-v2:0": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,

		supportsPromptCache: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
	},
	"anthropic.claude-3-5-haiku-20241022-v1:0": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.8,
		outputPrice: 4.0,
		cacheWritesPrice: 1.0,
		cacheReadsPrice: 0.08,
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
	"deepseek.r1-v1:0": {
		maxTokens: 8_000,
		contextWindow: 64_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 1.35,
		outputPrice: 5.4,
	},
} as const satisfies Record<string, ModelInfo>

// OpenRouter
// https://openrouter.ai/models?order=newest&supported_parameters=tools
export const openRouterDefaultModelId = "anthropic/claude-3.7-sonnet" // will always exist in openRouterModels
export const openRouterDefaultModelInfo: ModelInfo = {
	maxTokens: 8192,
	contextWindow: 200_000,
	supportsImages: true,

	supportsPromptCache: true,
	inputPrice: 3.0,
	outputPrice: 15.0,
	cacheWritesPrice: 3.75,
	cacheReadsPrice: 0.3,
	description:
		"Claude 3.7 Sonnet is an advanced large language model with improved reasoning, coding, and problem-solving capabilities. It introduces a hybrid reasoning approach, allowing users to choose between rapid responses and extended, step-by-step processing for complex tasks. The model demonstrates notable improvements in coding, particularly in front-end development and full-stack updates, and excels in agentic workflows, where it can autonomously navigate multi-step processes. \n\nClaude 3.7 Sonnet maintains performance parity with its predecessor in standard mode while offering an extended reasoning mode for enhanced accuracy in math, coding, and instruction-following tasks.\n\nRead more at the [blog post here](https://www.anthropic.com/news/claude-3-7-sonnet)",
}
// Vertex AI
// https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude
// https://cloud.google.com/vertex-ai/generative-ai/pricing#partner-models
export type VertexModelId = keyof typeof vertexModels
export const vertexDefaultModelId: VertexModelId = "claude-sonnet-4@20250514"
export const vertexModels = {
	"claude-sonnet-4@20250514": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
	},
	"claude-opus-4@20250514": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 15.0,
		outputPrice: 75.0,
		cacheWritesPrice: 18.75,
		cacheReadsPrice: 1.5,
	},
	"claude-3-7-sonnet@20250219": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
		thinkingConfig: {
			maxBudget: 64000,
			outputPrice: 15.0,
		},
	},
	"claude-3-5-sonnet-v2@20241022": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,

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
	"gemini-2.0-flash-001": {
		maxTokens: 8192,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		supportsGlobalEndpoint: true,
		inputPrice: 0.15,
		outputPrice: 0.6,
		cacheWritesPrice: 1.0,
		cacheReadsPrice: 0.025,
	},
	"gemini-2.0-flash-lite-001": {
		maxTokens: 8192,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: false,
		supportsGlobalEndpoint: true,
		inputPrice: 0.075,
		outputPrice: 0.3,
	},
	"gemini-2.0-flash-thinking-exp-1219": {
		maxTokens: 8192,
		contextWindow: 32_767,
		supportsImages: true,
		supportsPromptCache: false,
		supportsGlobalEndpoint: true,
		inputPrice: 0,
		outputPrice: 0,
	},
	"gemini-2.0-flash-exp": {
		maxTokens: 8192,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: false,
		supportsGlobalEndpoint: true,
		inputPrice: 0,
		outputPrice: 0,
	},
	"gemini-2.5-pro-exp-03-25": {
		maxTokens: 65536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
	},
	"gemini-2.5-pro-preview-05-06": {
		maxTokens: 65536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		supportsGlobalEndpoint: true,
		inputPrice: 2.5,
		outputPrice: 15,
		cacheReadsPrice: 0.31,
		tiers: [
			{
				contextWindow: 200000,
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
	"gemini-2.5-flash-preview-04-17": {
		maxTokens: 65536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		supportsGlobalEndpoint: true,
		inputPrice: 0.15,
		outputPrice: 0.6,
		thinkingConfig: {
			maxBudget: 24576,
			outputPrice: 3.5,
		},
	},
	"gemini-2.5-flash-preview-05-20": {
		maxTokens: 65536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		supportsGlobalEndpoint: true,
		inputPrice: 0.15,
		outputPrice: 0.6,
		thinkingConfig: {
			maxBudget: 24576,
			outputPrice: 3.5,
		},
	},
	"gemini-2.0-flash-thinking-exp-01-21": {
		maxTokens: 65_536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: false,
		supportsGlobalEndpoint: true,
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
	"gemini-1.5-flash-002": {
		maxTokens: 8192,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.15,
		outputPrice: 0.6,
		cacheWritesPrice: 1.0,
		cacheReadsPrice: 0.0375,
		tiers: [
			{
				contextWindow: 128000,
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
		inputPrice: 1.25,
		outputPrice: 5,
	},
	"gemini-1.5-pro-exp-0827": {
		maxTokens: 8192,
		contextWindow: 2_097_152,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
	},
} as const satisfies Record<string, ModelInfo>

export const vertexGlobalModels: Record<string, ModelInfo> = Object.fromEntries(
	Object.entries(vertexModels).filter(([_k, v]) => v.hasOwnProperty("supportsGlobalEndpoint")),
) as Record<string, ModelInfo>

export const openAiModelInfoSaneDefaults: OpenAiCompatibleModelInfo = {
	maxTokens: -1,
	contextWindow: 128_000,
	supportsImages: true,
	supportsPromptCache: false,
	isR1FormatRequired: false,
	inputPrice: 0,
	outputPrice: 0,
	temperature: 0,
}

// Gemini
// https://ai.google.dev/gemini-api/docs/models/gemini
export type GeminiModelId = keyof typeof geminiModels
export const geminiDefaultModelId: GeminiModelId = "gemini-2.0-flash-001"
export const geminiModels = {
	"gemini-2.5-pro-preview-05-06": {
		maxTokens: 65536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 2.5,
		outputPrice: 15,
		cacheReadsPrice: 0.31,
		tiers: [
			{
				contextWindow: 200000,
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
	"gemini-2.5-flash-preview-05-20": {
		maxTokens: 65536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.15,
		outputPrice: 0.6,
		thinkingConfig: {
			maxBudget: 24576,
			outputPrice: 3.5,
		},
	},
	"gemini-2.5-flash-preview-04-17": {
		maxTokens: 65536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.15,
		outputPrice: 0.6,
		thinkingConfig: {
			maxBudget: 24576,
			outputPrice: 3.5,
		},
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
		inputPrice: 0.15, // Default price (highest tier)
		outputPrice: 0.6, // Default price (highest tier)
		cacheReadsPrice: 0.0375,
		cacheWritesPrice: 1.0,
		tiers: [
			{
				contextWindow: 128000,
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
	o3: {
		maxTokens: 100_000,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 10.0,
		outputPrice: 40.0,
		cacheReadsPrice: 2.5,
	},
	"o4-mini": {
		maxTokens: 100_000,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 1.1,
		outputPrice: 4.4,
		cacheReadsPrice: 0.275,
	},
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
	"o3-mini": {
		maxTokens: 100_000,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 1.1,
		outputPrice: 4.4,
		cacheReadsPrice: 0.55,
	},
	// don't support tool use yet
	o1: {
		maxTokens: 100_000,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: false,
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
	"gpt-4o": {
		maxTokens: 4_096,
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
	"chatgpt-4o-latest": {
		maxTokens: 16_384,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 5,
		outputPrice: 15,
	},
	"gpt-4.5-preview": {
		maxTokens: 16_384,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 75,
		outputPrice: 150,
	},
} as const satisfies Record<string, ModelInfo>

// Azure OpenAI
// https://learn.microsoft.com/en-us/azure/ai-services/openai/api-version-deprecation
// https://learn.microsoft.com/en-us/azure/ai-services/openai/reference#api-specs
export const azureOpenAiDefaultApiVersion = "2024-08-01-preview"

// DeepSeek
// https://api-docs.deepseek.com/quick_start/pricing
export type DeepSeekModelId = keyof typeof deepSeekModels
export const deepSeekDefaultModelId: DeepSeekModelId = "deepseek-chat"
export const deepSeekModels = {
	"deepseek-chat": {
		maxTokens: 8_000,
		contextWindow: 64_000,
		supportsImages: false,
		supportsPromptCache: true, // supports context caching, but not in the way anthropic does it (deepseek reports input tokens and reads/writes in the same usage report) FIXME: we need to show users cache stats how deepseek does it
		inputPrice: 0, // technically there is no input price, it's all either a cache hit or miss (ApiOptions will not show this). Input is the sum of cache reads and writes
		outputPrice: 1.1,
		cacheWritesPrice: 0.27,
		cacheReadsPrice: 0.07,
	},
	"deepseek-reasoner": {
		maxTokens: 8_000,
		contextWindow: 64_000,
		supportsImages: false,
		supportsPromptCache: true, // supports context caching, but not in the way anthropic does it (deepseek reports input tokens and reads/writes in the same usage report) FIXME: we need to show users cache stats how deepseek does it
		inputPrice: 0, // technically there is no input price, it's all either a cache hit or miss (ApiOptions will not show this)
		outputPrice: 2.19,
		cacheWritesPrice: 0.55,
		cacheReadsPrice: 0.14,
	},
} as const satisfies Record<string, ModelInfo>

// Qwen
// https://bailian.console.aliyun.com/
export type MainlandQwenModelId = keyof typeof mainlandQwenModels
export type InternationalQwenModelId = keyof typeof internationalQwenModels
export const internationalQwenDefaultModelId: InternationalQwenModelId = "qwen-coder-plus-latest"
export const mainlandQwenDefaultModelId: MainlandQwenModelId = "qwen-coder-plus-latest"
export const internationalQwenModels = {
	"qwen2.5-coder-32b-instruct": {
		maxTokens: 8_192,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.002,
		outputPrice: 0.006,
		cacheWritesPrice: 0.002,
		cacheReadsPrice: 0.006,
	},
	"qwen2.5-coder-14b-instruct": {
		maxTokens: 8_192,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.002,
		outputPrice: 0.006,
		cacheWritesPrice: 0.002,
		cacheReadsPrice: 0.006,
	},
	"qwen2.5-coder-7b-instruct": {
		maxTokens: 8_192,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.001,
		outputPrice: 0.002,
		cacheWritesPrice: 0.001,
		cacheReadsPrice: 0.002,
	},
	"qwen2.5-coder-3b-instruct": {
		maxTokens: 8_192,
		contextWindow: 32_768,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.0,
		outputPrice: 0.0,
		cacheWritesPrice: 0.0,
		cacheReadsPrice: 0.0,
	},
	"qwen2.5-coder-1.5b-instruct": {
		maxTokens: 8_192,
		contextWindow: 32_768,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.0,
		outputPrice: 0.0,
		cacheWritesPrice: 0.0,
		cacheReadsPrice: 0.0,
	},
	"qwen2.5-coder-0.5b-instruct": {
		maxTokens: 8_192,
		contextWindow: 32_768,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.0,
		outputPrice: 0.0,
		cacheWritesPrice: 0.0,
		cacheReadsPrice: 0.0,
	},
	"qwen-coder-plus-latest": {
		maxTokens: 129_024,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 3.5,
		outputPrice: 7,
		cacheWritesPrice: 3.5,
		cacheReadsPrice: 7,
	},
	"qwen-plus-latest": {
		maxTokens: 129_024,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.8,
		outputPrice: 2,
		cacheWritesPrice: 0.8,
		cacheReadsPrice: 0.2,
	},
	"qwen-turbo-latest": {
		maxTokens: 1_000_000,
		contextWindow: 1_000_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.8,
		outputPrice: 2,
		cacheWritesPrice: 0.8,
		cacheReadsPrice: 2,
	},
	"qwen-max-latest": {
		maxTokens: 30_720,
		contextWindow: 32_768,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 2.4,
		outputPrice: 9.6,
		cacheWritesPrice: 2.4,
		cacheReadsPrice: 9.6,
	},
	"qwen-coder-plus": {
		maxTokens: 129_024,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 3.5,
		outputPrice: 7,
		cacheWritesPrice: 3.5,
		cacheReadsPrice: 7,
	},
	"qwen-plus": {
		maxTokens: 129_024,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.8,
		outputPrice: 2,
		cacheWritesPrice: 0.8,
		cacheReadsPrice: 0.2,
	},
	"qwen-turbo": {
		maxTokens: 1_000_000,
		contextWindow: 1_000_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.3,
		outputPrice: 0.6,
		cacheWritesPrice: 0.3,
		cacheReadsPrice: 0.6,
	},
	"qwen-max": {
		maxTokens: 30_720,
		contextWindow: 32_768,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 2.4,
		outputPrice: 9.6,
		cacheWritesPrice: 2.4,
		cacheReadsPrice: 9.6,
	},
	"deepseek-v3": {
		maxTokens: 8_000,
		contextWindow: 64_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0,
		outputPrice: 0.28,
		cacheWritesPrice: 0.14,
		cacheReadsPrice: 0.014,
	},
	"deepseek-r1": {
		maxTokens: 8_000,
		contextWindow: 64_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0,
		outputPrice: 2.19,
		cacheWritesPrice: 0.55,
		cacheReadsPrice: 0.14,
	},
	"qwen-vl-max": {
		maxTokens: 30_720,
		contextWindow: 32_768,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 3,
		outputPrice: 9,
		cacheWritesPrice: 3,
		cacheReadsPrice: 9,
	},
	"qwen-vl-max-latest": {
		maxTokens: 129_024,
		contextWindow: 131_072,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 3,
		outputPrice: 9,
		cacheWritesPrice: 3,
		cacheReadsPrice: 9,
	},
	"qwen-vl-plus": {
		maxTokens: 6_000,
		contextWindow: 8_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 1.5,
		outputPrice: 4.5,
		cacheWritesPrice: 1.5,
		cacheReadsPrice: 4.5,
	},
	"qwen-vl-plus-latest": {
		maxTokens: 129_024,
		contextWindow: 131_072,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 1.5,
		outputPrice: 4.5,
		cacheWritesPrice: 1.5,
		cacheReadsPrice: 4.5,
	},
} as const satisfies Record<string, ModelInfo>

export const mainlandQwenModels = {
	"qwen2.5-coder-32b-instruct": {
		maxTokens: 8_192,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.002,
		outputPrice: 0.006,
		cacheWritesPrice: 0.002,
		cacheReadsPrice: 0.006,
	},
	"qwen2.5-coder-14b-instruct": {
		maxTokens: 8_192,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.002,
		outputPrice: 0.006,
		cacheWritesPrice: 0.002,
		cacheReadsPrice: 0.006,
	},
	"qwen2.5-coder-7b-instruct": {
		maxTokens: 8_192,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.001,
		outputPrice: 0.002,
		cacheWritesPrice: 0.001,
		cacheReadsPrice: 0.002,
	},
	"qwen2.5-coder-3b-instruct": {
		maxTokens: 8_192,
		contextWindow: 32_768,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.0,
		outputPrice: 0.0,
		cacheWritesPrice: 0.0,
		cacheReadsPrice: 0.0,
	},
	"qwen2.5-coder-1.5b-instruct": {
		maxTokens: 8_192,
		contextWindow: 32_768,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.0,
		outputPrice: 0.0,
		cacheWritesPrice: 0.0,
		cacheReadsPrice: 0.0,
	},
	"qwen2.5-coder-0.5b-instruct": {
		maxTokens: 8_192,
		contextWindow: 32_768,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.0,
		outputPrice: 0.0,
		cacheWritesPrice: 0.0,
		cacheReadsPrice: 0.0,
	},
	"qwen-coder-plus-latest": {
		maxTokens: 129_024,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 3.5,
		outputPrice: 7,
		cacheWritesPrice: 3.5,
		cacheReadsPrice: 7,
	},
	"qwen-plus-latest": {
		maxTokens: 129_024,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.8,
		outputPrice: 2,
		cacheWritesPrice: 0.8,
		cacheReadsPrice: 0.2,
	},
	"qwen-turbo-latest": {
		maxTokens: 1_000_000,
		contextWindow: 1_000_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.8,
		outputPrice: 2,
		cacheWritesPrice: 0.8,
		cacheReadsPrice: 2,
	},
	"qwen-max-latest": {
		maxTokens: 30_720,
		contextWindow: 32_768,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 2.4,
		outputPrice: 9.6,
		cacheWritesPrice: 2.4,
		cacheReadsPrice: 9.6,
	},
	"qwq-plus-latest": {
		maxTokens: 8_192,
		contextWindow: 131_071,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.0,
		outputPrice: 0.0,
		cacheWritesPrice: 0.0,
		cacheReadsPrice: 0.0,
	},
	"qwq-plus": {
		maxTokens: 8_192,
		contextWindow: 131_071,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.0,
		outputPrice: 0.0,
		cacheWritesPrice: 0.0,
		cacheReadsPrice: 0.0,
	},
	"qwen-coder-plus": {
		maxTokens: 129_024,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 3.5,
		outputPrice: 7,
		cacheWritesPrice: 3.5,
		cacheReadsPrice: 7,
	},
	"qwen-plus": {
		maxTokens: 129_024,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.8,
		outputPrice: 2,
		cacheWritesPrice: 0.8,
		cacheReadsPrice: 0.2,
	},
	"qwen-turbo": {
		maxTokens: 1_000_000,
		contextWindow: 1_000_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.3,
		outputPrice: 0.6,
		cacheWritesPrice: 0.3,
		cacheReadsPrice: 0.6,
	},
	"qwen-max": {
		maxTokens: 30_720,
		contextWindow: 32_768,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 2.4,
		outputPrice: 9.6,
		cacheWritesPrice: 2.4,
		cacheReadsPrice: 9.6,
	},
	"deepseek-v3": {
		maxTokens: 8_000,
		contextWindow: 64_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0,
		outputPrice: 0.28,
		cacheWritesPrice: 0.14,
		cacheReadsPrice: 0.014,
	},
	"deepseek-r1": {
		maxTokens: 8_000,
		contextWindow: 64_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0,
		outputPrice: 2.19,
		cacheWritesPrice: 0.55,
		cacheReadsPrice: 0.14,
	},
	"qwen-vl-max": {
		maxTokens: 30_720,
		contextWindow: 32_768,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 3,
		outputPrice: 9,
		cacheWritesPrice: 3,
		cacheReadsPrice: 9,
	},
	"qwen-vl-max-latest": {
		maxTokens: 129_024,
		contextWindow: 131_072,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 3,
		outputPrice: 9,
		cacheWritesPrice: 3,
		cacheReadsPrice: 9,
	},
	"qwen-vl-plus": {
		maxTokens: 6_000,
		contextWindow: 8_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 1.5,
		outputPrice: 4.5,
		cacheWritesPrice: 1.5,
		cacheReadsPrice: 4.5,
	},
	"qwen-vl-plus-latest": {
		maxTokens: 129_024,
		contextWindow: 131_072,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 1.5,
		outputPrice: 4.5,
		cacheWritesPrice: 1.5,
		cacheReadsPrice: 4.5,
	},
} as const satisfies Record<string, ModelInfo>

// Doubao
// https://www.volcengine.com/docs/82379/1298459
// https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement
export type DoubaoModelId = keyof typeof doubaoModels
export const doubaoDefaultModelId: DoubaoModelId = "doubao-1-5-pro-256k-250115"
export const doubaoModels = {
	"doubao-1-5-pro-256k-250115": {
		maxTokens: 12_288,
		contextWindow: 256_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.7,
		outputPrice: 1.3,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
	},
	"doubao-1-5-pro-32k-250115": {
		maxTokens: 12_288,
		contextWindow: 32_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.11,
		outputPrice: 0.3,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
	},
	"deepseek-v3-250324": {
		maxTokens: 12_288,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.55,
		outputPrice: 2.19,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
	},
	"deepseek-r1-250120": {
		maxTokens: 32_768,
		contextWindow: 64_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.27,
		outputPrice: 1.09,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
	},
} as const satisfies Record<string, ModelInfo>

// Mistral
// https://docs.mistral.ai/getting-started/models/models_overview/
export type MistralModelId = keyof typeof mistralModels
export const mistralDefaultModelId: MistralModelId = "devstral-small-2505"
export const mistralModels = {
	"mistral-large-2411": {
		maxTokens: 131_000,
		contextWindow: 131_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 2.0,
		outputPrice: 6.0,
	},
	"pixtral-large-2411": {
		maxTokens: 131_000,
		contextWindow: 131_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 2.0,
		outputPrice: 6.0,
	},
	"ministral-3b-2410": {
		maxTokens: 131_000,
		contextWindow: 131_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.04,
		outputPrice: 0.04,
	},
	"ministral-8b-2410": {
		maxTokens: 131_000,
		contextWindow: 131_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.1,
		outputPrice: 0.1,
	},
	"mistral-small-latest": {
		maxTokens: 131_000,
		contextWindow: 131_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0.1,
		outputPrice: 0.3,
	},
	"mistral-medium-latest": {
		maxTokens: 128_000,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0.4,
		outputPrice: 2.0,
	},
	"mistral-small-2501": {
		maxTokens: 32_000,
		contextWindow: 32_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.1,
		outputPrice: 0.3,
	},
	"pixtral-12b-2409": {
		maxTokens: 131_000,
		contextWindow: 131_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0.15,
		outputPrice: 0.15,
	},
	"open-mistral-nemo-2407": {
		maxTokens: 131_000,
		contextWindow: 131_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.15,
		outputPrice: 0.15,
	},
	"open-codestral-mamba": {
		maxTokens: 256_000,
		contextWindow: 256_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.15,
		outputPrice: 0.15,
	},
	"codestral-2501": {
		maxTokens: 256_000,
		contextWindow: 256_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.3,
		outputPrice: 0.9,
	},
	"devstral-small-2505": {
		maxTokens: 128_000,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.1,
		outputPrice: 0.3,
	},
} as const satisfies Record<string, ModelInfo>

// LiteLLM
// https://docs.litellm.ai/docs/
export type LiteLLMModelId = string
export const liteLlmDefaultModelId = "anthropic/claude-3-7-sonnet-20250219"
export interface LiteLLMModelInfo extends ModelInfo {
	temperature?: number
}

export const liteLlmModelInfoSaneDefaults: LiteLLMModelInfo = {
	maxTokens: -1,
	contextWindow: 128_000,
	supportsImages: true,
	supportsPromptCache: true,
	inputPrice: 0,
	outputPrice: 0,
	cacheWritesPrice: 0,
	cacheReadsPrice: 0,
	temperature: 0,
}

// AskSage Models
// https://docs.asksage.ai/
export type AskSageModelId = keyof typeof askSageModels
export const askSageDefaultModelId: AskSageModelId = "claude-35-sonnet"
export const askSageDefaultURL: string = "https://api.asksage.ai/server"
export const askSageModels = {
	"gpt-4o": {
		maxTokens: 4096,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
	},
	"gpt-4o-gov": {
		maxTokens: 4096,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
	},
	"claude-35-sonnet": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
	},
	"aws-bedrock-claude-35-sonnet-gov": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
	},
	"claude-37-sonnet": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
	},
}

// Nebius AI Studio
// https://docs.nebius.com/studio/inference/models
export const nebiusModels = {
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
	"meta-llama/Llama-3.3-70B-Instruct-fast": {
		maxTokens: 32_000,
		contextWindow: 96_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.25,
		outputPrice: 0.75,
	},
	"Qwen/Qwen2.5-32B-Instruct-fast": {
		maxTokens: 8_192,
		contextWindow: 32_768,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.13,
		outputPrice: 0.4,
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
} as const satisfies Record<string, ModelInfo>
export type NebiusModelId = keyof typeof nebiusModels
export const nebiusDefaultModelId = "Qwen/Qwen2.5-32B-Instruct-fast" satisfies NebiusModelId

// X AI
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
		description: "X AI's Grok-3 beta model with 131K context window",
	},
	"grok-3-fast-beta": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 5.0,
		outputPrice: 25.0,
		description: "X AI's Grok-3 fast beta model with 131K context window",
	},
	"grok-3-mini-beta": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.3,
		outputPrice: 0.5,
		description: "X AI's Grok-3 mini beta model with 131K context window",
	},
	"grok-3-mini-fast-beta": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.6,
		outputPrice: 4.0,
		description: "X AI's Grok-3 mini fast beta model with 131K context window",
	},
	"grok-3": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 3.0,
		outputPrice: 15.0,
		description: "X AI's Grok-3 model with 131K context window",
	},
	"grok-3-fast": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 5.0,
		outputPrice: 25.0,
		description: "X AI's Grok-3 fast model with 131K context window",
	},
	"grok-3-mini": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.3,
		outputPrice: 0.5,
		description: "X AI's Grok-3 mini model with 131K context window",
	},
	"grok-3-mini-fast": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.6,
		outputPrice: 4.0,
		description: "X AI's Grok-3 mini fast model with 131K context window",
	},
	"grok-2-latest": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 2.0,
		outputPrice: 10.0,
		description: "X AI's Grok-2 model - latest version with 131K context window",
	},
	"grok-2": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 2.0,
		outputPrice: 10.0,
		description: "X AI's Grok-2 model with 131K context window",
	},
	"grok-2-1212": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 2.0,
		outputPrice: 10.0,
		description: "X AI's Grok-2 model (version 1212) with 131K context window",
	},
	"grok-2-vision-latest": {
		maxTokens: 8192,
		contextWindow: 32768,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 2.0,
		outputPrice: 10.0,
		description: "X AI's Grok-2 Vision model - latest version with image support and 32K context window",
	},
	"grok-2-vision": {
		maxTokens: 8192,
		contextWindow: 32768,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 2.0,
		outputPrice: 10.0,
		description: "X AI's Grok-2 Vision model with image support and 32K context window",
	},
	"grok-2-vision-1212": {
		maxTokens: 8192,
		contextWindow: 32768,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 2.0,
		outputPrice: 10.0,
		description: "X AI's Grok-2 Vision model (version 1212) with image support and 32K context window",
	},
	"grok-vision-beta": {
		maxTokens: 8192,
		contextWindow: 8192,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 5.0,
		outputPrice: 15.0,
		description: "X AI's Grok Vision Beta model with image support and 8K context window",
	},
	"grok-beta": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 5.0,
		outputPrice: 15.0,
		description: "X AI's Grok Beta model (legacy) with 131K context window",
	},
} as const satisfies Record<string, ModelInfo>

// SambaNova
// https://docs.sambanova.ai/cloud/docs/get-started/supported-models
export type SambanovaModelId = keyof typeof sambanovaModels
export const sambanovaDefaultModelId: SambanovaModelId = "Meta-Llama-3.3-70B-Instruct"
export const sambanovaModels = {
	"Llama-4-Maverick-17B-128E-Instruct": {
		maxTokens: 4096,
		contextWindow: 8_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0.63,
		outputPrice: 1.8,
	},
	"Llama-4-Scout-17B-16E-Instruct": {
		maxTokens: 4096,
		contextWindow: 8_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.4,
		outputPrice: 0.7,
	},
	"Meta-Llama-3.3-70B-Instruct": {
		maxTokens: 4096,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.6,
		outputPrice: 1.2,
	},
	"DeepSeek-R1-Distill-Llama-70B": {
		maxTokens: 4096,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.7,
		outputPrice: 1.4,
	},
	"DeepSeek-R1": {
		maxTokens: 4096,
		contextWindow: 16_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 5.0,
		outputPrice: 7.0,
	},
	"Meta-Llama-3.1-405B-Instruct": {
		maxTokens: 4096,
		contextWindow: 16_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 5.0,
		outputPrice: 10.0,
	},
	"Meta-Llama-3.1-8B-Instruct": {
		maxTokens: 4096,
		contextWindow: 16_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.1,
		outputPrice: 0.2,
	},
	"Meta-Llama-3.2-1B-Instruct": {
		maxTokens: 4096,
		contextWindow: 16_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.04,
		outputPrice: 0.08,
	},
	"Meta-Llama-3.2-3B-Instruct": {
		maxTokens: 4096,
		contextWindow: 8_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.08,
		outputPrice: 0.16,
	},
	"Qwen3-32B": {
		maxTokens: 4096,
		contextWindow: 16_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.4,
		outputPrice: 0.8,
	},
	"QwQ-32B": {
		maxTokens: 4096,
		contextWindow: 16_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.5,
		outputPrice: 1.0,
	},
	"DeepSeek-V3-0324": {
		maxTokens: 4096,
		contextWindow: 8_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 3.0,
		outputPrice: 4.5,
	},
} as const satisfies Record<string, ModelInfo>

// Cerebras
// https://inference-docs.cerebras.ai/api-reference/models
export type CerebrasModelId = keyof typeof cerebrasModels
export const cerebrasDefaultModelId: CerebrasModelId = "llama3.1-8b"
export const cerebrasModels = {
	"llama-4-scout-17b-16e-instruct": {
		maxTokens: 8192,
		contextWindow: 8192,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Fast inference model with ~2700 tokens/s",
	},
	"llama3.1-8b": {
		maxTokens: 8192,
		contextWindow: 8192,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Efficient model with ~2100 tokens/s",
	},
	"llama-3.3-70b": {
		maxTokens: 8192,
		contextWindow: 8192,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Powerful model with ~2600 tokens/s",
	},
	"qwen-3-32b": {
		maxTokens: 16382,
		contextWindow: 16382,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "SOTA coding performance with ~2500 tokens/s",
	},
	"deepseek-r1-distill-llama-70b": {
		maxTokens: 8192,
		contextWindow: 8192,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Advanced reasoning model with ~2300 tokens/s (private preview)",
	},
} as const satisfies Record<string, ModelInfo>

// Requesty
// https://requesty.ai/models
export const requestyDefaultModelId = "anthropic/claude-3-7-sonnet-latest"
export const requestyDefaultModelInfo: ModelInfo = {
	maxTokens: 8192,
	contextWindow: 200_000,
	supportsImages: true,

	supportsPromptCache: true,
	inputPrice: 3.0,
	outputPrice: 15.0,
	cacheWritesPrice: 3.75,
	cacheReadsPrice: 0.3,
	description: "Anthropic's most intelligent model. Highest level of intelligence and capability.",
}
