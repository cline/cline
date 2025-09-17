import { ApiProvider, fireworksDefaultModelId } from "@shared/api"
import { ExtensionContext } from "vscode"
import { Controller } from "@/core/controller"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@/shared/AutoApprovalSettings"
import { DEFAULT_BROWSER_SETTINGS } from "@/shared/BrowserSettings"
import { ClineRulesToggles } from "@/shared/cline-rules"
import { DEFAULT_FOCUS_CHAIN_SETTINGS } from "@/shared/FocusChainSettings"
import { DEFAULT_MCP_DISPLAY_MODE } from "@/shared/McpDisplayMode"
import { OpenaiReasoningEffort } from "@/shared/storage/types"
import { readTaskHistoryFromState } from "../disk"
import { GlobalState, LocalState, SecretKey, Secrets } from "../state-keys"

export async function readSecretsFromDisk(context: ExtensionContext): Promise<Secrets> {
	const [
		apiKey,
		openRouterApiKey,
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
	] = await Promise.all([
		context.secrets.get("apiKey") as Promise<Secrets["apiKey"]>,
		context.secrets.get("openRouterApiKey") as Promise<Secrets["openRouterApiKey"]>,
		context.secrets.get("clineAccountId") as Promise<Secrets["clineAccountId"]>,
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
	])

	return {
		authNonce,
		apiKey,
		openRouterApiKey,
		clineAccountId,
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
	}
}

export async function readWorkspaceStateFromDisk(context: ExtensionContext): Promise<LocalState> {
	const localClineRulesToggles = context.workspaceState.get("localClineRulesToggles") as ClineRulesToggles | undefined
	const localWindsurfRulesToggles = context.workspaceState.get("localWindsurfRulesToggles") as ClineRulesToggles | undefined
	const localCursorRulesToggles = context.workspaceState.get("localCursorRulesToggles") as ClineRulesToggles | undefined
	const localWorkflowToggles = context.workspaceState.get("workflowToggles") as ClineRulesToggles | undefined

	return {
		localClineRulesToggles: localClineRulesToggles || {},
		localWindsurfRulesToggles: localWindsurfRulesToggles || {},
		localCursorRulesToggles: localCursorRulesToggles || {},
		workflowToggles: localWorkflowToggles || {},
	}
}

export async function readGlobalStateFromDisk(context: ExtensionContext): Promise<GlobalState> {
	try {
		// Get all global state values
		const strictPlanModeEnabled = context.globalState.get<GlobalState["strictPlanModeEnabled"]>("strictPlanModeEnabled")
		const yoloModeToggled = context.globalState.get<GlobalState["yoloModeToggled"]>("yoloModeToggled")
		const useAutoCondense = context.globalState.get<GlobalState["useAutoCondense"]>("useAutoCondense")
		const isNewUser = context.globalState.get<GlobalState["isNewUser"]>("isNewUser")
		const welcomeViewCompleted = context.globalState.get<GlobalState["welcomeViewCompleted"]>("welcomeViewCompleted")
		const awsRegion = context.globalState.get<GlobalState["awsRegion"]>("awsRegion")
		const awsUseCrossRegionInference =
			context.globalState.get<GlobalState["awsUseCrossRegionInference"]>("awsUseCrossRegionInference")
		const awsBedrockUsePromptCache =
			context.globalState.get<GlobalState["awsBedrockUsePromptCache"]>("awsBedrockUsePromptCache")
		const awsBedrockEndpoint = context.globalState.get<GlobalState["awsBedrockEndpoint"]>("awsBedrockEndpoint")
		const awsProfile = context.globalState.get<GlobalState["awsProfile"]>("awsProfile")
		const awsUseProfile = context.globalState.get<GlobalState["awsUseProfile"]>("awsUseProfile")
		const awsAuthentication = context.globalState.get<GlobalState["awsAuthentication"]>("awsAuthentication")
		const vertexProjectId = context.globalState.get<GlobalState["vertexProjectId"]>("vertexProjectId")
		const vertexRegion = context.globalState.get<GlobalState["vertexRegion"]>("vertexRegion")
		const openAiBaseUrl = context.globalState.get<GlobalState["openAiBaseUrl"]>("openAiBaseUrl")
		const requestyBaseUrl = context.globalState.get<GlobalState["requestyBaseUrl"]>("requestyBaseUrl")
		const openAiHeaders = context.globalState.get<GlobalState["openAiHeaders"]>("openAiHeaders")
		const ollamaBaseUrl = context.globalState.get<GlobalState["ollamaBaseUrl"]>("ollamaBaseUrl")
		const ollamaApiOptionsCtxNum = context.globalState.get<GlobalState["ollamaApiOptionsCtxNum"]>("ollamaApiOptionsCtxNum")
		const lmStudioBaseUrl = context.globalState.get<GlobalState["lmStudioBaseUrl"]>("lmStudioBaseUrl")
		const lmStudioMaxTokens = context.globalState.get<GlobalState["lmStudioMaxTokens"]>("lmStudioMaxTokens")
		const anthropicBaseUrl = context.globalState.get<GlobalState["anthropicBaseUrl"]>("anthropicBaseUrl")
		const geminiBaseUrl = context.globalState.get<GlobalState["geminiBaseUrl"]>("geminiBaseUrl")
		const azureApiVersion = context.globalState.get<GlobalState["azureApiVersion"]>("azureApiVersion")
		const openRouterProviderSorting =
			context.globalState.get<GlobalState["openRouterProviderSorting"]>("openRouterProviderSorting")
		const lastShownAnnouncementId = context.globalState.get<GlobalState["lastShownAnnouncementId"]>("lastShownAnnouncementId")
		const autoApprovalSettings = context.globalState.get<GlobalState["autoApprovalSettings"]>("autoApprovalSettings")
		const browserSettings = context.globalState.get<GlobalState["browserSettings"]>("browserSettings")
		const liteLlmBaseUrl = context.globalState.get<GlobalState["liteLlmBaseUrl"]>("liteLlmBaseUrl")
		const liteLlmUsePromptCache = context.globalState.get<GlobalState["liteLlmUsePromptCache"]>("liteLlmUsePromptCache")
		const fireworksModelMaxCompletionTokens = context.globalState.get<GlobalState["fireworksModelMaxCompletionTokens"]>(
			"fireworksModelMaxCompletionTokens",
		)
		const fireworksModelMaxTokens = context.globalState.get<GlobalState["fireworksModelMaxTokens"]>("fireworksModelMaxTokens")
		const userInfo = context.globalState.get<GlobalState["userInfo"]>("userInfo")
		const qwenApiLine = context.globalState.get<GlobalState["qwenApiLine"]>("qwenApiLine")
		const moonshotApiLine = context.globalState.get<GlobalState["moonshotApiLine"]>("moonshotApiLine")
		const zaiApiLine = context.globalState.get<GlobalState["zaiApiLine"]>("zaiApiLine")
		const telemetrySetting = context.globalState.get<GlobalState["telemetrySetting"]>("telemetrySetting")
		const asksageApiUrl = context.globalState.get<GlobalState["asksageApiUrl"]>("asksageApiUrl")
		const planActSeparateModelsSettingRaw =
			context.globalState.get<GlobalState["planActSeparateModelsSetting"]>("planActSeparateModelsSetting")
		const favoritedModelIds = context.globalState.get<GlobalState["favoritedModelIds"]>("favoritedModelIds")
		const globalClineRulesToggles = context.globalState.get<GlobalState["globalClineRulesToggles"]>("globalClineRulesToggles")
		const requestTimeoutMs = context.globalState.get<GlobalState["requestTimeoutMs"]>("requestTimeoutMs")
		const shellIntegrationTimeout = context.globalState.get<GlobalState["shellIntegrationTimeout"]>("shellIntegrationTimeout")
		const enableCheckpointsSettingRaw =
			context.globalState.get<GlobalState["enableCheckpointsSetting"]>("enableCheckpointsSetting")
		const mcpMarketplaceEnabledRaw = context.globalState.get<GlobalState["mcpMarketplaceEnabled"]>("mcpMarketplaceEnabled")
		const mcpDisplayMode = context.globalState.get<GlobalState["mcpDisplayMode"]>("mcpDisplayMode")
		const mcpResponsesCollapsedRaw = context.globalState.get<GlobalState["mcpResponsesCollapsed"]>("mcpResponsesCollapsed")
		const globalWorkflowToggles = context.globalState.get<GlobalState["globalWorkflowToggles"]>("globalWorkflowToggles")
		const terminalReuseEnabled = context.globalState.get<GlobalState["terminalReuseEnabled"]>("terminalReuseEnabled")
		const terminalOutputLineLimit = context.globalState.get<GlobalState["terminalOutputLineLimit"]>("terminalOutputLineLimit")
		const defaultTerminalProfile = context.globalState.get<GlobalState["defaultTerminalProfile"]>("defaultTerminalProfile")
		const sapAiCoreBaseUrl = context.globalState.get<GlobalState["sapAiCoreBaseUrl"]>("sapAiCoreBaseUrl")
		const sapAiCoreTokenUrl = context.globalState.get<GlobalState["sapAiCoreTokenUrl"]>("sapAiCoreTokenUrl")
		const sapAiResourceGroup = context.globalState.get<GlobalState["sapAiResourceGroup"]>("sapAiResourceGroup")
		const claudeCodePath = context.globalState.get<GlobalState["claudeCodePath"]>("claudeCodePath")
		const difyBaseUrl = context.globalState.get<GlobalState["difyBaseUrl"]>("difyBaseUrl")
		const openaiReasoningEffort = context.globalState.get<GlobalState["openaiReasoningEffort"]>("openaiReasoningEffort")
		const preferredLanguage = context.globalState.get<GlobalState["preferredLanguage"]>("preferredLanguage")
		const focusChainSettings = context.globalState.get<GlobalState["focusChainSettings"]>("focusChainSettings")

		const mcpMarketplaceCatalog = context.globalState.get<GlobalState["mcpMarketplaceCatalog"]>("mcpMarketplaceCatalog")
		const qwenCodeOauthPath = context.globalState.get<GlobalState["qwenCodeOauthPath"]>("qwenCodeOauthPath")
		const customPrompt = context.globalState.get<GlobalState["customPrompt"]>("customPrompt")

		// Get mode-related configurations
		const mode = context.globalState.get<GlobalState["mode"]>("mode")

		// Plan mode configurations
		const planModeApiProvider = context.globalState.get<GlobalState["planModeApiProvider"]>("planModeApiProvider")
		const planModeApiModelId = context.globalState.get<GlobalState["planModeApiModelId"]>("planModeApiModelId")
		const planModeThinkingBudgetTokens =
			context.globalState.get<GlobalState["planModeThinkingBudgetTokens"]>("planModeThinkingBudgetTokens")
		const planModeReasoningEffort = context.globalState.get<GlobalState["planModeReasoningEffort"]>("planModeReasoningEffort")
		const planModeVsCodeLmModelSelector =
			context.globalState.get<GlobalState["planModeVsCodeLmModelSelector"]>("planModeVsCodeLmModelSelector")
		const planModeAwsBedrockCustomSelected = context.globalState.get<GlobalState["planModeAwsBedrockCustomSelected"]>(
			"planModeAwsBedrockCustomSelected",
		)
		const planModeAwsBedrockCustomModelBaseId = context.globalState.get<GlobalState["planModeAwsBedrockCustomModelBaseId"]>(
			"planModeAwsBedrockCustomModelBaseId",
		)
		const planModeOpenRouterModelId =
			context.globalState.get<GlobalState["planModeOpenRouterModelId"]>("planModeOpenRouterModelId")
		const planModeOpenRouterModelInfo =
			context.globalState.get<GlobalState["planModeOpenRouterModelInfo"]>("planModeOpenRouterModelInfo")
		const planModeOpenAiModelId = context.globalState.get<GlobalState["planModeOpenAiModelId"]>("planModeOpenAiModelId")
		const planModeOpenAiModelInfo = context.globalState.get<GlobalState["planModeOpenAiModelInfo"]>("planModeOpenAiModelInfo")
		const planModeOllamaModelId = context.globalState.get<GlobalState["planModeOllamaModelId"]>("planModeOllamaModelId")
		const planModeLmStudioModelId = context.globalState.get<GlobalState["planModeLmStudioModelId"]>("planModeLmStudioModelId")
		const planModeLiteLlmModelId = context.globalState.get<GlobalState["planModeLiteLlmModelId"]>("planModeLiteLlmModelId")
		const planModeLiteLlmModelInfo =
			context.globalState.get<GlobalState["planModeLiteLlmModelInfo"]>("planModeLiteLlmModelInfo")
		const planModeRequestyModelId = context.globalState.get<GlobalState["planModeRequestyModelId"]>("planModeRequestyModelId")
		const planModeRequestyModelInfo =
			context.globalState.get<GlobalState["planModeRequestyModelInfo"]>("planModeRequestyModelInfo")
		const planModeTogetherModelId = context.globalState.get<GlobalState["planModeTogetherModelId"]>("planModeTogetherModelId")
		const planModeFireworksModelId =
			context.globalState.get<GlobalState["planModeFireworksModelId"]>("planModeFireworksModelId")
		const planModeSapAiCoreModelId =
			context.globalState.get<GlobalState["planModeSapAiCoreModelId"]>("planModeSapAiCoreModelId")
		const planModeSapAiCoreDeploymentId =
			context.globalState.get<GlobalState["planModeSapAiCoreDeploymentId"]>("planModeSapAiCoreDeploymentId")
		const planModeGroqModelId = context.globalState.get<GlobalState["planModeGroqModelId"]>("planModeGroqModelId")
		const planModeGroqModelInfo = context.globalState.get<GlobalState["planModeGroqModelInfo"]>("planModeGroqModelInfo")
		const planModeHuggingFaceModelId =
			context.globalState.get<GlobalState["planModeHuggingFaceModelId"]>("planModeHuggingFaceModelId")
		const planModeHuggingFaceModelInfo =
			context.globalState.get<GlobalState["planModeHuggingFaceModelInfo"]>("planModeHuggingFaceModelInfo")
		const planModeHuaweiCloudMaasModelId =
			context.globalState.get<GlobalState["planModeHuaweiCloudMaasModelId"]>("planModeHuaweiCloudMaasModelId")
		const planModeHuaweiCloudMaasModelInfo = context.globalState.get<GlobalState["planModeHuaweiCloudMaasModelInfo"]>(
			"planModeHuaweiCloudMaasModelInfo",
		)
		const planModeBasetenModelId = context.globalState.get<GlobalState["planModeBasetenModelId"]>("planModeBasetenModelId")
		const planModeBasetenModelInfo =
			context.globalState.get<GlobalState["planModeBasetenModelInfo"]>("planModeBasetenModelInfo")
		const planModeVercelAiGatewayModelId =
			context.globalState.get<GlobalState["planModeVercelAiGatewayModelId"]>("planModeVercelAiGatewayModelId")
		const planModeVercelAiGatewayModelInfo = context.globalState.get<GlobalState["planModeVercelAiGatewayModelInfo"]>(
			"planModeVercelAiGatewayModelInfo",
		)
		// Act mode configurations
		const actModeApiProvider = context.globalState.get<GlobalState["actModeApiProvider"]>("actModeApiProvider")
		const actModeApiModelId = context.globalState.get<GlobalState["actModeApiModelId"]>("actModeApiModelId")
		const actModeThinkingBudgetTokens =
			context.globalState.get<GlobalState["actModeThinkingBudgetTokens"]>("actModeThinkingBudgetTokens")
		const actModeReasoningEffort = context.globalState.get<GlobalState["actModeReasoningEffort"]>("actModeReasoningEffort")
		const actModeVsCodeLmModelSelector =
			context.globalState.get<GlobalState["actModeVsCodeLmModelSelector"]>("actModeVsCodeLmModelSelector")
		const actModeAwsBedrockCustomSelected = context.globalState.get<GlobalState["actModeAwsBedrockCustomSelected"]>(
			"actModeAwsBedrockCustomSelected",
		)
		const actModeAwsBedrockCustomModelBaseId = context.globalState.get<GlobalState["actModeAwsBedrockCustomModelBaseId"]>(
			"actModeAwsBedrockCustomModelBaseId",
		)
		const actModeOpenRouterModelId =
			context.globalState.get<GlobalState["actModeOpenRouterModelId"]>("actModeOpenRouterModelId")
		const actModeOpenRouterModelInfo =
			context.globalState.get<GlobalState["actModeOpenRouterModelInfo"]>("actModeOpenRouterModelInfo")
		const actModeOpenAiModelId = context.globalState.get<GlobalState["actModeOpenAiModelId"]>("actModeOpenAiModelId")
		const actModeOpenAiModelInfo = context.globalState.get<GlobalState["actModeOpenAiModelInfo"]>("actModeOpenAiModelInfo")
		const actModeOllamaModelId = context.globalState.get<GlobalState["actModeOllamaModelId"]>("actModeOllamaModelId")
		const actModeLmStudioModelId = context.globalState.get<GlobalState["actModeLmStudioModelId"]>("actModeLmStudioModelId")
		const actModeLiteLlmModelId = context.globalState.get<GlobalState["actModeLiteLlmModelId"]>("actModeLiteLlmModelId")
		const actModeLiteLlmModelInfo = context.globalState.get<GlobalState["actModeLiteLlmModelInfo"]>("actModeLiteLlmModelInfo")
		const actModeRequestyModelId = context.globalState.get<GlobalState["actModeRequestyModelId"]>("actModeRequestyModelId")
		const actModeRequestyModelInfo =
			context.globalState.get<GlobalState["actModeRequestyModelInfo"]>("actModeRequestyModelInfo")
		const actModeTogetherModelId = context.globalState.get<GlobalState["actModeTogetherModelId"]>("actModeTogetherModelId")
		const actModeFireworksModelId = context.globalState.get<GlobalState["actModeFireworksModelId"]>("actModeFireworksModelId")
		const actModeSapAiCoreModelId = context.globalState.get<GlobalState["actModeSapAiCoreModelId"]>("actModeSapAiCoreModelId")
		const actModeSapAiCoreDeploymentId =
			context.globalState.get<GlobalState["actModeSapAiCoreDeploymentId"]>("actModeSapAiCoreDeploymentId")
		const actModeGroqModelId = context.globalState.get<GlobalState["actModeGroqModelId"]>("actModeGroqModelId")
		const actModeGroqModelInfo = context.globalState.get<GlobalState["actModeGroqModelInfo"]>("actModeGroqModelInfo")
		const actModeHuggingFaceModelId =
			context.globalState.get<GlobalState["actModeHuggingFaceModelId"]>("actModeHuggingFaceModelId")
		const actModeHuggingFaceModelInfo =
			context.globalState.get<GlobalState["actModeHuggingFaceModelInfo"]>("actModeHuggingFaceModelInfo")
		const actModeHuaweiCloudMaasModelId =
			context.globalState.get<GlobalState["actModeHuaweiCloudMaasModelId"]>("actModeHuaweiCloudMaasModelId")
		const actModeHuaweiCloudMaasModelInfo = context.globalState.get<GlobalState["actModeHuaweiCloudMaasModelInfo"]>(
			"actModeHuaweiCloudMaasModelInfo",
		)
		const actModeBasetenModelId = context.globalState.get<GlobalState["actModeBasetenModelId"]>("actModeBasetenModelId")
		const actModeBasetenModelInfo = context.globalState.get<GlobalState["actModeBasetenModelInfo"]>("actModeBasetenModelInfo")
		const actModeVercelAiGatewayModelId =
			context.globalState.get<GlobalState["actModeVercelAiGatewayModelId"]>("actModeVercelAiGatewayModelId")
		const actModeVercelAiGatewayModelInfo = context.globalState.get<GlobalState["actModeVercelAiGatewayModelInfo"]>(
			"actModeVercelAiGatewayModelInfo",
		)
		const sapAiCoreUseOrchestrationMode =
			context.globalState.get<GlobalState["sapAiCoreUseOrchestrationMode"]>("sapAiCoreUseOrchestrationMode")

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
			// default to true for existing users
			if (planModeApiProvider) {
				planActSeparateModelsSetting = true
			} else {
				// default to false for new users
				planActSeparateModelsSetting = false
			}
		}

		const taskHistory = await readTaskHistoryFromState(context)

		// Multi-root workspace support
		const workspaceRoots = context.globalState.get<GlobalState["workspaceRoots"]>("workspaceRoots")
		/**
		 * Get primary root index from global state.
		 * The primary root is the main workspace folder that Cline focuses on when dealing with
		 * multi-root workspaces. In VS Code, you can have multiple folders open in one workspace,
		 * and the primary root index indicates which folder (by its position in the array, 0-based)
		 * should be treated as the main/default working directory for operations.
		 */
		const primaryRootIndex = context.globalState.get<GlobalState["primaryRootIndex"]>("primaryRootIndex")
		const multiRootEnabled = context.globalState.get<GlobalState["multiRootEnabled"]>("multiRootEnabled")

		return {
			// api configuration fields
			claudeCodePath,
			awsRegion,
			awsUseCrossRegionInference,
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
			// Plan mode configurations
			planModeApiProvider: planModeApiProvider || apiProvider,
			planModeApiModelId,
			planModeThinkingBudgetTokens,
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
			planModeVercelAiGatewayModelId,
			planModeVercelAiGatewayModelInfo,
			// Act mode configurations
			actModeApiProvider: actModeApiProvider || apiProvider,
			actModeApiModelId,
			actModeThinkingBudgetTokens,
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
			actModeVercelAiGatewayModelId,
			actModeVercelAiGatewayModelInfo,

			// Other global fields
			focusChainSettings: focusChainSettings || DEFAULT_FOCUS_CHAIN_SETTINGS,
			strictPlanModeEnabled: strictPlanModeEnabled ?? true,
			yoloModeToggled: yoloModeToggled ?? false,
			useAutoCondense: useAutoCondense ?? false,
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
			planActSeparateModelsSetting,
			enableCheckpointsSetting: enableCheckpointsSettingRaw ?? true,
			shellIntegrationTimeout: shellIntegrationTimeout || 4000,
			terminalReuseEnabled: terminalReuseEnabled ?? true,
			terminalOutputLineLimit: terminalOutputLineLimit ?? 500,
			defaultTerminalProfile: defaultTerminalProfile ?? "default",
			globalWorkflowToggles: globalWorkflowToggles || {},
			mcpMarketplaceCatalog,
			qwenCodeOauthPath,
			customPrompt,
			// Multi-root workspace support
			workspaceRoots,
			primaryRootIndex: primaryRootIndex ?? 0,
			// Feature flag - defaults to false
			// For now, always return false to disable multi-root support by default
			multiRootEnabled: multiRootEnabled ?? false,
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
	]
	await Promise.all(secretKeys.map((key) => context.secrets.delete(key)))
	await controller.stateManager.reInitialize()
}
