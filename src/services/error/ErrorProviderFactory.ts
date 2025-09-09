import { isPostHogConfigValid, PostHogClientConfig, posthogConfig } from "@/shared/services/config/posthog-config"
import { ClineError } from "./ClineError"
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
	public static async createProvider(config: ErrorProviderConfig): Promise<IErrorProvider> {
		switch (config.type) {
			case "posthog": {
				const hasValidPostHogConfig = isPostHogConfigValid(config.config)
				const errorTrackingApiKey = config.config.errorTrackingApiKey
				return hasValidPostHogConfig && errorTrackingApiKey
					? await new PostHogErrorProvider({
							apiKey: errorTrackingApiKey,
							errorTrackingApiKey: errorTrackingApiKey,
							host: config.config.host,
							uiHost: config.config.uiHost,
						}).initialize()
					: new NoOpErrorProvider() // Fallback to no-op provider
			}
			default:
				return new NoOpErrorProvider()
		}
	}

	/**
	 * Gets the default error provider configuration
	 * @returns Default configuration using PostHog
	 */
	public static getDefaultConfig(): ErrorProviderConfig {
		return {
			type: "posthog",
			config: posthogConfig,
		}
	}
}

/**
 * No-operation error provider for when error logging is disabled
 * or for testing purposes
 */
class NoOpErrorProvider implements IErrorProvider {
	public logException(error: Error | ClineError, _properties?: Record<string, unknown>): void {
		// Use console.error directly to avoid potential infinite recursion through Logger
		console.error("[NoOpErrorProvider]", error.message || String(error))
	}

	public logMessage(
		message: string,
		level?: "error" | "warning" | "log" | "debug" | "info",
		properties?: Record<string, unknown>,
	): void {
		console.log("[NoOpErrorProvider]", { message, level, properties })
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
		console.info("[NoOpErrorProvider] Disposing")
	}
}
