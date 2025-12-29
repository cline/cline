import { clearOnboardingModelsCache, getClineOnboardingModels } from "@/core/controller/models/getClineOnboardingModels"
import type { OnboardingModel } from "@/shared/proto/cline/state"
import { FEATURE_FLAGS, FeatureFlag, FeatureFlagDefaultValue } from "@/shared/services/feature-flags/feature-flags"
import type { FeatureFlagPayload, IFeatureFlagsProvider } from "./providers/IFeatureFlagsProvider"

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

	private cache: Map<FeatureFlag, FeatureFlagPayload> = new Map()
	/**
	 * Tracks cache update time and user ID for cache validity
	 */
	private cacheInfo = { updateTime: 0, userId: null as string | null }

	/**
	 * Poll all known feature flags to update their cached values
	 */
	public async poll(userId?: string): Promise<void> {
		// Do not update cache if last update was less than an hour ago
		const timesNow = Date.now()
		if (timesNow - this.cacheInfo.updateTime < DEFAULT_CACHE_TTL && this.cache.size) {
			// If time is within TTL, only skip if user context (userId) is unchanged.
			// If userId changed (including from/to undefined/null), refresh cache.
			if (userId && this.cacheInfo.userId === userId) {
				return
			}
		}

		for (const flag of FEATURE_FLAGS) {
			const payload = await this.getFeatureFlag(flag).catch(() => false)
			this.cache.set(flag, payload ?? false)
		}

		// Only update timestamp after successfully populating cache
		this.cacheInfo = { updateTime: timesNow, userId: userId || null }

		getClineOnboardingModels() // Refresh onboarding models cache if relevant flag changed
	}

	private async getFeatureFlag(flagName: FeatureFlag): Promise<FeatureFlagPayload | undefined> {
		try {
			const payload = await this.provider.getFeatureFlagPayload(flagName)
			const flagValue = await this.provider.getFeatureFlag(flagName)
			const value = payload ?? flagValue ?? FeatureFlagDefaultValue[flagName] ?? undefined
			return value
		} catch (error) {
			console.error(`Error checking if feature flag ${flagName} is enabled:`, error)
			return FeatureFlagDefaultValue[flagName] ?? false
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
		const value = this.cache.has(flagName) ? this.cache.get(flagName) : await this.getFeatureFlag(flagName)

		return !!value
	}

	/**
	 * Wrapper: safely get boolean flag with default fallback
	 * Only check the cached value of a feature flag. If not cached, return defaultValue.
	 * Useful for performance-sensitive paths where we don't want to await a network call.
	 * Cache is updated periodically via poll(), and is generated on extension startup,
	 * and whenever the user logs in.
	 */
	public getBooleanFlagEnabled(flagName: FeatureFlag): boolean {
		return this.cache.get(flagName) === true
	}

	public getDoNothingFlag(): boolean {
		return this.getBooleanFlagEnabled(FeatureFlag.DO_NOTHING)
	}

	public getHooksEnabled(): boolean {
		return this.getBooleanFlagEnabled(FeatureFlag.HOOKS)
	}

	public getWebtoolsEnabled(): boolean {
		return this.getBooleanFlagEnabled(FeatureFlag.WEBTOOLS)
	}

	public getOnboardingOverrides() {
		const payload = this.cache.get(FeatureFlag.ONBOARDING_MODELS)
		// Check if payload is object
		if (payload && typeof payload === "object" && !Array.isArray(payload)) {
			return payload.models as unknown as Record<string, OnboardingModel & { hidden?: boolean }>
		}
		clearOnboardingModelsCache()
		return undefined
	}

	/**
	 * Get the feature flag payload for advanced use cases
	 * @param flagName The feature flag key
	 * @returns The feature flag payload or null if not found
	 */
	public async getPayload(flagName: string): Promise<FeatureFlagPayload | null> {
		try {
			return (await this.provider.getFeatureFlagPayload(flagName)) ?? null
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
