import { z } from "zod"

import { keysOf } from "./type-fu.js"
import { reasoningEffortsSchema, modelInfoSchema } from "./model.js"
import { codebaseIndexProviderSchema } from "./codebase-index.js"

/**
 * ProviderName
 */

export const providerNames = [
	"anthropic",
	"glama",
	"openrouter",
	"bedrock",
	"vertex",
	"openai",
	"ollama",
	"vscode-lm",
	"lmstudio",
	"gemini",
	"openai-native",
	"mistral",
	"deepseek",
	"unbound",
	"requesty",
	"human-relay",
	"fake-ai",
	"xai",
	"groq",
	"chutes",
	"litellm",
] as const

export const providerNamesSchema = z.enum(providerNames)

export type ProviderName = z.infer<typeof providerNamesSchema>

/**
 * ProviderSettingsEntry
 */

export const providerSettingsEntrySchema = z.object({
	id: z.string(),
	name: z.string(),
	apiProvider: providerNamesSchema.optional(),
})

export type ProviderSettingsEntry = z.infer<typeof providerSettingsEntrySchema>

/**
 * ProviderSettings
 */

const baseProviderSettingsSchema = z.object({
	includeMaxTokens: z.boolean().optional(),
	diffEnabled: z.boolean().optional(),
	fuzzyMatchThreshold: z.number().optional(),
	modelTemperature: z.number().nullish(),
	rateLimitSeconds: z.number().optional(),

	// Model reasoning.
	enableReasoningEffort: z.boolean().optional(),
	reasoningEffort: reasoningEffortsSchema.optional(),
	modelMaxTokens: z.number().optional(),
	modelMaxThinkingTokens: z.number().optional(),
})

// Several of the providers share common model config properties.
const apiModelIdProviderModelSchema = baseProviderSettingsSchema.extend({
	apiModelId: z.string().optional(),
})

const anthropicSchema = apiModelIdProviderModelSchema.extend({
	apiKey: z.string().optional(),
	anthropicBaseUrl: z.string().optional(),
	anthropicUseAuthToken: z.boolean().optional(),
})

const glamaSchema = baseProviderSettingsSchema.extend({
	glamaModelId: z.string().optional(),
	glamaApiKey: z.string().optional(),
})

const openRouterSchema = baseProviderSettingsSchema.extend({
	openRouterApiKey: z.string().optional(),
	openRouterModelId: z.string().optional(),
	openRouterBaseUrl: z.string().optional(),
	openRouterSpecificProvider: z.string().optional(),
	openRouterUseMiddleOutTransform: z.boolean().optional(),
})

const bedrockSchema = apiModelIdProviderModelSchema.extend({
	awsAccessKey: z.string().optional(),
	awsSecretKey: z.string().optional(),
	awsSessionToken: z.string().optional(),
	awsRegion: z.string().optional(),
	awsUseCrossRegionInference: z.boolean().optional(),
	awsUsePromptCache: z.boolean().optional(),
	awsProfile: z.string().optional(),
	awsUseProfile: z.boolean().optional(),
	awsCustomArn: z.string().optional(),
})

const vertexSchema = apiModelIdProviderModelSchema.extend({
	vertexKeyFile: z.string().optional(),
	vertexJsonCredentials: z.string().optional(),
	vertexProjectId: z.string().optional(),
	vertexRegion: z.string().optional(),
})

const openAiSchema = baseProviderSettingsSchema.extend({
	openAiBaseUrl: z.string().optional(),
	openAiApiKey: z.string().optional(),
	openAiLegacyFormat: z.boolean().optional(),
	openAiR1FormatEnabled: z.boolean().optional(),
	openAiModelId: z.string().optional(),
	openAiCustomModelInfo: modelInfoSchema.nullish(),
	openAiUseAzure: z.boolean().optional(),
	azureApiVersion: z.string().optional(),
	openAiStreamingEnabled: z.boolean().optional(),
	openAiHostHeader: z.string().optional(), // Keep temporarily for backward compatibility during migration.
	openAiHeaders: z.record(z.string(), z.string()).optional(),
})

const ollamaSchema = baseProviderSettingsSchema.extend({
	ollamaModelId: z.string().optional(),
	ollamaBaseUrl: z.string().optional(),
})

const vsCodeLmSchema = baseProviderSettingsSchema.extend({
	vsCodeLmModelSelector: z
		.object({
			vendor: z.string().optional(),
			family: z.string().optional(),
			version: z.string().optional(),
			id: z.string().optional(),
		})
		.optional(),
})

const lmStudioSchema = baseProviderSettingsSchema.extend({
	lmStudioModelId: z.string().optional(),
	lmStudioBaseUrl: z.string().optional(),
	lmStudioDraftModelId: z.string().optional(),
	lmStudioSpeculativeDecodingEnabled: z.boolean().optional(),
})

const geminiSchema = apiModelIdProviderModelSchema.extend({
	geminiApiKey: z.string().optional(),
	googleGeminiBaseUrl: z.string().optional(),
})

const openAiNativeSchema = apiModelIdProviderModelSchema.extend({
	openAiNativeApiKey: z.string().optional(),
	openAiNativeBaseUrl: z.string().optional(),
})

const mistralSchema = apiModelIdProviderModelSchema.extend({
	mistralApiKey: z.string().optional(),
	mistralCodestralUrl: z.string().optional(),
})

const deepSeekSchema = apiModelIdProviderModelSchema.extend({
	deepSeekBaseUrl: z.string().optional(),
	deepSeekApiKey: z.string().optional(),
})

const unboundSchema = baseProviderSettingsSchema.extend({
	unboundApiKey: z.string().optional(),
	unboundModelId: z.string().optional(),
})

const requestySchema = baseProviderSettingsSchema.extend({
	requestyApiKey: z.string().optional(),
	requestyModelId: z.string().optional(),
})

const humanRelaySchema = baseProviderSettingsSchema

const fakeAiSchema = baseProviderSettingsSchema.extend({
	fakeAi: z.unknown().optional(),
})

const xaiSchema = apiModelIdProviderModelSchema.extend({
	xaiApiKey: z.string().optional(),
})

const groqSchema = apiModelIdProviderModelSchema.extend({
	groqApiKey: z.string().optional(),
})

const chutesSchema = apiModelIdProviderModelSchema.extend({
	chutesApiKey: z.string().optional(),
})

const litellmSchema = baseProviderSettingsSchema.extend({
	litellmBaseUrl: z.string().optional(),
	litellmApiKey: z.string().optional(),
	litellmModelId: z.string().optional(),
})

const defaultSchema = z.object({
	apiProvider: z.undefined(),
})

export const providerSettingsSchemaDiscriminated = z.discriminatedUnion("apiProvider", [
	anthropicSchema.merge(z.object({ apiProvider: z.literal("anthropic") })),
	glamaSchema.merge(z.object({ apiProvider: z.literal("glama") })),
	openRouterSchema.merge(z.object({ apiProvider: z.literal("openrouter") })),
	bedrockSchema.merge(z.object({ apiProvider: z.literal("bedrock") })),
	vertexSchema.merge(z.object({ apiProvider: z.literal("vertex") })),
	openAiSchema.merge(z.object({ apiProvider: z.literal("openai") })),
	ollamaSchema.merge(z.object({ apiProvider: z.literal("ollama") })),
	vsCodeLmSchema.merge(z.object({ apiProvider: z.literal("vscode-lm") })),
	lmStudioSchema.merge(z.object({ apiProvider: z.literal("lmstudio") })),
	geminiSchema.merge(z.object({ apiProvider: z.literal("gemini") })),
	openAiNativeSchema.merge(z.object({ apiProvider: z.literal("openai-native") })),
	mistralSchema.merge(z.object({ apiProvider: z.literal("mistral") })),
	deepSeekSchema.merge(z.object({ apiProvider: z.literal("deepseek") })),
	unboundSchema.merge(z.object({ apiProvider: z.literal("unbound") })),
	requestySchema.merge(z.object({ apiProvider: z.literal("requesty") })),
	humanRelaySchema.merge(z.object({ apiProvider: z.literal("human-relay") })),
	fakeAiSchema.merge(z.object({ apiProvider: z.literal("fake-ai") })),
	xaiSchema.merge(z.object({ apiProvider: z.literal("xai") })),
	groqSchema.merge(z.object({ apiProvider: z.literal("groq") })),
	chutesSchema.merge(z.object({ apiProvider: z.literal("chutes") })),
	litellmSchema.merge(z.object({ apiProvider: z.literal("litellm") })),
	defaultSchema,
])

export const providerSettingsSchema = z.object({
	apiProvider: providerNamesSchema.optional(),
	...anthropicSchema.shape,
	...glamaSchema.shape,
	...openRouterSchema.shape,
	...bedrockSchema.shape,
	...vertexSchema.shape,
	...openAiSchema.shape,
	...ollamaSchema.shape,
	...vsCodeLmSchema.shape,
	...lmStudioSchema.shape,
	...geminiSchema.shape,
	...openAiNativeSchema.shape,
	...mistralSchema.shape,
	...deepSeekSchema.shape,
	...unboundSchema.shape,
	...requestySchema.shape,
	...humanRelaySchema.shape,
	...fakeAiSchema.shape,
	...xaiSchema.shape,
	...groqSchema.shape,
	...chutesSchema.shape,
	...litellmSchema.shape,
	...codebaseIndexProviderSchema.shape,
})

export type ProviderSettings = z.infer<typeof providerSettingsSchema>

export const PROVIDER_SETTINGS_KEYS = keysOf<ProviderSettings>()([
	"apiProvider",
	// Anthropic
	"apiModelId",
	"apiKey",
	"anthropicBaseUrl",
	"anthropicUseAuthToken",
	// Glama
	"glamaModelId",
	"glamaApiKey",
	// OpenRouter
	"openRouterApiKey",
	"openRouterModelId",
	"openRouterBaseUrl",
	"openRouterSpecificProvider",
	"openRouterUseMiddleOutTransform",
	// Amazon Bedrock
	"awsAccessKey",
	"awsSecretKey",
	"awsSessionToken",
	"awsRegion",
	"awsUseCrossRegionInference",
	"awsUsePromptCache",
	"awsProfile",
	"awsUseProfile",
	"awsCustomArn",
	// Google Vertex
	"vertexKeyFile",
	"vertexJsonCredentials",
	"vertexProjectId",
	"vertexRegion",
	// OpenAI
	"openAiBaseUrl",
	"openAiApiKey",
	"openAiLegacyFormat",
	"openAiR1FormatEnabled",
	"openAiModelId",
	"openAiCustomModelInfo",
	"openAiUseAzure",
	"azureApiVersion",
	"openAiStreamingEnabled",
	"openAiHostHeader", // Keep temporarily for backward compatibility during migration.
	"openAiHeaders",
	// Ollama
	"ollamaModelId",
	"ollamaBaseUrl",
	// VS Code LM
	"vsCodeLmModelSelector",
	"lmStudioModelId",
	"lmStudioBaseUrl",
	"lmStudioDraftModelId",
	"lmStudioSpeculativeDecodingEnabled",
	// Gemini
	"geminiApiKey",
	"googleGeminiBaseUrl",
	// OpenAI Native
	"openAiNativeApiKey",
	"openAiNativeBaseUrl",
	// Mistral
	"mistralApiKey",
	"mistralCodestralUrl",
	// DeepSeek
	"deepSeekBaseUrl",
	"deepSeekApiKey",
	// Unbound
	"unboundApiKey",
	"unboundModelId",
	// Requesty
	"requestyApiKey",
	"requestyModelId",
	// Code Index
	"codeIndexOpenAiKey",
	"codeIndexQdrantApiKey",
	// Reasoning
	"enableReasoningEffort",
	"reasoningEffort",
	"modelMaxTokens",
	"modelMaxThinkingTokens",
	// Generic
	"includeMaxTokens",
	"diffEnabled",
	"fuzzyMatchThreshold",
	"modelTemperature",
	"rateLimitSeconds",
	// Fake AI
	"fakeAi",
	// X.AI (Grok)
	"xaiApiKey",
	// Groq
	"groqApiKey",
	// Chutes AI
	"chutesApiKey",
	// LiteLLM
	"litellmBaseUrl",
	"litellmApiKey",
	"litellmModelId",
])
