import { ANTHROPIC_MIN_THINKING_BUDGET, ApiProvider, fireworksDefaultModelId, type OcaModelInfo } from "@shared/api"
import { GlobalStateAndSettings, LocalState, SecretKey, Secrets } from "@shared/storage/state-keys"
import { ExtensionContext } from "vscode"
import { Controller } from "@/core/controller"
import { getHooksEnabledSafe } from "@/core/hooks/hooks-utils"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@/shared/AutoApprovalSettings"
import { DEFAULT_BROWSER_SETTINGS } from "@/shared/BrowserSettings"
import { ClineRulesToggles } from "@/shared/cline-rules"
import { DEFAULT_DICTATION_SETTINGS, DictationSettings } from "@/shared/DictationSettings"
import { DEFAULT_FOCUS_CHAIN_SETTINGS } from "@/shared/FocusChainSettings"
import { DEFAULT_MCP_DISPLAY_MODE } from "@/shared/McpDisplayMode"
import { OpenaiReasoningEffort } from "@/shared/storage/types"
import { readTaskHistoryFromState } from "../disk"
export async function readSecretsFromDisk(context: ExtensionContext): Promise<Secrets> {
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
		context.secrets.get("apiKey") as Promise<Secrets["apiKey"]>,
		context.secrets.get("openRouterApiKey") as Promise<Secrets["openRouterApiKey"]>,
		context.secrets.get("clineAccountId") as Promise<Secrets["clineAccountId"]>,
		context.secrets.get("cline:clineAccountId") as Promise<Secrets["cline:clineAccountId"]>,
		context.secrets.get("awsAccessKey") as Promise<Secrets["awsAccessKey"]>,
		context.secrets.get("awsSecretKey") as Promise<Secrets["awsSecretKey"]>,
		context.secrets.get("awsSessionToken") as Promise<Secrets["awsSessionToken"]>,
		context.secrets.get("awsBedrockApiKey") as Promise<Secrets["awsBedrockApiKey"]>,
		context.secrets.get("openAiApiKey") as Promise<Secrets["openAiApiKey"]>,
		context.secrets.get("geminiApiKey") as Promise<Secrets["geminiApiKey"]>,
		context.secrets.get("openAiNativeApiKey") as Promise<Secrets["openAiNativeApiKey"]>,
		context.secrets.get("deepSeekApiKey") as Promise<Secrets["deepSeekApiKey"]>,
		context.secrets.get("requestyApiKey") as Promise<Secrets["requestyApiKey"]>,
		context.secrets.get("togetherApiKey") as Promise<Secrets["togetherApiKey"]>,
		context.secrets.get("qwenApiKey") as Promise<Secrets["qwenApiKey"]>,
		context.secrets.get("doubaoApiKey") as Promise<Secrets["doubaoApiKey"]>,
		context.secrets.get("mistralApiKey") as Promise<Secrets["mistralApiKey"]>,
		context.secrets.get("fireworksApiKey") as Promise<Secrets["fireworksApiKey"]>,
		context.secrets.get("liteLlmApiKey") as Promise<Secrets["liteLlmApiKey"]>,
		context.secrets.get("remoteLiteLlmApiKey") as Promise<Secrets["remoteLiteLlmApiKey"]>,
		context.secrets.get("asksageApiKey") as Promise<Secrets["asksageApiKey"]>,
		context.secrets.get("xaiApiKey") as Promise<Secrets["xaiApiKey"]>,
		context.secrets.get("sambanovaApiKey") as Promise<Secrets["sambanovaApiKey"]>,
		context.secrets.get("cerebrasApiKey") as Promise<Secrets["cerebrasApiKey"]>,
		context.secrets.get("groqApiKey") as Promise<Secrets["groqApiKey"]>,
		context.secrets.get("moonshotApiKey") as Promise<Secrets["moonshotApiKey"]>,
		context.secrets.get("nebiusApiKey") as Promise<Secrets["nebiusApiKey"]>,
		context.secrets.get("huggingFaceApiKey") as Promise<Secrets["huggingFaceApiKey"]>,
		context.secrets.get("sapAiCoreClientId") as Promise<Secrets["sapAiCoreClientId"]>,
		context.secrets.get("sapAiCoreClientSecret") as Promise<Secrets["sapAiCoreClientSecret"]>,
		context.secrets.get("huaweiCloudMaasApiKey") as Promise<Secrets["huaweiCloudMaasApiKey"]>,
		context.secrets.get("basetenApiKey") as Promise<Secrets["basetenApiKey"]>,
		context.secrets.get("zaiApiKey") as Promise<Secrets["zaiApiKey"]>,
		context.secrets.get("ollamaApiKey") as Promise<Secrets["ollamaApiKey"]>,
		context.secrets.get("vercelAiGatewayApiKey") as Promise<Secrets["vercelAiGatewayApiKey"]>,
		context.secrets.get("difyApiKey") as Promise<Secrets["difyApiKey"]>,
		context.secrets.get("authNonce") as Promise<Secrets["authNonce"]>,
		context.secrets.get("ocaApiKey") as Promise<string | undefined>,
		context.secrets.get("ocaRefreshToken") as Promise<string | undefined>,
		context.secrets.get("minimaxApiKey") as Promise<Secrets["minimaxApiKey"]>,
		context.secrets.get("hicapApiKey") as Promise<Secrets["hicapApiKey"]>,
		context.secrets.get("aihubmixApiKey") as Promise<Secrets["aihubmixApiKey"]>,
		context.secrets.get("mcpOAuthSecrets") as Promise<Secrets["mcpOAuthSecrets"]>,
		context.secrets.get("nousResearchApiKey") as Promise<Secrets["nousResearchApiKey"]>,
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

export async function readWorkspaceStateFromDisk(context: ExtensionContext): Promise<LocalState> {
	const localClineRulesToggles = context.workspaceState.get("localClineRulesToggles") as ClineRulesToggles | undefined
	const localWindsurfRulesToggles = context.workspaceState.get("localWindsurfRulesToggles") as ClineRulesToggles | undefined
	const localCursorRulesToggles = context.workspaceState.get("localCursorRulesToggles") as ClineRulesToggles | undefined
	const localAgentsRulesToggles = context.workspaceState.get("localAgentsRulesToggles") as ClineRulesToggles | undefined
	const localWorkflowToggles = context.workspaceState.get("workflowToggles") as ClineRulesToggles | undefined

	return {
		localClineRulesToggles: localClineRulesToggles || {},
		localWindsurfRulesToggles: localWindsurfRulesToggles || {},
		localCursorRulesToggles: localCursorRulesToggles || {},
		localAgentsRulesToggles: localAgentsRulesToggles || {},
		workflowToggles: localWorkflowToggles || {},
	}
}

export async function readGlobalStateFromDisk(context: ExtensionContext): Promise<GlobalStateAndSettings> {
	try {
		// Get all global state values
		const strictPlanModeEnabled =
			context.globalState.get<GlobalStateAndSettings["strictPlanModeEnabled"]>("strictPlanModeEnabled")
		const yoloModeToggled = context.globalState.get<GlobalStateAndSettings["yoloModeToggled"]>("yoloModeToggled")
		const useAutoCondense = context.globalState.get<GlobalStateAndSettings["useAutoCondense"]>("useAutoCondense")
		const clineWebToolsEnabled =
			context.globalState.get<GlobalStateAndSettings["clineWebToolsEnabled"]>("clineWebToolsEnabled")
		const isNewUser = context.globalState.get<GlobalStateAndSettings["isNewUser"]>("isNewUser")
		const welcomeViewCompleted =
			context.globalState.get<GlobalStateAndSettings["welcomeViewCompleted"]>("welcomeViewCompleted")
		const awsRegion = context.globalState.get<GlobalStateAndSettings["awsRegion"]>("awsRegion")
		const awsUseCrossRegionInference =
			context.globalState.get<GlobalStateAndSettings["awsUseCrossRegionInference"]>("awsUseCrossRegionInference")
		const awsUseGlobalInference =
			context.globalState.get<GlobalStateAndSettings["awsUseGlobalInference"]>("awsUseGlobalInference")
		const awsBedrockUsePromptCache =
			context.globalState.get<GlobalStateAndSettings["awsBedrockUsePromptCache"]>("awsBedrockUsePromptCache")
		const awsBedrockEndpoint = context.globalState.get<GlobalStateAndSettings["awsBedrockEndpoint"]>("awsBedrockEndpoint")
		const awsProfile = context.globalState.get<GlobalStateAndSettings["awsProfile"]>("awsProfile")
		const awsUseProfile = context.globalState.get<GlobalStateAndSettings["awsUseProfile"]>("awsUseProfile")
		const awsAuthentication = context.globalState.get<GlobalStateAndSettings["awsAuthentication"]>("awsAuthentication")
		const vertexProjectId = context.globalState.get<GlobalStateAndSettings["vertexProjectId"]>("vertexProjectId")
		const vertexRegion = context.globalState.get<GlobalStateAndSettings["vertexRegion"]>("vertexRegion")
		const openAiBaseUrl = context.globalState.get<GlobalStateAndSettings["openAiBaseUrl"]>("openAiBaseUrl")
		const requestyBaseUrl = context.globalState.get<GlobalStateAndSettings["requestyBaseUrl"]>("requestyBaseUrl")
		const openAiHeaders = context.globalState.get<GlobalStateAndSettings["openAiHeaders"]>("openAiHeaders")
		const ollamaBaseUrl = context.globalState.get<GlobalStateAndSettings["ollamaBaseUrl"]>("ollamaBaseUrl")
		const ollamaApiOptionsCtxNum =
			context.globalState.get<GlobalStateAndSettings["ollamaApiOptionsCtxNum"]>("ollamaApiOptionsCtxNum")
		const lmStudioBaseUrl = context.globalState.get<GlobalStateAndSettings["lmStudioBaseUrl"]>("lmStudioBaseUrl")
		const lmStudioMaxTokens = context.globalState.get<GlobalStateAndSettings["lmStudioMaxTokens"]>("lmStudioMaxTokens")
		const anthropicBaseUrl = context.globalState.get<GlobalStateAndSettings["anthropicBaseUrl"]>("anthropicBaseUrl")
		const geminiBaseUrl = context.globalState.get<GlobalStateAndSettings["geminiBaseUrl"]>("geminiBaseUrl")
		const azureApiVersion = context.globalState.get<GlobalStateAndSettings["azureApiVersion"]>("azureApiVersion")
		const azureIdentity = context.globalState.get<GlobalStateAndSettings["azureIdentity"]>("azureIdentity")
		const openRouterProviderSorting =
			context.globalState.get<GlobalStateAndSettings["openRouterProviderSorting"]>("openRouterProviderSorting")
		const lastShownAnnouncementId =
			context.globalState.get<GlobalStateAndSettings["lastShownAnnouncementId"]>("lastShownAnnouncementId")
		const autoApprovalSettings =
			context.globalState.get<GlobalStateAndSettings["autoApprovalSettings"]>("autoApprovalSettings")
		const browserSettings = context.globalState.get<GlobalStateAndSettings["browserSettings"]>("browserSettings")
		const liteLlmBaseUrl = context.globalState.get<GlobalStateAndSettings["liteLlmBaseUrl"]>("liteLlmBaseUrl")
		const liteLlmUsePromptCache =
			context.globalState.get<GlobalStateAndSettings["liteLlmUsePromptCache"]>("liteLlmUsePromptCache")
		const fireworksModelMaxCompletionTokens = context.globalState.get<
			GlobalStateAndSettings["fireworksModelMaxCompletionTokens"]
		>("fireworksModelMaxCompletionTokens")
		const fireworksModelMaxTokens =
			context.globalState.get<GlobalStateAndSettings["fireworksModelMaxTokens"]>("fireworksModelMaxTokens")
		const userInfo = context.globalState.get<GlobalStateAndSettings["userInfo"]>("userInfo")
		const qwenApiLine = context.globalState.get<GlobalStateAndSettings["qwenApiLine"]>("qwenApiLine")
		const moonshotApiLine = context.globalState.get<GlobalStateAndSettings["moonshotApiLine"]>("moonshotApiLine")
		const zaiApiLine = context.globalState.get<GlobalStateAndSettings["zaiApiLine"]>("zaiApiLine")
		const minimaxApiLine = context.globalState.get<GlobalStateAndSettings["minimaxApiLine"]>("minimaxApiLine")
		const telemetrySetting = context.globalState.get<GlobalStateAndSettings["telemetrySetting"]>("telemetrySetting")
		const asksageApiUrl = context.globalState.get<GlobalStateAndSettings["asksageApiUrl"]>("asksageApiUrl")
		const planActSeparateModelsSettingRaw =
			context.globalState.get<GlobalStateAndSettings["planActSeparateModelsSetting"]>("planActSeparateModelsSetting")
		const favoritedModelIds = context.globalState.get<GlobalStateAndSettings["favoritedModelIds"]>("favoritedModelIds")
		const globalClineRulesToggles =
			context.globalState.get<GlobalStateAndSettings["globalClineRulesToggles"]>("globalClineRulesToggles")
		const requestTimeoutMs = context.globalState.get<GlobalStateAndSettings["requestTimeoutMs"]>("requestTimeoutMs")
		const shellIntegrationTimeout =
			context.globalState.get<GlobalStateAndSettings["shellIntegrationTimeout"]>("shellIntegrationTimeout")
		const enableCheckpointsSettingRaw =
			context.globalState.get<GlobalStateAndSettings["enableCheckpointsSetting"]>("enableCheckpointsSetting")
		const mcpMarketplaceEnabledRaw =
			context.globalState.get<GlobalStateAndSettings["mcpMarketplaceEnabled"]>("mcpMarketplaceEnabled")
		const mcpDisplayMode = context.globalState.get<GlobalStateAndSettings["mcpDisplayMode"]>("mcpDisplayMode")
		const mcpResponsesCollapsedRaw =
			context.globalState.get<GlobalStateAndSettings["mcpResponsesCollapsed"]>("mcpResponsesCollapsed")
		const globalWorkflowToggles =
			context.globalState.get<GlobalStateAndSettings["globalWorkflowToggles"]>("globalWorkflowToggles")
		const terminalReuseEnabled =
			context.globalState.get<GlobalStateAndSettings["terminalReuseEnabled"]>("terminalReuseEnabled")
		const vscodeTerminalExecutionMode =
			context.globalState.get<GlobalStateAndSettings["vscodeTerminalExecutionMode"]>("vscodeTerminalExecutionMode")
		const terminalOutputLineLimit =
			context.globalState.get<GlobalStateAndSettings["terminalOutputLineLimit"]>("terminalOutputLineLimit")
		const maxConsecutiveMistakes =
			context.globalState.get<GlobalStateAndSettings["maxConsecutiveMistakes"]>("maxConsecutiveMistakes")
		const subagentTerminalOutputLineLimit = context.globalState.get<
			GlobalStateAndSettings["subagentTerminalOutputLineLimit"]
		>("subagentTerminalOutputLineLimit")
		const defaultTerminalProfile =
			context.globalState.get<GlobalStateAndSettings["defaultTerminalProfile"]>("defaultTerminalProfile")
		const sapAiCoreBaseUrl = context.globalState.get<GlobalStateAndSettings["sapAiCoreBaseUrl"]>("sapAiCoreBaseUrl")
		const sapAiCoreTokenUrl = context.globalState.get<GlobalStateAndSettings["sapAiCoreTokenUrl"]>("sapAiCoreTokenUrl")
		const sapAiResourceGroup = context.globalState.get<GlobalStateAndSettings["sapAiResourceGroup"]>("sapAiResourceGroup")
		const claudeCodePath = context.globalState.get<GlobalStateAndSettings["claudeCodePath"]>("claudeCodePath")
		const difyBaseUrl = context.globalState.get<GlobalStateAndSettings["difyBaseUrl"]>("difyBaseUrl")
		const ocaBaseUrl = context.globalState.get("ocaBaseUrl") as string | undefined
		const ocaMode = context.globalState.get("ocaMode") as string | undefined
		const openaiReasoningEffort =
			context.globalState.get<GlobalStateAndSettings["openaiReasoningEffort"]>("openaiReasoningEffort")
		const preferredLanguage = context.globalState.get<GlobalStateAndSettings["preferredLanguage"]>("preferredLanguage")
		const focusChainSettings = context.globalState.get<GlobalStateAndSettings["focusChainSettings"]>("focusChainSettings")
		const dictationSettings = context.globalState.get<GlobalStateAndSettings["dictationSettings"]>("dictationSettings") as
			| DictationSettings
			| undefined
		const lastDismissedInfoBannerVersion =
			context.globalState.get<GlobalStateAndSettings["lastDismissedInfoBannerVersion"]>("lastDismissedInfoBannerVersion")
		const lastDismissedModelBannerVersion = context.globalState.get<
			GlobalStateAndSettings["lastDismissedModelBannerVersion"]
		>("lastDismissedModelBannerVersion")
		const lastDismissedCliBannerVersion =
			context.globalState.get<GlobalStateAndSettings["lastDismissedCliBannerVersion"]>("lastDismissedCliBannerVersion")
		const dismissedBanners = context.globalState.get<GlobalStateAndSettings["dismissedBanners"]>("dismissedBanners")
		const qwenCodeOauthPath = context.globalState.get<GlobalStateAndSettings["qwenCodeOauthPath"]>("qwenCodeOauthPath")
		const customPrompt = context.globalState.get<GlobalStateAndSettings["customPrompt"]>("customPrompt")
		const autoCondenseThreshold =
			context.globalState.get<GlobalStateAndSettings["autoCondenseThreshold"]>("autoCondenseThreshold") // number from 0 to 1
		const hooksEnabled = context.globalState.get<GlobalStateAndSettings["hooksEnabled"]>("hooksEnabled")
		const enableParallelToolCalling =
			context.globalState.get<GlobalStateAndSettings["enableParallelToolCalling"]>("enableParallelToolCalling")
		const hicapModelId = context.globalState.get<GlobalStateAndSettings["hicapModelId"]>("hicapModelId")
		const aihubmixBaseUrl = context.globalState.get<GlobalStateAndSettings["aihubmixBaseUrl"]>("aihubmixBaseUrl")
		const aihubmixAppCode = context.globalState.get<GlobalStateAndSettings["aihubmixAppCode"]>("aihubmixAppCode")

		// OpenTelemetry configuration
		const openTelemetryEnabled =
			context.globalState.get<GlobalStateAndSettings["openTelemetryEnabled"]>("openTelemetryEnabled")
		const openTelemetryMetricsExporter =
			context.globalState.get<GlobalStateAndSettings["openTelemetryMetricsExporter"]>("openTelemetryMetricsExporter")
		const openTelemetryLogsExporter =
			context.globalState.get<GlobalStateAndSettings["openTelemetryLogsExporter"]>("openTelemetryLogsExporter")
		const openTelemetryOtlpProtocol =
			context.globalState.get<GlobalStateAndSettings["openTelemetryOtlpProtocol"]>("openTelemetryOtlpProtocol")
		const openTelemetryOtlpEndpoint =
			context.globalState.get<GlobalStateAndSettings["openTelemetryOtlpEndpoint"]>("openTelemetryOtlpEndpoint")
		const openTelemetryOtlpMetricsProtocol = context.globalState.get<
			GlobalStateAndSettings["openTelemetryOtlpMetricsProtocol"]
		>("openTelemetryOtlpMetricsProtocol")
		const openTelemetryOtlpMetricsEndpoint = context.globalState.get<
			GlobalStateAndSettings["openTelemetryOtlpMetricsEndpoint"]
		>("openTelemetryOtlpMetricsEndpoint")
		const openTelemetryOtlpLogsProtocol =
			context.globalState.get<GlobalStateAndSettings["openTelemetryOtlpLogsProtocol"]>("openTelemetryOtlpLogsProtocol")
		const openTelemetryOtlpLogsEndpoint =
			context.globalState.get<GlobalStateAndSettings["openTelemetryOtlpLogsEndpoint"]>("openTelemetryOtlpLogsEndpoint")
		const openTelemetryMetricExportInterval = context.globalState.get<
			GlobalStateAndSettings["openTelemetryMetricExportInterval"]
		>("openTelemetryMetricExportInterval")
		const openTelemetryOtlpInsecure =
			context.globalState.get<GlobalStateAndSettings["openTelemetryOtlpInsecure"]>("openTelemetryOtlpInsecure")
		const openTelemetryLogBatchSize =
			context.globalState.get<GlobalStateAndSettings["openTelemetryLogBatchSize"]>("openTelemetryLogBatchSize")
		const openTelemetryLogBatchTimeout =
			context.globalState.get<GlobalStateAndSettings["openTelemetryLogBatchTimeout"]>("openTelemetryLogBatchTimeout")
		const openTelemetryLogMaxQueueSize =
			context.globalState.get<GlobalStateAndSettings["openTelemetryLogMaxQueueSize"]>("openTelemetryLogMaxQueueSize")
		const subagentsEnabled = context.globalState.get<GlobalStateAndSettings["subagentsEnabled"]>("subagentsEnabled")
		const backgroundEditEnabled =
			context.globalState.get<GlobalStateAndSettings["backgroundEditEnabled"]>("backgroundEditEnabled")

		// Get mode-related configurations
		const mode = context.globalState.get<GlobalStateAndSettings["mode"]>("mode")

		// Plan mode configurations
		const planModeApiProvider = context.globalState.get<GlobalStateAndSettings["planModeApiProvider"]>("planModeApiProvider")
		const planModeApiModelId = context.globalState.get<GlobalStateAndSettings["planModeApiModelId"]>("planModeApiModelId")
		const planModeThinkingBudgetTokens =
			context.globalState.get<GlobalStateAndSettings["planModeThinkingBudgetTokens"]>("planModeThinkingBudgetTokens")
		const geminiPlanModeThinkingLevel =
			context.globalState.get<GlobalStateAndSettings["geminiPlanModeThinkingLevel"]>("geminiPlanModeThinkingLevel")
		const planModeReasoningEffort =
			context.globalState.get<GlobalStateAndSettings["planModeReasoningEffort"]>("planModeReasoningEffort")
		const planModeVsCodeLmModelSelector =
			context.globalState.get<GlobalStateAndSettings["planModeVsCodeLmModelSelector"]>("planModeVsCodeLmModelSelector")
		const planModeAwsBedrockCustomSelected = context.globalState.get<
			GlobalStateAndSettings["planModeAwsBedrockCustomSelected"]
		>("planModeAwsBedrockCustomSelected")
		const planModeAwsBedrockCustomModelBaseId = context.globalState.get<
			GlobalStateAndSettings["planModeAwsBedrockCustomModelBaseId"]
		>("planModeAwsBedrockCustomModelBaseId")
		const planModeOpenRouterModelId =
			context.globalState.get<GlobalStateAndSettings["planModeOpenRouterModelId"]>("planModeOpenRouterModelId")
		const planModeOpenRouterModelInfo =
			context.globalState.get<GlobalStateAndSettings["planModeOpenRouterModelInfo"]>("planModeOpenRouterModelInfo")
		const planModeOpenAiModelId =
			context.globalState.get<GlobalStateAndSettings["planModeOpenAiModelId"]>("planModeOpenAiModelId")
		const planModeOpenAiModelInfo =
			context.globalState.get<GlobalStateAndSettings["planModeOpenAiModelInfo"]>("planModeOpenAiModelInfo")
		const planModeOllamaModelId =
			context.globalState.get<GlobalStateAndSettings["planModeOllamaModelId"]>("planModeOllamaModelId")
		const planModeLmStudioModelId =
			context.globalState.get<GlobalStateAndSettings["planModeLmStudioModelId"]>("planModeLmStudioModelId")
		const planModeLiteLlmModelId =
			context.globalState.get<GlobalStateAndSettings["planModeLiteLlmModelId"]>("planModeLiteLlmModelId")
		const planModeLiteLlmModelInfo =
			context.globalState.get<GlobalStateAndSettings["planModeLiteLlmModelInfo"]>("planModeLiteLlmModelInfo")
		const planModeRequestyModelId =
			context.globalState.get<GlobalStateAndSettings["planModeRequestyModelId"]>("planModeRequestyModelId")
		const planModeRequestyModelInfo =
			context.globalState.get<GlobalStateAndSettings["planModeRequestyModelInfo"]>("planModeRequestyModelInfo")
		const planModeTogetherModelId =
			context.globalState.get<GlobalStateAndSettings["planModeTogetherModelId"]>("planModeTogetherModelId")
		const planModeFireworksModelId =
			context.globalState.get<GlobalStateAndSettings["planModeFireworksModelId"]>("planModeFireworksModelId")
		const planModeSapAiCoreModelId =
			context.globalState.get<GlobalStateAndSettings["planModeSapAiCoreModelId"]>("planModeSapAiCoreModelId")
		const planModeSapAiCoreDeploymentId =
			context.globalState.get<GlobalStateAndSettings["planModeSapAiCoreDeploymentId"]>("planModeSapAiCoreDeploymentId")
		const planModeGroqModelId = context.globalState.get<GlobalStateAndSettings["planModeGroqModelId"]>("planModeGroqModelId")
		const planModeGroqModelInfo =
			context.globalState.get<GlobalStateAndSettings["planModeGroqModelInfo"]>("planModeGroqModelInfo")
		const planModeHuggingFaceModelId =
			context.globalState.get<GlobalStateAndSettings["planModeHuggingFaceModelId"]>("planModeHuggingFaceModelId")
		const planModeHuggingFaceModelInfo =
			context.globalState.get<GlobalStateAndSettings["planModeHuggingFaceModelInfo"]>("planModeHuggingFaceModelInfo")
		const planModeHuaweiCloudMaasModelId =
			context.globalState.get<GlobalStateAndSettings["planModeHuaweiCloudMaasModelId"]>("planModeHuaweiCloudMaasModelId")
		const planModeHuaweiCloudMaasModelInfo = context.globalState.get<
			GlobalStateAndSettings["planModeHuaweiCloudMaasModelInfo"]
		>("planModeHuaweiCloudMaasModelInfo")
		const planModeBasetenModelId =
			context.globalState.get<GlobalStateAndSettings["planModeBasetenModelId"]>("planModeBasetenModelId")
		const planModeBasetenModelInfo =
			context.globalState.get<GlobalStateAndSettings["planModeBasetenModelInfo"]>("planModeBasetenModelInfo")
		const planModeOcaModelId = context.globalState.get("planModeOcaModelId") as string | undefined
		const planModeOcaModelInfo = context.globalState.get("planModeOcaModelInfo") as OcaModelInfo | undefined
		const planModeHicapModelId =
			context.globalState.get<GlobalStateAndSettings["planModeHicapModelId"]>("planModeHicapModelId")
		const planModeHicapModelInfo =
			context.globalState.get<GlobalStateAndSettings["planModeHicapModelInfo"]>("planModeHicapModelInfo")
		const planModeAihubmixModelId =
			context.globalState.get<GlobalStateAndSettings["planModeAihubmixModelId"]>("planModeAihubmixModelId")
		const planModeAihubmixModelInfo =
			context.globalState.get<GlobalStateAndSettings["planModeAihubmixModelInfo"]>("planModeAihubmixModelInfo")
		const planModeNousResearchModelId =
			context.globalState.get<GlobalStateAndSettings["planModeNousResearchModelId"]>("planModeNousResearchModelId")
		// Act mode configurations
		const actModeApiProvider = context.globalState.get<GlobalStateAndSettings["actModeApiProvider"]>("actModeApiProvider")
		const actModeApiModelId = context.globalState.get<GlobalStateAndSettings["actModeApiModelId"]>("actModeApiModelId")
		const actModeThinkingBudgetTokens =
			context.globalState.get<GlobalStateAndSettings["actModeThinkingBudgetTokens"]>("actModeThinkingBudgetTokens")
		const geminiActModeThinkingLevel =
			context.globalState.get<GlobalStateAndSettings["geminiActModeThinkingLevel"]>("geminiActModeThinkingLevel")
		const actModeReasoningEffort =
			context.globalState.get<GlobalStateAndSettings["actModeReasoningEffort"]>("actModeReasoningEffort")
		const actModeVsCodeLmModelSelector =
			context.globalState.get<GlobalStateAndSettings["actModeVsCodeLmModelSelector"]>("actModeVsCodeLmModelSelector")
		const actModeAwsBedrockCustomSelected = context.globalState.get<
			GlobalStateAndSettings["actModeAwsBedrockCustomSelected"]
		>("actModeAwsBedrockCustomSelected")
		const actModeAwsBedrockCustomModelBaseId = context.globalState.get<
			GlobalStateAndSettings["actModeAwsBedrockCustomModelBaseId"]
		>("actModeAwsBedrockCustomModelBaseId")
		const actModeOpenRouterModelId =
			context.globalState.get<GlobalStateAndSettings["actModeOpenRouterModelId"]>("actModeOpenRouterModelId")
		const actModeOpenRouterModelInfo =
			context.globalState.get<GlobalStateAndSettings["actModeOpenRouterModelInfo"]>("actModeOpenRouterModelInfo")
		const actModeOpenAiModelId =
			context.globalState.get<GlobalStateAndSettings["actModeOpenAiModelId"]>("actModeOpenAiModelId")
		const actModeOpenAiModelInfo =
			context.globalState.get<GlobalStateAndSettings["actModeOpenAiModelInfo"]>("actModeOpenAiModelInfo")
		const actModeOllamaModelId =
			context.globalState.get<GlobalStateAndSettings["actModeOllamaModelId"]>("actModeOllamaModelId")
		const actModeLmStudioModelId =
			context.globalState.get<GlobalStateAndSettings["actModeLmStudioModelId"]>("actModeLmStudioModelId")
		const actModeLiteLlmModelId =
			context.globalState.get<GlobalStateAndSettings["actModeLiteLlmModelId"]>("actModeLiteLlmModelId")
		const actModeLiteLlmModelInfo =
			context.globalState.get<GlobalStateAndSettings["actModeLiteLlmModelInfo"]>("actModeLiteLlmModelInfo")
		const actModeRequestyModelId =
			context.globalState.get<GlobalStateAndSettings["actModeRequestyModelId"]>("actModeRequestyModelId")
		const actModeRequestyModelInfo =
			context.globalState.get<GlobalStateAndSettings["actModeRequestyModelInfo"]>("actModeRequestyModelInfo")
		const actModeTogetherModelId =
			context.globalState.get<GlobalStateAndSettings["actModeTogetherModelId"]>("actModeTogetherModelId")
		const actModeFireworksModelId =
			context.globalState.get<GlobalStateAndSettings["actModeFireworksModelId"]>("actModeFireworksModelId")
		const actModeSapAiCoreModelId =
			context.globalState.get<GlobalStateAndSettings["actModeSapAiCoreModelId"]>("actModeSapAiCoreModelId")
		const actModeSapAiCoreDeploymentId =
			context.globalState.get<GlobalStateAndSettings["actModeSapAiCoreDeploymentId"]>("actModeSapAiCoreDeploymentId")
		const actModeGroqModelId = context.globalState.get<GlobalStateAndSettings["actModeGroqModelId"]>("actModeGroqModelId")
		const actModeGroqModelInfo =
			context.globalState.get<GlobalStateAndSettings["actModeGroqModelInfo"]>("actModeGroqModelInfo")
		const actModeHuggingFaceModelId =
			context.globalState.get<GlobalStateAndSettings["actModeHuggingFaceModelId"]>("actModeHuggingFaceModelId")
		const actModeHuggingFaceModelInfo =
			context.globalState.get<GlobalStateAndSettings["actModeHuggingFaceModelInfo"]>("actModeHuggingFaceModelInfo")
		const actModeHuaweiCloudMaasModelId =
			context.globalState.get<GlobalStateAndSettings["actModeHuaweiCloudMaasModelId"]>("actModeHuaweiCloudMaasModelId")
		const actModeHuaweiCloudMaasModelInfo = context.globalState.get<
			GlobalStateAndSettings["actModeHuaweiCloudMaasModelInfo"]
		>("actModeHuaweiCloudMaasModelInfo")
		const actModeBasetenModelId =
			context.globalState.get<GlobalStateAndSettings["actModeBasetenModelId"]>("actModeBasetenModelId")
		const actModeBasetenModelInfo =
			context.globalState.get<GlobalStateAndSettings["actModeBasetenModelInfo"]>("actModeBasetenModelInfo")
		const actModeOcaModelId = context.globalState.get("actModeOcaModelId") as string | undefined
		const actModeOcaModelInfo = context.globalState.get("actModeOcaModelInfo") as OcaModelInfo | undefined
		const actModeNousResearchModelId =
			context.globalState.get<GlobalStateAndSettings["actModeNousResearchModelId"]>("actModeNousResearchModelId")
		const sapAiCoreUseOrchestrationMode =
			context.globalState.get<GlobalStateAndSettings["sapAiCoreUseOrchestrationMode"]>("sapAiCoreUseOrchestrationMode")
		const actModeHicapModelId = context.globalState.get<GlobalStateAndSettings["actModeHicapModelId"]>("actModeHicapModelId")
		const actModeHicapModelInfo =
			context.globalState.get<GlobalStateAndSettings["actModeHicapModelInfo"]>("actModeHicapModelInfo")
		const actModeAihubmixModelId =
			context.globalState.get<GlobalStateAndSettings["actModeAihubmixModelId"]>("actModeAihubmixModelId")
		const actModeAihubmixModelInfo =
			context.globalState.get<GlobalStateAndSettings["actModeAihubmixModelInfo"]>("actModeAihubmixModelInfo")

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
		const workspaceRoots = context.globalState.get<GlobalStateAndSettings["workspaceRoots"]>("workspaceRoots")
		/**
		 * Get primary root index from global state.
		 * The primary root is the main workspace folder that Cline focuses on when dealing with
		 * multi-root workspaces. In VS Code, you can have multiple folders open in one workspace,
		 * and the primary root index indicates which folder (by its position in the array, 0-based)
		 * should be treated as the main/default working directory for operations.
		 */
		const primaryRootIndex = context.globalState.get<GlobalStateAndSettings["primaryRootIndex"]>("primaryRootIndex")
		const multiRootEnabled = context.globalState.get<GlobalStateAndSettings["multiRootEnabled"]>("multiRootEnabled")
		const nativeToolCallEnabled =
			context.globalState.get<GlobalStateAndSettings["nativeToolCallEnabled"]>("nativeToolCallEnabled")
		const remoteRulesToggles = context.globalState.get<GlobalStateAndSettings["remoteRulesToggles"]>("remoteRulesToggles")
		const remoteWorkflowToggles =
			context.globalState.get<GlobalStateAndSettings["remoteWorkflowToggles"]>("remoteWorkflowToggles")

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
			azureIdentity,
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
	const context = controller.context
	await Promise.all(context.workspaceState.keys().map((key) => controller.context.workspaceState.update(key, undefined)))

	await controller.stateManager.reInitialize()
}

export async function resetGlobalState(controller: Controller) {
	// TODO: Reset all workspace states?
	const context = controller.context

	await Promise.all(context.globalState.keys().map((key) => context.globalState.update(key, undefined)))
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
	await Promise.all(secretKeys.map((key) => context.secrets.delete(key)))
	await controller.stateManager.reInitialize()
}
