import * as vscode from "vscode"

export type ApiProvider =
	| "anthropic"
	| "glama"
	| "openrouter"
	| "bedrock"
	| "vertex"
	| "openai"
	| "ollama"
	| "lmstudio"
	| "gemini"
	| "openai-native"
	| "deepseek"
	| "vscode-lm"
	| "mistral"

export interface ApiHandlerOptions {
	apiModelId?: string
	apiKey?: string // anthropic
	anthropicBaseUrl?: string
	vsCodeLmModelSelector?: vscode.LanguageModelChatSelector
	glamaModelId?: string
	glamaModelInfo?: ModelInfo
	glamaApiKey?: string
	openRouterApiKey?: string
	openRouterModelId?: string
	openRouterModelInfo?: ModelInfo
	awsAccessKey?: string
	awsSecretKey?: string
	awsSessionToken?: string
	awsRegion?: string
	awsUseCrossRegionInference?: boolean
	awsUsePromptCache?: boolean
	awspromptCacheId?: string
	awsProfile?: string
	awsUseProfile?: boolean
	vertexProjectId?: string
	vertexRegion?: string
	openAiBaseUrl?: string
	openAiApiKey?: string
	openAiModelId?: string
	ollamaModelId?: string
	ollamaBaseUrl?: string
	lmStudioModelId?: string
	lmStudioBaseUrl?: string
	geminiApiKey?: string
	openAiNativeApiKey?: string
	mistralApiKey?: string
	azureApiVersion?: string
	openRouterUseMiddleOutTransform?: boolean
	openAiStreamingEnabled?: boolean
	setAzureApiVersion?: boolean
	deepSeekBaseUrl?: string
	deepSeekApiKey?: string
	deepSeekModelId?: string
	includeMaxTokens?: boolean
}

export type ApiConfiguration = ApiHandlerOptions & {
	apiProvider?: ApiProvider
	id?: string // stable unique identifier
}

// Models

export interface ModelInfo {
	maxTokens?: number
	contextWindow: number
	supportsImages?: boolean
	supportsComputerUse?: boolean
	supportsPromptCache: boolean // this value is hardcoded for now
	inputPrice?: number
	outputPrice?: number
	cacheWritesPrice?: number
	cacheReadsPrice?: number
	description?: string
}

// Anthropic
// https://docs.anthropic.com/en/docs/about-claude/models
export type AnthropicModelId = keyof typeof anthropicModels
export const anthropicDefaultModelId: AnthropicModelId = "claude-3-5-sonnet-20241022"
export const anthropicModels = {
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

// AWS Bedrock
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
export const bedrockDefaultModelId: BedrockModelId = "anthropic.claude-3-5-sonnet-20241022-v2:0"
export const bedrockModels = {
	"amazon.nova-pro-v1:0": {
		maxTokens: 5000,
		contextWindow: 300_000,
		supportsImages: true,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 0.8,
		outputPrice: 3.2,
		cacheWritesPrice: 0.8, // per million tokens
		cacheReadsPrice: 0.2, // per million tokens
	},
	"amazon.nova-lite-v1:0": {
		maxTokens: 5000,
		contextWindow: 300_000,
		supportsImages: true,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 0.06,
		outputPrice: 0.024,
		cacheWritesPrice: 0.06, // per million tokens
		cacheReadsPrice: 0.015, // per million tokens
	},
	"amazon.nova-micro-v1:0": {
		maxTokens: 5000,
		contextWindow: 128_000,
		supportsImages: false,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 0.035,
		outputPrice: 0.14,
		cacheWritesPrice: 0.035, // per million tokens
		cacheReadsPrice: 0.00875, // per million tokens
	},
	"anthropic.claude-3-5-sonnet-20241022-v2:0": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsComputerUse: true,
		supportsPromptCache: false,
		inputPrice: 3.0,
		outputPrice: 15.0,
		cacheWritesPrice: 3.75, // per million tokens
		cacheReadsPrice: 0.3, // per million tokens
	},
	"anthropic.claude-3-5-haiku-20241022-v1:0": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 1.0,
		outputPrice: 5.0,
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
	"meta.llama3-2-90b-instruct-v1:0": {
		maxTokens: 8192,
		contextWindow: 128_000,
		supportsImages: true,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 0.72,
		outputPrice: 0.72,
	},
	"meta.llama3-2-11b-instruct-v1:0": {
		maxTokens: 8192,
		contextWindow: 128_000,
		supportsImages: true,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 0.16,
		outputPrice: 0.16,
	},
	"meta.llama3-2-3b-instruct-v1:0": {
		maxTokens: 8192,
		contextWindow: 128_000,
		supportsImages: false,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 0.15,
		outputPrice: 0.15,
	},
	"meta.llama3-2-1b-instruct-v1:0": {
		maxTokens: 8192,
		contextWindow: 128_000,
		supportsImages: false,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 0.1,
		outputPrice: 0.1,
	},
	"meta.llama3-1-405b-instruct-v1:0": {
		maxTokens: 8192,
		contextWindow: 128_000,
		supportsImages: false,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 2.4,
		outputPrice: 2.4,
	},
	"meta.llama3-1-70b-instruct-v1:0": {
		maxTokens: 8192,
		contextWindow: 128_000,
		supportsImages: false,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 0.72,
		outputPrice: 0.72,
	},
	"meta.llama3-1-8b-instruct-v1:0": {
		maxTokens: 8192,
		contextWindow: 8_000,
		supportsImages: false,
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: 0.22,
		outputPrice: 0.22,
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
} as const satisfies Record<string, ModelInfo>

// Glama
// https://glama.ai/models
export const glamaDefaultModelId = "anthropic/claude-3-5-sonnet"
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
		"The new Claude 3.5 Sonnet delivers better-than-Opus capabilities, faster-than-Sonnet speeds, at the same Sonnet prices. Sonnet is particularly good at:\n\n- Coding: New Sonnet scores ~49% on SWE-Bench Verified, higher than the last best score, and without any fancy prompt scaffolding\n- Data science: Augments human data science expertise; navigates unstructured data while using multiple tools for insights\n- Visual processing: excelling at interpreting charts, graphs, and images, accurately transcribing text to derive insights beyond just the text alone\n- Agentic tasks: exceptional tool use, making it great at agentic tasks (i.e. complex, multi-step problem solving tasks that require engaging with other systems)\n\n#multimodal\n\n_This is a faster endpoint, made available in collaboration with Anthropic, that is self-moderated: response moderation happens on the provider's side instead of OpenRouter's. For requests that pass moderation, it's identical to the [Standard](/anthropic/claude-3.5-sonnet) variant._",
}

// OpenRouter
// https://openrouter.ai/models?order=newest&supported_parameters=tools
export const openRouterDefaultModelId = "anthropic/claude-3.5-sonnet:beta" // will always exist in openRouterModels
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
		"The new Claude 3.5 Sonnet delivers better-than-Opus capabilities, faster-than-Sonnet speeds, at the same Sonnet prices. Sonnet is particularly good at:\n\n- Coding: New Sonnet scores ~49% on SWE-Bench Verified, higher than the last best score, and without any fancy prompt scaffolding\n- Data science: Augments human data science expertise; navigates unstructured data while using multiple tools for insights\n- Visual processing: excelling at interpreting charts, graphs, and images, accurately transcribing text to derive insights beyond just the text alone\n- Agentic tasks: exceptional tool use, making it great at agentic tasks (i.e. complex, multi-step problem solving tasks that require engaging with other systems)\n\n#multimodal\n\n_This is a faster endpoint, made available in collaboration with Anthropic, that is self-moderated: response moderation happens on the provider's side instead of OpenRouter's. For requests that pass moderation, it's identical to the [Standard](/anthropic/claude-3.5-sonnet) variant._",
}

// Vertex AI
// https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude
export type VertexModelId = keyof typeof vertexModels
export const vertexDefaultModelId: VertexModelId = "claude-3-5-sonnet-v2@20241022"
export const vertexModels = {
	"claude-3-5-sonnet-v2@20241022": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsComputerUse: true,
		supportsPromptCache: false,
		inputPrice: 3.0,
		outputPrice: 15.0,
	},
	"claude-3-5-sonnet@20240620": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 3.0,
		outputPrice: 15.0,
	},
	"claude-3-5-haiku@20241022": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 1.0,
		outputPrice: 5.0,
	},
	"claude-3-opus@20240229": {
		maxTokens: 4096,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 15.0,
		outputPrice: 75.0,
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
export const geminiDefaultModelId: GeminiModelId = "gemini-2.0-flash-thinking-exp-1219"
export const geminiModels = {
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
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
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
export const openAiNativeDefaultModelId: OpenAiNativeModelId = "gpt-4o"
export const openAiNativeModels = {
	// don't support tool use yet
	o1: {
		maxTokens: 100_000,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 15,
		outputPrice: 60,
	},
	"o1-preview": {
		maxTokens: 32_768,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 15,
		outputPrice: 60,
	},
	"o1-mini": {
		maxTokens: 65_536,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 3,
		outputPrice: 12,
	},
	"gpt-4o": {
		maxTokens: 4_096,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 5,
		outputPrice: 15,
	},
	"gpt-4o-mini": {
		maxTokens: 16_384,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0.15,
		outputPrice: 0.6,
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
		supportsPromptCache: false,
		inputPrice: 0.014, // $0.014 per million tokens
		outputPrice: 0.28, // $0.28 per million tokens
		description: `DeepSeek-V3 achieves a significant breakthrough in inference speed over previous models. It tops the leaderboard among open-source models and rivals the most advanced closed-source models globally.`,
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
		maxTokens: 32_768,
		contextWindow: 256_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.3,
		outputPrice: 0.9,
	},
} as const satisfies Record<string, ModelInfo>
