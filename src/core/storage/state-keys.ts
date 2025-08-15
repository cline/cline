import { ApiProvider, BedrockModelId, ModelInfo } from "@shared/api"
import { LanguageModelChatSelector } from "vscode"
import { ClineRulesToggles } from "@/shared/cline-rules"
import { McpDisplayMode } from "@/shared/McpDisplayMode"
import { TelemetrySetting } from "@/shared/TelemetrySetting"
import { UserInfo } from "@/shared/UserInfo"
import { BrowserSettings } from "@/shared/BrowserSettings"
import { HistoryItem } from "@/shared/HistoryItem"
import { AutoApprovalSettings } from "@/shared/AutoApprovalSettings"
import { Mode, OpenaiReasoningEffort } from "@/shared/storage/types"
import { McpMarketplaceCatalog } from "@/shared/mcp"
import { FocusChainSettings } from "@shared/FocusChainSettings"

export type SecretKey =
	| "apiKey"
	| "clineAccountId"
	| "openRouterApiKey"
	| "awsAccessKey"
	| "awsSecretKey"
	| "awsSessionToken"
	| "awsBedrockApiKey"
	| "openAiApiKey"
	| "ollamaApiKey"
	| "geminiApiKey"
	| "openAiNativeApiKey"
	| "deepSeekApiKey"
	| "requestyApiKey"
	| "togetherApiKey"
	| "fireworksApiKey"
	| "qwenApiKey"
	| "doubaoApiKey"
	| "mistralApiKey"
	| "liteLlmApiKey"
	| "authNonce"
	| "asksageApiKey"
	| "xaiApiKey"
	| "moonshotApiKey"
	| "huggingFaceApiKey"
	| "nebiusApiKey"
	| "sambanovaApiKey"
	| "cerebrasApiKey"
	| "sapAiCoreClientId"
	| "sapAiCoreClientSecret"
	| "groqApiKey"
	| "huaweiCloudMaasApiKey"
	| "basetenApiKey"

export type GlobalStateKey =
	| "awsRegion"
	| "awsUseCrossRegionInference"
	| "awsBedrockUsePromptCache"
	| "awsBedrockEndpoint"
	| "awsProfile"
	| "awsBedrockApiKey"
	| "awsAuthentication"
	| "awsUseProfile"
	| "vertexProjectId"
	| "vertexRegion"
	| "lastShownAnnouncementId"
	| "taskHistory"
	| "requestyBaseUrl"
	| "openAiBaseUrl"
	| "openAiHeaders"
	| "ollamaBaseUrl"
	| "ollamaApiOptionsCtxNum"
	| "lmStudioBaseUrl"
	| "anthropicBaseUrl"
	| "geminiBaseUrl"
	| "azureApiVersion"
	| "openRouterProviderSorting"
	| "autoApprovalSettings"
	| "globalClineRulesToggles"
	| "globalWorkflowToggles"
	| "browserSettings"
	| "userInfo"
	| "liteLlmBaseUrl"
	| "liteLlmUsePromptCache"
	| "fireworksModelMaxCompletionTokens"
	| "fireworksModelMaxTokens"
	| "qwenApiLine"
	| "moonshotApiLine"
	| "mcpMarketplaceCatalog"
	| "telemetrySetting"
	| "asksageApiUrl"
	| "planActSeparateModelsSetting"
	| "enableCheckpointsSetting"
	| "mcpMarketplaceEnabled"
	| "favoritedModelIds"
	| "requestTimeoutMs"
	| "shellIntegrationTimeout"
	| "mcpResponsesCollapsed"
	| "terminalReuseEnabled"
	| "defaultTerminalProfile"
	| "isNewUser"
	| "welcomeViewCompleted"
	| "terminalOutputLineLimit"
	| "mcpDisplayMode"
	| "sapAiCoreTokenUrl"
	| "sapAiCoreBaseUrl"
	| "sapAiResourceGroup"
	| "claudeCodePath"
	| "strictPlanModeEnabled"
	| "focusChainSettings"
	| "focusChainFeatureFlagEnabled"
	// Settings around plan/act and ephemeral model configuration
	| "preferredLanguage"
	| "openaiReasoningEffort"
	| "mode"
	// Plan mode configurations
	| "planModeApiProvider"
	| "planModeApiModelId"
	| "planModeThinkingBudgetTokens"
	| "planModeReasoningEffort"
	| "planModeVsCodeLmModelSelector"
	| "planModeAwsBedrockCustomSelected"
	| "planModeAwsBedrockCustomModelBaseId"
	| "planModeOpenRouterModelId"
	| "planModeOpenRouterModelInfo"
	| "planModeOpenAiModelId"
	| "planModeOpenAiModelInfo"
	| "planModeOllamaModelId"
	| "planModeLmStudioModelId"
	| "planModeLiteLlmModelId"
	| "planModeLiteLlmModelInfo"
	| "planModeRequestyModelId"
	| "planModeRequestyModelInfo"
	| "planModeTogetherModelId"
	| "planModeFireworksModelId"
	| "planModeSapAiCoreModelId"
	| "planModeGroqModelId"
	| "planModeGroqModelInfo"
	| "planModeBasetenModelId"
	| "planModeBasetenModelInfo"
	| "planModeHuggingFaceModelId"
	| "planModeHuggingFaceModelInfo"
	| "planModeHuaweiCloudMaasModelId"
	| "planModeHuaweiCloudMaasModelInfo"
	// Act mode configurations
	| "actModeApiProvider"
	| "actModeApiModelId"
	| "actModeThinkingBudgetTokens"
	| "actModeReasoningEffort"
	| "actModeVsCodeLmModelSelector"
	| "actModeAwsBedrockCustomSelected"
	| "actModeAwsBedrockCustomModelBaseId"
	| "actModeOpenRouterModelId"
	| "actModeOpenRouterModelInfo"
	| "actModeOpenAiModelId"
	| "actModeOpenAiModelInfo"
	| "actModeOllamaModelId"
	| "actModeLmStudioModelId"
	| "actModeLiteLlmModelId"
	| "actModeLiteLlmModelInfo"
	| "actModeRequestyModelId"
	| "actModeRequestyModelInfo"
	| "actModeTogetherModelId"
	| "actModeFireworksModelId"
	| "actModeSapAiCoreModelId"
	| "actModeGroqModelId"
	| "actModeGroqModelInfo"
	| "actModeBasetenModelId"
	| "actModeBasetenModelInfo"
	| "actModeHuggingFaceModelId"
	| "actModeHuggingFaceModelInfo"
	| "actModeHuaweiCloudMaasModelId"
	| "actModeHuaweiCloudMaasModelInfo"

export type LocalStateKey = "localClineRulesToggles" | "localCursorRulesToggles" | "localWindsurfRulesToggles" | "workflowToggles"

export interface GlobalState {
	awsRegion: string | undefined
	awsUseCrossRegionInference: boolean | undefined
	awsBedrockUsePromptCache: boolean | undefined
	awsBedrockEndpoint: string | undefined
	awsProfile: string | undefined
	awsBedrockApiKey: string | undefined
	awsAuthentication: string | undefined
	awsUseProfile: boolean | undefined
	vertexProjectId: string | undefined
	vertexRegion: string | undefined
	lastShownAnnouncementId: string | undefined
	taskHistory: HistoryItem[]
	requestyBaseUrl: string | undefined
	openAiBaseUrl: string | undefined
	openAiHeaders: Record<string, string>
	ollamaBaseUrl: string | undefined
	ollamaApiOptionsCtxNum: string | undefined
	lmStudioBaseUrl: string | undefined
	anthropicBaseUrl: string | undefined
	geminiBaseUrl: string | undefined
	azureApiVersion: string | undefined
	openRouterProviderSorting: string | undefined
	autoApprovalSettings: AutoApprovalSettings
	globalClineRulesToggles: ClineRulesToggles
	globalWorkflowToggles: ClineRulesToggles
	browserSettings: BrowserSettings
	userInfo: UserInfo | undefined
	liteLlmBaseUrl: string | undefined
	liteLlmUsePromptCache: boolean | undefined
	fireworksModelMaxCompletionTokens: number | undefined
	fireworksModelMaxTokens: number | undefined
	qwenApiLine: string | undefined
	moonshotApiLine: string | undefined
	mcpMarketplaceCatalog: McpMarketplaceCatalog | undefined
	telemetrySetting: TelemetrySetting
	asksageApiUrl: string | undefined
	planActSeparateModelsSetting: boolean
	enableCheckpointsSetting: boolean
	mcpMarketplaceEnabled: boolean
	favoritedModelIds: string[] | undefined
	requestTimeoutMs: number | undefined
	shellIntegrationTimeout: number
	mcpResponsesCollapsed: boolean
	terminalReuseEnabled: boolean
	defaultTerminalProfile: string
	isNewUser: boolean
	welcomeViewCompleted: boolean | undefined
	terminalOutputLineLimit: number
	mcpDisplayMode: McpDisplayMode
	sapAiCoreTokenUrl: string | undefined
	sapAiCoreBaseUrl: string | undefined
	sapAiResourceGroup: string | undefined
	claudeCodePath: string | undefined
	strictPlanModeEnabled: boolean
	preferredLanguage: string
	openaiReasoningEffort: OpenaiReasoningEffort
	mode: Mode
	focusChainSettings: FocusChainSettings
	focusChainFeatureFlagEnabled: boolean
	// Plan mode configurations
	planModeApiProvider: ApiProvider
	planModeApiModelId: string | undefined
	planModeThinkingBudgetTokens: number | undefined
	planModeReasoningEffort: string | undefined
	planModeVsCodeLmModelSelector: LanguageModelChatSelector | undefined
	planModeAwsBedrockCustomSelected: boolean | undefined
	planModeAwsBedrockCustomModelBaseId: BedrockModelId | undefined
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
	planModeGroqModelId: string | undefined
	planModeGroqModelInfo: ModelInfo | undefined
	planModeBasetenModelId: string | undefined
	planModeBasetenModelInfo: ModelInfo | undefined
	planModeHuggingFaceModelId: string | undefined
	planModeHuggingFaceModelInfo: ModelInfo | undefined
	planModeHuaweiCloudMaasModelId: string | undefined
	planModeHuaweiCloudMaasModelInfo: ModelInfo | undefined
	// Act mode configurations
	actModeApiProvider: ApiProvider
	actModeApiModelId: string | undefined
	actModeThinkingBudgetTokens: number | undefined
	actModeReasoningEffort: string | undefined
	actModeVsCodeLmModelSelector: LanguageModelChatSelector | undefined
	actModeAwsBedrockCustomSelected: boolean | undefined
	actModeAwsBedrockCustomModelBaseId: BedrockModelId | undefined
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
	actModeGroqModelId: string | undefined
	actModeGroqModelInfo: ModelInfo | undefined
	actModeBasetenModelId: string | undefined
	actModeBasetenModelInfo: ModelInfo | undefined
	actModeHuggingFaceModelId: string | undefined
	actModeHuggingFaceModelInfo: ModelInfo | undefined
	actModeHuaweiCloudMaasModelId: string | undefined
	actModeHuaweiCloudMaasModelInfo: ModelInfo | undefined
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
	huggingFaceApiKey: string | undefined
	nebiusApiKey: string | undefined
	sambanovaApiKey: string | undefined
	cerebrasApiKey: string | undefined
	sapAiCoreClientId: string | undefined
	sapAiCoreClientSecret: string | undefined
	groqApiKey: string | undefined
	huaweiCloudMaasApiKey: string | undefined
	basetenApiKey: string | undefined
}

export interface LocalState {
	localClineRulesToggles: ClineRulesToggles
	localCursorRulesToggles: ClineRulesToggles
	localWindsurfRulesToggles: ClineRulesToggles
	workflowToggles: ClineRulesToggles
}
