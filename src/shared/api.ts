import type { LanguageModelChatSelector } from "../core/api/providers/types"
import { ApiFormat } from "./proto/cline/models"

export type ApiProvider =
	| "anthropic"
	| "claude-code"
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
	| "qwen-code"
	| "doubao"
	| "mistral"
	| "vscode-lm"
	| "cline"
	| "litellm"
	| "moonshot"
	| "nebius"
	| "fireworks"
	| "asksage"
	| "xai"
	| "sambanova"
	| "cerebras"
	| "sapaicore"
	| "groq"
	| "huggingface"
	| "huawei-cloud-maas"
	| "dify"
	| "baseten"
	| "vercel-ai-gateway"
	| "zai"
	| "oca"
	| "aihubmix"
	| "minimax"
	| "hicap"
	| "nousResearch"

export interface ApiHandlerSecrets {
	apiKey?: string // anthropic
	liteLlmApiKey?: string
	awsAccessKey?: string
	awsSecretKey?: string
	openRouterApiKey?: string
	aihubmixApiKey?: string
	aihubmixBaseUrl?: string
	aihubmixAppCode?: string

	clineAccountId?: string
	awsSessionToken?: string
	awsBedrockApiKey?: string
	openAiApiKey?: string
	geminiApiKey?: string
	openAiNativeApiKey?: string
	ollamaApiKey?: string
	deepSeekApiKey?: string
	requestyApiKey?: string
	togetherApiKey?: string
	fireworksApiKey?: string
	qwenApiKey?: string
	doubaoApiKey?: string
	mistralApiKey?: string
	authNonce?: string
	asksageApiKey?: string
	xaiApiKey?: string
	moonshotApiKey?: string
	zaiApiKey?: string
	huggingFaceApiKey?: string
	nebiusApiKey?: string
	sambanovaApiKey?: string
	cerebrasApiKey?: string
	sapAiCoreClientId?: string
	sapAiCoreClientSecret?: string
	groqApiKey?: string
	huaweiCloudMaasApiKey?: string
	basetenApiKey?: string
	vercelAiGatewayApiKey?: string
	difyApiKey?: string
	minimaxApiKey?: string
	hicapApiKey?: string
	nousResearchApiKey?: string
}

export interface ApiHandlerOptions {
	// Global configuration (not mode-specific)
	ulid?: string // Used to identify the task in API requests
	liteLlmBaseUrl?: string
	liteLlmUsePromptCache?: boolean
	openAiHeaders?: Record<string, string> // Custom headers for OpenAI requests
	anthropicBaseUrl?: string
	openRouterProviderSorting?: string
	awsRegion?: string
	awsUseCrossRegionInference?: boolean
	awsUseGlobalInference?: boolean
	awsBedrockUsePromptCache?: boolean
	awsAuthentication?: string
	awsUseProfile?: boolean
	awsProfile?: string
	awsBedrockEndpoint?: string
	claudeCodePath?: string
	vertexProjectId?: string
	vertexRegion?: string
	openAiBaseUrl?: string
	ollamaBaseUrl?: string
	ollamaApiOptionsCtxNum?: string
	lmStudioBaseUrl?: string
	lmStudioModelId?: string
	lmStudioMaxTokens?: string
	geminiBaseUrl?: string
	requestyBaseUrl?: string
	fireworksModelMaxCompletionTokens?: number
	fireworksModelMaxTokens?: number
	qwenCodeOauthPath?: string
	azureApiVersion?: string
	qwenApiLine?: string
	moonshotApiLine?: string
	asksageApiUrl?: string
	requestTimeoutMs?: number
	sapAiResourceGroup?: string
	sapAiCoreTokenUrl?: string
	sapAiCoreBaseUrl?: string
	sapAiCoreUseOrchestrationMode?: boolean
	difyBaseUrl?: string
	zaiApiLine?: string
	hicapApiKey?: string
	hicapModelId?: string
	onRetryAttempt?: (attempt: number, maxRetries: number, delay: number, error: any) => void
	ocaBaseUrl?: string
	minimaxApiLine?: string
	ocaMode?: string
	aihubmixBaseUrl?: string
	aihubmixAppCode?: string

	// Plan mode configurations
	planModeApiModelId?: string
	planModeThinkingBudgetTokens?: number
	geminiPlanModeThinkingLevel?: string
	planModeReasoningEffort?: string
	planModeVerbosity?: string
	planModeVsCodeLmModelSelector?: LanguageModelChatSelector
	planModeAwsBedrockCustomSelected?: boolean
	planModeAwsBedrockCustomModelBaseId?: string
	planModeOpenRouterModelId?: string
	planModeOpenRouterModelInfo?: ModelInfo
	planModeOpenAiModelId?: string
	planModeOpenAiModelInfo?: OpenAiCompatibleModelInfo
	planModeOllamaModelId?: string
	planModeLmStudioModelId?: string
	planModeLiteLlmModelId?: string
	planModeLiteLlmModelInfo?: LiteLLMModelInfo
	planModeRequestyModelId?: string
	planModeRequestyModelInfo?: ModelInfo
	planModeTogetherModelId?: string
	planModeFireworksModelId?: string
	planModeSapAiCoreModelId?: string
	planModeSapAiCoreDeploymentId?: string
	planModeGroqModelId?: string
	planModeGroqModelInfo?: ModelInfo
	planModeBasetenModelId?: string
	planModeBasetenModelInfo?: ModelInfo
	planModeHuggingFaceModelId?: string
	planModeHuggingFaceModelInfo?: ModelInfo
	planModeHuaweiCloudMaasModelId?: string
	planModeHuaweiCloudMaasModelInfo?: ModelInfo
	planModeOcaModelId?: string
	planModeOcaModelInfo?: OcaModelInfo
	planModeAihubmixModelId?: string
	planModeAihubmixModelInfo?: OpenAiCompatibleModelInfo
	planModeHicapModelId?: string
	planModeHicapModelInfo?: ModelInfo
	planModeNousResearchModelId?: string
	// Act mode configurations

	// Act mode configurations
	actModeApiModelId?: string
	actModeThinkingBudgetTokens?: number
	geminiActModeThinkingLevel?: string
	actModeReasoningEffort?: string
	actModeVerbosity?: string
	actModeVsCodeLmModelSelector?: LanguageModelChatSelector
	actModeAwsBedrockCustomSelected?: boolean
	actModeAwsBedrockCustomModelBaseId?: string
	actModeOpenRouterModelId?: string
	actModeOpenRouterModelInfo?: ModelInfo
	actModeOpenAiModelId?: string
	actModeOpenAiModelInfo?: OpenAiCompatibleModelInfo
	actModeOllamaModelId?: string
	actModeLmStudioModelId?: string
	actModeLiteLlmModelId?: string
	actModeLiteLlmModelInfo?: LiteLLMModelInfo
	actModeRequestyModelId?: string
	actModeRequestyModelInfo?: ModelInfo
	actModeTogetherModelId?: string
	actModeFireworksModelId?: string
	actModeSapAiCoreModelId?: string
	actModeSapAiCoreDeploymentId?: string
	actModeGroqModelId?: string
	actModeGroqModelInfo?: ModelInfo
	actModeBasetenModelId?: string
	actModeBasetenModelInfo?: ModelInfo
	actModeHuggingFaceModelId?: string
	actModeHuggingFaceModelInfo?: ModelInfo
	actModeHuaweiCloudMaasModelId?: string
	actModeHuaweiCloudMaasModelInfo?: ModelInfo
	actModeOcaModelId?: string
	actModeOcaModelInfo?: OcaModelInfo
	actModeAihubmixModelId?: string
	actModeAihubmixModelInfo?: OpenAiCompatibleModelInfo
	actModeHicapModelId?: string
	actModeHicapModelInfo?: ModelInfo
	actModeNousResearchModelId?: string
}

export type ApiConfiguration = ApiHandlerOptions &
	ApiHandlerSecrets & {
		planModeApiProvider?: ApiProvider
		actModeApiProvider?: ApiProvider
	}

// Models

interface PriceTier {
	tokenLimit: number // Upper limit (inclusive) of *input* tokens for this price. Use Infinity for the highest tier.
	price: number // Price per million tokens for this tier.
}

export interface ModelInfo {
	name?: string
	maxTokens?: number
	contextWindow?: number
	supportsImages?: boolean
	supportsPromptCache: boolean // this value is hardcoded for now
	supportsReasoning?: boolean // Whether the model supports reasoning/thinking mode
	inputPrice?: number // Keep for non-tiered input models
	outputPrice?: number // Keep for non-tiered output models
	thinkingConfig?: {
		maxBudget?: number // Max allowed thinking budget tokens
		outputPrice?: number // Output price per million tokens when budget > 0
		outputPriceTiers?: PriceTier[] // Optional: Tiered output price when budget > 0
		geminiThinkingLevel?: "low" | "high" // Optional: preset thinking level
		supportsThinkingLevel?: boolean // Whether the model supports thinking level (low/high)
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
	temperature?: number
	apiFormat?: ApiFormat // The API format used by this model
}

export interface OpenAiCompatibleModelInfo extends ModelInfo {
	temperature?: number
	isR1FormatRequired?: boolean
	systemRole?: "developer" | "system"
	supportsReasoningEffort?: boolean
	supportsTools?: boolean
	supportsStreaming?: boolean
}

export interface OcaModelInfo extends OpenAiCompatibleModelInfo {
	modelName: string
	surveyId?: string
	banner?: string
	surveyContent?: string
}

export const CLAUDE_SONNET_1M_SUFFIX = ":1m"
export const CLAUDE_SONNET_1M_TIERS = [
	{
		contextWindow: 200000,
		inputPrice: 3.0,
		outputPrice: 15,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
	},
	{
		contextWindow: Number.MAX_SAFE_INTEGER, // storing infinity in vs storage is not possible, it converts to 'null', which causes crash in webview ModelInfoView
		inputPrice: 6,
		outputPrice: 22.5,
		cacheWritesPrice: 7.5,
		cacheReadsPrice: 0.6,
	},
]

export interface HicapCompatibleModelInfo extends ModelInfo {
	temperature?: number
}

export const hicapModelInfoSaneDefaults: HicapCompatibleModelInfo = {
	maxTokens: -1,
	contextWindow: 128_000,
	supportsImages: true,
	supportsPromptCache: true,
	inputPrice: 0,
	outputPrice: 0,
	temperature: 1,
}

// Anthropic
// https://docs.anthropic.com/en/docs/about-claude/models // prices updated 2025-01-02
export type AnthropicModelId = keyof typeof anthropicModels
export const anthropicDefaultModelId: AnthropicModelId = "claude-sonnet-4-5-20250929"
export const ANTHROPIC_MIN_THINKING_BUDGET = 1_024
export const ANTHROPIC_MAX_THINKING_BUDGET = 6_000
export const anthropicModels = {
	"claude-sonnet-4-5-20250929": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
	},
	"claude-sonnet-4-5-20250929:1m": {
		maxTokens: 8192,
		contextWindow: 1_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
		tiers: CLAUDE_SONNET_1M_TIERS,
	},
	"claude-haiku-4-5-20251001": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 1,
		outputPrice: 5.0,
		cacheWritesPrice: 1.25,
		cacheReadsPrice: 0.1,
	},
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
	"claude-sonnet-4-20250514:1m": {
		maxTokens: 8192,
		contextWindow: 1_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
		tiers: CLAUDE_SONNET_1M_TIERS,
	},
	"claude-opus-4-5-20251101": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 5.0,
		outputPrice: 25.0,
		cacheWritesPrice: 6.25,
		cacheReadsPrice: 0.5,
	},
	"claude-opus-4-1-20250805": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 15.0,
		outputPrice: 75.0,
		cacheWritesPrice: 18.75,
		cacheReadsPrice: 1.5,
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

// Claude Code
export type ClaudeCodeModelId = keyof typeof claudeCodeModels
export const claudeCodeDefaultModelId: ClaudeCodeModelId = "claude-sonnet-4-5-20250929"
export const claudeCodeModels = {
	sonnet: {
		...anthropicModels["claude-sonnet-4-5-20250929"],
		supportsImages: false,
		supportsPromptCache: false,
	},
	opus: {
		...anthropicModels["claude-opus-4-1-20250805"],
		supportsImages: false,
		supportsPromptCache: false,
	},
	"claude-haiku-4-5-20251001": {
		...anthropicModels["claude-haiku-4-5-20251001"],
		supportsImages: false,
		supportsPromptCache: false,
	},
	"claude-sonnet-4-5-20250929": {
		...anthropicModels["claude-sonnet-4-5-20250929"],
		supportsImages: false,
		supportsPromptCache: false,
	},
	"claude-sonnet-4-20250514": {
		...anthropicModels["claude-sonnet-4-20250514"],
		supportsImages: false,
		supportsPromptCache: false,
	},
	"claude-opus-4-5-20251101": {
		...anthropicModels["claude-opus-4-5-20251101"],
		supportsImages: false,
		supportsPromptCache: false,
	},
	"claude-opus-4-1-20250805": {
		...anthropicModels["claude-opus-4-1-20250805"],
		supportsImages: false,
		supportsPromptCache: false,
	},
	"claude-opus-4-20250514": {
		...anthropicModels["claude-opus-4-20250514"],
		supportsImages: false,
		supportsPromptCache: false,
	},
	"claude-3-7-sonnet-20250219": {
		...anthropicModels["claude-3-7-sonnet-20250219"],
		supportsImages: false,
		supportsPromptCache: false,
	},
	"claude-3-5-haiku-20241022": {
		...anthropicModels["claude-3-5-haiku-20241022"],
		supportsImages: false,
		supportsPromptCache: false,
	},
} as const satisfies Record<string, ModelInfo>

// AWS Bedrock
// https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html
export type BedrockModelId = keyof typeof bedrockModels
export const bedrockDefaultModelId: BedrockModelId = "anthropic.claude-sonnet-4-20250514-v1:0" // TODO: update to 4-5
export const bedrockModels = {
	"anthropic.claude-sonnet-4-5-20250929-v1:0": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		supportsGlobalEndpoint: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
	},
	"anthropic.claude-sonnet-4-5-20250929-v1:0:1m": {
		maxTokens: 8192,
		contextWindow: 1_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		supportsGlobalEndpoint: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
		tiers: CLAUDE_SONNET_1M_TIERS,
	},
	"anthropic.claude-haiku-4-5-20251001-v1:0": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 1,
		outputPrice: 5.0,
		cacheWritesPrice: 1.25,
		cacheReadsPrice: 0.1,
	},
	"anthropic.claude-sonnet-4-20250514-v1:0": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		supportsGlobalEndpoint: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
	},
	"anthropic.claude-sonnet-4-20250514-v1:0:1m": {
		maxTokens: 8192,
		contextWindow: 1_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		supportsGlobalEndpoint: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
		tiers: CLAUDE_SONNET_1M_TIERS,
	},
	"anthropic.claude-opus-4-5-20251101-v1:0": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		supportsGlobalEndpoint: true,
		inputPrice: 5.0,
		outputPrice: 25.0,
		cacheWritesPrice: 6.25,
		cacheReadsPrice: 0.5,
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
	"anthropic.claude-opus-4-1-20250805-v1:0": {
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
	"amazon.nova-2-lite-v1:0": {
		maxTokens: 5000,
		contextWindow: 1_000_000,
		supportsImages: true,

		supportsPromptCache: true,
		inputPrice: 0.3,
		outputPrice: 2.5,
		// cacheWritesPrice: 2.5, // not written
		cacheReadsPrice: 0.075,
		supportsGlobalEndpoint: true,
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
	"openai.gpt-oss-120b-1:0": {
		maxTokens: 8192,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.15,
		outputPrice: 0.6,
		description:
			"A state-of-the-art 120B open-weight Mixture-of-Experts language model optimized for strong reasoning, tool use, and efficient deployment on large GPUs",
	},
	"openai.gpt-oss-20b-1:0": {
		maxTokens: 8192,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.07,
		outputPrice: 0.3,
		description:
			"A compact 20B open-weight Mixture-of-Experts language model designed for strong reasoning and tool use, ideal for edge devices and local inference.",
	},
	"qwen.qwen3-coder-30b-a3b-v1:0": {
		maxTokens: 8192,
		contextWindow: 262_144,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.15,
		outputPrice: 0.6,
		description:
			"Qwen3 Coder 30B MoE model with 3.3B activated parameters, optimized for code generation and analysis with 256K context window.",
	},
	"qwen.qwen3-coder-480b-a35b-v1:0": {
		maxTokens: 8192,
		contextWindow: 262_144,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.22,
		outputPrice: 1.8,
		description:
			"Qwen3 Coder 480B flagship MoE model with 35B activated parameters, designed for complex coding tasks with advanced reasoning capabilities and 256K context window.",
	},
} as const satisfies Record<string, ModelInfo>

// OpenRouter
// https://openrouter.ai/models?order=newest&supported_parameters=tools
export const openRouterDefaultModelId = "anthropic/claude-sonnet-4.5" // will always exist in openRouterModels
export const openRouterClaudeSonnet41mModelId = `anthropic/claude-sonnet-4${CLAUDE_SONNET_1M_SUFFIX}`
export const openRouterClaudeSonnet451mModelId = `anthropic/claude-sonnet-4.5${CLAUDE_SONNET_1M_SUFFIX}`
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
		"Claude Sonnet 4.5 delivers superior intelligence across coding, agentic search, and AI agent capabilities. It's a powerful choice for agentic coding, and can complete tasks across the entire software development lifecycle—from initial planning to bug fixes, maintenance to large refactors. It offers strong performance in both planning and solving for complex coding tasks, making it an ideal choice to power end-to-end software development processes.\n\nRead more in the [blog post here](https://www.anthropic.com/claude/sonnet)",
}

// Cline custom model - Devstral
export const clineDevstralModelInfo: ModelInfo = {
	contextWindow: 256000,
	supportsImages: false,
	supportsPromptCache: false,
	inputPrice: 0,
	outputPrice: 0,
	cacheReadsPrice: 0,
	cacheWritesPrice: 0,
	description: "A stealth model for agentic coding tasks",
}

export const OPENROUTER_PROVIDER_PREFERENCES: Record<string, { order: string[]; allow_fallbacks: boolean }> = {
	// Exacto Providers
	"moonshotai/kimi-k2:exacto": {
		order: ["groq", "moonshotai"],
		allow_fallbacks: false,
	},
	"z-ai/glm-4.6:exacto": {
		order: ["z-ai", "novita"],
		allow_fallbacks: false,
	},
	"deepseek/deepseek-v3.1-terminus:exacto": {
		order: ["novita", "deepinfra"],
		allow_fallbacks: false,
	},
	"qwen/qwen3-coder:exacto": {
		order: ["baseten"],
		allow_fallbacks: false,
	},
	"openai/gpt-oss-120b:exacto": {
		order: ["groq", "novita"],
		allow_fallbacks: false,
	},

	// Normal Providers
	"moonshotai/kimi-k2": {
		order: ["groq", "fireworks", "baseten", "parasail", "novita", "deepinfra"],
		allow_fallbacks: false,
	},
	"qwen/qwen3-coder": {
		order: ["nebius", "baseten", "fireworks", "together", "deepinfra"],
		allow_fallbacks: false,
	},
	"qwen/qwen3-235b-a22b-thinking-2507": {
		order: ["nebius", "baseten", "fireworks", "together", "deepinfra"],
		allow_fallbacks: false,
	},
	"qwen/qwen3-235b-a22b-07-25": {
		order: ["nebius", "baseten", "fireworks", "together", "deepinfra"],
		allow_fallbacks: false,
	},
	"qwen/qwen3-30b-a3b-thinking-2507": {
		order: ["nebius", "baseten", "fireworks", "together", "deepinfra"],
		allow_fallbacks: false,
	},
	"qwen/qwen3-30b-a3b-instruct-2507": {
		order: ["nebius", "baseten", "fireworks", "together", "deepinfra"],
		allow_fallbacks: false,
	},
	"qwen/qwen3-30b-a3b:free": {
		order: ["nebius", "baseten", "fireworks", "together", "deepinfra"],
		allow_fallbacks: false,
	},
	"qwen/qwen3-next-80b-a3b-thinking": {
		order: ["nebius", "baseten", "fireworks", "together", "deepinfra"],
		allow_fallbacks: false,
	},
	"qwen/qwen3-next-80b-a3b-instruct": {
		order: ["nebius", "baseten", "fireworks", "together", "deepinfra"],
		allow_fallbacks: false,
	},
	"qwen/qwen3-max": {
		order: ["nebius", "baseten", "fireworks", "together", "deepinfra"],
		allow_fallbacks: false,
	},
	"deepseek/deepseek-v3.2-exp": {
		order: ["deepseek", "novita", "fireworks", "nebius"],
		allow_fallbacks: false,
	},
	"z-ai/glm-4.6": {
		order: ["z-ai", "novita", "baseten", "fireworks", "chutes"],
		allow_fallbacks: false,
	},
	"z-ai/glm-4.5v": {
		order: ["z-ai", "novita", "baseten", "fireworks", "chutes"],
		allow_fallbacks: false,
	},
	"z-ai/glm-4.5": {
		order: ["z-ai", "novita", "baseten", "fireworks", "chutes"],
		allow_fallbacks: false,
	},
	"z-ai/glm-4.5-air": {
		order: ["z-ai", "novita", "baseten", "fireworks", "chutes"],
		allow_fallbacks: false,
	},
}

// Vertex AI
// https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude
// https://cloud.google.com/vertex-ai/generative-ai/pricing#partner-models
export type VertexModelId = keyof typeof vertexModels
export const vertexDefaultModelId: VertexModelId = "gemini-3-pro-preview"
export const vertexModels = {
	"gemini-3-pro-preview": {
		maxTokens: 8192,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		supportsGlobalEndpoint: true,
		inputPrice: 2.0,
		outputPrice: 12.0,
		temperature: 1.0,
		thinkingConfig: {
			geminiThinkingLevel: "high",
			supportsThinkingLevel: true,
		},
	},
	"claude-sonnet-4-5@20250929": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
		supportsReasoning: true,
	},
	"claude-sonnet-4@20250514": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
		supportsReasoning: true,
	},
	"claude-haiku-4-5@20251001": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 1.0,
		outputPrice: 5.0,
		cacheWritesPrice: 1.25,
		cacheReadsPrice: 0.1,
		supportsReasoning: true,
	},
	"claude-opus-4-5@20251101": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 5.0,
		outputPrice: 25.0,
		cacheWritesPrice: 6.25,
		cacheReadsPrice: 0.5,
		supportsReasoning: true,
	},
	"claude-opus-4-1@20250805": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 15.0,
		outputPrice: 75.0,
		cacheWritesPrice: 18.75,
		cacheReadsPrice: 1.5,
		supportsReasoning: true,
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
		supportsReasoning: true,
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
		supportsReasoning: true,
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
	"mistral-large-2411": {
		maxTokens: 128_000,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 2.0,
		outputPrice: 6.0,
	},
	"mistral-small-2503": {
		maxTokens: 128_000,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0.1,
		outputPrice: 0.3,
	},
	"codestral-2501": {
		maxTokens: 256_000,
		contextWindow: 256_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.3,
		outputPrice: 0.9,
	},
	"llama-4-maverick-17b-128e-instruct-maas": {
		maxTokens: 128_000,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0.35,
		outputPrice: 1.15,
	},
	"llama-4-scout-17b-16e-instruct-maas": {
		maxTokens: 1_000_000,
		contextWindow: 10_485_760,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0.25,
		outputPrice: 0.7,
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
	"gemini-2.5-pro": {
		maxTokens: 65536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		supportsGlobalEndpoint: true,
		inputPrice: 2.5,
		outputPrice: 15,
		cacheReadsPrice: 0.625,
		thinkingConfig: {
			maxBudget: 32767,
		},
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
	"gemini-2.5-flash": {
		maxTokens: 65536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		supportsGlobalEndpoint: true,
		inputPrice: 0.3,
		outputPrice: 2.5,
		thinkingConfig: {
			maxBudget: 24576,
			outputPrice: 3.5,
		},
	},

	"gemini-2.5-flash-lite-preview-06-17": {
		maxTokens: 64000,
		contextWindow: 1_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		supportsGlobalEndpoint: true,
		inputPrice: 0.1,
		outputPrice: 0.4,
		cacheReadsPrice: 0.025,
		description: "Preview version - may not be available in all regions",
		thinkingConfig: {
			maxBudget: 24576,
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
	Object.entries(vertexModels).filter(([_k, v]) => Object.hasOwn(v, "supportsGlobalEndpoint")),
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
export const geminiDefaultModelId: GeminiModelId = "gemini-3-pro-preview"
export const geminiModels = {
	"gemini-3-pro-preview": {
		maxTokens: 65536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 4.0,
		outputPrice: 18.0,
		cacheReadsPrice: 0.4,
		thinkingConfig: {
			// If you don't specify a thinking level, Gemini will use the model's default
			// dynamic thinking level, "high", for Gemini 3 Pro Preview.
			geminiThinkingLevel: "high",
			supportsThinkingLevel: true,
		},
		tiers: [
			{
				contextWindow: 200000,
				inputPrice: 2.0,
				outputPrice: 12.0,
				cacheReadsPrice: 0.2,
			},
			{
				contextWindow: Infinity,
				inputPrice: 4.0,
				outputPrice: 18.0,
				cacheReadsPrice: 0.4,
			},
		],
	},
	"gemini-2.5-pro": {
		maxTokens: 65536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 2.5,
		outputPrice: 15,
		cacheReadsPrice: 0.625,
		thinkingConfig: {
			maxBudget: 32767,
		},
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
	"gemini-2.5-flash-lite-preview-06-17": {
		maxTokens: 64000,
		contextWindow: 1_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		supportsGlobalEndpoint: true,
		inputPrice: 0.1,
		outputPrice: 0.4,
		cacheReadsPrice: 0.025,
		description: "Preview version - may not be available in all regions",
		thinkingConfig: {
			maxBudget: 24576,
		},
	},
	"gemini-2.5-flash": {
		maxTokens: 65536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.3,
		outputPrice: 2.5,
		cacheReadsPrice: 0.075,
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
export const openAiNativeDefaultModelId: OpenAiNativeModelId = "gpt-5.2"
export const openAiNativeModels = {
	"gpt-5.2": {
		maxTokens: 8_192,
		contextWindow: 272000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 1.75,
		outputPrice: 14.0,
		cacheReadsPrice: 0.175,
		temperature: 1,
		systemRole: "developer",
		supportsReasoningEffort: true,
	},
	"gpt-5.1-2025-11-13": {
		maxTokens: 8_192,
		contextWindow: 272000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 1.25,
		outputPrice: 10.0,
		cacheReadsPrice: 0.125,
		temperature: 1,
		systemRole: "developer",
		supportsReasoningEffort: true,
	},
	"gpt-5.1": {
		maxTokens: 8_192, // 128000 breaks context window truncation
		contextWindow: 272000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 1.25,
		outputPrice: 10.0,
		cacheReadsPrice: 0.125,
		temperature: 1,
		systemRole: "developer",
		supportsReasoningEffort: true,
	},
	"gpt-5.1-codex": {
		maxTokens: 8_192, // 128000 breaks context window truncation
		contextWindow: 400000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 1.25,
		outputPrice: 10.0,
		cacheReadsPrice: 0.125,
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		temperature: 1,
		systemRole: "developer",
		supportsReasoningEffort: true,
	},
	"gpt-5.1-chat-latest": {
		maxTokens: 8_192,
		contextWindow: 400000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 1.25,
		outputPrice: 10,
		cacheReadsPrice: 0.125,
		temperature: 1,
		systemRole: "developer",
		supportsReasoningEffort: true,
	},
	"gpt-5-2025-08-07": {
		maxTokens: 8_192, // 128000 breaks context window truncation
		contextWindow: 272000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 1.25,
		outputPrice: 10.0,
		cacheReadsPrice: 0.125,
		temperature: 1,
		systemRole: "developer",
		supportsReasoningEffort: true,
	},
	"gpt-5-codex": {
		maxTokens: 8_192, // 128000 breaks context window truncation
		contextWindow: 400000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 1.25,
		outputPrice: 10.0,
		cacheReadsPrice: 0.125,
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		temperature: 1,
		systemRole: "developer",
		supportsReasoningEffort: true,
	},
	"gpt-5-mini-2025-08-07": {
		maxTokens: 8_192,
		contextWindow: 272000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.25,
		outputPrice: 2.0,
		cacheReadsPrice: 0.025,
		temperature: 1,
		systemRole: "developer",
		supportsReasoningEffort: true,
	},
	"gpt-5-nano-2025-08-07": {
		maxTokens: 8_192,
		contextWindow: 272000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.05,
		outputPrice: 0.4,
		cacheReadsPrice: 0.005,
		temperature: 1,
		systemRole: "developer",
		supportsReasoningEffort: true,
	},
	"gpt-5-chat-latest": {
		maxTokens: 8_192,
		contextWindow: 400000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 1.25,
		outputPrice: 10,
		cacheReadsPrice: 0.125,
		temperature: 1,
		systemRole: "developer",
		supportsReasoningEffort: true,
	},
	o3: {
		maxTokens: 100_000,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 2.0,
		outputPrice: 8.0,
		cacheReadsPrice: 0.5,
		systemRole: "developer",
		supportsReasoningEffort: true,
		supportsTools: false,
	},
	"o4-mini": {
		maxTokens: 100_000,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 1.1,
		outputPrice: 4.4,
		cacheReadsPrice: 0.275,
		systemRole: "developer",
		supportsReasoningEffort: true,
		supportsTools: false,
	},
	"gpt-4.1": {
		maxTokens: 32_768,
		contextWindow: 1_047_576,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 2,
		outputPrice: 8,
		cacheReadsPrice: 0.5,
		temperature: 0,
	},
	"gpt-4.1-mini": {
		maxTokens: 32_768,
		contextWindow: 1_047_576,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.4,
		outputPrice: 1.6,
		cacheReadsPrice: 0.1,
		temperature: 0,
	},
	"gpt-4.1-nano": {
		maxTokens: 32_768,
		contextWindow: 1_047_576,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.1,
		outputPrice: 0.4,
		cacheReadsPrice: 0.025,
		temperature: 0,
	},
	"o3-mini": {
		maxTokens: 100_000,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 1.1,
		outputPrice: 4.4,
		cacheReadsPrice: 0.55,
		systemRole: "developer",
		supportsReasoningEffort: true,
		supportsTools: false,
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
		supportsStreaming: false,
	},
	"o1-preview": {
		maxTokens: 32_768,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 15,
		outputPrice: 60,
		cacheReadsPrice: 7.5,
		supportsStreaming: false,
	},
	"o1-mini": {
		maxTokens: 65_536,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 1.1,
		outputPrice: 4.4,
		cacheReadsPrice: 0.55,
		supportsStreaming: false,
	},
	"gpt-4o": {
		maxTokens: 4_096,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 2.5,
		outputPrice: 10,
		cacheReadsPrice: 1.25,
		temperature: 0,
	},
	"gpt-4o-mini": {
		maxTokens: 16_384,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.15,
		outputPrice: 0.6,
		cacheReadsPrice: 0.075,
		temperature: 0,
	},
	"chatgpt-4o-latest": {
		maxTokens: 16_384,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 5,
		outputPrice: 15,
		temperature: 0,
	},
} as const satisfies Record<string, OpenAiCompatibleModelInfo>

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
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: true, // supports context caching, but not in the way anthropic does it (deepseek reports input tokens and reads/writes in the same usage report) FIXME: we need to show users cache stats how deepseek does it
		inputPrice: 0, // technically there is no input price, it's all either a cache hit or miss (ApiOptions will not show this). Input is the sum of cache reads and writes
		outputPrice: 1.1,
		cacheWritesPrice: 0.27,
		cacheReadsPrice: 0.07,
	},
	"deepseek-reasoner": {
		maxTokens: 8_000,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: true, // supports context caching, but not in the way anthropic does it (deepseek reports input tokens and reads/writes in the same usage report) FIXME: we need to show users cache stats how deepseek does it
		inputPrice: 0, // technically there is no input price, it's all either a cache hit or miss (ApiOptions will not show this)
		outputPrice: 2.19,
		cacheWritesPrice: 0.55,
		cacheReadsPrice: 0.14,
	},
} as const satisfies Record<string, ModelInfo>

// Hugging Face Inference Providers
// https://huggingface.co/docs/inference-providers/en/index
export type HuggingFaceModelId = keyof typeof huggingFaceModels
export const huggingFaceDefaultModelId: HuggingFaceModelId = "moonshotai/Kimi-K2-Instruct"
export const huggingFaceModels = {
	"openai/gpt-oss-120b": {
		maxTokens: 32766,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"Large open-weight reasoning model for high-end desktops and data centers, built for complex coding, math, and general AI tasks.",
	},
	"openai/gpt-oss-20b": {
		maxTokens: 32766,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"Medium open-weight reasoning model that runs on most desktops, balancing strong reasoning with broad accessibility.",
	},
	"moonshotai/Kimi-K2-Instruct": {
		maxTokens: 131_072,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Advanced reasoning model with superior performance across coding, math, and general capabilities.",
	},
	"deepseek-ai/DeepSeek-V3-0324": {
		maxTokens: 8192,
		contextWindow: 64_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Advanced reasoning model with superior performance across coding, math, and general capabilities.",
	},
	"deepseek-ai/DeepSeek-R1": {
		maxTokens: 8192,
		contextWindow: 64_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "DeepSeek's reasoning model with step-by-step thinking capabilities.",
	},
	"deepseek-ai/DeepSeek-R1-0528": {
		maxTokens: 64_000,
		contextWindow: 64_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "DeepSeek's reasoning model's latest version with step-by-step thinking capabilities",
	},
	"meta-llama/Llama-3.1-8B-Instruct": {
		maxTokens: 8192,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Efficient 8B parameter Llama model for general-purpose tasks.",
	},
} as const satisfies Record<string, ModelInfo>

// Qwen
// https://bailian.console.aliyun.com/
// The first model in the list is used as the default model for each region
export const internationalQwenModels = {
	"qwen3-coder-plus": {
		maxTokens: 65_536,
		contextWindow: 1_000_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 1,
		outputPrice: 5,
	},
	"qwen3-coder-480b-a35b-instruct": {
		maxTokens: 65_536,
		contextWindow: 204_800,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 1.5,
		outputPrice: 7.5,
	},
	"qwen3-235b-a22b": {
		maxTokens: 16_384,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 2,
		outputPrice: 8,
		cacheWritesPrice: 2,
		cacheReadsPrice: 8,
		thinkingConfig: {
			maxBudget: 38_912,
			outputPrice: 20,
		},
	},
	"qwen3-32b": {
		maxTokens: 16_384,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 2,
		outputPrice: 8,
		cacheWritesPrice: 2,
		cacheReadsPrice: 8,
		thinkingConfig: {
			maxBudget: 38_912,
			outputPrice: 20,
		},
	},
	"qwen3-30b-a3b": {
		maxTokens: 16_384,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.75,
		outputPrice: 3,
		cacheWritesPrice: 0.75,
		cacheReadsPrice: 3,
		thinkingConfig: {
			maxBudget: 38_912,
			outputPrice: 7.5,
		},
	},
	"qwen3-14b": {
		maxTokens: 8_192,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 1,
		outputPrice: 4,
		cacheWritesPrice: 1,
		cacheReadsPrice: 4,
		thinkingConfig: {
			maxBudget: 38_912,
			outputPrice: 10,
		},
	},
	"qwen3-8b": {
		maxTokens: 8_192,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.5,
		outputPrice: 2,
		cacheWritesPrice: 0.5,
		cacheReadsPrice: 2,
		thinkingConfig: {
			maxBudget: 38_912,
			outputPrice: 5,
		},
	},
	"qwen3-4b": {
		maxTokens: 8_192,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.3,
		outputPrice: 1.2,
		cacheWritesPrice: 0.3,
		cacheReadsPrice: 1.2,
		thinkingConfig: {
			maxBudget: 38_912,
			outputPrice: 3,
		},
	},
	"qwen3-1.7b": {
		maxTokens: 8_192,
		contextWindow: 32_768,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.3,
		outputPrice: 1.2,
		cacheWritesPrice: 0.3,
		cacheReadsPrice: 1.2,
		thinkingConfig: {
			maxBudget: 30_720,
			outputPrice: 3,
		},
	},
	"qwen3-0.6b": {
		maxTokens: 8_192,
		contextWindow: 32_768,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.3,
		outputPrice: 1.2,
		cacheWritesPrice: 0.3,
		cacheReadsPrice: 1.2,
		thinkingConfig: {
			maxBudget: 30_720,
			outputPrice: 3,
		},
	},
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
		maxTokens: 16_384,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.8,
		outputPrice: 2,
		cacheWritesPrice: 0.8,
		cacheReadsPrice: 2,
		thinkingConfig: {
			maxBudget: 38_912,
			outputPrice: 16,
		},
	},
	"qwen-turbo-latest": {
		maxTokens: 16_384,
		contextWindow: 1_000_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.3,
		outputPrice: 0.6,
		cacheWritesPrice: 0.3,
		cacheReadsPrice: 0.6,
		thinkingConfig: {
			maxBudget: 38_912,
			outputPrice: 6,
		},
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
	"qwen3-235b-a22b": {
		maxTokens: 16_384,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 2,
		outputPrice: 8,
		cacheWritesPrice: 2,
		cacheReadsPrice: 8,
		thinkingConfig: {
			maxBudget: 38_912,
			outputPrice: 20,
		},
	},
	"qwen3-32b": {
		maxTokens: 16_384,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 2,
		outputPrice: 8,
		cacheWritesPrice: 2,
		cacheReadsPrice: 8,
		thinkingConfig: {
			maxBudget: 38_912,
			outputPrice: 20,
		},
	},
	"qwen3-30b-a3b": {
		maxTokens: 16_384,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.75,
		outputPrice: 3,
		cacheWritesPrice: 0.75,
		cacheReadsPrice: 3,
		thinkingConfig: {
			maxBudget: 38_912,
			outputPrice: 7.5,
		},
	},
	"qwen3-14b": {
		maxTokens: 8_192,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 1,
		outputPrice: 4,
		cacheWritesPrice: 1,
		cacheReadsPrice: 4,
		thinkingConfig: {
			maxBudget: 38_912,
			outputPrice: 10,
		},
	},
	"qwen3-8b": {
		maxTokens: 8_192,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.5,
		outputPrice: 2,
		cacheWritesPrice: 0.5,
		cacheReadsPrice: 2,
		thinkingConfig: {
			maxBudget: 38_912,
			outputPrice: 5,
		},
	},
	"qwen3-4b": {
		maxTokens: 8_192,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.3,
		outputPrice: 1.2,
		cacheWritesPrice: 0.3,
		cacheReadsPrice: 1.2,
		thinkingConfig: {
			maxBudget: 38_912,
			outputPrice: 3,
		},
	},
	"qwen3-1.7b": {
		maxTokens: 8_192,
		contextWindow: 32_768,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.3,
		outputPrice: 1.2,
		cacheWritesPrice: 0.3,
		cacheReadsPrice: 1.2,
		thinkingConfig: {
			maxBudget: 30_720,
			outputPrice: 3,
		},
	},
	"qwen3-0.6b": {
		maxTokens: 8_192,
		contextWindow: 32_768,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.3,
		outputPrice: 1.2,
		cacheWritesPrice: 0.3,
		cacheReadsPrice: 1.2,
		thinkingConfig: {
			maxBudget: 30_720,
			outputPrice: 3,
		},
	},
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
		maxTokens: 16_384,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.8,
		outputPrice: 2,
		cacheWritesPrice: 0.8,
		cacheReadsPrice: 2,
		thinkingConfig: {
			maxBudget: 38_912,
			outputPrice: 16,
		},
	},
	"qwen-turbo-latest": {
		maxTokens: 16_384,
		contextWindow: 1_000_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.3,
		outputPrice: 0.6,
		cacheWritesPrice: 0.3,
		cacheReadsPrice: 0.6,
		thinkingConfig: {
			maxBudget: 38_912,
			outputPrice: 6,
		},
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
export enum QwenApiRegions {
	CHINA = "china",
	INTERNATIONAL = "international",
}
export type MainlandQwenModelId = keyof typeof mainlandQwenModels
export type InternationalQwenModelId = keyof typeof internationalQwenModels
// Set first model in the list as the default model for each region
export const internationalQwenDefaultModelId: InternationalQwenModelId = Object.keys(
	internationalQwenModels,
)[0] as InternationalQwenModelId
export const mainlandQwenDefaultModelId: MainlandQwenModelId = Object.keys(mainlandQwenModels)[0] as MainlandQwenModelId

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
export const mistralDefaultModelId: MistralModelId = "devstral-2512"
export const mistralModels = {
	"devstral-2512": {
		maxTokens: 256_000,
		contextWindow: 256_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
	},
	"labs-devstral-small-2512": {
		maxTokens: 256_000,
		contextWindow: 256_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
	},
	"mistral-large-2512": {
		maxTokens: 256_000,
		contextWindow: 256_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.5,
		outputPrice: 1.5,
	},
	"ministral-14b-2512": {
		maxTokens: 256_000,
		contextWindow: 256_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.2,
		outputPrice: 0.2,
	},
	"mistral-large-2411": {
		maxTokens: 128_000,
		contextWindow: 128_000,
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
		maxTokens: 128_000,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.04,
		outputPrice: 0.04,
	},
	"ministral-8b-2410": {
		maxTokens: 128_000,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.1,
		outputPrice: 0.1,
	},
	"mistral-small-latest": {
		maxTokens: 128_000,
		contextWindow: 128_000,
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
		maxTokens: 128_000,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0.15,
		outputPrice: 0.15,
	},
	"open-mistral-nemo-2407": {
		maxTokens: 128_000,
		contextWindow: 128_000,
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
	"devstral-medium-latest": {
		maxTokens: 128_000,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.4,
		outputPrice: 2.0,
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
export const askSageDefaultModelId: AskSageModelId = "claude-4-sonnet"
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
	"gpt-4.1": {
		maxTokens: 32_768,
		contextWindow: 1_047_576,
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
	"claude-4-sonnet": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
	},
	"claude-4-opus": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
	},
	"google-gemini-2.5-pro": {
		maxTokens: 65536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
	},
	"google-claude-45-sonnet": {
		maxTokens: 64000,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
	},
	"google-claude-4-opus": {
		maxTokens: 32000,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
	},
	"gpt-5": {
		maxTokens: 65536,
		contextWindow: 2_097_152,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
	},
	"gpt-5-mini": {
		maxTokens: 32768,
		contextWindow: 1_048_576,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
	},
	"gpt-5-nano": {
		maxTokens: 16384,
		contextWindow: 262_144,
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
	"deepseek-ai/DeepSeek-R1-0528": {
		maxTokens: 128_000,
		contextWindow: 163_840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.8,
		outputPrice: 2.4,
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
	"openai/gpt-oss-120b": {
		maxTokens: 32766, // Quantization: fp4
		contextWindow: 131_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.15,
		outputPrice: 0.6,
	},
	"moonshotai/Kimi-K2-Instruct": {
		maxTokens: 16384, // Quantization: fp4
		contextWindow: 131_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.5,
		outputPrice: 2.4,
	},
	"Qwen/Qwen3-Coder-480B-A35B-Instruct": {
		maxTokens: 163800, // Quantization: fp8
		contextWindow: 262_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.4,
		outputPrice: 1.8,
	},
	"openai/gpt-oss-20b": {
		maxTokens: 32766, // Quantization: fp4
		contextWindow: 131_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.05,
		outputPrice: 0.2,
	},
	"zai-org/GLM-4.5": {
		maxTokens: 98304, // Quantization: fp8
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.6,
		outputPrice: 2.2,
	},
	"zai-org/GLM-4.5-Air": {
		maxTokens: 98304, // Quantization: fp8
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.2,
		outputPrice: 1.2,
	},
	"deepseek-ai/DeepSeek-R1-0528-fast": {
		maxTokens: 128000, // Quantization: fp4
		contextWindow: 164_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 2.0,
		outputPrice: 6.0,
	},
	"Qwen/Qwen3-235B-A22B-Instruct-2507": {
		maxTokens: 64000, // Quantization: fp8
		contextWindow: 262_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.2,
		outputPrice: 0.6,
	},
	"Qwen/Qwen3-30B-A3B": {
		maxTokens: 32000, // Quantization: fp8
		contextWindow: 41_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.1,
		outputPrice: 0.3,
	},
	"Qwen/Qwen3-32B": {
		maxTokens: 16384, // Quantization: fp8
		contextWindow: 41_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.1,
		outputPrice: 0.3,
	},
	"Qwen/Qwen3-32B-fast": {
		maxTokens: 16384, // Quantization: fp8
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
export const xaiDefaultModelId: XAIModelId = "grok-4"
export const xaiModels = {
	"grok-4-1-fast-reasoning": {
		contextWindow: 2_000_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.2,
		cacheReadsPrice: 0.05,
		outputPrice: 0.5,
		description: "xAI's Grok 4.1 Reasoning Fast - multimodal model with 2M context.",
	},
	"grok-4-1-fast-non-reasoning": {
		contextWindow: 2_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.2,
		cacheReadsPrice: 0.05,
		outputPrice: 0.5,
		description: "xAI's Grok 4.1 Non-Reasoning Fast - multimodal model with 2M context.",
	},
	"grok-code-fast-1": {
		contextWindow: 256_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.2,
		cacheReadsPrice: 0.02,
		outputPrice: 1.5,
		description: "xAI's Grok Coding model.",
	},
	"grok-4-fast-reasoning": {
		maxTokens: 30000,
		contextWindow: 2000000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0.2,
		cacheReadsPrice: 0.05,
		outputPrice: 0.5,
		description: "xAI's Grok 4 Fast (free) multimodal model with 2M context.",
	},
	"grok-4": {
		maxTokens: 8192,
		contextWindow: 262144,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 3.0, // will have different pricing for long context vs short context
		cacheReadsPrice: 0.75,
		outputPrice: 15.0,
	},
	"grok-3-beta": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
		description: "X AI's Grok-3 beta model with 131K context window",
	},
	"grok-3-fast-beta": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 5.0,
		outputPrice: 25.0,
		description: "X AI's Grok-3 fast beta model with 131K context window",
	},
	"grok-3-mini-beta": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.3,
		outputPrice: 0.5,
		description: "X AI's Grok-3 mini beta model with 131K context window",
	},
	"grok-3-mini-fast-beta": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.6,
		outputPrice: 4.0,
		description: "X AI's Grok-3 mini fast beta model with 131K context window",
	},
	"grok-3": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
		description: "X AI's Grok-3 model with 131K context window",
	},
	"grok-3-fast": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 5.0,
		outputPrice: 25.0,
		description: "X AI's Grok-3 fast model with 131K context window",
	},
	"grok-3-mini": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.3,
		outputPrice: 0.5,
		description: "X AI's Grok-3 mini model with 131K context window",
	},
	"grok-3-mini-fast": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: true,
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
	"DeepSeek-V3.1": {
		maxTokens: 7168,
		contextWindow: 32_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 3.0,
		outputPrice: 4.5,
	},
} as const satisfies Record<string, ModelInfo>

// Cerebras
// https://inference-docs.cerebras.ai/api-reference/models
export type CerebrasModelId = keyof typeof cerebrasModels
export const cerebrasDefaultModelId: CerebrasModelId = "zai-glm-4.6"
export const cerebrasModels = {
	"zai-glm-4.6": {
		maxTokens: 40000,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Intelligent general purpose model with 1,000 tokens/s",
	},
	"gpt-oss-120b": {
		maxTokens: 65536,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Intelligent general purpose model with 3,000 tokens/s",
	},
	"qwen-3-235b-a22b-instruct-2507": {
		maxTokens: 64000,
		contextWindow: 64000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Intelligent model with ~1400 tokens/s",
	},
	"llama-3.3-70b": {
		maxTokens: 64000,
		contextWindow: 64000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Powerful model with ~2600 tokens/s",
	},
	"qwen-3-32b": {
		maxTokens: 64000,
		contextWindow: 64000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "SOTA coding performance with ~2500 tokens/s",
	},
} as const satisfies Record<string, ModelInfo>

// Groq
// https://console.groq.com/docs/models
// https://groq.com/pricing/
export type GroqModelId = keyof typeof groqModels
export const groqDefaultModelId: GroqModelId = "moonshotai/kimi-k2-instruct-0905"
export const groqModels = {
	"openai/gpt-oss-120b": {
		maxTokens: 32766, // Model fails if you try to use more than 32K tokens
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.15,
		outputPrice: 0.75,
		description:
			"A state-of-the-art 120B open-weight Mixture-of-Experts language model optimized for strong reasoning, tool use, and efficient deployment on large GPUs",
	},
	"openai/gpt-oss-20b": {
		maxTokens: 32766, // Model fails if you try to use more than 32K tokens
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.1,
		outputPrice: 0.5,
		description:
			"A compact 20B open-weight Mixture-of-Experts language model designed for strong reasoning and tool use, ideal for edge devices and local inference.",
	},
	// Compound Beta Models - Hybrid architectures optimized for tool use
	"compound-beta": {
		maxTokens: 8192,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.0,
		outputPrice: 0.0,
		description:
			"Compound model using Llama 4 Scout for core reasoning with Llama 3.3 70B for routing and tool use. Excellent for plan/act workflows.",
	},
	"compound-beta-mini": {
		maxTokens: 8192,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.0,
		outputPrice: 0.0,
		description: "Lightweight compound model for faster inference while maintaining tool use capabilities.",
	},
	// DeepSeek Models - Reasoning-optimized
	"deepseek-r1-distill-llama-70b": {
		maxTokens: 131072,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.75,
		outputPrice: 0.99,
		description:
			"DeepSeek R1 reasoning capabilities distilled into Llama 70B architecture. Excellent for complex problem-solving and planning.",
	},
	// Llama 4 Models
	"meta-llama/llama-4-maverick-17b-128e-instruct": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0.2,
		outputPrice: 0.6,
		description: "Meta's Llama 4 Maverick 17B model with 128 experts, supports vision and multimodal tasks.",
	},
	"meta-llama/llama-4-scout-17b-16e-instruct": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0.11,
		outputPrice: 0.34,
		description: "Meta's Llama 4 Scout 17B model with 16 experts, optimized for fast inference and general tasks.",
	},
	// Llama 3.3 Models
	"llama-3.3-70b-versatile": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.59,
		outputPrice: 0.79,
		description: "Meta's latest Llama 3.3 70B model optimized for versatile use cases with excellent performance and speed.",
	},
	// Llama 3.1 Models - Fast inference
	"llama-3.1-8b-instant": {
		maxTokens: 131072,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.05,
		outputPrice: 0.08,
		description: "Fast and efficient Llama 3.1 8B model optimized for speed, low latency, and reliable tool execution.",
	},
	// Moonshot Models
	"moonshotai/kimi-k2-instruct": {
		maxTokens: 16384,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 1.0,
		outputPrice: 3.0,
		cacheReadsPrice: 0.5, // 50% discount for cached input tokens
		description:
			"Kimi K2 is Moonshot AI's state-of-the-art Mixture-of-Experts (MoE) language model with 1 trillion total parameters and 32 billion activated parameters.",
	},
	"moonshotai/kimi-k2-instruct-0905": {
		maxTokens: 16384,
		contextWindow: 262144,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.6,
		outputPrice: 2.5,
		cacheReadsPrice: 0.15,
		description:
			"Kimi K2 model gets a new version update: Agentic coding: more accurate, better generalization across scaffolds. Frontend coding: improved aesthetics and functionalities on web, 3d, and other tasks. Context length: extended from 128k to 256k, providing better long-horizon support.",
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

// SAP AI Core
export type SapAiCoreModelId = keyof typeof sapAiCoreModels
export const sapAiCoreDefaultModelId: SapAiCoreModelId = "anthropic--claude-3.5-sonnet"
// Pricing is calculated using Capacity Units, not directly in USD
const sapAiCoreModelDescription = "Pricing is calculated using SAP's Capacity Units rather than direct USD pricing."
export const sapAiCoreModels = {
	"anthropic--claude-4.5-sonnet": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		description: sapAiCoreModelDescription,
	},
	"anthropic--claude-4-sonnet": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		description: sapAiCoreModelDescription,
	},
	"anthropic--claude-4-opus": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		description: sapAiCoreModelDescription,
	},
	"anthropic--claude-3.7-sonnet": {
		maxTokens: 64_000,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		description: sapAiCoreModelDescription,
	},
	"anthropic--claude-3.5-sonnet": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: false,
		description: sapAiCoreModelDescription,
	},
	"anthropic--claude-3-sonnet": {
		maxTokens: 4096,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: false,
		description: sapAiCoreModelDescription,
	},
	"anthropic--claude-3-haiku": {
		maxTokens: 4096,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: false,
		description: sapAiCoreModelDescription,
	},
	"anthropic--claude-3-opus": {
		maxTokens: 4096,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: false,
		description: sapAiCoreModelDescription,
	},
	"gemini-2.5-pro": {
		maxTokens: 65536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		thinkingConfig: {
			maxBudget: 32767,
		},
		description: sapAiCoreModelDescription,
	},
	"gemini-2.5-flash": {
		maxTokens: 65536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		thinkingConfig: {
			maxBudget: 24576,
		},
		description: sapAiCoreModelDescription,
	},
	"gpt-4": {
		maxTokens: 4096,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: false,
		description: sapAiCoreModelDescription,
	},
	"gpt-4o": {
		maxTokens: 4096,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: false,
		description: sapAiCoreModelDescription,
	},
	"gpt-4o-mini": {
		maxTokens: 4096,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: false,
		description: sapAiCoreModelDescription,
	},
	"gpt-4.1": {
		maxTokens: 32_768,
		contextWindow: 1_047_576,
		supportsImages: true,
		supportsPromptCache: true,
		description: sapAiCoreModelDescription,
	},
	"gpt-4.1-nano": {
		maxTokens: 32_768,
		contextWindow: 1_047_576,
		supportsImages: true,
		supportsPromptCache: true,
		description: sapAiCoreModelDescription,
	},
	"gpt-5": {
		maxTokens: 128_000,
		contextWindow: 272_000,
		supportsImages: true,
		supportsPromptCache: true,
		description: sapAiCoreModelDescription,
	},
	"gpt-5-nano": {
		maxTokens: 128_000,
		contextWindow: 272_000,
		supportsImages: true,
		supportsPromptCache: true,
		description: sapAiCoreModelDescription,
	},
	"gpt-5-mini": {
		maxTokens: 128_000,
		contextWindow: 272_000,
		supportsImages: true,
		supportsPromptCache: true,
		description: sapAiCoreModelDescription,
	},
	o1: {
		maxTokens: 4096,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: false,
		description: sapAiCoreModelDescription,
	},
	o3: {
		maxTokens: 100_000,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		description: sapAiCoreModelDescription,
	},
	"o3-mini": {
		maxTokens: 4096,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: false,
		description: sapAiCoreModelDescription,
	},
	"o4-mini": {
		maxTokens: 100_000,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		description: sapAiCoreModelDescription,
	},
	sonar: {
		maxTokens: 128_000,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: false,
		description: sapAiCoreModelDescription,
	},
	"sonar-pro": {
		maxTokens: 128_000,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: false,
		description: sapAiCoreModelDescription,
	},
} as const satisfies Record<string, ModelInfo>

// Moonshot AI Studio
// https://platform.moonshot.ai/docs/pricing/chat
export const moonshotModels = {
	"kimi-k2-0905-preview": {
		maxTokens: 16384,
		contextWindow: 262144,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.6,
		outputPrice: 2.5,
		temperature: 0.6,
	},
	"kimi-k2-0711-preview": {
		maxTokens: 32_000,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.6,
		outputPrice: 2.5,
		temperature: 0.6,
	},
	"kimi-k2-turbo-preview": {
		maxTokens: 32_000,
		contextWindow: 262_144,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 2.4,
		outputPrice: 10,
		temperature: 0.6,
	},
	"kimi-k2-thinking": {
		maxTokens: 32_000,
		contextWindow: 262_144,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.6,
		outputPrice: 2.5,
		temperature: 1.0,
	},
	"kimi-k2-thinking-turbo": {
		maxTokens: 32_000,
		contextWindow: 262_144,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 2.4,
		outputPrice: 10,
		temperature: 1.0,
	},
} as const satisfies Record<string, OpenAiCompatibleModelInfo>
export type MoonshotModelId = keyof typeof moonshotModels
export const moonshotDefaultModelId = "kimi-k2-0905-preview" satisfies MoonshotModelId

// Huawei Cloud MaaS
// Dify.ai - No model selection needed, models are configured in Dify workflows

export type HuaweiCloudMaasModelId = keyof typeof huaweiCloudMaasModels
export const huaweiCloudMaasDefaultModelId: HuaweiCloudMaasModelId = "DeepSeek-V3"
export const huaweiCloudMaasModels = {
	"DeepSeek-V3": {
		maxTokens: 16_384,
		contextWindow: 64_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.27,
		outputPrice: 1.1,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
	},
	"DeepSeek-R1": {
		maxTokens: 16_384,
		contextWindow: 64_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.55,
		outputPrice: 2.2,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		thinkingConfig: {
			maxBudget: 8192,
			outputPrice: 2.2,
		},
	},
	"deepseek-r1-250528": {
		maxTokens: 16_384,
		contextWindow: 64_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.55,
		outputPrice: 2.2,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		thinkingConfig: {
			maxBudget: 8192,
			outputPrice: 2.2,
		},
	},
	"qwen3-235b-a22b": {
		maxTokens: 8_192,
		contextWindow: 32_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.27,
		outputPrice: 1.1,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		thinkingConfig: {
			maxBudget: 4096,
			outputPrice: 1.1,
		},
	},
	"qwen3-32b": {
		maxTokens: 8_192,
		contextWindow: 32_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.27,
		outputPrice: 1.1,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		thinkingConfig: {
			maxBudget: 4096,
			outputPrice: 1.1,
		},
	},
} as const satisfies Record<string, ModelInfo>

// Baseten
// https://baseten.co/products/model-apis/
// Extended ModelInfo to include supportedFeatures, like tools
export interface BasetenModelInfo extends ModelInfo {
	supportedFeatures?: string[]
}

export const basetenModels = {
	"moonshotai/Kimi-K2-Thinking": {
		maxTokens: 163_800,
		contextWindow: 262_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.6,
		outputPrice: 2.5,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		description: "Kimi K2 Thinking - A model with enhanced reasoning capabilities from Kimi K2",
	},
	"zai-org/GLM-4.6": {
		maxTokens: 200_000,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.6,
		outputPrice: 2.2,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		description: "Frontier open model with advanced agentic, reasoning and coding capabilities",
	},
	"deepseek-ai/DeepSeek-R1": {
		maxTokens: 131_072,
		contextWindow: 163_840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 2.55,
		outputPrice: 5.95,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		description: "DeepSeek's first-generation reasoning model",
	},
	"deepseek-ai/DeepSeek-R1-0528": {
		maxTokens: 131_072,
		contextWindow: 163_840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 2.55,
		outputPrice: 5.95,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		description: "The latest revision of DeepSeek's first-generation reasoning model",
	},
	"deepseek-ai/DeepSeek-V3-0324": {
		maxTokens: 131_072,
		contextWindow: 163_840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.77,
		outputPrice: 0.77,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		description: "Fast general-purpose LLM with enhanced reasoning capabilities",
	},
	"deepseek-ai/DeepSeek-V3.1": {
		maxTokens: 131_072,
		contextWindow: 163_840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.5,
		outputPrice: 1.5,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		description: "Extremely capable general-purpose LLM with hybrid reasoning capabilities and advanced tool calling",
	},
	"deepseek-ai/DeepSeek-V3.2": {
		maxTokens: 131_072,
		contextWindow: 163_840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.3,
		outputPrice: 0.45,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		description: "DeepSeek's hybrid reasoning model with efficient long context scaling with GPT-5 level performance",
	},
	"Qwen/Qwen3-235B-A22B-Instruct-2507": {
		maxTokens: 262_144,
		contextWindow: 262_144,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.22,
		outputPrice: 0.8,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		description: "Mixture-of-experts LLM with math and reasoning capabilities",
	},
	"Qwen/Qwen3-Coder-480B-A35B-Instruct": {
		maxTokens: 262_144,
		contextWindow: 262_144,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.38,
		outputPrice: 1.53,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		description: "Mixture-of-experts LLM with advanced coding and reasoning capabilities",
	},
	"openai/gpt-oss-120b": {
		maxTokens: 128_072,
		contextWindow: 128_072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.1,
		outputPrice: 0.5,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		description: "Extremely capable general-purpose LLM with strong, controllable reasoning capabilities",
	},
	"moonshotai/Kimi-K2-Instruct-0905": {
		maxTokens: 168_000,
		contextWindow: 262_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.6,
		outputPrice: 2.5,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		description: "State of the art language model for agentic and coding tasks. Septemeber Update.",
	},
} as const satisfies Record<string, ModelInfo>
export type BasetenModelId = keyof typeof basetenModels
export const basetenDefaultModelId = "zai-org/GLM-4.6" satisfies BasetenModelId

// Z AI
// https://docs.z.ai/guides/llm/glm-4.5
// https://docs.z.ai/guides/overview/pricing
export type internationalZAiModelId = keyof typeof internationalZAiModels
export const internationalZAiDefaultModelId: internationalZAiModelId = "glm-4.5"
export const internationalZAiModels = {
	"glm-4.6": {
		maxTokens: 128_000,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.6,
		outputPrice: 2.2,
	},
	"glm-4.5": {
		maxTokens: 98_304,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.6,
		outputPrice: 2.2,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.11,
		description:
			"GLM-4.5 is Zhipu's latest featured model. Its comprehensive capabilities in reasoning, coding, and agent reach the state-of-the-art (SOTA) level among open-source models, with a context length of up to 128k.",
	},
	"glm-4.5-air": {
		maxTokens: 98304, // Quantization: fp8
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.2,
		outputPrice: 1.2,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.03,
		description:
			"GLM-4.5-Air is the lightweight version of GLM-4.5. It balances performance and cost-effectiveness, and can flexibly switch to hybrid thinking models.",
	},
} as const satisfies Record<string, ModelInfo>

export type mainlandZAiModelId = keyof typeof mainlandZAiModels
export const mainlandZAiDefaultModelId: mainlandZAiModelId = "glm-4.5"
export const mainlandZAiModels = {
	"glm-4.6": {
		maxTokens: 128_000,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.6,
		outputPrice: 2.2,
	},
	"glm-4.5": {
		maxTokens: 98_304,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.29,
		outputPrice: 1.14,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.057,
		description:
			"GLM-4.5 is Zhipu's latest featured model. Its comprehensive capabilities in reasoning, coding, and agent reach the state-of-the-art (SOTA) level among open-source models, with a context length of up to 128k.",
		tiers: [
			{
				contextWindow: 32_000,
				inputPrice: 0.21,
				outputPrice: 1.0,
				cacheReadsPrice: 0.043,
			},
			{
				contextWindow: 128_000,
				inputPrice: 0.29,
				outputPrice: 1.14,
				cacheReadsPrice: 0.057,
			},
			{
				contextWindow: Infinity,
				inputPrice: 0.29,
				outputPrice: 1.14,
				cacheReadsPrice: 0.057,
			},
		],
	},
	"glm-4.5-air": {
		maxTokens: 98304, // Quantization: fp8
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.086,
		outputPrice: 0.57,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.017,
		description:
			"GLM-4.5-Air is the lightweight version of GLM-4.5. It balances performance and cost-effectiveness, and can flexibly switch to hybrid thinking models.",
		tiers: [
			{
				contextWindow: 32_000,
				inputPrice: 0.057,
				outputPrice: 0.43,
				cacheReadsPrice: 0.011,
			},
			{
				contextWindow: 128_000,
				inputPrice: 0.086,
				outputPrice: 0.57,
				cacheReadsPrice: 0.017,
			},
			{
				contextWindow: Infinity,
				inputPrice: 0.086,
				outputPrice: 0.57,
				cacheReadsPrice: 0.017,
			},
		],
	},
} as const satisfies Record<string, ModelInfo>

// Fireworks AI
export type FireworksModelId = keyof typeof fireworksModels
export const fireworksDefaultModelId: FireworksModelId = "accounts/fireworks/models/kimi-k2-instruct-0905"
export const fireworksModels = {
	"accounts/fireworks/models/kimi-k2-instruct-0905": {
		maxTokens: 16384,
		contextWindow: 262144,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.6,
		outputPrice: 2.5,
		cacheReadsPrice: 0.15,
		description:
			"Kimi K2 model gets a new version update: Agentic coding: more accurate, better generalization across scaffolds. Frontend coding: improved aesthetics and functionalities on web, 3d, and other tasks. Context length: extended from 128k to 256k, providing better long-horizon support.",
	},
	"accounts/fireworks/models/qwen3-235b-a22b-instruct-2507": {
		maxTokens: 32768,
		contextWindow: 256000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.22,
		outputPrice: 0.88,
		description: "Latest Qwen3 thinking model, competitive against the best closed source models in Jul 2025.",
	},
	"accounts/fireworks/models/qwen3-coder-480b-a35b-instruct": {
		maxTokens: 32768,
		contextWindow: 256000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.45,
		outputPrice: 1.8,
		description: "Qwen3's most agentic code model to date.",
	},
	"accounts/fireworks/models/deepseek-r1-0528": {
		maxTokens: 20480,
		contextWindow: 160000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 3,
		outputPrice: 8,
		description:
			"05/28 updated checkpoint of Deepseek R1. Its overall performance is now approaching that of leading models, such as O3 and Gemini 2.5 Pro. Compared to the previous version, the upgraded model shows significant improvements in handling complex reasoning tasks, and this version also offers a reduced hallucination rate, enhanced support for function calling, and better experience for vibe coding. Note that fine-tuning for this model is only available through contacting fireworks at https://fireworks.ai/company/contact-us.",
	},
	"accounts/fireworks/models/deepseek-v3": {
		maxTokens: 16384,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.9,
		outputPrice: 0.9,
		description:
			"A strong Mixture-of-Experts (MoE) language model with 671B total parameters with 37B activated for each token from Deepseek. Note that fine-tuning for this model is only available through contacting fireworks at https://fireworks.ai/company/contact-us.",
	},
} as const satisfies Record<string, ModelInfo>

// Qwen Code
// https://chat.qwen.ai/
export const qwenCodeModels = {
	"qwen3-coder-plus": {
		maxTokens: 65_536,
		contextWindow: 1_000_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		description: "Qwen3 Coder Plus - High-performance coding model with 1M context window for large codebases",
	},
	"qwen3-coder-flash": {
		maxTokens: 65_536,
		contextWindow: 1_000_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		description: "Qwen3 Coder Flash - Fast coding model with 1M context window optimized for speed",
	},
} as const satisfies Record<string, ModelInfo>
export type QwenCodeModelId = keyof typeof qwenCodeModels
export const qwenCodeDefaultModelId: QwenCodeModelId = "qwen3-coder-plus"

// Minimax
// https://www.minimax.io/platform/document/text_api_intro
// https://www.minimax.io/platform/document/pricing
export type MinimaxModelId = keyof typeof minimaxModels
export const minimaxDefaultModelId: MinimaxModelId = "MiniMax-M2"
export const minimaxModels = {
	"MiniMax-M2": {
		maxTokens: 128_000,
		contextWindow: 192_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.3,
		outputPrice: 1.2,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
	},
} as const satisfies Record<string, ModelInfo>

// NousResearch
// https://inference-api.nousResearch.com
export type NousResearchModelId = keyof typeof nousResearchModels
export const nousResearchDefaultModelId: NousResearchModelId = "Hermes-4-405B"
export const nousResearchModels = {
	"Hermes-4-405B": {
		maxTokens: 8192,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.09,
		outputPrice: 0.37,
		description:
			"This is the largest model in the Hermes 4 family, and it is the fullest expression of our design, focused on advanced reasoning and creative depth rather than optimizing inference speed or cost.",
	},
	"Hermes-4-70B": {
		maxTokens: 8192,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.05,
		outputPrice: 0.2,
		description:
			"This incarnation of Hermes 4 balances scale and size. It handles complex reasoning tasks, while staying fast and cost effective. A versatile choice for many use cases.",
	},
} as const satisfies Record<string, ModelInfo>
