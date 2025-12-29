import type { Banner, BannerRules, BannersResponse } from "@shared/ClineBanner"
import axios from "axios"
import { ClineEnv } from "@/config"
import type { Controller } from "@/core/controller"
import { HostProvider } from "@/hosts/host-provider"
import { getAxiosSettings } from "@/shared/net"
import { AuthService } from "../auth/AuthService"
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
	private readonly CACHE_DURATION_MS = 5 * 60 * 1000 // 5 minutes
	private _controller: Controller
	private _authService?: AuthService

	private constructor(controller: Controller) {
		this._controller = controller
	}

	/**
	 * Initializes the BannerService singleton with required dependencies
	 * @param controller The controller instance for accessing state and services
	 * @returns The initialized BannerService instance
	 * @throws Error if already initialized
	 */
	public static initialize(controller: Controller): BannerService {
		if (BannerService.instance) {
			throw new Error("BannerService has already been initialized.")
		}
		BannerService.instance = new BannerService(controller)
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
	 * Sets the AuthService instance for testing purposes
	 * In production, AuthService is loaded dynamically when needed
	 */
	public setAuthService(authService: AuthService): void {
		this._authService = authService
	}

	/**
	 * Fetches active banners from the API
	 * Backend handles all filtering based on ide and user context
	 * Extension only filters by providers (API provider configuration)
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

			const authService = this.getAuthServiceInstance()
			let token: string | null = null
			if (authService) {
				token = await authService.getAuthToken()
			}

			const headers: Record<string, string> = {
				"Content-Type": "application/json",
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
				Logger.log("BannerService: Invalid response format - items array is missing or malformed")
				return []
			}

			const backendFilteredBanners = response.data.data.items
			Logger.log(`BannerService: Received ${backendFilteredBanners.length} banners from backend (already filtered)`)

			// Client-side filtering: Only filter by providers
			const matchingBanners = backendFilteredBanners.filter((banner) => this.matchesProviderRule(banner))
			Logger.log(`BannerService: ${matchingBanners.length} banners match provider requirements`)

			// Update cache
			this._cachedBanners = matchingBanners
			this._lastFetchTime = now

			return matchingBanners
		} catch (error) {
			// Log error but don't throw - banner fetching shouldn't break the extension
			Logger.error("BannerService: Error fetching banners", error)
			return []
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

			const apiConfiguration = this._controller.stateManager.getApiConfiguration()
			const currentMode = this._controller.stateManager.getGlobalSettingsKey("mode")
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
	 * Gets the AuthService instance
	 * @returns AuthService instance or undefined if not available
	 */
	private getAuthServiceInstance(): AuthService | undefined {
		// Use injected instance if available (for testing)
		if (this._authService) {
			return this._authService
		}

		// Otherwise, get singleton instance
		try {
			return AuthService.getInstance(this._controller)
		} catch {
			return undefined
		}
	}

	/**
	 * Clears the banner cache
	 */
	public clearCache(): void {
		this._cachedBanners = []
		this._lastFetchTime = 0
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
			const dismissedBanners = this._controller.stateManager.getGlobalStateKey("dismissedBanners") || []

			if (dismissedBanners.some((b) => b.bannerId === bannerId)) {
				Logger.log(`BannerService: Banner ${bannerId} already dismissed`)
				return
			}
			const newDismissal = {
				bannerId,
				dismissedAt: Date.now(),
			}

			this._controller.stateManager.setGlobalState("dismissedBanners", [...dismissedBanners, newDismissal])

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
			const dismissedBanners = this._controller.stateManager.getGlobalStateKey("dismissedBanners") || []
			return dismissedBanners.some((b) => b.bannerId === bannerId)
		} catch (error) {
			Logger.error(`BannerService: Error checking if banner is dismissed`, error)
			return false
		}
	}

	/**
	 * Gets banners that haven't been dismissed by the user
	 * @param forceRefresh If true, bypasses cache and fetches fresh data
	 * @returns Array of non-dismissed banners
	 */
	public async getNonDismissedBanners(forceRefresh = false): Promise<Banner[]> {
		const allBanners = await this.fetchActiveBanners(forceRefresh)
		return allBanners.filter((banner) => !this.isBannerDismissed(banner.id))
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
