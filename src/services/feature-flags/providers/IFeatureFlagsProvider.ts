/**
 * Interface for feature flags providers
 * Allows switching between different feature flag providers (PostHog, etc.)
 */

/**
 * Feature flags settings that control how feature flags are retrieved
 */
export interface FeatureFlagsSettings {
	/** Whether feature flags are enabled */
	enabled: boolean
	/** Optional timeout for feature flag requests */
	timeout?: number
}

type JsonType =
	| string
	| number
	| boolean
	| null
	| {
			[key: string]: JsonType
	  }
	| Array<JsonType>
	| JsonType[]
export type FeatureFlagPayload = string | number | boolean | { [key: string]: JsonType } | JsonType[] | null

/**
 * Abstract interface for feature flags providers
 * Any feature flags provider must implement this interface
 */
export interface IFeatureFlagsProvider {
	/**
	 * Get a feature flag value
	 * @param flagName The feature flag key
	 * @returns Promise resolving to the flag value (boolean, string, or undefined)
	 */
	getFeatureFlag(flagName: string): Promise<FeatureFlagPayload | undefined>

	/**
	 * Get the feature flag payload for advanced use cases
	 * @param flagName The feature flag key
	 * @returns Promise resolving to the feature flag payload or null if not found
	 */
	getFeatureFlagPayload(flagName: string): Promise<FeatureFlagPayload | undefined>

	/**
	 * Check if the provider is enabled and ready
	 * @returns Boolean indicating whether the provider is enabled
	 */
	isEnabled(): boolean

	/**
	 * Get current feature flags settings
	 * @returns Current feature flags settings
	 */
	getSettings(): FeatureFlagsSettings

	/**
	 * Clean up resources when the provider is disposed
	 */
	dispose(): Promise<void>
}
