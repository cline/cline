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

export type AnthropicModelId = "claude-3-opus-20240229" | "claude-3-sonnet-20240229" | "claude-3-haiku-20240307"
export type BedrockModelId = "anthropic.claude-3-sonnet-20240229" | "anthropic.claude-3-haiku-20240307"
export type DeepSeekModelId = "deepseek-chat"
export type GeminiModelId = "gemini-pro" | "gemini-pro-vision"
export type OpenAiNativeModelId = "gpt-4-turbo-preview" | "gpt-4-vision-preview"
export type QwenModelId = "qwen-turbo" | "qwen-plus" | "qwen-max"
export type VertexModelId = "gemini-pro" | "gemini-pro-vision"

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
