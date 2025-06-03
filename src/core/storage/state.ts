import * as vscode from "vscode"
import { DEFAULT_CHAT_SETTINGS, OpenAIReasoningEffort } from "@shared/ChatSettings"
import { DEFAULT_BROWSER_SETTINGS } from "@shared/BrowserSettings"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { GlobalStateKey, SecretKey } from "./state-keys"
import { ApiConfiguration, ApiProvider, BedrockModelId, ModelInfo } from "@shared/api"
import { HistoryItem } from "@shared/HistoryItem"
import { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import { BrowserSettings } from "@shared/BrowserSettings"
import { ChatSettings } from "@shared/ChatSettings"
import { TelemetrySetting } from "@shared/TelemetrySetting"
import { UserInfo } from "@shared/UserInfo"
import { ClineRulesToggles } from "@shared/cline-rules"
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

export async function updateWorkspaceState(context: vscode.ExtensionContext, key: string, value: any) {
	await context.workspaceState.update(key, value)
}

export async function getWorkspaceState(context: vscode.ExtensionContext, key: string) {
	return await context.workspaceState.get(key)
}

async function migrateMcpMarketplaceEnableSetting(mcpMarketplaceEnabledRaw: boolean | undefined): Promise<boolean> {
	const config = vscode.workspace.getConfiguration("cline")
	const mcpMarketplaceEnabled = config.get<boolean>("mcpMarketplace.enabled")
	if (mcpMarketplaceEnabled !== undefined) {
		// Remove from VSCode configuration
		await config.update("mcpMarketplace.enabled", undefined, true)

		return !mcpMarketplaceEnabled
	}
	return mcpMarketplaceEnabledRaw ?? true
}

async function migrateEnableCheckpointsSetting(enableCheckpointsSettingRaw: boolean | undefined): Promise<boolean> {
	const config = vscode.workspace.getConfiguration("cline")
	const enableCheckpoints = config.get<boolean>("enableCheckpoints")
	if (enableCheckpoints !== undefined) {
		// Remove from VSCode configuration
		await config.update("enableCheckpoints", undefined, true)
		return enableCheckpoints
	}
	return enableCheckpointsSettingRaw ?? true
}

export async function getAllExtensionState(context: vscode.ExtensionContext) {
	const [
		isNewUser,
		storedApiProvider,
		apiModelId,
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
		awsBedrockCustomSelected,
		awsBedrockCustomModelBaseId,
		vertexProjectId,
		vertexRegion,
		openAiBaseUrl,
		openAiApiKey,
		openAiModelId,
		openAiModelInfo,
		openAiHeaders,
		ollamaModelId,
		ollamaBaseUrl,
		ollamaApiOptionsCtxNum,
		lmStudioModelId,
		lmStudioBaseUrl,
		anthropicBaseUrl,
		geminiApiKey,
		geminiBaseUrl,
		openAiNativeApiKey,
		deepSeekApiKey,
		requestyApiKey,
		requestyModelId,
		requestyModelInfo,
		togetherApiKey,
		togetherModelId,
		qwenApiKey,
		doubaoApiKey,
		mistralApiKey,
		azureApiVersion,
		openRouterModelId,
		openRouterModelInfo,
		openRouterProviderSorting,
		lastShownAnnouncementId,
		customInstructions,
		taskHistory,
		autoApprovalSettings,
		browserSettings,
		chatSettings,
		vsCodeLmModelSelector,
		liteLlmBaseUrl,
		liteLlmModelId,
		liteLlmModelInfo,
		liteLlmUsePromptCache,
		fireworksApiKey,
		fireworksModelId,
		fireworksModelMaxCompletionTokens,
		fireworksModelMaxTokens,
		userInfo,
		previousModeApiProvider,
		previousModeModelId,
		previousModeModelInfo,
		previousModeVsCodeLmModelSelector,
		previousModeThinkingBudgetTokens,
		previousModeReasoningEffort,
		previousModeAwsBedrockCustomSelected,
		previousModeAwsBedrockCustomModelBaseId,
		qwenApiLine,
		liteLlmApiKey,
		telemetrySetting,
		asksageApiKey,
		asksageApiUrl,
		xaiApiKey,
		thinkingBudgetTokens,
		reasoningEffort,
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
		globalWorkflowToggles,
	] = await Promise.all([
		getGlobalState(context, "isNewUser") as Promise<boolean | undefined>,
		getGlobalState(context, "apiProvider") as Promise<ApiProvider | undefined>,
		getGlobalState(context, "apiModelId") as Promise<string | undefined>,
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
		getGlobalState(context, "awsBedrockCustomSelected") as Promise<boolean | undefined>,
		getGlobalState(context, "awsBedrockCustomModelBaseId") as Promise<BedrockModelId | undefined>,
		getGlobalState(context, "vertexProjectId") as Promise<string | undefined>,
		getGlobalState(context, "vertexRegion") as Promise<string | undefined>,
		getGlobalState(context, "openAiBaseUrl") as Promise<string | undefined>,
		getSecret(context, "openAiApiKey") as Promise<string | undefined>,
		getGlobalState(context, "openAiModelId") as Promise<string | undefined>,
		getGlobalState(context, "openAiModelInfo") as Promise<ModelInfo | undefined>,
		getGlobalState(context, "openAiHeaders") as Promise<Record<string, string> | undefined>,
		getGlobalState(context, "ollamaModelId") as Promise<string | undefined>,
		getGlobalState(context, "ollamaBaseUrl") as Promise<string | undefined>,
		getGlobalState(context, "ollamaApiOptionsCtxNum") as Promise<string | undefined>,
		getGlobalState(context, "lmStudioModelId") as Promise<string | undefined>,
		getGlobalState(context, "lmStudioBaseUrl") as Promise<string | undefined>,
		getGlobalState(context, "anthropicBaseUrl") as Promise<string | undefined>,
		getSecret(context, "geminiApiKey") as Promise<string | undefined>,
		getGlobalState(context, "geminiBaseUrl") as Promise<string | undefined>,
		getSecret(context, "openAiNativeApiKey") as Promise<string | undefined>,
		getSecret(context, "deepSeekApiKey") as Promise<string | undefined>,
		getSecret(context, "requestyApiKey") as Promise<string | undefined>,
		getGlobalState(context, "requestyModelId") as Promise<string | undefined>,
		getGlobalState(context, "requestyModelInfo") as Promise<ModelInfo | undefined>,
		getSecret(context, "togetherApiKey") as Promise<string | undefined>,
		getGlobalState(context, "togetherModelId") as Promise<string | undefined>,
		getSecret(context, "qwenApiKey") as Promise<string | undefined>,
		getSecret(context, "doubaoApiKey") as Promise<string | undefined>,
		getSecret(context, "mistralApiKey") as Promise<string | undefined>,
		getGlobalState(context, "azureApiVersion") as Promise<string | undefined>,
		getGlobalState(context, "openRouterModelId") as Promise<string | undefined>,
		getGlobalState(context, "openRouterModelInfo") as Promise<ModelInfo | undefined>,
		getGlobalState(context, "openRouterProviderSorting") as Promise<string | undefined>,
		getGlobalState(context, "lastShownAnnouncementId") as Promise<string | undefined>,
		getGlobalState(context, "customInstructions") as Promise<string | undefined>,
		getGlobalState(context, "taskHistory") as Promise<HistoryItem[] | undefined>,
		getGlobalState(context, "autoApprovalSettings") as Promise<AutoApprovalSettings | undefined>,
		getGlobalState(context, "browserSettings") as Promise<BrowserSettings | undefined>,
		getGlobalState(context, "chatSettings") as Promise<ChatSettings | undefined>,
		getGlobalState(context, "vsCodeLmModelSelector") as Promise<vscode.LanguageModelChatSelector | undefined>,
		getGlobalState(context, "liteLlmBaseUrl") as Promise<string | undefined>,
		getGlobalState(context, "liteLlmModelId") as Promise<string | undefined>,
		getGlobalState(context, "liteLlmModelInfo") as Promise<ModelInfo | undefined>,
		getGlobalState(context, "liteLlmUsePromptCache") as Promise<boolean | undefined>,
		getSecret(context, "fireworksApiKey") as Promise<string | undefined>,
		getGlobalState(context, "fireworksModelId") as Promise<string | undefined>,
		getGlobalState(context, "fireworksModelMaxCompletionTokens") as Promise<number | undefined>,
		getGlobalState(context, "fireworksModelMaxTokens") as Promise<number | undefined>,
		getGlobalState(context, "userInfo") as Promise<UserInfo | undefined>,
		getGlobalState(context, "previousModeApiProvider") as Promise<ApiProvider | undefined>,
		getGlobalState(context, "previousModeModelId") as Promise<string | undefined>,
		getGlobalState(context, "previousModeModelInfo") as Promise<ModelInfo | undefined>,
		getGlobalState(context, "previousModeVsCodeLmModelSelector") as Promise<vscode.LanguageModelChatSelector | undefined>,
		getGlobalState(context, "previousModeThinkingBudgetTokens") as Promise<number | undefined>,
		getGlobalState(context, "previousModeReasoningEffort") as Promise<string | undefined>,
		getGlobalState(context, "previousModeAwsBedrockCustomSelected") as Promise<boolean | undefined>,
		getGlobalState(context, "previousModeAwsBedrockCustomModelBaseId") as Promise<BedrockModelId | undefined>,
		getGlobalState(context, "qwenApiLine") as Promise<string | undefined>,
		getSecret(context, "liteLlmApiKey") as Promise<string | undefined>,
		getGlobalState(context, "telemetrySetting") as Promise<TelemetrySetting | undefined>,
		getSecret(context, "asksageApiKey") as Promise<string | undefined>,
		getGlobalState(context, "asksageApiUrl") as Promise<string | undefined>,
		getSecret(context, "xaiApiKey") as Promise<string | undefined>,
		getGlobalState(context, "thinkingBudgetTokens") as Promise<number | undefined>,
		getGlobalState(context, "reasoningEffort") as Promise<string | undefined>,
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
		getGlobalState(context, "globalWorkflowToggles") as Promise<ClineRulesToggles | undefined>,
		fetch,
	])

	let apiProvider: ApiProvider
	if (storedApiProvider) {
		apiProvider = storedApiProvider
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

	const localClineRulesToggles = (await getWorkspaceState(context, "localClineRulesToggles")) as ClineRulesToggles

	const mcpMarketplaceEnabled = await migrateMcpMarketplaceEnableSetting(mcpMarketplaceEnabledRaw)
	const enableCheckpointsSetting = await migrateEnableCheckpointsSetting(enableCheckpointsSettingRaw)

	// Plan/Act separate models setting is a boolean indicating whether the user wants to use different models for plan and act. Existing users expect this to be enabled, while we want new users to opt in to this being disabled by default.
	// On win11 state sometimes initializes as empty string instead of undefined
	let planActSeparateModelsSetting: boolean | undefined = undefined
	if (planActSeparateModelsSettingRaw === true || planActSeparateModelsSettingRaw === false) {
		planActSeparateModelsSetting = planActSeparateModelsSettingRaw
	} else {
		// default to true for existing users
		if (storedApiProvider) {
			planActSeparateModelsSetting = true
		} else {
			// default to false for new users
			planActSeparateModelsSetting = false
		}
		// this is a special case where it's a new state, but we want it to default to different values for existing and new users.
		// persist so next time state is retrieved it's set to the correct value.
		await updateGlobalState(context, "planActSeparateModelsSetting", planActSeparateModelsSetting)
	}

	// Build nested provider configurations
	const anthropicConfig = {
		apiKey,
		baseUrl: anthropicBaseUrl,
	}

	const openrouterConfig = {
		apiKey: openRouterApiKey,
		modelId: openRouterModelId,
		modelInfo: openRouterModelInfo,
		providerSorting: openRouterProviderSorting,
	}

	const openaiConfig = {
		apiKey: openAiApiKey,
		modelId: openAiModelId,
		modelInfo: openAiModelInfo,
		baseUrl: openAiBaseUrl,
		headers: openAiHeaders || {},
	}

	const openaiNativeConfig = {
		apiKey: openAiNativeApiKey,
	}

	const awsConfig = {
		accessKey: awsAccessKey,
		secretKey: awsSecretKey,
		sessionToken: awsSessionToken,
		region: awsRegion,
		useCrossRegionInference: awsUseCrossRegionInference,
		bedrockUsePromptCache: awsBedrockUsePromptCache,
		bedrockEndpoint: awsBedrockEndpoint,
		profile: awsProfile,
		useProfile: awsUseProfile,
		bedrockCustomSelected: awsBedrockCustomSelected,
		bedrockCustomModelBaseId: awsBedrockCustomModelBaseId,
	}

	const vertexConfig = {
		projectId: vertexProjectId,
		region: vertexRegion,
	}

	const ollamaConfig = {
		modelId: ollamaModelId,
		baseUrl: ollamaBaseUrl,
		apiOptionsCtxNum: ollamaApiOptionsCtxNum,
	}

	const lmstudioConfig = {
		modelId: lmStudioModelId,
		baseUrl: lmStudioBaseUrl,
	}

	const geminiConfig = {
		apiKey: geminiApiKey,
		baseUrl: geminiBaseUrl,
	}

	const litellmConfig = {
		apiKey: liteLlmApiKey,
		modelId: liteLlmModelId,
		baseUrl: liteLlmBaseUrl,
		modelInfo: liteLlmModelInfo,
		usePromptCache: liteLlmUsePromptCache,
	}

	const fireworksConfig = {
		apiKey: fireworksApiKey,
		modelId: fireworksModelId,
		modelMaxCompletionTokens: fireworksModelMaxCompletionTokens,
		modelMaxTokens: fireworksModelMaxTokens,
	}

	const requestyConfig = {
		apiKey: requestyApiKey,
		modelId: requestyModelId,
		modelInfo: requestyModelInfo,
	}

	const togetherConfig = {
		apiKey: togetherApiKey,
		modelId: togetherModelId,
	}

	const deepseekConfig = {
		apiKey: deepSeekApiKey,
	}

	const qwenConfig = {
		apiKey: qwenApiKey,
		apiLine: qwenApiLine,
	}

	const doubaoConfig = {
		apiKey: doubaoApiKey,
	}

	const mistralConfig = {
		apiKey: mistralApiKey,
	}

	const azureConfig = {
		apiVersion: azureApiVersion,
	}

	const vscodeLMConfig = {
		modelSelector: vsCodeLmModelSelector,
	}

	const nebiusConfig = {
		apiKey: nebiusApiKey,
	}

	const asksageConfig = {
		apiKey: asksageApiKey,
		apiUrl: asksageApiUrl,
	}

	const xaiConfig = {
		apiKey: xaiApiKey,
	}

	const sambanovaConfig = {
		apiKey: sambanovaApiKey,
	}

	const cerebrasConfig = {
		apiKey: cerebrasApiKey,
	}

	const clineConfig = {
		apiKey: clineApiKey,
	}

	return {
		apiConfiguration: {
			apiProvider,
			apiModelId,

			// Provider-specific configurations
			anthropic: anthropicConfig,
			openrouter: openrouterConfig,
			openai: openaiConfig,
			openaiNative: openaiNativeConfig,
			aws: awsConfig,
			vertex: vertexConfig,
			ollama: ollamaConfig,
			lmstudio: lmstudioConfig,
			gemini: geminiConfig,
			litellm: litellmConfig,
			fireworks: fireworksConfig,
			requesty: requestyConfig,
			together: togetherConfig,
			deepseek: deepseekConfig,
			qwen: qwenConfig,
			doubao: doubaoConfig,
			mistral: mistralConfig,
			azure: azureConfig,
			vscodelm: vscodeLMConfig,
			nebius: nebiusConfig,
			asksage: asksageConfig,
			xai: xaiConfig,
			sambanova: sambanovaConfig,
			cerebras: cerebrasConfig,
			cline: clineConfig,

			// General settings
			thinkingBudgetTokens,
			reasoningEffort,
			favoritedModelIds,
			requestTimeoutMs,
		},
		isNewUser: isNewUser ?? true,
		lastShownAnnouncementId,
		customInstructions,
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
		previousModeApiProvider,
		previousModeModelId,
		previousModeModelInfo,
		previousModeVsCodeLmModelSelector,
		previousModeThinkingBudgetTokens,
		previousModeReasoningEffort,
		previousModeAwsBedrockCustomSelected,
		previousModeAwsBedrockCustomModelBaseId,
		mcpMarketplaceEnabled: mcpMarketplaceEnabled,
		telemetrySetting: telemetrySetting || "unset",
		planActSeparateModelsSetting,
		enableCheckpointsSetting: enableCheckpointsSetting,
		shellIntegrationTimeout: shellIntegrationTimeout || 4000,
		globalWorkflowToggles: globalWorkflowToggles || {},
	}
}

export async function updateApiConfiguration(context: vscode.ExtensionContext, apiConfiguration: ApiConfiguration) {
	const { apiProvider, apiModelId, thinkingBudgetTokens, reasoningEffort, favoritedModelIds, requestTimeoutMs } =
		apiConfiguration

	// Update core fields
	await updateGlobalState(context, "apiProvider", apiProvider)
	await updateGlobalState(context, "apiModelId", apiModelId)
	await updateGlobalState(context, "thinkingBudgetTokens", thinkingBudgetTokens)
	await updateGlobalState(context, "reasoningEffort", reasoningEffort)
	await updateGlobalState(context, "favoritedModelIds", favoritedModelIds)
	await updateGlobalState(context, "requestTimeoutMs", requestTimeoutMs)

	// Update provider-specific fields

	// Anthropic
	if (apiConfiguration.anthropic) {
		await storeSecret(context, "apiKey", apiConfiguration.anthropic.apiKey)
		await updateGlobalState(context, "anthropicBaseUrl", apiConfiguration.anthropic.baseUrl)
	}

	// OpenRouter
	if (apiConfiguration.openrouter) {
		await storeSecret(context, "openRouterApiKey", apiConfiguration.openrouter.apiKey)
		await updateGlobalState(context, "openRouterModelId", apiConfiguration.openrouter.modelId)
		await updateGlobalState(context, "openRouterModelInfo", apiConfiguration.openrouter.modelInfo)
		await updateGlobalState(context, "openRouterProviderSorting", apiConfiguration.openrouter.providerSorting)
	}

	// OpenAI
	if (apiConfiguration.openai) {
		await storeSecret(context, "openAiApiKey", apiConfiguration.openai.apiKey)
		await updateGlobalState(context, "openAiModelId", apiConfiguration.openai.modelId)
		await updateGlobalState(context, "openAiModelInfo", apiConfiguration.openai.modelInfo)
		await updateGlobalState(context, "openAiBaseUrl", apiConfiguration.openai.baseUrl)
		await updateGlobalState(context, "openAiHeaders", apiConfiguration.openai.headers || {})
	}

	// OpenAI Native
	if (apiConfiguration.openaiNative) {
		await storeSecret(context, "openAiNativeApiKey", apiConfiguration.openaiNative.apiKey)
	}

	// AWS Bedrock
	if (apiConfiguration.aws) {
		await storeSecret(context, "awsAccessKey", apiConfiguration.aws.accessKey)
		await storeSecret(context, "awsSecretKey", apiConfiguration.aws.secretKey)
		await storeSecret(context, "awsSessionToken", apiConfiguration.aws.sessionToken)
		await updateGlobalState(context, "awsRegion", apiConfiguration.aws.region)
		await updateGlobalState(context, "awsUseCrossRegionInference", apiConfiguration.aws.useCrossRegionInference)
		await updateGlobalState(context, "awsBedrockUsePromptCache", apiConfiguration.aws.bedrockUsePromptCache)
		await updateGlobalState(context, "awsBedrockEndpoint", apiConfiguration.aws.bedrockEndpoint)
		await updateGlobalState(context, "awsProfile", apiConfiguration.aws.profile)
		await updateGlobalState(context, "awsUseProfile", apiConfiguration.aws.useProfile)
		await updateGlobalState(context, "awsBedrockCustomSelected", apiConfiguration.aws.bedrockCustomSelected)
		await updateGlobalState(context, "awsBedrockCustomModelBaseId", apiConfiguration.aws.bedrockCustomModelBaseId)
	}

	// Vertex
	if (apiConfiguration.vertex) {
		await updateGlobalState(context, "vertexProjectId", apiConfiguration.vertex.projectId)
		await updateGlobalState(context, "vertexRegion", apiConfiguration.vertex.region)
	}

	// Ollama
	if (apiConfiguration.ollama) {
		await updateGlobalState(context, "ollamaModelId", apiConfiguration.ollama.modelId)
		await updateGlobalState(context, "ollamaBaseUrl", apiConfiguration.ollama.baseUrl)
		await updateGlobalState(context, "ollamaApiOptionsCtxNum", apiConfiguration.ollama.apiOptionsCtxNum)
	}

	// LM Studio
	if (apiConfiguration.lmstudio) {
		await updateGlobalState(context, "lmStudioModelId", apiConfiguration.lmstudio.modelId)
		await updateGlobalState(context, "lmStudioBaseUrl", apiConfiguration.lmstudio.baseUrl)
	}

	// Gemini
	if (apiConfiguration.gemini) {
		await storeSecret(context, "geminiApiKey", apiConfiguration.gemini.apiKey)
		await updateGlobalState(context, "geminiBaseUrl", apiConfiguration.gemini.baseUrl)
	}

	// LiteLLM
	if (apiConfiguration.litellm) {
		await storeSecret(context, "liteLlmApiKey", apiConfiguration.litellm.apiKey)
		await updateGlobalState(context, "liteLlmModelId", apiConfiguration.litellm.modelId)
		await updateGlobalState(context, "liteLlmBaseUrl", apiConfiguration.litellm.baseUrl)
		await updateGlobalState(context, "liteLlmModelInfo", apiConfiguration.litellm.modelInfo)
		await updateGlobalState(context, "liteLlmUsePromptCache", apiConfiguration.litellm.usePromptCache)
	}

	// Fireworks
	if (apiConfiguration.fireworks) {
		await storeSecret(context, "fireworksApiKey", apiConfiguration.fireworks.apiKey)
		await updateGlobalState(context, "fireworksModelId", apiConfiguration.fireworks.modelId)
		await updateGlobalState(context, "fireworksModelMaxCompletionTokens", apiConfiguration.fireworks.modelMaxCompletionTokens)
		await updateGlobalState(context, "fireworksModelMaxTokens", apiConfiguration.fireworks.modelMaxTokens)
	}

	// Requesty
	if (apiConfiguration.requesty) {
		await storeSecret(context, "requestyApiKey", apiConfiguration.requesty.apiKey)
		await updateGlobalState(context, "requestyModelId", apiConfiguration.requesty.modelId)
		await updateGlobalState(context, "requestyModelInfo", apiConfiguration.requesty.modelInfo)
	}

	// Together
	if (apiConfiguration.together) {
		await storeSecret(context, "togetherApiKey", apiConfiguration.together.apiKey)
		await updateGlobalState(context, "togetherModelId", apiConfiguration.together.modelId)
	}

	// DeepSeek
	if (apiConfiguration.deepseek) {
		await storeSecret(context, "deepSeekApiKey", apiConfiguration.deepseek.apiKey)
	}

	// Qwen
	if (apiConfiguration.qwen) {
		await storeSecret(context, "qwenApiKey", apiConfiguration.qwen.apiKey)
		await updateGlobalState(context, "qwenApiLine", apiConfiguration.qwen.apiLine)
	}

	// Doubao
	if (apiConfiguration.doubao) {
		await storeSecret(context, "doubaoApiKey", apiConfiguration.doubao.apiKey)
	}

	// Mistral
	if (apiConfiguration.mistral) {
		await storeSecret(context, "mistralApiKey", apiConfiguration.mistral.apiKey)
	}

	// Azure
	if (apiConfiguration.azure) {
		await updateGlobalState(context, "azureApiVersion", apiConfiguration.azure.apiVersion)
	}

	// VSCode
	if (apiConfiguration.vscodelm) {
		await updateGlobalState(context, "vsCodeLmModelSelector", apiConfiguration.vscodelm.modelSelector)
	}

	// Nebius
	if (apiConfiguration.nebius) {
		await storeSecret(context, "nebiusApiKey", apiConfiguration.nebius.apiKey)
	}

	// AskSage
	if (apiConfiguration.asksage) {
		await storeSecret(context, "asksageApiKey", apiConfiguration.asksage.apiKey)
		await updateGlobalState(context, "asksageApiUrl", apiConfiguration.asksage.apiUrl)
	}

	// XAI
	if (apiConfiguration.xai) {
		await storeSecret(context, "xaiApiKey", apiConfiguration.xai.apiKey)
	}

	// SambaNova
	if (apiConfiguration.sambanova) {
		await storeSecret(context, "sambanovaApiKey", apiConfiguration.sambanova.apiKey)
	}

	// Cerebras
	if (apiConfiguration.cerebras) {
		await storeSecret(context, "cerebrasApiKey", apiConfiguration.cerebras.apiKey)
	}

	// Cline
	if (apiConfiguration.cline) {
		await storeSecret(context, "clineApiKey", apiConfiguration.cline.apiKey)
	}
}

export async function resetExtensionState(context: vscode.ExtensionContext) {
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
		"authNonce",
	]
	for (const key of secretKeys) {
		await storeSecret(context, key, undefined)
	}
}
