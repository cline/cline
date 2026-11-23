import { describe, expect, it, vi } from "vitest"
import { RemoteConfigRefreshCoordinator } from "./remote-config-refresh-coordinator"

function deferred() {
	let resolve!: () => void
	const promise = new Promise<void>((resolvePromise) => {
		resolve = resolvePromise
	})
	return { promise, resolve }
}

describe("RemoteConfigRefreshCoordinator", () => {
	it("coalesces concurrent refreshes for the same identity", async () => {
		const pending = deferred()
		const performRefresh = vi.fn(() => pending.promise)
		const coordinator = new RemoteConfigRefreshCoordinator(performRefresh)

		const timerRefresh = coordinator.refresh("user:org")
		const manualRefresh = coordinator.refresh("user:org")

		expect(manualRefresh).toBe(timerRefresh)
		expect(performRefresh).toHaveBeenCalledOnce()
		pending.resolve()
		await timerRefresh
	})

	it("supersedes an older refresh when account identity changes", async () => {
		const checks: (() => boolean)[] = []
		const pending = [deferred(), deferred()]
		const performRefresh = vi.fn((isCurrent: () => boolean) => {
			checks.push(isCurrent)
			return pending[checks.length - 1].promise
		})
		const coordinator = new RemoteConfigRefreshCoordinator(performRefresh)

		const oldAccountRefresh = coordinator.refresh("user-a:org-a")
		const newAccountRefresh = coordinator.refresh("user-b:org-b")

		expect(performRefresh).toHaveBeenCalledTimes(2)
		expect(checks[0]()).toBe(false)
		expect(checks[1]()).toBe(true)
		pending[1].resolve()
		await newAccountRefresh
		pending[0].resolve()
		await oldAccountRefresh
	})

	it("starts a new refresh after the current one settles", async () => {
		const performRefresh = vi.fn().mockResolvedValue(undefined)
		const coordinator = new RemoteConfigRefreshCoordinator(performRefresh)

		await coordinator.refresh("user:org")
		await coordinator.refresh("user:org")

		expect(performRefresh).toHaveBeenCalledTimes(2)
	})

	it("forces a fresh run instead of coalescing when refresh inputs were mutated", async () => {
		const checks: (() => boolean)[] = []
		const pending = [deferred(), deferred()]
		const performRefresh = vi.fn((isCurrent: () => boolean) => {
			checks.push(isCurrent)
			return pending[checks.length - 1].promise
		})
		const coordinator = new RemoteConfigRefreshCoordinator(performRefresh)

		const staleRefresh = coordinator.refresh("user:org")
		const forcedRefresh = coordinator.refresh("user:org", { force: true })

		expect(forcedRefresh).not.toBe(staleRefresh)
		expect(performRefresh).toHaveBeenCalledTimes(2)
		expect(checks[0]()).toBe(false)
		expect(checks[1]()).toBe(true)
		pending[0].resolve()
		pending[1].resolve()
		await Promise.all([staleRefresh, forcedRefresh])
	})

	it("invalidate marks the in-flight refresh stale without starting a new one", async () => {
		const checks: (() => boolean)[] = []
		const pending = deferred()
		const performRefresh = vi.fn((isCurrent: () => boolean) => {
			checks.push(isCurrent)
			return pending.promise
		})
		const coordinator = new RemoteConfigRefreshCoordinator(performRefresh)

		const inFlight = coordinator.refresh("user:org")
		expect(checks[0]()).toBe(true)

		coordinator.invalidate()

		expect(checks[0]()).toBe(false)
		expect(performRefresh).toHaveBeenCalledTimes(1)
		pending.resolve()
		await inFlight
	})
})
