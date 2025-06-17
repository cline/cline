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
import { ensureRulesDirectoryExists } from "./disk"
import fs from "fs/promises"
import path from "path"
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

export async function migratePlanActGlobalToWorkspaceStorage(context: vscode.ExtensionContext) {
	// Keys that were migrated from global storage to workspace storage
	const keysToMigrate = [
		// Core settings
		"apiProvider",
		"apiModelId",
		"thinkingBudgetTokens",
		"reasoningEffort",
		"chatSettings",
		"vsCodeLmModelSelector",

		// Provider-specific model keys
		"awsBedrockCustomSelected",
		"awsBedrockCustomModelBaseId",
		"openRouterModelId",
		"openRouterModelInfo",
		"openAiModelId",
		"openAiModelInfo",
		"ollamaModelId",
		"lmStudioModelId",
		"liteLlmModelId",
		"liteLlmModelInfo",
		"requestyModelId",
		"requestyModelInfo",
		"togetherModelId",
		"fireworksModelId",

		// Previous mode settings
		"previousModeApiProvider",
		"previousModeModelId",
		"previousModeModelInfo",
		"previousModeVsCodeLmModelSelector",
		"previousModeThinkingBudgetTokens",
		"previousModeReasoningEffort",
		"previousModeAwsBedrockCustomSelected",
		"previousModeAwsBedrockCustomModelBaseId",
	]

	for (const key of keysToMigrate) {
		const globalValue = await getGlobalState(context, key as GlobalStateKey)
		if (globalValue !== undefined) {
			const workspaceValue = await getWorkspaceState(context, key)
			if (workspaceValue === undefined) {
				await updateWorkspaceState(context, key, globalValue)
			}
			// Delete from global storage regardless of whether we copied it
			await updateGlobalState(context, key as GlobalStateKey, undefined)
		}
	}
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

export async function migrateCustomInstructionsToGlobalRules(context: vscode.ExtensionContext) {
	try {
		const customInstructions = (await context.globalState.get("customInstructions")) as string | undefined

		if (customInstructions?.trim()) {
			console.log("Migrating custom instructions to global Cline rules...")

			// Create global .clinerules directory if it doesn't exist
			const globalRulesDir = await ensureRulesDirectoryExists()

			// Use a fixed filename for custom instructions
			const migrationFileName = "custom_instructions.md"
			const migrationFilePath = path.join(globalRulesDir, migrationFileName)

			try {
				// Check if file already exists to determine if we should append
				let existingContent = ""
				try {
					existingContent = await fs.readFile(migrationFilePath, "utf8")
				} catch (readError) {
					// File doesn't exist, which is fine
				}

				// Append or create the file with custom instructions
				const contentToWrite = existingContent
					? `${existingContent}\n\n---\n\n${customInstructions.trim()}`
					: customInstructions.trim()

				await fs.writeFile(migrationFilePath, contentToWrite)
				console.log(`Successfully ${existingContent ? "appended to" : "created"} migration file: ${migrationFilePath}`)
			} catch (fileError) {
				console.error("Failed to write migration file:", fileError)
				return
			}

			// Remove customInstructions from global state only after successful file creation
			await context.globalState.update("customInstructions", undefined)
			console.log("Successfully migrated custom instructions to global Cline rules")
		}
	} catch (error) {
		console.error("Failed to migrate custom instructions to global rules:", error)
		// Continue execution - migration failure shouldn't break extension startup
	}
}

export async function getAllExtensionState(context: vscode.ExtensionContext) {
	const [
		isNewUser,
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
		sapAiCoreModelId,
		claudeCodePath,
	] = await Promise.all([
		getGlobalState(context, "isNewUser") as Promise<boolean | undefined>,
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
		getGlobalState(context, "sapAiCoreModelId") as Promise<string | undefined>,
		getGlobalState(context, "claudeCodePath") as Promise<string | undefined>,
	])

	const localClineRulesToggles = (await getWorkspaceState(context, "localClineRulesToggles")) as ClineRulesToggles

	const [
		chatSettings,
		storedApiProvider,
		apiModelId,
		thinkingBudgetTokens,
		reasoningEffort,
		vsCodeLmModelSelector,
		awsBedrockCustomSelected,
		awsBedrockCustomModelBaseId,
		openRouterModelId,
		openRouterModelInfo,
		openAiModelId,
		openAiModelInfo,
		ollamaModelId,
		lmStudioModelId,
		liteLlmModelId,
		liteLlmModelInfo,
		requestyModelId,
		requestyModelInfo,
		togetherModelId,
		fireworksModelId,
		previousModeApiProvider,
		previousModeModelId,
		previousModeModelInfo,
		previousModeVsCodeLmModelSelector,
		previousModeThinkingBudgetTokens,
		previousModeReasoningEffort,
		previousModeAwsBedrockCustomSelected,
		previousModeAwsBedrockCustomModelBaseId,
		previousModeSapAiCoreClientId,
		previousModeSapAiCoreClientSecret,
		previousModeSapAiCoreBaseUrl,
		previousModeSapAiCoreTokenUrl,
		previousModeSapAiCoreResourceGroup,
		previousModeSapAiCoreModelId,
	] = await Promise.all([
		getWorkspaceState(context, "chatSettings") as Promise<ChatSettings | undefined>,
		getWorkspaceState(context, "apiProvider") as Promise<ApiProvider | undefined>,
		getWorkspaceState(context, "apiModelId") as Promise<string | undefined>,
		getWorkspaceState(context, "thinkingBudgetTokens") as Promise<number | undefined>,
		getWorkspaceState(context, "reasoningEffort") as Promise<string | undefined>,
		getWorkspaceState(context, "vsCodeLmModelSelector") as Promise<vscode.LanguageModelChatSelector | undefined>,
		getWorkspaceState(context, "awsBedrockCustomSelected") as Promise<boolean | undefined>,
		getWorkspaceState(context, "awsBedrockCustomModelBaseId") as Promise<BedrockModelId | undefined>,
		getWorkspaceState(context, "openRouterModelId") as Promise<string | undefined>,
		getWorkspaceState(context, "openRouterModelInfo") as Promise<ModelInfo | undefined>,
		getWorkspaceState(context, "openAiModelId") as Promise<string | undefined>,
		getWorkspaceState(context, "openAiModelInfo") as Promise<ModelInfo | undefined>,
		getWorkspaceState(context, "ollamaModelId") as Promise<string | undefined>,
		getWorkspaceState(context, "lmStudioModelId") as Promise<string | undefined>,
		getWorkspaceState(context, "liteLlmModelId") as Promise<string | undefined>,
		getWorkspaceState(context, "liteLlmModelInfo") as Promise<ModelInfo | undefined>,
		getWorkspaceState(context, "requestyModelId") as Promise<string | undefined>,
		getWorkspaceState(context, "requestyModelInfo") as Promise<ModelInfo | undefined>,
		getWorkspaceState(context, "togetherModelId") as Promise<string | undefined>,
		getWorkspaceState(context, "fireworksModelId") as Promise<string | undefined>,
		getWorkspaceState(context, "previousModeApiProvider") as Promise<ApiProvider | undefined>,
		getWorkspaceState(context, "previousModeModelId") as Promise<string | undefined>,
		getWorkspaceState(context, "previousModeModelInfo") as Promise<ModelInfo | undefined>,
		getWorkspaceState(context, "previousModeVsCodeLmModelSelector") as Promise<vscode.LanguageModelChatSelector | undefined>,
		getWorkspaceState(context, "previousModeThinkingBudgetTokens") as Promise<number | undefined>,
		getWorkspaceState(context, "previousModeReasoningEffort") as Promise<string | undefined>,
		getWorkspaceState(context, "previousModeAwsBedrockCustomSelected") as Promise<boolean | undefined>,
		getWorkspaceState(context, "previousModeAwsBedrockCustomModelBaseId") as Promise<BedrockModelId | undefined>,
		getWorkspaceState(context, "previousModeSapAiCoreClientId") as Promise<string | undefined>,
		getWorkspaceState(context, "previousModeSapAiCoreClientSecret") as Promise<string | undefined>,
		getWorkspaceState(context, "previousModeSapAiCoreBaseUrl") as Promise<string | undefined>,
		getWorkspaceState(context, "previousModeSapAiCoreTokenUrl") as Promise<string | undefined>,
		getWorkspaceState(context, "previousModeSapAiCoreResourceGroup") as Promise<string | undefined>,
		getWorkspaceState(context, "previousModeSapAiCoreModelId") as Promise<string | undefined>,
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

	return {
		apiConfiguration: {
			apiProvider,
			apiModelId,
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
			awsBedrockCustomSelected,
			awsBedrockCustomModelBaseId,
			vertexProjectId,
			vertexRegion,
			openAiBaseUrl,
			openAiApiKey,
			openAiModelId,
			openAiModelInfo,
			openAiHeaders: openAiHeaders || {},
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
			qwenApiLine,
			doubaoApiKey,
			mistralApiKey,
			azureApiVersion,
			openRouterModelId,
			openRouterModelInfo,
			openRouterProviderSorting,
			vsCodeLmModelSelector,
			thinkingBudgetTokens,
			reasoningEffort,
			liteLlmBaseUrl,
			liteLlmModelId,
			liteLlmModelInfo,
			liteLlmApiKey,
			liteLlmUsePromptCache,
			fireworksApiKey,
			fireworksModelId,
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
			sapAiCoreModelId,
		},
		isNewUser: isNewUser ?? true,
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
		previousModeApiProvider,
		previousModeModelId,
		previousModeModelInfo,
		previousModeVsCodeLmModelSelector,
		previousModeThinkingBudgetTokens,
		previousModeReasoningEffort,
		previousModeAwsBedrockCustomSelected,
		previousModeAwsBedrockCustomModelBaseId,
		previousModeSapAiCoreClientId,
		previousModeSapAiCoreClientSecret,
		previousModeSapAiCoreBaseUrl,
		previousModeSapAiCoreTokenUrl,
		previousModeSapAiCoreResourceGroup,
		previousModeSapAiCoreModelId,
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
		apiProvider,
		apiModelId,
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
		vsCodeLmModelSelector,
		liteLlmBaseUrl,
		liteLlmModelId,
		liteLlmModelInfo,
		liteLlmApiKey,
		liteLlmUsePromptCache,
		qwenApiLine,
		asksageApiKey,
		asksageApiUrl,
		xaiApiKey,
		thinkingBudgetTokens,
		reasoningEffort,
		clineApiKey,
		sambanovaApiKey,
		cerebrasApiKey,
		nebiusApiKey,
		favoritedModelIds,
		fireworksApiKey,
		fireworksModelId,
		fireworksModelMaxCompletionTokens,
		fireworksModelMaxTokens,
		sapAiCoreClientId,
		sapAiCoreClientSecret,
		sapAiCoreBaseUrl,
		sapAiCoreTokenUrl,
		sapAiResourceGroup,
		sapAiCoreModelId,
		claudeCodePath,
	} = apiConfiguration
	// Workspace state updates
	await updateWorkspaceState(context, "apiProvider", apiProvider)
	await updateWorkspaceState(context, "apiModelId", apiModelId)
	await updateWorkspaceState(context, "thinkingBudgetTokens", thinkingBudgetTokens)
	await updateWorkspaceState(context, "reasoningEffort", reasoningEffort)
	await updateWorkspaceState(context, "vsCodeLmModelSelector", vsCodeLmModelSelector)
	await updateWorkspaceState(context, "awsBedrockCustomSelected", awsBedrockCustomSelected)
	await updateWorkspaceState(context, "awsBedrockCustomModelBaseId", awsBedrockCustomModelBaseId)
	await updateWorkspaceState(context, "openRouterModelId", openRouterModelId)
	await updateWorkspaceState(context, "openRouterModelInfo", openRouterModelInfo)
	await updateWorkspaceState(context, "openAiModelId", openAiModelId)
	await updateWorkspaceState(context, "openAiModelInfo", openAiModelInfo)
	await updateWorkspaceState(context, "ollamaModelId", ollamaModelId)
	await updateWorkspaceState(context, "lmStudioModelId", lmStudioModelId)
	await updateWorkspaceState(context, "liteLlmModelId", liteLlmModelId)
	await updateWorkspaceState(context, "liteLlmModelInfo", liteLlmModelInfo)
	await updateWorkspaceState(context, "requestyModelId", requestyModelId)
	await updateWorkspaceState(context, "requestyModelInfo", requestyModelInfo)
	await updateWorkspaceState(context, "togetherModelId", togetherModelId)
	await updateWorkspaceState(context, "fireworksModelId", fireworksModelId)

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
	await updateGlobalState(context, "favoritedModelIds", favoritedModelIds)
	await updateGlobalState(context, "requestTimeoutMs", apiConfiguration.requestTimeoutMs)
	await updateGlobalState(context, "sapAiCoreBaseUrl", sapAiCoreBaseUrl)
	await updateGlobalState(context, "sapAiCoreTokenUrl", sapAiCoreTokenUrl)
	await updateGlobalState(context, "sapAiResourceGroup", sapAiResourceGroup)
	await updateGlobalState(context, "sapAiCoreModelId", sapAiCoreModelId)
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
