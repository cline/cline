import type { IErrorProvider } from "./IErrorProvider"
import { PostHogErrorProvider } from "./providers/PostHogErrorProvider"

/**
 * Supported error provider types
 */
export type ErrorProviderType = "posthog" | "none"

/**
 * Configuration for error providers
 */
export interface ErrorProviderConfig {
	type: ErrorProviderType
	distinctId?: string
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
				return new PostHogErrorProvider(config.distinctId)
			case "none":
				return new NoOpErrorProvider()
			default:
				throw new Error(`Unsupported error provider type: ${config.type}`)
		}
	}

	/**
	 * Gets the default error provider configuration
	 * @returns Default configuration using PostHog
	 */
	public static getDefaultConfig(): ErrorProviderConfig {
		return {
			type: "posthog",
		}
	}
}

/**
 * No-operation error provider for when error logging is disabled
 * or for testing purposes
 */
class NoOpErrorProvider implements IErrorProvider {
	public logException(_error: Error, _properties?: Record<string, unknown>): void {
		// No-op
	}

	public logMessage(
		_message: string,
		_level?: "error" | "warning" | "log" | "debug" | "info",
		_properties?: Record<string, unknown>,
	): void {
		// No-op
	}

	public isEnabled(): boolean {
		return false
	}

	public getSettings() {
		return {
			enabled: false,
			hostEnabled: false,
			level: "off" as const,
		}
	}

	public async dispose(): Promise<void> {
		// No-op
	}
}
