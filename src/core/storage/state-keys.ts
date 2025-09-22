import { ApiProvider, ModelInfo, type OcaModelInfo } from "@shared/api"
import { FocusChainSettings } from "@shared/FocusChainSettings"
import { LanguageModelChatSelector } from "vscode"
import { WorkspaceRoot } from "@/core/workspace/WorkspaceRoot"
import { AutoApprovalSettings } from "@/shared/AutoApprovalSettings"
import { BrowserSettings } from "@/shared/BrowserSettings"
import { ClineRulesToggles } from "@/shared/cline-rules"
import { HistoryItem } from "@/shared/HistoryItem"
import { McpDisplayMode } from "@/shared/McpDisplayMode"
import { McpMarketplaceCatalog } from "@/shared/mcp"
import { Mode, OpenaiReasoningEffort } from "@/shared/storage/types"
import { TelemetrySetting } from "@/shared/TelemetrySetting"
import { UserInfo } from "@/shared/UserInfo"

export type SecretKey = keyof Secrets

export type GlobalStateKey = keyof GlobalState

export type LocalStateKey = keyof LocalState

export type SettingsKey = keyof Settings

export type GlobalStateAndSettingsKey = keyof (GlobalState & Settings)

export type GlobalStateAndSettings = GlobalState & Settings

export interface GlobalState {
	lastShownAnnouncementId: string | undefined
	taskHistory: HistoryItem[]
	userInfo: UserInfo | undefined
	mcpMarketplaceCatalog: McpMarketplaceCatalog | undefined
	favoritedModelIds: string[]
	mcpMarketplaceEnabled: boolean
	mcpResponsesCollapsed: boolean
	terminalReuseEnabled: boolean
	isNewUser: boolean
	welcomeViewCompleted: boolean | undefined
	mcpDisplayMode: McpDisplayMode
	// Multi-root workspace support
	workspaceRoots: WorkspaceRoot[] | undefined
	primaryRootIndex: number
	multiRootEnabled: boolean
}

export interface Settings {
	awsRegion: string | undefined
	awsUseCrossRegionInference: boolean | undefined
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
	sapAiCoreTokenUrl: string | undefined
	sapAiCoreBaseUrl: string | undefined
	sapAiResourceGroup: string | undefined
	sapAiCoreUseOrchestrationMode: boolean | undefined
	claudeCodePath: string | undefined
	qwenCodeOauthPath: string | undefined
	strictPlanModeEnabled: boolean
	yoloModeToggled: boolean
	useAutoCondense: boolean
	preferredLanguage: string
	openaiReasoningEffort: OpenaiReasoningEffort
	mode: Mode
	focusChainSettings: FocusChainSettings
	customPrompt: "compact" | undefined
	difyBaseUrl: string | undefined
	ocaBaseUrl: string | undefined

	// Plan mode configurations
	planModeApiProvider: ApiProvider
	planModeApiModelId: string | undefined
	planModeThinkingBudgetTokens: number | undefined
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
	// Act mode configurations
	actModeApiProvider: ApiProvider
	actModeApiModelId: string | undefined
	actModeThinkingBudgetTokens: number | undefined
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
	planModeVercelAiGatewayModelId: string | undefined
	planModeVercelAiGatewayModelInfo: ModelInfo | undefined
	actModeVercelAiGatewayModelId: string | undefined
	actModeVercelAiGatewayModelInfo: ModelInfo | undefined
	actModeOcaModelId: string | undefined
	actModeOcaModelInfo: OcaModelInfo | undefined
}

export interface Secrets {
	apiKey: string | undefined
	clineAccountId: string | undefined
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
}

export interface LocalState {
	localClineRulesToggles: ClineRulesToggles
	localCursorRulesToggles: ClineRulesToggles
	localWindsurfRulesToggles: ClineRulesToggles
	workflowToggles: ClineRulesToggles
}
