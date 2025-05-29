import { z } from "zod"

import { Equals, Keys, AssertEqual } from "./utils.js"

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
] as const

export const providerNamesSchema = z.enum(providerNames)

export type ProviderName = z.infer<typeof providerNamesSchema>

/**
 * ToolGroup
 */

export const toolGroups = ["read", "edit", "browser", "command", "mcp", "modes"] as const

export const toolGroupsSchema = z.enum(toolGroups)

export type ToolGroup = z.infer<typeof toolGroupsSchema>

/**
 * Language
 */

export const languages = [
	"ca",
	"de",
	"en",
	"es",
	"fr",
	"hi",
	"it",
	"ja",
	"ko",
	"nl",
	"pl",
	"pt-BR",
	"ru",
	"tr",
	"vi",
	"zh-CN",
	"zh-TW",
] as const

export const languagesSchema = z.enum(languages)

export type Language = z.infer<typeof languagesSchema>

export const isLanguage = (value: string): value is Language => languages.includes(value as Language)

/**
 * TelemetrySetting
 */

export const telemetrySettings = ["unset", "enabled", "disabled"] as const

export const telemetrySettingsSchema = z.enum(telemetrySettings)

export type TelemetrySetting = z.infer<typeof telemetrySettingsSchema>

/**
 * ReasoningEffort
 */

export const reasoningEfforts = ["low", "medium", "high"] as const

export const reasoningEffortsSchema = z.enum(reasoningEfforts)

export type ReasoningEffort = z.infer<typeof reasoningEffortsSchema>

/**
 * ModelInfo
 */

export const modelInfoSchema = z.object({
	maxTokens: z.number().nullish(),
	maxThinkingTokens: z.number().nullish(),
	contextWindow: z.number(),
	supportsImages: z.boolean().optional(),
	supportsComputerUse: z.boolean().optional(),
	supportsPromptCache: z.boolean(),
	inputPrice: z.number().optional(),
	outputPrice: z.number().optional(),
	cacheWritesPrice: z.number().optional(),
	cacheReadsPrice: z.number().optional(),
	description: z.string().optional(),
	reasoningEffort: reasoningEffortsSchema.optional(),
	thinking: z.boolean().optional(),
	minTokensPerCachePoint: z.number().optional(),
	maxCachePoints: z.number().optional(),
	cachableFields: z.array(z.string()).optional(),
	tiers: z
		.array(
			z.object({
				contextWindow: z.number(),
				inputPrice: z.number().optional(),
				outputPrice: z.number().optional(),
				cacheWritesPrice: z.number().optional(),
				cacheReadsPrice: z.number().optional(),
			}),
		)
		.optional(),
})

export type ModelInfo = z.infer<typeof modelInfoSchema>

/**
 * HistoryItem
 */

export const historyItemSchema = z.object({
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
	workspace: z.string().optional(),
})

export type HistoryItem = z.infer<typeof historyItemSchema>

/**
 * GroupOptions
 */

export const groupOptionsSchema = z.object({
	fileRegex: z
		.string()
		.optional()
		.refine(
			(pattern) => {
				if (!pattern) {
					return true // Optional, so empty is valid.
				}

				try {
					new RegExp(pattern)
					return true
				} catch {
					return false
				}
			},
			{ message: "Invalid regular expression pattern" },
		),
	description: z.string().optional(),
})

export type GroupOptions = z.infer<typeof groupOptionsSchema>

/**
 * GroupEntry
 */

export const groupEntrySchema = z.union([toolGroupsSchema, z.tuple([toolGroupsSchema, groupOptionsSchema])])

export type GroupEntry = z.infer<typeof groupEntrySchema>

/**
 * ModeConfig
 */

const groupEntryArraySchema = z.array(groupEntrySchema).refine(
	(groups) => {
		const seen = new Set()

		return groups.every((group) => {
			// For tuples, check the group name (first element).
			const groupName = Array.isArray(group) ? group[0] : group

			if (seen.has(groupName)) {
				return false
			}

			seen.add(groupName)
			return true
		})
	},
	{ message: "Duplicate groups are not allowed" },
)

export const modeConfigSchema = z.object({
	slug: z.string().regex(/^[a-zA-Z0-9-]+$/, "Slug must contain only letters numbers and dashes"),
	name: z.string().min(1, "Name is required"),
	roleDefinition: z.string().min(1, "Role definition is required"),
	customInstructions: z.string().optional(),
	groups: groupEntryArraySchema,
	source: z.enum(["global", "project"]).optional(),
})

export type ModeConfig = z.infer<typeof modeConfigSchema>

/**
 * CustomModesSettings
 */

export const customModesSettingsSchema = z.object({
	customModes: z.array(modeConfigSchema).refine(
		(modes) => {
			const slugs = new Set()

			return modes.every((mode) => {
				if (slugs.has(mode.slug)) {
					return false
				}

				slugs.add(mode.slug)
				return true
			})
		},
		{
			message: "Duplicate mode slugs are not allowed",
		},
	),
})

export type CustomModesSettings = z.infer<typeof customModesSettingsSchema>

/**
 * PromptComponent
 */

export const promptComponentSchema = z.object({
	roleDefinition: z.string().optional(),
	customInstructions: z.string().optional(),
})

export type PromptComponent = z.infer<typeof promptComponentSchema>

/**
 * CustomModePrompts
 */

export const customModePromptsSchema = z.record(z.string(), promptComponentSchema.optional())

export type CustomModePrompts = z.infer<typeof customModePromptsSchema>

/**
 * CustomSupportPrompts
 */

export const customSupportPromptsSchema = z.record(z.string(), z.string().optional())

export type CustomSupportPrompts = z.infer<typeof customSupportPromptsSchema>

/**
 * CommandExecutionStatus
 */

export const commandExecutionStatusSchema = z.discriminatedUnion("status", [
	z.object({
		executionId: z.string(),
		status: z.literal("running"),
		pid: z.number().optional(),
	}),
	z.object({
		executionId: z.string(),
		status: z.literal("exited"),
		exitCode: z.number().optional(),
	}),
	z.object({
		executionId: z.string(),
		status: z.literal("fallback"),
	}),
])

export type CommandExecutionStatus = z.infer<typeof commandExecutionStatusSchema>

/**
 * ExperimentId
 */

export const experimentIds = ["powerSteering"] as const

export const experimentIdsSchema = z.enum(experimentIds)

export type ExperimentId = z.infer<typeof experimentIdsSchema>

/**
 * Experiments
 */

const experimentsSchema = z.object({
	powerSteering: z.boolean(),
})

export type Experiments = z.infer<typeof experimentsSchema>

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AssertExperiments = AssertEqual<Equals<ExperimentId, Keys<Experiments>>>

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

const genericProviderSettingsSchema = z.object({
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

const anthropicSchema = z.object({
	apiModelId: z.string().optional(),
	apiKey: z.string().optional(),
	anthropicBaseUrl: z.string().optional(),
	anthropicUseAuthToken: z.boolean().optional(),
})

const glamaSchema = z.object({
	glamaModelId: z.string().optional(),
	glamaApiKey: z.string().optional(),
})

const openRouterSchema = z.object({
	openRouterApiKey: z.string().optional(),
	openRouterModelId: z.string().optional(),
	openRouterBaseUrl: z.string().optional(),
	openRouterSpecificProvider: z.string().optional(),
	openRouterUseMiddleOutTransform: z.boolean().optional(),
})

const bedrockSchema = z.object({
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

const vertexSchema = z.object({
	vertexKeyFile: z.string().optional(),
	vertexJsonCredentials: z.string().optional(),
	vertexProjectId: z.string().optional(),
	vertexRegion: z.string().optional(),
})

const openAiSchema = z.object({
	openAiBaseUrl: z.string().optional(),
	openAiApiKey: z.string().optional(),
	openAiLegacyFormat: z.boolean().optional(),
	openAiR1FormatEnabled: z.boolean().optional(),
	openAiModelId: z.string().optional(),
	openAiCustomModelInfo: modelInfoSchema.nullish(),
	openAiUseAzure: z.boolean().optional(),
	azureApiVersion: z.string().optional(),
	openAiStreamingEnabled: z.boolean().optional(),
	enableReasoningEffort: z.boolean().optional(),
	openAiHostHeader: z.string().optional(), // Keep temporarily for backward compatibility during migration.
	openAiHeaders: z.record(z.string(), z.string()).optional(),
})

const ollamaSchema = z.object({
	ollamaModelId: z.string().optional(),
	ollamaBaseUrl: z.string().optional(),
})

const vsCodeLmSchema = z.object({
	vsCodeLmModelSelector: z
		.object({
			vendor: z.string().optional(),
			family: z.string().optional(),
			version: z.string().optional(),
			id: z.string().optional(),
		})
		.optional(),
})

const lmStudioSchema = z.object({
	lmStudioModelId: z.string().optional(),
	lmStudioBaseUrl: z.string().optional(),
	lmStudioDraftModelId: z.string().optional(),
	lmStudioSpeculativeDecodingEnabled: z.boolean().optional(),
})

const geminiSchema = z.object({
	geminiApiKey: z.string().optional(),
	googleGeminiBaseUrl: z.string().optional(),
})

const openAiNativeSchema = z.object({
	openAiNativeApiKey: z.string().optional(),
	openAiNativeBaseUrl: z.string().optional(),
})

const mistralSchema = z.object({
	mistralApiKey: z.string().optional(),
	mistralCodestralUrl: z.string().optional(),
})

const deepSeekSchema = z.object({
	deepSeekBaseUrl: z.string().optional(),
	deepSeekApiKey: z.string().optional(),
})

const unboundSchema = z.object({
	unboundApiKey: z.string().optional(),
	unboundModelId: z.string().optional(),
})

const requestySchema = z.object({
	requestyApiKey: z.string().optional(),
	requestyModelId: z.string().optional(),
})

const humanRelaySchema = z.object({})

const fakeAiSchema = z.object({
	fakeAi: z.unknown().optional(),
})

const xaiSchema = z.object({
	xaiApiKey: z.string().optional(),
})

const groqSchema = z.object({
	groqApiKey: z.string().optional(),
})

const chutesSchema = z.object({
	chutesApiKey: z.string().optional(),
})

const litellmSchema = z.object({
	litellmBaseUrl: z.string().optional(),
	litellmApiKey: z.string().optional(),
	litellmModelId: z.string().optional(),
})

const defaultSchema = z.object({
	apiProvider: z.undefined(),
})

export const providerSettingsSchemaDiscriminated = z
	.discriminatedUnion("apiProvider", [
		anthropicSchema.merge(
			z.object({
				apiProvider: z.literal("anthropic"),
			}),
		),
		glamaSchema.merge(
			z.object({
				apiProvider: z.literal("glama"),
			}),
		),
		openRouterSchema.merge(
			z.object({
				apiProvider: z.literal("openrouter"),
			}),
		),
		bedrockSchema.merge(
			z.object({
				apiProvider: z.literal("bedrock"),
			}),
		),
		vertexSchema.merge(
			z.object({
				apiProvider: z.literal("vertex"),
			}),
		),
		openAiSchema.merge(
			z.object({
				apiProvider: z.literal("openai"),
			}),
		),
		ollamaSchema.merge(
			z.object({
				apiProvider: z.literal("ollama"),
			}),
		),
		vsCodeLmSchema.merge(
			z.object({
				apiProvider: z.literal("vscode-lm"),
			}),
		),
		lmStudioSchema.merge(
			z.object({
				apiProvider: z.literal("lmstudio"),
			}),
		),
		geminiSchema.merge(
			z.object({
				apiProvider: z.literal("gemini"),
			}),
		),
		openAiNativeSchema.merge(
			z.object({
				apiProvider: z.literal("openai-native"),
			}),
		),
		mistralSchema.merge(
			z.object({
				apiProvider: z.literal("mistral"),
			}),
		),
		deepSeekSchema.merge(
			z.object({
				apiProvider: z.literal("deepseek"),
			}),
		),
		unboundSchema.merge(
			z.object({
				apiProvider: z.literal("unbound"),
			}),
		),
		requestySchema.merge(
			z.object({
				apiProvider: z.literal("requesty"),
			}),
		),
		humanRelaySchema.merge(
			z.object({
				apiProvider: z.literal("human-relay"),
			}),
		),
		fakeAiSchema.merge(
			z.object({
				apiProvider: z.literal("fake-ai"),
			}),
		),
		xaiSchema.merge(
			z.object({
				apiProvider: z.literal("xai"),
			}),
		),
		groqSchema.merge(
			z.object({
				apiProvider: z.literal("groq"),
			}),
		),
		chutesSchema.merge(
			z.object({
				apiProvider: z.literal("chutes"),
			}),
		),
		litellmSchema.merge(
			z.object({
				apiProvider: z.literal("litellm"),
			}),
		),
		defaultSchema,
	])
	.and(genericProviderSettingsSchema)

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
	...genericProviderSettingsSchema.shape,
})

export type ProviderSettings = z.infer<typeof providerSettingsSchema>

type ProviderSettingsRecord = Record<Keys<ProviderSettings>, undefined>

const providerSettingsRecord: ProviderSettingsRecord = {
	apiProvider: undefined,
	// Anthropic
	apiModelId: undefined,
	apiKey: undefined,
	anthropicBaseUrl: undefined,
	anthropicUseAuthToken: undefined,
	// Glama
	glamaModelId: undefined,
	glamaApiKey: undefined,
	// OpenRouter
	openRouterApiKey: undefined,
	openRouterModelId: undefined,
	openRouterBaseUrl: undefined,
	openRouterSpecificProvider: undefined,
	openRouterUseMiddleOutTransform: undefined,
	// Amazon Bedrock
	awsAccessKey: undefined,
	awsSecretKey: undefined,
	awsSessionToken: undefined,
	awsRegion: undefined,
	awsUseCrossRegionInference: undefined,
	awsUsePromptCache: undefined,
	awsProfile: undefined,
	awsUseProfile: undefined,
	awsCustomArn: undefined,
	// Google Vertex
	vertexKeyFile: undefined,
	vertexJsonCredentials: undefined,
	vertexProjectId: undefined,
	vertexRegion: undefined,
	// OpenAI
	openAiBaseUrl: undefined,
	openAiApiKey: undefined,
	openAiLegacyFormat: undefined,
	openAiR1FormatEnabled: undefined,
	openAiModelId: undefined,
	openAiCustomModelInfo: undefined,
	openAiUseAzure: undefined,
	azureApiVersion: undefined,
	openAiStreamingEnabled: undefined,
	enableReasoningEffort: undefined,
	openAiHostHeader: undefined, // Keep temporarily for backward compatibility during migration
	openAiHeaders: undefined,
	// Ollama
	ollamaModelId: undefined,
	ollamaBaseUrl: undefined,
	// VS Code LM
	vsCodeLmModelSelector: undefined,
	lmStudioModelId: undefined,
	lmStudioBaseUrl: undefined,
	lmStudioDraftModelId: undefined,
	lmStudioSpeculativeDecodingEnabled: undefined,
	// Gemini
	geminiApiKey: undefined,
	googleGeminiBaseUrl: undefined,
	// OpenAI Native
	openAiNativeApiKey: undefined,
	openAiNativeBaseUrl: undefined,
	// Mistral
	mistralApiKey: undefined,
	mistralCodestralUrl: undefined,
	// DeepSeek
	deepSeekBaseUrl: undefined,
	deepSeekApiKey: undefined,
	// Unbound
	unboundApiKey: undefined,
	unboundModelId: undefined,
	// Requesty
	requestyApiKey: undefined,
	requestyModelId: undefined,
	// Claude 3.7 Sonnet Thinking
	modelMaxTokens: undefined,
	modelMaxThinkingTokens: undefined,
	// Generic
	includeMaxTokens: undefined,
	reasoningEffort: undefined,
	diffEnabled: undefined,
	fuzzyMatchThreshold: undefined,
	modelTemperature: undefined,
	rateLimitSeconds: undefined,
	// Fake AI
	fakeAi: undefined,
	// X.AI (Grok)
	xaiApiKey: undefined,
	// Groq
	groqApiKey: undefined,
	// Chutes AI
	chutesApiKey: undefined,
	// LiteLLM
	litellmBaseUrl: undefined,
	litellmApiKey: undefined,
	litellmModelId: undefined,
}

export const PROVIDER_SETTINGS_KEYS = Object.keys(providerSettingsRecord) as Keys<ProviderSettings>[]

/**
 * GlobalSettings
 */

export const globalSettingsSchema = z.object({
	currentApiConfigName: z.string().optional(),
	listApiConfigMeta: z.array(providerSettingsEntrySchema).optional(),
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
	cachedChromeHostUrl: z.string().optional(),

	enableCheckpoints: z.boolean().optional(),

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
	terminalShellIntegrationDisabled: z.boolean().optional(),
	terminalCommandDelay: z.number().optional(),
	terminalPowershellCounter: z.boolean().optional(),
	terminalZshClearEolMark: z.boolean().optional(),
	terminalZshOhMy: z.boolean().optional(),
	terminalZshP10k: z.boolean().optional(),
	terminalZdotdir: z.boolean().optional(),
	terminalCompressProgressBar: z.boolean().optional(),

	rateLimitSeconds: z.number().optional(),
	diffEnabled: z.boolean().optional(),
	fuzzyMatchThreshold: z.number().optional(),
	experiments: experimentsSchema.optional(),

	language: languagesSchema.optional(),

	telemetrySetting: telemetrySettingsSchema.optional(),

	mcpEnabled: z.boolean().optional(),
	enableMcpServerCreation: z.boolean().optional(),

	mode: z.string().optional(),
	modeApiConfigs: z.record(z.string(), z.string()).optional(),
	customModes: z.array(modeConfigSchema).optional(),
	customModePrompts: customModePromptsSchema.optional(),
	customSupportPrompts: customSupportPromptsSchema.optional(),
	enhancementApiConfigId: z.string().optional(),
	historyPreviewCollapsed: z.boolean().optional(),
})

export type GlobalSettings = z.infer<typeof globalSettingsSchema>

type GlobalSettingsRecord = Record<Keys<GlobalSettings>, undefined>

const globalSettingsRecord: GlobalSettingsRecord = {
	currentApiConfigName: undefined,
	listApiConfigMeta: undefined,
	pinnedApiConfigs: undefined,

	lastShownAnnouncementId: undefined,
	customInstructions: undefined,
	taskHistory: undefined,

	autoApprovalEnabled: undefined,
	alwaysAllowReadOnly: undefined,
	alwaysAllowReadOnlyOutsideWorkspace: undefined,
	alwaysAllowWrite: undefined,
	alwaysAllowWriteOutsideWorkspace: undefined,
	writeDelayMs: undefined,
	alwaysAllowBrowser: undefined,
	alwaysApproveResubmit: undefined,
	requestDelaySeconds: undefined,
	alwaysAllowMcp: undefined,
	alwaysAllowModeSwitch: undefined,
	alwaysAllowSubtasks: undefined,
	alwaysAllowExecute: undefined,
	allowedCommands: undefined,

	browserToolEnabled: undefined,
	browserViewportSize: undefined,
	screenshotQuality: undefined,
	remoteBrowserEnabled: undefined,
	remoteBrowserHost: undefined,

	enableCheckpoints: undefined,

	ttsEnabled: undefined,
	ttsSpeed: undefined,
	soundEnabled: undefined,
	soundVolume: undefined,

	maxOpenTabsContext: undefined,
	maxWorkspaceFiles: undefined,
	showRooIgnoredFiles: undefined,
	maxReadFileLine: undefined,

	terminalOutputLineLimit: undefined,
	terminalShellIntegrationTimeout: undefined,
	terminalShellIntegrationDisabled: undefined,
	terminalCommandDelay: undefined,
	terminalPowershellCounter: undefined,
	terminalZshClearEolMark: undefined,
	terminalZshOhMy: undefined,
	terminalZshP10k: undefined,
	terminalZdotdir: undefined,
	terminalCompressProgressBar: undefined,

	rateLimitSeconds: undefined,
	diffEnabled: undefined,
	fuzzyMatchThreshold: undefined,
	experiments: undefined,

	language: undefined,

	telemetrySetting: undefined,

	mcpEnabled: undefined,
	enableMcpServerCreation: undefined,

	mode: undefined,
	modeApiConfigs: undefined,
	customModes: undefined,
	customModePrompts: undefined,
	customSupportPrompts: undefined,
	enhancementApiConfigId: undefined,
	cachedChromeHostUrl: undefined,
	historyPreviewCollapsed: undefined,
}

export const GLOBAL_SETTINGS_KEYS = Object.keys(globalSettingsRecord) as Keys<GlobalSettings>[]

/**
 * RooCodeSettings
 */

export const rooCodeSettingsSchema = providerSettingsSchema.merge(globalSettingsSchema)

export type RooCodeSettings = GlobalSettings & ProviderSettings

export const ROO_CODE_SETTINGS_KEYS = [...GLOBAL_SETTINGS_KEYS, ...PROVIDER_SETTINGS_KEYS] as Keys<RooCodeSettings>[]

/**
 * SecretState
 */

export type SecretState = Pick<
	ProviderSettings,
	| "apiKey"
	| "glamaApiKey"
	| "openRouterApiKey"
	| "awsAccessKey"
	| "awsSecretKey"
	| "awsSessionToken"
	| "openAiApiKey"
	| "geminiApiKey"
	| "openAiNativeApiKey"
	| "deepSeekApiKey"
	| "mistralApiKey"
	| "unboundApiKey"
	| "requestyApiKey"
	| "xaiApiKey"
>

type SecretStateRecord = Record<Keys<SecretState>, undefined>

const secretStateRecord: SecretStateRecord = {
	apiKey: undefined,
	glamaApiKey: undefined,
	openRouterApiKey: undefined,
	awsAccessKey: undefined,
	awsSecretKey: undefined,
	awsSessionToken: undefined,
	openAiApiKey: undefined,
	geminiApiKey: undefined,
	openAiNativeApiKey: undefined,
	deepSeekApiKey: undefined,
	mistralApiKey: undefined,
	unboundApiKey: undefined,
	requestyApiKey: undefined,
	xaiApiKey: undefined,
}

export const SECRET_STATE_KEYS = Object.keys(secretStateRecord) as Keys<SecretState>[]

export const isSecretStateKey = (key: string): key is Keys<SecretState> =>
	SECRET_STATE_KEYS.includes(key as Keys<SecretState>)

/**
 * GlobalState
 */

export type GlobalState = Omit<RooCodeSettings, Keys<SecretState>>

export const GLOBAL_STATE_KEYS = [...GLOBAL_SETTINGS_KEYS, ...PROVIDER_SETTINGS_KEYS].filter(
	(key: Keys<RooCodeSettings>) => !SECRET_STATE_KEYS.includes(key as Keys<SecretState>),
) as Keys<GlobalState>[]

export const isGlobalStateKey = (key: string): key is Keys<GlobalState> =>
	GLOBAL_STATE_KEYS.includes(key as Keys<GlobalState>)

/**
 * ClineAsk
 */

export const clineAsks = [
	"followup",
	"command",
	"command_output",
	"completion_result",
	"tool",
	"api_req_failed",
	"resume_task",
	"resume_completed_task",
	"mistake_limit_reached",
	"auto_approval_max_req_reached",
	"browser_action_launch",
	"use_mcp_server",
] as const

export const clineAskSchema = z.enum(clineAsks)

export type ClineAsk = z.infer<typeof clineAskSchema>

// ClineSay

export const clineSays = [
	"error",
	"api_req_started",
	"api_req_finished",
	"api_req_retried",
	"api_req_retry_delayed",
	"api_req_deleted",
	"text",
	"reasoning",
	"completion_result",
	"user_feedback",
	"user_feedback_diff",
	"command_output",
	"shell_integration_warning",
	"browser_action",
	"browser_action_result",
	"mcp_server_request_started",
	"mcp_server_response",
	"subtask_result",
	"checkpoint_saved",
	"rooignore_error",
	"diff_error",
	"condense_context",
] as const

export const clineSaySchema = z.enum(clineSays)

export type ClineSay = z.infer<typeof clineSaySchema>

/**
 * ToolProgressStatus
 */

export const toolProgressStatusSchema = z.object({
	id: z.string().optional(),
	icon: z.string().optional(),
	text: z.string().optional(),
})

export type ToolProgressStatus = z.infer<typeof toolProgressStatusSchema>

/**
 * ContextCondense
 */

export const contextCondenseSchema = z.object({
	cost: z.number(),
	prevContextTokens: z.number(),
	newContextTokens: z.number(),
})

export type ContextCondense = z.infer<typeof contextCondenseSchema>

/**
 * ClineMessage
 */

export const clineMessageSchema = z.object({
	ts: z.number(),
	type: z.union([z.literal("ask"), z.literal("say")]),
	ask: clineAskSchema.optional(),
	say: clineSaySchema.optional(),
	text: z.string().optional(),
	images: z.array(z.string()).optional(),
	partial: z.boolean().optional(),
	reasoning: z.string().optional(),
	conversationHistoryIndex: z.number().optional(),
	checkpoint: z.record(z.string(), z.unknown()).optional(),
	progressStatus: toolProgressStatusSchema.optional(),
	contextCondense: contextCondenseSchema.optional(),
})

export type ClineMessage = z.infer<typeof clineMessageSchema>

/**
 * TokenUsage
 */

export const tokenUsageSchema = z.object({
	totalTokensIn: z.number(),
	totalTokensOut: z.number(),
	totalCacheWrites: z.number().optional(),
	totalCacheReads: z.number().optional(),
	totalCost: z.number(),
	contextTokens: z.number(),
})

export type TokenUsage = z.infer<typeof tokenUsageSchema>

/**
 * ToolName
 */

export const toolNames = [
	"execute_command",
	"read_file",
	"write_to_file",
	"apply_diff",
	"insert_content",
	"search_and_replace",
	"search_files",
	"list_files",
	"list_code_definition_names",
	"browser_action",
	"use_mcp_tool",
	"access_mcp_resource",
	"ask_followup_question",
	"attempt_completion",
	"switch_mode",
	"new_task",
	"fetch_instructions",
] as const

export const toolNamesSchema = z.enum(toolNames)

export type ToolName = z.infer<typeof toolNamesSchema>

/**
 * ToolUsage
 */

export const toolUsageSchema = z.record(
	toolNamesSchema,
	z.object({
		attempts: z.number(),
		failures: z.number(),
	}),
)

export type ToolUsage = z.infer<typeof toolUsageSchema>

/**
 * RooCodeEvent
 */

export enum RooCodeEventName {
	Connect = "connect",
	Message = "message",
	TaskCreated = "taskCreated",
	TaskStarted = "taskStarted",
	TaskModeSwitched = "taskModeSwitched",
	TaskPaused = "taskPaused",
	TaskUnpaused = "taskUnpaused",
	TaskAskResponded = "taskAskResponded",
	TaskAborted = "taskAborted",
	TaskSpawned = "taskSpawned",
	TaskCompleted = "taskCompleted",
	TaskTokenUsageUpdated = "taskTokenUsageUpdated",
	TaskToolFailed = "taskToolFailed",
}

export const rooCodeEventsSchema = z.object({
	[RooCodeEventName.Message]: z.tuple([
		z.object({
			taskId: z.string(),
			action: z.union([z.literal("created"), z.literal("updated")]),
			message: clineMessageSchema,
		}),
	]),
	[RooCodeEventName.TaskCreated]: z.tuple([z.string()]),
	[RooCodeEventName.TaskStarted]: z.tuple([z.string()]),
	[RooCodeEventName.TaskModeSwitched]: z.tuple([z.string(), z.string()]),
	[RooCodeEventName.TaskPaused]: z.tuple([z.string()]),
	[RooCodeEventName.TaskUnpaused]: z.tuple([z.string()]),
	[RooCodeEventName.TaskAskResponded]: z.tuple([z.string()]),
	[RooCodeEventName.TaskAborted]: z.tuple([z.string()]),
	[RooCodeEventName.TaskSpawned]: z.tuple([z.string(), z.string()]),
	[RooCodeEventName.TaskCompleted]: z.tuple([z.string(), tokenUsageSchema, toolUsageSchema]),
	[RooCodeEventName.TaskTokenUsageUpdated]: z.tuple([z.string(), tokenUsageSchema]),
	[RooCodeEventName.TaskToolFailed]: z.tuple([z.string(), toolNamesSchema, z.string()]),
})

export type RooCodeEvents = z.infer<typeof rooCodeEventsSchema>
