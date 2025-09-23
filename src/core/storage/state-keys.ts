import { ApiProvider, fireworksDefaultModelId, ModelInfo, type OcaModelInfo } from "@shared/api"
import { DEFAULT_FOCUS_CHAIN_SETTINGS, FocusChainSettings } from "@shared/FocusChainSettings"
import { LanguageModelChatSelector } from "vscode"
import { WorkspaceRoot } from "@/core/workspace/WorkspaceRoot"
import { AutoApprovalSettings, DEFAULT_AUTO_APPROVAL_SETTINGS } from "@/shared/AutoApprovalSettings"
import { BrowserSettings, DEFAULT_BROWSER_SETTINGS } from "@/shared/BrowserSettings"
import { ClineRulesToggles } from "@/shared/cline-rules"
import { DEFAULT_DICTATION_SETTINGS, DictationSettings } from "@/shared/DictationSettings"
import { HistoryItem } from "@/shared/HistoryItem"
import { DEFAULT_MCP_DISPLAY_MODE, McpDisplayMode } from "@/shared/McpDisplayMode"
import { McpMarketplaceCatalog } from "@/shared/mcp"
import { Mode, OpenaiReasoningEffort } from "@/shared/storage/types"
import { TelemetrySetting } from "@/shared/TelemetrySetting"
import { UserInfo } from "@/shared/UserInfo"

// ============================================================================
// SINGLE SOURCE OF TRUTH - Property definitions
// ============================================================================

const GLOBAL_STATE_PROPS = {
	lastShownAnnouncementId: { type: undefined as string | undefined },
	taskHistory: { type: [] as HistoryItem[], isAsync: true },
	userInfo: { type: undefined as UserInfo | undefined },
	mcpMarketplaceCatalog: { type: undefined as McpMarketplaceCatalog | undefined },
	favoritedModelIds: { type: [] as string[], defaultValue: [] as string[] },
	mcpMarketplaceEnabled: { type: true as boolean, defaultValue: true },
	mcpResponsesCollapsed: { type: false as boolean, defaultValue: false },
	terminalReuseEnabled: { type: true as boolean, defaultValue: true },
	isNewUser: { type: true as boolean, defaultValue: true },
	welcomeViewCompleted: { type: undefined as boolean | undefined },
	mcpDisplayMode: { type: DEFAULT_MCP_DISPLAY_MODE as McpDisplayMode, defaultValue: DEFAULT_MCP_DISPLAY_MODE },
	workspaceRoots: { type: undefined as WorkspaceRoot[] | undefined },
	primaryRootIndex: { type: 0 as number, defaultValue: 0 },
	multiRootEnabled: { type: false as boolean, defaultValue: false },
} as const

const SETTINGS_PROPS = {
	// AWS Settings
	awsRegion: { type: undefined as string | undefined },
	awsUseCrossRegionInference: { type: undefined as boolean | undefined },
	awsBedrockUsePromptCache: { type: undefined as boolean | undefined },
	awsBedrockEndpoint: { type: undefined as string | undefined },
	awsProfile: { type: undefined as string | undefined },
	awsAuthentication: { type: undefined as string | undefined },
	awsUseProfile: { type: undefined as boolean | undefined },

	// Vertex Settings
	vertexProjectId: { type: undefined as string | undefined },
	vertexRegion: { type: undefined as string | undefined },

	// API Base URLs
	requestyBaseUrl: { type: undefined as string | undefined },
	openAiBaseUrl: { type: undefined as string | undefined },
	ollamaBaseUrl: { type: undefined as string | undefined },
	lmStudioBaseUrl: { type: undefined as string | undefined },
	anthropicBaseUrl: { type: undefined as string | undefined },
	geminiBaseUrl: { type: undefined as string | undefined },
	liteLlmBaseUrl: { type: undefined as string | undefined },
	asksageApiUrl: { type: undefined as string | undefined },
	difyBaseUrl: { type: undefined as string | undefined },
	ocaBaseUrl: { type: undefined as string | undefined },

	// API Configuration
	openAiHeaders: { type: {} as Record<string, string>, defaultValue: {} as Record<string, string> },
	ollamaApiOptionsCtxNum: { type: undefined as string | undefined },
	lmStudioMaxTokens: { type: undefined as string | undefined },
	azureApiVersion: { type: undefined as string | undefined },
	openRouterProviderSorting: { type: undefined as string | undefined },
	liteLlmUsePromptCache: { type: undefined as boolean | undefined },
	fireworksModelMaxCompletionTokens: { type: undefined as number | undefined },
	fireworksModelMaxTokens: { type: undefined as number | undefined },

	// API Lines
	qwenApiLine: { type: undefined as string | undefined },
	moonshotApiLine: { type: undefined as string | undefined },
	zaiApiLine: { type: undefined as string | undefined },

	// Complex Settings
	autoApprovalSettings: {
		type: DEFAULT_AUTO_APPROVAL_SETTINGS as AutoApprovalSettings,
		defaultValue: DEFAULT_AUTO_APPROVAL_SETTINGS,
	},
	browserSettings: {
		type: DEFAULT_BROWSER_SETTINGS as BrowserSettings,
		defaultValue: DEFAULT_BROWSER_SETTINGS,
		transform: (v: any) => ({ ...DEFAULT_BROWSER_SETTINGS, ...v }),
	},
	dictationSettings: {
		type: DEFAULT_DICTATION_SETTINGS as DictationSettings,
		defaultValue: DEFAULT_DICTATION_SETTINGS,
		transform: (v: any) => ({ ...DEFAULT_DICTATION_SETTINGS, ...v }),
	},
	focusChainSettings: { type: DEFAULT_FOCUS_CHAIN_SETTINGS as FocusChainSettings, defaultValue: DEFAULT_FOCUS_CHAIN_SETTINGS },

	// Toggles and Rules
	globalClineRulesToggles: { type: {} as ClineRulesToggles, defaultValue: {} as ClineRulesToggles },
	globalWorkflowToggles: { type: {} as ClineRulesToggles, defaultValue: {} as ClineRulesToggles },

	// General Settings
	telemetrySetting: { type: "unset" as TelemetrySetting, defaultValue: "unset" as TelemetrySetting },
	planActSeparateModelsSetting: { type: false as boolean, defaultValue: false, isComputed: true },
	enableCheckpointsSetting: { type: true as boolean, defaultValue: true },
	requestTimeoutMs: { type: undefined as number | undefined },
	shellIntegrationTimeout: { type: 4000 as number, defaultValue: 4000 },
	defaultTerminalProfile: { type: "default" as string, defaultValue: "default" },
	terminalOutputLineLimit: { type: 500 as number, defaultValue: 500 },

	// SAP AI Core
	sapAiCoreTokenUrl: { type: undefined as string | undefined },
	sapAiCoreBaseUrl: { type: undefined as string | undefined },
	sapAiResourceGroup: { type: undefined as string | undefined },
	sapAiCoreUseOrchestrationMode: { type: true as boolean | undefined, defaultValue: true },

	// Paths
	claudeCodePath: { type: undefined as string | undefined },
	qwenCodeOauthPath: { type: undefined as string | undefined },

	// Mode Settings
	strictPlanModeEnabled: { type: true as boolean, defaultValue: true },
	yoloModeToggled: { type: false as boolean, defaultValue: false },
	useAutoCondense: { type: false as boolean, defaultValue: false },
	preferredLanguage: { type: "English" as string, defaultValue: "English" },
	openaiReasoningEffort: { type: "medium" as OpenaiReasoningEffort, defaultValue: "medium" as OpenaiReasoningEffort },
	mode: { type: "act" as Mode, defaultValue: "act" as Mode },
	customPrompt: { type: undefined as "compact" | undefined },
	autoCondenseThreshold: { type: 0.75 as number | undefined, defaultValue: 0.75 },

	// Plan Mode Configurations
	planModeApiProvider: { type: "openrouter" as ApiProvider, defaultValue: "openrouter" as ApiProvider, isComputed: true },
	planModeApiModelId: { type: undefined as string | undefined },
	planModeThinkingBudgetTokens: { type: undefined as number | undefined },
	planModeReasoningEffort: { type: undefined as string | undefined },
	planModeVsCodeLmModelSelector: { type: undefined as LanguageModelChatSelector | undefined },
	planModeAwsBedrockCustomSelected: { type: undefined as boolean | undefined },
	planModeAwsBedrockCustomModelBaseId: { type: undefined as string | undefined },
	planModeOpenRouterModelId: { type: undefined as string | undefined },
	planModeOpenRouterModelInfo: { type: undefined as ModelInfo | undefined },
	planModeOpenAiModelId: { type: undefined as string | undefined },
	planModeOpenAiModelInfo: { type: undefined as ModelInfo | undefined },
	planModeOllamaModelId: { type: undefined as string | undefined },
	planModeLmStudioModelId: { type: undefined as string | undefined },
	planModeLiteLlmModelId: { type: undefined as string | undefined },
	planModeLiteLlmModelInfo: { type: undefined as ModelInfo | undefined },
	planModeRequestyModelId: { type: undefined as string | undefined },
	planModeRequestyModelInfo: { type: undefined as ModelInfo | undefined },
	planModeTogetherModelId: { type: undefined as string | undefined },
	planModeFireworksModelId: { type: fireworksDefaultModelId as string | undefined, defaultValue: fireworksDefaultModelId },
	planModeSapAiCoreModelId: { type: undefined as string | undefined },
	planModeSapAiCoreDeploymentId: { type: undefined as string | undefined },
	planModeGroqModelId: { type: undefined as string | undefined },
	planModeGroqModelInfo: { type: undefined as ModelInfo | undefined },
	planModeBasetenModelId: { type: undefined as string | undefined },
	planModeBasetenModelInfo: { type: undefined as ModelInfo | undefined },
	planModeHuggingFaceModelId: { type: undefined as string | undefined },
	planModeHuggingFaceModelInfo: { type: undefined as ModelInfo | undefined },
	planModeHuaweiCloudMaasModelId: { type: undefined as string | undefined },
	planModeHuaweiCloudMaasModelInfo: { type: undefined as ModelInfo | undefined },
	planModeVercelAiGatewayModelId: { type: undefined as string | undefined },
	planModeVercelAiGatewayModelInfo: { type: undefined as ModelInfo | undefined },
	planModeOcaModelId: { type: undefined as string | undefined },
	planModeOcaModelInfo: { type: undefined as OcaModelInfo | undefined },

	// Act Mode Configurations
	actModeApiProvider: { type: "openrouter" as ApiProvider, defaultValue: "openrouter" as ApiProvider, isComputed: true },
	actModeApiModelId: { type: undefined as string | undefined },
	actModeThinkingBudgetTokens: { type: undefined as number | undefined },
	actModeReasoningEffort: { type: undefined as string | undefined },
	actModeVsCodeLmModelSelector: { type: undefined as LanguageModelChatSelector | undefined },
	actModeAwsBedrockCustomSelected: { type: undefined as boolean | undefined },
	actModeAwsBedrockCustomModelBaseId: { type: undefined as string | undefined },
	actModeOpenRouterModelId: { type: undefined as string | undefined },
	actModeOpenRouterModelInfo: { type: undefined as ModelInfo | undefined },
	actModeOpenAiModelId: { type: undefined as string | undefined },
	actModeOpenAiModelInfo: { type: undefined as ModelInfo | undefined },
	actModeOllamaModelId: { type: undefined as string | undefined },
	actModeLmStudioModelId: { type: undefined as string | undefined },
	actModeLiteLlmModelId: { type: undefined as string | undefined },
	actModeLiteLlmModelInfo: { type: undefined as ModelInfo | undefined },
	actModeRequestyModelId: { type: undefined as string | undefined },
	actModeRequestyModelInfo: { type: undefined as ModelInfo | undefined },
	actModeTogetherModelId: { type: undefined as string | undefined },
	actModeFireworksModelId: { type: fireworksDefaultModelId as string | undefined, defaultValue: fireworksDefaultModelId },
	actModeSapAiCoreModelId: { type: undefined as string | undefined },
	actModeSapAiCoreDeploymentId: { type: undefined as string | undefined },
	actModeGroqModelId: { type: undefined as string | undefined },
	actModeGroqModelInfo: { type: undefined as ModelInfo | undefined },
	actModeBasetenModelId: { type: undefined as string | undefined },
	actModeBasetenModelInfo: { type: undefined as ModelInfo | undefined },
	actModeHuggingFaceModelId: { type: undefined as string | undefined },
	actModeHuggingFaceModelInfo: { type: undefined as ModelInfo | undefined },
	actModeHuaweiCloudMaasModelId: { type: undefined as string | undefined },
	actModeHuaweiCloudMaasModelInfo: { type: undefined as ModelInfo | undefined },
	actModeVercelAiGatewayModelId: { type: undefined as string | undefined },
	actModeVercelAiGatewayModelInfo: { type: undefined as ModelInfo | undefined },
	actModeOcaModelId: { type: undefined as string | undefined },
	actModeOcaModelInfo: { type: undefined as OcaModelInfo | undefined },
} as const

// ============================================================================
// GENERATED TYPES - Auto-generated from property definitions
// ============================================================================

type ExtractType<T> = T extends { type: infer U } ? U : never
type BuildInterface<T extends Record<string, { type: any }>> = { [K in keyof T]: ExtractType<T[K]> }

export type GlobalState = BuildInterface<typeof GLOBAL_STATE_PROPS>
export type Settings = BuildInterface<typeof SETTINGS_PROPS>
export type GlobalStateAndSettings = GlobalState & Settings

// ============================================================================
// GENERATED DEFAULTS - Auto-generated from property definitions
// ============================================================================

function extractDefaults<T extends Record<string, any>>(props: T): Partial<BuildInterface<T>> {
	return Object.fromEntries(
		Object.entries(props)
			.filter(([_, prop]) => "defaultValue" in prop && prop.defaultValue !== undefined)
			.map(([key, prop]) => [key, prop.defaultValue]),
	) as Partial<BuildInterface<T>>
}

export const GLOBAL_STATE_DEFAULTS = extractDefaults(GLOBAL_STATE_PROPS)
export const SETTINGS_DEFAULTS = extractDefaults(SETTINGS_PROPS)

// ============================================================================
// GENERATED METADATA - Auto-generated from property definitions
// ============================================================================

function extractTransforms<T extends Record<string, any>>(props: T): Record<string, (value: any) => any> {
	return Object.fromEntries(
		Object.entries(props)
			.filter(([_, prop]) => "transform" in prop && prop.transform !== undefined)
			.map(([key, prop]) => [key, prop.transform]),
	)
}

function extractMetadata<T extends Record<string, any>>(props: T, field: string): Set<string> {
	return new Set(
		Object.entries(props)
			.filter(([_, prop]) => field in prop && prop[field] === true)
			.map(([key]) => key),
	)
}

export const SETTINGS_TRANSFORMS = extractTransforms(SETTINGS_PROPS)
export const ASYNC_PROPERTIES = extractMetadata({ ...GLOBAL_STATE_PROPS, ...SETTINGS_PROPS }, "isAsync")
export const COMPUTED_PROPERTIES = extractMetadata({ ...GLOBAL_STATE_PROPS, ...SETTINGS_PROPS }, "isComputed")

// ============================================================================
// GENERATED KEYS AND LOOKUP SETS - Auto-generated from property definitions
// ============================================================================

export const GlobalStateKeys = new Set(Object.keys(GLOBAL_STATE_PROPS))
export const SettingsKeys = new Set(Object.keys(SETTINGS_PROPS))

// ============================================================================
// SECRET KEYS AND LOCAL STATE - Static definitions
// ============================================================================

export const SecretKeys = [
	"apiKey",
	"clineAccountId",
	"openRouterApiKey",
	"awsAccessKey",
	"awsSecretKey",
	"awsSessionToken",
	"awsBedrockApiKey",
	"openAiApiKey",
	"geminiApiKey",
	"openAiNativeApiKey",
	"ollamaApiKey",
	"deepSeekApiKey",
	"requestyApiKey",
	"togetherApiKey",
	"fireworksApiKey",
	"qwenApiKey",
	"doubaoApiKey",
	"mistralApiKey",
	"liteLlmApiKey",
	"authNonce",
	"asksageApiKey",
	"xaiApiKey",
	"moonshotApiKey",
	"zaiApiKey",
	"huggingFaceApiKey",
	"nebiusApiKey",
	"sambanovaApiKey",
	"cerebrasApiKey",
	"sapAiCoreClientId",
	"sapAiCoreClientSecret",
	"groqApiKey",
	"huaweiCloudMaasApiKey",
	"basetenApiKey",
	"vercelAiGatewayApiKey",
	"difyApiKey",
	"ocaApiKey",
	"ocaRefreshToken",
] as const

export const LocalStateKeys = [
	"localClineRulesToggles",
	"localCursorRulesToggles",
	"localWindsurfRulesToggles",
	"workflowToggles",
] as const

// ============================================================================
// TYPE ALIASES
// ============================================================================

export type Secrets = { [K in (typeof SecretKeys)[number]]: string | undefined }
export type LocalState = { [K in (typeof LocalStateKeys)[number]]: ClineRulesToggles }
export type SecretKey = (typeof SecretKeys)[number]
export type GlobalStateKey = keyof GlobalState
export type LocalStateKey = keyof LocalState
export type SettingsKey = keyof Settings
export type GlobalStateAndSettingsKey = keyof GlobalStateAndSettings

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export const isGlobalStateKey = (key: string): key is GlobalStateKey => GlobalStateKeys.has(key)
export const isSettingsKey = (key: string): key is SettingsKey => SettingsKeys.has(key)
export const isSecretKey = (key: string): key is SecretKey => SecretKeys.includes(key as SecretKey)
export const isLocalStateKey = (key: string): key is LocalStateKey => LocalStateKeys.includes(key as LocalStateKey)

export const getDefaultValue = <K extends GlobalStateAndSettingsKey>(key: K): GlobalStateAndSettings[K] | undefined => {
	return (GLOBAL_STATE_DEFAULTS as any)[key] ?? (SETTINGS_DEFAULTS as any)[key]
}

export const hasTransform = (key: string): boolean => key in SETTINGS_TRANSFORMS
export const applyTransform = <T>(key: string, value: T): T => {
	const transform = SETTINGS_TRANSFORMS[key]
	return transform ? transform(value) : value
}

export const isAsyncProperty = (key: string): boolean => ASYNC_PROPERTIES.has(key)
export const isComputedProperty = (key: string): boolean => COMPUTED_PROPERTIES.has(key)
