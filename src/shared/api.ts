export type ApiProvider = "anthropic" | "openrouter" | "bedrock" | "vertex" | "openai" | "ollama" | "gemini"

export interface ApiHandlerOptions {
	apiModelId?: string
	apiKey?: string // anthropic
	anthropicBaseUrl?: string
	openRouterApiKey?: string
	awsAccessKey?: string
	awsSecretKey?: string
	awsSessionToken?: string
	awsRegion?: string
	vertexProjectId?: string
	vertexRegion?: string
	openAiBaseUrl?: string
	openAiApiKey?: string
	openAiModelId?: string
	ollamaModelId?: string
	ollamaBaseUrl?: string
	geminiApiKey?: string
}

export type ApiConfiguration = ApiHandlerOptions & {
	apiProvider?: ApiProvider
}

// Models

export interface ModelInfo {
	maxTokens: number
	contextWindow: number
	supportsImages: boolean
	supportsPromptCache: boolean
	inputPrice: number
	outputPrice: number
	cacheWritesPrice?: number
	cacheReadsPrice?: number
}

// Anthropic
// https://docs.anthropic.com/en/docs/about-claude/models
export type AnthropicModelId = keyof typeof anthropicModels
export const anthropicDefaultModelId: AnthropicModelId = "claude-3-5-sonnet-20240620"
export const anthropicModels = {
	"claude-3-5-sonnet-20240620": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 3.0, // $3 per million input tokens
		outputPrice: 15.0, // $15 per million output tokens
		cacheWritesPrice: 3.75, // $3.75 per million tokens
		cacheReadsPrice: 0.3, // $0.30 per million tokens
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
	"claude-3-sonnet-20240229": {
		maxTokens: 4096,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 3.0,
		outputPrice: 15.0,
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
export const bedrockDefaultModelId: BedrockModelId = "anthropic.claude-3-5-sonnet-20240620-v1:0"
export const bedrockModels = {
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
} as const satisfies Record<string, ModelInfo>

// OpenRouter
// https://openrouter.ai/models?order=newest&supported_parameters=tools
export type OpenRouterModelId = keyof typeof openRouterModels
export const openRouterDefaultModelId: OpenRouterModelId = "anthropic/claude-3.5-sonnet:beta"
export const openRouterModels = {
	"anthropic/claude-3.5-sonnet:beta": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 3.0,
		outputPrice: 15.0,
	},
	"anthropic/claude-3-opus:beta": {
		maxTokens: 4096,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 15,
		outputPrice: 75,
	},
	"anthropic/claude-3-sonnet:beta": {
		maxTokens: 4096,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 3,
		outputPrice: 15,
	},
	"anthropic/claude-3-haiku:beta": {
		maxTokens: 4096,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0.25,
		outputPrice: 1.25,
	},
	"openai/gpt-4o-2024-08-06": {
		maxTokens: 16384,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 2.5,
		outputPrice: 10,
	},
	"openai/gpt-4o-mini-2024-07-18": {
		maxTokens: 16384,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0.15,
		outputPrice: 0.6,
	},
	"openai/gpt-4-turbo": {
		maxTokens: 4096,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 10,
		outputPrice: 30,
	},
	// llama 3.1 models cannot use tools yet
	// "meta-llama/llama-3.1-405b-instruct": {
	// 	maxTokens: 2048,
	// 	supportsImages: false,
	// 	inputPrice: 2.7,
	// 	outputPrice: 2.7,
	// },
	// "meta-llama/llama-3.1-70b-instruct": {
	// 	maxTokens: 2048,
	// 	supportsImages: false,
	// 	inputPrice: 0.52,
	// 	outputPrice: 0.75,
	// },
	// "meta-llama/llama-3.1-8b-instruct": {
	// 	maxTokens: 2048,
	// 	supportsImages: false,
	// 	inputPrice: 0.06,
	// 	outputPrice: 0.06,
	// },
	// OpenRouter needs to fix mapping gemini 1.5 responses for tool calls properly, they return content with line breaks formatted wrong (too many escapes), and throw errors for being in the wrong order when they're not. They also cannot handle feedback given to a request with multiple tools. Giving feedback to one tool use requests works fine. ("Please ensure that function response turn comes immediately after a function call turn. And the number of function response parts should be equal to number of function call parts of the function call turn.")
	// UPDATE: I keep getting "400: Please ensure that function call turn comes immediately after a user turn or after a function response turn.", which gets fixed as soon as i switch to openrouter/claude, so it's obviously an error on openrouters end transforming the message structure. This is likely the culprit behind the tool order error people have seen with gpt4o.
	// "google/gemini-pro-1.5": {
	// 	maxTokens: 8192,
	// 	contextWindow: 2_097_152,
	// 	supportsImages: true, // "Function Calling is not supported with non-text input"
	// 	supportsPromptCache: false,
	// 	inputPrice: 2.5,
	// 	outputPrice: 7.5,
	// },
	// "google/gemini-flash-1.5": {
	// 	maxTokens: 8192,
	// 	contextWindow: 1_048_576,
	// 	supportsImages: true, // "Function Calling is not supported with non-text input"
	// 	supportsPromptCache: false,
	// 	inputPrice: 0.0375,
	// 	outputPrice: 0.15,
	// },
	// "google/gemini-pro": {
	// 	maxTokens: 8192,
	// 	supportsImages: false, // "Function Calling is not supported with non-text input"
	// 	inputPrice: 0.125,
	// 	outputPrice: 0.375,
	// },
	// while deepseek coder can use tools, it may sometimes send tool invocation as a text block
	"deepseek/deepseek-coder": {
		maxTokens: 4096,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.14,
		outputPrice: 0.28,
	},
	// mistral models can use tools but aren't great at going step-by-step and proceeding to the next step
	"mistralai/mistral-large": {
		maxTokens: 8192,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 3,
		outputPrice: 9,
	},
	// This model is not capable of complex system/tool prompts
	// "mistralai/mistral-7b-instruct-v0.1": {
	// 	maxTokens: 4096,
	// 	supportsImages: false,
	// 	inputPrice: 0.06,
	// 	outputPrice: 0.06,
	// },
	// cohere models are not capable of complex system/tool prompts
	// "cohere/command-r-plus": {
	// 	maxTokens: 4000,
	// 	supportsImages: false,
	// 	inputPrice: 3,
	// 	outputPrice: 15,
	// },
	// "cohere/command-r": {
	// 	maxTokens: 4000,
	// 	supportsImages: false,
	// 	inputPrice: 0.5,
	// 	outputPrice: 1.5,
	// },
} as const satisfies Record<string, ModelInfo>

// Vertex AI
// https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude
export type VertexModelId = keyof typeof vertexModels
export const vertexDefaultModelId: VertexModelId = "claude-3-5-sonnet@20240620"
export const vertexModels = {
	"claude-3-5-sonnet@20240620": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 3.0,
		outputPrice: 15.0,
	},
	"claude-3-opus@20240229": {
		maxTokens: 4096,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 15.0,
		outputPrice: 75.0,
	},
	"claude-3-sonnet@20240229": {
		maxTokens: 4096,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 3.0,
		outputPrice: 15.0,
	},
	"claude-3-haiku@20240307": {
		maxTokens: 4096,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0.25,
		outputPrice: 1.25,
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
export const geminiDefaultModelId: GeminiModelId = "gemini-1.5-flash-latest"
export const geminiModels = {
	"gemini-1.5-flash-latest": {
		maxTokens: 8192,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
	},
	"gemini-1.5-pro-latest": {
		maxTokens: 8192,
		contextWindow: 2_097_152,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
	},
} as const satisfies Record<string, ModelInfo>
