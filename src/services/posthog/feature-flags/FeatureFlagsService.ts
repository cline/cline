/**
 * FeatureFlagsService provides feature flag functionality that works independently
 * of telemetry settings. Feature flags are always available to ensure proper
 * functionality of the extension regardless of user's telemetry preferences.
 */
export class FeatureFlagsService {
	public constructor(
		private readonly getFeatureFlag: (flag: string) => Promise<boolean | string | undefined>,
		private readonly getFeatureFlagPayload: (flag: string) => Promise<unknown>,
	) {
		console.log("[FeatureFlagsService] Initialized with distinctId:")
	}

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
			const flagEnabled = await this.getFeatureFlag(flagName)
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
		return this.getBooleanFlagEnabled("focus_chain_checklist", false)
	}

	/**
	 * Get the feature flag payload for advanced use cases
	 * @param flagName The feature flag key
	 * @returns The feature flag payload or null if not found
	 */
	public async getPayload(flagName: string): Promise<unknown> {
		try {
			return await this.getFeatureFlagPayload(flagName)
		} catch (error) {
			console.error(`Error retrieving feature flag payload for ${flagName}:`, error)
			return null
		}
	}
}
