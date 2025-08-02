import type { PostHog } from "posthog-node"

/**
 * FeatureFlagsService provides feature flag functionality that works independently
 * of telemetry settings. Feature flags are always available to ensure proper
 * functionality of the extension regardless of user's telemetry preferences.
 */
export class FeatureFlagsService {
	public constructor(
		private readonly client: PostHog,
		private readonly distinctId: string,
	) {
		console.log("[FeatureFlagsService] Initialized with distinctId:", this.distinctId)
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
		console.info("[FeatureFlagsService] Checking feature flag:", flagName)
		try {
			if (!this.client) {
				console.warn("[FeatureFlagsService] PostHog client is not initialized")
				return false
			}
			const flagEnabled = await this.client.getFeatureFlag(flagName, this.distinctId)
			console.log(`Feature flag ${flagName} is enabled:`, flagEnabled === true)
			return flagEnabled === true
		} catch (error) {
			console.error(`Error checking if feature flag ${flagName} is enabled:`, error)
			return false
		}
	}

	/**
	 * Get the feature flag payload for advanced use cases
	 * @param flagName The feature flag key
	 * @returns The feature flag payload or null if not found
	 */
	public async getFeatureFlagPayload(flagName: string): Promise<unknown> {
		try {
			return await this.client.getFeatureFlagPayload(flagName, this.distinctId)
		} catch (error) {
			console.error(`Error retrieving feature flag payload for ${flagName}:`, error)
			return null
		}
	}
}
