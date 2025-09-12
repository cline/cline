import { FEATURE_FLAGS, FeatureFlag } from "@/shared/services/feature-flags/feature-flags"
import type { IFeatureFlagsProvider } from "./providers/IFeatureFlagsProvider"

// Default cache time-to-live (TTL) for feature flags - an hour
const DEFAULT_CACHE_TTL = 60 * 60 * 1000

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

	private cache: Map<FeatureFlag, boolean> = new Map()
	private lastCacheUpdateTime: number = 0

	/**
	 * Poll all known feature flags to update their cached values
	 */
	public async poll(): Promise<void> {
		// Do not update cache if last update was less than an hour ago
		const timesNow = Date.now()
		if (timesNow - this.lastCacheUpdateTime < DEFAULT_CACHE_TTL) {
			return
		}
		this.lastCacheUpdateTime = timesNow
		for (const flag of FEATURE_FLAGS) {
			const flagEnabled = await this.getFeatureFlag(flag).catch(() => false)
			this.cache.set(flag, flagEnabled === true)
		}
	}

	private async getFeatureFlag(flagName: FeatureFlag): Promise<boolean> {
		try {
			const flagValue = await this.provider.getFeatureFlag(flagName)
			const enabled = flagValue === true
			this.cache.set(flagName, enabled)
			return enabled
		} catch (error) {
			console.error(`Error checking if feature flag ${flagName} is enabled:`, error)
			this.cache.set(flagName, false)
			return false
		}
	}

	/**
	 * Check if a feature flag is enabled
	 * This method works regardless of telemetry settings to ensure feature flags
	 * can control extension behavior independently of user privacy preferences.
	 *
	 * @param flagName The feature flag key
	 * @returns Boolean indicating if the feature is enabled
	 */
	public async isFeatureFlagEnabled(flagName: FeatureFlag): Promise<boolean> {
		if (this.cache.has(flagName)) {
			return this.cache.get(flagName)!
		}
		return this.getFeatureFlag(flagName)
	}

	/**
	 * Wrapper: safely get boolean flag with default fallback
	 * Only check the cached value of a feature flag. If not cached, return defaultValue.
	 * Useful for performance-sensitive paths where we don't want to await a network call.
	 * Cache is updated periodically via poll(), and is generated on extension startup,
	 * and whenever the user logs in.
	 */
	public getBooleanFlagEnabled(flagName: FeatureFlag, defaultValue = false): boolean {
		return this.cache.get(flagName) ?? defaultValue
	}

	/**
	 * Convenience: multi-root workspace remote gate
	 */
	public getMultiRootEnabled(): boolean {
		return this.getBooleanFlagEnabled(FeatureFlag.MULTI_ROOT_WORKSPACE, false)
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
	 * Reset the feature flags cache
	 * Should run on user auth state changes to ensure flags are up-to-date
	 */
	public reset(): void {
		this.cache.clear()
		this.lastCacheUpdateTime = 0
	}

	/**
	 * For testing: directly set a feature flag in the cache
	 */
	public test(flagName: FeatureFlag, value: boolean) {
		if (process.env.NODE_ENV === "true") {
			this.cache.set(flagName, value)
		}
	}

	/**
	 * Clean up resources when the service is disposed
	 */
	public async dispose(): Promise<void> {
		await this.provider.dispose()
	}
}
