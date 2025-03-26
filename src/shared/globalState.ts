import { z } from "zod"

import type {
	ProviderName,
	CheckpointStorage,
	ToolGroup,
	Language,
	TelemetrySetting,
	ProviderSettingsKey,
	SecretStateKey,
	GlobalStateKey,
	ModelInfo,
	ApiConfigMeta,
	HistoryItem,
	GroupEntry,
	ModeConfig,
	ExperimentId,
	ProviderSettings,
	GlobalSettings,
} from "../exports/roo-code"

import { Keys, AssertEqual, Equals } from "../utils/type-fu"

/**
 * ProviderName
 */

const providerNames: Record<ProviderName, true> = {
	anthropic: true,
	glama: true,
	openrouter: true,
	bedrock: true,
	vertex: true,
	openai: true,
	ollama: true,
	lmstudio: true,
	gemini: true,
	"openai-native": true,
	deepseek: true,
	"vscode-lm": true,
	mistral: true,
	unbound: true,
	requesty: true,
	"human-relay": true,
	"fake-ai": true,
}

const PROVIDER_NAMES = Object.keys(providerNames) as ProviderName[]

const providerNamesEnum: [ProviderName, ...ProviderName[]] = [
	PROVIDER_NAMES[0],
	...PROVIDER_NAMES.slice(1).map((p) => p),
]

/**
 * CheckpointStorage
 */

const checkpointStorages: Record<CheckpointStorage, true> = {
	task: true,
	workspace: true,
}

const CHECKPOINT_STORAGES = Object.keys(checkpointStorages) as CheckpointStorage[]

const checkpointStoragesEnum: [CheckpointStorage, ...CheckpointStorage[]] = [
	CHECKPOINT_STORAGES[0],
	...CHECKPOINT_STORAGES.slice(1).map((p) => p),
]

/**
 * ToolGroup
 */

const toolGroups: Record<ToolGroup, true> = {
	read: true,
	edit: true,
	browser: true,
	command: true,
	mcp: true,
	modes: true,
}

const TOOL_GROUPS = Object.keys(toolGroups) as ToolGroup[]

const toolGroupsEnum: [ToolGroup, ...ToolGroup[]] = [TOOL_GROUPS[0], ...TOOL_GROUPS.slice(1).map((p) => p)]

/**
 * Language
 */

const languages: Record<Language, true> = {
	ca: true,
	de: true,
	en: true,
	es: true,
	fr: true,
	hi: true,
	it: true,
	ja: true,
	ko: true,
	pl: true,
	"pt-BR": true,
	tr: true,
	vi: true,
	"zh-CN": true,
	"zh-TW": true,
}

const LANGUAGES = Object.keys(languages) as Language[]

const languagesEnum: [Language, ...Language[]] = [LANGUAGES[0], ...LANGUAGES.slice(1).map((p) => p)]

export const isLanguage = (key: string): key is Language => LANGUAGES.includes(key as Language)

/**
 * TelemetrySetting
 */

const telemetrySettings: Record<TelemetrySetting, true> = {
	unset: true,
	enabled: true,
	disabled: true,
}

const TELEMETRY_SETTINGS = Object.keys(telemetrySettings) as TelemetrySetting[]

const telemetrySettingsEnum: [TelemetrySetting, ...TelemetrySetting[]] = [
	TELEMETRY_SETTINGS[0],
	...TELEMETRY_SETTINGS.slice(1).map((p) => p),
]

/**
 * ProviderSettingsKey
 */

const providerSettingsKeys: Record<ProviderSettingsKey, true> = {
	apiProvider: true,
	apiModelId: true,
	// Anthropic
	apiKey: true,
	anthropicBaseUrl: true,
	// Glama
	glamaApiKey: true,
	glamaModelId: true,
	glamaModelInfo: true,
	// OpenRouter
	openRouterApiKey: true,
	openRouterModelId: true,
	openRouterModelInfo: true,
	openRouterBaseUrl: true,
	openRouterSpecificProvider: true,
	openRouterUseMiddleOutTransform: true,
	// AWS Bedrock
	awsAccessKey: true,
	awsSecretKey: true,
	awsSessionToken: true,
	awsRegion: true,
	awsUseCrossRegionInference: true,
	awsUsePromptCache: true,
	awspromptCacheId: true,
	awsProfile: true,
	awsUseProfile: true,
	awsCustomArn: true,
	// Google Vertex
	vertexKeyFile: true,
	vertexJsonCredentials: true,
	vertexProjectId: true,
	vertexRegion: true,
	// OpenAI
	openAiApiKey: true,
	openAiBaseUrl: true,
	openAiR1FormatEnabled: true,
	openAiModelId: true,
	openAiCustomModelInfo: true,
	openAiUseAzure: true,
	azureApiVersion: true,
	openAiStreamingEnabled: true,
	// Ollama
	ollamaModelId: true,
	ollamaBaseUrl: true,
	// VS Code LM
	vsCodeLmModelSelector: true,
	// LM Studio
	lmStudioModelId: true,
	lmStudioBaseUrl: true,
	lmStudioDraftModelId: true,
	lmStudioSpeculativeDecodingEnabled: true,
	// Gemini
	geminiApiKey: true,
	googleGeminiBaseUrl: true,
	// OpenAI Native
	openAiNativeApiKey: true,
	// Mistral
	mistralApiKey: true,
	mistralCodestralUrl: true,
	// DeepSeek
	deepSeekApiKey: true,
	deepSeekBaseUrl: true,
	includeMaxTokens: true,
	// Unbound
	unboundApiKey: true,
	unboundModelId: true,
	unboundModelInfo: true,
	// Requesty
	requestyApiKey: true,
	requestyModelId: true,
	requestyModelInfo: true,
	// Claude 3.7 Sonnet Thinking
	modelTemperature: true,
	modelMaxTokens: true,
	modelMaxThinkingTokens: true,
	// Fake AI
	fakeAi: true,
}

export const PROVIDER_SETTINGS_KEYS = Object.keys(providerSettingsKeys) as ProviderSettingsKey[]

/**
 * SecretStateKey
 */

const secretStateKeys: Record<SecretStateKey, true> = {
	apiKey: true,
	glamaApiKey: true,
	openRouterApiKey: true,
	awsAccessKey: true,
	awsSecretKey: true,
	awsSessionToken: true,
	openAiApiKey: true,
	geminiApiKey: true,
	openAiNativeApiKey: true,
	deepSeekApiKey: true,
	mistralApiKey: true,
	unboundApiKey: true,
	requestyApiKey: true,
}

export const SECRET_STATE_KEYS = Object.keys(secretStateKeys) as SecretStateKey[]

export const isSecretStateKey = (key: string): key is SecretStateKey =>
	SECRET_STATE_KEYS.includes(key as SecretStateKey)

/**
 * GlobalStateKey
 */

const globalStateKeys: Record<GlobalStateKey, true> = {
	apiProvider: true,
	apiModelId: true,
	// Anthropic
	// apiKey: true,
	anthropicBaseUrl: true,
	// Glama
	// glamaApiKey: true,
	glamaModelId: true,
	glamaModelInfo: true,
	// OpenRouter
	// openRouterApiKey: true,
	openRouterModelId: true,
	openRouterModelInfo: true,
	openRouterBaseUrl: true,
	openRouterSpecificProvider: true,
	openRouterUseMiddleOutTransform: true,
	// AWS Bedrock
	// awsAccessKey: true,
	// awsSecretKey: true,
	// awsSessionToken: true,
	awsRegion: true,
	awsUseCrossRegionInference: true,
	awsUsePromptCache: true,
	awspromptCacheId: true,
	awsProfile: true,
	awsUseProfile: true,
	awsCustomArn: true,
	// Google Vertex
	vertexKeyFile: true,
	vertexJsonCredentials: true,
	vertexProjectId: true,
	vertexRegion: true,
	// OpenAI
	// openAiApiKey: true,
	openAiBaseUrl: true,
	openAiR1FormatEnabled: true,
	openAiModelId: true,
	openAiCustomModelInfo: true,
	openAiUseAzure: true,
	azureApiVersion: true,
	openAiStreamingEnabled: true,
	// Ollama
	ollamaModelId: true,
	ollamaBaseUrl: true,
	// VS Code LM
	vsCodeLmModelSelector: true,
	// LM Studio
	lmStudioModelId: true,
	lmStudioBaseUrl: true,
	lmStudioDraftModelId: true,
	lmStudioSpeculativeDecodingEnabled: true,
	// Gemini
	// geminiApiKey: true,
	googleGeminiBaseUrl: true,
	// OpenAI Native
	// openAiNativeApiKey: true,
	// Mistral
	// mistralApiKey: true,
	mistralCodestralUrl: true,
	// DeepSeek
	// deepSeekApiKey: true,
	deepSeekBaseUrl: true,
	includeMaxTokens: true,
	// Unbound
	// unboundApiKey: true,
	unboundModelId: true,
	unboundModelInfo: true,
	// Requesty
	// requestyApiKey: true,
	requestyModelId: true,
	requestyModelInfo: true,
	// Claude 3.7 Sonnet Thinking
	modelTemperature: true,
	modelMaxTokens: true,
	modelMaxThinkingTokens: true,
	// Fake AI
	fakeAi: true,

	currentApiConfigName: true,
	listApiConfigMeta: true,
	pinnedApiConfigs: true,

	lastShownAnnouncementId: true,
	customInstructions: true,
	taskHistory: true,

	autoApprovalEnabled: true,
	alwaysAllowReadOnly: true,
	alwaysAllowReadOnlyOutsideWorkspace: true,
	alwaysAllowWrite: true,
	alwaysAllowWriteOutsideWorkspace: true,
	writeDelayMs: true,
	alwaysAllowBrowser: true,
	alwaysApproveResubmit: true,
	requestDelaySeconds: true,
	alwaysAllowMcp: true,
	alwaysAllowModeSwitch: true,
	alwaysAllowSubtasks: true,
	alwaysAllowExecute: true,
	allowedCommands: true,

	browserToolEnabled: true,
	browserViewportSize: true,
	screenshotQuality: true,
	remoteBrowserEnabled: true,
	remoteBrowserHost: true,

	enableCheckpoints: true,
	checkpointStorage: true,

	ttsEnabled: true,
	ttsSpeed: true,
	soundEnabled: true,
	soundVolume: true,

	maxOpenTabsContext: true,
	maxWorkspaceFiles: true,
	showRooIgnoredFiles: true,
	maxReadFileLine: true,

	terminalOutputLineLimit: true,
	terminalShellIntegrationTimeout: true,

	rateLimitSeconds: true,
	diffEnabled: true,
	fuzzyMatchThreshold: true,
	experiments: true,

	language: true,

	telemetrySetting: true,

	mcpEnabled: true,
	enableMcpServerCreation: true,

	mode: true,
	modeApiConfigs: true,
	customModes: true,
	customModePrompts: true,
	customSupportPrompts: true,
	enhancementApiConfigId: true,
}

export const GLOBAL_STATE_KEYS = Object.keys(globalStateKeys) as GlobalStateKey[]

/**
 * PassThroughStateKey
 *
 * TODO: Why is this necessary?
 */

const PASS_THROUGH_STATE_KEYS = ["taskHistory"] as const

type PassThroughStateKey = (typeof PASS_THROUGH_STATE_KEYS)[number]

export const isPassThroughStateKey = (key: string): key is PassThroughStateKey =>
	PASS_THROUGH_STATE_KEYS.includes(key as PassThroughStateKey)

/**
 * Schemas
 */

/**
 * ModelInfo
 */

const modelInfoSchema = z.object({
	maxTokens: z.number().optional(),
	contextWindow: z.number(),
	supportsImages: z.boolean().optional(),
	supportsComputerUse: z.boolean().optional(),
	supportsPromptCache: z.boolean(),
	inputPrice: z.number().optional(),
	outputPrice: z.number().optional(),
	cacheWritesPrice: z.number().optional(),
	cacheReadsPrice: z.number().optional(),
	description: z.string().optional(),
	reasoningEffort: z.enum(["low", "medium", "high"]).optional(),
	thinking: z.boolean().optional(),
})

// Throws a type error if the inferred type of the modelInfoSchema is not equal
// to ModelInfo.
type _AssertModelInfo = AssertEqual<Equals<ModelInfo, z.infer<typeof modelInfoSchema>>>

/**
 * ApiConfigMeta
 */

const apiConfigMetaSchema = z.object({
	id: z.string(),
	name: z.string(),
	apiProvider: z.enum(providerNamesEnum).optional(),
})

type _AssertApiConfigMeta = AssertEqual<Equals<ApiConfigMeta, z.infer<typeof apiConfigMetaSchema>>>

/**
 * HistoryItem
 */

const historyItemSchema = z.object({
	id: z.string(),
	number: z.number(),
	ts: z.number(),
	task: z.string(),
	tokensIn: z.number(),
	tokensOut: z.number(),
	cacheWrites: z.number().optional(),
	cacheReads: z.number().optional(),
	totalCost: z.number(),
	size: z.number().optional(),
})

type _AssertHistoryItem = AssertEqual<Equals<HistoryItem, z.infer<typeof historyItemSchema>>>

/**
 * GroupEntry
 */

const groupEntrySchema = z.union([
	z.enum(toolGroupsEnum),
	z
		.tuple([
			z.enum(toolGroupsEnum),
			z.object({
				fileRegex: z.string().optional(),
				description: z.string().optional(),
			}),
		])
		.readonly(),
])

type _AssertGroupEntry = AssertEqual<Equals<GroupEntry, z.infer<typeof groupEntrySchema>>>

/**
 * ModeConfig
 */

const modeConfigSchema = z.object({
	slug: z.string(),
	name: z.string(),
	roleDefinition: z.string(),
	customInstructions: z.string().optional(),
	groups: z.array(groupEntrySchema).readonly(),
	source: z.enum(["global", "project"]).optional(),
})

type _AssertModeConfig = AssertEqual<Equals<ModeConfig, z.infer<typeof modeConfigSchema>>>

/**
 * ExperimentId
 */

const experimentsSchema = z.object({
	experimentalDiffStrategy: z.boolean(),
	search_and_replace: z.boolean(),
	insert_content: z.boolean(),
	powerSteering: z.boolean(),
	multi_search_and_replace: z.boolean(),
})

// Throws a type error if the inferred type of the experimentsSchema is not
// equal to  ExperimentId.
type _AssertExperiments = AssertEqual<Equals<ExperimentId, Keys<z.infer<typeof experimentsSchema>>>>

/**
 * GlobalSettings
 */

export const globalSettingsSchema = z.object({
	currentApiConfigName: z.string().optional(),
	listApiConfigMeta: z.array(apiConfigMetaSchema).optional(),
	pinnedApiConfigs: z.record(z.string(), z.boolean()).optional(),

	lastShownAnnouncementId: z.string().optional(),
	customInstructions: z.string().optional(),
	taskHistory: z.array(historyItemSchema).optional(),

	autoApprovalEnabled: z.boolean().optional(),
	alwaysAllowReadOnly: z.boolean().optional(),
	alwaysAllowReadOnlyOutsideWorkspace: z.boolean().optional(),
	alwaysAllowWrite: z.boolean().optional(),
	alwaysAllowWriteOutsideWorkspace: z.boolean().optional(),
	writeDelayMs: z.number().optional(),
	alwaysAllowBrowser: z.boolean().optional(),
	alwaysApproveResubmit: z.boolean().optional(),
	requestDelaySeconds: z.number().optional(),
	alwaysAllowMcp: z.boolean().optional(),
	alwaysAllowModeSwitch: z.boolean().optional(),
	alwaysAllowSubtasks: z.boolean().optional(),
	alwaysAllowExecute: z.boolean().optional(),
	allowedCommands: z.array(z.string()).optional(),

	browserToolEnabled: z.boolean().optional(),
	browserViewportSize: z.string().optional(),
	screenshotQuality: z.number().optional(),
	remoteBrowserEnabled: z.boolean().optional(),
	remoteBrowserHost: z.string().optional(),

	enableCheckpoints: z.boolean().optional(),
	checkpointStorage: z.enum(checkpointStoragesEnum).optional(),

	ttsEnabled: z.boolean().optional(),
	ttsSpeed: z.number().optional(),
	soundEnabled: z.boolean().optional(),
	soundVolume: z.number().optional(),

	maxOpenTabsContext: z.number().optional(),
	maxWorkspaceFiles: z.number().optional(),
	showRooIgnoredFiles: z.boolean().optional(),
	maxReadFileLine: z.number().optional(),

	terminalOutputLineLimit: z.number().optional(),
	terminalShellIntegrationTimeout: z.number().optional(),

	rateLimitSeconds: z.number().optional(),
	diffEnabled: z.boolean().optional(),
	fuzzyMatchThreshold: z.number().optional(),
	experiments: experimentsSchema.optional(),

	language: z.enum(languagesEnum).optional(),

	telemetrySetting: z.enum(telemetrySettingsEnum).optional(),

	mcpEnabled: z.boolean().optional(),
	enableMcpServerCreation: z.boolean().optional(),

	mode: z.string().optional(),
	modeApiConfigs: z.record(z.string(), z.string()).optional(),
	customModes: z.array(modeConfigSchema).optional(),
	customModePrompts: z
		.record(
			z.string(),
			z
				.object({
					roleDefinition: z.string().optional(),
					customInstructions: z.string().optional(),
				})
				.optional(),
		)
		.optional(),
	customSupportPrompts: z.record(z.string(), z.string().optional()).optional(),
	enhancementApiConfigId: z.string().optional(),
})

// Throws a type error if the inferred type of the globalSettingsSchema is not
// equal to GlobalSettings.
type _AssertGlobalSettings = AssertEqual<Equals<GlobalSettings, z.infer<typeof globalSettingsSchema>>>

/**
 * ProviderSettings
 */

export const providerSettingsSchema = z.object({
	apiProvider: z.enum(providerNamesEnum).optional(),
	// Anthropic
	apiModelId: z.string().optional(),
	apiKey: z.string().optional(),
	anthropicBaseUrl: z.string().optional(),
	// Glama
	glamaModelId: z.string().optional(),
	glamaModelInfo: modelInfoSchema.optional(),
	glamaApiKey: z.string().optional(),
	// OpenRouter
	openRouterApiKey: z.string().optional(),
	openRouterModelId: z.string().optional(),
	openRouterModelInfo: modelInfoSchema.optional(),
	openRouterBaseUrl: z.string().optional(),
	openRouterSpecificProvider: z.string().optional(),
	// AWS Bedrock
	awsAccessKey: z.string().optional(),
	awsSecretKey: z.string().optional(),
	awsSessionToken: z.string().optional(),
	awsRegion: z.string().optional(),
	awsUseCrossRegionInference: z.boolean().optional(),
	awsUsePromptCache: z.boolean().optional(),
	awspromptCacheId: z.string().optional(),
	awsProfile: z.string().optional(),
	awsUseProfile: z.boolean().optional(),
	awsCustomArn: z.string().optional(),
	// Google Vertex
	vertexKeyFile: z.string().optional(),
	vertexJsonCredentials: z.string().optional(),
	vertexProjectId: z.string().optional(),
	vertexRegion: z.string().optional(),
	// OpenAI
	openAiBaseUrl: z.string().optional(),
	openAiApiKey: z.string().optional(),
	openAiR1FormatEnabled: z.boolean().optional(),
	openAiModelId: z.string().optional(),
	openAiCustomModelInfo: modelInfoSchema.optional(),
	openAiUseAzure: z.boolean().optional(),
	// Ollama
	ollamaModelId: z.string().optional(),
	ollamaBaseUrl: z.string().optional(),
	// VS Code LM
	vsCodeLmModelSelector: z
		.object({
			vendor: z.string().optional(),
			family: z.string().optional(),
			version: z.string().optional(),
			id: z.string().optional(),
		})
		.optional(),
	// LM Studio
	lmStudioModelId: z.string().optional(),
	lmStudioBaseUrl: z.string().optional(),
	lmStudioDraftModelId: z.string().optional(),
	lmStudioSpeculativeDecodingEnabled: z.boolean().optional(),
	// Gemini
	geminiApiKey: z.string().optional(),
	googleGeminiBaseUrl: z.string().optional(),
	// OpenAI Native
	openAiNativeApiKey: z.string().optional(),
	// Mistral
	mistralApiKey: z.string().optional(),
	mistralCodestralUrl: z.string().optional(),
	// Azure
	azureApiVersion: z.string().optional(),
	// OpenRouter
	openRouterUseMiddleOutTransform: z.boolean().optional(),
	openAiStreamingEnabled: z.boolean().optional(),
	// DeepSeek
	deepSeekBaseUrl: z.string().optional(),
	deepSeekApiKey: z.string().optional(),
	// Unbound
	unboundApiKey: z.string().optional(),
	unboundModelId: z.string().optional(),
	unboundModelInfo: modelInfoSchema.optional(),
	// Requesty
	requestyApiKey: z.string().optional(),
	requestyModelId: z.string().optional(),
	requestyModelInfo: modelInfoSchema.optional(),
	// Claude 3.7 Sonnet Thinking
	modelTemperature: z.number().nullish(),
	modelMaxTokens: z.number().optional(),
	modelMaxThinkingTokens: z.number().optional(),
	// Generic
	includeMaxTokens: z.boolean().optional(),
	// Fake AI
	fakeAi: z.unknown().optional(),
})

// Throws a type error if the inferred type of the providerSettingsSchema is not
// equal to ProviderSettings.
type _AssertProviderSettings = AssertEqual<Equals<ProviderSettings, z.infer<typeof providerSettingsSchema>>>
