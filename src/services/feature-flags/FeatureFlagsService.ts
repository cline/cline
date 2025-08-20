import type { IFeatureFlagsProvider } from "./IFeatureFlagsProvider"

/**
 * FeatureFlagsService provides feature flag functionality that works independently
 * of telemetry settings. Feature flags are always available to ensure proper
 * functionality of the extension regardless of user's telemetry preferences.
 * Uses an abstracted feature flags provider to support multiple backends
 */
export class FeatureFlagsService {
	/**
	 * Constructor that accepts an IFeatureFlagsProvider instance
	 * @param provider IFeatureFlagsProvider instance for retrieving feature flags
	 */
	public constructor(private provider: IFeatureFlagsProvider) {}

	/**
	 * Check if a feature flag is enabled
	 * This method works regardless of telemetry settings to ensure feature flags
	 * can control extension behavior independently of user privacy preferences.
	 *
	 * @param flagName The feature flag key
	 * @returns Boolean indicating if the feature is enabled
	 */
	public async isFeatureFlagEnabled(flagName: string): Promise<boolean> {
		try {
			const flagEnabled = await this.provider.getFeatureFlag(flagName)
			return flagEnabled === true
		} catch (error) {
			console.error(`Error checking if feature flag ${flagName} is enabled:`, error)
			return false
		}
	}

	/**
	 * Wrapper: safely get boolean flag with default fallback
	 */
	public async getBooleanFlagEnabled(flagName: string, defaultValue = false): Promise<boolean> {
		try {
			return await this.isFeatureFlagEnabled(flagName)
		} catch (error) {
			console.error(`Error getting boolean flag ${flagName}:`, error)
			return defaultValue
		}
	}

	/**
	 * Convenience: focus chain checklist remote gate
	 */
	public async getFocusChainEnabled(): Promise<boolean> {
		return this.getBooleanFlagEnabled("focus_chain_checklist", true)
	}

	/**
	 * Get the feature flag payload for advanced use cases
	 * @param flagName The feature flag key
	 * @returns The feature flag payload or null if not found
	 */
	public async getPayload(flagName: string): Promise<unknown> {
		try {
			return await this.provider.getFeatureFlagPayload(flagName)
		} catch (error) {
			console.error(`Error retrieving feature flag payload for ${flagName}:`, error)
			return null
		}
	}

	/**
	 * Get the feature flags provider instance
	 * @returns The current feature flags provider
	 */
	public getProvider(): IFeatureFlagsProvider {
		return this.provider
	}

	/**
	 * Check if feature flags are currently enabled
	 * @returns Boolean indicating whether feature flags are enabled
	 */
	public isEnabled(): boolean {
		return this.provider.isEnabled()
	}

	/**
	 * Get current feature flags settings
	 * @returns Current feature flags settings
	 */
	public getSettings() {
		return this.provider.getSettings()
	}

	/**
	 * Clean up resources when the service is disposed
	 */
	public async dispose(): Promise<void> {
		await this.provider.dispose()
	}
}
