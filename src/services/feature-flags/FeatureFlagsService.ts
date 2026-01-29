import { clearOnboardingModelsCache, getClineOnboardingModels } from "@/core/controller/models/getClineOnboardingModels"
import { type FeatureFlagsCacheData, readFeatureFlagsCacheFromDisk, writeFeatureFlagsCacheToDisk } from "@/core/storage/disk"
import type { OnboardingModel } from "@/shared/proto/cline/state"
import { FEATURE_FLAGS, FeatureFlag, FeatureFlagDefaultValue } from "@/shared/services/feature-flags/feature-flags"
import { Logger } from "@/shared/services/Logger"
import { telemetryService } from "../telemetry"
import type { FeatureFlagPayload, FeatureFlagsAndPayloads, IFeatureFlagsProvider } from "./providers/IFeatureFlagsProvider"

// Default cache time-to-live (TTL) for feature flags - an hour
const DEFAULT_CACHE_TTL = 60 * 60 * 1000

type CacheInfo = {
	updateTime: number
	userId: string | null
	flagsPayload?: FeatureFlagsAndPayloads
}

function areAllFlagsCached(cachedFlagKeys: string[]): boolean {
	if (cachedFlagKeys.length !== FEATURE_FLAGS.length) {
		return false
	}
	const cachedSet = new Set(cachedFlagKeys)
	return FEATURE_FLAGS.every((flag) => cachedSet.has(flag))
}

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
	private cacheInfo: CacheInfo = { updateTime: 0, userId: null }

	/**
	 * Poll all known feature flags to update their cached values
	 */
	public async poll(userId: string | null): Promise<void> {
		const timesNow = Date.now()

		// Check if memory cache is still valid
		if (timesNow - this.cacheInfo.updateTime < DEFAULT_CACHE_TTL) {
			// Skip fetch if within TTL and user context is unchanged
			if (this.cacheInfo.userId === userId) {
				return
			}
		}

		this.cacheInfo.updateTime = timesNow
		this.cacheInfo.userId = userId || null

		try {
			const isCacheValid = await this.loadFromDiskCache(userId, timesNow)
			if (!isCacheValid) {
				const values = await this.provider.getAllFlagsAndPayloads({
					flagKeys: FEATURE_FLAGS,
				})

				this.cacheInfo.flagsPayload = values

				await this.writeToDiskCache()
			}

			for (const flag of FEATURE_FLAGS) {
				const payload = await this.getFeatureFlag(flag).catch(() => false)
				this.cache.set(flag, payload ?? false)
			}
		} catch (error) {
			// On error, clear cache info to force refresh on next poll
			this.cacheInfo = { updateTime: 0, userId: null }
			throw error
		}

		getClineOnboardingModels() // Refresh onboarding models cache if relevant flag changed
	}

	private async loadFromDiskCache(userId: string | null, currentTime: number): Promise<boolean> {
		try {
			const diskCache = await readFeatureFlagsCacheFromDisk()
			if (!diskCache) {
				return false
			}

			if (!diskCache.cachedFlags || !areAllFlagsCached(diskCache.cachedFlags)) {
				return false
			}

			if (currentTime - diskCache.updateTime >= DEFAULT_CACHE_TTL) {
				return false
			}

			if (diskCache.userId !== userId) {
				return false
			}

			this.cacheInfo = {
				updateTime: diskCache.updateTime,
				userId: diskCache.userId,
				flagsPayload: diskCache.flagsPayload,
			}

			return true
		} catch (error) {
			Logger.error("Failed to load feature flags from disk cache:", error)
			return false
		}
	}

	private async writeToDiskCache(): Promise<void> {
		try {
			const cacheData: FeatureFlagsCacheData = {
				updateTime: this.cacheInfo.updateTime,
				userId: this.cacheInfo.userId,
				cachedFlags: [...FEATURE_FLAGS],
				flagsPayload: this.cacheInfo.flagsPayload,
			}

			await writeFeatureFlagsCacheToDisk(cacheData)
		} catch (error) {
			Logger.error("Failed to write feature flags to disk cache:", error)
		}
	}

	private async getFeatureFlag(flagName: FeatureFlag): Promise<FeatureFlagPayload | undefined> {
		try {
			const payload = this.cacheInfo.flagsPayload?.featureFlagPayloads?.[flagName]
			const flagValue = this.cacheInfo.flagsPayload?.featureFlags?.[flagName]
			const value = payload ?? flagValue ?? FeatureFlagDefaultValue[flagName] ?? undefined

			if (!this.cache.has(flagName) || this.cache.get(flagName) !== value) {
				telemetryService.capture({
					event: "$feature_flag_called",
					properties: {
						$feature_flag: flagName,
						$feature_flag_response: flagValue,
					},
				})
			}

			return value
		} catch (error) {
			Logger.error(`Error checking if feature flag ${flagName} is enabled:`, error)
			return FeatureFlagDefaultValue[flagName] ?? false
		}
	}

	/**
	 * Wrapper: safely get boolean flag with default fallback
	 * Only check the cached value of a feature flag. If not cached, return defaultValue.
	 * Useful for performance-sensitive paths where we don't want to await a network call.
	 * Cache is updated periodically via poll(), and is generated on extension startup,
	 * and whenever the user logs in.
	 */
	private getBooleanFlagEnabled(flagName: FeatureFlag): boolean {
		return this.cache.get(flagName) === true
	}

	public getWebtoolsEnabled(): boolean {
		return this.getBooleanFlagEnabled(FeatureFlag.WEBTOOLS)
	}

	public getWorktreesEnabled(): boolean {
		return this.getBooleanFlagEnabled(FeatureFlag.WORKTREES)
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
	 * Clean up resources when the service is disposed
	 */
	public async dispose(): Promise<void> {
		await this.provider.dispose()
	}
}
