import { describe, expect, it, vi } from "vitest"
import { SdkSessionRebuildScheduler, type SessionRebuildContext } from "./sdk-session-rebuild-scheduler"

describe("SdkSessionRebuildScheduler", () => {
	it("drains a rebuild when the running session becomes idle", async () => {
		const activeSession = { isRunning: true }
		const scheduler = makeScheduler(activeSession)
		const rebuild = vi.fn().mockResolvedValue(undefined)

		scheduler.request("terminalExecutionMode", rebuild)
		await Promise.resolve()
		expect(rebuild).not.toHaveBeenCalled()

		activeSession.isRunning = false
		scheduler.sessionBecameIdle()
		await vi.waitFor(() => expect(rebuild).toHaveBeenCalledOnce())
	})

	it("waits for Core to drain queued prompts before rebuilding", async () => {
		const activeSession = { isRunning: false, queuedPromptCount: 1 }
		const scheduler = makeScheduler(activeSession)
		const rebuild = vi.fn().mockResolvedValue(undefined)

		scheduler.request("checkpoints", rebuild)
		await Promise.resolve()
		expect(rebuild).not.toHaveBeenCalled()

		activeSession.queuedPromptCount = 0
		scheduler.sessionBecameIdle()
		await vi.waitFor(() => expect(rebuild).toHaveBeenCalledOnce())
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

	it("keeps settlement responsive while Core has queued prompts", async () => {
		const activeSession = { isRunning: false, queuedPromptCount: 1 }
		const scheduler = makeScheduler(activeSession)
		const rebuild = vi.fn().mockResolvedValue(undefined)
		let settled = false
		scheduler.request("provider", rebuild)

		const settlement = scheduler.waitUntilSettled().then(() => {
			settled = true
		})
		// A queued prompt is busy even between turns; the barrier must yield
		// so Core can report that its queue has drained.
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(settled).toBe(false)
		expect(rebuild).not.toHaveBeenCalled()

		activeSession.queuedPromptCount = 0
		scheduler.sessionBecameIdle()
		await settlement
		expect(rebuild).toHaveBeenCalledOnce()
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
		await vi.waitFor(() => expect(latest).toHaveBeenCalledOnce())

		expect(first).not.toHaveBeenCalled()
	})

	it("supersedes a running rebuild when the same reason is requested again", async () => {
		const scheduler = makeScheduler({ isRunning: false })
		let resolveFirst: () => void = () => {}
		let firstContext: SessionRebuildContext | undefined
		const first = vi.fn(
			(context: SessionRebuildContext) =>
				new Promise<void>((resolve) => {
					firstContext = context
					resolveFirst = resolve
				}),
		)
		const second = vi.fn().mockResolvedValue(undefined)

		scheduler.request("checkpoints", first)
		await vi.waitFor(() => expect(firstContext).toBeDefined())
		expect(firstContext?.isCurrent()).toBe(true)

		scheduler.request("provider", vi.fn().mockResolvedValue(undefined))
		expect(firstContext?.isCurrent()).toBe(true)

		scheduler.request("checkpoints", second)
		expect(firstContext?.isCurrent()).toBe(false)
		expect(second).not.toHaveBeenCalled()

		resolveFirst()
		await vi.waitFor(() => expect(second).toHaveBeenCalledOnce())
		expect(first).toHaveBeenCalledOnce()
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
		await vi.waitFor(() => expect(second).toHaveBeenCalledOnce())
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
		await vi.waitFor(() => expect(passiveRebuild).toHaveBeenCalledOnce())
	})

	it("cancels dormant rebuilds before a task transition", async () => {
		const activeSession = { isRunning: true }
		const scheduler = makeScheduler(activeSession)
		const rebuild = vi.fn().mockResolvedValue(undefined)
		scheduler.request("provider", rebuild)

		await scheduler.runTaskTransition(async () => {
			activeSession.isRunning = false
		})
		scheduler.sessionBecameIdle()
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(rebuild).not.toHaveBeenCalled()
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
		await vi.waitFor(() => expect(rebuild).toHaveBeenCalledOnce())
	})
})

function makeScheduler(activeSession: { isRunning: boolean; queuedPromptCount?: number }) {
	activeSession.queuedPromptCount ??= 0
	return new SdkSessionRebuildScheduler({
		sessions: {
			getActiveSession: () =>
				activeSession as ReturnType<SdkSessionRebuildSchedulerOptions["sessions"]["getActiveSession"]>,
		},
	})
}

type SdkSessionRebuildSchedulerOptions = ConstructorParameters<typeof SdkSessionRebuildScheduler>[0]
