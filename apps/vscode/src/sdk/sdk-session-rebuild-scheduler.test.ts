import { describe, expect, it, vi } from "vitest"
import { SdkSessionRebuildScheduler } from "./sdk-session-rebuild-scheduler"

describe("SdkSessionRebuildScheduler", () => {
	it("drains a rebuild when the running session becomes idle", async () => {
		const activeSession = { isRunning: true }
		const scheduler = makeScheduler(activeSession)
		const rebuild = vi.fn().mockResolvedValue(undefined)

		scheduler.request("terminalExecutionMode", rebuild)
		expect(scheduler.hasPendingRebuild()).toBe(true)
		expect(rebuild).not.toHaveBeenCalled()
		let settled = false
		const wait = scheduler.waitUntilSettled().then(() => {
			settled = true
		})
		await Promise.resolve()
		expect(settled).toBe(false)

		activeSession.isRunning = false
		scheduler.sessionBecameIdle()
		await scheduler.waitUntilSettled()
		await wait

		expect(rebuild).toHaveBeenCalledOnce()
		expect(scheduler.hasPendingRebuild()).toBe(false)
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

	it("leaves pending work dormant when there is no active session", async () => {
		const scheduler = new SdkSessionRebuildScheduler({ sessions: { getActiveSession: () => undefined } })
		const rebuild = vi.fn().mockResolvedValue(undefined)

		scheduler.request("provider", rebuild)
		await Promise.resolve()

		expect(rebuild).not.toHaveBeenCalled()
	})

	it("releases waiters when pending rebuilds are cancelled", async () => {
		const activeSession = { isRunning: true }
		const scheduler = makeScheduler(activeSession)
		const rebuild = vi.fn().mockResolvedValue(undefined)
		scheduler.request("checkpoints", rebuild)
		const settled = scheduler.waitUntilSettled()

		scheduler.cancel("checkpoints")
		await settled

		expect(rebuild).not.toHaveBeenCalled()
		expect(scheduler.hasPendingRebuild()).toBe(false)
	})

	it("releases waiters after an exclusive operation settles", async () => {
		const scheduler = makeScheduler({ isRunning: false })
		let resolveExclusive: () => void = () => {}
		const exclusive = scheduler.runExclusive(
			() =>
				new Promise<void>((resolve) => {
					resolveExclusive = resolve
				}),
		)
		const settled = scheduler.waitUntilSettled()

		resolveExclusive()
		await exclusive
		await settled

		expect(scheduler.hasPendingRebuild()).toBe(false)
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

	it("cancels dormant rebuilds before a task transition", async () => {
		const activeSession = { isRunning: true }
		const scheduler = makeScheduler(activeSession)
		const rebuild = vi.fn().mockResolvedValue(undefined)
		const onCancel = vi.fn()
		scheduler.request("provider", rebuild, onCancel)
		const settled = scheduler.waitUntilSettled()

		await scheduler.runTaskTransition(async () => {
			activeSession.isRunning = false
		})
		await settled

		expect(onCancel).toHaveBeenCalledOnce()
		expect(rebuild).not.toHaveBeenCalled()
		expect(scheduler.hasPendingRebuild()).toBe(false)
	})

	it("runs rebuilds requested during a task transition after it completes", async () => {
		const scheduler = makeScheduler({ isRunning: false })
		const rebuild = vi.fn().mockResolvedValue(undefined)
		let resolveTransition: () => void = () => {}
		const transition = scheduler.runTaskTransition(
			() =>
				new Promise<void>((resolve) => {
					resolveTransition = resolve
				}),
		)

		scheduler.request("mcpTools", rebuild)
		await Promise.resolve()
		expect(rebuild).not.toHaveBeenCalled()

		resolveTransition()
		await transition
		await scheduler.waitUntilSettled()
		expect(rebuild).toHaveBeenCalledOnce()
	})

	it("cleans up a coalesced request before storing its replacement", () => {
		const scheduler = makeScheduler({ isRunning: true })
		const firstCancel = vi.fn()

		scheduler.request("checkpoints", vi.fn().mockResolvedValue(undefined), firstCancel)
		scheduler.request("checkpoints", vi.fn().mockResolvedValue(undefined))

		expect(firstCancel).toHaveBeenCalledOnce()
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
