import { synchronizeRemoteRuleToggles } from "@core/context/instructions/user-instructions/rule-helpers"
import { RemoteConfig } from "@shared/remote-config/schema"
import { RemoteConfigFields } from "@shared/storage/state-keys"
import { getTelemetryService } from "@/services/telemetry"
import { OpenTelemetryClientProvider } from "@/services/telemetry/providers/opentelemetry/OpenTelemetryClientProvider"
import { OpenTelemetryTelemetryProvider } from "@/services/telemetry/providers/opentelemetry/OpenTelemetryTelemetryProvider"
import { type TelemetryService } from "@/services/telemetry/TelemetryService"
import { OpenTelemetryClientValidConfig, remoteConfigToOtelConfig } from "@/shared/services/config/otel-config"
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
	if (remoteConfig.blockPersonalRemoteMCPServers !== undefined) {
		transformed.blockPersonalRemoteMCPServers = remoteConfig.blockPersonalRemoteMCPServers
	}
	if (remoteConfig.remoteMCPServers !== undefined) {
		transformed.remoteMCPServers = remoteConfig.remoteMCPServers
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
	if (remoteConfig.openTelemetryOtlpHeaders !== undefined) {
		transformed.openTelemetryOtlpHeaders = remoteConfig.openTelemetryOtlpHeaders
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

	// Map LiteLLM provider settings
	const liteLlmSettings = remoteConfig.providerSettings?.LiteLLM
	if (liteLlmSettings) {
		transformed.planModeApiProvider = "litellm"
		transformed.actModeApiProvider = "litellm"
		providers.push("litellm")

		if (liteLlmSettings.baseUrl !== undefined) {
			transformed.liteLlmBaseUrl = liteLlmSettings.baseUrl
		}
	}

	// Map Vertex provider settings
	const vertexSettings = remoteConfig.providerSettings?.Vertex
	if (vertexSettings) {
		transformed.planModeApiProvider = "vertex"
		transformed.actModeApiProvider = "vertex"
		providers.push("vertex")

		if (vertexSettings.vertexProjectId !== undefined) {
			transformed.vertexProjectId = vertexSettings.vertexProjectId
		}
		if (vertexSettings.vertexRegion !== undefined) {
			transformed.vertexRegion = vertexSettings.vertexRegion
		}
	}

	// This line needs to stay here, it is order dependent on the above code checking the configured providers
	if (providers.length > 0) {
		transformed.remoteConfiguredProviders = providers
	}

	// Map global rules and workflows
	if (remoteConfig.globalRules !== undefined) {
		transformed.remoteGlobalRules = remoteConfig.globalRules
	}
	if (remoteConfig.globalWorkflows !== undefined) {
		transformed.remoteGlobalWorkflows = remoteConfig.globalWorkflows
	}

	return transformed
}

const REMOTE_CONFIG_OTEL_PROVIDER_ID = "OpenTelemetryRemoteConfiguredProvider"
async function applyRemoteOTELConfig(transformed: Partial<RemoteConfigFields>, telemetryService: TelemetryService) {
	try {
		const otelConfig = remoteConfigToOtelConfig(transformed)
		if (otelConfig.enabled) {
			const client = new OpenTelemetryClientProvider(otelConfig as OpenTelemetryClientValidConfig)

			if (client.meterProvider || client.loggerProvider) {
				telemetryService.addProvider(
					await new OpenTelemetryTelemetryProvider(client.meterProvider, client.loggerProvider, {
						name: REMOTE_CONFIG_OTEL_PROVIDER_ID,
						bypassUserSettings: true,
					}).initialize(),
				)
			}
		}
	} catch (err) {
		console.error("[REMOTE CONFIG DEBUG] Failed to apply remote OTEL config", err)
	}
}

/**
 * Applies remote config to the StateManager's remote config cache
 * @param remoteConfig The remote configuration object to apply
 */
export async function applyRemoteConfig(remoteConfig?: RemoteConfig): Promise<void> {
	const stateManager = StateManager.get()
	const telemetryService = await getTelemetryService()

	// If no remote config provided, clear the cache and relevant state
	if (!remoteConfig) {
		stateManager.clearRemoteConfig()
		telemetryService.removeProvider(REMOTE_CONFIG_OTEL_PROVIDER_ID)
		// the remote config cline rules toggle state is stored in global state
		stateManager.setGlobalState("remoteRulesToggles", {})
		stateManager.setGlobalState("remoteWorkflowToggles", {})
		return
	}

	// Transform remote config to state shape
	// These are then set to the remote config cache in the StateManager
	// We need to ensure the cache is checked for new fields
	const transformed = transformRemoteConfigToStateShape(remoteConfig)

	// Synchronize toggle state
	const currentRuleToggles = stateManager.getGlobalStateKey("remoteRulesToggles") || {}
	const currentWorkflowToggles = stateManager.getGlobalStateKey("remoteWorkflowToggles") || {}

	const syncedRuleToggles = synchronizeRemoteRuleToggles(remoteConfig.globalRules || [], currentRuleToggles)
	const syncedWorkflowToggles = synchronizeRemoteRuleToggles(remoteConfig.globalWorkflows || [], currentWorkflowToggles)

	stateManager.setGlobalState("remoteRulesToggles", syncedRuleToggles)
	stateManager.setGlobalState("remoteWorkflowToggles", syncedWorkflowToggles)

	// Clear existing remote config cache
	stateManager.clearRemoteConfig()
	telemetryService.removeProvider(REMOTE_CONFIG_OTEL_PROVIDER_ID)

	// Populate remote config cache with transformed values
	for (const [key, value] of Object.entries(transformed)) {
		stateManager.setRemoteConfigField(key as keyof RemoteConfigFields, value)
	}

	await applyRemoteOTELConfig(transformed, telemetryService)
}
