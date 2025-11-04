import { RemoteConfig } from "@shared/remote-config/schema"
import { RemoteConfigFields } from "@shared/storage/state-keys"
import { StateManager } from "../StateManager"

/**
 * Transforms RemoteConfig schema to RemoteConfigFields shape
 * @param remoteConfig The remote configuration object
 * @returns Partial<RemoteConfigFields> containing only the fields present in remote config
 */
export function transformRemoteConfigToStateShape(remoteConfig: RemoteConfig): Partial<RemoteConfigFields> {
	const transformed: Partial<RemoteConfigFields> = {}

	// Map top-level settings
	if (remoteConfig.telemetryEnabled !== undefined) {
		transformed.telemetrySetting = remoteConfig.telemetryEnabled ? "enabled" : "disabled"
	}
	if (remoteConfig.mcpMarketplaceEnabled !== undefined) {
		transformed.mcpMarketplaceEnabled = remoteConfig.mcpMarketplaceEnabled
	}
	if (remoteConfig.allowedMCPServers !== undefined) {
		transformed.allowedMCPServers = remoteConfig.allowedMCPServers
	}
	if (remoteConfig.yoloModeAllowed !== undefined) {
		// only set the yoloModeToggled field if yolo mode is not allowed. Otherwise, we let the user toggle it.
		if (remoteConfig.yoloModeAllowed === false) {
			transformed.yoloModeToggled = false
		}
	}

	// Map OpenTelemetry settings
	if (remoteConfig.openTelemetryEnabled !== undefined) {
		transformed.openTelemetryEnabled = remoteConfig.openTelemetryEnabled
	}
	if (remoteConfig.openTelemetryMetricsExporter !== undefined) {
		transformed.openTelemetryMetricsExporter = remoteConfig.openTelemetryMetricsExporter
	}
	if (remoteConfig.openTelemetryLogsExporter !== undefined) {
		transformed.openTelemetryLogsExporter = remoteConfig.openTelemetryLogsExporter
	}
	if (remoteConfig.openTelemetryOtlpProtocol !== undefined) {
		transformed.openTelemetryOtlpProtocol = remoteConfig.openTelemetryOtlpProtocol
	}
	if (remoteConfig.openTelemetryOtlpEndpoint !== undefined) {
		transformed.openTelemetryOtlpEndpoint = remoteConfig.openTelemetryOtlpEndpoint
	}
	if (remoteConfig.openTelemetryOtlpMetricsProtocol !== undefined) {
		transformed.openTelemetryOtlpMetricsProtocol = remoteConfig.openTelemetryOtlpMetricsProtocol
	}
	if (remoteConfig.openTelemetryOtlpMetricsEndpoint !== undefined) {
		transformed.openTelemetryOtlpMetricsEndpoint = remoteConfig.openTelemetryOtlpMetricsEndpoint
	}
	if (remoteConfig.openTelemetryOtlpLogsProtocol !== undefined) {
		transformed.openTelemetryOtlpLogsProtocol = remoteConfig.openTelemetryOtlpLogsProtocol
	}
	if (remoteConfig.openTelemetryOtlpLogsEndpoint !== undefined) {
		transformed.openTelemetryOtlpLogsEndpoint = remoteConfig.openTelemetryOtlpLogsEndpoint
	}
	if (remoteConfig.openTelemetryMetricExportInterval !== undefined) {
		transformed.openTelemetryMetricExportInterval = remoteConfig.openTelemetryMetricExportInterval
	}
	if (remoteConfig.openTelemetryOtlpInsecure !== undefined) {
		transformed.openTelemetryOtlpInsecure = remoteConfig.openTelemetryOtlpInsecure
	}
	if (remoteConfig.openTelemetryLogBatchSize !== undefined) {
		transformed.openTelemetryLogBatchSize = remoteConfig.openTelemetryLogBatchSize
	}
	if (remoteConfig.openTelemetryLogBatchTimeout !== undefined) {
		transformed.openTelemetryLogBatchTimeout = remoteConfig.openTelemetryLogBatchTimeout
	}
	if (remoteConfig.openTelemetryLogMaxQueueSize !== undefined) {
		transformed.openTelemetryLogMaxQueueSize = remoteConfig.openTelemetryLogMaxQueueSize
	}

	// Map provider settings

	const providers: string[] = []

	// Map OpenAiCompatible provider settings
	const openAiSettings = remoteConfig.providerSettings?.OpenAiCompatible
	if (openAiSettings) {
		transformed.planModeApiProvider = "openai"
		transformed.actModeApiProvider = "openai"
		providers.push("openai")

		if (openAiSettings.openAiBaseUrl !== undefined) {
			transformed.openAiBaseUrl = openAiSettings.openAiBaseUrl
		}
		if (openAiSettings.openAiHeaders !== undefined) {
			transformed.openAiHeaders = openAiSettings.openAiHeaders
		}
		if (openAiSettings.azureApiVersion !== undefined) {
			transformed.azureApiVersion = openAiSettings.azureApiVersion
		}
	}

	// Map AwsBedrock provider settings
	const awsBedrockSettings = remoteConfig.providerSettings?.AwsBedrock
	if (awsBedrockSettings) {
		transformed.planModeApiProvider = "bedrock"
		transformed.actModeApiProvider = "bedrock"
		providers.push("bedrock")

		if (awsBedrockSettings.awsRegion !== undefined) {
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
		if (awsBedrockSettings.awsBedrockEndpoint !== undefined) {
			transformed.awsBedrockEndpoint = awsBedrockSettings.awsBedrockEndpoint
		}
	}

	const clineSettings = remoteConfig.providerSettings?.Cline
	if (clineSettings) {
		transformed.planModeApiProvider = "cline"
		transformed.actModeApiProvider = "cline"
		providers.push("cline")
	}

	// This line needs to stay here, it is order dependent on the above code checking the configured providers
	if (providers.length > 0) {
		transformed.remoteConfiguredProviders = providers
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
		stateManager.setRemoteConfigField(key as keyof RemoteConfigFields, value)
	}
}
