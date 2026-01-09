import type { Banner, BannerRules, BannersResponse } from "@shared/ClineBanner"
import axios from "axios"
import { ClineEnv } from "@/config"
import type { Controller } from "@/core/controller"
import { HostProvider } from "@/hosts/host-provider"
import { BannerActionType, BannerCardData } from "@/shared/cline/banner"
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

	/**
	 * The list of predefined banner configs.
	 */
	private BANNER_DATA: BannerCardData[] = [
		// Info banner with inline link
		{
			id: "info-banner-v1",
			icon: "lightbulb",
			title: "Use Cline in Right Sidebar",
			description:
				"For the best experience, drag the Cline icon to your right sidebar. This keeps your file explorer and editor visible while you chat with Cline, making it easier to navigate your codebase and see changes in real-time. [See how →](https://docs.cline.bot/features/customization/opening-cline-in-sidebar)",
		},

		// Announcement with conditional actions based on user auth state
		{
			id: "new-model-opus-4-5-cline-users",
			icon: "megaphone",
			title: "Claude Opus 4.5 Now Available",
			description: "State-of-the-art performance at 3x lower cost than Opus 4.1. Available now in the Cline provider.",
			actions: [
				{
					title: "Try Now",
					action: BannerActionType.SetModel,
					arg: "anthropic/claude-opus-4.5",
				},
			],
			isClineUserOnly: true, // Only Cline users see this
		},

		{
			id: "new-model-opus-4-5-non-cline-users",
			icon: "megaphone",
			title: "Claude Opus 4.5 Now Available",
			description: "State-of-the-art performance at 3x lower cost than Opus 4.1. Available now in the Cline provider.",
			actions: [
				{
					title: "Get Started",
					action: BannerActionType.ShowAccount,
				},
			],
			isClineUserOnly: false, // Only non-Cline users see this
		},

		// Platform-specific banner (macOS/Linux)
		{
			id: "cli-install-unix-v1",
			icon: "terminal",
			title: "CLI & Subagents Available",
			platforms: ["mac", "linux"] satisfies BannerCardData["platforms"],
			description:
				"Use Cline in your terminal and enable subagent capabilities. [Learn more](https://docs.cline.bot/cline-cli/overview)",
			actions: [
				{
					title: "Install",
					action: BannerActionType.InstallCli,
				},
				{
					title: "Enable Subagents",
					action: BannerActionType.ShowFeatureSettings,
				},
			],
		},

		// Platform-specific banner (Windows)
		{
			id: "cli-info-windows-v1",
			icon: "terminal",
			title: "Cline CLI Info",
			platforms: ["windows"] satisfies BannerCardData["platforms"],
			description:
				"Available for macOS and Linux. Coming soon to other platforms. [Learn more](https://docs.cline.bot/cline-cli/overview)",
		},
	]

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
	 * Resets the BannerService instance (primarily for testing)
	 */
	public static reset(): void {
		BannerService.instance = null
	}

	public static async getActiveBanners(): Promise<BannerCardData[]> {
		try {
			return BannerService.get().getActiveBanners()
		} catch (error) {
			Logger.error("Couldnt get banners", error)
			return []
		}
	}

	private async getActiveBanners(): Promise<BannerCardData[]> {
		return this.BANNER_DATA.filter(this.shouldShow)
		// TODO: include banners from the API
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
	 * Checks if a banner should be shown on this IDE and it has not been dismissed by the user
	 * @param bannerId The ID of the banner to check
	 * @returns true if the banner has been dismissed
	 */
	public shouldShow(banner: BannerCardData): boolean {
		try {
			const dismissedBanners = this._controller.stateManager.getGlobalStateKey("dismissedBanners") || []
			const isDismissed = !dismissedBanners.some((b) => b.bannerId === banner.id)
			if (isDismissed) {
				return false
			}
			const os = this.getOsType()
			// This filtering is only required for hard-coded banners.
			if (banner.platforms && !banner.platforms.some((p) => p === os)) {
				// Banner is not used on this OS
				return false
			}
			// TODO: Add isClineUser check
			return true
		} catch (error) {
			Logger.error(`BannerService: Error checking if banner is dismissed`, error)
			return true
		}
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

			const instanceId = getDistinctId()

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
	 * Fetches active banners from the API
	 * Backend handles all filtering based on ide and user context
	 * Extension only filters by providers (API provider configuration)
	 * @param forceRefresh If true, bypasses cache and fetches fresh data
	 * @returns Array of banners that match current environment
	 */
	async fetchActiveBanners(forceRefresh = false): Promise<Banner[]> {
		try {
			// Return cached banners if still valid
			const now = Date.now()
			if (!forceRefresh && this._cachedBanners.length > 0 && now - this._lastFetchTime < this.CACHE_DURATION_MS) {
				Logger.log("BannerService: Returning cached banners")
				return this._cachedBanners
			}

			const ideType = await this.getIdeType()
			const extensionVersion = await this.getExtensionVersion()
			const osType = this.getOsType()

			const urlObj = new URL("/banners/v1/messages", this._baseUrl)
			urlObj.searchParams.set("ide", ideType)
			if (extensionVersion) {
				urlObj.searchParams.set("extension_version", extensionVersion)
			}
			urlObj.searchParams.set("os", osType)

			const url = urlObj.toString()
			Logger.log(`BannerService: Fetching banners from ${url}`)

			const authService = AuthService.getInstance(this._controller)
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
	private getOsType(): string {
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
}
