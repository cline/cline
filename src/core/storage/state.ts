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
import { PROVIDER_FIELD_MAPPINGS } from "./provider-field-mappings"
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

/**
 * Dynamically updates provider configurations based on the field mappings
 */
async function updateProviderConfigurations(context: vscode.ExtensionContext, apiConfiguration: ApiConfiguration) {
	// Iterate through each provider in the mappings
	for (const [providerName, mapping] of Object.entries(PROVIDER_FIELD_MAPPINGS)) {
		const providerConfig = (apiConfiguration as any)[providerName]

		if (providerConfig) {
			// Update secrets
			if ("secrets" in mapping && mapping.secrets) {
				for (const [fieldName, secretKey] of Object.entries(mapping.secrets)) {
					const value = providerConfig[fieldName]
					await storeSecret(context, secretKey as SecretKey, value)
				}
			}

			// Update global state
			if ("globalState" in mapping && mapping.globalState) {
				for (const [fieldName, globalStateKey] of Object.entries(mapping.globalState)) {
					const value = providerConfig[fieldName]
					// Handle special case for headers field which should default to empty object
					const finalValue = fieldName === "headers" ? value || {} : value
					await updateGlobalState(context, globalStateKey as GlobalStateKey, finalValue)
				}
			}
		}
	}
}

/**
 * Dynamically loads all provider-specific storage values based on the field mappings
 */
async function loadProviderStorageValues(context: vscode.ExtensionContext): Promise<Record<string, any>> {
	const promises: Promise<any>[] = []
	const keys: string[] = []

	// Collect all storage operations
	for (const [providerName, mapping] of Object.entries(PROVIDER_FIELD_MAPPINGS)) {
		// Add secret promises
		if ("secrets" in mapping && mapping.secrets) {
			for (const [fieldName, secretKey] of Object.entries(mapping.secrets)) {
				promises.push(getSecret(context, secretKey as SecretKey))
				keys.push(`${providerName}.${fieldName}`)
			}
		}

		// Add global state promises
		if ("globalState" in mapping && mapping.globalState) {
			for (const [fieldName, globalStateKey] of Object.entries(mapping.globalState)) {
				promises.push(getGlobalState(context, globalStateKey as GlobalStateKey))
				keys.push(`${providerName}.${fieldName}`)
			}
		}
	}

	// Execute all promises
	const values = await Promise.all(promises)

	// Build result object
	const result: Record<string, any> = {}
	for (let i = 0; i < keys.length; i++) {
		const [providerName, fieldName] = keys[i].split(".")
		if (!result[providerName]) {
			result[providerName] = {}
		}
		result[providerName][fieldName] = values[i]
	}

	return result
}

/**
 * Builds provider configurations from loaded storage values
 */
function buildProviderConfigurations(providerValues: Record<string, any>): Record<string, any> {
	const configs: Record<string, any> = {}

	for (const [providerName, values] of Object.entries(providerValues)) {
		// Handle special case for headers field which should default to empty object
		if (values.headers !== undefined) {
			values.headers = values.headers || {}
		}

		configs[providerName] = values
	}

	return configs
}

export async function getAllExtensionState(context: vscode.ExtensionContext) {
	// Load core extension state and provider configurations in parallel
	const [coreState, providerValues] = await Promise.all([
		// Core extension state (non-provider specific)
		Promise.all([
			getGlobalState(context, "isNewUser") as Promise<boolean | undefined>,
			getGlobalState(context, "apiProvider") as Promise<ApiProvider | undefined>,
			getGlobalState(context, "apiModelId") as Promise<string | undefined>,
			getGlobalState(context, "lastShownAnnouncementId") as Promise<string | undefined>,
			getGlobalState(context, "customInstructions") as Promise<string | undefined>,
			getGlobalState(context, "taskHistory") as Promise<HistoryItem[] | undefined>,
			getGlobalState(context, "autoApprovalSettings") as Promise<AutoApprovalSettings | undefined>,
			getGlobalState(context, "browserSettings") as Promise<BrowserSettings | undefined>,
			getGlobalState(context, "chatSettings") as Promise<ChatSettings | undefined>,
			getGlobalState(context, "userInfo") as Promise<UserInfo | undefined>,
			getGlobalState(context, "previousModeApiProvider") as Promise<ApiProvider | undefined>,
			getGlobalState(context, "previousModeModelId") as Promise<string | undefined>,
			getGlobalState(context, "previousModeModelInfo") as Promise<ModelInfo | undefined>,
			getGlobalState(context, "previousModeVsCodeLmModelSelector") as Promise<vscode.LanguageModelChatSelector | undefined>,
			getGlobalState(context, "previousModeThinkingBudgetTokens") as Promise<number | undefined>,
			getGlobalState(context, "previousModeReasoningEffort") as Promise<string | undefined>,
			getGlobalState(context, "previousModeAwsBedrockCustomSelected") as Promise<boolean | undefined>,
			getGlobalState(context, "previousModeAwsBedrockCustomModelBaseId") as Promise<BedrockModelId | undefined>,
			getGlobalState(context, "telemetrySetting") as Promise<TelemetrySetting | undefined>,
			getGlobalState(context, "thinkingBudgetTokens") as Promise<number | undefined>,
			getGlobalState(context, "reasoningEffort") as Promise<string | undefined>,
			getGlobalState(context, "planActSeparateModelsSetting") as Promise<boolean | undefined>,
			getGlobalState(context, "favoritedModelIds") as Promise<string[] | undefined>,
			getGlobalState(context, "globalClineRulesToggles") as Promise<ClineRulesToggles | undefined>,
			getGlobalState(context, "requestTimeoutMs") as Promise<number | undefined>,
			getGlobalState(context, "shellIntegrationTimeout") as Promise<number | undefined>,
			getGlobalState(context, "enableCheckpointsSetting") as Promise<boolean | undefined>,
			getGlobalState(context, "mcpMarketplaceEnabled") as Promise<boolean | undefined>,
			getGlobalState(context, "globalWorkflowToggles") as Promise<ClineRulesToggles | undefined>,
		]),
		// Provider-specific configurations loaded dynamically
		loadProviderStorageValues(context),
	])

	const [
		isNewUser,
		storedApiProvider,
		apiModelId,
		lastShownAnnouncementId,
		customInstructions,
		taskHistory,
		autoApprovalSettings,
		browserSettings,
		chatSettings,
		userInfo,
		previousModeApiProvider,
		previousModeModelId,
		previousModeModelInfo,
		previousModeVsCodeLmModelSelector,
		previousModeThinkingBudgetTokens,
		previousModeReasoningEffort,
		previousModeAwsBedrockCustomSelected,
		previousModeAwsBedrockCustomModelBaseId,
		telemetrySetting,
		thinkingBudgetTokens,
		reasoningEffort,
		planActSeparateModelsSettingRaw,
		favoritedModelIds,
		globalClineRulesToggles,
		requestTimeoutMs,
		shellIntegrationTimeout,
		enableCheckpointsSettingRaw,
		mcpMarketplaceEnabledRaw,
		globalWorkflowToggles,
	] = coreState

	// Determine API provider
	let apiProvider: ApiProvider
	if (storedApiProvider) {
		apiProvider = storedApiProvider
	} else {
		// Either new user or legacy user that doesn't have the apiProvider stored in state
		// (If they're using OpenRouter or Bedrock, then apiProvider state will exist)
		if (providerValues.anthropic?.apiKey) {
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

	// Build provider configurations dynamically
	const providerConfigurations = buildProviderConfigurations(providerValues)

	return {
		apiConfiguration: {
			apiProvider,
			apiModelId,

			// Provider-specific configurations (built dynamically)
			...providerConfigurations,

			// General settings
			thinkingBudgetTokens,
			reasoningEffort,
			favoritedModelIds,
			requestTimeoutMs,
		} as ApiConfiguration,
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

	// Update provider-specific fields dynamically
	await updateProviderConfigurations(context, apiConfiguration)
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
