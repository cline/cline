import { isJitsuConfigValid, jitsuConfig, telemetryProvidersConfig } from "@/shared/services/config/jitsu-config"
import { isPostHogConfigValid, posthogConfig } from "@/shared/services/config/posthog-config"
import { Logger } from "../logging/Logger"
import type { ITelemetryProvider } from "./providers/ITelemetryProvider"
import { JitsuTelemetryProvider } from "./providers/JitsuTelemetryProvider"
import { PostHogClientProvider } from "./providers/PostHogClientProvider"
import { PostHogTelemetryProvider } from "./providers/PostHogTelemetryProvider"

/**
 * Supported telemetry provider types
 */
export type TelemetryProviderType = "posthog" | "jitsu" | "no-op"

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
		const providers: ITelemetryProvider[] = []

		// Add Jitsu if enabled and configured
		if (telemetryProvidersConfig.jitsu && isJitsuConfigValid(jitsuConfig)) {
			try {
				const jitsuProvider = await new JitsuTelemetryProvider(jitsuConfig).initialize()
				providers.push(jitsuProvider)
				Logger.info("TelemetryProviderFactory: Jitsu provider initialized")
			} catch (error) {
				console.error("TelemetryProviderFactory: Failed to initialize Jitsu provider:", error)
			}
		}

		// Add PostHog if enabled and configured
		if (telemetryProvidersConfig.posthog && isPostHogConfigValid(posthogConfig)) {
			try {
				const sharedClient = PostHogClientProvider.getClient()
				if (sharedClient) {
					const posthogProvider = await new PostHogTelemetryProvider(sharedClient).initialize()
					providers.push(posthogProvider)
					Logger.info("TelemetryProviderFactory: PostHog provider initialized")
				}
			} catch (error) {
				console.error("TelemetryProviderFactory: Failed to initialize PostHog provider:", error)
			}
		}

		// Fallback to no-op if no providers available
		if (providers.length === 0) {
			providers.push(new NoOpTelemetryProvider())
			Logger.info("TelemetryProviderFactory: Using NoOp provider (no valid configs)")
		}

		return providers
	}

	/**
	 * Creates a single telemetry provider based on the provided configuration
	 * @param config Configuration for the telemetry provider
	 * @returns ITelemetryProvider instance
	 * @deprecated Use createProviders() for multi-provider support
	 */
	public static async createProvider(config: TelemetryProviderConfig): Promise<ITelemetryProvider> {
		switch (config.type) {
			case "jitsu": {
				if (isJitsuConfigValid(jitsuConfig)) {
					return await new JitsuTelemetryProvider(jitsuConfig).initialize()
				}
				return new NoOpTelemetryProvider()
			}
			case "posthog": {
				const sharedClient = PostHogClientProvider.getClient()
				if (sharedClient) {
					return await new PostHogTelemetryProvider(sharedClient).initialize()
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
	 * @returns Default configuration using available providers
	 */
	public static getDefaultConfig(): TelemetryProviderConfig {
		// Prefer Jitsu if available, fallback to PostHog
		if (telemetryProvidersConfig.jitsu && isJitsuConfigValid(jitsuConfig)) {
			return { type: "jitsu" }
		}
		if (telemetryProvidersConfig.posthog && isPostHogConfigValid(posthogConfig)) {
			return { type: "posthog" }
		}
		return { type: "no-op" }
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
