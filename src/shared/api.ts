export type ApiProvider = "anthropic" | "openrouter" | "bedrock"

export interface ApiHandlerOptions {
	apiModelId?: ApiModelId
	apiKey?: string // anthropic
	openRouterApiKey?: string
	awsAccessKey?: string
	awsSecretKey?: string
	awsRegion?: string
}

export type ApiConfiguration = ApiHandlerOptions & {
	apiProvider?: ApiProvider
}

// Models

export interface ModelInfo {
	maxTokens: number
	supportsImages: boolean
	inputPrice: number
	outputPrice: number
}

export type ApiModelId = AnthropicModelId | OpenRouterModelId | BedrockModelId

// Anthropic
// https://docs.anthropic.com/en/docs/about-claude/models
export type AnthropicModelId = keyof typeof anthropicModels
export const anthropicDefaultModelId: AnthropicModelId = "claude-3-5-sonnet-20240620"
export const anthropicModels = {
	"claude-3-5-sonnet-20240620": {
		maxTokens: 8192,
		supportsImages: true,
		inputPrice: 3.0, // $3 per million input tokens
		outputPrice: 15.0, // $15 per million output tokens
	},
	"claude-3-opus-20240229": {
		maxTokens: 4096,
		supportsImages: true,
		inputPrice: 15.0,
		outputPrice: 75.0,
	},
	"claude-3-sonnet-20240229": {
		maxTokens: 4096,
		supportsImages: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
	},
	"claude-3-haiku-20240307": {
		maxTokens: 4096,
		supportsImages: true,
		inputPrice: 0.25,
		outputPrice: 1.25,
	},
} as const satisfies Record<string, ModelInfo> // as const assertion makes the object deeply readonly

// AWS Bedrock
// https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html
export type BedrockModelId = keyof typeof bedrockModels
export const bedrockDefaultModelId: BedrockModelId = "anthropic.claude-3-5-sonnet-20240620-v1:0"
export const bedrockModels = {
	"anthropic.claude-3-5-sonnet-20240620-v1:0": {
		maxTokens: 4096,
		supportsImages: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
	},
	"anthropic.claude-3-opus-20240229-v1:0": {
		maxTokens: 4096,
		supportsImages: true,
		inputPrice: 15.0,
		outputPrice: 75.0,
	},
	"anthropic.claude-3-sonnet-20240229-v1:0": {
		maxTokens: 4096,
		supportsImages: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
	},
	"anthropic.claude-3-haiku-20240307-v1:0": {
		maxTokens: 4096,
		supportsImages: true,
		inputPrice: 0.25,
		outputPrice: 1.25,
	},
} as const satisfies Record<string, ModelInfo>

// OpenRouter
// https://openrouter.ai/models?order=newest&supported_parameters=tools
export type OpenRouterModelId = keyof typeof openRouterModels
export const openRouterDefaultModelId: OpenRouterModelId = "anthropic/claude-3.5-sonnet"
export const openRouterModels = {
	"anthropic/claude-3.5-sonnet": {
		maxTokens: 8192,
		supportsImages: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
	},
	"anthropic/claude-3-opus": {
		maxTokens: 4096,
		supportsImages: true,
		inputPrice: 15,
		outputPrice: 75,
	},
	"anthropic/claude-3-sonnet": {
		maxTokens: 4096,
		supportsImages: true,
		inputPrice: 3,
		outputPrice: 15,
	},
	"anthropic/claude-3-haiku": {
		maxTokens: 4096,
		supportsImages: true,
		inputPrice: 0.25,
		outputPrice: 1.25,
	},
	"openai/gpt-4o-2024-08-06": {
		maxTokens: 16384,
		supportsImages: true,
		inputPrice: 2.5,
		outputPrice: 10,
	},
	"openai/gpt-4o-mini-2024-07-18": {
		maxTokens: 16384,
		supportsImages: true,
		inputPrice: 0.15,
		outputPrice: 0.6,
	},
	"openai/gpt-4-turbo": {
		maxTokens: 4096,
		supportsImages: true,
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
	"google/gemini-pro-1.5": {
		maxTokens: 8192,
		supportsImages: true,
		inputPrice: 2.5,
		outputPrice: 7.5,
	},
	"google/gemini-flash-1.5": {
		maxTokens: 8192,
		supportsImages: true,
		inputPrice: 0.25,
		outputPrice: 0.75,
	},
	// while deepseek coder can use tools, it may sometimes send tool invocation as a text block
	"deepseek/deepseek-coder": {
		maxTokens: 4096,
		supportsImages: false,
		inputPrice: 0.14,
		outputPrice: 0.28,
	},
	// mistral models can use tools but aren't great at going step-by-step and proceeding to the next step
	"mistralai/mistral-large": {
		maxTokens: 8192,
		supportsImages: false,
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
