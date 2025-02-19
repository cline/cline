import * as vscode from "vscode"

export type ApiProvider =
	| "openai"
	| "anthropic"
	| "azure"
	| "mistral"
	| "deepseek"
	| "qwen"
	| "together"
	| "litellm"
	| "ollama"
	| "lmstudio"
	| "vertex"
	| "requesty"
	| "openrouter"
	| "aws"
	| "bedrock"
	| "gemini"
	| "openai-native"
	| "vscode-lm"

export interface ModelInfo {
	id: string
	name: string
	provider: string
	contextWindow?: number
	maxTokens?: number
	supportsPromptCache?: boolean
	supportsImages?: boolean
	supportsComputerUse?: boolean
	cacheWritesPrice?: number
	cacheReadsPrice?: number
	inputPrice?: number
	outputPrice?: number
	description?: string
}

export interface ApiHandlerOptions {
	provider: ApiProvider
	modelId: string
	apiKey?: string
	baseUrl?: string
}

// Anthropic
export type AnthropicModelId = "claude-3-opus-20240229" | "claude-3-sonnet-20240229" | "claude-3-haiku-20240307"
export const anthropicDefaultModelId: AnthropicModelId = "claude-3-opus-20240229"
export const anthropicModels: ModelInfo[] = [
	{
		id: "claude-3-opus-20240229",
		name: "Claude 3 Opus",
		provider: "anthropic",
		contextWindow: 200000,
		maxTokens: 4096,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 15.0,
		outputPrice: 75.0,
	},
	{
		id: "claude-3-sonnet-20240229",
		name: "Claude 3 Sonnet",
		provider: "anthropic",
		contextWindow: 200000,
		maxTokens: 4096,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
	},
	{
		id: "claude-3-haiku-20240307",
		name: "Claude 3 Haiku",
		provider: "anthropic",
		contextWindow: 200000,
		maxTokens: 4096,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.25,
		outputPrice: 1.25,
	},
]

// Bedrock
export type BedrockModelId = "anthropic.claude-3-sonnet-20240229" | "anthropic.claude-3-haiku-20240307"
export const bedrockDefaultModelId: BedrockModelId = "anthropic.claude-3-sonnet-20240229"
export const bedrockModels: ModelInfo[] = [
	{
		id: "anthropic.claude-3-sonnet-20240229",
		name: "Claude 3 Sonnet (Bedrock)",
		provider: "bedrock",
		contextWindow: 200000,
		maxTokens: 4096,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
	},
	{
		id: "anthropic.claude-3-haiku-20240307",
		name: "Claude 3 Haiku (Bedrock)",
		provider: "bedrock",
		contextWindow: 200000,
		maxTokens: 4096,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.25,
		outputPrice: 1.25,
	},
]

// DeepSeek
export type DeepSeekModelId = "deepseek-chat"
export const deepSeekDefaultModelId: DeepSeekModelId = "deepseek-chat"
export const deepSeekModels: ModelInfo[] = [
	{
		id: "deepseek-chat",
		name: "DeepSeek Chat",
		provider: "deepseek",
		contextWindow: 32000,
		supportsPromptCache: true,
		inputPrice: 0.2,
		outputPrice: 0.2,
	},
]

// Gemini
export type GeminiModelId = "gemini-pro" | "gemini-pro-vision"
export const geminiDefaultModelId: GeminiModelId = "gemini-pro"
export const geminiModels: ModelInfo[] = [
	{
		id: "gemini-pro",
		name: "Gemini Pro",
		provider: "gemini",
		contextWindow: 32000,
		supportsPromptCache: true,
		supportsImages: false,
		inputPrice: 0.125,
		outputPrice: 0.375,
	},
	{
		id: "gemini-pro-vision",
		name: "Gemini Pro Vision",
		provider: "gemini",
		contextWindow: 32000,
		supportsPromptCache: true,
		supportsImages: true,
		inputPrice: 0.125,
		outputPrice: 0.375,
	},
]

// LiteLLM
export const liteLlmDefaultModelId = "gpt-4"
export const liteLlmModelInfoSaneDefaults: ModelInfo = {
	id: "gpt-4",
	name: "GPT-4",
	provider: "litellm",
	contextWindow: 8192,
	supportsPromptCache: true,
	inputPrice: 0.03,
	outputPrice: 0.06,
}

// OpenAI
export const openAiModelInfoSaneDefaults: ModelInfo = {
	id: "gpt-4",
	name: "GPT-4",
	provider: "openai",
	contextWindow: 8192,
	supportsPromptCache: true,
	inputPrice: 0.03,
	outputPrice: 0.06,
}

// OpenAI Native
export type OpenAiNativeModelId = "gpt-4-turbo-preview" | "gpt-4-vision-preview"
export const openAiNativeDefaultModelId: OpenAiNativeModelId = "gpt-4-turbo-preview"
export const openAiNativeModels: ModelInfo[] = [
	{
		id: "gpt-4-turbo-preview",
		name: "GPT-4 Turbo",
		provider: "openai-native",
		contextWindow: 128000,
		supportsPromptCache: true,
		supportsImages: false,
		inputPrice: 0.01,
		outputPrice: 0.03,
	},
	{
		id: "gpt-4-vision-preview",
		name: "GPT-4 Vision",
		provider: "openai-native",
		contextWindow: 128000,
		supportsPromptCache: true,
		supportsImages: true,
		inputPrice: 0.01,
		outputPrice: 0.03,
	},
]

// Azure OpenAI
export const azureOpenAiDefaultApiVersion = "2024-02-15-preview"

// OpenRouter
export const openRouterDefaultModelId = "anthropic/claude-3-opus-20240229"
export const openRouterDefaultModelInfo: ModelInfo = {
	id: "anthropic/claude-3-opus-20240229",
	name: "Claude 3 Opus",
	provider: "openrouter",
	contextWindow: 200000,
	maxTokens: 4096,
	supportsImages: true,
	supportsPromptCache: true,
	inputPrice: 15.0,
	outputPrice: 75.0,
}

// Qwen
export type QwenModelId = "qwen-turbo" | "qwen-plus" | "qwen-max"
export const qwenDefaultModelId: QwenModelId = "qwen-turbo"
export const qwenModels: ModelInfo[] = [
	{
		id: "qwen-turbo",
		name: "Qwen Turbo",
		provider: "qwen",
		contextWindow: 8192,
		supportsPromptCache: true,
		inputPrice: 0.008,
		outputPrice: 0.008,
	},
	{
		id: "qwen-plus",
		name: "Qwen Plus",
		provider: "qwen",
		contextWindow: 32000,
		supportsPromptCache: true,
		inputPrice: 0.014,
		outputPrice: 0.014,
	},
	{
		id: "qwen-max",
		name: "Qwen Max",
		provider: "qwen",
		contextWindow: 8192,
		supportsPromptCache: true,
		inputPrice: 0.02,
		outputPrice: 0.02,
	},
]

// Vertex
export type VertexModelId = "gemini-pro" | "gemini-pro-vision"
export const vertexDefaultModelId: VertexModelId = "gemini-pro"
export const vertexModels: ModelInfo[] = [
	{
		id: "gemini-pro",
		name: "Gemini Pro",
		provider: "vertex",
		contextWindow: 32000,
		supportsPromptCache: true,
		supportsImages: false,
		inputPrice: 0.125,
		outputPrice: 0.375,
	},
	{
		id: "gemini-pro-vision",
		name: "Gemini Pro Vision",
		provider: "vertex",
		contextWindow: 32000,
		supportsPromptCache: true,
		supportsImages: true,
		inputPrice: 0.125,
		outputPrice: 0.375,
	},
]

export interface ApiConfiguration {
	apiModelId?: string
	apiProvider: ApiProvider
	apiKey?: string
	openRouterApiKey?: string
	openRouterModelId?: string
	openRouterModelInfo?: ModelInfo
	awsAccessKey?: string
	awsSecretKey?: string
	awsSessionToken?: string
	awsRegion?: string
	awsUseCrossRegionInference?: boolean
	awsProfile?: string
	awsUseProfile?: boolean
	anthropicApiKey?: string
	anthropicBaseUrl?: string
	azureApiKey?: string
	azureEndpoint?: string
	azureDeploymentName?: string
	azureApiVersion?: string
	mistralApiKey?: string
	deepSeekApiKey?: string
	qwenApiKey?: string
	qwenEndpoint?: string
	qwenApiLine?: string
	togetherApiKey?: string
	togetherModelId?: string
	liteLlmApiKey?: string
	liteLlmBaseUrl?: string
	liteLlmModelId?: string
	ollamaBaseUrl?: string
	ollamaModelId?: string
	lmStudioBaseUrl?: string
	lmStudioModelId?: string
	vertexProjectId?: string
	vertexLocation?: string
	vertexEndpoint?: string
	vertexModelId?: string
	vertexRegion?: string
	requestyApiKey?: string
	requestyEndpoint?: string
	requestyModelId?: string
	openAiBaseUrl?: string
	openAiApiKey?: string
	openAiModelId?: string
	openAiModelInfo?: ModelInfo
	openAiNativeApiKey?: string
	geminiApiKey?: string
	vsCodeLmModelSelector?: string
}
