import { describe, expect, it, vi } from "vitest"
import { SdkSessionRebuildScheduler } from "./sdk-session-rebuild-scheduler"

describe("SdkSessionRebuildScheduler", () => {
	it("drains a rebuild when the running session becomes idle", async () => {
		const activeSession = { isRunning: true }
		const scheduler = makeScheduler(activeSession)
		const rebuild = vi.fn().mockResolvedValue(undefined)

		scheduler.request("terminalExecutionMode", rebuild)
		expect(rebuild).not.toHaveBeenCalled()

		activeSession.isRunning = false
		scheduler.sessionBecameIdle()
		await scheduler.waitUntilSettled()

		expect(rebuild).toHaveBeenCalledOnce()
	})

	it("keeps settlement pending until a running session can drain queued rebuilds", async () => {
		const activeSession = { isRunning: true }
		const scheduler = makeScheduler(activeSession)
		const rebuild = vi.fn().mockResolvedValue(undefined)
		let settled = false

		scheduler.request("provider", rebuild)
		const settlement = scheduler.waitUntilSettled().then(() => {
			settled = true
		})
		await Promise.resolve()

		expect(settled).toBe(false)
		expect(rebuild).not.toHaveBeenCalled()

		activeSession.isRunning = false
		scheduler.sessionBecameIdle()
		await settlement

		expect(rebuild).toHaveBeenCalledOnce()
		expect(settled).toBe(true)
	})

	it("coalesces repeated requests for the same reason", async () => {
		const activeSession = { isRunning: true }
		const scheduler = makeScheduler(activeSession)
		const first = vi.fn().mockResolvedValue(undefined)
		const latest = vi.fn().mockResolvedValue(undefined)

		scheduler.request("provider", first)
		scheduler.request("provider", latest)
		activeSession.isRunning = false
		scheduler.sessionBecameIdle()
		await scheduler.waitUntilSettled()

		expect(first).not.toHaveBeenCalled()
		expect(latest).toHaveBeenCalledOnce()
	})

	it("discards pending work when settlement observes there is no active session", async () => {
		let activeSession: { isRunning: boolean } | undefined
		const scheduler = new SdkSessionRebuildScheduler({ sessions: { getActiveSession: () => activeSession as never } })
		const rebuild = vi.fn().mockResolvedValue(undefined)

		scheduler.request("provider", rebuild)
		await expect(scheduler.waitUntilSettled()).resolves.toBeUndefined()
		activeSession = { isRunning: false }
		scheduler.sessionBecameIdle()
		await scheduler.waitUntilSettled()

		expect(rebuild).not.toHaveBeenCalled()
	})

	it("settles a waiter when its pending rebuild is cancelled", async () => {
		const activeSession = { isRunning: true }
		const scheduler = makeScheduler(activeSession)
		const rebuild = vi.fn().mockResolvedValue(undefined)

		scheduler.request("provider", rebuild)
		const settlement = scheduler.waitUntilSettled()
		await Promise.resolve()
		scheduler.cancel("provider")

		await settlement
		expect(rebuild).not.toHaveBeenCalled()
	})

	it("settles and discards pending work when the active session disappears while waiting", async () => {
		let activeSession: { isRunning: boolean } | undefined = { isRunning: true }
		const scheduler = new SdkSessionRebuildScheduler({ sessions: { getActiveSession: () => activeSession as never } })
		const rebuild = vi.fn().mockResolvedValue(undefined)
		let settled = false

		scheduler.request("provider", rebuild)
		const settlement = scheduler.waitUntilSettled().then(() => {
			settled = true
		})
		await Promise.resolve()
		expect(settled).toBe(false)

		activeSession = undefined
		scheduler.activeSessionRemoved()
		await settlement

		expect(settled).toBe(true)
		expect(rebuild).not.toHaveBeenCalled()

		activeSession = { isRunning: false }
		scheduler.sessionBecameIdle()
		await scheduler.waitUntilSettled()
		expect(rebuild).not.toHaveBeenCalled()
	})

	it("serializes rebuilds for different reasons", async () => {
		const activeSession = { isRunning: false }
		const scheduler = makeScheduler(activeSession)
		let resolveFirst: () => void = () => {}
		const first = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveFirst = resolve
				}),
		)
		const second = vi.fn().mockResolvedValue(undefined)

		scheduler.request("mcpTools", first)
		scheduler.request("terminalExecutionMode", second)
		await vi.waitFor(() => expect(first).toHaveBeenCalledOnce())
		expect(second).not.toHaveBeenCalled()

		resolveFirst()
		await scheduler.waitUntilSettled()
		expect(second).toHaveBeenCalledOnce()
	})

	it("holds scheduled rebuilds behind an exclusive mode rebuild", async () => {
		const activeSession = { isRunning: false }
		const scheduler = makeScheduler(activeSession)
		let resolveMode: () => void = () => {}
		const modeRebuild = scheduler.runExclusive(
			() =>
				new Promise<void>((resolve) => {
					resolveMode = resolve
				}),
		)
		const passiveRebuild = vi.fn().mockResolvedValue(undefined)

		scheduler.request("provider", passiveRebuild)
		await Promise.resolve()
		expect(passiveRebuild).not.toHaveBeenCalled()

		resolveMode()
		await modeRebuild
		await scheduler.waitUntilSettled()
		expect(passiveRebuild).toHaveBeenCalledOnce()
	})
})

function makeScheduler(activeSession: { isRunning: boolean }) {
	return new SdkSessionRebuildScheduler({
		sessions: {
			getActiveSession: () =>
				activeSession as ReturnType<SdkSessionRebuildSchedulerOptions["sessions"]["getActiveSession"]>,
		},
	})
}

type SdkSessionRebuildSchedulerOptions = ConstructorParameters<typeof SdkSessionRebuildScheduler>[0]
