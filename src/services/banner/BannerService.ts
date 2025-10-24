import type { Banner, BannerRules, BannersResponse } from "@shared/ClineBanner"
import axios from "axios"
import { ClineEnv } from "@/config"
import { Logger } from "../logging/Logger"

/**
 * Service for fetching and evaluating banner messages
 */
export class BannerService {
	private static instance: BannerService
	private readonly _baseUrl = ClineEnv.config().apiBaseUrl
	private _cachedBanners: Banner[] = []
	private _lastFetchTime: number = 0
	private readonly CACHE_DURATION_MS = 5 * 60 * 1000 // 5 minutes

	private constructor() {}

	/**
	 * Returns the singleton instance of BannerService
	 */
	public static getInstance(): BannerService {
		if (!BannerService.instance) {
			BannerService.instance = new BannerService()
		}
		return BannerService.instance
	}

	/**
	 * Fetches active banners from the API
	 * @param forceRefresh If true, bypasses cache and fetches fresh data
	 * @returns Array of banners that match current environment
	 */
	public async fetchActiveBanners(forceRefresh = false): Promise<Banner[]> {
		try {
			// Return cached banners if still valid
			const now = Date.now()
			if (!forceRefresh && this._cachedBanners.length > 0 && now - this._lastFetchTime < this.CACHE_DURATION_MS) {
				Logger.log("BannerService: Returning cached banners")
				return this._cachedBanners
			}

			// Fetch from API
			const url = new URL("/banners/v1/messages", this._baseUrl).toString()
			Logger.log(`BannerService: Fetching banners from ${url}`)

			const response = await axios.get<BannersResponse>(url, {
				timeout: 10000, // 10 second timeout
				headers: {
					"Content-Type": "application/json",
				},
			})

			if (!response.data?.data?.banners) {
				Logger.log("BannerService: Invalid response format")
				return []
			}

			const allBanners = response.data.data.banners
			Logger.log(`BannerService: Received ${allBanners.length} banners from API`)

			// Filter banners based on rules evaluation
			const matchingBanners = allBanners.filter((banner) => this.evaluateBannerRules(banner))
			Logger.log(`BannerService: ${matchingBanners.length} banners match current environment`)

			// Update cache
			this._cachedBanners = matchingBanners
			this._lastFetchTime = now

			return matchingBanners
		} catch (error) {
			// Log error but don't throw - banner fetching shouldn't break the extension
			Logger.log(`BannerService: Error fetching banners: ${error instanceof Error ? error.message : String(error)}`)
			return []
		}
	}

	/**
	 * Evaluates banner rules against the current environment
	 * @param banner Banner to evaluate
	 * @returns true if banner should be displayed
	 */
	private evaluateBannerRules(banner: Banner): boolean {
		try {
			// Parse rules JSON
			const rules: BannerRules = JSON.parse(banner.rules_json || "{}")

			// Check IDE rule
			if (rules.ide && rules.ide.length > 0) {
				const currentIde = "vscode" // This extension is for VSCode
				if (!rules.ide.includes(currentIde)) {
					Logger.log(`BannerService: Banner ${banner.id} filtered out by IDE rule (requires: ${rules.ide.join(", ")})`)
					return false
				}
			}

			// Check version rule (optional - can be implemented later with proper version access)
			// if (rules.version) {
			// 	const extensionVersion = getCurrentExtensionVersion()
			// 	if (extensionVersion) {
			// 		if (rules.version.min && this.compareVersions(extensionVersion, rules.version.min) < 0) {
			// 			return false
			// 		}
			// 		if (rules.version.max && this.compareVersions(extensionVersion, rules.version.max) > 0) {
			// 			return false
			// 		}
			// 	}
			// }

			// Additional rule types can be evaluated here in the future:
			// - auth: Check authentication provider
			// - providers: Check configured AI providers
			// - features: Check enabled features

			Logger.log(`BannerService: Banner ${banner.id} passed all rules checks`)
			return true
		} catch (error) {
			// If rules can't be parsed or evaluated, show the banner (fail open)
			Logger.log(
				`BannerService: Error evaluating rules for banner ${banner.id}: ${error instanceof Error ? error.message : String(error)}`,
			)
			return true
		}
	}

	/**
	 * Compares two semantic version strings
	 * @param v1 First version
	 * @param v2 Second version
	 * @returns -1 if v1 < v2, 0 if v1 === v2, 1 if v1 > v2
	 */
	private compareVersions(v1: string, v2: string): number {
		const parts1 = v1.split(".").map(Number)
		const parts2 = v2.split(".").map(Number)

		for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
			const part1 = parts1[i] || 0
			const part2 = parts2[i] || 0

			if (part1 < part2) {
				return -1
			}
			if (part1 > part2) {
				return 1
			}
		}

		return 0
	}

	/**
	 * Clears the banner cache
	 */
	public clearCache(): void {
		this._cachedBanners = []
		this._lastFetchTime = 0
		Logger.log("BannerService: Cache cleared")
	}
}
