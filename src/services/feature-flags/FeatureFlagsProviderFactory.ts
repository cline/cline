import { isPostHogConfigValid, posthogConfig } from "@/shared/services/config/posthog-config"
import { Logger } from "../logging/Logger"
import { PostHogClientProvider } from "../telemetry/providers/posthog/PostHogClientProvider"
import type { IFeatureFlagsProvider } from "./providers/IFeatureFlagsProvider"
import { PostHogFeatureFlagsProvider } from "./providers/PostHogFeatureFlagsProvider"

/**
 * Supported feature flags provider types
 */
export type FeatureFlagsProviderType = "posthog" | "no-op"

/**
 * Configuration for feature flags providers
 */
export interface FeatureFlagsProviderConfig {
	type: FeatureFlagsProviderType
}

/**
 * Factory class for creating feature flags providers
 * Allows easy switching between different feature flag providers
 */
export class FeatureFlagsProviderFactory {
	/**
	 * Creates a feature flags provider based on the provided configuration
	 * @param config Configuration for the feature flags provider
	 * @returns IFeatureFlagsProvider instance
	 */
	public static createProvider(config: FeatureFlagsProviderConfig): IFeatureFlagsProvider {
		switch (config.type) {
			case "posthog": {
				// Get the shared PostHog client from PostHogClientProvider
				const sharedClient = PostHogClientProvider.getClient()
				if (sharedClient) {
					return new PostHogFeatureFlagsProvider(sharedClient)
				}
				// Fall back to NoOp provider if no client is available
				return new NoOpFeatureFlagsProvider()
			}
			default:
				return new NoOpFeatureFlagsProvider()
		}
	}

	/**
	 * Gets the default feature flags provider configuration
	 * @returns Default configuration using PostHog
	 */
	public static getDefaultConfig(): FeatureFlagsProviderConfig {
		const hasValidConfig = isPostHogConfigValid(posthogConfig)
		return {
			type: hasValidConfig ? "posthog" : "no-op",
		}
	}
}

/**
 * No-operation feature flags provider for when feature flags are disabled
 * or for testing purposes
 */
class NoOpFeatureFlagsProvider implements IFeatureFlagsProvider {
	public async getFeatureFlag(flagName: string): Promise<boolean | string | undefined> {
		Logger.info(`[NoOpFeatureFlagsProvider] getFeatureFlag called with flagName=${flagName}`)
		return undefined
	}

	public async getFeatureFlagPayload(flagName: string): Promise<unknown> {
		Logger.info(`[NoOpFeatureFlagsProvider] getFeatureFlagPayload called with flagName=${flagName}`)
		return null
	}

	public isEnabled(): boolean {
		return true
	}

	public getSettings() {
		return {
			enabled: true,
			timeout: 1000,
		}
	}

	public async dispose(): Promise<void> {
		Logger.info("[NoOpFeatureFlagsProvider] Disposing")
	}
}
