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

export interface ApiHandlerOptions {
	apiModelId?: string
	apiKey?: string // anthropic
	anthropicBaseUrl?: string
	openRouterApiKey?: string
	openRouterModelId?: string
	openRouterModelInfo?: ModelInfo
	awsAccessKey?: string
	awsSecretKey?: string
	awsSessionToken?: string
	awsRegion?: string
	awsUseCrossRegionInference?: boolean
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
	azureApiVersion?: string
}

export type ApiConfiguration = ApiHandlerOptions & {
	apiProvider?: ApiProvider
}

// Models

export interface ModelInfo {
	maxTokens?: number
	contextWindow?: number
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
} as const satisfies Record<string, ModelInfo>

// AWS Bedrock
// https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html
export type BedrockModelId = keyof typeof bedrockModels
export const bedrockDefaultModelId: BedrockModelId = "anthropic.claude-3-5-sonnet-20241022-v2:0"
export const bedrockModels = {
	"anthropic.claude-3-5-sonnet-20241022-v2:0": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsComputerUse: true,
		supportsPromptCache: false,
		inputPrice: 3.0,
		outputPrice: 15.0,
	},
	"anthropic.claude-3-5-haiku-20241022-v1:0": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 1.0,
		outputPrice: 5.0,
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
} as const satisfies Record<string, ModelInfo>

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
	description: getPromptCacheDescription(openRouterDefaultModelId)
}

// Helper function to get prompt cache description based on model ID
export function getPromptCacheDescription(modelId: string): string {
	const baseDescription = "Prompt caching is automatically enabled for prompts >= 1024 tokens. Static content (like system prompts) is placed at the beginning to maximize cache hits. Cache hits can reduce latency by up to 80% and costs by up to 50% for long prompts.\n\n"

	if (modelId.startsWith("anthropic/")) {
		return baseDescription +
			"Pricing varies by provider:\n" +
			"OpenAI (direct & via OpenRouter):\n" +
			"- Cache writes: no cost\n" +
			"- Cache reads: 0.5x input price\n\n" +
			"Anthropic (direct & via OpenRouter):\n" +
			"- Cache writes: 1.25x input price\n" +
			"- Cache reads: 0.1x input price\n" +
			"- Limited to 4 cache points, expires in 5 minutes\n\n" +
			"DeepSeek (via OpenRouter):\n" +
			"- Cache writes: normal price\n" +
			"- Cache reads: 0.1x input price\n\n" +
			"Note: When using OpenRouter, prompt caching is automatically enabled for supported models and providers. Cache hits are tracked in the generation details available in OpenRouter's Activity page: https://openrouter.ai/docs/prompt-caching.\n\n" +
			"Additional Features:\n" +
			"- Coding: New Sonnet scores ~49% on SWE-Bench Verified, higher than the last best score, and without any fancy prompt scaffolding\n" +
			"- Data science: Augments human data science expertise; navigates unstructured data while using multiple tools for insights\n" +
			"- Visual processing: excelling at interpreting charts, graphs, and images, accurately transcribing text to derive insights beyond just the text alone\n" +
			"- Agentic tasks: exceptional tool use, making it great at agentic tasks (i.e. complex, multi-step problem solving tasks that require engaging with other systems)\n\n" +
			"#multimodal\n\n" +
			"_This is a faster endpoint, made available in collaboration with Anthropic, that is self-moderated: response moderation happens on the provider's side instead of OpenRouter's. For requests that pass moderation, it's identical to the [Standard](/anthropic/claude-3.5-sonnet) variant._"
	} else if (modelId.startsWith("openai/")) {
		return baseDescription +
			"Pricing for OpenAI models via OpenRouter:\n" +
			"- Cache writes: no cost\n" +
			"- Cache reads: 0.5x input price\n\n" +
			"Note: When using OpenRouter, prompt caching is automatically enabled for supported models. Cache hits are tracked in the generation details available in OpenRouter's Activity page: https://openrouter.ai/docs/prompt-caching.\n\n" +
			"Additional Features:\n" +
			"- Advanced language understanding and generation\n" +
			"- Strong coding and technical capabilities\n" +
			"- Effective at complex reasoning tasks\n" +
			"- Support for various programming languages and frameworks"
	} else {
		return baseDescription +
			"Note: When using OpenRouter, prompt caching is automatically enabled for supported models. Cache hits are tracked in the generation details available in OpenRouter's Activity page at this link: https://openrouter.ai/docs/prompt-caching.\n\n" +
			"Benefits:\n" +
			"- Reduced latency for repeated or similar prompts\n" +
			"- Cost savings on cached content\n" +
			"- Improved performance for long-running conversations\n" +
			"- Efficient handling of system prompts and static content"
	}
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
	supportsPromptCache: true,
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
} as const satisfies Record<string, ModelInfo>

// OpenAI Native
// https://openai.com/api/pricing/
export type OpenAiNativeModelId = keyof typeof openAiNativeModels
export const openAiNativeDefaultModelId: OpenAiNativeModelId = "gpt-4o"
export const openAiNativeModels = {
	// don't support tool use yet
	"o1-preview": {
		maxTokens: 32_768,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 15,
		outputPrice: 60,
		cacheWritesPrice: 15, // Same as input price
		cacheReadsPrice: 7.5, // 0.5x input price
	},
	"o1-mini": {
		maxTokens: 65_536,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 3,
		outputPrice: 12,
		cacheWritesPrice: 3, // Same as input price
		cacheReadsPrice: 1.5, // 0.5x input price
	},
	"gpt-4o": {
		maxTokens: 4_096,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 5,
		outputPrice: 15,
		cacheWritesPrice: 5, // Same as input price
		cacheReadsPrice: 2.5, // 0.5x input price
	},
	"gpt-4o-mini": {
		maxTokens: 16_384,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.15,
		outputPrice: 0.6,
		cacheWritesPrice: 0.15, // Same as input price
		cacheReadsPrice: 0.075, // 0.5x input price
	},
} as const satisfies Record<string, ModelInfo>

// Azure OpenAI
// https://learn.microsoft.com/en-us/azure/ai-services/openai/api-version-deprecation
// https://learn.microsoft.com/en-us/azure/ai-services/openai/reference#api-specs
export const azureOpenAiDefaultApiVersion = "2024-08-01-preview"
