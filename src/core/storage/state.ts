import * as vscode from "vscode"
import { DEFAULT_CHAT_SETTINGS, Mode } from "@shared/ChatSettings"
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
import { DEFAULT_MCP_DISPLAY_MODE, McpDisplayMode } from "@shared/McpDisplayMode"
import { migrateEnableCheckpointsSetting, migrateMcpMarketplaceEnableSetting } from "./state-migrations"
/*
	Storage
	https://dev.to/kompotkot/how-to-use-secretstorage-in-your-vscode-extensions-2hco
	https://www.eliostruyf.com/devhack-code-extension-storage-options/
	*/

const isTemporaryProfile = process.env.TEMP_PROFILE === "true"

// In-memory storage for temporary profiles
const inMemoryGlobalState = new Map<string, any>()
const inMemoryWorkspaceState = new Map<string, any>()
const inMemorySecrets = new Map<string, string>()

// global
export async function updateGlobalState(context: vscode.ExtensionContext, key: GlobalStateKey, value: any) {
	if (isTemporaryProfile) {
		inMemoryGlobalState.set(key, value)
		return
	}
	await context.globalState.update(key, value)
}

export async function getGlobalState(context: vscode.ExtensionContext, key: GlobalStateKey) {
	if (isTemporaryProfile) {
		return inMemoryGlobalState.get(key)
	}
	return await context.globalState.get(key)
}

// Batched operations for performance optimization
export async function updateGlobalStateBatch(context: vscode.ExtensionContext, updates: Record<string, any>) {
	if (isTemporaryProfile) {
		Object.entries(updates).forEach(([key, value]) => {
			inMemoryGlobalState.set(key, value)
		})
		return
	}
	// Use Promise.all to batch the updates
	await Promise.all(Object.entries(updates).map(([key, value]) => context.globalState.update(key as GlobalStateKey, value)))
}

export async function updateSecretsBatch(context: vscode.ExtensionContext, updates: Record<string, string | undefined>) {
	if (isTemporaryProfile) {
		Object.entries(updates).forEach(([key, value]) => {
			if (value) {
				inMemorySecrets.set(key, value)
			} else {
				inMemorySecrets.delete(key)
			}
		})
		return
	}
	// Use Promise.all to batch the secret updates
	await Promise.all(Object.entries(updates).map(([key, value]) => storeSecret(context, key as SecretKey, value)))
}

// secrets
export async function storeSecret(context: vscode.ExtensionContext, key: SecretKey, value?: string) {
	if (isTemporaryProfile) {
		if (value) {
			inMemorySecrets.set(key, value)
		} else {
			inMemorySecrets.delete(key)
		}
		return
	}
	if (value) {
		await context.secrets.store(key, value)
	} else {
		await context.secrets.delete(key)
	}
}

export async function getSecret(context: vscode.ExtensionContext, key: SecretKey) {
	if (isTemporaryProfile) {
		return inMemorySecrets.get(key)
	}
	return await context.secrets.get(key)
}

// workspace
export async function updateWorkspaceState(context: vscode.ExtensionContext, key: LocalStateKey, value: any) {
	if (isTemporaryProfile) {
		inMemoryWorkspaceState.set(key, value)
		return
	}
	await context.workspaceState.update(key, value)
}

export async function getWorkspaceState(context: vscode.ExtensionContext, key: LocalStateKey) {
	if (isTemporaryProfile) {
		return inMemoryWorkspaceState.get(key)
	}
	return await context.workspaceState.get(key)
}

export async function getAllExtensionState(context: vscode.ExtensionContext) {
	const firstBatchStart = performance.now()
	const [
		isNewUser,
		welcomeViewCompleted,
		apiKey,
		openRouterApiKey,
		clineAccountId,
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
		moonshotApiLine,
		liteLlmApiKey,
		telemetrySetting,
		asksageApiKey,
		asksageApiUrl,
		xaiApiKey,
		sambanovaApiKey,
		cerebrasApiKey,
		groqApiKey,
		moonshotApiKey,
		nebiusApiKey,
		huggingFaceApiKey,
		planActSeparateModelsSettingRaw,
		favoritedModelIds,
		globalClineRulesToggles,
		requestTimeoutMs,
		shellIntegrationTimeout,
		enableCheckpointsSettingRaw,
		mcpMarketplaceEnabledRaw,
		mcpDisplayMode,
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
		getSecret(context, "clineAccountId") as Promise<string | undefined>,
		getSecret(context, "awsAccessKey") as Promise<string | undefined>,
		getSecret(context, "awsSecretKey") as Promise<string | undefined>,
		getSecret(context, "awsSessionToken") as Promise<string | undefined>,
		getGlobalState(context, "awsRegion") as Promise<string | undefined>,
		getGlobalState(context, "awsUseCrossRegionInference") as Promise<boolean | undefined>,
		getGlobalState(context, "awsBedrockUsePromptCache") as Promise<boolean | undefined>,
		getGlobalState(context, "awsBedrockEndpoint") as Promise<string | undefined>,
		getGlobalState(context, "awsProfile") as Promise<string | undefined>,
		getSecret(context, "awsBedrockApiKey") as Promise<string | undefined>,
		getGlobalState(context, "awsUseProfile") as Promise<boolean | undefined>,
		getGlobalState(context, "awsAuthentication") as Promise<string | undefined>,
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
		getGlobalState(context, "moonshotApiLine") as Promise<string | undefined>,
		getSecret(context, "liteLlmApiKey") as Promise<string | undefined>,
		getGlobalState(context, "telemetrySetting") as Promise<TelemetrySetting | undefined>,
		getSecret(context, "asksageApiKey") as Promise<string | undefined>,
		getGlobalState(context, "asksageApiUrl") as Promise<string | undefined>,
		getSecret(context, "xaiApiKey") as Promise<string | undefined>,
		getSecret(context, "sambanovaApiKey") as Promise<string | undefined>,
		getSecret(context, "cerebrasApiKey") as Promise<string | undefined>,
		getSecret(context, "groqApiKey") as Promise<string | undefined>,
		getSecret(context, "moonshotApiKey") as Promise<string | undefined>,
		getSecret(context, "nebiusApiKey") as Promise<string | undefined>,
		getSecret(context, "huggingFaceApiKey") as Promise<string | undefined>,
		getGlobalState(context, "planActSeparateModelsSetting") as Promise<boolean | undefined>,
		getGlobalState(context, "favoritedModelIds") as Promise<string[] | undefined>,
		getGlobalState(context, "globalClineRulesToggles") as Promise<ClineRulesToggles | undefined>,
		getGlobalState(context, "requestTimeoutMs") as Promise<number | undefined>,
		getGlobalState(context, "shellIntegrationTimeout") as Promise<number | undefined>,
		getGlobalState(context, "enableCheckpointsSetting") as Promise<boolean | undefined>,
		getGlobalState(context, "mcpMarketplaceEnabled") as Promise<boolean | undefined>,
		getGlobalState(context, "mcpDisplayMode") as Promise<McpDisplayMode | undefined>,
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

	const secondBatchStart = performance.now()
	const [
		chatSettings,
		currentMode,
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
		planModeGroqModelId,
		planModeGroqModelInfo,
		planModeHuggingFaceModelId,
		planModeHuggingFaceModelInfo,
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
		actModeGroqModelId,
		actModeGroqModelInfo,
		actModeHuggingFaceModelId,
		actModeHuggingFaceModelInfo,
	] = await Promise.all([
		getGlobalState(context, "chatSettings") as Promise<StoredChatSettings | undefined>,
		getGlobalState(context, "mode") as Promise<Mode | undefined>,
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
		getGlobalState(context, "planModeGroqModelId") as Promise<string | undefined>,
		getGlobalState(context, "planModeGroqModelInfo") as Promise<ModelInfo | undefined>,
		getGlobalState(context, "planModeHuggingFaceModelId") as Promise<string | undefined>,
		getGlobalState(context, "planModeHuggingFaceModelInfo") as Promise<ModelInfo | undefined>,
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
		getGlobalState(context, "actModeGroqModelId") as Promise<string | undefined>,
		getGlobalState(context, "actModeGroqModelInfo") as Promise<ModelInfo | undefined>,
		getGlobalState(context, "actModeHuggingFaceModelId") as Promise<string | undefined>,
		getGlobalState(context, "actModeHuggingFaceModelInfo") as Promise<ModelInfo | undefined>,
	])

	const processingStart = performance.now()
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
			...(chatSettings || {}), // Spread fetched global chatSettings, which includes preferredLanguage, and openAIReasoningEffort
			mode: currentMode || "act", // Merge mode from global state
		},
		userInfo,
		mcpMarketplaceEnabled: mcpMarketplaceEnabled,
		mcpDisplayMode: mcpDisplayMode ?? DEFAULT_MCP_DISPLAY_MODE,
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
		awsBedrockApiKey,
		awsProfile,
		awsUseProfile,
		awsAuthentication,
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
		moonshotApiLine,
		asksageApiKey,
		asksageApiUrl,
		xaiApiKey,
		clineAccountId,
		sambanovaApiKey,
		cerebrasApiKey,
		groqApiKey,
		moonshotApiKey,
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
		huggingFaceApiKey,
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
		planModeGroqModelId,
		planModeGroqModelInfo,
		planModeHuggingFaceModelId,
		planModeHuggingFaceModelInfo,
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
		actModeGroqModelId,
		actModeGroqModelInfo,
		actModeHuggingFaceModelId,
		actModeHuggingFaceModelInfo,
	} = apiConfiguration

	// OPTIMIZED: Batch all global state updates into 2 operations instead of 47
	const batchedGlobalUpdates = {
		// Plan mode configuration updates
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
		planModeGroqModelId,
		planModeGroqModelInfo,
		planModeHuggingFaceModelId,
		planModeHuggingFaceModelInfo,

		// Act mode configuration updates
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
		actModeGroqModelId,
		actModeGroqModelInfo,
		actModeHuggingFaceModelId,
		actModeHuggingFaceModelInfo,

		// Global state updates (27 keys)
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
		openAiHeaders: openAiHeaders || {},
		ollamaBaseUrl,
		ollamaApiOptionsCtxNum,
		lmStudioBaseUrl,
		anthropicBaseUrl,
		geminiBaseUrl,
		azureApiVersion,
		openRouterProviderSorting,
		liteLlmBaseUrl,
		liteLlmUsePromptCache,
		qwenApiLine,
		moonshotApiLine,
		asksageApiUrl,
		favoritedModelIds,
		requestTimeoutMs: apiConfiguration.requestTimeoutMs,
		fireworksModelMaxCompletionTokens,
		fireworksModelMaxTokens,
		sapAiCoreBaseUrl,
		sapAiCoreTokenUrl,
		sapAiResourceGroup,
		claudeCodePath,
	}

	// OPTIMIZED: Batch all secret updates into 1 operation instead of 23
	const batchedSecretUpdates = {
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
		liteLlmApiKey,
		fireworksApiKey,
		asksageApiKey,
		xaiApiKey,
		sambanovaApiKey,
		cerebrasApiKey,
		groqApiKey,
		moonshotApiKey,
		nebiusApiKey,
		sapAiCoreClientId,
		sapAiCoreClientSecret,
		huggingFaceApiKey,
	}

	// Execute batched operations in parallel for maximum performance
	await Promise.all([updateGlobalStateBatch(context, batchedGlobalUpdates), updateSecretsBatch(context, batchedSecretUpdates)])
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
		"awsBedrockApiKey",
		"openAiApiKey",
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
		"moonshotApiKey",
		"nebiusApiKey",
		"huggingFaceApiKey",
	]
	for (const key of secretKeys) {
		await storeSecret(context, key, undefined)
	}
}
