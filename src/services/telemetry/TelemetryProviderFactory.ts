import { PostHogClientProvider } from "../posthog/PostHogClientProvider"
import type { ITelemetryProvider } from "./providers/ITelemetryProvider"
import { PostHogTelemetryProvider } from "./providers/PostHogTelemetryProvider"

/**
 * Supported telemetry provider types
 */
export type TelemetryProviderType = "posthog" | "none"

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
		// Get the shared PostHog client from PostHogClientProvider
		const sharedClient = PostHogClientProvider.getClient()
		switch (config.type) {
			case "posthog":
				if (sharedClient) {
					return new PostHogTelemetryProvider(sharedClient)
				}
				return new NoOpTelemetryProvider()
			case "none":
				return new NoOpTelemetryProvider()
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
		return {
			type: "posthog",
		}
	}
}

/**
 * No-operation telemetry provider for when telemetry is disabled
 * or for testing purposes
 */
class NoOpTelemetryProvider implements ITelemetryProvider {
	public log(_event: string, _properties?: Record<string, unknown>): void {
		// No-op
	}

	public identifyUser(_userInfo: any, _properties?: Record<string, unknown>): void {
		// No-op
	}

	public setOptIn(_optIn: boolean): void {
		// No-op
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
		// No-op
	}
}
