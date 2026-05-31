import { ApiFormat } from "./proto/cline/models"
import type { ApiHandlerSettings } from "./storage/state-keys"

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
	| "openai-codex"
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
	| "wandb"

export const DEFAULT_API_PROVIDER = "openrouter" as ApiProvider

export interface ApiHandlerOptions extends Partial<ApiHandlerSettings> {
	ulid?: string // Used to identify the task in API requests
	onRetryAttempt?: (attempt: number, maxRetries: number, delay: number, error: any) => void // Callback function
}

export type ApiConfiguration = ApiHandlerOptions

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
	supportsReasoning?: boolean
	reasoningEffortOptions: string[]
}

export interface HicapCompatibleModelInfo extends ModelInfo {
	temperature?: number
}

export const hicapModelInfoSafeDefaults: HicapCompatibleModelInfo = {
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
export type AnthropicModelId = string
export const ANTHROPIC_MIN_THINKING_BUDGET = 1_024
export const ANTHROPIC_MAX_THINKING_BUDGET = 6_000

// Claude Code
export type ClaudeCodeModelId = string

// AWS Bedrock
// https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html
export type BedrockModelId = string

// OpenRouter
// https://openrouter.ai/models?order=newest&supported_parameters=tools
export const openRouterDefaultModelId = "anthropic/claude-sonnet-4.5" // will always exist in openRouterModels
export const openRouterDefaultModelInfo: ModelInfo = {
	maxTokens: 64_000,
	contextWindow: 200_000,
	supportsImages: true,
	supportsPromptCache: true,
	inputPrice: 3.0,
	outputPrice: 15.0,
	cacheWritesPrice: 3.75,
	cacheReadsPrice: 0.3,
	description:
		"Claude Sonnet 4.5 is an Anthropic model for coding, agentic search, and AI agent workflows. It supports planning and implementation tasks across the software development lifecycle.\n\nRead more in the [blog post here](https://www.anthropic.com/claude/sonnet)",
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
export type VertexModelId = string

export const openAiModelInfoSafeDefaults: OpenAiCompatibleModelInfo = {
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
export type GeminiModelId = string

// OpenAI Native
// https://openai.com/api/pricing/
export type OpenAiNativeModelId = string

// OpenAI Codex (ChatGPT Plus/Pro subscription)
// Uses OAuth authentication via ChatGPT, routes to chatgpt.com/backend-api/codex/responses
// Subscription-based pricing (all costs are $0).
//
// The Codex catalog and default model id are sourced from the `@cline/llms`
// SDK; the re-export here lets callers continue importing them from
// `@shared/api` without duplicating model parameters in the extension.
// Edit `openai-codex-models.ts` to change adapter behavior.
export { getOpenAiCodexDefaultModelId, type OpenAiCodexModelId, openAiCodexModels } from "./openai-codex-models"

// Azure OpenAI
// https://learn.microsoft.com/en-us/azure/ai-services/openai/api-version-deprecation
// https://learn.microsoft.com/en-us/azure/ai-services/openai/reference#api-specs
export const azureOpenAiDefaultApiVersion = "2024-08-01-preview"

// DeepSeek model list and default are sourced from the SDK provider catalog;
// see src/sdk/model-catalog/ and webview-ui/.../providers/DeepSeekProvider.tsx.

// Hugging Face Inference Providers
// https://huggingface.co/docs/inference-providers/en/index
export type HuggingFaceModelId = string

// Qwen
// https://bailian.console.aliyun.com/
// The first model in the list is used as the default model for each region

export enum QwenApiRegions {
	CHINA = "china",
	INTERNATIONAL = "international",
}
export type MainlandQwenModelId = string
export type InternationalQwenModelId = string
// Doubao
// https://www.volcengine.com/docs/82379/1298459
// https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement
export type DoubaoModelId = string

// Mistral
// https://docs.mistral.ai/getting-started/models/models_overview/
export type MistralModelId = string

// LiteLLM
// https://docs.litellm.ai/docs/
export type LiteLLMModelId = string
export const liteLlmDefaultModelId = "anthropic/claude-3-7-sonnet-20250219"
export interface LiteLLMModelInfo extends ModelInfo {
	temperature?: number
}

export const liteLlmModelInfoSafeDefaults: LiteLLMModelInfo = {
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
export type AskSageModelId = string
export const askSageDefaultURL: string = "https://api.asksage.ai/server"
export type NebiusModelId = string

// W&B Inference by CoreWeave
// https://docs.wandb.ai/inference/models
export type WandbModelId = string

// X AI
// https://docs.x.ai/docs/api-reference
export type XAIModelId = string

// SambaNova
// https://docs.sambanova.ai/cloud/docs/get-started/supported-models
export type SambanovaModelId = string

// Cerebras
// https://inference-docs.cerebras.ai/api-reference/models
export type CerebrasModelId = string

// Groq
// https://console.groq.com/docs/models
// https://groq.com/pricing/
export type GroqModelId = string

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
export type SapAiCoreModelId = string

// Moonshot AI Studio
// https://platform.moonshot.ai/docs/pricing/chat
export type MoonshotModelId = string

// Huawei Cloud MaaS
// Dify.ai - No model selection needed, models are configured in Dify workflows

export type HuaweiCloudMaasModelId = string

// Baseten
// https://baseten.co/products/model-apis/
// Extended ModelInfo to include supportedFeatures, like tools
export interface BasetenModelInfo extends ModelInfo {
	supportedFeatures?: string[]
}

export type BasetenModelId = string

// Z AI
// https://docs.z.ai/guides/llm/glm-5.1
// https://docs.z.ai/guides/llm/glm-5
// https://docs.z.ai/guides/overview/pricing
export type internationalZAiModelId = string

export type mainlandZAiModelId = string

// Fireworks AI
export type FireworksModelId = string

// Qwen Code
// https://chat.qwen.ai/
export type QwenCodeModelId = string

// Minimax
// https://www.minimax.io/platform/document/text_api_intro
// https://www.minimax.io/platform/document/pricing
export type MinimaxModelId = string

// NousResearch
// https://inference-api.nousResearch.com
export type NousResearchModelId = string
