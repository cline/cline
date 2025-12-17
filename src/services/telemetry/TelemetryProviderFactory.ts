import { getValidOpenTelemetryConfig } from "@/shared/services/config/otel-config"
import { isPostHogConfigValid, posthogConfig } from "@/shared/services/config/posthog-config"
import { Logger } from "../logging/Logger"
import type { ITelemetryProvider, TelemetryProperties, TelemetrySettings } from "./providers/ITelemetryProvider"
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
export type TelemetryProviderConfig =
	| { type: "posthog"; apiKey?: string; host?: string }
	| { type: "opentelemetry"; enabled?: boolean }
	| { type: "no-op" }

/**
 * Factory class for creating telemetry providers
 * Allows easy switching between different analytics providers
 */
export class TelemetryProviderFactory {
	/**
	 * Creates multiple telemetry providers based on configuration
	 * Supports dual tracking during transition period
	 */
	public static async createProviders(): Promise<ITelemetryProvider[]> {
		const configs = TelemetryProviderFactory.getDefaultConfigs()
		const providers: ITelemetryProvider[] = []

		for (const config of configs) {
			try {
				const provider = await TelemetryProviderFactory.createProvider(config)
				providers.push(provider)
			} catch (error) {
				Logger.error(`Failed to create telemetry provider: ${config.type}`, error)
			}
		}

		// Always have at least a no-op provider
		if (providers.length === 0) {
			providers.push(new NoOpTelemetryProvider())
		}

		Logger.info("TelemetryProviderFactory: Created providers - " + providers.map((p) => p.name).join(", "))
		return providers
	}

	/**
	 * Creates a single telemetry provider based on the provided configuration
	 * @param config Configuration for the telemetry provider
	 * @returns ITelemetryProvider instance
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
				const otelConfig = getValidOpenTelemetryConfig()
				if (!otelConfig) {
					return new NoOpTelemetryProvider()
				}
				const client = new OpenTelemetryClientProvider(otelConfig)
				if (client.meterProvider || client.loggerProvider) {
					return await new OpenTelemetryTelemetryProvider(client.meterProvider, client.loggerProvider, {
						bypassUserSettings: false,
					}).initialize()
				}
				Logger.info("TelemetryProviderFactory: OpenTelemetry providers not available")
				return new NoOpTelemetryProvider()
			}
			case "no-op":
				return new NoOpTelemetryProvider()
			default:
				Logger.error(`Unsupported telemetry provider type: ${(config as { type?: string }).type ?? "unknown"}`)
				return new NoOpTelemetryProvider()
		}
	}

	/**
	 * Gets the default telemetry provider configuration
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
	readonly name = "NoOpTelemetryProvider"
	private isOptIn = true

	log(_event: string, _properties?: TelemetryProperties): void {
		Logger.log(`[NoOpTelemetryProvider] ${_event}: ${JSON.stringify(_properties)}`)
	}
	logRequired(_event: string, _properties?: TelemetryProperties): void {
		Logger.log(`[NoOpTelemetryProvider] REQUIRED ${_event}: ${JSON.stringify(_properties)}`)
	}
	identifyUser(_userInfo: any, _properties?: TelemetryProperties): void {
		Logger.info(`[NoOpTelemetryProvider] identifyUser - ${JSON.stringify(_userInfo)} - ${JSON.stringify(_properties)}`)
	}
	setOptIn(_optIn: boolean): void {
		Logger.info(`[NoOpTelemetryProvider] setOptIn(${_optIn})`)
		this.isOptIn = _optIn
	}
	isEnabled(): boolean {
		return false
	}
	getSettings(): TelemetrySettings {
		return {
			extensionEnabled: false,
			hostEnabled: false,
			level: "off",
		}
	}
	recordCounter(
		_name: string,
		_value: number,
		_attributes?: TelemetryProperties,
		_description?: string,
		_required = false,
	): void {
		// no-op
	}
	recordHistogram(
		_name: string,
		_value: number,
		_attributes?: TelemetryProperties,
		_description?: string,
		_required = false,
	): void {
		// no-op
	}
	recordGauge(
		_name: string,
		_value: number | null,
		_attributes?: TelemetryProperties,
		_description?: string,
		_required = false,
	): void {
		// no-op
	}
	async dispose(): Promise<void> {
		Logger.info(`[NoOpTelemetryProvider] Disposing (optIn=${this.isOptIn})`)
	}
}
