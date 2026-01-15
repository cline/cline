import type { Banner, BannerRules, BannersResponse } from "@shared/ClineBanner"
import { BannerActionType, type BannerCardData } from "@shared/cline/banner"
import axios from "axios"
import { ClineEnv } from "@/config"
import { StateManager } from "@/core/storage/StateManager"
import { HostProvider } from "@/hosts/host-provider"
import { getAxiosSettings } from "@/shared/net"
import { buildBasicClineHeaders } from "../EnvUtils"
import { getDistinctId } from "../logging/distinctId"
import { Logger } from "../logging/Logger"

/**
 * Service for fetching and evaluating banner messages
 */
export class BannerService {
	private static instance: BannerService | null = null
	private readonly _baseUrl = ClineEnv.config().apiBaseUrl
	private _cachedBanners: Banner[] = []
	private _lastFetchTime: number = 0
	private readonly CACHE_DURATION_MS = 24 * 60 * 60 * 1000 // 24 hours
	private readonly RETRY_DELAY_MS = 60 * 60 * 1000 // 1 hour retry delay on failure
	private readonly MAX_RETRIES = 3
	private actionTypes: Set<string>
	private _retryCount: number = 0
	private _retryTimeoutId: ReturnType<typeof setTimeout> | null = null

	private constructor(private authToken: string) {
		this.actionTypes = new Set<string>(Object.values(BannerActionType))
	}

	/**
	 * Initializes the BannerService singleton with required dependencies
	 * @param controller The controller instance for accessing state and services
	 * @returns The initialized BannerService instance
	 * @throws Error if already initialized
	 */
	public static initialize(authToken: string): BannerService {
		if (BannerService.instance) {
			throw new Error("BannerService has already been initialized.")
		}
		BannerService.instance = new BannerService(authToken)
		return BannerService.instance
	}

	/**
	 * Returns the singleton instance of BannerService
	 * @throws Error if not initialized
	 */
	public static get(): BannerService {
		if (!BannerService.instance) {
			throw new Error("BannerService not initialized. Call BannerService.initialize() first.")
		}
		return BannerService.instance
	}

	/**
	 * Checks if BannerService has been initialized
	 */
	public static isInitialized(): boolean {
		return !!BannerService.instance
	}

	/**
	 * Resets the BannerService instance (primarily for testing)
	 */
	public static reset(): void {
		BannerService.instance = null
	}

	/**
	 * Fetches banners from the API with simple retry logic.
	 * Called once on init, then every 24 hours via cache expiry.
	 * On rate limit (429), retries up to 3 times with 1-hour delays.
	 */
	private async fetchBanners(): Promise<Banner[]> {
		try {
			const ideType = await this.getIdeType()
			const extensionVersion = await this.getExtensionVersion()
			const osType = await this.getOSType()

			const urlObj = new URL("/banners/v1/messages", this._baseUrl)
			urlObj.searchParams.set("ide", ideType)
			if (extensionVersion) {
				urlObj.searchParams.set("extension_version", extensionVersion)
			}
			urlObj.searchParams.set("os", osType)

			const url = urlObj.toString()
			Logger.log(`BannerService: Fetching banners from ${url}`)

			const token: string | null = this.authToken || null

			const headers: Record<string, string> = {
				"Content-Type": "application/json",
				...(await buildBasicClineHeaders()),
			}
			if (token) {
				headers["Authorization"] = `Bearer ${token}`
			}

			const response = await axios.get<BannersResponse>(url, {
				timeout: 10000,
				headers,
				...getAxiosSettings(),
			})

			if (!response.data?.data || !Array.isArray(response.data.data.items)) {
				Logger.log("BannerService: Invalid response format")
				return []
			}

			const backendFilteredBanners = response.data.data.items
			const matchingBanners = backendFilteredBanners.filter((banner) => this.matchesProviderRule(banner))

			// Success - update cache and reset retry state
			this._cachedBanners = matchingBanners
			this._lastFetchTime = Date.now()
			this._retryCount = 0
			if (this._retryTimeoutId) {
				clearTimeout(this._retryTimeoutId)
				this._retryTimeoutId = null
			}

			Logger.log(`BannerService: Fetched ${matchingBanners.length} banner(s)`)
			return matchingBanners
		} catch (error) {
			// Handle rate limiting with retry
			if (axios.isAxiosError(error) && error.response?.status === 429) {
				if (this._retryCount < this.MAX_RETRIES) {
					this._retryCount++
					Logger.log(`BannerService: Rate limited, scheduling retry ${this._retryCount}/${this.MAX_RETRIES} in 1 hour`)
					this._retryTimeoutId = setTimeout(() => this.fetchBanners(), this.RETRY_DELAY_MS)
				} else {
					Logger.log(`BannerService: Rate limited, max retries (${this.MAX_RETRIES}) reached`)
				}
			} else {
				Logger.error("BannerService: Error fetching banners", error)
			}

			return this._cachedBanners
		}
	}

	/**
	 * Gets the current extension version
	 * @returns Extension version string (e.g., "3.39.2")
	 */
	private async getExtensionVersion(): Promise<string> {
		try {
			const hostVersion = await HostProvider.env.getHostVersion({})
			return hostVersion.clineVersion || ""
		} catch (error) {
			Logger.error("BannerService: Error getting extension version", error)
			return ""
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

			if (!rules.providers || rules.providers.length === 0) {
				return true
			}

			const apiConfiguration = StateManager.get()?.getApiConfiguration()
			const currentMode = StateManager.get()?.getGlobalSettingsKey("mode")
			const selectedProvider =
				currentMode === "plan" ? apiConfiguration?.planModeApiProvider : apiConfiguration?.actModeApiProvider

			if (!selectedProvider) {
				Logger.log(`BannerService: Banner ${banner.id} filtered by client - no provider selected for ${currentMode} mode`)
				return false
			}

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

			if (!hasMatchingProvider) {
				Logger.log(
					`BannerService: Banner ${banner.id} filtered by client - selected provider '${selectedProvider}' doesn't match any of these required providers: ${rules.providers.join(", ")}`,
				)
			}

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
	private async getOSType(): Promise<string> {
		try {
			switch (process.platform) {
				case "win32":
					return "windows"
				case "linux":
					return "linux"
				case "darwin":
					return "macos"
				default:
					return "unknown"
			}
		} catch (error) {
			Logger.error("BannerService: Error getting OS type", error)
			return "unknown"
		}
	}

	/**
	 * Gets the current IDE type
	 * @returns IDE type (vscode, jetbrains, cli, or unknown)
	 */
	private async getIdeType(): Promise<string> {
		try {
			const hostVersion = await HostProvider.env.getHostVersion({})

			// Use clineType field which contains values like "VSCode Extension", "Cline for JetBrains", "CLI", etc.
			const clineType = hostVersion.clineType?.toLowerCase() || ""

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
		} catch (error) {
			Logger.error("BannerService: Error getting IDE type", error)
			return "unknown"
		}
	}

	/**
	 * Clears the banner cache and resets retry state
	 */
	public clearCache(): void {
		this._cachedBanners = []
		this._lastFetchTime = 0
		this._retryCount = 0
		if (this._retryTimeoutId) {
			clearTimeout(this._retryTimeoutId)
			this._retryTimeoutId = null
		}
		Logger.log("BannerService: Cache cleared")
	}

	/**
	 * Sends a banner event to the telemetry endpoint
	 * @param bannerId The ID of the banner
	 * @param eventType The type of event (now we only support dismiss, in the future we might want to support seen, click...)
	 */
	public async sendBannerEvent(bannerId: string, eventType: "dismiss"): Promise<void> {
		try {
			const url = new URL("/banners/v1/events", this._baseUrl).toString()

			// Get IDE type for surface
			const ideType = await this.getIdeType()
			let surface: string
			if (ideType === "cli") {
				surface = "cli"
			} else if (ideType === "jetbrains") {
				surface = "jetbrains"
			} else {
				surface = "vscode"
			}

			const instanceId = this.getInstanceDistinctId()

			const payload = {
				banner_id: bannerId,
				instance_id: instanceId,
				surface,
				event_type: eventType,
			}

			await axios.post(url, payload, {
				timeout: 10000,
				headers: {
					"Content-Type": "application/json",
					...(await buildBasicClineHeaders()),
				},
				...getAxiosSettings(),
			})

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
			const dismissedBanners = StateManager.get()?.getGlobalStateKey("dismissedBanners") || []

			if (dismissedBanners.some((b) => b.bannerId === bannerId)) {
				Logger.log(`BannerService: Banner ${bannerId} already dismissed`)
				return
			}
			const newDismissal = {
				bannerId,
				dismissedAt: Date.now(),
			}

			StateManager.get()?.setGlobalState("dismissedBanners", [...dismissedBanners, newDismissal])

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
			if (!action.action || !this.actionTypes.has(action.action)) {
				Logger.error(`BannerService: ${banner.id} has invalid or missing action type '${action.action ?? "undefined"}'.`)
				return null
			}
			if (!action.title) {
				Logger.error(`BannerService: ${banner.id} is missing an action title: ${JSON.stringify(action)}`)
				return null
			}
		}

		const actions = (banner.actions || []).map((action) => ({
			title: action.title || "",
			action: action.action as BannerActionType,
			arg: action.arg,
		}))
		return {
			id: banner.id,
			title: banner.titleMd,
			description: banner.bodyMd,
			icon: banner.icon,
			actions,
		}
	}

	/**
	 * Gets banners that haven't been dismissed by the user.
	 * Fetches from API if cache is empty or expired (24 hours).
	 * @param forceRefresh If true, bypasses cache and fetches fresh data
	 * @returns Array of non-dismissed banners converted to BannerCardData format
	 */
	public async getActiveBanners(forceRefresh = false): Promise<BannerCardData[]> {
		const now = Date.now()
		const cacheExpired = now - this._lastFetchTime >= this.CACHE_DURATION_MS
		const shouldFetch = forceRefresh || this._cachedBanners.length === 0 || cacheExpired

		if (shouldFetch) {
			await this.fetchBanners()
		}

		return this._cachedBanners
			.map((banner) => this.convertToBannerCardData(banner))
			.filter((b): b is BannerCardData => b !== null)
	}

	/**
	 * Gets the distinct ID for the current user
	 * @returns distinct ID string
	 */
	private getInstanceDistinctId(): string {
		try {
			return getDistinctId()
		} catch (error) {
			Logger.error("BannerService: Error getting distinct ID", error)
			return "unknown"
		}
	}
}
