import { ExtensionContext } from "vscode"
import { ApiProvider, BedrockModelId, ModelInfo } from "@shared/api"
import { LanguageModelChatSelector } from "vscode"
import { ClineRulesToggles } from "@/shared/cline-rules"
import { DEFAULT_MCP_DISPLAY_MODE, McpDisplayMode } from "@/shared/McpDisplayMode"
import { TelemetrySetting } from "@/shared/TelemetrySetting"
import { UserInfo } from "@/shared/UserInfo"
import { BrowserSettings, DEFAULT_BROWSER_SETTINGS } from "@/shared/BrowserSettings"
import { HistoryItem } from "@/shared/HistoryItem"
import { AutoApprovalSettings, DEFAULT_AUTO_APPROVAL_SETTINGS } from "@/shared/AutoApprovalSettings"
import { Mode, OpenaiReasoningEffort } from "@/shared/storage/types"
import { SecretKey } from "../state-keys"
import { Controller } from "@/core/controller"

export async function readStateFromDisk(context: ExtensionContext) {
	// Get all global state values
	const strictPlanModeEnabled = context.globalState.get("strictPlanModeEnabled") as boolean | undefined
	const isNewUser = context.globalState.get("isNewUser") as boolean | undefined
	const welcomeViewCompleted = context.globalState.get("welcomeViewCompleted") as boolean | undefined
	const awsRegion = context.globalState.get("awsRegion") as string | undefined
	const awsUseCrossRegionInference = context.globalState.get("awsUseCrossRegionInference") as boolean | undefined
	const awsBedrockUsePromptCache = context.globalState.get("awsBedrockUsePromptCache") as boolean | undefined
	const awsBedrockEndpoint = context.globalState.get("awsBedrockEndpoint") as string | undefined
	const awsProfile = context.globalState.get("awsProfile") as string | undefined
	const awsUseProfile = context.globalState.get("awsUseProfile") as boolean | undefined
	const awsAuthentication = context.globalState.get("awsAuthentication") as string | undefined
	const vertexProjectId = context.globalState.get("vertexProjectId") as string | undefined
	const vertexRegion = context.globalState.get("vertexRegion") as string | undefined
	const openAiBaseUrl = context.globalState.get("openAiBaseUrl") as string | undefined
	const requestyBaseUrl = context.globalState.get("requestyBaseUrl") as string | undefined
	const openAiHeaders = context.globalState.get("openAiHeaders") as Record<string, string> | undefined
	const ollamaBaseUrl = context.globalState.get("ollamaBaseUrl") as string | undefined
	const ollamaApiOptionsCtxNum = context.globalState.get("ollamaApiOptionsCtxNum") as string | undefined
	const lmStudioBaseUrl = context.globalState.get("lmStudioBaseUrl") as string | undefined
	const anthropicBaseUrl = context.globalState.get("anthropicBaseUrl") as string | undefined
	const geminiBaseUrl = context.globalState.get("geminiBaseUrl") as string | undefined
	const azureApiVersion = context.globalState.get("azureApiVersion") as string | undefined
	const openRouterProviderSorting = context.globalState.get("openRouterProviderSorting") as string | undefined
	const lastShownAnnouncementId = context.globalState.get("lastShownAnnouncementId") as string | undefined
	const taskHistory = context.globalState.get("taskHistory") as HistoryItem[] | undefined
	const autoApprovalSettings = context.globalState.get("autoApprovalSettings") as AutoApprovalSettings | undefined
	const browserSettings = context.globalState.get("browserSettings") as BrowserSettings | undefined
	const liteLlmBaseUrl = context.globalState.get("liteLlmBaseUrl") as string | undefined
	const liteLlmUsePromptCache = context.globalState.get("liteLlmUsePromptCache") as boolean | undefined
	const fireworksModelMaxCompletionTokens = context.globalState.get("fireworksModelMaxCompletionTokens") as number | undefined
	const fireworksModelMaxTokens = context.globalState.get("fireworksModelMaxTokens") as number | undefined
	const userInfo = context.globalState.get("userInfo") as UserInfo | undefined
	const qwenApiLine = context.globalState.get("qwenApiLine") as string | undefined
	const moonshotApiLine = context.globalState.get("moonshotApiLine") as string | undefined
	const telemetrySetting = context.globalState.get("telemetrySetting") as TelemetrySetting | undefined
	const asksageApiUrl = context.globalState.get("asksageApiUrl") as string | undefined
	const planActSeparateModelsSettingRaw = context.globalState.get("planActSeparateModelsSetting") as boolean | undefined
	const favoritedModelIds = context.globalState.get("favoritedModelIds") as string[] | undefined
	const globalClineRulesToggles = context.globalState.get("globalClineRulesToggles") as ClineRulesToggles | undefined
	const requestTimeoutMs = context.globalState.get("requestTimeoutMs") as number | undefined
	const shellIntegrationTimeout = context.globalState.get("shellIntegrationTimeout") as number | undefined
	const enableCheckpointsSettingRaw = context.globalState.get("enableCheckpointsSetting") as boolean | undefined
	const mcpMarketplaceEnabledRaw = context.globalState.get("mcpMarketplaceEnabled") as boolean | undefined
	const mcpDisplayMode = context.globalState.get("mcpDisplayMode") as McpDisplayMode | undefined
	const mcpResponsesCollapsedRaw = context.globalState.get("mcpResponsesCollapsed") as boolean | undefined
	const globalWorkflowToggles = context.globalState.get("globalWorkflowToggles") as ClineRulesToggles | undefined
	const terminalReuseEnabled = context.globalState.get("terminalReuseEnabled") as boolean | undefined
	const terminalOutputLineLimit = context.globalState.get("terminalOutputLineLimit") as number | undefined
	const defaultTerminalProfile = context.globalState.get("defaultTerminalProfile") as string | undefined
	const sapAiCoreBaseUrl = context.globalState.get("sapAiCoreBaseUrl") as string | undefined
	const sapAiCoreTokenUrl = context.globalState.get("sapAiCoreTokenUrl") as string | undefined
	const sapAiResourceGroup = context.globalState.get("sapAiResourceGroup") as string | undefined
	const claudeCodePath = context.globalState.get("claudeCodePath") as string | undefined
	const openaiReasoningEffort = context.globalState.get("openaiReasoningEffort") as OpenaiReasoningEffort | undefined
	const preferredLanguage = context.globalState.get("preferredLanguage") as string | undefined

	// Get all secret values
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
		ollamaApiKey,
	] = await Promise.all([
		context.secrets.get("apiKey") as Promise<string | undefined>,
		context.secrets.get("openRouterApiKey") as Promise<string | undefined>,
		context.secrets.get("clineAccountId") as Promise<string | undefined>,
		context.secrets.get("awsAccessKey") as Promise<string | undefined>,
		context.secrets.get("awsSecretKey") as Promise<string | undefined>,
		context.secrets.get("awsSessionToken") as Promise<string | undefined>,
		context.secrets.get("awsBedrockApiKey") as Promise<string | undefined>,
		context.secrets.get("openAiApiKey") as Promise<string | undefined>,
		context.secrets.get("geminiApiKey") as Promise<string | undefined>,
		context.secrets.get("openAiNativeApiKey") as Promise<string | undefined>,
		context.secrets.get("deepSeekApiKey") as Promise<string | undefined>,
		context.secrets.get("requestyApiKey") as Promise<string | undefined>,
		context.secrets.get("togetherApiKey") as Promise<string | undefined>,
		context.secrets.get("qwenApiKey") as Promise<string | undefined>,
		context.secrets.get("doubaoApiKey") as Promise<string | undefined>,
		context.secrets.get("mistralApiKey") as Promise<string | undefined>,
		context.secrets.get("fireworksApiKey") as Promise<string | undefined>,
		context.secrets.get("liteLlmApiKey") as Promise<string | undefined>,
		context.secrets.get("asksageApiKey") as Promise<string | undefined>,
		context.secrets.get("xaiApiKey") as Promise<string | undefined>,
		context.secrets.get("sambanovaApiKey") as Promise<string | undefined>,
		context.secrets.get("cerebrasApiKey") as Promise<string | undefined>,
		context.secrets.get("groqApiKey") as Promise<string | undefined>,
		context.secrets.get("moonshotApiKey") as Promise<string | undefined>,
		context.secrets.get("nebiusApiKey") as Promise<string | undefined>,
		context.secrets.get("huggingFaceApiKey") as Promise<string | undefined>,
		context.secrets.get("sapAiCoreClientId") as Promise<string | undefined>,
		context.secrets.get("sapAiCoreClientSecret") as Promise<string | undefined>,
		context.secrets.get("huaweiCloudMaasApiKey") as Promise<string | undefined>,
		context.secrets.get("basetenApiKey") as Promise<string | undefined>,
		context.secrets.get("ollamaApiKey") as Promise<string | undefined>,
	])

	const localClineRulesToggles = context.workspaceState.get("localClineRulesToggles") as ClineRulesToggles | undefined
	const localWindsurfRulesToggles = context.workspaceState.get("localWindsurfRulesToggles") as ClineRulesToggles | undefined
	const localCursorRulesToggles = context.workspaceState.get("localCursorRulesToggles") as ClineRulesToggles | undefined
	const localWorkflowToggles = context.workspaceState.get("workflowToggles") as ClineRulesToggles | undefined

	// Get mode-related configurations
	const mode = context.globalState.get("mode") as Mode | undefined

	// Plan mode configurations
	const planModeApiProvider = context.globalState.get("planModeApiProvider") as ApiProvider | undefined
	const planModeApiModelId = context.globalState.get("planModeApiModelId") as string | undefined
	const planModeThinkingBudgetTokens = context.globalState.get("planModeThinkingBudgetTokens") as number | undefined
	const planModeReasoningEffort = context.globalState.get("planModeReasoningEffort") as string | undefined
	const planModeVsCodeLmModelSelector = context.globalState.get("planModeVsCodeLmModelSelector") as
		| LanguageModelChatSelector
		| undefined
	const planModeAwsBedrockCustomSelected = context.globalState.get("planModeAwsBedrockCustomSelected") as boolean | undefined
	const planModeAwsBedrockCustomModelBaseId = context.globalState.get("planModeAwsBedrockCustomModelBaseId") as
		| BedrockModelId
		| undefined
	const planModeOpenRouterModelId = context.globalState.get("planModeOpenRouterModelId") as string | undefined
	const planModeOpenRouterModelInfo = context.globalState.get("planModeOpenRouterModelInfo") as ModelInfo | undefined
	const planModeOpenAiModelId = context.globalState.get("planModeOpenAiModelId") as string | undefined
	const planModeOpenAiModelInfo = context.globalState.get("planModeOpenAiModelInfo") as ModelInfo | undefined
	const planModeOllamaModelId = context.globalState.get("planModeOllamaModelId") as string | undefined
	const planModeLmStudioModelId = context.globalState.get("planModeLmStudioModelId") as string | undefined
	const planModeLiteLlmModelId = context.globalState.get("planModeLiteLlmModelId") as string | undefined
	const planModeLiteLlmModelInfo = context.globalState.get("planModeLiteLlmModelInfo") as ModelInfo | undefined
	const planModeRequestyModelId = context.globalState.get("planModeRequestyModelId") as string | undefined
	const planModeRequestyModelInfo = context.globalState.get("planModeRequestyModelInfo") as ModelInfo | undefined
	const planModeTogetherModelId = context.globalState.get("planModeTogetherModelId") as string | undefined
	const planModeFireworksModelId = context.globalState.get("planModeFireworksModelId") as string | undefined
	const planModeSapAiCoreModelId = context.globalState.get("planModeSapAiCoreModelId") as string | undefined
	const planModeGroqModelId = context.globalState.get("planModeGroqModelId") as string | undefined
	const planModeGroqModelInfo = context.globalState.get("planModeGroqModelInfo") as ModelInfo | undefined
	const planModeHuggingFaceModelId = context.globalState.get("planModeHuggingFaceModelId") as string | undefined
	const planModeHuggingFaceModelInfo = context.globalState.get("planModeHuggingFaceModelInfo") as ModelInfo | undefined
	const planModeHuaweiCloudMaasModelId = context.globalState.get("planModeHuaweiCloudMaasModelId") as string | undefined
	const planModeHuaweiCloudMaasModelInfo = context.globalState.get("planModeHuaweiCloudMaasModelInfo") as ModelInfo | undefined
	const planModeBasetenModelId = context.globalState.get("planModeBasetenModelId") as string | undefined
	const planModeBasetenModelInfo = context.globalState.get("planModeBasetenModelInfo") as ModelInfo | undefined
	// Act mode configurations
	const actModeApiProvider = context.globalState.get("actModeApiProvider") as ApiProvider | undefined
	const actModeApiModelId = context.globalState.get("actModeApiModelId") as string | undefined
	const actModeThinkingBudgetTokens = context.globalState.get("actModeThinkingBudgetTokens") as number | undefined
	const actModeReasoningEffort = context.globalState.get("actModeReasoningEffort") as string | undefined
	const actModeVsCodeLmModelSelector = context.globalState.get("actModeVsCodeLmModelSelector") as
		| LanguageModelChatSelector
		| undefined
	const actModeAwsBedrockCustomSelected = context.globalState.get("actModeAwsBedrockCustomSelected") as boolean | undefined
	const actModeAwsBedrockCustomModelBaseId = context.globalState.get("actModeAwsBedrockCustomModelBaseId") as
		| BedrockModelId
		| undefined
	const actModeOpenRouterModelId = context.globalState.get("actModeOpenRouterModelId") as string | undefined
	const actModeOpenRouterModelInfo = context.globalState.get("actModeOpenRouterModelInfo") as ModelInfo | undefined
	const actModeOpenAiModelId = context.globalState.get("actModeOpenAiModelId") as string | undefined
	const actModeOpenAiModelInfo = context.globalState.get("actModeOpenAiModelInfo") as ModelInfo | undefined
	const actModeOllamaModelId = context.globalState.get("actModeOllamaModelId") as string | undefined
	const actModeLmStudioModelId = context.globalState.get("actModeLmStudioModelId") as string | undefined
	const actModeLiteLlmModelId = context.globalState.get("actModeLiteLlmModelId") as string | undefined
	const actModeLiteLlmModelInfo = context.globalState.get("actModeLiteLlmModelInfo") as ModelInfo | undefined
	const actModeRequestyModelId = context.globalState.get("actModeRequestyModelId") as string | undefined
	const actModeRequestyModelInfo = context.globalState.get("actModeRequestyModelInfo") as ModelInfo | undefined
	const actModeTogetherModelId = context.globalState.get("actModeTogetherModelId") as string | undefined
	const actModeFireworksModelId = context.globalState.get("actModeFireworksModelId") as string | undefined
	const actModeSapAiCoreModelId = context.globalState.get("actModeSapAiCoreModelId") as string | undefined
	const actModeGroqModelId = context.globalState.get("actModeGroqModelId") as string | undefined
	const actModeGroqModelInfo = context.globalState.get("actModeGroqModelInfo") as ModelInfo | undefined
	const actModeHuggingFaceModelId = context.globalState.get("actModeHuggingFaceModelId") as string | undefined
	const actModeHuggingFaceModelInfo = context.globalState.get("actModeHuggingFaceModelInfo") as ModelInfo | undefined
	const actModeHuaweiCloudMaasModelId = context.globalState.get("actModeHuaweiCloudMaasModelId") as string | undefined
	const actModeHuaweiCloudMaasModelInfo = context.globalState.get("actModeHuaweiCloudMaasModelInfo") as ModelInfo | undefined
	const actModeBasetenModelId = context.globalState.get("actModeBasetenModelId") as string | undefined
	const actModeBasetenModelInfo = context.globalState.get("actModeBasetenModelInfo") as ModelInfo | undefined

	let apiProvider: ApiProvider
	if (planModeApiProvider) {
		apiProvider = planModeApiProvider
	} else {
		// Either new user or legacy user that doesn't have the apiProvider stored in state
		// (If they're using OpenRouter or Bedrock, then apiProvider state will exist)
		if (apiKey) {
			apiProvider = "anthropic"
		} else {
			// New users should default to openrouter, since they've opted to use an API key instead of signing in
			apiProvider = "openrouter"
		}
	}

	const mcpResponsesCollapsed = mcpResponsesCollapsedRaw ?? false

	// Plan/Act separate models setting is a boolean indicating whether the user wants to use different models for plan and act. Existing users expect this to be enabled, while we want new users to opt in to this being disabled by default.
	// On win11 state sometimes initializes as empty string instead of undefined
	let planActSeparateModelsSetting: boolean | undefined = undefined
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

	return {
		apiConfiguration: {
			apiKey,
			openRouterApiKey,
			clineAccountId,
			claudeCodePath,
			awsAccessKey,
			awsSecretKey,
			awsSessionToken,
			awsRegion,
			awsUseCrossRegionInference,
			awsBedrockUsePromptCache,
			awsBedrockEndpoint,
			awsProfile,
			awsBedrockApiKey,
			awsUseProfile,
			awsAuthentication,
			vertexProjectId,
			vertexRegion,
			openAiBaseUrl,
			requestyBaseUrl,
			openAiApiKey,
			openAiHeaders: openAiHeaders || {},
			ollamaBaseUrl,
			ollamaApiOptionsCtxNum,
			lmStudioBaseUrl,
			anthropicBaseUrl,
			geminiApiKey,
			geminiBaseUrl,
			openAiNativeApiKey,
			deepSeekApiKey,
			requestyApiKey,
			togetherApiKey,
			qwenApiKey,
			qwenApiLine,
			moonshotApiLine,
			doubaoApiKey,
			mistralApiKey,
			azureApiVersion,
			openRouterProviderSorting,
			liteLlmBaseUrl,
			liteLlmApiKey,
			liteLlmUsePromptCache,
			fireworksApiKey,
			fireworksModelMaxCompletionTokens,
			fireworksModelMaxTokens,
			asksageApiKey,
			asksageApiUrl,
			xaiApiKey,
			sambanovaApiKey,
			cerebrasApiKey,
			groqApiKey,
			moonshotApiKey,
			nebiusApiKey,
			favoritedModelIds,
			requestTimeoutMs,
			sapAiCoreClientId,
			sapAiCoreClientSecret,
			sapAiCoreBaseUrl,
			sapAiCoreTokenUrl,
			sapAiResourceGroup,
			huggingFaceApiKey,
			huaweiCloudMaasApiKey,
			basetenApiKey,
			ollamaApiKey,
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
			planModeFireworksModelId,
			planModeSapAiCoreModelId,
			planModeGroqModelId,
			planModeGroqModelInfo,
			planModeHuggingFaceModelId,
			planModeHuggingFaceModelInfo,
			planModeHuaweiCloudMaasModelId,
			planModeHuaweiCloudMaasModelInfo,
			planModeBasetenModelId,
			planModeBasetenModelInfo,
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
			actModeFireworksModelId,
			actModeSapAiCoreModelId,
			actModeGroqModelId,
			actModeGroqModelInfo,
			actModeHuggingFaceModelId,
			actModeHuggingFaceModelInfo,
			actModeHuaweiCloudMaasModelId,
			actModeHuaweiCloudMaasModelInfo,
			actModeBasetenModelId,
			actModeBasetenModelInfo,
		},
		strictPlanModeEnabled: strictPlanModeEnabled ?? false,
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
		mcpMarketplaceEnabled: mcpMarketplaceEnabledRaw || true,
		mcpDisplayMode: mcpDisplayMode ?? DEFAULT_MCP_DISPLAY_MODE,
		mcpResponsesCollapsed: mcpResponsesCollapsed,
		telemetrySetting: telemetrySetting || "unset",
		planActSeparateModelsSetting,
		enableCheckpointsSetting: enableCheckpointsSettingRaw || true,
		shellIntegrationTimeout: shellIntegrationTimeout || 4000,
		terminalReuseEnabled: terminalReuseEnabled ?? true,
		terminalOutputLineLimit: terminalOutputLineLimit ?? 500,
		defaultTerminalProfile: defaultTerminalProfile ?? "default",
		globalWorkflowToggles: globalWorkflowToggles || {},
		localClineRulesToggles: localClineRulesToggles || {},
		localWindsurfRulesToggles: localWindsurfRulesToggles || {},
		localCursorRulesToggles: localCursorRulesToggles || {},
		localWorkflowToggles: localWorkflowToggles || {},
	}
}

export async function resetWorkspaceState(controller: Controller) {
	const context = controller.context
	await Promise.all(context.workspaceState.keys().map((key) => controller.context.workspaceState.update(key, undefined)))

	await controller.cacheService.reInitialize()
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
	]
	await Promise.all(secretKeys.map((key) => context.secrets.delete(key)))
	await controller.cacheService.reInitialize()
}
