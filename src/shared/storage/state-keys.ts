import { AutoApprovalSettings, DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import {
	ANTHROPIC_MIN_THINKING_BUDGET,
	ApiProvider,
	DEFAULT_API_PROVIDER,
	LiteLLMModelInfo,
	ModelInfo,
	type OcaModelInfo,
	OpenAiCompatibleModelInfo,
} from "@shared/api"
import { BrowserSettings, DEFAULT_BROWSER_SETTINGS } from "@shared/BrowserSettings"
import { ClineRulesToggles } from "@shared/cline-rules"
import { DEFAULT_DICTATION_SETTINGS, DictationSettings } from "@shared/DictationSettings"
import { DEFAULT_FOCUS_CHAIN_SETTINGS, FocusChainSettings } from "@shared/FocusChainSettings"
import { HistoryItem } from "@shared/HistoryItem"
import { DEFAULT_MCP_DISPLAY_MODE, McpDisplayMode } from "@shared/McpDisplayMode"
import { WorkspaceRoot } from "@shared/multi-root/types"
import { GlobalInstructionsFile } from "@shared/remote-config/schema"
import { Mode, OpenaiReasoningEffort } from "@shared/storage/types"
import { TelemetrySetting } from "@shared/TelemetrySetting"
import { UserInfo } from "@shared/UserInfo"
import { LanguageModelChatSelector } from "vscode"

// ============================================================================
// SINGLE SOURCE OF TRUTH FOR STORAGE KEYS
//
// Property definitions with types, default values, and metadata
// ============================================================================

/**
 * Defines the shape of a field definition. Each field must have a `default` value,
 * and optionally can have `isAsync`, `isComputed`, or `transform` metadata.
 *
 * The type casting on `default` (e.g., `true as boolean`) is necessary because
 * TypeScript would otherwise infer the literal type (`true`) instead of the
 * wider type (`boolean`). This ensures the generated interfaces allow any
 * value of that type, not just the default literal.
 */
type FieldDefinition<T> = {
	default: T // The default value for the field with proper type casting using as (e.g., `true as boolean | undefined`)
	isAsync?: boolean
	isComputed?: boolean
	transform?: (value: any) => T
}

type FieldDefinitions = Record<string, FieldDefinition<any>>

const REMOTE_CONFIG_EXTRA_FIELDS = {
	remoteConfiguredProviders: { default: [] as string[] },
	allowedMCPServers: { default: [] as Array<{ id: string }> },
	remoteMCPServers: { default: undefined as Array<{ name: string; url: string; alwaysEnabled?: boolean }> | undefined },
	previousRemoteMCPServers: { default: undefined as Array<{ name: string; url: string }> | undefined },
	remoteGlobalRules: { default: undefined as GlobalInstructionsFile[] | undefined },
	remoteGlobalWorkflows: { default: undefined as GlobalInstructionsFile[] | undefined },
	blockPersonalRemoteMCPServers: { default: false as boolean },
	openTelemetryOtlpHeaders: { default: undefined as Record<string, string> | undefined },
} satisfies FieldDefinitions

const GLOBAL_STATE_FIELDS = {
	lastShownAnnouncementId: { default: undefined as string | undefined },
	taskHistory: { default: [] as HistoryItem[], isAsync: true },
	userInfo: { default: undefined as UserInfo | undefined },
	favoritedModelIds: { default: [] as string[] },
	mcpMarketplaceEnabled: { default: true as boolean },
	mcpResponsesCollapsed: { default: false as boolean },
	terminalReuseEnabled: { default: true as boolean },
	vscodeTerminalExecutionMode: {
		default: "vscodeTerminal" as "vscodeTerminal" | "backgroundExec",
	},
	isNewUser: { default: true as boolean },
	welcomeViewCompleted: { default: undefined as boolean | undefined },
	mcpDisplayMode: { default: DEFAULT_MCP_DISPLAY_MODE as McpDisplayMode },
	workspaceRoots: { default: undefined as WorkspaceRoot[] | undefined },
	primaryRootIndex: { default: 0 as number },
	multiRootEnabled: { default: false as boolean },
	lastDismissedInfoBannerVersion: { default: 0 as number },
	lastDismissedModelBannerVersion: { default: 0 as number },
	lastDismissedCliBannerVersion: { default: 0 as number },
	nativeToolCallEnabled: { default: true as boolean },
	remoteRulesToggles: { default: {} as ClineRulesToggles },
	remoteWorkflowToggles: { default: {} as ClineRulesToggles },
	dismissedBanners: { default: [] as Array<{ bannerId: string; dismissedAt: number }> },
} satisfies FieldDefinitions

// Fields that map directly to ApiHandlerOptions in @shared/api.ts
// NOTE: Keep these in sync with ApiHandlerOptions interface
const API_HANDLER_SETTINGS_FIELDS = {
	// Global configuration (not mode-specific)
	liteLlmBaseUrl: { default: undefined as string | undefined },
	liteLlmUsePromptCache: { default: undefined as boolean | undefined },
	openAiHeaders: { default: {} as Record<string, string> },
	anthropicBaseUrl: { default: undefined as string | undefined },
	openRouterProviderSorting: { default: undefined as string | undefined },
	awsRegion: { default: undefined as string | undefined },
	awsUseCrossRegionInference: { default: undefined as boolean | undefined },
	awsUseGlobalInference: { default: undefined as boolean | undefined },
	awsBedrockUsePromptCache: { default: undefined as boolean | undefined },
	awsAuthentication: { default: undefined as string | undefined },
	awsUseProfile: { default: undefined as boolean | undefined },
	awsProfile: { default: undefined as string | undefined },
	awsBedrockEndpoint: { default: undefined as string | undefined },
	claudeCodePath: { default: undefined as string | undefined },
	vertexProjectId: { default: undefined as string | undefined },
	vertexRegion: { default: undefined as string | undefined },
	openAiBaseUrl: { default: undefined as string | undefined },
	ollamaBaseUrl: { default: undefined as string | undefined },
	ollamaApiOptionsCtxNum: { default: undefined as string | undefined },
	lmStudioBaseUrl: { default: undefined as string | undefined },
	lmStudioMaxTokens: { default: undefined as string | undefined },
	geminiBaseUrl: { default: undefined as string | undefined },
	requestyBaseUrl: { default: undefined as string | undefined },
	fireworksModelMaxCompletionTokens: { default: undefined as number | undefined },
	fireworksModelMaxTokens: { default: undefined as number | undefined },
	qwenCodeOauthPath: { default: undefined as string | undefined },
	azureApiVersion: { default: undefined as string | undefined },
	azureIdentity: { default: undefined as boolean | undefined },
	qwenApiLine: { default: undefined as string | undefined },
	moonshotApiLine: { default: undefined as string | undefined },
	asksageApiUrl: { default: undefined as string | undefined },
	requestTimeoutMs: { default: undefined as number | undefined },
	sapAiResourceGroup: { default: undefined as string | undefined },
	sapAiCoreTokenUrl: { default: undefined as string | undefined },
	sapAiCoreBaseUrl: { default: undefined as string | undefined },
	sapAiCoreUseOrchestrationMode: { default: true as boolean },
	difyBaseUrl: { default: undefined as string | undefined },
	zaiApiLine: { default: undefined as string | undefined },
	ocaBaseUrl: { default: undefined as string | undefined },
	minimaxApiLine: { default: undefined as string | undefined },
	ocaMode: { default: "internal" as string },
	aihubmixBaseUrl: { default: undefined as string | undefined },
	aihubmixAppCode: { default: undefined as string | undefined },

	// Plan mode configurations
	planModeApiModelId: { default: undefined as string | undefined },
	planModeThinkingBudgetTokens: { default: ANTHROPIC_MIN_THINKING_BUDGET as number | undefined },
	geminiPlanModeThinkingLevel: { default: undefined as string | undefined },
	planModeReasoningEffort: { default: undefined as string | undefined },
	planModeVerbosity: { default: undefined as string | undefined },
	planModeVsCodeLmModelSelector: { default: undefined as LanguageModelChatSelector | undefined },
	planModeAwsBedrockCustomSelected: { default: undefined as boolean | undefined },
	planModeAwsBedrockCustomModelBaseId: { default: undefined as string | undefined },
	planModeOpenRouterModelId: { default: undefined as string | undefined },
	planModeOpenRouterModelInfo: { default: undefined as ModelInfo | undefined },
	planModeOpenAiModelId: { default: undefined as string | undefined },
	planModeOpenAiModelInfo: { default: undefined as OpenAiCompatibleModelInfo | undefined },
	planModeOllamaModelId: { default: undefined as string | undefined },
	planModeLmStudioModelId: { default: undefined as string | undefined },
	planModeLiteLlmModelId: { default: undefined as string | undefined },
	planModeLiteLlmModelInfo: { default: undefined as LiteLLMModelInfo | undefined },
	planModeRequestyModelId: { default: undefined as string | undefined },
	planModeRequestyModelInfo: { default: undefined as ModelInfo | undefined },
	planModeTogetherModelId: { default: undefined as string | undefined },
	planModeFireworksModelId: { default: undefined as string | undefined },
	planModeSapAiCoreModelId: { default: undefined as string | undefined },
	planModeSapAiCoreDeploymentId: { default: undefined as string | undefined },
	planModeGroqModelId: { default: undefined as string | undefined },
	planModeGroqModelInfo: { default: undefined as ModelInfo | undefined },
	planModeBasetenModelId: { default: undefined as string | undefined },
	planModeBasetenModelInfo: { default: undefined as ModelInfo | undefined },
	planModeHuggingFaceModelId: { default: undefined as string | undefined },
	planModeHuggingFaceModelInfo: { default: undefined as ModelInfo | undefined },
	planModeHuaweiCloudMaasModelId: { default: undefined as string | undefined },
	planModeHuaweiCloudMaasModelInfo: { default: undefined as ModelInfo | undefined },
	planModeOcaModelId: { default: undefined as string | undefined },
	planModeOcaModelInfo: { default: undefined as OcaModelInfo | undefined },
	planModeOcaReasoningEffort: { default: undefined as string | undefined },
	planModeAihubmixModelId: { default: undefined as string | undefined },
	planModeAihubmixModelInfo: { default: undefined as OpenAiCompatibleModelInfo | undefined },
	planModeHicapModelId: { default: undefined as string | undefined },
	planModeHicapModelInfo: { default: undefined as ModelInfo | undefined },
	planModeNousResearchModelId: { default: undefined as string | undefined },
	planModeVercelAiGatewayModelId: { default: undefined as string | undefined },
	planModeVercelAiGatewayModelInfo: { default: undefined as ModelInfo | undefined },

	// Act mode configurations
	actModeApiModelId: { default: undefined as string | undefined },
	actModeThinkingBudgetTokens: { default: ANTHROPIC_MIN_THINKING_BUDGET as number | undefined },
	geminiActModeThinkingLevel: { default: undefined as string | undefined },
	actModeReasoningEffort: { default: undefined as string | undefined },
	actModeVerbosity: { default: undefined as string | undefined },
	actModeVsCodeLmModelSelector: { default: undefined as LanguageModelChatSelector | undefined },
	actModeAwsBedrockCustomSelected: { default: undefined as boolean | undefined },
	actModeAwsBedrockCustomModelBaseId: { default: undefined as string | undefined },
	actModeOpenRouterModelId: { default: undefined as string | undefined },
	actModeOpenRouterModelInfo: { default: undefined as ModelInfo | undefined },
	actModeOpenAiModelId: { default: undefined as string | undefined },
	actModeOpenAiModelInfo: { default: undefined as OpenAiCompatibleModelInfo | undefined },
	actModeOllamaModelId: { default: undefined as string | undefined },
	actModeLmStudioModelId: { default: undefined as string | undefined },
	actModeLiteLlmModelId: { default: undefined as string | undefined },
	actModeLiteLlmModelInfo: { default: undefined as LiteLLMModelInfo | undefined },
	actModeRequestyModelId: { default: undefined as string | undefined },
	actModeRequestyModelInfo: { default: undefined as ModelInfo | undefined },
	actModeTogetherModelId: { default: undefined as string | undefined },
	actModeFireworksModelId: { default: undefined as string | undefined },
	actModeSapAiCoreModelId: { default: undefined as string | undefined },
	actModeSapAiCoreDeploymentId: { default: undefined as string | undefined },
	actModeGroqModelId: { default: undefined as string | undefined },
	actModeGroqModelInfo: { default: undefined as ModelInfo | undefined },
	actModeBasetenModelId: { default: undefined as string | undefined },
	actModeBasetenModelInfo: { default: undefined as ModelInfo | undefined },
	actModeHuggingFaceModelId: { default: undefined as string | undefined },
	actModeHuggingFaceModelInfo: { default: undefined as ModelInfo | undefined },
	actModeHuaweiCloudMaasModelId: { default: undefined as string | undefined },
	actModeHuaweiCloudMaasModelInfo: { default: undefined as ModelInfo | undefined },
	actModeOcaModelId: { default: undefined as string | undefined },
	actModeOcaModelInfo: { default: undefined as OcaModelInfo | undefined },
	actModeOcaReasoningEffort: { default: undefined as string | undefined },
	actModeAihubmixModelId: { default: undefined as string | undefined },
	actModeAihubmixModelInfo: { default: undefined as OpenAiCompatibleModelInfo | undefined },
	actModeHicapModelId: { default: undefined as string | undefined },
	actModeHicapModelInfo: { default: undefined as ModelInfo | undefined },
	actModeNousResearchModelId: { default: undefined as string | undefined },
	actModeVercelAiGatewayModelId: { default: undefined as string | undefined },
	actModeVercelAiGatewayModelInfo: { default: undefined as ModelInfo | undefined },

	// Model-specific settings
	planModeApiProvider: { default: DEFAULT_API_PROVIDER as ApiProvider },
	actModeApiProvider: { default: DEFAULT_API_PROVIDER as ApiProvider },

	// Deprecated model settings
	hicapModelId: { default: undefined as string | undefined },
	lmStudioModelId: { default: undefined as string | undefined },
} satisfies FieldDefinitions

const USER_SETTINGS_FIELDS = {
	// Settings that are NOT part of ApiHandlerOptions
	autoApprovalSettings: {
		default: DEFAULT_AUTO_APPROVAL_SETTINGS as AutoApprovalSettings,
	},
	globalClineRulesToggles: { default: {} as ClineRulesToggles },
	globalWorkflowToggles: { default: {} as ClineRulesToggles },
	globalSkillsToggles: { default: {} as Record<string, boolean> },
	browserSettings: {
		default: DEFAULT_BROWSER_SETTINGS as BrowserSettings,
		transform: (v: any) => ({ ...DEFAULT_BROWSER_SETTINGS, ...v }),
	},
	telemetrySetting: { default: "unset" as TelemetrySetting },
	planActSeparateModelsSetting: { default: false as boolean, isComputed: true },
	enableCheckpointsSetting: { default: true as boolean },
	shellIntegrationTimeout: { default: 4000 as number },
	defaultTerminalProfile: { default: "default" as string },
	terminalOutputLineLimit: { default: 500 as number },
	maxConsecutiveMistakes: { default: 3 as number },
	subagentTerminalOutputLineLimit: { default: 2000 as number },
	strictPlanModeEnabled: { default: true as boolean },
	yoloModeToggled: { default: false as boolean },
	useAutoCondense: { default: false as boolean },
	clineWebToolsEnabled: { default: true as boolean },
	preferredLanguage: { default: "English" as string },
	openaiReasoningEffort: { default: "medium" as OpenaiReasoningEffort },
	mode: { default: "act" as Mode },
	dictationSettings: {
		default: DEFAULT_DICTATION_SETTINGS as DictationSettings,
		transform: (v: any) => ({ ...DEFAULT_DICTATION_SETTINGS, ...v }),
	},
	focusChainSettings: { default: DEFAULT_FOCUS_CHAIN_SETTINGS as FocusChainSettings },
	customPrompt: { default: undefined as "compact" | undefined },
	autoCondenseThreshold: { default: 0.75 as number }, // number from 0 to 1
	hooksEnabled: { default: false as boolean },
	subagentsEnabled: { default: false as boolean },
	enableParallelToolCalling: { default: false as boolean },
	backgroundEditEnabled: { default: false as boolean },
	skillsEnabled: { default: false as boolean },
	optOutOfRemoteConfig: { default: false as boolean },

	// OpenTelemetry configuration
	openTelemetryEnabled: { default: true as boolean },
	openTelemetryMetricsExporter: { default: undefined as string | undefined },
	openTelemetryLogsExporter: { default: undefined as string | undefined },
	openTelemetryOtlpProtocol: { default: "http/json" as string | undefined },
	openTelemetryOtlpEndpoint: { default: "http://localhost:4318" as string | undefined },
	openTelemetryOtlpMetricsProtocol: { default: undefined as string | undefined },
	openTelemetryOtlpMetricsEndpoint: { default: undefined as string | undefined },
	openTelemetryOtlpLogsProtocol: { default: undefined as string | undefined },
	openTelemetryOtlpLogsEndpoint: { default: undefined as string | undefined },
	openTelemetryMetricExportInterval: { default: 60000 as number | undefined },
	openTelemetryOtlpInsecure: { default: false as boolean | undefined },
	openTelemetryLogBatchSize: { default: 512 as number | undefined },
	openTelemetryLogBatchTimeout: { default: 5000 as number | undefined },
	openTelemetryLogMaxQueueSize: { default: 2048 as number | undefined },
} satisfies FieldDefinitions

const SETTINGS_FIELDS = { ...API_HANDLER_SETTINGS_FIELDS, ...USER_SETTINGS_FIELDS }
const GLOBAL_STATE_AND_SETTINGS_FIELDS = { ...GLOBAL_STATE_FIELDS, ...SETTINGS_FIELDS }

// ============================================================================
// SECRET KEYS AND LOCAL STATE - Static definitions
// ============================================================================

// Secret keys used in Api Configuration
const SECRETS_KEYS = [
	"apiKey",
	"clineAccountId", // Cline Account ID for Firebase
	"cline:clineAccountId",
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
	"minimaxApiKey",
	"hicapApiKey",
	"aihubmixApiKey",
	"nousResearchApiKey",
	"remoteLiteLlmApiKey",
	"ocaApiKey",
	"ocaRefreshToken",
	"mcpOAuthSecrets",
] as const

export const LocalStateKeys = [
	"localClineRulesToggles",
	"localCursorRulesToggles",
	"localWindsurfRulesToggles",
	"localAgentsRulesToggles",
	"localSkillsToggles",
	"workflowToggles",
] as const

// ============================================================================
// GENERATED TYPES - Auto-generated from property definitions
// ============================================================================

type ExtractDefault<T> = T extends { default: infer U } ? U : never
type BuildInterface<T extends Record<string, { default: any }>> = { [K in keyof T]: ExtractDefault<T[K]> }

export type GlobalState = BuildInterface<typeof GLOBAL_STATE_FIELDS>
export type Settings = BuildInterface<typeof SETTINGS_FIELDS>
type RemoteConfigExtra = BuildInterface<typeof REMOTE_CONFIG_EXTRA_FIELDS>
export type ApiHandlerOptionSettings = BuildInterface<typeof API_HANDLER_SETTINGS_FIELDS>
export type ApiHandlerSettings = ApiHandlerOptionSettings & Secrets
export type GlobalStateAndSettings = GlobalState & Settings
export type RemoteConfigFields = GlobalStateAndSettings & RemoteConfigExtra

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
// GENERATED KEYS AND LOOKUP SETS - Auto-generated from property definitions
// ============================================================================

const GlobalStateKeys = new Set(Object.keys(GLOBAL_STATE_FIELDS))
const SettingsKeysSet = new Set(Object.keys(SETTINGS_FIELDS))
const GlobalStateAndSettingsKeySet = new Set(Object.keys(GLOBAL_STATE_AND_SETTINGS_FIELDS))
const ApiHandlerSettingsKeysSet = new Set(Object.keys(API_HANDLER_SETTINGS_FIELDS))

export const SecretKeys = Array.from(SECRETS_KEYS)
export const SettingsKeys = Array.from(SettingsKeysSet) as (keyof Settings)[]
export const ApiHandlerSettingsKeys = Array.from(ApiHandlerSettingsKeysSet) as (keyof ApiHandlerOptionSettings)[]
export const GlobalStateAndSettingKeys = Array.from(GlobalStateAndSettingsKeySet) as GlobalStateAndSettingsKey[]

// GENERATED DEFAULTS - Auto-generated from property definitions
// ============================================================================

export const GLOBAL_STATE_DEFAULTS = extractDefaults(GLOBAL_STATE_FIELDS)
export const SETTINGS_DEFAULTS = extractDefaults(SETTINGS_FIELDS)
export const SETTINGS_TRANSFORMS = extractTransforms(SETTINGS_FIELDS)
export const ASYNC_PROPERTIES = extractMetadata({ ...GLOBAL_STATE_FIELDS, ...SETTINGS_FIELDS }, "isAsync")
export const COMPUTED_PROPERTIES = extractMetadata({ ...GLOBAL_STATE_FIELDS, ...SETTINGS_FIELDS }, "isComputed")

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

export const isGlobalStateKey = (key: string): key is GlobalStateKey => GlobalStateKeys.has(key)
export const isSettingsKey = (key: string): key is SettingsKey => SettingsKeysSet.has(key)
export const isSecretKey = (key: string): key is SecretKey => new Set(SECRETS_KEYS).has(key as SecretKey)
export const isLocalStateKey = (key: string): key is LocalStateKey => new Set(LocalStateKeys).has(key as LocalStateKey)

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export const isAsyncProperty = (key: string): boolean => ASYNC_PROPERTIES.has(key)
export const isComputedProperty = (key: string): boolean => COMPUTED_PROPERTIES.has(key)

export const getDefaultValue = <K extends GlobalStateAndSettingsKey>(key: K): GlobalStateAndSettings[K] | undefined => {
	return ((GLOBAL_STATE_DEFAULTS as any)[key] ?? (SETTINGS_DEFAULTS as any)[key]) as GlobalStateAndSettings[K] | undefined
}

export const hasTransform = (key: string): boolean => key in SETTINGS_TRANSFORMS
export const applyTransform = <T>(key: string, value: T): T => {
	const transform = SETTINGS_TRANSFORMS[key]
	return transform ? transform(value) : value
}

function extractDefaults<T extends Record<string, any>>(props: T): Partial<BuildInterface<T>> {
	return Object.fromEntries(
		Object.entries(props)
			.map(([key, prop]) => [key, prop.default])
			.filter(([_, value]) => value !== undefined),
	) as Partial<BuildInterface<T>>
}

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
