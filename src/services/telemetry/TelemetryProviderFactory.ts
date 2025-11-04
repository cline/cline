import { getValidOpenTelemetryConfig } from "@/shared/services/config/otel-config"
import { isPostHogConfigValid, posthogConfig } from "@/shared/services/config/posthog-config"
import { Logger } from "../logging/Logger"
import type { ITelemetryProvider } from "./providers/ITelemetryProvider"
import { OpenTelemetryClientProvider } from "./providers/opentelemetry/OpenTelemetryClientProvider"
import { OpenTelemetryTelemetryProvider } from "./providers/opentelemetry/OpenTelemetryTelemetryProvider"
import { PostHogClientProvider } from "./providers/posthog/PostHogClientProvider"
import { PostHogTelemetryProvider } from "./providers/posthog/PostHogTelemetryProvider"

/**
 * Supported telemetry provider types
 */
export type TelemetryProviderType = "posthog" | "no-op" | "opentelemetry"

/**
 * Configuration for telemetry providers
 */
export interface TelemetryProviderConfig {
	type: TelemetryProviderType
}

/**
 * Factory class for creating telemetry providers
 * Allows easy switching between different analytics providers
 */
export class TelemetryProviderFactory {
	/**
	 * Creates multiple telemetry providers based on configuration
	 * Supports dual tracking during transition period
	 * @returns Array of ITelemetryProvider instances
	 */
	public static async createProviders(): Promise<ITelemetryProvider[]> {
		const configs = TelemetryProviderFactory.getDefaultConfigs()
		const providers: ITelemetryProvider[] = await Promise.all(configs.map((c) => TelemetryProviderFactory.createProvider(c)))

		// Fallback to no-op if no providers available
		if (providers.length === 0) {
			providers.push(new NoOpTelemetryProvider())
			Logger.info("TelemetryProviderFactory: Using NoOp provider (no valid configs)")
		}
		Logger.info("TelemetryProviderFactory: Created providers - " + providers.map((p) => p.constructor.name).join(", "))
		return providers
	}

	/**
	 * Creates a single telemetry provider based on the provided configuration
	 * @param config Configuration for the telemetry provider
	 * @returns ITelemetryProvider instance
	 * @deprecated Use createProviders() for multi-provider support
	 * @deprecated Use createProviders() for multi-provider support
	 */
	private static async createProvider(config: TelemetryProviderConfig): Promise<ITelemetryProvider> {
		switch (config.type) {
			case "posthog": {
				const sharedClient = PostHogClientProvider.getClient()
				if (sharedClient) {
					return await new PostHogTelemetryProvider(sharedClient).initialize()
				}
				return new NoOpTelemetryProvider()
			}
			case "opentelemetry": {
				const meterProvider = OpenTelemetryClientProvider.getMeterProvider()
				const loggerProvider = OpenTelemetryClientProvider.getLoggerProvider()
				if (meterProvider || loggerProvider) {
					return await new OpenTelemetryTelemetryProvider().initialize()
				}
				Logger.info("TelemetryProviderFactory: OpenTelemetry providers not available")
				return new NoOpTelemetryProvider()
			}
			case "no-op":
			default:
				// Always fallback to NoOp provider. Only log error for unsupported types
				if (config.type !== "no-op") {
					console.error(`Unsupported telemetry provider type: ${config.type}`)
				}
				return new NoOpTelemetryProvider()
		}
	}

	/**
	 * Gets the default telemetry provider configuration
	 * @returns Default configuration using available providers
	 * @returns Default configuration using available providers
	 */
	public static getDefaultConfigs(): TelemetryProviderConfig[] {
		const configs: TelemetryProviderConfig[] = []
		if (isPostHogConfigValid(posthogConfig)) {
			configs.push({ type: "posthog", ...posthogConfig })
		}
		const otelConfig = getValidOpenTelemetryConfig()
		if (otelConfig) {
			configs.push({ type: "opentelemetry", ...otelConfig })
		}
		return configs.length > 0 ? configs : [{ type: "no-op" }]
	}
}

/**
 * No-operation telemetry provider for when telemetry is disabled
 * or for testing purposes
 */
export class NoOpTelemetryProvider implements ITelemetryProvider {
	public isOptIn = true

	public log(event: string, properties?: Record<string, unknown>): void {
		Logger.log(`[NoOpTelemetryProvider] ${event}: ${JSON.stringify(properties)}`)
	}

	public logRequired(event: string, properties?: Record<string, unknown>): void {
		Logger.log(`[NoOpTelemetryProvider] REQUIRED ${event}: ${JSON.stringify(properties)}`)
	}

	public identifyUser(userInfo: any, properties?: Record<string, unknown>): void {
		Logger.info(`[NoOpTelemetryProvider] identifyUser - ${JSON.stringify(userInfo)} - ${JSON.stringify(properties)}`)
	}

	public setOptIn(optIn: boolean): void {
		Logger.info(`[NoOpTelemetryProvider] setOptIn(${optIn})`)
		this.isOptIn = optIn
	}

	public isEnabled(): boolean {
		return false
	}

	public getSettings() {
		return {
			extensionEnabled: false,
			hostEnabled: false,
			level: "off" as const,
		}
	}

	public async dispose(): Promise<void> {
		Logger.info("[NoOpTelemetryProvider] Disposing")
	}
}
