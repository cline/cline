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

	// Monotonically increasing ID to track which fetch owns _fetchPromise
	// Prevents race condition where an aborted fetch's .finally() clears a newer fetch's promise
	private _currentFetchId: number = 0

	// AbortController for cancelling in-progress fetch requests
	private _fetchAbortController: AbortController | null = null

	// Circuit breaker state to prevent hammering API after failures
	private _consecutiveFailures: number = 0
	private readonly MAX_CONSECUTIVE_FAILURES = 3
	private readonly CIRCUIT_BREAKER_TIMEOUT_MS = 60 * 60 * 1000 // 1 hour - allow recovery attempt after this

	// Unified backoff timestamp for rate limiting, server errors, and circuit breaker
	private _backoffUntil: number = 0

	private authToken: string | null = "init" // "init" to force initial fetch

	private constructor(private readonly hostInfo: HostInfo) {
		this.actionTypes = new Set<string>(Object.values(BannerActionType))
		Logger.log("[BannerService] initialized")
	}

	/**
	 * Initializes the BannerService singleton with required dependencies
	 * @param hostInfo The host information for accessing state and services
	 * @returns The initialized BannerService instance
	 * @throws Error if already initialized
	 */
	public static initialize(): BannerService {
		if (BannerService.instance) {
			throw new Error("[BannerService] Already initialized.")
		}
		const hostInfo = HostRegistryInfo.get()
		if (!hostInfo) {
			throw new Error("[BannerService] Ensure HostRegistryInfo is initialized before BannerService.")
		}
		BannerService.instance = new BannerService(hostInfo)
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

	public static async onAuthUpdate(newToken: string | null) {
		const instance = BannerService.instance ?? BannerService.initialize()

		if (instance.authToken !== newToken) {
			// Update the auth token
			instance.authToken = newToken

			// Reset circuit breaker and backoff state
			instance._consecutiveFailures = 0
			instance._backoffUntil = 0

			// Abort any in-progress fetch request
			if (instance._fetchAbortController) {
				instance._fetchAbortController.abort()
				instance._fetchAbortController = null
			}
			instance._fetchPromise = null

			// Increment fetch ID to invalidate any pending .finally() callbacks from aborted fetches
			const fetchId = ++instance._currentFetchId

			// Fetch new banners immediately (don't clear cache before fetch completes)
			instance._fetchPromise = instance.fetchBanners()
			try {
				await instance._fetchPromise
			} finally {
				// Only clear if we're still the current fetch (no newer fetch has started)
				if (instance._currentFetchId === fetchId) {
					instance._fetchPromise = null
				}
			}
		}
	}

	/**
	 * Resets the BannerService instance (primarily for testing)
	 */
	public static reset(): void {
		BannerService.instance?._fetchAbortController?.abort()
		BannerService.instance = null
	}

	/**
	 * Fetches banners from the API with circuit breaker and backoff logic.
	 * Called once on init, then every 24 hours via cache expiry.
	 */
	private async fetchBanners(): Promise<Banner[]> {
		// Create a new AbortController for this fetch request
		this._fetchAbortController = new AbortController()
		const signal = this._fetchAbortController.signal

		// Set up timeout to abort after 10 seconds
		const timeoutId = setTimeout(() => this._fetchAbortController?.abort(), 10000)
		// Ensure we clear the timeout whenever this controller is aborted (from any path)
		signal.addEventListener(
			"abort",
			() => {
				clearTimeout(timeoutId)
			},
			{ once: true },
		)

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

			const response = await fetch(url, {
				method: "GET",
				headers,
				signal,
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

			Logger.log(`[BannerService] Fetched ${matchingBanners.length} banner(s)`)

			return matchingBanners
		} catch (error) {
			clearTimeout(timeoutId)

			// Don't count aborted requests as failures (e.g., cancelled due to auth update)
			if (error instanceof Error && error.name === "AbortError") {
				return this._cachedBanners
			}

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

			let backoffMs = 60 * 60 * 1000 // Default: 1 hour backoff
			if (status === 429) {
				// Check for Retry-After header (can be in seconds or HTTP date)
				const retryAfter = typedError.headers?.get("retry-after")

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
			} else if (status && status >= 500 && status < 600) {
				// Use shorter backoff for server errors (15 minutes)
				backoffMs = 15 * 60 * 1000
			}

			this._backoffUntil = Date.now() + backoffMs
			const backoffMinutes = Math.ceil((this._backoffUntil - Date.now()) / 60000)
			Logger.error(
				`[BannerService] Failed ${this._consecutiveFailures}/${this.MAX_CONSECUTIVE_FAILURES} at ${new Date().toLocaleTimeString()}. Backing off for ${backoffMinutes} minutes due to ${status}`,
				error,
			)

			return this._cachedBanners
		} finally {
			this._fetchAbortController = null
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
				`[BannerService] Error parsing provider rules for banner ${banner.id}: ${error instanceof Error ? error.message : String(error)}`,
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
		// Abort any in-progress fetch
		this._fetchAbortController?.abort()
		this._fetchAbortController = null
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

			Logger.log(`[BannerService] Sent ${eventType} event for banner ${bannerId}`)
		} catch (error) {
			Logger.error(`[BannerService] Error sending banner event`, error)
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
				return
			}
			const newDismissal = {
				bannerId,
				dismissedAt: Date.now(),
			}

			StateManager.get().setGlobalState("dismissedBanners", [...dismissedBanners, newDismissal])

			await this.sendBannerEvent(bannerId, "dismiss")

			this.clearCache()
		} catch (error) {
			Logger.error(`[BannerService] Error dismissing banner`, error)
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
			Logger.error(`[BannerService] Error dismissing banner`, error)
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
	 * This method is synchronous and returns the currently cached banners immediately.
	 * If the cache is empty or expired (24 hours) and the service is not in backoff,
	 * it will trigger a background fetch to refresh the cache, but it does NOT wait
	 * for that fetch to complete. Callers must therefore tolerate potentially stale
	 * data being returned.
	 *
	 * The success or failure of the background fetch is not exposed to callers of
	 * this method; it is handled internally by the service.
	 */
	public getActiveBanners(): BannerCardData[] {
		const now = Date.now()
		const cacheExpired = now - this._lastFetchTime >= this.CACHE_DURATION_MS
		const inBackoff = now < this._backoffUntil

		// NOTE: Do not log here - this method is called frequently and logging would be too verbose

		// Fetch new banners if cache is empty or expired
		// Only start a new fetch if there isn't one already in progress
		if (!inBackoff && cacheExpired && !this._fetchPromise) {
			// Capture the fetch ID so we can check ownership when clearing the promise
			const fetchId = ++this._currentFetchId
			this._fetchPromise = this.fetchBanners()

			// Perform the fetch without awaiting - callers get cached data immediately
			// The promise is kept alive until it completes (success or failure)
			this._fetchPromise.finally(() => {
				// Only clear if we're still the current fetch (no newer fetch has started)
				if (this._currentFetchId === fetchId) {
					this._fetchPromise = null
				}
			})
		}

		return this._cachedBanners
			.filter((b) => !this.isBannerDismissed(b.id))
			.map((banner) => this.convertToBannerCardData(banner))
			.filter((b): b is BannerCardData => b !== null)
	}
}
