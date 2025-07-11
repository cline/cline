import * as vscode from "vscode"
import { DEFAULT_CHAT_SETTINGS } from "@shared/ChatSettings"
import { DEFAULT_BROWSER_SETTINGS } from "@shared/BrowserSettings"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { GlobalStateKey, LocalStateKey, SecretKey } from "./state-keys"
import { ApiConfiguration, ApiProvider, BedrockModelId, ModelInfo } from "@shared/api"
import { HistoryItem } from "@shared/HistoryItem"
import { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import { BrowserSettings } from "@shared/BrowserSettings"
import { StoredChatSettings } from "@shared/ChatSettings"
import { TelemetrySetting } from "@shared/TelemetrySetting"
import { UserInfo } from "@shared/UserInfo"
import { ClineRulesToggles } from "@shared/cline-rules"
import { migrateEnableCheckpointsSetting, migrateMcpMarketplaceEnableSetting } from "./state-migrations"
/*
	Storage
	https://dev.to/kompotkot/how-to-use-secretstorage-in-your-vscode-extensions-2hco
	https://www.eliostruyf.com/devhack-code-extension-storage-options/
	*/

// global

export async function updateGlobalState(context: vscode.ExtensionContext, key: GlobalStateKey, value: any) {
	await context.globalState.update(key, value)
}

export async function getGlobalState(context: vscode.ExtensionContext, key: GlobalStateKey) {
	return await context.globalState.get(key)
}

// secrets

export async function storeSecret(context: vscode.ExtensionContext, key: SecretKey, value?: string) {
	if (value) {
		await context.secrets.store(key, value)
	} else {
		await context.secrets.delete(key)
	}
}

export async function getSecret(context: vscode.ExtensionContext, key: SecretKey) {
	return await context.secrets.get(key)
}

// workspace

export async function updateWorkspaceState(context: vscode.ExtensionContext, key: LocalStateKey, value: any) {
	await context.workspaceState.update(key, value)
}

export async function getWorkspaceState(context: vscode.ExtensionContext, key: LocalStateKey) {
	return await context.workspaceState.get(key)
}

export async function getAllExtensionState(context: vscode.ExtensionContext) {
	const [
		isNewUser,
		welcomeViewCompleted,
		apiKey,
		openRouterApiKey,
		clineApiKey,
		awsAccessKey,
		awsSecretKey,
		awsSessionToken,
		awsRegion,
		awsUseCrossRegionInference,
		awsBedrockUsePromptCache,
		awsBedrockEndpoint,
		awsProfile,
		awsUseProfile,
		vertexProjectId,
		vertexRegion,
		openAiBaseUrl,
		openAiApiKey,
		openAiHeaders,
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
		doubaoApiKey,
		mistralApiKey,
		azureApiVersion,
		openRouterProviderSorting,
		lastShownAnnouncementId,
		taskHistory,
		autoApprovalSettings,
		browserSettings,
		liteLlmBaseUrl,
		liteLlmUsePromptCache,
		fireworksApiKey,
		fireworksModelMaxCompletionTokens,
		fireworksModelMaxTokens,
		userInfo,
		qwenApiLine,
		liteLlmApiKey,
		telemetrySetting,
		asksageApiKey,
		asksageApiUrl,
		xaiApiKey,
		sambanovaApiKey,
		cerebrasApiKey,
		nebiusApiKey,
		planActSeparateModelsSettingRaw,
		favoritedModelIds,
		globalClineRulesToggles,
		requestTimeoutMs,
		shellIntegrationTimeout,
		enableCheckpointsSettingRaw,
		mcpMarketplaceEnabledRaw,
		mcpRichDisplayEnabled,
		mcpResponsesCollapsedRaw,
		globalWorkflowToggles,
		terminalReuseEnabled,
		terminalOutputLineLimit,
		defaultTerminalProfile,
		sapAiCoreClientId,
		sapAiCoreClientSecret,
		sapAiCoreBaseUrl,
		sapAiCoreTokenUrl,
		sapAiResourceGroup,
		claudeCodePath,
	] = await Promise.all([
		getGlobalState(context, "isNewUser") as Promise<boolean | undefined>,
		getGlobalState(context, "welcomeViewCompleted") as Promise<boolean | undefined>,
		getSecret(context, "apiKey") as Promise<string | undefined>,
		getSecret(context, "openRouterApiKey") as Promise<string | undefined>,
		getSecret(context, "clineApiKey") as Promise<string | undefined>,
		getSecret(context, "awsAccessKey") as Promise<string | undefined>,
		getSecret(context, "awsSecretKey") as Promise<string | undefined>,
		getSecret(context, "awsSessionToken") as Promise<string | undefined>,
		getGlobalState(context, "awsRegion") as Promise<string | undefined>,
		getGlobalState(context, "awsUseCrossRegionInference") as Promise<boolean | undefined>,
		getGlobalState(context, "awsBedrockUsePromptCache") as Promise<boolean | undefined>,
		getGlobalState(context, "awsBedrockEndpoint") as Promise<string | undefined>,
		getGlobalState(context, "awsProfile") as Promise<string | undefined>,
		getGlobalState(context, "awsUseProfile") as Promise<boolean | undefined>,
		getGlobalState(context, "vertexProjectId") as Promise<string | undefined>,
		getGlobalState(context, "vertexRegion") as Promise<string | undefined>,
		getGlobalState(context, "openAiBaseUrl") as Promise<string | undefined>,
		getSecret(context, "openAiApiKey") as Promise<string | undefined>,
		getGlobalState(context, "openAiHeaders") as Promise<Record<string, string> | undefined>,
		getGlobalState(context, "ollamaBaseUrl") as Promise<string | undefined>,
		getGlobalState(context, "ollamaApiOptionsCtxNum") as Promise<string | undefined>,
		getGlobalState(context, "lmStudioBaseUrl") as Promise<string | undefined>,
		getGlobalState(context, "anthropicBaseUrl") as Promise<string | undefined>,
		getSecret(context, "geminiApiKey") as Promise<string | undefined>,
		getGlobalState(context, "geminiBaseUrl") as Promise<string | undefined>,
		getSecret(context, "openAiNativeApiKey") as Promise<string | undefined>,
		getSecret(context, "deepSeekApiKey") as Promise<string | undefined>,
		getSecret(context, "requestyApiKey") as Promise<string | undefined>,
		getSecret(context, "togetherApiKey") as Promise<string | undefined>,
		getSecret(context, "qwenApiKey") as Promise<string | undefined>,
		getSecret(context, "doubaoApiKey") as Promise<string | undefined>,
		getSecret(context, "mistralApiKey") as Promise<string | undefined>,
		getGlobalState(context, "azureApiVersion") as Promise<string | undefined>,
		getGlobalState(context, "openRouterProviderSorting") as Promise<string | undefined>,
		getGlobalState(context, "lastShownAnnouncementId") as Promise<string | undefined>,
		getGlobalState(context, "taskHistory") as Promise<HistoryItem[] | undefined>,
		getGlobalState(context, "autoApprovalSettings") as Promise<AutoApprovalSettings | undefined>,
		getGlobalState(context, "browserSettings") as Promise<BrowserSettings | undefined>,
		getGlobalState(context, "liteLlmBaseUrl") as Promise<string | undefined>,
		getGlobalState(context, "liteLlmUsePromptCache") as Promise<boolean | undefined>,
		getSecret(context, "fireworksApiKey") as Promise<string | undefined>,
		getGlobalState(context, "fireworksModelMaxCompletionTokens") as Promise<number | undefined>,
		getGlobalState(context, "fireworksModelMaxTokens") as Promise<number | undefined>,
		getGlobalState(context, "userInfo") as Promise<UserInfo | undefined>,
		getGlobalState(context, "qwenApiLine") as Promise<string | undefined>,
		getSecret(context, "liteLlmApiKey") as Promise<string | undefined>,
		getGlobalState(context, "telemetrySetting") as Promise<TelemetrySetting | undefined>,
		getSecret(context, "asksageApiKey") as Promise<string | undefined>,
		getGlobalState(context, "asksageApiUrl") as Promise<string | undefined>,
		getSecret(context, "xaiApiKey") as Promise<string | undefined>,
		getSecret(context, "sambanovaApiKey") as Promise<string | undefined>,
		getSecret(context, "cerebrasApiKey") as Promise<string | undefined>,
		getSecret(context, "nebiusApiKey") as Promise<string | undefined>,
		getGlobalState(context, "planActSeparateModelsSetting") as Promise<boolean | undefined>,
		getGlobalState(context, "favoritedModelIds") as Promise<string[] | undefined>,
		getGlobalState(context, "globalClineRulesToggles") as Promise<ClineRulesToggles | undefined>,
		getGlobalState(context, "requestTimeoutMs") as Promise<number | undefined>,
		getGlobalState(context, "shellIntegrationTimeout") as Promise<number | undefined>,
		getGlobalState(context, "enableCheckpointsSetting") as Promise<boolean | undefined>,
		getGlobalState(context, "mcpMarketplaceEnabled") as Promise<boolean | undefined>,
		getGlobalState(context, "mcpRichDisplayEnabled") as Promise<boolean | undefined>,
		getGlobalState(context, "mcpResponsesCollapsed") as Promise<boolean | undefined>,
		getGlobalState(context, "globalWorkflowToggles") as Promise<ClineRulesToggles | undefined>,
		getGlobalState(context, "terminalReuseEnabled") as Promise<boolean | undefined>,
		getGlobalState(context, "terminalOutputLineLimit") as Promise<number | undefined>,
		getGlobalState(context, "defaultTerminalProfile") as Promise<string | undefined>,
		getSecret(context, "sapAiCoreClientId") as Promise<string | undefined>,
		getSecret(context, "sapAiCoreClientSecret") as Promise<string | undefined>,
		getGlobalState(context, "sapAiCoreBaseUrl") as Promise<string | undefined>,
		getGlobalState(context, "sapAiCoreTokenUrl") as Promise<string | undefined>,
		getGlobalState(context, "sapAiResourceGroup") as Promise<string | undefined>,
		getGlobalState(context, "claudeCodePath") as Promise<string | undefined>,
	])

	const localClineRulesToggles = (await getWorkspaceState(context, "localClineRulesToggles")) as ClineRulesToggles

	const [
		chatSettings,
		// Plan mode configurations
		planModeApiProvider,
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
		// Act mode configurations
		actModeApiProvider,
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
	] = await Promise.all([
		getGlobalState(context, "chatSettings") as Promise<StoredChatSettings | undefined>,
		// Plan mode configurations
		getGlobalState(context, "planModeApiProvider") as Promise<ApiProvider | undefined>,
		getGlobalState(context, "planModeApiModelId") as Promise<string | undefined>,
		getGlobalState(context, "planModeThinkingBudgetTokens") as Promise<number | undefined>,
		getGlobalState(context, "planModeReasoningEffort") as Promise<string | undefined>,
		getGlobalState(context, "planModeVsCodeLmModelSelector") as Promise<vscode.LanguageModelChatSelector | undefined>,
		getGlobalState(context, "planModeAwsBedrockCustomSelected") as Promise<boolean | undefined>,
		getGlobalState(context, "planModeAwsBedrockCustomModelBaseId") as Promise<BedrockModelId | undefined>,
		getGlobalState(context, "planModeOpenRouterModelId") as Promise<string | undefined>,
		getGlobalState(context, "planModeOpenRouterModelInfo") as Promise<ModelInfo | undefined>,
		getGlobalState(context, "planModeOpenAiModelId") as Promise<string | undefined>,
		getGlobalState(context, "planModeOpenAiModelInfo") as Promise<ModelInfo | undefined>,
		getGlobalState(context, "planModeOllamaModelId") as Promise<string | undefined>,
		getGlobalState(context, "planModeLmStudioModelId") as Promise<string | undefined>,
		getGlobalState(context, "planModeLiteLlmModelId") as Promise<string | undefined>,
		getGlobalState(context, "planModeLiteLlmModelInfo") as Promise<ModelInfo | undefined>,
		getGlobalState(context, "planModeRequestyModelId") as Promise<string | undefined>,
		getGlobalState(context, "planModeRequestyModelInfo") as Promise<ModelInfo | undefined>,
		getGlobalState(context, "planModeTogetherModelId") as Promise<string | undefined>,
		getGlobalState(context, "planModeFireworksModelId") as Promise<string | undefined>,
		getGlobalState(context, "planModeSapAiCoreModelId") as Promise<string | undefined>,
		// Act mode configurations
		getGlobalState(context, "actModeApiProvider") as Promise<ApiProvider | undefined>,
		getGlobalState(context, "actModeApiModelId") as Promise<string | undefined>,
		getGlobalState(context, "actModeThinkingBudgetTokens") as Promise<number | undefined>,
		getGlobalState(context, "actModeReasoningEffort") as Promise<string | undefined>,
		getGlobalState(context, "actModeVsCodeLmModelSelector") as Promise<vscode.LanguageModelChatSelector | undefined>,
		getGlobalState(context, "actModeAwsBedrockCustomSelected") as Promise<boolean | undefined>,
		getGlobalState(context, "actModeAwsBedrockCustomModelBaseId") as Promise<BedrockModelId | undefined>,
		getGlobalState(context, "actModeOpenRouterModelId") as Promise<string | undefined>,
		getGlobalState(context, "actModeOpenRouterModelInfo") as Promise<ModelInfo | undefined>,
		getGlobalState(context, "actModeOpenAiModelId") as Promise<string | undefined>,
		getGlobalState(context, "actModeOpenAiModelInfo") as Promise<ModelInfo | undefined>,
		getGlobalState(context, "actModeOllamaModelId") as Promise<string | undefined>,
		getGlobalState(context, "actModeLmStudioModelId") as Promise<string | undefined>,
		getGlobalState(context, "actModeLiteLlmModelId") as Promise<string | undefined>,
		getGlobalState(context, "actModeLiteLlmModelInfo") as Promise<ModelInfo | undefined>,
		getGlobalState(context, "actModeRequestyModelId") as Promise<string | undefined>,
		getGlobalState(context, "actModeRequestyModelInfo") as Promise<ModelInfo | undefined>,
		getGlobalState(context, "actModeTogetherModelId") as Promise<string | undefined>,
		getGlobalState(context, "actModeFireworksModelId") as Promise<string | undefined>,
		getGlobalState(context, "actModeSapAiCoreModelId") as Promise<string | undefined>,
	])

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

	const mcpMarketplaceEnabled = await migrateMcpMarketplaceEnableSetting(mcpMarketplaceEnabledRaw)
	const enableCheckpointsSetting = await migrateEnableCheckpointsSetting(enableCheckpointsSettingRaw)
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
		// this is a special case where it's a new state, but we want it to default to different values for existing and new users.
		// persist so next time state is retrieved it's set to the correct value.
		await updateGlobalState(context, "planActSeparateModelsSetting", planActSeparateModelsSetting)
	}

	return {
		apiConfiguration: {
			apiKey,
			openRouterApiKey,
			clineApiKey,
			claudeCodePath,
			awsAccessKey,
			awsSecretKey,
			awsSessionToken,
			awsRegion,
			awsUseCrossRegionInference,
			awsBedrockUsePromptCache,
			awsBedrockEndpoint,
			awsProfile,
			awsUseProfile,
			vertexProjectId,
			vertexRegion,
			openAiBaseUrl,
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
			nebiusApiKey,
			favoritedModelIds,
			requestTimeoutMs,
			sapAiCoreClientId,
			sapAiCoreClientSecret,
			sapAiCoreBaseUrl,
			sapAiCoreTokenUrl,
			sapAiResourceGroup,
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
		},
		isNewUser: isNewUser ?? true,
		welcomeViewCompleted,
		lastShownAnnouncementId,
		taskHistory,
		autoApprovalSettings: autoApprovalSettings || DEFAULT_AUTO_APPROVAL_SETTINGS, // default value can be 0 or empty string
		globalClineRulesToggles: globalClineRulesToggles || {},
		localClineRulesToggles: localClineRulesToggles || {},
		browserSettings: { ...DEFAULT_BROWSER_SETTINGS, ...browserSettings }, // this will ensure that older versions of browserSettings (e.g. before remoteBrowserEnabled was added) are merged with the default values (false for remoteBrowserEnabled)
		chatSettings: {
			...DEFAULT_CHAT_SETTINGS, // Apply defaults first
			...(chatSettings || {}), // Spread fetched chatSettings, which includes preferredLanguage, and openAIReasoningEffort
		},
		userInfo,
		mcpMarketplaceEnabled: mcpMarketplaceEnabled,
		mcpRichDisplayEnabled: mcpRichDisplayEnabled ?? true,
		mcpResponsesCollapsed: mcpResponsesCollapsed,
		telemetrySetting: telemetrySetting || "unset",
		planActSeparateModelsSetting,
		enableCheckpointsSetting: enableCheckpointsSetting,
		shellIntegrationTimeout: shellIntegrationTimeout || 4000,
		terminalReuseEnabled: terminalReuseEnabled ?? true,
		terminalOutputLineLimit: terminalOutputLineLimit ?? 500,
		defaultTerminalProfile: defaultTerminalProfile ?? "default",
		globalWorkflowToggles: globalWorkflowToggles || {},
	}
}

export async function updateApiConfiguration(context: vscode.ExtensionContext, apiConfiguration: ApiConfiguration) {
	const {
		apiKey,
		openRouterApiKey,
		awsAccessKey,
		awsSecretKey,
		awsSessionToken,
		awsRegion,
		awsUseCrossRegionInference,
		awsBedrockUsePromptCache,
		awsBedrockEndpoint,
		awsProfile,
		awsUseProfile,
		vertexProjectId,
		vertexRegion,
		openAiBaseUrl,
		openAiApiKey,
		openAiHeaders,
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
		doubaoApiKey,
		mistralApiKey,
		azureApiVersion,
		openRouterProviderSorting,
		liteLlmBaseUrl,
		liteLlmApiKey,
		liteLlmUsePromptCache,
		qwenApiLine,
		asksageApiKey,
		asksageApiUrl,
		xaiApiKey,
		clineApiKey,
		sambanovaApiKey,
		cerebrasApiKey,
		nebiusApiKey,
		favoritedModelIds,
		fireworksApiKey,
		fireworksModelMaxCompletionTokens,
		fireworksModelMaxTokens,
		sapAiCoreClientId,
		sapAiCoreClientSecret,
		sapAiCoreBaseUrl,
		sapAiCoreTokenUrl,
		sapAiResourceGroup,
		claudeCodePath,
		// Plan mode configurations
		planModeApiProvider,
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
		// Act mode configurations
		actModeApiProvider,
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
	} = apiConfiguration

	// Plan mode configuration updates
	await updateGlobalState(context, "planModeApiProvider", planModeApiProvider)
	await updateGlobalState(context, "planModeApiModelId", planModeApiModelId)
	await updateGlobalState(context, "planModeThinkingBudgetTokens", planModeThinkingBudgetTokens)
	await updateGlobalState(context, "planModeReasoningEffort", planModeReasoningEffort)
	await updateGlobalState(context, "planModeVsCodeLmModelSelector", planModeVsCodeLmModelSelector)
	await updateGlobalState(context, "planModeAwsBedrockCustomSelected", planModeAwsBedrockCustomSelected)
	await updateGlobalState(context, "planModeAwsBedrockCustomModelBaseId", planModeAwsBedrockCustomModelBaseId)
	await updateGlobalState(context, "planModeOpenRouterModelId", planModeOpenRouterModelId)
	await updateGlobalState(context, "planModeOpenRouterModelInfo", planModeOpenRouterModelInfo)
	await updateGlobalState(context, "planModeOpenAiModelId", planModeOpenAiModelId)
	await updateGlobalState(context, "planModeOpenAiModelInfo", planModeOpenAiModelInfo)
	await updateGlobalState(context, "planModeOllamaModelId", planModeOllamaModelId)
	await updateGlobalState(context, "planModeLmStudioModelId", planModeLmStudioModelId)
	await updateGlobalState(context, "planModeLiteLlmModelId", planModeLiteLlmModelId)
	await updateGlobalState(context, "planModeLiteLlmModelInfo", planModeLiteLlmModelInfo)
	await updateGlobalState(context, "planModeRequestyModelId", planModeRequestyModelId)
	await updateGlobalState(context, "planModeRequestyModelInfo", planModeRequestyModelInfo)
	await updateGlobalState(context, "planModeTogetherModelId", planModeTogetherModelId)
	await updateGlobalState(context, "planModeFireworksModelId", planModeFireworksModelId)
	await updateGlobalState(context, "planModeSapAiCoreModelId", planModeSapAiCoreModelId)

	// Act mode configuration updates
	await updateGlobalState(context, "actModeApiProvider", actModeApiProvider)
	await updateGlobalState(context, "actModeApiModelId", actModeApiModelId)
	await updateGlobalState(context, "actModeThinkingBudgetTokens", actModeThinkingBudgetTokens)
	await updateGlobalState(context, "actModeReasoningEffort", actModeReasoningEffort)
	await updateGlobalState(context, "actModeVsCodeLmModelSelector", actModeVsCodeLmModelSelector)
	await updateGlobalState(context, "actModeAwsBedrockCustomSelected", actModeAwsBedrockCustomSelected)
	await updateGlobalState(context, "actModeAwsBedrockCustomModelBaseId", actModeAwsBedrockCustomModelBaseId)
	await updateGlobalState(context, "actModeOpenRouterModelId", actModeOpenRouterModelId)
	await updateGlobalState(context, "actModeOpenRouterModelInfo", actModeOpenRouterModelInfo)
	await updateGlobalState(context, "actModeOpenAiModelId", actModeOpenAiModelId)
	await updateGlobalState(context, "actModeOpenAiModelInfo", actModeOpenAiModelInfo)
	await updateGlobalState(context, "actModeOllamaModelId", actModeOllamaModelId)
	await updateGlobalState(context, "actModeLmStudioModelId", actModeLmStudioModelId)
	await updateGlobalState(context, "actModeLiteLlmModelId", actModeLiteLlmModelId)
	await updateGlobalState(context, "actModeLiteLlmModelInfo", actModeLiteLlmModelInfo)
	await updateGlobalState(context, "actModeRequestyModelId", actModeRequestyModelId)
	await updateGlobalState(context, "actModeRequestyModelInfo", actModeRequestyModelInfo)
	await updateGlobalState(context, "actModeTogetherModelId", actModeTogetherModelId)
	await updateGlobalState(context, "actModeFireworksModelId", actModeFireworksModelId)
	await updateGlobalState(context, "actModeSapAiCoreModelId", actModeSapAiCoreModelId)

	// Global state updates
	await updateGlobalState(context, "awsRegion", awsRegion)
	await updateGlobalState(context, "awsUseCrossRegionInference", awsUseCrossRegionInference)
	await updateGlobalState(context, "awsBedrockUsePromptCache", awsBedrockUsePromptCache)
	await updateGlobalState(context, "awsBedrockEndpoint", awsBedrockEndpoint)
	await updateGlobalState(context, "awsProfile", awsProfile)
	await updateGlobalState(context, "awsUseProfile", awsUseProfile)
	await updateGlobalState(context, "vertexProjectId", vertexProjectId)
	await updateGlobalState(context, "vertexRegion", vertexRegion)
	await updateGlobalState(context, "openAiBaseUrl", openAiBaseUrl)
	await updateGlobalState(context, "openAiHeaders", openAiHeaders || {})
	await updateGlobalState(context, "ollamaBaseUrl", ollamaBaseUrl)
	await updateGlobalState(context, "ollamaApiOptionsCtxNum", ollamaApiOptionsCtxNum)
	await updateGlobalState(context, "lmStudioBaseUrl", lmStudioBaseUrl)
	await updateGlobalState(context, "anthropicBaseUrl", anthropicBaseUrl)
	await updateGlobalState(context, "geminiBaseUrl", geminiBaseUrl)
	await updateGlobalState(context, "azureApiVersion", azureApiVersion)
	await updateGlobalState(context, "openRouterProviderSorting", openRouterProviderSorting)
	await updateGlobalState(context, "liteLlmBaseUrl", liteLlmBaseUrl)
	await updateGlobalState(context, "liteLlmUsePromptCache", liteLlmUsePromptCache)
	await updateGlobalState(context, "qwenApiLine", qwenApiLine)
	await updateGlobalState(context, "asksageApiUrl", asksageApiUrl)
	await updateGlobalState(context, "favoritedModelIds", favoritedModelIds)
	await updateGlobalState(context, "requestTimeoutMs", apiConfiguration.requestTimeoutMs)
	await updateGlobalState(context, "fireworksModelMaxCompletionTokens", fireworksModelMaxCompletionTokens)
	await updateGlobalState(context, "fireworksModelMaxTokens", fireworksModelMaxTokens)
	await updateGlobalState(context, "sapAiCoreBaseUrl", sapAiCoreBaseUrl)
	await updateGlobalState(context, "sapAiCoreTokenUrl", sapAiCoreTokenUrl)
	await updateGlobalState(context, "sapAiResourceGroup", sapAiResourceGroup)
	await updateGlobalState(context, "claudeCodePath", claudeCodePath)

	// Secret updates
	await storeSecret(context, "apiKey", apiKey)
	await storeSecret(context, "openRouterApiKey", openRouterApiKey)
	await storeSecret(context, "clineApiKey", clineApiKey)
	await storeSecret(context, "awsAccessKey", awsAccessKey)
	await storeSecret(context, "awsSecretKey", awsSecretKey)
	await storeSecret(context, "awsSessionToken", awsSessionToken)
	await storeSecret(context, "openAiApiKey", openAiApiKey)
	await storeSecret(context, "geminiApiKey", geminiApiKey)
	await storeSecret(context, "openAiNativeApiKey", openAiNativeApiKey)
	await storeSecret(context, "deepSeekApiKey", deepSeekApiKey)
	await storeSecret(context, "requestyApiKey", requestyApiKey)
	await storeSecret(context, "togetherApiKey", togetherApiKey)
	await storeSecret(context, "qwenApiKey", qwenApiKey)
	await storeSecret(context, "doubaoApiKey", doubaoApiKey)
	await storeSecret(context, "mistralApiKey", mistralApiKey)
	await storeSecret(context, "liteLlmApiKey", liteLlmApiKey)
	await storeSecret(context, "fireworksApiKey", fireworksApiKey)
	await storeSecret(context, "asksageApiKey", asksageApiKey)
	await storeSecret(context, "xaiApiKey", xaiApiKey)
	await storeSecret(context, "sambanovaApiKey", sambanovaApiKey)
	await storeSecret(context, "cerebrasApiKey", cerebrasApiKey)
	await storeSecret(context, "nebiusApiKey", nebiusApiKey)
	await storeSecret(context, "sapAiCoreClientId", sapAiCoreClientId)
	await storeSecret(context, "sapAiCoreClientSecret", sapAiCoreClientSecret)
}

export async function resetWorkspaceState(context: vscode.ExtensionContext) {
	for (const key of context.workspaceState.keys()) {
		await context.workspaceState.update(key, undefined)
	}
}

export async function resetGlobalState(context: vscode.ExtensionContext) {
	// TODO: Reset all workspace states?
	for (const key of context.globalState.keys()) {
		await context.globalState.update(key, undefined)
	}
	const secretKeys: SecretKey[] = [
		"apiKey",
		"openRouterApiKey",
		"awsAccessKey",
		"awsSecretKey",
		"awsSessionToken",
		"openAiApiKey",
		"geminiApiKey",
		"openAiNativeApiKey",
		"deepSeekApiKey",
		"requestyApiKey",
		"togetherApiKey",
		"qwenApiKey",
		"doubaoApiKey",
		"mistralApiKey",
		"clineApiKey",
		"liteLlmApiKey",
		"fireworksApiKey",
		"asksageApiKey",
		"xaiApiKey",
		"sambanovaApiKey",
		"cerebrasApiKey",
		"nebiusApiKey",
	]
	for (const key of secretKeys) {
		await storeSecret(context, key, undefined)
	}
}
