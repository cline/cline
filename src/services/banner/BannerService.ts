import type { Banner, BannerRules, BannersResponse } from "@shared/ClineBanner"
import { isClineInternalTester } from "@shared/internal/account"
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
			let url: string
			try {
				url = new URL("/banners/v1/messages", this._baseUrl).toString()
				Logger.log(`BannerService: Fetching banners from ${url}`)
			} catch (urlError) {
				console.error("Error constructing URL:", urlError)
				throw urlError
			}

			const response = await axios.get<BannersResponse>(url, {
				timeout: 10000, // 10 second timeout
				headers: {
					"Content-Type": "application/json",
				},
				...getAxiosSettings(),
			})

			if (!response.data?.data || !Array.isArray(response.data.data.items)) {
				Logger.log("BannerService: Invalid response format - items array is missing or malformed")
				return []
			}

			const allBanners = response.data.data.items
			Logger.log(`BannerService: Received ${allBanners.length} banners from API`)

			// Filter banners based on rules evaluation
			const matchingBanners = []
			for (const banner of allBanners) {
				if (await this.evaluateBannerRules(banner)) {
					matchingBanners.push(banner)
				}
			}
			Logger.log(`BannerService: ${matchingBanners.length} banners match current environment`)

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
	 * Evaluates banner rules against the current environment
	 * @param banner Banner to evaluate
	 * @returns true if banner should be displayed
	 */
	private async evaluateBannerRules(banner: Banner): Promise<boolean> {
		try {
			// Check date range first (active_from and active_to)
			if (!this.isWithinActiveDateRange(banner)) {
				Logger.log(`BannerService: Banner ${banner.id} filtered out - outside active date range`)
				return false
			}

			// Parse rules JSON
			const rules: BannerRules = JSON.parse(banner.rulesJson || "{}")

			// Check IDE rule
			if (rules.ide && rules.ide.length > 0) {
				const currentIde = await this.getIdeType()
				if (currentIde && !rules.ide.includes(currentIde)) {
					Logger.log(
						`BannerService: Banner ${banner.id} filtered out by IDE rule (requires: ${rules.ide.join(", ")}, current: ${currentIde})`,
					)
					return false
				}
			}

			// Check auth provider rule
			if (rules.auth && rules.auth.length > 0 && this._controller) {
				const authProvider = this.getAuthProvider()
				if (authProvider && !rules.auth.includes(authProvider)) {
					Logger.log(
						`BannerService: Banner ${banner.id} filtered out by auth rule (requires: ${rules.auth.join(", ")}, current: ${authProvider})`,
					)
					return false
				}
			}

			// Check API providers rule - show banner if user has ANY of the specified providers configured
			if (rules.providers && rules.providers.length > 0 && this._controller) {
				const apiConfiguration = this._controller.stateManager.getApiConfiguration()
				const hasAnyProvider = rules.providers.some((provider) => {
					switch (provider) {
						case "anthropic":
						case "claude-code":
							return !!apiConfiguration?.apiKey
						case "openai":
						case "openai-native":
							return !!apiConfiguration?.openAiApiKey || !!apiConfiguration?.openAiNativeApiKey
						case "openrouter":
							return !!apiConfiguration?.openRouterApiKey
						case "bedrock":
							return !!apiConfiguration?.awsAccessKey || !!apiConfiguration?.awsBedrockApiKey
						case "gemini":
							return !!apiConfiguration?.geminiApiKey
						case "deepseek":
							return !!apiConfiguration?.deepSeekApiKey
						case "qwen":
						case "qwen-code":
							return !!apiConfiguration?.qwenApiKey
						case "mistral":
							return !!apiConfiguration?.mistralApiKey
						case "ollama":
							return !!apiConfiguration?.ollamaApiKey
						case "xai":
							return !!apiConfiguration?.xaiApiKey
						case "cerebras":
							return !!apiConfiguration?.cerebrasApiKey
						case "groq":
							return !!apiConfiguration?.groqApiKey
						case "cline":
							return (
								apiConfiguration?.planModeApiProvider === "cline" ||
								apiConfiguration?.actModeApiProvider === "cline"
							)
						default:
							return false
					}
				})

				if (!hasAnyProvider) {
					Logger.log(
						`BannerService: Banner ${banner.id} filtered out - user doesn't have any of these providers configured: ${rules.providers.join(", ")}`,
					)
					return false
				}
			}

			// Check employee only rule
			if (rules.employee_only && this._controller) {
				const isEmployee = this.isEmployee()
				if (!isEmployee) {
					Logger.log(`BannerService: Banner ${banner.id} filtered out - employee only`)
					return false
				}
			}

			if (rules.audience && rules.audience.length > 0 && this._controller) {
				const matchesAnyAudience = rules.audience.some((audienceType) => {
					switch (audienceType) {
						case "all":
							return true

						case "team_admin_only":
							const isTeamAdmin = this.isUserTeamAdmin()
							return isTeamAdmin

						case "team_members":
							const hasOrganizations = this.hasOrganizations()
							return hasOrganizations

						case "personal_only":
							const hasOrgs = this.hasOrganizations()
							return !hasOrgs

						default:
							return false
					}
				})

				if (!matchesAnyAudience) {
					return false
				}
			}

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
	 * Checks if the banner is within its active date range
	 * @param banner Banner to check
	 * @returns true if current date is within activeFrom and activeTo range
	 */
	private isWithinActiveDateRange(banner: Banner): boolean {
		const now = new Date()

		if (banner.activeFrom) {
			const activeFrom = new Date(banner.activeFrom)
			if (now < activeFrom) {
				return false
			}
		}

		if (banner.activeTo) {
			const activeTo = new Date(banner.activeTo)
			if (now > activeTo) {
				return false
			}
		}

		return true
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
	 * Gets the current auth provider name
	 * @returns Auth provider name (firebase, workos, or unknown)
	 */
	private getAuthProvider(): string {
		try {
			// Get auth provider from AuthService
			const authService = this.getAuthServiceInstance()
			if (!authService) {
				return "unknown"
			}
			const authInfo = authService.getInfo()

			// Check if user is authenticated
			if (!authInfo.user) {
				return "other"
			}

			// Get provider name using public method
			const providerName = authService.getProviderName()
			if (providerName) {
				// Map provider names to expected values
				if (providerName === "cline") {
					return "workos"
				}
				return providerName
			}

			return "unknown"
		} catch (error) {
			Logger.error("BannerService: Error getting auth provider", error)
			return "unknown"
		}
	}

	/**
	 * Checks if the current user is a Cline employee
	 * @returns true if user has a @cline.bot email or is a trusted tester
	 */
	private isEmployee(): boolean {
		try {
			const authService = this.getAuthServiceInstance()
			if (!authService) {
				return false
			}
			const authInfo = authService.getInfo()

			if (!authInfo.user || !authInfo.user.email) {
				return false
			}

			return isClineInternalTester(authInfo.user.email)
		} catch (error) {
			Logger.error("BannerService: Error checking employee status", error)
			return false
		}
	}

	/**
	 * Checks if the current user is a team admin
	 * @returns true if user is an admin or owner of any organization
	 */
	private isUserTeamAdmin(): boolean {
		try {
			const authService = this.getAuthServiceInstance()
			if (!authService) {
				return false
			}
			const organizations = authService.getUserOrganizations()

			if (!organizations || organizations.length === 0) {
				return false
			}

			// Check if user has admin or owner role in any organization
			// Admin and owner roles have the same permissions
			return organizations.some((org: any) => org.roles && (org.roles.includes("admin") || org.roles.includes("owner")))
		} catch (error) {
			Logger.error("BannerService: Error checking team admin status", error)
			return false
		}
	}

	/**
	 * Checks if the current user is part of any organization
	 * @returns true if user has one or more organizations
	 */
	private hasOrganizations(): boolean {
		try {
			const authService = this.getAuthServiceInstance()
			if (!authService) {
				return false
			}
			const organizations = authService.getUserOrganizations()

			return !!(organizations && organizations.length > 0)
		} catch (error) {
			Logger.error("BannerService: Error checking organizations", error)
			return false
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
