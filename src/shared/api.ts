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
export type AnthropicModelId = keyof typeof anthropicModels
export const anthropicDefaultModelId: AnthropicModelId = "claude-3-5-sonnet-20240620"
// https://docs.anthropic.com/en/docs/about-claude/models
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
		inputPrice: 2.5,
		outputPrice: 12.5,
	},
	"claude-3-haiku-20240307": {
		maxTokens: 4096,
		supportsImages: true,
		inputPrice: 2.5,
		outputPrice: 12.5,
	},
} as const satisfies Record<string, ModelInfo>

// OpenRouter
export type OpenRouterModelId = keyof typeof openRouterModels
export const openRouterDefaultModelId: OpenRouterModelId = "anthropic/claude-3.5-sonnet:beta"
export const openRouterModels = {
	"anthropic/claude-3.5-sonnet:beta": {
		maxTokens: 4096,
		supportsImages: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
	},
} as const satisfies Record<string, ModelInfo>

// AWS Bedrock
export type BedrockModelId = keyof typeof bedrockModels
export const bedrockDefaultModelId: BedrockModelId = "anthropic.claude-3-5-sonnet-20240620-v1:0"
export const bedrockModels = {
	"anthropic.claude-3-5-sonnet-20240620-v1:0": {
		maxTokens: 4096,
		supportsImages: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
	},
} as const satisfies Record<string, ModelInfo> // as const assertion makes the object deeply readonly (just declaring it as const makes it mutable)
