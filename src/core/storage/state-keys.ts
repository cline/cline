import { PROVIDER_FIELD_MAPPINGS } from "./provider-field-mappings"

// Extract provider-specific secret keys from the mappings
type ProviderSecretKeys = {
	[ProviderName in keyof typeof PROVIDER_FIELD_MAPPINGS]: (typeof PROVIDER_FIELD_MAPPINGS)[ProviderName] extends {
		secrets: infer SecretsConfig
	}
		? SecretsConfig extends Record<string, infer SecretKey>
			? SecretKey
			: never
		: never
}[keyof typeof PROVIDER_FIELD_MAPPINGS]

// Extract provider-specific global state keys from the mappings
type ProviderGlobalStateKeys = {
	[ProviderName in keyof typeof PROVIDER_FIELD_MAPPINGS]: (typeof PROVIDER_FIELD_MAPPINGS)[ProviderName] extends {
		globalState: infer GlobalStateConfig
	}
		? GlobalStateConfig extends Record<string, infer GlobalStateKey>
			? GlobalStateKey
			: never
		: never
}[keyof typeof PROVIDER_FIELD_MAPPINGS]

// Core secret keys that aren't provider-specific
type CoreSecretKeys = "authNonce"

// Core global state keys that aren't provider-specific
type CoreGlobalStateKeys =
	| "apiProvider"
	| "apiModelId"
	| "lastShownAnnouncementId"
	| "customInstructions"
	| "taskHistory"
	| "autoApprovalSettings"
	| "globalClineRulesToggles"
	| "globalWorkflowToggles"
	| "browserSettings"
	| "chatSettings"
	| "userInfo"
	| "previousModeApiProvider"
	| "previousModeModelId"
	| "previousModeThinkingBudgetTokens"
	| "previousModeReasoningEffort"
	| "previousModeVsCodeLmModelSelector"
	| "previousModeAwsBedrockCustomSelected"
	| "previousModeAwsBedrockCustomModelBaseId"
	| "previousModeModelInfo"
	| "mcpMarketplaceCatalog"
	| "telemetrySetting"
	| "thinkingBudgetTokens"
	| "reasoningEffort"
	| "planActSeparateModelsSetting"
	| "enableCheckpointsSetting"
	| "mcpMarketplaceEnabled"
	| "favoritedModelIds"
	| "requestTimeoutMs"
	| "shellIntegrationTimeout"
	| "isNewUser"

// Final exported types combining provider-specific and core keys
export type SecretKey = ProviderSecretKeys | CoreSecretKeys
export type GlobalStateKey = ProviderGlobalStateKeys | CoreGlobalStateKeys
export type LocalStateKey = "localClineRulesToggles"
