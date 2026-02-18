import type { Banner, BannerAction, BannerRules, BannersResponse } from "@shared/ClineBanner"
import { BannerActionType, type BannerCardData } from "@shared/cline/banner"
import { ClineEnv } from "@/config"
import { Controller } from "@/core/controller"
import { StateManager } from "@/core/storage/StateManager"
import { HostInfo, HostRegistryInfo } from "@/registry"
import { fetch } from "@/shared/net"
import { FeatureFlag } from "@/shared/services/feature-flags/feature-flags"
import { Logger } from "@/shared/services/Logger"
import { AuthService } from "../auth/AuthService"
import { buildBasicClineHeaders } from "../EnvUtils"
import { featureFlagsService } from "../feature-flags"

const CACHE_DURATION_MS = 24 * 60 * 60 * 1000 // 24 hours
const CIRCUIT_BREAKER_TIMEOUT_MS = 60 * 60 * 1000 // 1 hour
const SERVER_ERROR_BACKOFF_MS = 15 * 60 * 1000 // 15 minutes
const AUTH_DEBOUNCE_MS = 1000 // 1 second
const FETCH_TIMEOUT_MS = 10000 // 10 seconds
const MAX_CONSECUTIVE_FAILURES = 3

const OS_MAP: Record<string, string> = {
	win32: "windows",
	linux: "linux",
	darwin: "macos",
}

const IDE_MAP: Record<string, string> = {
	vscode: "vscode",
	jetbrains: "jetbrains",
	cli: "cli",
}

const PROVIDER_ALIASES: Record<string, string[]> = {
	anthropic: ["anthropic", "claude-code"],
	openai: ["openai", "openai-native"],
	qwen: ["qwen", "qwen-code"],
}

/**
 * Service for fetching and evaluating banner messages
 */
export class BannerService {
	private static instance: BannerService | null = null

	private cachedBanners: Banner[] = []
	private lastFetchTime = 0
	private backoffUntil = 0
	private consecutiveFailures = 0

	private userId: string | null = null

	private fetchPromise: Promise<Banner[]> | null = null
	private abortController: AbortController | null = null

	private debounceTimer: ReturnType<typeof setTimeout> | null = null
	private pendingDebounceResolve: (() => void) | null = null
	private authFetchPending = false

	private readonly validActionTypes: Set<string>

	private constructor(
		private readonly controller: Controller,
		private readonly hostInfo: HostInfo,
	) {
		this.validActionTypes = new Set(Object.values(BannerActionType))
		Logger.log("[BannerService] initialized")
	}

	public static initialize(controller: Controller): BannerService {
		if (BannerService.instance) {
			return BannerService.instance
		}
		const hostInfo = HostRegistryInfo.get()
		if (!hostInfo) {
			throw new Error("[BannerService] Ensure HostRegistryInfo is initialized before BannerService.")
		}
		BannerService.instance = new BannerService(controller, hostInfo)
		return BannerService.instance
	}

	public static get(): BannerService {
		if (!BannerService.instance) {
			throw new Error("BannerService not initialized. Call BannerService.initialize(controller) first.")
		}
		return BannerService.instance
	}

	public static reset(): void {
		const instance = BannerService.instance
		if (instance) {
			if (instance.debounceTimer) clearTimeout(instance.debounceTimer)
			instance.abortController?.abort()
		}
		BannerService.instance = null
	}

	public static async onAuthUpdate(userId: string | null): Promise<void> {
		const instance = BannerService.instance

		if (!instance || instance.userId === userId) return

		// Clear existing debounce timer and resolve any pending promise
		if (instance.debounceTimer) {
			clearTimeout(instance.debounceTimer)
			instance.debounceTimer = null
		}
		if (instance.pendingDebounceResolve) {
			instance.pendingDebounceResolve()
			instance.pendingDebounceResolve = null
		}

		// Cancel any in-progress fetch immediately - we'll fetch with the new token after debounce
		instance.abortController?.abort()
		instance.abortController = null
		instance.fetchPromise = null

		// Set pending flag immediately to prevent getActiveBanners() from starting a fetch
		// while we're waiting for the debounce to settle
		instance.authFetchPending = true
		instance.userId = userId

		return new Promise<void>((resolve) => {
			instance.pendingDebounceResolve = resolve
			instance.debounceTimer = setTimeout(async () => {
				instance.debounceTimer = null
				instance.pendingDebounceResolve = null

				instance.consecutiveFailures = 0
				instance.backoffUntil = 0

				try {
					await instance.doFetch()
					Logger.info("[BannerService] Fetched")
				} finally {
					instance.authFetchPending = false
					resolve()
				}
			}, AUTH_DEBOUNCE_MS)
		})
	}

	public getActiveBanners(): BannerCardData[] {
		this.ensureFreshCache()

		const activeBanners = this.cachedBanners
			.filter((b) => b.placement !== "welcome")
			.filter((b) => !this.isBannerDismissed(b.id))
			.map((b) => this.toBannerCardData(b))
			.filter((b): b is BannerCardData => b !== null)

		return activeBanners
	}

	/**
	 * Returns welcome banners (placement === "welcome") for the What's New modal.
	 * These are version-targeted banners fetched from the backend.
	 * Gated by REMOTE_WELCOME_BANNERS feature flag — when off, returns empty
	 * so the webview falls back to hardcoded welcome items.
	 */
	public getWelcomeBanners(): BannerCardData[] | undefined {
		const isLocal = process.env.IS_DEV === "true" || process.env.CLINE_ENVIRONMENT === "local"
		const flagEnabled = isLocal || featureFlagsService.getBooleanFlagEnabled(FeatureFlag.REMOTE_WELCOME_BANNERS)

		if (!flagEnabled) {
			return undefined
		}
		const bypassDismissals = process.env.IS_DEV === "true" || process.env.CLINE_ENVIRONMENT === "local"

		this.ensureFreshCache()

		const welcomeCandidates = this.cachedBanners.filter((b) => b.placement === "welcome")

		const welcomeBanners = welcomeCandidates
			.filter((b) => bypassDismissals || !this.isBannerDismissed(b.id))
			.map((b) => this.toBannerCardData(b))
			.filter((b): b is BannerCardData => b !== null)

		return welcomeBanners
	}

	private ensureFreshCache(): void {
		const now = Date.now()
		const shouldFetch =
			now >= this.backoffUntil &&
			now - this.lastFetchTime >= CACHE_DURATION_MS &&
			!this.fetchPromise &&
			!this.authFetchPending

		if (shouldFetch) {
			this.fetchPromise = this.doFetch()
			this.fetchPromise.finally(() => {
				this.fetchPromise = null
			})
		}
	}

	public clearCache(): void {
		this.abortController?.abort()
		this.abortController = null
		this.cachedBanners = []
		this.lastFetchTime = 0
		this.consecutiveFailures = 0
		this.backoffUntil = 0
		this.fetchPromise = null
		Logger.log("BannerService: Cache cleared and circuit breaker reset")
	}

	public async dismissBanner(bannerId: string): Promise<void> {
		try {
			const dismissed = StateManager.get().getGlobalStateKey("dismissedBanners") || []
			if (dismissed.some((b) => b.bannerId === bannerId)) return

			StateManager.get().setGlobalState("dismissedBanners", [...dismissed, { bannerId, dismissedAt: Date.now() }])

			await this.sendBannerEvent(bannerId, "dismiss")
			this.clearCache()
		} catch (error) {
			Logger.error("[BannerService] Error dismissing banner", error)
		}
	}

	public async sendBannerEvent(bannerId: string, eventType: "dismiss"): Promise<void> {
		try {
			const url = new URL("/banners/v2/messages", ClineEnv.config().apiBaseUrl).toString()
			const ideType = this.getIdeType()
			const surface = ideType === "cli" ? "cli" : ideType === "jetbrains" ? "jetbrains" : "vscode"

			const controller = new AbortController()
			const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

			await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...(await buildBasicClineHeaders()),
				},
				body: JSON.stringify({
					banner_id: bannerId,
					instance_id: this.hostInfo.distinctId,
					surface,
					event_type: eventType,
				}),
				signal: controller.signal,
			})

			clearTimeout(timeoutId)
			Logger.log(`[BannerService] Sent ${eventType} event for banner ${bannerId}`)
		} catch (error) {
			Logger.error("[BannerService] Error sending banner event", error)
		}
	}

	public isBannerDismissed(bannerId: string): boolean {
		try {
			const dismissed = StateManager.get().getGlobalStateKey("dismissedBanners") || []
			return dismissed.some((b) => b.bannerId === bannerId)
		} catch (error) {
			Logger.error("[BannerService] Error checking dismissed banner", error)
			return false
		}
	}

	private async doFetch(): Promise<Banner[]> {
		// Do not fetch banners when feature flag is off
		if (!featureFlagsService.getBooleanFlagEnabled(FeatureFlag.REMOTE_BANNERS)) {
			return []
		}

		this.abortController = new AbortController()
		const { signal } = this.abortController
		const timeoutId = setTimeout(() => this.abortController?.abort(), FETCH_TIMEOUT_MS)

		try {
			const url = this.buildFetchUrl()
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
				...(await buildBasicClineHeaders()),
			}
			const authToken = await AuthService.getInstance().getAuthToken()
			if (authToken) {
				headers.Authorization = `Bearer ${authToken}`
			}

			const response = await fetch(url, { method: "GET", headers, signal })
			clearTimeout(timeoutId)

			if (!response.ok) {
				throw Object.assign(new Error(`HTTP ${response.status}`), {
					status: response.status,
					headers: response.headers,
				})
			}

			const data = (await response.json()) as BannersResponse
			if (!data?.data?.items || !Array.isArray(data.data.items)) {
				Logger.log("BannerService: Invalid response format")
				return []
			}

			Logger.log(
				`[BannerService] Raw API response: ${data.data.items.length} items: ${JSON.stringify(
					data.data.items.map((b) => ({ id: b.id, placement: b.placement, titleMd: b.titleMd?.substring(0, 50) })),
				)}`,
			)

			const banners = data.data.items.filter((b) => this.matchesProviderRule(b))
			this.cachedBanners = banners
			this.lastFetchTime = Date.now()
			this.consecutiveFailures = 0

			Logger.log(
				`[BannerService] After provider filter: ${banners.length} banners: ${JSON.stringify(
					banners.map((b) => ({ id: b.id, placement: b.placement })),
				)}`,
			)

			this.controller.postStateToWebview().catch((error) => {
				Logger.error("Failed to post state to webview after fetching banners:", error)
			})

			Logger.log(`[BannerService] Fetched ${banners.length} banner(s) at ${new Date(this.lastFetchTime).toISOString()}`)
			return banners
		} catch (error) {
			clearTimeout(timeoutId)

			if (error instanceof Error && error.name === "AbortError") {
				return this.cachedBanners
			}

			this.handleFetchError(error)
			return this.cachedBanners
		} finally {
			this.abortController = null
		}
	}

	private handleFetchError(error: unknown): void {
		this.consecutiveFailures++

		const typedError = error as { status?: number; headers?: { get(name: string): string | null } }
		const status = typedError.status

		let backoffMs = CIRCUIT_BREAKER_TIMEOUT_MS

		if (status === 429) {
			const retryAfter = typedError.headers?.get("retry-after")
			if (retryAfter) {
				const seconds = Number.parseInt(retryAfter, 10)
				if (!Number.isNaN(seconds)) {
					backoffMs = seconds * 1000
				} else {
					const date = new Date(retryAfter)
					if (!Number.isNaN(date.getTime())) {
						backoffMs = Math.max(0, date.getTime() - Date.now())
					}
				}
			}
		} else if (status && status >= 500 && status < 600) {
			backoffMs = SERVER_ERROR_BACKOFF_MS
		}

		this.backoffUntil = Date.now() + backoffMs

		if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
			this.backoffUntil = Date.now() + CIRCUIT_BREAKER_TIMEOUT_MS
			const msg =
				this.consecutiveFailures === MAX_CONSECUTIVE_FAILURES ? "Circuit breaker tripped" : "Half-open recovery failed"
			Logger.log(`BannerService: ${msg}, will allow recovery attempt after 1 hour`)
		}

		Logger.error(
			`[BannerService] Failed ${this.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}. ` +
				`Backing off for ${Math.ceil(backoffMs / 60000)} minutes`,
			error,
		)
	}

	private buildFetchUrl(): string {
		const url = new URL("/banners/v2/messages", ClineEnv.config().apiBaseUrl)
		url.searchParams.set("ide", this.getIdeType())
		url.searchParams.set("extension_version", this.hostInfo.extensionVersion)
		url.searchParams.set("os", OS_MAP[this.hostInfo.os] || "unknown")
		return url.toString()
	}

	private getIdeType(): string {
		const ide = this.hostInfo.ide?.toLowerCase() ?? ""
		for (const [key, value] of Object.entries(IDE_MAP)) {
			if (ide.includes(key)) return value
		}

		const platform = this.hostInfo.platform?.toLowerCase() ?? ""
		if (platform.includes("visual studio") || platform.includes("vscode")) {
			return "vscode"
		}
		return "unknown"
	}

	private matchesProviderRule(banner: Banner): boolean {
		try {
			const rules: BannerRules = JSON.parse(banner.rulesJson || "{}")
			if (!rules?.providers?.length) return true

			const config = StateManager.get().getApiConfiguration()
			const mode = StateManager.get().getGlobalSettingsKey("mode")
			const provider = mode === "plan" ? config?.planModeApiProvider : config?.actModeApiProvider

			return rules.providers.some((ruleProvider) => {
				// Check if ruleProvider is an alias for the selected provider
				for (const [_, aliases] of Object.entries(PROVIDER_ALIASES)) {
					if (aliases.includes(ruleProvider)) {
						return aliases.includes(provider as string)
					}
				}
				return provider === ruleProvider
			})
		} catch (error) {
			Logger.log(
				`[BannerService] Error parsing provider rules for banner ${banner.id}: ` +
					`${error instanceof Error ? error.message : String(error)}`,
			)
			return true // Fail open
		}
	}

	private getBannerActions(banner: Banner): BannerAction[] {
		return banner.actions ?? []
	}

	private toBannerCardData(banner: Banner): BannerCardData | null {
		const actions = this.getBannerActions(banner)

		// Validate all actions have valid types
		for (const action of actions) {
			if (!action.action || !this.validActionTypes.has(action.action) || !action.title) {
				Logger.error(`[BannerService] Invalid action type (${action.action}) for banner ${banner.id}`)
				return null
			}
		}

		return {
			id: banner.id,
			title: banner.titleMd,
			description: banner.bodyMd,
			icon: banner.icon,
			actions: actions.map((a) => ({
				title: a.title || "",
				action: a.action as BannerActionType,
				arg: a.arg,
			})),
		}
	}
}
