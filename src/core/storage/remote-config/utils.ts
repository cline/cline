import { RemoteConfig } from "@shared/remote-config/schema"
import { GlobalStateAndSettings } from "@shared/storage/state-keys"
import { StateManager } from "../StateManager"

/**
 * Transforms RemoteConfig schema to GlobalStateAndSettings shape
 * @param remoteConfig The remote configuration object
 * @returns Partial<GlobalStateAndSettings> containing only the fields present in remote config
 */
export function transformRemoteConfigToStateShape(remoteConfig: RemoteConfig): Partial<GlobalStateAndSettings> {
	const transformed: Partial<GlobalStateAndSettings> = {}

	// Map top-level settings
	if (remoteConfig.telemetryEnabled !== undefined) {
		transformed.telemetrySetting = remoteConfig.telemetryEnabled ? "enabled" : "disabled"
	}
	if (remoteConfig.mcpMarketplaceEnabled !== undefined) {
		transformed.mcpMarketplaceEnabled = remoteConfig.mcpMarketplaceEnabled
	}
	if (remoteConfig.yoloModeAllowed !== undefined) {
		// only set the yoloModeToggled field if yolo mode is not allowed. Otherwise, we let the user toggle it.
		if (remoteConfig.yoloModeAllowed === false) {
			transformed.yoloModeToggled = false
		}
	}

	// Map OpenAiCompatible provider settings
	const openAiSettings = remoteConfig.providerSettings?.OpenAiCompatible
	if (openAiSettings) {
		transformed.planModeApiProvider = "openai"
		transformed.actModeApiProvider = "openai"

		if (openAiSettings.openAiBaseUrl !== undefined && openAiSettings.openAiBaseUrl !== "") {
			transformed.openAiBaseUrl = openAiSettings.openAiBaseUrl
		}
		if (openAiSettings.openAiHeaders !== undefined) {
			// Filter out empty string values from headers
			const filteredHeaders = Object.fromEntries(
				Object.entries(openAiSettings.openAiHeaders).filter(([_, value]) => value !== ""),
			)
			// Only set if there are any non-empty headers
			if (Object.keys(filteredHeaders).length > 0) {
				transformed.openAiHeaders = filteredHeaders
			}
		}
		if (openAiSettings.azureApiVersion !== undefined && openAiSettings.azureApiVersion !== "") {
			transformed.azureApiVersion = openAiSettings.azureApiVersion
		}
	}

	// Map AwsBedrock provider settings
	const awsBedrockSettings = remoteConfig.providerSettings?.AwsBedrock
	if (awsBedrockSettings) {
		transformed.planModeApiProvider = "bedrock"
		transformed.actModeApiProvider = "bedrock"

		if (awsBedrockSettings.awsRegion !== undefined && awsBedrockSettings.awsRegion !== "") {
			transformed.awsRegion = awsBedrockSettings.awsRegion
		}
		if (awsBedrockSettings.awsUseCrossRegionInference !== undefined) {
			transformed.awsUseCrossRegionInference = awsBedrockSettings.awsUseCrossRegionInference
		}
		if (awsBedrockSettings.awsUseGlobalInference !== undefined) {
			transformed.awsUseGlobalInference = awsBedrockSettings.awsUseGlobalInference
		}
		if (awsBedrockSettings.awsBedrockUsePromptCache !== undefined) {
			transformed.awsBedrockUsePromptCache = awsBedrockSettings.awsBedrockUsePromptCache
		}
		if (awsBedrockSettings.awsBedrockEndpoint !== undefined && awsBedrockSettings.awsBedrockEndpoint !== "") {
			transformed.awsBedrockEndpoint = awsBedrockSettings.awsBedrockEndpoint
		}
	}

	return transformed
}

/**
 * Applies remote config to the StateManager's remote config cache
 * @param remoteConfig The remote configuration object to apply
 */
export function applyRemoteConfig(remoteConfig?: RemoteConfig): void {
	const stateManager = StateManager.get()

	// If no remote config provided, clear the cache
	if (!remoteConfig) {
		stateManager.clearRemoteConfig()
		return
	}

	// Transform remote config to state shape
	const transformed = transformRemoteConfigToStateShape(remoteConfig)

	// Clear existing remote config cache
	stateManager.clearRemoteConfig()

	// Populate remote config cache with transformed values
	for (const [key, value] of Object.entries(transformed)) {
		stateManager.setRemoteConfigField(key as keyof GlobalStateAndSettings, value)
	}
}
