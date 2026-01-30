import type { Banner, BannerRules, BannersResponse } from "@shared/ClineBanner"
import { BannerActionType, type BannerCardData } from "@shared/cline/banner"
import { ClineEnv } from "@/config"
import { StateManager } from "@/core/storage/StateManager"
import { HostInfo, HostRegistryInfo } from "@/registry"
import { fetch } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import { buildBasicClineHeaders } from "../EnvUtils"

/**
 * Service for fetching and evaluating banner messages
 */
export class BannerService {
	private static instance: BannerService | null = null
	private _cachedBanners: Banner[] = []
	private _lastFetchTime: number = 0
	private readonly CACHE_DURATION_MS = 24 * 60 * 60 * 1000 // 24 hours
	private actionTypes: Set<string>

	// Promise deduplication to prevent concurrent requests
	private _fetchPromise: Promise<Banner[]> | null = null

	// Circuit breaker state to prevent hammering API after failures
	private _consecutiveFailures: number = 0
	private readonly MAX_CONSECUTIVE_FAILURES = 3
	private readonly CIRCUIT_BREAKER_TIMEOUT_MS = 60 * 60 * 1000 // 1 hour - allow recovery attempt after this

	// Unified backoff timestamp for rate limiting, server errors, and circuit breaker
	private _backoffUntil: number = 0

	private authToken: string | null = null

	private constructor(private readonly hostInfo: HostInfo) {
		this.actionTypes = new Set<string>(Object.values(BannerActionType))
	}

	/**
	 * Initializes the BannerService singleton with required dependencies
	 * @param hostInfo The host information for accessing state and services
	 * @returns The initialized BannerService instance
	 * @throws Error if already initialized
	 */
	public static async initialize(): Promise<BannerService> {
		if (BannerService.instance) {
			throw new Error("[BannerService] Already initialized.")
		}
		const hostInfo = HostRegistryInfo.get()
		if (!hostInfo) {
			throw new Error("[BannerService] Ensure HostRegistryInfo is initialized before BannerService.")
		}
		BannerService.instance = new BannerService(hostInfo)
		await BannerService.instance.getActiveBanners(true) // Initial fetch
		return BannerService.instance
	}

	/**
	 * Returns the singleton instance of BannerService
	 * @throws Error if not initialized
	 */
	public static get(): BannerService {
		if (!BannerService.instance) {
			throw new Error("[BannerService] Not initialized. Call BannerService.initialize() first.")
		}
		return BannerService.instance
	}

	public static onAuthUpdate(newToken: string | null): void {
		if (!BannerService.instance) {
			return
		}
		const instance = BannerService.instance

		// Update the auth token
		instance.authToken = newToken

		// Reset circuit breaker and backoff state
		instance._consecutiveFailures = 0
		instance._backoffUntil = 0

		// Fetch new banners immediately (don't clear cache before fetch completes)
		void instance.fetchBanners()
	}

	/**
	 * Resets the BannerService instance (primarily for testing)
	 */
	public static reset(): void {
		BannerService.instance = null
	}

	/**
	 * Fetches banners from the API with circuit breaker and backoff logic.
	 * Called once on init, then every 24 hours via cache expiry.
	 */
	private async fetchBanners(): Promise<Banner[]> {
		try {
			const urlObj = new URL("/banners/v1/messages", ClineEnv.config().apiBaseUrl)
			urlObj.searchParams.set("ide", this.getIdeType(this.hostInfo.ide))
			urlObj.searchParams.set("extension_version", this.hostInfo.extensionVersion)
			urlObj.searchParams.set("os", this.getOSType(this.hostInfo.os))

			const url = urlObj.toString()
			const token = this.authToken

			const headers: Record<string, string> = {
				"Content-Type": "application/json",
				...(await buildBasicClineHeaders()),
			}
			if (token) {
				headers["Authorization"] = `Bearer ${token}`
			}

			const controller = new AbortController()
			const timeoutId = setTimeout(() => controller.abort(), 10000)

			const response = await fetch(url, {
				method: "GET",
				headers,
				signal: controller.signal,
			})

			clearTimeout(timeoutId)

			if (!response.ok) {
				const error = new Error(`HTTP ${response.status}`) as Error & {
					status: number
					headers?: { get(name: string): string | null }
				}
				error.status = response.status
				error.headers = response.headers
				throw error
			}

			const data = (await response.json()) as BannersResponse

			if (!data?.data || !Array.isArray(data.data.items)) {
				Logger.log("BannerService: Invalid response format")
				return []
			}

			const backendFilteredBanners = data.data.items
			const matchingBanners = backendFilteredBanners.filter((banner) => this.matchesProviderRule(banner))

			// Success - update cache and reset circuit breaker state
			this._cachedBanners = matchingBanners
			this._lastFetchTime = Date.now()
			this._consecutiveFailures = 0

			Logger.log(`BannerService: Fetched ${matchingBanners.length} banner(s)`)
			return matchingBanners
		} catch (error) {
			this._consecutiveFailures++

			// Track when circuit breaker trips or resets timeout after failed half-open recovery
			if (this._consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
				this._backoffUntil = Date.now() + this.CIRCUIT_BREAKER_TIMEOUT_MS
				if (this._consecutiveFailures === this.MAX_CONSECUTIVE_FAILURES) {
					Logger.log("BannerService: Circuit breaker tripped, will allow recovery attempt after 1 hour")
				} else {
					Logger.log("BannerService: Half-open recovery failed, resetting timeout for another 1 hour")
				}
			}

			// Handle rate limiting (429) and server errors (5xx) with backoff
			const typedError = error as Error & { status?: number; headers?: { get(name: string): string | null } }
			const status = typedError.status

			if (status === 429) {
				// Check for Retry-After header (can be in seconds or HTTP date)
				const retryAfter = typedError.headers?.get("retry-after")
				let backoffMs = 60 * 60 * 1000 // Default: 1 hour backoff

				if (retryAfter) {
					const retrySeconds = Number.parseInt(retryAfter, 10)
					if (!Number.isNaN(retrySeconds)) {
						backoffMs = retrySeconds * 1000
					} else {
						// Try to parse as HTTP date
						const retryDate = new Date(retryAfter)
						if (!Number.isNaN(retryDate.getTime())) {
							backoffMs = Math.max(0, retryDate.getTime() - Date.now())
						}
					}
				}

				this._backoffUntil = Date.now() + backoffMs
				const backoffMinutes = Math.ceil(backoffMs / 60000)
				Logger.error(
					`BannerService: Rate limited (429), backing off for ${backoffMinutes} minutes. Consecutive failures: ${this._consecutiveFailures}`,
					error,
				)
			} else if (status && status >= 500 && status < 600) {
				// Use shorter backoff for server errors (15 minutes)
				const backoffMs = 15 * 60 * 1000
				this._backoffUntil = Date.now() + backoffMs
				const backoffMinutes = Math.ceil(backoffMs / 60000)
				Logger.error(
					`BannerService: Server error (${status}), backing off for ${backoffMinutes} minutes. Consecutive failures: ${this._consecutiveFailures}`,
					error,
				)
			} else if (status) {
				Logger.error(
					`BannerService: HTTP error ${status} fetching banners (failure ${this._consecutiveFailures}/${this.MAX_CONSECUTIVE_FAILURES})`,
					error,
				)
			} else {
				Logger.error(
					`BannerService: Error fetching banners (failure ${this._consecutiveFailures}/${this.MAX_CONSECUTIVE_FAILURES})`,
					error,
				)
			}

			return this._cachedBanners
		} finally {
			this._fetchPromise = null
		}
	}

	/**
	 * Client-side filtering by providers rule only
	 * Backend handles all other filtering (ide, employee_only, audience, org_type, version)
	 * @param banner Banner to check
	 * @returns true if banner matches provider requirements or has no provider restrictions
	 */
	private matchesProviderRule(banner: Banner): boolean {
		try {
			const rules: BannerRules = JSON.parse(banner.rulesJson || "{}")

			if (!rules?.providers?.length) {
				return true
			}

			const apiConfiguration = StateManager.get().getApiConfiguration()
			const currentMode = StateManager.get().getGlobalSettingsKey("mode")
			const selectedProvider =
				currentMode === "plan" ? apiConfiguration?.planModeApiProvider : apiConfiguration?.actModeApiProvider

			const hasMatchingProvider = rules.providers.some((provider) => {
				// Normalize provider names for comparison
				switch (provider) {
					case "anthropic":
					case "claude-code":
						return selectedProvider === "anthropic"
					case "openai":
					case "openai-native":
						return selectedProvider === "openai" || selectedProvider === "openai-native"
					case "qwen":
					case "qwen-code":
						return selectedProvider === "qwen"
					default:
						// For any other providers, do a direct string comparison
						return selectedProvider === provider
				}
			})

			return hasMatchingProvider
		} catch (error) {
			Logger.log(
				`BannerService: Error parsing provider rules for banner ${banner.id}: ${error instanceof Error ? error.message : String(error)}`,
			)
			return true
		}
	}

	/**
	 * Gets the current Operating System
	 * @returns OS type (windows, linux, macos or unknown)
	 */
	private getOSType(os: string) {
		switch (os) {
			case "win32":
				return "windows"
			case "linux":
				return "linux"
			case "darwin":
				return "macos"
			default:
				return "unknown"
		}
	}

	/**
	 * Gets the current IDE type
	 * @returns IDE type (vscode, jetbrains, cli, or unknown)
	 */
	private getIdeType(clineType: string): string {
		if (clineType.includes("vscode")) {
			return "vscode"
		}
		if (clineType.includes("jetbrains")) {
			return "jetbrains"
		}
		if (clineType.includes("cli")) {
			return "cli"
		}
		return "unknown"
	}

	/**
	 * Clears the banner cache and resets circuit breaker state
	 */
	public clearCache(): void {
		this._cachedBanners = []
		this._lastFetchTime = 0
		this._consecutiveFailures = 0
		this._backoffUntil = 0
		this._fetchPromise = null
		Logger.log("BannerService: Cache cleared and circuit breaker reset")
	}

	/**
	 * Sends a banner event to the telemetry endpoint
	 * @param bannerId The ID of the banner
	 * @param eventType The type of event (now we only support dismiss, in the future we might want to support seen, click...)
	 */
	public async sendBannerEvent(bannerId: string, eventType: "dismiss"): Promise<void> {
		try {
			const url = new URL("/banners/v1/events", ClineEnv.config().apiBaseUrl).toString()

			// Get IDE type for surface
			const ideType = this.getIdeType(this.hostInfo.ide)
			let surface: string
			if (ideType === "cli") {
				surface = "cli"
			} else if (ideType === "jetbrains") {
				surface = "jetbrains"
			} else {
				surface = "vscode"
			}

			const instanceId = this.hostInfo.distinctId

			const payload = {
				banner_id: bannerId,
				instance_id: instanceId,
				surface,
				event_type: eventType,
			}

			const controller = new AbortController()
			const timeoutId = setTimeout(() => controller.abort(), 10000)

			await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...(await buildBasicClineHeaders()),
				},
				body: JSON.stringify(payload),
				signal: controller.signal,
			})

			clearTimeout(timeoutId)

			Logger.log(`BannerService: Sent ${eventType} event for banner ${bannerId}`)
		} catch (error) {
			Logger.error(`BannerService: Error sending banner event`, error)
		}
	}

	/**
	 * Marks a banner as dismissed and stores it in state
	 * @param bannerId The ID of the banner to dismiss
	 */
	public async dismissBanner(bannerId: string): Promise<void> {
		try {
			const dismissedBanners = StateManager.get().getGlobalStateKey("dismissedBanners") || []

			if (dismissedBanners.some((b) => b.bannerId === bannerId)) {
				Logger.log(`BannerService: Banner ${bannerId} already dismissed`)
				return
			}
			const newDismissal = {
				bannerId,
				dismissedAt: Date.now(),
			}

			StateManager.get().setGlobalState("dismissedBanners", [...dismissedBanners, newDismissal])

			await this.sendBannerEvent(bannerId, "dismiss")

			this.clearCache()

			Logger.log(`BannerService: Banner ${bannerId} dismissed`)
		} catch (error) {
			Logger.error(`BannerService: Error dismissing banner`, error)
		}
	}

	/**
	 * Checks if a banner has been dismissed by the user
	 * @param bannerId The ID of the banner to check
	 * @returns true if the banner has been dismissed
	 */
	public isBannerDismissed(bannerId: string): boolean {
		try {
			const dismissedBanners = StateManager.get().getGlobalStateKey("dismissedBanners") || []
			return dismissedBanners.some((b) => b.bannerId === bannerId)
		} catch (error) {
			Logger.error(`BannerService: Error checking if banner is dismissed`, error)
			return false
		}
	}

	/**
	 * Converts a Banner (API response format) to BannerCardData (UI format)
	 * @param banner The banner from the API
	 * @returns BannerCardData suitable for the carousel, or null if banner is invalid.
	 */
	private convertToBannerCardData(banner: Banner): BannerCardData | null {
		// Validate all action types before conversion
		// Each action must have a valid action type - undefined is not allowed
		for (const action of banner.actions || []) {
			if (!action.action || !this.actionTypes.has(action.action) || !action.title) {
				Logger.error(`[BannerService] Invalid action type (${action.action}) for banner ${banner.id}`)
				return null
			}
		}

		return {
			id: banner.id,
			title: banner.titleMd,
			description: banner.bodyMd,
			icon: banner.icon,
			actions: (banner.actions || []).map((action) => ({
				title: action.title || "",
				action: action.action as BannerActionType,
				arg: action.arg,
			})),
		}
	}

	/**
	 * Gets banners that haven't been dismissed by the user.
	 * Fetches from API if cache is empty or expired (24 hours).
	 * Implements circuit breaker pattern and promise deduplication.
	 * @param forceRefresh If true, bypasses cache and fetches fresh data
	 * @returns Array of non-dismissed banners converted to BannerCardData format
	 */
	public async getActiveBanners(forceRefresh = false): Promise<BannerCardData[]> {
		const now = Date.now()
		const cacheExpired = now - this._lastFetchTime >= this.CACHE_DURATION_MS

		if (forceRefresh || this._cachedBanners.length === 0 || cacheExpired) {
			// Check if we're still in backoff period (from rate limiting, server errors, or circuit breaker)
			if (now < this._backoffUntil) {
				const remainingMs = this._backoffUntil - now
				if (remainingMs > 60000) {
					Logger.log(`BannerService: Backoff active, will retry in ${Math.ceil(remainingMs / 60000)}m`)
				} else {
					Logger.log(`BannerService: Backoff active, will retry in ${Math.ceil(remainingMs / 1000)}s`)
				}
				// Return cached banners without fetching
				return this._cachedBanners
					.filter((b) => !this.isBannerDismissed(b.id))
					.map((banner) => this.convertToBannerCardData(banner))
					.filter((b): b is BannerCardData => b !== null)
			}

			// If we had consecutive failures, log that we're attempting recovery
			if (this._consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
				Logger.log("BannerService: Attempting recovery request after backoff")
			}
			// Promise deduplication: Prevent concurrent requests
			if (this._fetchPromise && !forceRefresh) {
				Logger.log("BannerService: Reusing in-flight request")
			} else {
				this._fetchPromise = this.fetchBanners()
			}

			// Perform the fetch (or await the in-flight one)
			await this._fetchPromise
		}

		return this._cachedBanners
			.filter((b) => !this.isBannerDismissed(b.id))
			.map((banner) => this.convertToBannerCardData(banner))
			.filter((b): b is BannerCardData => b !== null)
	}
}
