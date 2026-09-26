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

	it("leaves pending work dormant when there is no active session", async () => {
		const scheduler = new SdkSessionRebuildScheduler({ sessions: { getActiveSession: () => undefined } })
		const rebuild = vi.fn().mockResolvedValue(undefined)

		scheduler.request("provider", rebuild)
		await Promise.resolve()

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

function makeScheduler(activeSession: { isRunning: boolean }) {
	return new SdkSessionRebuildScheduler({
		sessions: {
			getActiveSession: () =>
				activeSession as ReturnType<SdkSessionRebuildSchedulerOptions["sessions"]["getActiveSession"]>,
		},
	})
}

type SdkSessionRebuildSchedulerOptions = ConstructorParameters<typeof SdkSessionRebuildScheduler>[0]
