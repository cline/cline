import { PostHog } from "posthog-node"
import { posthogClientProvider } from "../PostHogClientProvider"

class FeatureFlagsService {
	private static instance: FeatureFlagsService
	private readonly client: PostHog

	private constructor() {
		// Get the shared client
		this.client = posthogClientProvider.getClient()
	}

	public static getInstance(): FeatureFlagsService {
		if (!FeatureFlagsService.instance) {
			FeatureFlagsService.instance = new FeatureFlagsService()
		}
		return FeatureFlagsService.instance
	}

	/**
	 * Check if a feature flag is enabled
	 * @param flagName The feature flag key
	 * @returns Boolean indicating if the feature is enabled
	 */
	public async isFeatureFlagEnabled(flagName: string): Promise<boolean> {
		try {
			const payload = await this.client.getFeatureFlagPayload(flagName, "_irrelevant_" /* optional params */)
			if (payload && typeof payload === "object" && "enabled" in payload) {
				return Boolean(payload.enabled)
			}
			console.warn(`Feature flag ${flagName} not found or missing enabled property.`)
			return false
		} catch (error) {
			console.error(`Error checking if feature flag ${flagName} is enabled:`, error)
			return false
		}
	}
}

export const featureFlagsService = FeatureFlagsService.getInstance()
