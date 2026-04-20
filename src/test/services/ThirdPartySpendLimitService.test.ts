import type { OverbudgetStatus } from "@shared/ClineAccount"
import * as assert from "assert"
import { afterEach, beforeEach, describe, it } from "mocha"
import sinon from "sinon"
import { ClineAccountService } from "@/services/account/ClineAccountService"
import { AuthService } from "@/services/auth/AuthService"
import { DEFAULT_SPEND_LIMIT_TTL_MS, ThirdPartySpendLimitService } from "@/services/spend-limit/ThirdPartySpendLimitService"

const SAMPLE_STATUS: OverbudgetStatus = {
	overbudget: true,
	limits: { monthlyLimitUsd: 500, dailyLimitUsd: 50, orgMonthlyUsd: 5000, source: "org_default" },
	usage: { monthlySpendUsd: 0, dailySpendUsd: 0 },
}

describe("ThirdPartySpendLimitService", () => {
	let sandbox: sinon.SinonSandbox
	let svc: ThirdPartySpendLimitService
	let fetchStub: sinon.SinonStub
	let getActiveOrgStub: sinon.SinonStub
	let fakeNow: number

	beforeEach(() => {
		sandbox = sinon.createSandbox()

		getActiveOrgStub = sandbox.stub().returns("org-123")
		sandbox.stub(AuthService, "getInstance").returns({ getActiveOrganizationId: getActiveOrgStub } as unknown as AuthService)

		fetchStub = sandbox.stub(ClineAccountService.prototype, "fetchOverbudgetStatusRPC")
		sandbox.stub(ClineAccountService, "getInstance").returns(new ClineAccountService())

		// Reset singleton between tests via the public invalidate hook.
		svc = ThirdPartySpendLimitService.getInstance()
		svc.invalidate()
		// Reset to the canonical default so each test starts from a known state.
		svc.setTtlMs(DEFAULT_SPEND_LIMIT_TTL_MS)

		// Controllable clock so we can exercise TTL behaviour deterministically.
		fakeNow = 1_000_000
		svc._setClockForTest(() => fakeNow)
	})

	afterEach(() => {
		sandbox.restore()
		svc.invalidate()
		svc.setTtlMs(DEFAULT_SPEND_LIMIT_TTL_MS)
		svc._setClockForTest(() => Date.now())
	})

	it("caches the status after the first fetch and does not re-fetch for the same org", async () => {
		fetchStub.resolves(SAMPLE_STATUS)

		await svc.fetchIfNeeded()
		await svc.fetchIfNeeded()
		await svc.fetchIfNeeded()

		assert.strictEqual(fetchStub.callCount, 1, "should fetch exactly once per org per session")
		assert.deepStrictEqual(svc.getStatus(), SAMPLE_STATUS)
		assert.strictEqual(svc.isOverbudget(), true)
	})

	it("de-dupes concurrent fetches", async () => {
		let resolveFetch: (value: OverbudgetStatus) => void = () => {}
		fetchStub.returns(
			new Promise<OverbudgetStatus>((resolve) => {
				resolveFetch = resolve
			}),
		)

		const [p1, p2, p3] = [svc.fetchIfNeeded(), svc.fetchIfNeeded(), svc.fetchIfNeeded()]
		resolveFetch(SAMPLE_STATUS)
		await Promise.all([p1, p2, p3])

		assert.strictEqual(fetchStub.callCount, 1, "concurrent calls must share a single in-flight fetch")
	})

	it("re-fetches when the active org changes", async () => {
		fetchStub.onFirstCall().resolves(SAMPLE_STATUS)
		fetchStub.onSecondCall().resolves({ ...SAMPLE_STATUS, overbudget: false })

		await svc.fetchIfNeeded()
		assert.strictEqual(svc.isOverbudget(), true)

		getActiveOrgStub.returns("org-456")
		await svc.fetchIfNeeded()

		assert.strictEqual(fetchStub.callCount, 2)
		assert.strictEqual(svc.isOverbudget(), false)
	})

	it("clears the cache when there is no active org", async () => {
		fetchStub.resolves(SAMPLE_STATUS)
		await svc.fetchIfNeeded()
		assert.ok(svc.getStatus())

		getActiveOrgStub.returns(null)
		await svc.fetchIfNeeded()

		assert.strictEqual(svc.getStatus(), null)
	})

	it("does not throw when the underlying fetch fails", async () => {
		fetchStub.rejects(new Error("boom"))

		await svc.fetchIfNeeded()

		assert.strictEqual(svc.getStatus(), null)
		assert.strictEqual(svc.isOverbudget(), false)
	})

	it("treats an undefined RPC response (feature not enabled) as not-overbudget", async () => {
		fetchStub.resolves(undefined)

		await svc.fetchIfNeeded()

		assert.strictEqual(svc.getStatus(), null)
		assert.strictEqual(svc.isOverbudget(), false)
	})

	describe("TTL behaviour", () => {
		it("does not refetch while the cached entry is still fresh", async () => {
			svc.setTtlMs(60_000) // 1 minute
			fetchStub.resolves(SAMPLE_STATUS)

			await svc.fetchIfNeeded()
			fakeNow += 30_000 // half the TTL
			await svc.fetchIfNeeded()

			assert.strictEqual(fetchStub.callCount, 1, "should be served from cache while fresh")
		})

		it("refetches once the TTL has elapsed for the same org", async () => {
			svc.setTtlMs(60_000)
			fetchStub.onFirstCall().resolves(SAMPLE_STATUS)
			fetchStub.onSecondCall().resolves({ ...SAMPLE_STATUS, overbudget: false })

			await svc.fetchIfNeeded()
			assert.strictEqual(svc.isOverbudget(), true)

			fakeNow += 60_001 // just past the TTL
			await svc.fetchIfNeeded()

			assert.strictEqual(fetchStub.callCount, 2, "should refetch after TTL expires")
			assert.strictEqual(svc.isOverbudget(), false)
		})

		it("honours a 1-minute TTL override via setTtlMs (experimentation knob)", async () => {
			svc.setTtlMs(60_000)
			assert.strictEqual(svc.getTtlMs(), 60_000)
			fetchStub.resolves(SAMPLE_STATUS)

			await svc.fetchIfNeeded()
			fakeNow += 59_999
			await svc.fetchIfNeeded()
			assert.strictEqual(fetchStub.callCount, 1, "still fresh at 59_999ms")

			fakeNow += 2
			await svc.fetchIfNeeded()
			assert.strictEqual(fetchStub.callCount, 2, "stale at 60_001ms")
		})

		it("ttlMs=0 disables caching entirely (every call refetches)", async () => {
			svc.setTtlMs(0)
			fetchStub.resolves(SAMPLE_STATUS)

			await svc.fetchIfNeeded()
			await svc.fetchIfNeeded()
			await svc.fetchIfNeeded()

			assert.strictEqual(fetchStub.callCount, 3)
		})

		it("defaults to DEFAULT_SPEND_LIMIT_TTL_MS (5 minutes)", () => {
			assert.strictEqual(svc.getTtlMs(), DEFAULT_SPEND_LIMIT_TTL_MS)
			assert.strictEqual(DEFAULT_SPEND_LIMIT_TTL_MS, 5 * 60 * 1000)
		})

		it("rejects negative or non-finite TTL values", () => {
			assert.throws(() => svc.setTtlMs(-1), /Invalid TTL/)
			assert.throws(() => svc.setTtlMs(Number.NaN), /Invalid TTL/)
			assert.throws(() => svc.setTtlMs(Number.POSITIVE_INFINITY), /Invalid TTL/)
		})
	})
})
