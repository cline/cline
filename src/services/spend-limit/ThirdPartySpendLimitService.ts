import type { OverbudgetStatus } from "@shared/ClineAccount"
import { Logger } from "@/shared/services/Logger"
import { ClineAccountService } from "../account/ClineAccountService"
import { AuthService } from "../auth/AuthService"

/**
 * Default TTL (5 minutes) before a cached status is considered stale and
 * refreshed on the next `fetchIfNeeded()` call.
 */
export const DEFAULT_SPEND_LIMIT_TTL_MS = 5 * 60 * 1000

/**
 * Read a TTL override from the environment. Supports either a raw ms value
 * (e.g. "60000") or a humanised shorthand (e.g. "5m", "30s", "1m").
 * Returns `undefined` when the override is missing/invalid so the caller can
 * fall back to the default.
 */
function resolveTtlFromEnv(): number | undefined {
	const raw = process.env.CLINE_SPEND_LIMIT_TTL_MS?.trim()
	if (!raw) {
		return undefined
	}
	const shorthand = raw.match(/^(\d+)\s*(ms|s|m)?$/i)
	if (!shorthand) {
		return undefined
	}
	const value = Number(shorthand[1])
	if (!Number.isFinite(value) || value < 0) {
		return undefined
	}
	const unit = (shorthand[2] ?? "ms").toLowerCase()
	switch (unit) {
		case "s":
			return value * 1000
		case "m":
			return value * 60 * 1000
		default:
			return value
	}
}

/**
 * Caches the active org's third-party spend-limit status so Task can check it
 * before dispatching non-Cline provider requests (Anthropic, OpenAI, etc.).
 * The Cline provider is enforced server-side and is not checked here.
 *
 * The cache is a single slot keyed by the active org ID with a configurable
 * TTL. Switching orgs always overwrites the slot; within the same org the
 * status is refreshed on the next call after the TTL elapses.
 */
export class ThirdPartySpendLimitService {
	private static instance: ThirdPartySpendLimitService

	private cachedStatus: OverbudgetStatus | null = null
	private cachedOrgId: string | null = null
	private cachedAt = 0
	private fetchPromise: Promise<void> | null = null
	private ttlMs: number = resolveTtlFromEnv() ?? DEFAULT_SPEND_LIMIT_TTL_MS
	// Injection seam for tests; defaults to real wall clock.
	private now: () => number = () => Date.now()

	private constructor() {}

	public static getInstance(): ThirdPartySpendLimitService {
		if (!ThirdPartySpendLimitService.instance) {
			ThirdPartySpendLimitService.instance = new ThirdPartySpendLimitService()
		}
		return ThirdPartySpendLimitService.instance
	}

	/**
	 * Dynamically set the TTL (in ms). Useful for experimenting with shorter
	 * windows (e.g. 1 minute) without redeploying. Setting 0 disables caching
	 * entirely and forces every call to refetch.
	 */
	setTtlMs(ttlMs: number): void {
		if (!Number.isFinite(ttlMs) || ttlMs < 0) {
			throw new Error(`Invalid TTL: ${ttlMs}`)
		}
		this.ttlMs = ttlMs
	}

	/** Current TTL in ms. Exposed for diagnostics + tests. */
	getTtlMs(): number {
		return this.ttlMs
	}

	/**
	 * Ensures the cache reflects the currently active org. Safe to call from
	 * hot paths; a no-op while the cached entry is fresh. Never throws —
	 * failures resolve to a null cache so they cannot block task execution.
	 */
	async fetchIfNeeded(): Promise<void> {
		const activeOrgId = this.getActiveOrgId()

		if (!activeOrgId) {
			this.cachedStatus = null
			this.cachedOrgId = null
			this.cachedAt = 0
			return
		}

		const cacheHit = this.cachedOrgId === activeOrgId && !this.isStale()
		if (cacheHit) {
			return
		}

		if (this.fetchPromise) {
			await this.fetchPromise
			if (this.cachedOrgId === activeOrgId && !this.isStale()) {
				return
			}
		}

		this.fetchPromise = this.doFetch(activeOrgId).finally(() => {
			this.fetchPromise = null
		})
		return this.fetchPromise
	}

	private isStale(): boolean {
		if (this.ttlMs === 0) {
			return true
		}
		return this.now() - this.cachedAt >= this.ttlMs
	}

	private async doFetch(organizationId: string): Promise<void> {
		try {
			const status = await ClineAccountService.getInstance().fetchOverbudgetStatusRPC(organizationId)
			this.cachedStatus = status ?? null
			this.cachedOrgId = organizationId
			this.cachedAt = this.now()
		} catch (err) {
			// Double-guard: fetchOverbudgetStatusRPC already swallows errors, but
			// callers rely on this method never throwing.
			Logger.error("Unexpected error fetching overbudget status:", err)
			this.cachedStatus = null
			this.cachedOrgId = organizationId
			this.cachedAt = this.now()
		}
	}

	/** Current cached status, or null if unavailable / feature not enabled. */
	getStatus(): OverbudgetStatus | null {
		return this.cachedStatus
	}

	/** Quick check for blocking decisions. */
	isOverbudget(): boolean {
		return this.cachedStatus?.overbudget === true
	}

	/** Clears the cache. Used on logout, active-org change, and in tests. */
	invalidate(): void {
		this.cachedStatus = null
		this.cachedOrgId = null
		this.cachedAt = 0
		this.fetchPromise = null
	}

	/**
	 * Test-only seam: override the clock used to evaluate freshness.
	 * Not exported from the public surface beyond tests.
	 */
	_setClockForTest(now: () => number): void {
		this.now = now
	}

	private getActiveOrgId(): string | null {
		try {
			return AuthService.getInstance().getActiveOrganizationId()
		} catch {
			return null
		}
	}
}
