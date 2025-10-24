import type { Banner, BannerRules, BannersResponse } from "@shared/ClineBanner"
import axios from "axios"
import { ClineEnv } from "@/config"
import type { Controller } from "@/core/controller"
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
	private _controller?: Controller

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
	 * Sets the controller instance for accessing state and services
	 */
	public setController(controller: Controller): void {
		this._controller = controller
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
			Logger.log(`BannerService: Error fetching banners: ${error instanceof Error ? error.message : String(error)}`)
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
			// The API response should already check this and only
			// return active time window banners, here is to ensure.
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

			// Check version rule
			if (rules.version) {
				const { version } = require("../../../package.json")
				if (rules.version.min && this.compareVersions(version, rules.version.min) < 0) {
					Logger.log(
						`BannerService: Banner ${banner.id} filtered out by version rule (requires >= ${rules.version.min}, current: ${version})`,
					)
					return false
				}
				if (rules.version.max && this.compareVersions(version, rules.version.max) > 0) {
					Logger.log(
						`BannerService: Banner ${banner.id} filtered out by version rule (requires <= ${rules.version.max}, current: ${version})`,
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

			// Check API providers rule
			if (rules.providers && rules.providers.length > 0 && this._controller) {
				const apiConfiguration = this._controller.stateManager.getApiConfiguration()
				const currentMode = this._controller.stateManager.getGlobalSettingsKey("mode") || "act"
				const currentProvider =
					currentMode === "plan" ? apiConfiguration?.planModeApiProvider : apiConfiguration?.actModeApiProvider
				if (currentProvider && !rules.providers.includes(currentProvider)) {
					Logger.log(
						`BannerService: Banner ${banner.id} filtered out by providers rule (requires: ${rules.providers.join(", ")}, current: ${currentProvider})`,
					)
					return false
				}
			}

			// Check audience segments
			if (rules.audience && this._controller) {
				// If audience.all is true, always show
				if (rules.audience.all) {
					Logger.log(`BannerService: Banner ${banner.id} targets all users`)
				}

				// Check if user has never used workspaces
				if (rules.audience.no_workspaces) {
					const taskHistory = this._controller.stateManager.getGlobalStateKey("taskHistory") || []
					const hasUsedWorkspaces = Array.isArray(taskHistory) && taskHistory.length > 0
					if (hasUsedWorkspaces) {
						Logger.log(`BannerService: Banner ${banner.id} filtered out - user has used workspaces`)
						return false
					}
				}

				// Check if user is a team admin
				if (rules.audience.team_admins) {
					const isTeamAdmin = this.isUserTeamAdmin()
					if (!isTeamAdmin) {
						Logger.log(`BannerService: Banner ${banner.id} filtered out - user is not a team admin`)
						return false
					}
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
	 * @returns IDE type (vscode, jetbrains, or unknown)
	 */
	private async getIdeType(): Promise<string> {
		try {
			const { HostProvider } = require("@/hosts/host-provider")
			const { EmptyRequest } = require("@shared/proto/cline/common")
			const hostVersion = await HostProvider.env.getHostVersion(EmptyRequest.create({}))

			// Map platform name to standard IDE identifiers
			const platform = hostVersion.platform?.toLowerCase() || ""

			if (platform.includes("code") || platform.includes("vscode")) {
				return "vscode"
			}
			if (
				platform.includes("jetbrains") ||
				platform.includes("intellij") ||
				platform.includes("pycharm") ||
				platform.includes("webstorm")
			) {
				return "jetbrains"
			}

			return "unknown"
		} catch (error) {
			Logger.log(`BannerService: Error getting IDE type: ${error instanceof Error ? error.message : String(error)}`)
			return "unknown"
		}
	}

	/**
	 * Gets the current auth provider name
	 * @returns Auth provider name (firebase, workos, or unknown)
	 */
	private getAuthProvider(): string {
		try {
			if (!this._controller) {
				return "unknown"
			}

			// Try to get auth provider from AuthService
			const { AuthService } = require("../auth/AuthService")
			const authService = AuthService.getInstance(this._controller)
			const authInfo = authService.getInfo()

			// Check if user is authenticated
			if (!authInfo.user) {
				return "unknown"
			}

			// Determine provider based on authentication state
			// The provider name is stored in the ClineAuthInfo
			const clineAuthInfo = (authService as any)._clineAuthInfo
			if (clineAuthInfo && clineAuthInfo.provider) {
				// Map provider names to expected values
				if (clineAuthInfo.provider === "cline") {
					return "workos"
				}
				return clineAuthInfo.provider
			}

			return "unknown"
		} catch (error) {
			Logger.log(`BannerService: Error getting auth provider: ${error instanceof Error ? error.message : String(error)}`)
			return "unknown"
		}
	}

	/**
	 * Checks if the current user is a team admin
	 * @returns true if user is an admin of any organization
	 */
	private isUserTeamAdmin(): boolean {
		try {
			if (!this._controller) {
				return false
			}

			const { AuthService } = require("../auth/AuthService")
			const authService = AuthService.getInstance(this._controller)
			const organizations = authService.getUserOrganizations()

			if (!organizations || organizations.length === 0) {
				return false
			}

			// Check if user has admin role in any organization
			return organizations.some((org: any) => org.roles && org.roles.includes("admin"))
		} catch (error) {
			Logger.log(
				`BannerService: Error checking team admin status: ${error instanceof Error ? error.message : String(error)}`,
			)
			return false
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
