import { PostHogClientProvider } from "../posthog/PostHogClientProvider"
import type { IFeatureFlagsProvider } from "./providers/IFeatureFlagsProvider"
import { PostHogFeatureFlagsProvider } from "./providers/PostHogFeatureFlagsProvider"

/**
 * Supported feature flags provider types
 */
export type FeatureFlagsProviderType = "posthog" | "none"

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
			case "posthog":
				// Get the shared PostHog client from PostHogClientProvider
				const client = PostHogClientProvider.getClient()
				if (client) {
					return new PostHogFeatureFlagsProvider(client)
				}
				// Fall back to NoOp provider if no client is available
				return new NoOpFeatureFlagsProvider()
			case "none":
				return new NoOpFeatureFlagsProvider()
			default:
				throw new Error(`Unsupported feature flags provider type: ${config.type}`)
		}
	}

	/**
	 * Gets the default feature flags provider configuration
	 * @returns Default configuration using PostHog
	 */
	public static getDefaultConfig(): FeatureFlagsProviderConfig {
		return {
			type: "posthog",
		}
	}
}

/**
 * No-operation feature flags provider for when feature flags are disabled
 * or for testing purposes
 */
class NoOpFeatureFlagsProvider implements IFeatureFlagsProvider {
	public async getFeatureFlag(_flagName: string): Promise<boolean | string | undefined> {
		return undefined
	}

	public async getFeatureFlagPayload(_flagName: string): Promise<unknown> {
		return null
	}

	public isEnabled(): boolean {
		return false
	}

	public getSettings() {
		return {
			enabled: false,
			timeout: 0,
		}
	}

	public async dispose(): Promise<void> {
		// No-op
	}
}
