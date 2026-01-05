import { ANTHROPIC_MIN_THINKING_BUDGET, ApiProvider, fireworksDefaultModelId, type OcaModelInfo } from "@shared/api"
import { GlobalStateAndSettings, LocalState, SecretKey, Secrets } from "@shared/storage/state-keys"
import { Controller } from "@/core/controller"
import { getHooksEnabledSafe } from "@/core/hooks/hooks-utils"
import { HostProvider } from "@/hosts/host-provider"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@/shared/AutoApprovalSettings"
import { DEFAULT_BROWSER_SETTINGS } from "@/shared/BrowserSettings"
import { ClineRulesToggles } from "@/shared/cline-rules"
import { DEFAULT_DICTATION_SETTINGS, DictationSettings } from "@/shared/DictationSettings"
import { DEFAULT_FOCUS_CHAIN_SETTINGS } from "@/shared/FocusChainSettings"
import { DEFAULT_MCP_DISPLAY_MODE } from "@/shared/McpDisplayMode"
import { OpenaiReasoningEffort } from "@/shared/storage/types"
import { readTaskHistoryFromState } from "../disk"
export async function readSecretsFromDisk(): Promise<Secrets> {
	const [
		apiKey,
		openRouterApiKey,
		firebaseClineAccountId,
		clineAccountId,
		awsAccessKey,
		awsSecretKey,
		awsSessionToken,
		awsBedrockApiKey,
		openAiApiKey,
		geminiApiKey,
		openAiNativeApiKey,
		deepSeekApiKey,
		requestyApiKey,
		togetherApiKey,
		qwenApiKey,
		doubaoApiKey,
		mistralApiKey,
		fireworksApiKey,
		liteLlmApiKey,
		remoteLiteLlmApiKey,
		asksageApiKey,
		xaiApiKey,
		sambanovaApiKey,
		cerebrasApiKey,
		groqApiKey,
		moonshotApiKey,
		nebiusApiKey,
		huggingFaceApiKey,
		sapAiCoreClientId,
		sapAiCoreClientSecret,
		huaweiCloudMaasApiKey,
		basetenApiKey,
		zaiApiKey,
		ollamaApiKey,
		vercelAiGatewayApiKey,
		difyApiKey,
		authNonce,
		ocaApiKey,
		ocaRefreshToken,
		minimaxApiKey,
		hicapApiKey,
		aihubmixApiKey,
		mcpOAuthSecrets,
		nousResearchApiKey,
	] = await Promise.all([
		HostProvider.secrets.get("apiKey") as Promise<Secrets["apiKey"]>,
		HostProvider.secrets.get("openRouterApiKey") as Promise<Secrets["openRouterApiKey"]>,
		HostProvider.secrets.get("clineAccountId") as Promise<Secrets["clineAccountId"]>,
		HostProvider.secrets.get("cline:clineAccountId") as Promise<Secrets["cline:clineAccountId"]>,
		HostProvider.secrets.get("awsAccessKey") as Promise<Secrets["awsAccessKey"]>,
		HostProvider.secrets.get("awsSecretKey") as Promise<Secrets["awsSecretKey"]>,
		HostProvider.secrets.get("awsSessionToken") as Promise<Secrets["awsSessionToken"]>,
		HostProvider.secrets.get("awsBedrockApiKey") as Promise<Secrets["awsBedrockApiKey"]>,
		HostProvider.secrets.get("openAiApiKey") as Promise<Secrets["openAiApiKey"]>,
		HostProvider.secrets.get("geminiApiKey") as Promise<Secrets["geminiApiKey"]>,
		HostProvider.secrets.get("openAiNativeApiKey") as Promise<Secrets["openAiNativeApiKey"]>,
		HostProvider.secrets.get("deepSeekApiKey") as Promise<Secrets["deepSeekApiKey"]>,
		HostProvider.secrets.get("requestyApiKey") as Promise<Secrets["requestyApiKey"]>,
		HostProvider.secrets.get("togetherApiKey") as Promise<Secrets["togetherApiKey"]>,
		HostProvider.secrets.get("qwenApiKey") as Promise<Secrets["qwenApiKey"]>,
		HostProvider.secrets.get("doubaoApiKey") as Promise<Secrets["doubaoApiKey"]>,
		HostProvider.secrets.get("mistralApiKey") as Promise<Secrets["mistralApiKey"]>,
		HostProvider.secrets.get("fireworksApiKey") as Promise<Secrets["fireworksApiKey"]>,
		HostProvider.secrets.get("liteLlmApiKey") as Promise<Secrets["liteLlmApiKey"]>,
		HostProvider.secrets.get("remoteLiteLlmApiKey") as Promise<Secrets["remoteLiteLlmApiKey"]>,
		HostProvider.secrets.get("asksageApiKey") as Promise<Secrets["asksageApiKey"]>,
		HostProvider.secrets.get("xaiApiKey") as Promise<Secrets["xaiApiKey"]>,
		HostProvider.secrets.get("sambanovaApiKey") as Promise<Secrets["sambanovaApiKey"]>,
		HostProvider.secrets.get("cerebrasApiKey") as Promise<Secrets["cerebrasApiKey"]>,
		HostProvider.secrets.get("groqApiKey") as Promise<Secrets["groqApiKey"]>,
		HostProvider.secrets.get("moonshotApiKey") as Promise<Secrets["moonshotApiKey"]>,
		HostProvider.secrets.get("nebiusApiKey") as Promise<Secrets["nebiusApiKey"]>,
		HostProvider.secrets.get("huggingFaceApiKey") as Promise<Secrets["huggingFaceApiKey"]>,
		HostProvider.secrets.get("sapAiCoreClientId") as Promise<Secrets["sapAiCoreClientId"]>,
		HostProvider.secrets.get("sapAiCoreClientSecret") as Promise<Secrets["sapAiCoreClientSecret"]>,
		HostProvider.secrets.get("huaweiCloudMaasApiKey") as Promise<Secrets["huaweiCloudMaasApiKey"]>,
		HostProvider.secrets.get("basetenApiKey") as Promise<Secrets["basetenApiKey"]>,
		HostProvider.secrets.get("zaiApiKey") as Promise<Secrets["zaiApiKey"]>,
		HostProvider.secrets.get("ollamaApiKey") as Promise<Secrets["ollamaApiKey"]>,
		HostProvider.secrets.get("vercelAiGatewayApiKey") as Promise<Secrets["vercelAiGatewayApiKey"]>,
		HostProvider.secrets.get("difyApiKey") as Promise<Secrets["difyApiKey"]>,
		HostProvider.secrets.get("authNonce") as Promise<Secrets["authNonce"]>,
		HostProvider.secrets.get("ocaApiKey") as Promise<string | undefined>,
		HostProvider.secrets.get("ocaRefreshToken") as Promise<string | undefined>,
		HostProvider.secrets.get("minimaxApiKey") as Promise<Secrets["minimaxApiKey"]>,
		HostProvider.secrets.get("hicapApiKey") as Promise<Secrets["hicapApiKey"]>,
		HostProvider.secrets.get("aihubmixApiKey") as Promise<Secrets["aihubmixApiKey"]>,
		HostProvider.secrets.get("mcpOAuthSecrets") as Promise<Secrets["mcpOAuthSecrets"]>,
		HostProvider.secrets.get("nousResearchApiKey") as Promise<Secrets["nousResearchApiKey"]>,
	])

	return {
		authNonce,
		apiKey,
		openRouterApiKey,
		clineAccountId: firebaseClineAccountId,
		"cline:clineAccountId": clineAccountId,
		huggingFaceApiKey,
		huaweiCloudMaasApiKey,
		basetenApiKey,
		zaiApiKey,
		ollamaApiKey,
		vercelAiGatewayApiKey,
		difyApiKey,
		sapAiCoreClientId,
		sapAiCoreClientSecret,
		xaiApiKey,
		sambanovaApiKey,
		cerebrasApiKey,
		groqApiKey,
		moonshotApiKey,
		nebiusApiKey,
		asksageApiKey,
		fireworksApiKey,
		liteLlmApiKey,
		remoteLiteLlmApiKey,
		doubaoApiKey,
		mistralApiKey,
		openAiNativeApiKey,
		deepSeekApiKey,
		requestyApiKey,
		togetherApiKey,
		qwenApiKey,
		geminiApiKey,
		openAiApiKey,
		awsBedrockApiKey,
		awsAccessKey,
		awsSecretKey,
		awsSessionToken,
		ocaApiKey,
		ocaRefreshToken,
		minimaxApiKey,
		hicapApiKey,
		aihubmixApiKey,
		mcpOAuthSecrets,
		nousResearchApiKey,
	}
}

export async function readWorkspaceStateFromDisk(): Promise<LocalState> {
	const localClineRulesToggles = await HostProvider.workspaceSettings.get<ClineRulesToggles>("localClineRulesToggles")
	const localWindsurfRulesToggles = await HostProvider.workspaceSettings.get<ClineRulesToggles>("localWindsurfRulesToggles")
	const localCursorRulesToggles = await HostProvider.workspaceSettings.get<ClineRulesToggles>("localCursorRulesToggles")
	const localAgentsRulesToggles = await HostProvider.workspaceSettings.get<ClineRulesToggles>("localAgentsRulesToggles")
	const localWorkflowToggles = await HostProvider.workspaceSettings.get<ClineRulesToggles>("workflowToggles")

	return {
		localClineRulesToggles: localClineRulesToggles || {},
		localWindsurfRulesToggles: localWindsurfRulesToggles || {},
		localCursorRulesToggles: localCursorRulesToggles || {},
		localAgentsRulesToggles: localAgentsRulesToggles || {},
		workflowToggles: localWorkflowToggles || {},
	}
}

export async function readGlobalStateFromDisk(): Promise<GlobalStateAndSettings> {
	try {
		// Get all global state values
		const strictPlanModeEnabled =
			HostProvider.globalSettings.get<GlobalStateAndSettings["strictPlanModeEnabled"]>("strictPlanModeEnabled")
		const yoloModeToggled = HostProvider.globalSettings.get<GlobalStateAndSettings["yoloModeToggled"]>("yoloModeToggled")
		const useAutoCondense = HostProvider.globalSettings.get<GlobalStateAndSettings["useAutoCondense"]>("useAutoCondense")
		const clineWebToolsEnabled =
			HostProvider.globalSettings.get<GlobalStateAndSettings["clineWebToolsEnabled"]>("clineWebToolsEnabled")
		const isNewUser = HostProvider.globalSettings.get<GlobalStateAndSettings["isNewUser"]>("isNewUser")
		const welcomeViewCompleted =
			HostProvider.globalSettings.get<GlobalStateAndSettings["welcomeViewCompleted"]>("welcomeViewCompleted")
		const awsRegion = HostProvider.globalSettings.get<GlobalStateAndSettings["awsRegion"]>("awsRegion")
		const awsUseCrossRegionInference =
			HostProvider.globalSettings.get<GlobalStateAndSettings["awsUseCrossRegionInference"]>("awsUseCrossRegionInference")
		const awsUseGlobalInference =
			HostProvider.globalSettings.get<GlobalStateAndSettings["awsUseGlobalInference"]>("awsUseGlobalInference")
		const awsBedrockUsePromptCache =
			HostProvider.globalSettings.get<GlobalStateAndSettings["awsBedrockUsePromptCache"]>("awsBedrockUsePromptCache")
		const awsBedrockEndpoint =
			HostProvider.globalSettings.get<GlobalStateAndSettings["awsBedrockEndpoint"]>("awsBedrockEndpoint")
		const awsProfile = HostProvider.globalSettings.get<GlobalStateAndSettings["awsProfile"]>("awsProfile")
		const awsUseProfile = HostProvider.globalSettings.get<GlobalStateAndSettings["awsUseProfile"]>("awsUseProfile")
		const awsAuthentication =
			HostProvider.globalSettings.get<GlobalStateAndSettings["awsAuthentication"]>("awsAuthentication")
		const vertexProjectId = HostProvider.globalSettings.get<GlobalStateAndSettings["vertexProjectId"]>("vertexProjectId")
		const vertexRegion = HostProvider.globalSettings.get<GlobalStateAndSettings["vertexRegion"]>("vertexRegion")
		const openAiBaseUrl = HostProvider.globalSettings.get<GlobalStateAndSettings["openAiBaseUrl"]>("openAiBaseUrl")
		const requestyBaseUrl = HostProvider.globalSettings.get<GlobalStateAndSettings["requestyBaseUrl"]>("requestyBaseUrl")
		const openAiHeaders = HostProvider.globalSettings.get<GlobalStateAndSettings["openAiHeaders"]>("openAiHeaders")
		const ollamaBaseUrl = HostProvider.globalSettings.get<GlobalStateAndSettings["ollamaBaseUrl"]>("ollamaBaseUrl")
		const ollamaApiOptionsCtxNum =
			HostProvider.globalSettings.get<GlobalStateAndSettings["ollamaApiOptionsCtxNum"]>("ollamaApiOptionsCtxNum")
		const lmStudioBaseUrl = HostProvider.globalSettings.get<GlobalStateAndSettings["lmStudioBaseUrl"]>("lmStudioBaseUrl")
		const lmStudioMaxTokens =
			HostProvider.globalSettings.get<GlobalStateAndSettings["lmStudioMaxTokens"]>("lmStudioMaxTokens")
		const anthropicBaseUrl = HostProvider.globalSettings.get<GlobalStateAndSettings["anthropicBaseUrl"]>("anthropicBaseUrl")
		const geminiBaseUrl = HostProvider.globalSettings.get<GlobalStateAndSettings["geminiBaseUrl"]>("geminiBaseUrl")
		const azureApiVersion = HostProvider.globalSettings.get<GlobalStateAndSettings["azureApiVersion"]>("azureApiVersion")
		const openRouterProviderSorting =
			HostProvider.globalSettings.get<GlobalStateAndSettings["openRouterProviderSorting"]>("openRouterProviderSorting")
		const lastShownAnnouncementId =
			HostProvider.globalSettings.get<GlobalStateAndSettings["lastShownAnnouncementId"]>("lastShownAnnouncementId")
		const autoApprovalSettings =
			HostProvider.globalSettings.get<GlobalStateAndSettings["autoApprovalSettings"]>("autoApprovalSettings")
		const browserSettings = HostProvider.globalSettings.get<GlobalStateAndSettings["browserSettings"]>("browserSettings")
		const liteLlmBaseUrl = HostProvider.globalSettings.get<GlobalStateAndSettings["liteLlmBaseUrl"]>("liteLlmBaseUrl")
		const liteLlmUsePromptCache =
			HostProvider.globalSettings.get<GlobalStateAndSettings["liteLlmUsePromptCache"]>("liteLlmUsePromptCache")
		const fireworksModelMaxCompletionTokens = HostProvider.globalSettings.get<
			GlobalStateAndSettings["fireworksModelMaxCompletionTokens"]
		>("fireworksModelMaxCompletionTokens")
		const fireworksModelMaxTokens =
			HostProvider.globalSettings.get<GlobalStateAndSettings["fireworksModelMaxTokens"]>("fireworksModelMaxTokens")
		const userInfo = HostProvider.globalSettings.get<GlobalStateAndSettings["userInfo"]>("userInfo")
		const qwenApiLine = HostProvider.globalSettings.get<GlobalStateAndSettings["qwenApiLine"]>("qwenApiLine")
		const moonshotApiLine = HostProvider.globalSettings.get<GlobalStateAndSettings["moonshotApiLine"]>("moonshotApiLine")
		const zaiApiLine = HostProvider.globalSettings.get<GlobalStateAndSettings["zaiApiLine"]>("zaiApiLine")
		const minimaxApiLine = HostProvider.globalSettings.get<GlobalStateAndSettings["minimaxApiLine"]>("minimaxApiLine")
		const telemetrySetting = HostProvider.globalSettings.get<GlobalStateAndSettings["telemetrySetting"]>("telemetrySetting")
		const asksageApiUrl = HostProvider.globalSettings.get<GlobalStateAndSettings["asksageApiUrl"]>("asksageApiUrl")
		const planActSeparateModelsSettingRaw =
			HostProvider.globalSettings.get<GlobalStateAndSettings["planActSeparateModelsSetting"]>(
				"planActSeparateModelsSetting",
			)
		const favoritedModelIds =
			HostProvider.globalSettings.get<GlobalStateAndSettings["favoritedModelIds"]>("favoritedModelIds")
		const globalClineRulesToggles =
			HostProvider.globalSettings.get<GlobalStateAndSettings["globalClineRulesToggles"]>("globalClineRulesToggles")
		const requestTimeoutMs = HostProvider.globalSettings.get<GlobalStateAndSettings["requestTimeoutMs"]>("requestTimeoutMs")
		const shellIntegrationTimeout =
			HostProvider.globalSettings.get<GlobalStateAndSettings["shellIntegrationTimeout"]>("shellIntegrationTimeout")
		const enableCheckpointsSettingRaw =
			HostProvider.globalSettings.get<GlobalStateAndSettings["enableCheckpointsSetting"]>("enableCheckpointsSetting")
		const mcpMarketplaceEnabledRaw =
			HostProvider.globalSettings.get<GlobalStateAndSettings["mcpMarketplaceEnabled"]>("mcpMarketplaceEnabled")
		const mcpDisplayMode = HostProvider.globalSettings.get<GlobalStateAndSettings["mcpDisplayMode"]>("mcpDisplayMode")
		const mcpResponsesCollapsedRaw =
			HostProvider.globalSettings.get<GlobalStateAndSettings["mcpResponsesCollapsed"]>("mcpResponsesCollapsed")
		const globalWorkflowToggles =
			HostProvider.globalSettings.get<GlobalStateAndSettings["globalWorkflowToggles"]>("globalWorkflowToggles")
		const terminalReuseEnabled =
			HostProvider.globalSettings.get<GlobalStateAndSettings["terminalReuseEnabled"]>("terminalReuseEnabled")
		const vscodeTerminalExecutionMode =
			HostProvider.globalSettings.get<GlobalStateAndSettings["vscodeTerminalExecutionMode"]>("vscodeTerminalExecutionMode")
		const terminalOutputLineLimit =
			HostProvider.globalSettings.get<GlobalStateAndSettings["terminalOutputLineLimit"]>("terminalOutputLineLimit")
		const maxConsecutiveMistakes =
			HostProvider.globalSettings.get<GlobalStateAndSettings["maxConsecutiveMistakes"]>("maxConsecutiveMistakes")
		const subagentTerminalOutputLineLimit = HostProvider.globalSettings.get<
			GlobalStateAndSettings["subagentTerminalOutputLineLimit"]
		>("subagentTerminalOutputLineLimit")
		const defaultTerminalProfile =
			HostProvider.globalSettings.get<GlobalStateAndSettings["defaultTerminalProfile"]>("defaultTerminalProfile")
		const sapAiCoreBaseUrl = HostProvider.globalSettings.get<GlobalStateAndSettings["sapAiCoreBaseUrl"]>("sapAiCoreBaseUrl")
		const sapAiCoreTokenUrl =
			HostProvider.globalSettings.get<GlobalStateAndSettings["sapAiCoreTokenUrl"]>("sapAiCoreTokenUrl")
		const sapAiResourceGroup =
			HostProvider.globalSettings.get<GlobalStateAndSettings["sapAiResourceGroup"]>("sapAiResourceGroup")
		const claudeCodePath = HostProvider.globalSettings.get<GlobalStateAndSettings["claudeCodePath"]>("claudeCodePath")
		const difyBaseUrl = HostProvider.globalSettings.get<GlobalStateAndSettings["difyBaseUrl"]>("difyBaseUrl")
		const ocaBaseUrl = HostProvider.globalSettings.get<string>("ocaBaseUrl")
		const ocaMode = HostProvider.globalSettings.get<string>("ocaMode")
		const openaiReasoningEffort =
			HostProvider.globalSettings.get<GlobalStateAndSettings["openaiReasoningEffort"]>("openaiReasoningEffort")
		const preferredLanguage =
			HostProvider.globalSettings.get<GlobalStateAndSettings["preferredLanguage"]>("preferredLanguage")
		const focusChainSettings =
			HostProvider.globalSettings.get<GlobalStateAndSettings["focusChainSettings"]>("focusChainSettings")
		const dictationSettings = HostProvider.globalSettings.get<DictationSettings>("dictationSettings")
		const lastDismissedInfoBannerVersion =
			HostProvider.globalSettings.get<GlobalStateAndSettings["lastDismissedInfoBannerVersion"]>(
				"lastDismissedInfoBannerVersion",
			)
		const lastDismissedModelBannerVersion = HostProvider.globalSettings.get<
			GlobalStateAndSettings["lastDismissedModelBannerVersion"]
		>("lastDismissedModelBannerVersion")
		const lastDismissedCliBannerVersion =
			HostProvider.globalSettings.get<GlobalStateAndSettings["lastDismissedCliBannerVersion"]>(
				"lastDismissedCliBannerVersion",
			)
		const dismissedBanners = HostProvider.globalSettings.get<GlobalStateAndSettings["dismissedBanners"]>("dismissedBanners")
		const qwenCodeOauthPath =
			HostProvider.globalSettings.get<GlobalStateAndSettings["qwenCodeOauthPath"]>("qwenCodeOauthPath")
		const customPrompt = HostProvider.globalSettings.get<GlobalStateAndSettings["customPrompt"]>("customPrompt")
		const autoCondenseThreshold =
			HostProvider.globalSettings.get<GlobalStateAndSettings["autoCondenseThreshold"]>("autoCondenseThreshold") // number from 0 to 1
		const hooksEnabled = HostProvider.globalSettings.get<GlobalStateAndSettings["hooksEnabled"]>("hooksEnabled")
		const enableParallelToolCalling =
			HostProvider.globalSettings.get<GlobalStateAndSettings["enableParallelToolCalling"]>("enableParallelToolCalling")
		const hicapModelId = HostProvider.globalSettings.get<GlobalStateAndSettings["hicapModelId"]>("hicapModelId")
		const aihubmixBaseUrl = HostProvider.globalSettings.get<GlobalStateAndSettings["aihubmixBaseUrl"]>("aihubmixBaseUrl")
		const aihubmixAppCode = HostProvider.globalSettings.get<GlobalStateAndSettings["aihubmixAppCode"]>("aihubmixAppCode")

		// OpenTelemetry configuration
		const openTelemetryEnabled =
			HostProvider.globalSettings.get<GlobalStateAndSettings["openTelemetryEnabled"]>("openTelemetryEnabled")
		const openTelemetryMetricsExporter =
			HostProvider.globalSettings.get<GlobalStateAndSettings["openTelemetryMetricsExporter"]>(
				"openTelemetryMetricsExporter",
			)
		const openTelemetryLogsExporter =
			HostProvider.globalSettings.get<GlobalStateAndSettings["openTelemetryLogsExporter"]>("openTelemetryLogsExporter")
		const openTelemetryOtlpProtocol =
			HostProvider.globalSettings.get<GlobalStateAndSettings["openTelemetryOtlpProtocol"]>("openTelemetryOtlpProtocol")
		const openTelemetryOtlpEndpoint =
			HostProvider.globalSettings.get<GlobalStateAndSettings["openTelemetryOtlpEndpoint"]>("openTelemetryOtlpEndpoint")
		const openTelemetryOtlpMetricsProtocol = HostProvider.globalSettings.get<
			GlobalStateAndSettings["openTelemetryOtlpMetricsProtocol"]
		>("openTelemetryOtlpMetricsProtocol")
		const openTelemetryOtlpMetricsEndpoint = HostProvider.globalSettings.get<
			GlobalStateAndSettings["openTelemetryOtlpMetricsEndpoint"]
		>("openTelemetryOtlpMetricsEndpoint")
		const openTelemetryOtlpLogsProtocol =
			HostProvider.globalSettings.get<GlobalStateAndSettings["openTelemetryOtlpLogsProtocol"]>(
				"openTelemetryOtlpLogsProtocol",
			)
		const openTelemetryOtlpLogsEndpoint =
			HostProvider.globalSettings.get<GlobalStateAndSettings["openTelemetryOtlpLogsEndpoint"]>(
				"openTelemetryOtlpLogsEndpoint",
			)
		const openTelemetryMetricExportInterval = HostProvider.globalSettings.get<
			GlobalStateAndSettings["openTelemetryMetricExportInterval"]
		>("openTelemetryMetricExportInterval")
		const openTelemetryOtlpInsecure =
			HostProvider.globalSettings.get<GlobalStateAndSettings["openTelemetryOtlpInsecure"]>("openTelemetryOtlpInsecure")
		const openTelemetryLogBatchSize =
			HostProvider.globalSettings.get<GlobalStateAndSettings["openTelemetryLogBatchSize"]>("openTelemetryLogBatchSize")
		const openTelemetryLogBatchTimeout =
			HostProvider.globalSettings.get<GlobalStateAndSettings["openTelemetryLogBatchTimeout"]>(
				"openTelemetryLogBatchTimeout",
			)
		const openTelemetryLogMaxQueueSize =
			HostProvider.globalSettings.get<GlobalStateAndSettings["openTelemetryLogMaxQueueSize"]>(
				"openTelemetryLogMaxQueueSize",
			)
		const subagentsEnabled = HostProvider.globalSettings.get<GlobalStateAndSettings["subagentsEnabled"]>("subagentsEnabled")
		const backgroundEditEnabled =
			HostProvider.globalSettings.get<GlobalStateAndSettings["backgroundEditEnabled"]>("backgroundEditEnabled")

		// Get mode-related configurations
		const mode = HostProvider.globalSettings.get<GlobalStateAndSettings["mode"]>("mode")

		// Plan mode configurations
		const planModeApiProvider =
			HostProvider.globalSettings.get<GlobalStateAndSettings["planModeApiProvider"]>("planModeApiProvider")
		const planModeApiModelId =
			HostProvider.globalSettings.get<GlobalStateAndSettings["planModeApiModelId"]>("planModeApiModelId")
		const planModeThinkingBudgetTokens =
			HostProvider.globalSettings.get<GlobalStateAndSettings["planModeThinkingBudgetTokens"]>(
				"planModeThinkingBudgetTokens",
			)
		const geminiPlanModeThinkingLevel =
			HostProvider.globalSettings.get<GlobalStateAndSettings["geminiPlanModeThinkingLevel"]>("geminiPlanModeThinkingLevel")
		const planModeReasoningEffort =
			HostProvider.globalSettings.get<GlobalStateAndSettings["planModeReasoningEffort"]>("planModeReasoningEffort")
		const planModeVsCodeLmModelSelector =
			HostProvider.globalSettings.get<GlobalStateAndSettings["planModeVsCodeLmModelSelector"]>(
				"planModeVsCodeLmModelSelector",
			)
		const planModeAwsBedrockCustomSelected = HostProvider.globalSettings.get<
			GlobalStateAndSettings["planModeAwsBedrockCustomSelected"]
		>("planModeAwsBedrockCustomSelected")
		const planModeAwsBedrockCustomModelBaseId = HostProvider.globalSettings.get<
			GlobalStateAndSettings["planModeAwsBedrockCustomModelBaseId"]
		>("planModeAwsBedrockCustomModelBaseId")
		const planModeOpenRouterModelId =
			HostProvider.globalSettings.get<GlobalStateAndSettings["planModeOpenRouterModelId"]>("planModeOpenRouterModelId")
		const planModeOpenRouterModelInfo =
			HostProvider.globalSettings.get<GlobalStateAndSettings["planModeOpenRouterModelInfo"]>("planModeOpenRouterModelInfo")
		const planModeOpenAiModelId =
			HostProvider.globalSettings.get<GlobalStateAndSettings["planModeOpenAiModelId"]>("planModeOpenAiModelId")
		const planModeOpenAiModelInfo =
			HostProvider.globalSettings.get<GlobalStateAndSettings["planModeOpenAiModelInfo"]>("planModeOpenAiModelInfo")
		const planModeOllamaModelId =
			HostProvider.globalSettings.get<GlobalStateAndSettings["planModeOllamaModelId"]>("planModeOllamaModelId")
		const planModeLmStudioModelId =
			HostProvider.globalSettings.get<GlobalStateAndSettings["planModeLmStudioModelId"]>("planModeLmStudioModelId")
		const planModeLiteLlmModelId =
			HostProvider.globalSettings.get<GlobalStateAndSettings["planModeLiteLlmModelId"]>("planModeLiteLlmModelId")
		const planModeLiteLlmModelInfo =
			HostProvider.globalSettings.get<GlobalStateAndSettings["planModeLiteLlmModelInfo"]>("planModeLiteLlmModelInfo")
		const planModeRequestyModelId =
			HostProvider.globalSettings.get<GlobalStateAndSettings["planModeRequestyModelId"]>("planModeRequestyModelId")
		const planModeRequestyModelInfo =
			HostProvider.globalSettings.get<GlobalStateAndSettings["planModeRequestyModelInfo"]>("planModeRequestyModelInfo")
		const planModeTogetherModelId =
			HostProvider.globalSettings.get<GlobalStateAndSettings["planModeTogetherModelId"]>("planModeTogetherModelId")
		const planModeFireworksModelId =
			HostProvider.globalSettings.get<GlobalStateAndSettings["planModeFireworksModelId"]>("planModeFireworksModelId")
		const planModeSapAiCoreModelId =
			HostProvider.globalSettings.get<GlobalStateAndSettings["planModeSapAiCoreModelId"]>("planModeSapAiCoreModelId")
		const planModeSapAiCoreDeploymentId =
			HostProvider.globalSettings.get<GlobalStateAndSettings["planModeSapAiCoreDeploymentId"]>(
				"planModeSapAiCoreDeploymentId",
			)
		const planModeGroqModelId =
			HostProvider.globalSettings.get<GlobalStateAndSettings["planModeGroqModelId"]>("planModeGroqModelId")
		const planModeGroqModelInfo =
			HostProvider.globalSettings.get<GlobalStateAndSettings["planModeGroqModelInfo"]>("planModeGroqModelInfo")
		const planModeHuggingFaceModelId =
			HostProvider.globalSettings.get<GlobalStateAndSettings["planModeHuggingFaceModelId"]>("planModeHuggingFaceModelId")
		const planModeHuggingFaceModelInfo =
			HostProvider.globalSettings.get<GlobalStateAndSettings["planModeHuggingFaceModelInfo"]>(
				"planModeHuggingFaceModelInfo",
			)
		const planModeHuaweiCloudMaasModelId =
			HostProvider.globalSettings.get<GlobalStateAndSettings["planModeHuaweiCloudMaasModelId"]>(
				"planModeHuaweiCloudMaasModelId",
			)
		const planModeHuaweiCloudMaasModelInfo = HostProvider.globalSettings.get<
			GlobalStateAndSettings["planModeHuaweiCloudMaasModelInfo"]
		>("planModeHuaweiCloudMaasModelInfo")
		const planModeBasetenModelId =
			HostProvider.globalSettings.get<GlobalStateAndSettings["planModeBasetenModelId"]>("planModeBasetenModelId")
		const planModeBasetenModelInfo =
			HostProvider.globalSettings.get<GlobalStateAndSettings["planModeBasetenModelInfo"]>("planModeBasetenModelInfo")
		const planModeOcaModelId = HostProvider.globalSettings.get<string>("planModeOcaModelId")
		const planModeOcaModelInfo = HostProvider.globalSettings.get<OcaModelInfo>("planModeOcaModelInfo")
		const planModeHicapModelId =
			HostProvider.globalSettings.get<GlobalStateAndSettings["planModeHicapModelId"]>("planModeHicapModelId")
		const planModeHicapModelInfo =
			HostProvider.globalSettings.get<GlobalStateAndSettings["planModeHicapModelInfo"]>("planModeHicapModelInfo")
		const planModeAihubmixModelId =
			HostProvider.globalSettings.get<GlobalStateAndSettings["planModeAihubmixModelId"]>("planModeAihubmixModelId")
		const planModeAihubmixModelInfo =
			HostProvider.globalSettings.get<GlobalStateAndSettings["planModeAihubmixModelInfo"]>("planModeAihubmixModelInfo")
		const planModeNousResearchModelId =
			HostProvider.globalSettings.get<GlobalStateAndSettings["planModeNousResearchModelId"]>("planModeNousResearchModelId")
		// Act mode configurations
		const actModeApiProvider =
			HostProvider.globalSettings.get<GlobalStateAndSettings["actModeApiProvider"]>("actModeApiProvider")
		const actModeApiModelId =
			HostProvider.globalSettings.get<GlobalStateAndSettings["actModeApiModelId"]>("actModeApiModelId")
		const actModeThinkingBudgetTokens =
			HostProvider.globalSettings.get<GlobalStateAndSettings["actModeThinkingBudgetTokens"]>("actModeThinkingBudgetTokens")
		const geminiActModeThinkingLevel =
			HostProvider.globalSettings.get<GlobalStateAndSettings["geminiActModeThinkingLevel"]>("geminiActModeThinkingLevel")
		const actModeReasoningEffort =
			HostProvider.globalSettings.get<GlobalStateAndSettings["actModeReasoningEffort"]>("actModeReasoningEffort")
		const actModeVsCodeLmModelSelector =
			HostProvider.globalSettings.get<GlobalStateAndSettings["actModeVsCodeLmModelSelector"]>(
				"actModeVsCodeLmModelSelector",
			)
		const actModeAwsBedrockCustomSelected = HostProvider.globalSettings.get<
			GlobalStateAndSettings["actModeAwsBedrockCustomSelected"]
		>("actModeAwsBedrockCustomSelected")
		const actModeAwsBedrockCustomModelBaseId = HostProvider.globalSettings.get<
			GlobalStateAndSettings["actModeAwsBedrockCustomModelBaseId"]
		>("actModeAwsBedrockCustomModelBaseId")
		const actModeOpenRouterModelId =
			HostProvider.globalSettings.get<GlobalStateAndSettings["actModeOpenRouterModelId"]>("actModeOpenRouterModelId")
		const actModeOpenRouterModelInfo =
			HostProvider.globalSettings.get<GlobalStateAndSettings["actModeOpenRouterModelInfo"]>("actModeOpenRouterModelInfo")
		const actModeOpenAiModelId =
			HostProvider.globalSettings.get<GlobalStateAndSettings["actModeOpenAiModelId"]>("actModeOpenAiModelId")
		const actModeOpenAiModelInfo =
			HostProvider.globalSettings.get<GlobalStateAndSettings["actModeOpenAiModelInfo"]>("actModeOpenAiModelInfo")
		const actModeOllamaModelId =
			HostProvider.globalSettings.get<GlobalStateAndSettings["actModeOllamaModelId"]>("actModeOllamaModelId")
		const actModeLmStudioModelId =
			HostProvider.globalSettings.get<GlobalStateAndSettings["actModeLmStudioModelId"]>("actModeLmStudioModelId")
		const actModeLiteLlmModelId =
			HostProvider.globalSettings.get<GlobalStateAndSettings["actModeLiteLlmModelId"]>("actModeLiteLlmModelId")
		const actModeLiteLlmModelInfo =
			HostProvider.globalSettings.get<GlobalStateAndSettings["actModeLiteLlmModelInfo"]>("actModeLiteLlmModelInfo")
		const actModeRequestyModelId =
			HostProvider.globalSettings.get<GlobalStateAndSettings["actModeRequestyModelId"]>("actModeRequestyModelId")
		const actModeRequestyModelInfo =
			HostProvider.globalSettings.get<GlobalStateAndSettings["actModeRequestyModelInfo"]>("actModeRequestyModelInfo")
		const actModeTogetherModelId =
			HostProvider.globalSettings.get<GlobalStateAndSettings["actModeTogetherModelId"]>("actModeTogetherModelId")
		const actModeFireworksModelId =
			HostProvider.globalSettings.get<GlobalStateAndSettings["actModeFireworksModelId"]>("actModeFireworksModelId")
		const actModeSapAiCoreModelId =
			HostProvider.globalSettings.get<GlobalStateAndSettings["actModeSapAiCoreModelId"]>("actModeSapAiCoreModelId")
		const actModeSapAiCoreDeploymentId =
			HostProvider.globalSettings.get<GlobalStateAndSettings["actModeSapAiCoreDeploymentId"]>(
				"actModeSapAiCoreDeploymentId",
			)
		const actModeGroqModelId =
			HostProvider.globalSettings.get<GlobalStateAndSettings["actModeGroqModelId"]>("actModeGroqModelId")
		const actModeGroqModelInfo =
			HostProvider.globalSettings.get<GlobalStateAndSettings["actModeGroqModelInfo"]>("actModeGroqModelInfo")
		const actModeHuggingFaceModelId =
			HostProvider.globalSettings.get<GlobalStateAndSettings["actModeHuggingFaceModelId"]>("actModeHuggingFaceModelId")
		const actModeHuggingFaceModelInfo =
			HostProvider.globalSettings.get<GlobalStateAndSettings["actModeHuggingFaceModelInfo"]>("actModeHuggingFaceModelInfo")
		const actModeHuaweiCloudMaasModelId =
			HostProvider.globalSettings.get<GlobalStateAndSettings["actModeHuaweiCloudMaasModelId"]>(
				"actModeHuaweiCloudMaasModelId",
			)
		const actModeHuaweiCloudMaasModelInfo = HostProvider.globalSettings.get<
			GlobalStateAndSettings["actModeHuaweiCloudMaasModelInfo"]
		>("actModeHuaweiCloudMaasModelInfo")
		const actModeBasetenModelId =
			HostProvider.globalSettings.get<GlobalStateAndSettings["actModeBasetenModelId"]>("actModeBasetenModelId")
		const actModeBasetenModelInfo =
			HostProvider.globalSettings.get<GlobalStateAndSettings["actModeBasetenModelInfo"]>("actModeBasetenModelInfo")
		const actModeOcaModelId = HostProvider.globalSettings.get<string>("actModeOcaModelId")
		const actModeOcaModelInfo = HostProvider.globalSettings.get<OcaModelInfo>("actModeOcaModelInfo")
		const actModeNousResearchModelId =
			HostProvider.globalSettings.get<GlobalStateAndSettings["actModeNousResearchModelId"]>("actModeNousResearchModelId")
		const sapAiCoreUseOrchestrationMode =
			HostProvider.globalSettings.get<GlobalStateAndSettings["sapAiCoreUseOrchestrationMode"]>(
				"sapAiCoreUseOrchestrationMode",
			)
		const actModeHicapModelId =
			HostProvider.globalSettings.get<GlobalStateAndSettings["actModeHicapModelId"]>("actModeHicapModelId")
		const actModeHicapModelInfo =
			HostProvider.globalSettings.get<GlobalStateAndSettings["actModeHicapModelInfo"]>("actModeHicapModelInfo")
		const actModeAihubmixModelId =
			HostProvider.globalSettings.get<GlobalStateAndSettings["actModeAihubmixModelId"]>("actModeAihubmixModelId")
		const actModeAihubmixModelInfo =
			HostProvider.globalSettings.get<GlobalStateAndSettings["actModeAihubmixModelInfo"]>("actModeAihubmixModelInfo")

		let apiProvider: ApiProvider
		if (planModeApiProvider) {
			apiProvider = planModeApiProvider
		} else {
			// New users should default to openrouter, since they've opted to use an API key instead of signing in
			apiProvider = "openrouter"
		}

		const mcpResponsesCollapsed = mcpResponsesCollapsedRaw ?? false

		// Plan/Act separate models setting is a boolean indicating whether the user wants to use different models for plan and act. Existing users expect this to be enabled, while we want new users to opt in to this being disabled by default.
		// On win11 state sometimes initializes as empty string instead of undefined
		let planActSeparateModelsSetting: boolean | undefined
		if (planActSeparateModelsSettingRaw === true || planActSeparateModelsSettingRaw === false) {
			planActSeparateModelsSetting = planActSeparateModelsSettingRaw
		} else {
			// default to false
			planActSeparateModelsSetting = false
		}

		// Read task history from disk
		// Note: If this throws (e.g., filesystem I/O error), StateManager initialization will fail
		// and the extension will not start. This is intentional to prevent data loss - better to
		// fail visibly than silently wipe history. The readTaskHistoryFromState function handles:
		// - File doesn't exist → returns []
		// - Parse errors → attempts reconstruction, returns [] only if reconstruction fails
		// - I/O errors → throws (caught here, causing initialization to fail)

		// So, any errors thrown here are true IO errors, which should be exceptionally rare.
		// The state manager tries once more to start on any failure. So if there is truly an I/O error happening twice that is not due to the file not existing or being corrupted, then something is truly wrong and it is correct to not start the application.
		const taskHistory = await readTaskHistoryFromState()

		// Multi-root workspace support
		const workspaceRoots = HostProvider.globalSettings.get<GlobalStateAndSettings["workspaceRoots"]>("workspaceRoots")
		/**
		 * Get primary root index from global state.
		 * The primary root is the main workspace folder that Cline focuses on when dealing with
		 * multi-root workspaces. In VS Code, you can have multiple folders open in one workspace,
		 * and the primary root index indicates which folder (by its position in the array, 0-based)
		 * should be treated as the main/default working directory for operations.
		 */
		const primaryRootIndex = HostProvider.globalSettings.get<GlobalStateAndSettings["primaryRootIndex"]>("primaryRootIndex")
		const multiRootEnabled = HostProvider.globalSettings.get<GlobalStateAndSettings["multiRootEnabled"]>("multiRootEnabled")
		const nativeToolCallEnabled =
			HostProvider.globalSettings.get<GlobalStateAndSettings["nativeToolCallEnabled"]>("nativeToolCallEnabled")
		const remoteRulesToggles =
			HostProvider.globalSettings.get<GlobalStateAndSettings["remoteRulesToggles"]>("remoteRulesToggles")
		const remoteWorkflowToggles =
			HostProvider.globalSettings.get<GlobalStateAndSettings["remoteWorkflowToggles"]>("remoteWorkflowToggles")

		return {
			// api configuration fields
			claudeCodePath,
			awsRegion,
			awsUseCrossRegionInference,
			awsUseGlobalInference,
			awsBedrockUsePromptCache,
			awsBedrockEndpoint,
			awsProfile,
			awsUseProfile,
			awsAuthentication,
			vertexProjectId,
			vertexRegion,
			openAiBaseUrl,
			requestyBaseUrl,
			openAiHeaders: openAiHeaders || {},
			ollamaBaseUrl,
			ollamaApiOptionsCtxNum,
			lmStudioBaseUrl,
			lmStudioMaxTokens,
			anthropicBaseUrl,
			geminiBaseUrl,
			qwenApiLine,
			moonshotApiLine,
			zaiApiLine,
			azureApiVersion,
			openRouterProviderSorting,
			liteLlmBaseUrl,
			liteLlmUsePromptCache,
			fireworksModelMaxCompletionTokens,
			fireworksModelMaxTokens,
			asksageApiUrl,
			favoritedModelIds: favoritedModelIds || [],
			requestTimeoutMs,
			sapAiCoreBaseUrl,
			sapAiCoreTokenUrl,
			sapAiResourceGroup,
			difyBaseUrl,
			sapAiCoreUseOrchestrationMode: sapAiCoreUseOrchestrationMode ?? true,
			ocaBaseUrl,
			minimaxApiLine,
			ocaMode: ocaMode || "internal",
			hicapModelId,
			aihubmixBaseUrl,
			aihubmixAppCode,
			// Plan mode configurations
			planModeApiProvider: planModeApiProvider || apiProvider,
			planModeApiModelId,
			// undefined means it was never modified, 0 means it was turned off
			// (having this on by default ensures that <thinking> text does not pollute the user's chat and is instead rendered as reasoning)
			planModeThinkingBudgetTokens: planModeThinkingBudgetTokens ?? ANTHROPIC_MIN_THINKING_BUDGET,
			planModeReasoningEffort,
			planModeVsCodeLmModelSelector,
			planModeAwsBedrockCustomSelected,
			planModeAwsBedrockCustomModelBaseId,
			planModeOpenRouterModelId,
			planModeOpenRouterModelInfo,
			planModeOpenAiModelId,
			planModeOpenAiModelInfo,
			planModeOllamaModelId,
			planModeLmStudioModelId,
			planModeLiteLlmModelId,
			planModeLiteLlmModelInfo,
			planModeRequestyModelId,
			planModeRequestyModelInfo,
			planModeTogetherModelId,
			planModeFireworksModelId: planModeFireworksModelId || fireworksDefaultModelId,
			planModeSapAiCoreModelId,
			planModeSapAiCoreDeploymentId,
			planModeGroqModelId,
			planModeGroqModelInfo,
			planModeHuggingFaceModelId,
			planModeHuggingFaceModelInfo,
			planModeHuaweiCloudMaasModelId,
			planModeHuaweiCloudMaasModelInfo,
			planModeBasetenModelId,
			planModeBasetenModelInfo,
			planModeOcaModelId,
			planModeOcaModelInfo,
			planModeHicapModelId,
			planModeHicapModelInfo,
			planModeAihubmixModelId,
			planModeAihubmixModelInfo,
			planModeNousResearchModelId,
			geminiPlanModeThinkingLevel,
			// Act mode configurations
			actModeApiProvider: actModeApiProvider || apiProvider,
			actModeApiModelId,
			actModeThinkingBudgetTokens: actModeThinkingBudgetTokens ?? ANTHROPIC_MIN_THINKING_BUDGET,
			actModeReasoningEffort,
			actModeVsCodeLmModelSelector,
			actModeAwsBedrockCustomSelected,
			actModeAwsBedrockCustomModelBaseId,
			actModeOpenRouterModelId,
			actModeOpenRouterModelInfo,
			actModeOpenAiModelId,
			actModeOpenAiModelInfo,
			actModeOllamaModelId,
			actModeLmStudioModelId,
			actModeLiteLlmModelId,
			actModeLiteLlmModelInfo,
			actModeRequestyModelId,
			actModeRequestyModelInfo,
			actModeTogetherModelId,
			actModeFireworksModelId: actModeFireworksModelId || fireworksDefaultModelId,
			actModeSapAiCoreModelId,
			actModeSapAiCoreDeploymentId,
			actModeGroqModelId,
			actModeGroqModelInfo,
			actModeHuggingFaceModelId,
			actModeHuggingFaceModelInfo,
			actModeHuaweiCloudMaasModelId,
			actModeHuaweiCloudMaasModelInfo,
			actModeBasetenModelId,
			actModeBasetenModelInfo,
			actModeOcaModelId,
			actModeOcaModelInfo,
			actModeHicapModelId,
			actModeHicapModelInfo,
			actModeAihubmixModelId,
			actModeAihubmixModelInfo,
			actModeNousResearchModelId,
			geminiActModeThinkingLevel,

			// Other global fields
			focusChainSettings: focusChainSettings || DEFAULT_FOCUS_CHAIN_SETTINGS,
			dictationSettings: { ...DEFAULT_DICTATION_SETTINGS, ...dictationSettings },
			strictPlanModeEnabled: strictPlanModeEnabled ?? true,
			yoloModeToggled: yoloModeToggled ?? false,
			useAutoCondense: useAutoCondense ?? false,
			clineWebToolsEnabled: clineWebToolsEnabled ?? true,
			isNewUser: isNewUser ?? true,
			welcomeViewCompleted,
			lastShownAnnouncementId,
			taskHistory: taskHistory || [],
			autoApprovalSettings: autoApprovalSettings || DEFAULT_AUTO_APPROVAL_SETTINGS, // default value can be 0 or empty string
			globalClineRulesToggles: globalClineRulesToggles || {},
			browserSettings: { ...DEFAULT_BROWSER_SETTINGS, ...browserSettings }, // this will ensure that older versions of browserSettings (e.g. before remoteBrowserEnabled was added) are merged with the default values (false for remoteBrowserEnabled)
			preferredLanguage: preferredLanguage || "English",
			openaiReasoningEffort: (openaiReasoningEffort as OpenaiReasoningEffort) || "medium",
			mode: mode || "act",
			userInfo,
			mcpMarketplaceEnabled: mcpMarketplaceEnabledRaw ?? true,
			mcpDisplayMode: mcpDisplayMode ?? DEFAULT_MCP_DISPLAY_MODE,
			mcpResponsesCollapsed: mcpResponsesCollapsed,
			telemetrySetting: telemetrySetting || "unset",
			planActSeparateModelsSetting: planActSeparateModelsSetting ?? false,
			enableCheckpointsSetting: enableCheckpointsSettingRaw ?? true,
			shellIntegrationTimeout: shellIntegrationTimeout || 4000,
			terminalReuseEnabled: terminalReuseEnabled ?? true,
			vscodeTerminalExecutionMode: vscodeTerminalExecutionMode ?? "vscodeTerminal",
			terminalOutputLineLimit: terminalOutputLineLimit ?? 500,
			maxConsecutiveMistakes: maxConsecutiveMistakes ?? 3,
			subagentTerminalOutputLineLimit: subagentTerminalOutputLineLimit ?? 2000,
			defaultTerminalProfile: defaultTerminalProfile ?? "default",
			globalWorkflowToggles: globalWorkflowToggles || {},
			qwenCodeOauthPath,
			customPrompt,
			autoCondenseThreshold: autoCondenseThreshold || 0.75, // default to 0.75 if not set
			backgroundEditEnabled: backgroundEditEnabled ?? false,
			// Hooks require explicit user opt-in and are only supported on macOS/Linux
			hooksEnabled: getHooksEnabledSafe(hooksEnabled),
			subagentsEnabled: subagentsEnabled ?? false,
			enableParallelToolCalling: enableParallelToolCalling ?? false,
			lastDismissedInfoBannerVersion: lastDismissedInfoBannerVersion ?? 0,
			lastDismissedModelBannerVersion: lastDismissedModelBannerVersion ?? 0,
			lastDismissedCliBannerVersion: lastDismissedCliBannerVersion ?? 0,
			dismissedBanners: dismissedBanners || [],
			nativeToolCallEnabled: nativeToolCallEnabled ?? true,
			// Multi-root workspace support
			workspaceRoots,
			primaryRootIndex: primaryRootIndex ?? 0,
			// Feature flag - defaults to false
			// For now, always return false to disable multi-root support by default
			multiRootEnabled: !!multiRootEnabled,

			// OpenTelemetry configuration
			openTelemetryEnabled: openTelemetryEnabled ?? true,
			openTelemetryMetricsExporter,
			openTelemetryLogsExporter,
			openTelemetryOtlpProtocol: openTelemetryOtlpProtocol ?? "http/json",
			openTelemetryOtlpEndpoint: openTelemetryOtlpEndpoint ?? "http://localhost:4318",
			openTelemetryOtlpMetricsProtocol,
			openTelemetryOtlpMetricsEndpoint,
			openTelemetryOtlpLogsProtocol,
			openTelemetryOtlpLogsEndpoint,
			openTelemetryMetricExportInterval: openTelemetryMetricExportInterval ?? 60000,
			openTelemetryOtlpInsecure: openTelemetryOtlpInsecure ?? false,
			openTelemetryLogBatchSize: openTelemetryLogBatchSize ?? 512,
			openTelemetryLogBatchTimeout: openTelemetryLogBatchTimeout ?? 5000,
			openTelemetryLogMaxQueueSize: openTelemetryLogMaxQueueSize ?? 2048,
			remoteRulesToggles: remoteRulesToggles || {},
			remoteWorkflowToggles: remoteWorkflowToggles || {},
		}
	} catch (error) {
		console.error("[StateHelpers] Failed to read global state:", error)
		throw error
	}
}

export async function resetWorkspaceState(controller: Controller) {
	await Promise.all(HostProvider.workspaceSettings.keys().map((key) => HostProvider.workspaceSettings.delete(key)))

	await controller.stateManager.reInitialize()
}

export async function resetGlobalState(controller: Controller) {
	await Promise.all(HostProvider.globalSettings.keys().map((key) => HostProvider.globalSettings.delete(key)))
	const secretKeys: SecretKey[] = [
		"apiKey",
		"openRouterApiKey",
		"awsAccessKey",
		"awsSecretKey",
		"awsSessionToken",
		"awsBedrockApiKey",
		"openAiApiKey",
		"ollamaApiKey",
		"geminiApiKey",
		"openAiNativeApiKey",
		"deepSeekApiKey",
		"requestyApiKey",
		"togetherApiKey",
		"qwenApiKey",
		"doubaoApiKey",
		"mistralApiKey",
		"clineAccountId",
		"liteLlmApiKey",
		"remoteLiteLlmApiKey",
		"fireworksApiKey",
		"asksageApiKey",
		"xaiApiKey",
		"sambanovaApiKey",
		"cerebrasApiKey",
		"groqApiKey",
		"basetenApiKey",
		"moonshotApiKey",
		"nebiusApiKey",
		"huggingFaceApiKey",
		"huaweiCloudMaasApiKey",
		"vercelAiGatewayApiKey",
		"zaiApiKey",
		"difyApiKey",
		"ocaApiKey",
		"ocaRefreshToken",
		"minimaxApiKey",
		"hicapApiKey",
		"aihubmixApiKey",
		"mcpOAuthSecrets",
		"nousResearchApiKey",
	]
	await Promise.all(secretKeys.map((key) => HostProvider.secrets.delete(key)))
	await controller.stateManager.reInitialize()
}
