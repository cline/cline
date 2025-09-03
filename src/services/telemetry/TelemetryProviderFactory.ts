import { isPostHogConfigValid, posthogConfig } from "@/shared/services/config/posthog-config"
import { Logger } from "../logging/Logger"
import { PostHogClientProvider } from "../posthog/PostHogClientProvider"
import type { ITelemetryProvider } from "./providers/ITelemetryProvider"
import { PostHogTelemetryProvider } from "./providers/PostHogTelemetryProvider"

/**
 * Supported telemetry provider types
 */
export type TelemetryProviderType = "posthog" | "no-op"

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
	 * Creates a telemetry provider based on the provided configuration
	 * @param config Configuration for the telemetry provider
	 * @returns ITelemetryProvider instance
	 */
	public static createProvider(config: TelemetryProviderConfig): ITelemetryProvider {
		switch (config.type) {
			case "posthog": {
				// Get the shared PostHog client from PostHogClientProvider
				const sharedClient = PostHogClientProvider.getClient()
				if (sharedClient) {
					return new PostHogTelemetryProvider(sharedClient)
				}
				return new NoOpTelemetryProvider()
			}
			default:
				console.error(`Unsupported telemetry provider type: ${config.type}`)
				return new NoOpTelemetryProvider()
		}
	}

	/**
	 * Gets the default telemetry provider configuration
	 * @returns Default configuration using PostHog
	 */
	public static getDefaultConfig(): TelemetryProviderConfig {
		const hasValidConfig = isPostHogConfigValid(posthogConfig)
		return {
			type: hasValidConfig ? "posthog" : "no-op",
		}
	}
}

/**
 * No-operation telemetry provider for when telemetry is disabled
 * or for testing purposes
 */
class NoOpTelemetryProvider implements ITelemetryProvider {
	private isOptIn = true

	public log(event: string, properties?: Record<string, unknown>): void {
		Logger.log(`[NoOpTelemetryProvider] ${event}: ${JSON.stringify(properties)}`)
	}

	public identifyUser(userInfo: any, properties?: Record<string, unknown>): void {
		Logger.info(`[NoOpTelemetryProvider] identifyUser - ${JSON.stringify(userInfo)} - ${JSON.stringify(properties)}`)
	}

	public setOptIn(optIn: boolean): void {
		Logger.info(`[NoOpTelemetryProvider] setOptIn(${optIn})`)
		this.isOptIn = optIn
	}

	public isEnabled(): boolean {
		return this.isOptIn
	}

	public getSettings() {
		return {
			extensionEnabled: true,
			hostEnabled: true,
			level: "all" as const,
		}
	}

	public async dispose(): Promise<void> {
		Logger.info("[NoOpTelemetryProvider] Disposing")
	}
}
