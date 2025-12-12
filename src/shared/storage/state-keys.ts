import { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import { ApiProvider, ModelInfo, type OcaModelInfo } from "@shared/api"
import { BrowserSettings } from "@shared/BrowserSettings"
import { ClineRulesToggles } from "@shared/cline-rules"
import { DictationSettings } from "@shared/DictationSettings"
import { FocusChainSettings } from "@shared/FocusChainSettings"
import { HistoryItem } from "@shared/HistoryItem"
import { McpDisplayMode } from "@shared/McpDisplayMode"
import { WorkspaceRoot } from "@shared/multi-root/types"
import { GlobalInstructionsFile } from "@shared/remote-config/schema"
import { Mode, OpenaiReasoningEffort } from "@shared/storage/types"
import { TelemetrySetting } from "@shared/TelemetrySetting"
import { UserInfo } from "@shared/UserInfo"
import { LanguageModelChatSelector } from "vscode"
export type SecretKey = keyof Secrets

export type GlobalStateKey = keyof GlobalState

export type LocalStateKey = keyof LocalState

export type SettingsKey = keyof Settings

export type GlobalStateAndSettingsKey = keyof (GlobalState & Settings)

export type GlobalStateAndSettings = GlobalState & Settings

export interface RemoteConfigExtraFields {
	remoteConfiguredProviders: string[]
	allowedMCPServers: Array<{ id: string }>
	remoteGlobalRules?: GlobalInstructionsFile[]
	remoteGlobalWorkflows?: GlobalInstructionsFile[]
}

export type RemoteConfigFields = GlobalStateAndSettings & RemoteConfigExtraFields

export interface GlobalState {
	lastShownAnnouncementId: string | undefined
	taskHistory: HistoryItem[]
	userInfo: UserInfo | undefined
	favoritedModelIds: string[]
	mcpMarketplaceEnabled: boolean
	mcpResponsesCollapsed: boolean
	terminalReuseEnabled: boolean
	vscodeTerminalExecutionMode: "vscodeTerminal" | "backgroundExec"
	isNewUser: boolean
	welcomeViewCompleted: boolean | undefined
	mcpDisplayMode: McpDisplayMode
	// Multi-root workspace support
	workspaceRoots: WorkspaceRoot[] | undefined
	primaryRootIndex: number
	multiRootEnabled: boolean
	lastDismissedInfoBannerVersion: number
	lastDismissedModelBannerVersion: number
	lastDismissedCliBannerVersion: number
	nativeToolCallEnabled: boolean
	remoteRulesToggles: ClineRulesToggles
	remoteWorkflowToggles: ClineRulesToggles
	dismissedBanners: Array<{ bannerId: string; dismissedAt: number }>
}

export interface Settings {
	awsRegion: string | undefined
	awsUseCrossRegionInference: boolean | undefined
	awsUseGlobalInference: boolean | undefined
	awsBedrockUsePromptCache: boolean | undefined
	awsBedrockEndpoint: string | undefined
	awsProfile: string | undefined
	awsAuthentication: string | undefined
	awsUseProfile: boolean | undefined
	vertexProjectId: string | undefined
	vertexRegion: string | undefined
	requestyBaseUrl: string | undefined
	openAiBaseUrl: string | undefined
	openAiHeaders: Record<string, string>
	ollamaBaseUrl: string | undefined
	ollamaApiOptionsCtxNum: string | undefined
	lmStudioBaseUrl: string | undefined
	lmStudioMaxTokens: string | undefined
	anthropicBaseUrl: string | undefined
	geminiBaseUrl: string | undefined
	azureApiVersion: string | undefined
	openRouterProviderSorting: string | undefined
	autoApprovalSettings: AutoApprovalSettings
	globalClineRulesToggles: ClineRulesToggles
	globalWorkflowToggles: ClineRulesToggles
	browserSettings: BrowserSettings
	liteLlmBaseUrl: string | undefined
	liteLlmUsePromptCache: boolean | undefined
	fireworksModelMaxCompletionTokens: number | undefined
	fireworksModelMaxTokens: number | undefined
	qwenApiLine: string | undefined
	moonshotApiLine: string | undefined
	zaiApiLine: string | undefined
	telemetrySetting: TelemetrySetting
	asksageApiUrl: string | undefined
	planActSeparateModelsSetting: boolean
	enableCheckpointsSetting: boolean
	requestTimeoutMs: number | undefined
	shellIntegrationTimeout: number
	defaultTerminalProfile: string
	terminalOutputLineLimit: number
	maxConsecutiveMistakes: number
	subagentTerminalOutputLineLimit: number
	sapAiCoreTokenUrl: string | undefined
	sapAiCoreBaseUrl: string | undefined
	sapAiResourceGroup: string | undefined
	sapAiCoreUseOrchestrationMode: boolean | undefined
	claudeCodePath: string | undefined
	qwenCodeOauthPath: string | undefined
	strictPlanModeEnabled: boolean
	yoloModeToggled: boolean
	useAutoCondense: boolean
	clineWebToolsEnabled: boolean
	preferredLanguage: string
	openaiReasoningEffort: OpenaiReasoningEffort
	mode: Mode
	dictationSettings: DictationSettings
	focusChainSettings: FocusChainSettings
	customPrompt: "compact" | undefined
	difyBaseUrl: string | undefined
	autoCondenseThreshold: number | undefined // number from 0 to 1
	ocaBaseUrl: string | undefined
	minimaxApiLine: string | undefined
	ocaMode: string | undefined
	aihubmixBaseUrl: string | undefined
	aihubmixAppCode: string | undefined
	hooksEnabled: boolean
	subagentsEnabled: boolean
	enableParallelToolCalling: boolean
	hicapModelId: string | undefined

	// Plan mode configurations
	planModeApiProvider: ApiProvider
	planModeApiModelId: string | undefined
	planModeThinkingBudgetTokens: number | undefined
	geminiPlanModeThinkingLevel: string | undefined
	planModeReasoningEffort: string | undefined
	planModeVsCodeLmModelSelector: LanguageModelChatSelector | undefined
	planModeAwsBedrockCustomSelected: boolean | undefined
	planModeAwsBedrockCustomModelBaseId: string | undefined
	planModeOpenRouterModelId: string | undefined
	planModeOpenRouterModelInfo: ModelInfo | undefined
	planModeOpenAiModelId: string | undefined
	planModeOpenAiModelInfo: ModelInfo | undefined
	planModeOllamaModelId: string | undefined
	planModeLmStudioModelId: string | undefined
	planModeLiteLlmModelId: string | undefined
	planModeLiteLlmModelInfo: ModelInfo | undefined
	planModeRequestyModelId: string | undefined
	planModeRequestyModelInfo: ModelInfo | undefined
	planModeTogetherModelId: string | undefined
	planModeFireworksModelId: string | undefined
	planModeSapAiCoreModelId: string | undefined
	planModeSapAiCoreDeploymentId: string | undefined
	planModeGroqModelId: string | undefined
	planModeGroqModelInfo: ModelInfo | undefined
	planModeBasetenModelId: string | undefined
	planModeBasetenModelInfo: ModelInfo | undefined
	planModeHuggingFaceModelId: string | undefined
	planModeHuggingFaceModelInfo: ModelInfo | undefined
	planModeHuaweiCloudMaasModelId: string | undefined
	planModeHuaweiCloudMaasModelInfo: ModelInfo | undefined
	planModeOcaModelId: string | undefined
	planModeOcaModelInfo: OcaModelInfo | undefined
	planModeHicapModelId: string | undefined
	planModeHicapModelInfo: ModelInfo | undefined
	planModeAihubmixModelId: string | undefined
	planModeAihubmixModelInfo: ModelInfo | undefined
	planModeNousResearchModelId: string | undefined
	// Act mode configurations
	actModeApiProvider: ApiProvider
	actModeApiModelId: string | undefined
	actModeThinkingBudgetTokens: number | undefined
	geminiActModeThinkingLevel: string | undefined
	actModeReasoningEffort: string | undefined
	actModeVsCodeLmModelSelector: LanguageModelChatSelector | undefined
	actModeAwsBedrockCustomSelected: boolean | undefined
	actModeAwsBedrockCustomModelBaseId: string | undefined
	actModeOpenRouterModelId: string | undefined
	actModeOpenRouterModelInfo: ModelInfo | undefined
	actModeOpenAiModelId: string | undefined
	actModeOpenAiModelInfo: ModelInfo | undefined
	actModeOllamaModelId: string | undefined
	actModeLmStudioModelId: string | undefined
	actModeLiteLlmModelId: string | undefined
	actModeLiteLlmModelInfo: ModelInfo | undefined
	actModeRequestyModelId: string | undefined
	actModeRequestyModelInfo: ModelInfo | undefined
	actModeTogetherModelId: string | undefined
	actModeFireworksModelId: string | undefined
	actModeSapAiCoreModelId: string | undefined
	actModeSapAiCoreDeploymentId: string | undefined
	actModeGroqModelId: string | undefined
	actModeGroqModelInfo: ModelInfo | undefined
	actModeBasetenModelId: string | undefined
	actModeBasetenModelInfo: ModelInfo | undefined
	actModeHuggingFaceModelId: string | undefined
	actModeHuggingFaceModelInfo: ModelInfo | undefined
	actModeHuaweiCloudMaasModelId: string | undefined
	actModeHuaweiCloudMaasModelInfo: ModelInfo | undefined
	actModeOcaModelId: string | undefined
	actModeOcaModelInfo: OcaModelInfo | undefined
	actModeHicapModelId: string | undefined
	actModeHicapModelInfo: ModelInfo | undefined
	actModeAihubmixModelId: string | undefined
	actModeAihubmixModelInfo: ModelInfo | undefined
	actModeNousResearchModelId: string | undefined

	// OpenTelemetry configuration
	openTelemetryEnabled: boolean
	openTelemetryMetricsExporter: string | undefined
	openTelemetryLogsExporter: string | undefined
	openTelemetryOtlpProtocol: string
	openTelemetryOtlpEndpoint: string
	openTelemetryOtlpMetricsProtocol: string | undefined
	openTelemetryOtlpMetricsEndpoint: string | undefined
	openTelemetryOtlpLogsProtocol: string | undefined
	openTelemetryOtlpLogsEndpoint: string | undefined
	openTelemetryMetricExportInterval: number
	openTelemetryOtlpInsecure: boolean
	openTelemetryLogBatchSize: number
	openTelemetryLogBatchTimeout: number
	openTelemetryLogMaxQueueSize: number
}

export interface Secrets {
	apiKey: string | undefined
	clineAccountId: string | undefined
	"cline:clineAccountId": string | undefined // Auth_Provider:AccountId
	openRouterApiKey: string | undefined
	awsAccessKey: string | undefined
	awsSecretKey: string | undefined
	awsSessionToken: string | undefined
	awsBedrockApiKey: string | undefined
	openAiApiKey: string | undefined
	geminiApiKey: string | undefined
	openAiNativeApiKey: string | undefined
	ollamaApiKey: string | undefined
	deepSeekApiKey: string | undefined
	requestyApiKey: string | undefined
	togetherApiKey: string | undefined
	fireworksApiKey: string | undefined
	qwenApiKey: string | undefined
	doubaoApiKey: string | undefined
	mistralApiKey: string | undefined
	liteLlmApiKey: string | undefined
	remoteLiteLlmApiKey: string | undefined
	authNonce: string | undefined
	asksageApiKey: string | undefined
	xaiApiKey: string | undefined
	moonshotApiKey: string | undefined
	zaiApiKey: string | undefined
	huggingFaceApiKey: string | undefined
	nebiusApiKey: string | undefined
	sambanovaApiKey: string | undefined
	cerebrasApiKey: string | undefined
	sapAiCoreClientId: string | undefined
	sapAiCoreClientSecret: string | undefined
	groqApiKey: string | undefined
	huaweiCloudMaasApiKey: string | undefined
	basetenApiKey: string | undefined
	vercelAiGatewayApiKey: string | undefined
	difyApiKey: string | undefined
	ocaApiKey: string | undefined
	ocaRefreshToken: string | undefined
	minimaxApiKey: string | undefined
	hicapApiKey: string | undefined
	aihubmixApiKey: string | undefined
	mcpOAuthSecrets: string | undefined
	nousResearchApiKey: string | undefined
}

export interface LocalState {
	localClineRulesToggles: ClineRulesToggles
	localCursorRulesToggles: ClineRulesToggles
	localWindsurfRulesToggles: ClineRulesToggles
	localAgentsRulesToggles: ClineRulesToggles
	workflowToggles: ClineRulesToggles
}
