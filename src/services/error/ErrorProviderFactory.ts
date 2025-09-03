import { isPostHogConfigValid, PostHogClientConfig, posthogConfig } from "@/shared/services/config/posthog-config"
import { Logger } from "../logging/Logger"
import { IErrorProvider } from "./providers/IErrorProvider"
import { PostHogErrorProvider } from "./providers/PostHogErrorProvider"

/**
 * Supported error provider types
 */
export type ErrorProviderType = "posthog" | "no-op"

/**
 * Configuration for error providers
 */
export interface ErrorProviderConfig {
	type: ErrorProviderType
	config: PostHogClientConfig
}

/**
 * Factory class for creating error providers
 * Allows easy switching between different error tracking providers
 */
export class ErrorProviderFactory {
	/**
	 * Creates an error provider based on the provided configuration
	 * @param config Configuration for the error provider
	 * @returns IErrorProvider instance
	 */
	public static createProvider(config: ErrorProviderConfig): IErrorProvider {
		switch (config.type) {
			case "posthog":
				if (!!config?.config?.apiKey && !!config?.config?.errorTrackingApiKey) {
					return new PostHogErrorProvider({
						apiKey: config.config.apiKey,
						errorTrackingApiKey: config.config.errorTrackingApiKey,
						host: config.config.host,
						uiHost: config.config.uiHost,
					})
				}
				// When
				return new NoOpErrorProvider()
			default:
				console.error(`Unsupported error provider type: ${config.type}`)
				return new NoOpErrorProvider()
		}
	}

	/**
	 * Gets the default error provider configuration
	 * @returns Default configuration using PostHog
	 */
	public static getDefaultConfig(): ErrorProviderConfig {
		const hasValidConfig = isPostHogConfigValid(posthogConfig)
		return {
			type: hasValidConfig ? "posthog" : "no-op",
			config: posthogConfig,
		}
	}
}

/**
 * No-operation error provider for when error logging is disabled
 * or for testing purposes
 */
class NoOpErrorProvider implements IErrorProvider {
	public logException(error: Error, properties?: Record<string, unknown>): void {
		Logger.error(`[NoOpErrorProvider] ${JSON.stringify(properties)}`, error)
	}

	public logMessage(
		message: string,
		level?: "error" | "warning" | "log" | "debug" | "info",
		properties?: Record<string, unknown>,
	): void {
		Logger.log(`[NoOpErrorProvider] ${level}: ${message} - ${JSON.stringify(properties)}`)
	}

	public isEnabled(): boolean {
		return true
	}

	public getSettings() {
		return {
			enabled: true,
			hostEnabled: true,
			level: "all" as const,
		}
	}

	public async dispose(): Promise<void> {
		Logger.info("[NoOpErrorProvider] Disposing")
	}
}
