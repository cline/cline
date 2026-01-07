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
// SINGLE SOURCE OF TRUTH - Property definitions
// ============================================================================

const GLOBAL_STATE_FIELDS = {
	lastShownAnnouncementId: { type: undefined as string | undefined },
	taskHistory: { type: [] as HistoryItem[], isAsync: true },
	userInfo: { type: undefined as UserInfo | undefined },
	favoritedModelIds: { type: [] as string[] },
	mcpMarketplaceEnabled: { type: true as boolean },
	mcpResponsesCollapsed: { type: false as boolean },
	terminalReuseEnabled: { type: true as boolean },
	vscodeTerminalExecutionMode: {
		type: "vscodeTerminal" as "vscodeTerminal" | "backgroundExec",
	},
	isNewUser: { type: true as boolean },
	welcomeViewCompleted: { type: undefined as boolean | undefined },
	mcpDisplayMode: { type: DEFAULT_MCP_DISPLAY_MODE as McpDisplayMode },
	workspaceRoots: { type: undefined as WorkspaceRoot[] | undefined },
	primaryRootIndex: { type: 0 as number },
	multiRootEnabled: { type: false as boolean },
	lastDismissedInfoBannerVersion: { type: 0 as number },
	lastDismissedModelBannerVersion: { type: 0 as number },
	lastDismissedCliBannerVersion: { type: 0 as number },
	nativeToolCallEnabled: { type: true as boolean },
	remoteRulesToggles: { type: {} as ClineRulesToggles },
	remoteWorkflowToggles: { type: {} as ClineRulesToggles },
	dismissedBanners: { type: [] as Array<{ bannerId: string; dismissedAt: number }> },
}

const REMOTE_CONFIG_EXTRA_FIELDS = {
	remoteConfiguredProviders: { type: [] as string[] },
	allowedMCPServers: { type: [] as Array<{ id: string }> },
	remoteMCPServers: { type: undefined as Array<{ name: string; url: string }> | undefined },
	remoteGlobalRules: { type: undefined as GlobalInstructionsFile[] | undefined },
	remoteGlobalWorkflows: { type: undefined as GlobalInstructionsFile[] | undefined },
	blockPersonalRemoteMCPServers: { type: false as boolean },
	openTelemetryOtlpHeaders: { type: undefined as Record<string, string> | undefined },
}

const SETTINGS_FIELDS = {
	awsRegion: { type: undefined as string | undefined },
	awsUseCrossRegionInference: { type: undefined as boolean | undefined },
	awsUseGlobalInference: { type: undefined as boolean | undefined },
	awsBedrockUsePromptCache: { type: undefined as boolean | undefined },
	awsBedrockEndpoint: { type: undefined as string | undefined },
	awsProfile: { type: undefined as string | undefined },
	awsAuthentication: { type: undefined as string | undefined },
	awsUseProfile: { type: undefined as boolean | undefined },
	vertexProjectId: { type: undefined as string | undefined },
	vertexRegion: { type: undefined as string | undefined },
	requestyBaseUrl: { type: undefined as string | undefined },
	openAiBaseUrl: { type: undefined as string | undefined },
	openAiHeaders: { type: {} as Record<string, string> },
	ollamaBaseUrl: { type: undefined as string | undefined },
	ollamaApiOptionsCtxNum: { type: undefined as string | undefined },
	lmStudioBaseUrl: { type: undefined as string | undefined },
	lmStudioMaxTokens: { type: undefined as string | undefined },
	anthropicBaseUrl: { type: undefined as string | undefined },
	geminiBaseUrl: { type: undefined as string | undefined },
	azureApiVersion: { type: undefined as string | undefined },
	azureIdentity: { type: undefined as boolean | undefined },
	openRouterProviderSorting: { type: undefined as string | undefined },
	autoApprovalSettings: {
		type: DEFAULT_AUTO_APPROVAL_SETTINGS as AutoApprovalSettings,
	},
	globalClineRulesToggles: { type: {} as ClineRulesToggles },
	globalWorkflowToggles: { type: {} as ClineRulesToggles },
	browserSettings: {
		type: DEFAULT_BROWSER_SETTINGS as BrowserSettings,
		transform: (v: any) => ({ ...DEFAULT_BROWSER_SETTINGS, ...v }),
	},
	liteLlmBaseUrl: { type: undefined as string | undefined },
	liteLlmUsePromptCache: { type: undefined as boolean | undefined },
	fireworksModelMaxCompletionTokens: { type: undefined as number | undefined },
	fireworksModelMaxTokens: { type: undefined as number | undefined },
	qwenApiLine: { type: undefined as string | undefined },
	moonshotApiLine: { type: undefined as string | undefined },
	zaiApiLine: { type: undefined as string | undefined },
	telemetrySetting: { type: "unset" as TelemetrySetting },
	asksageApiUrl: { type: undefined as string | undefined },
	planActSeparateModelsSetting: { type: false as boolean, isComputed: true },
	enableCheckpointsSetting: { type: true as boolean },
	requestTimeoutMs: { type: undefined as number | undefined },
	shellIntegrationTimeout: { type: 4000 as number },
	defaultTerminalProfile: { type: "default" as string },
	terminalOutputLineLimit: { type: 500 as number },
	maxConsecutiveMistakes: { type: 3 as number },
	subagentTerminalOutputLineLimit: { type: 2000 as number },
	sapAiCoreTokenUrl: { type: undefined as string | undefined },
	sapAiCoreBaseUrl: { type: undefined as string | undefined },
	sapAiResourceGroup: { type: undefined as string | undefined },
	sapAiCoreUseOrchestrationMode: { type: true as boolean },
	claudeCodePath: { type: undefined as string | undefined },
	qwenCodeOauthPath: { type: undefined as string | undefined },
	strictPlanModeEnabled: { type: true as boolean },
	yoloModeToggled: { type: false as boolean },
	useAutoCondense: { type: false as boolean },
	clineWebToolsEnabled: { type: true as boolean },
	preferredLanguage: { type: "English" as string },
	openaiReasoningEffort: { type: "medium" as OpenaiReasoningEffort },
	mode: { type: "act" as Mode },
	dictationSettings: {
		type: DEFAULT_DICTATION_SETTINGS as DictationSettings,
		transform: (v: any) => ({ ...DEFAULT_DICTATION_SETTINGS, ...v }),
	},
	focusChainSettings: { type: DEFAULT_FOCUS_CHAIN_SETTINGS as FocusChainSettings },
	customPrompt: { type: undefined as "compact" | undefined },
	difyBaseUrl: { type: undefined as string | undefined },
	autoCondenseThreshold: { type: 0.75 as number }, // number from 0 to 1
	ocaBaseUrl: { type: undefined as string | undefined },
	minimaxApiLine: { type: undefined as string | undefined },
	ocaMode: { type: "internal" as string },
	aihubmixBaseUrl: { type: undefined as string | undefined },
	aihubmixAppCode: { type: undefined as string | undefined },
	hooksEnabled: { type: false as boolean },
	subagentsEnabled: { type: false as boolean },
	enableParallelToolCalling: { type: false as boolean },
	backgroundEditEnabled: { type: false as boolean },

	// Model-specific settings
	hicapModelId: { type: undefined as string | undefined },
	// Plan mode configurations
	planModeApiProvider: { type: DEFAULT_API_PROVIDER as ApiProvider },
	planModeApiModelId: { type: undefined as string | undefined },
	planModeThinkingBudgetTokens: { type: ANTHROPIC_MIN_THINKING_BUDGET as number | undefined },
	geminiPlanModeThinkingLevel: { type: undefined as string | undefined },
	planModeReasoningEffort: { type: undefined as string | undefined },
	planModeVsCodeLmModelSelector: { type: undefined as LanguageModelChatSelector | undefined },
	planModeAwsBedrockCustomSelected: { type: undefined as boolean | undefined },
	planModeAwsBedrockCustomModelBaseId: { type: undefined as string | undefined },
	planModeOpenRouterModelId: { type: undefined as string | undefined },
	planModeOpenRouterModelInfo: { type: undefined as ModelInfo | undefined },
	planModeOpenAiModelId: { type: undefined as string | undefined },
	planModeOpenAiModelInfo: { type: undefined as OpenAiCompatibleModelInfo | undefined },
	planModeOllamaModelId: { type: undefined as string | undefined },
	planModeLmStudioModelId: { type: undefined as string | undefined },
	planModeLiteLlmModelId: { type: undefined as string | undefined },
	planModeLiteLlmModelInfo: { type: undefined as LiteLLMModelInfo | undefined },
	planModeRequestyModelId: { type: undefined as string | undefined },
	planModeRequestyModelInfo: { type: undefined as ModelInfo | undefined },
	planModeTogetherModelId: { type: undefined as string | undefined },
	planModeFireworksModelId: { type: undefined as string | undefined },
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
	planModeOcaModelId: { type: undefined as string | undefined },
	planModeOcaModelInfo: { type: undefined as OcaModelInfo | undefined },
	planModeHicapModelId: { type: undefined as string | undefined },
	planModeHicapModelInfo: { type: undefined as ModelInfo | undefined },
	planModeAihubmixModelId: { type: undefined as string | undefined },
	planModeAihubmixModelInfo: { type: undefined as OpenAiCompatibleModelInfo | undefined },
	planModeNousResearchModelId: { type: undefined as string | undefined },
	// Act mode configurations
	actModeApiProvider: { type: DEFAULT_API_PROVIDER as ApiProvider },
	actModeApiModelId: { type: undefined as string | undefined },
	actModeThinkingBudgetTokens: { type: ANTHROPIC_MIN_THINKING_BUDGET as number | undefined },
	geminiActModeThinkingLevel: { type: undefined as string | undefined },
	actModeReasoningEffort: { type: undefined as string | undefined },
	actModeVsCodeLmModelSelector: { type: undefined as LanguageModelChatSelector | undefined },
	actModeAwsBedrockCustomSelected: { type: undefined as boolean | undefined },
	actModeAwsBedrockCustomModelBaseId: { type: undefined as string | undefined },
	actModeOpenRouterModelId: { type: undefined as string | undefined },
	actModeOpenRouterModelInfo: { type: undefined as ModelInfo | undefined },
	actModeOpenAiModelId: { type: undefined as string | undefined },
	actModeOpenAiModelInfo: { type: undefined as OpenAiCompatibleModelInfo | undefined },
	actModeOllamaModelId: { type: undefined as string | undefined },
	actModeLmStudioModelId: { type: undefined as string | undefined },
	actModeLiteLlmModelId: { type: undefined as string | undefined },
	actModeLiteLlmModelInfo: { type: undefined as LiteLLMModelInfo | undefined },
	actModeRequestyModelId: { type: undefined as string | undefined },
	actModeRequestyModelInfo: { type: undefined as ModelInfo | undefined },
	actModeTogetherModelId: { type: undefined as string | undefined },
	actModeFireworksModelId: { type: undefined as string | undefined },
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
	actModeOcaModelId: { type: undefined as string | undefined },
	actModeOcaModelInfo: { type: undefined as OcaModelInfo | undefined },
	actModeHicapModelId: { type: undefined as string | undefined },
	actModeHicapModelInfo: { type: undefined as ModelInfo | undefined },
	actModeAihubmixModelId: { type: undefined as string | undefined },
	actModeAihubmixModelInfo: { type: undefined as OpenAiCompatibleModelInfo | undefined },
	actModeNousResearchModelId: { type: undefined as string | undefined },

	// OpenTelemetry configuration
	openTelemetryEnabled: { type: true as boolean },
	openTelemetryMetricsExporter: { type: undefined as string | undefined },
	openTelemetryLogsExporter: { type: undefined as string | undefined },
	openTelemetryOtlpProtocol: { type: "http/json" as string | undefined },
	openTelemetryOtlpEndpoint: { type: "http://localhost:4318" as string | undefined },
	openTelemetryOtlpMetricsProtocol: { type: undefined as string | undefined },
	openTelemetryOtlpMetricsEndpoint: { type: undefined as string | undefined },
	openTelemetryOtlpLogsProtocol: { type: undefined as string | undefined },
	openTelemetryOtlpLogsEndpoint: { type: undefined as string | undefined },
	openTelemetryMetricExportInterval: { type: 60000 as number | undefined },
	openTelemetryOtlpInsecure: { type: false as boolean | undefined },
	openTelemetryLogBatchSize: { type: 512 as number | undefined },
	openTelemetryLogBatchTimeout: { type: 5000 as number | undefined },
	openTelemetryLogMaxQueueSize: { type: 2048 as number | undefined },
}

// ============================================================================
// SECRET KEYS AND LOCAL STATE - Static definitions
// ============================================================================

export const ApiAuthSecretsKeys = [
	"cline:clineAccountId", // Auth_Provider:AccountId
	"remoteLiteLlmApiKey", // Remote_LiteLLM:ApiKey
	"ocaApiKey",
	"ocaRefreshToken",
	"mcpOAuthSecrets",
]
// Secret keys used in Api Configuration
export const ApiHandlerSecretsKeys = [
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
	"minimaxApiKey",
	"hicapApiKey",
	"aihubmixApiKey",
	"nousResearchApiKey",
] as const

export const SecretKeys = [...ApiHandlerSecretsKeys, ...ApiAuthSecretsKeys] as const

export const LocalStateKeys = [
	"localClineRulesToggles",
	"localCursorRulesToggles",
	"localWindsurfRulesToggles",
	"localAgentsRulesToggles",
	"workflowToggles",
] as const

// ============================================================================
// GENERATED TYPES - Auto-generated from property definitions
// ============================================================================

type ExtractType<T> = T extends { type: infer U } ? U : never
type BuildInterface<T extends Record<string, { type: any }>> = { [K in keyof T]: ExtractType<T[K]> }

export type GlobalState = BuildInterface<typeof GLOBAL_STATE_FIELDS>
export type Settings = BuildInterface<typeof SETTINGS_FIELDS>
type RemoteConfigExtra = BuildInterface<typeof REMOTE_CONFIG_EXTRA_FIELDS>
export type GlobalStateAndSettings = GlobalState & Settings
export type RemoteConfigFields = GlobalStateAndSettings & RemoteConfigExtra

// ============================================================================
// GENERATED DEFAULTS - Auto-generated from property definitions
// ============================================================================

function extractDefaults<T extends Record<string, any>>(props: T): Partial<BuildInterface<T>> {
	return Object.fromEntries(
		Object.entries(props)
			.map(([key, prop]) => [key, prop.type])
			.filter(([_, value]) => value !== undefined),
	) as Partial<BuildInterface<T>>
}

export const GLOBAL_STATE_DEFAULTS = extractDefaults(GLOBAL_STATE_FIELDS)
export const SETTINGS_DEFAULTS = extractDefaults(SETTINGS_FIELDS)

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

export const SETTINGS_TRANSFORMS = extractTransforms(SETTINGS_FIELDS)
export const ASYNC_PROPERTIES = extractMetadata({ ...GLOBAL_STATE_FIELDS, ...SETTINGS_FIELDS }, "isAsync")
export const COMPUTED_PROPERTIES = extractMetadata({ ...GLOBAL_STATE_FIELDS, ...SETTINGS_FIELDS }, "isComputed")

// ============================================================================
// GENERATED KEYS AND LOOKUP SETS - Auto-generated from property definitions
// ============================================================================

export const GlobalStateKeys = new Set(Object.keys(GLOBAL_STATE_FIELDS))
export const SettingsKeys = new Set(Object.keys(SETTINGS_FIELDS))

// ============================================================================
// TYPE ALIASES
// ============================================================================

export type Secrets = { [K in (typeof SecretKeys)[number]]: string | undefined }
export type ApiHandlerSecretKey = (typeof ApiHandlerSecretsKeys)[number]
export type ApiHandlerSecrets = { [K in ApiHandlerSecretKey]: string | undefined }
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
	return ((GLOBAL_STATE_DEFAULTS as any)[key] ?? (SETTINGS_DEFAULTS as any)[key]) as GlobalStateAndSettings[K] | undefined
}

export const hasTransform = (key: string): boolean => key in SETTINGS_TRANSFORMS
export const applyTransform = <T>(key: string, value: T): T => {
	const transform = SETTINGS_TRANSFORMS[key]
	return transform ? transform(value) : value
}

export const isAsyncProperty = (key: string): boolean => ASYNC_PROPERTIES.has(key)
export const isComputedProperty = (key: string): boolean => COMPUTED_PROPERTIES.has(key)
