import { describe, expect, it, vi } from "vitest"
import { Logger } from "@/shared/services/Logger"
import { SdkForegroundCommandCoordinator } from "./sdk-foreground-command-coordinator"

describe("SdkForegroundCommandCoordinator", () => {
	it("reports isRunning while a handle is registered and notifies on changes", () => {
		const onRunningChanged = vi.fn()
		const coordinator = new SdkForegroundCommandCoordinator({ onRunningChanged })

		expect(coordinator.isRunning).toBe(false)

		const unregister = coordinator.register({ detach: () => {} })
		expect(coordinator.isRunning).toBe(true)
		expect(onRunningChanged).toHaveBeenCalledWith(true)

		unregister()
		expect(coordinator.isRunning).toBe(false)
		expect(onRunningChanged).toHaveBeenCalledWith(false)
	})

	it("only notifies on actual transitions, not per handle", () => {
		const onRunningChanged = vi.fn()
		const coordinator = new SdkForegroundCommandCoordinator({ onRunningChanged })

		const unregister1 = coordinator.register({ detach: () => {} })
		const unregister2 = coordinator.register({ detach: () => {} })
		expect(onRunningChanged).toHaveBeenCalledTimes(1)

		unregister1()
		expect(onRunningChanged).toHaveBeenCalledTimes(1)
		unregister2()
		expect(onRunningChanged).toHaveBeenCalledTimes(2)
	})

	it("unregister is idempotent", () => {
		const onRunningChanged = vi.fn()
		const coordinator = new SdkForegroundCommandCoordinator({ onRunningChanged })

		const unregister = coordinator.register({ detach: () => {} })
		unregister()
		unregister()
		expect(onRunningChanged).toHaveBeenCalledTimes(2)
	})

	it("proceedWhileRunning detaches every registered handle and reports the count", () => {
		const coordinator = new SdkForegroundCommandCoordinator()
		const detach1 = vi.fn()
		const detach2 = vi.fn()
		coordinator.register({ detach: detach1 })
		coordinator.register({ detach: detach2 })

		expect(coordinator.proceedWhileRunning()).toBe(2)
		expect(detach1).toHaveBeenCalledTimes(1)
		expect(detach2).toHaveBeenCalledTimes(1)
	})

	it("proceedWhileRunning is a no-op returning 0 when nothing is running", () => {
		const coordinator = new SdkForegroundCommandCoordinator()
		expect(coordinator.proceedWhileRunning()).toBe(0)
	})

	it("proceedWhileRunning survives a handle whose detach throws", () => {
		const coordinator = new SdkForegroundCommandCoordinator()
		const error = new Error("boom")
		const logError = vi.spyOn(Logger, "error")
		const detach2 = vi.fn()
		coordinator.register({
			detach: () => {
				throw error
			},
		})
		coordinator.register({ detach: detach2 })

		try {
			expect(coordinator.proceedWhileRunning()).toBe(2)
			expect(detach2).toHaveBeenCalledTimes(1)
			expect(logError).toHaveBeenCalledWith("[ForegroundCommands] Failed to detach foreground command:", error)
		} finally {
			logError.mockRestore()
		}
	})

	it("registers the same handle only once and either unregister removes it", () => {
		const onRunningChanged = vi.fn()
		const coordinator = new SdkForegroundCommandCoordinator({ onRunningChanged })
		const handle = { detach: vi.fn() }
		const unregister1 = coordinator.register(handle)
		const unregister2 = coordinator.register(handle)

		expect(coordinator.proceedWhileRunning()).toBe(1)
		expect(handle.detach).toHaveBeenCalledOnce()
		expect(coordinator.isRunning).toBe(true)
		expect(onRunningChanged.mock.calls).toEqual([[true]])

		unregister2()
		unregister1()
		expect(coordinator.isRunning).toBe(false)
		expect(coordinator.proceedWhileRunning()).toBe(0)
		expect(onRunningChanged.mock.calls).toEqual([[true], [false]])
	})

	it("keeps handles with the same detach callback distinct", () => {
		const coordinator = new SdkForegroundCommandCoordinator()
		const detach = vi.fn()
		const unregister1 = coordinator.register({ detach })
		const unregister2 = coordinator.register({ detach })

		expect(coordinator.proceedWhileRunning()).toBe(2)
		expect(detach).toHaveBeenCalledTimes(2)
		unregister1()
		expect(coordinator.isRunning).toBe(true)
		unregister2()
		expect(coordinator.isRunning).toBe(false)
	})

	it("unregisters by handle identity even after the handle is registered again", () => {
		const onRunningChanged = vi.fn()
		const coordinator = new SdkForegroundCommandCoordinator({ onRunningChanged })
		const handle = { detach: vi.fn() }
		const unregister1 = coordinator.register(handle)
		unregister1()
		const unregister2 = coordinator.register(handle)

		unregister1()
		expect(coordinator.isRunning).toBe(false)
		expect(coordinator.proceedWhileRunning()).toBe(0)
		expect(onRunningChanged.mock.calls).toEqual([[true], [false], [true], [false]])

		unregister2()
		expect(coordinator.isRunning).toBe(false)
		expect(coordinator.proceedWhileRunning()).toBe(0)
		expect(handle.detach).not.toHaveBeenCalled()
		expect(onRunningChanged.mock.calls).toEqual([[true], [false], [true], [false]])
	})

	it("detaches a snapshot even when a callback unregisters a peer and registers another handle", () => {
		const onRunningChanged = vi.fn()
		const coordinator = new SdkForegroundCommandCoordinator({ onRunningChanged })
		const lateHandle = { detach: vi.fn() }
		let unregisterPeer = () => {}
		coordinator.register({
			detach: () => {
				unregisterPeer()
				coordinator.register(lateHandle)
			},
		})
		const peer = { detach: vi.fn() }
		unregisterPeer = coordinator.register(peer)

		expect(coordinator.proceedWhileRunning()).toBe(2)
		expect(peer.detach).toHaveBeenCalledOnce()
		expect(lateHandle.detach).not.toHaveBeenCalled()
		expect(coordinator.isRunning).toBe(true)
		expect(onRunningChanged.mock.calls).toEqual([[true]])

		expect(coordinator.proceedWhileRunning()).toBe(2)
		expect(peer.detach).toHaveBeenCalledOnce()
		expect(lateHandle.detach).toHaveBeenCalledOnce()
	})

	it("counts the original snapshot when detaching unregisters every handle", () => {
		const onRunningChanged = vi.fn()
		const coordinator = new SdkForegroundCommandCoordinator({ onRunningChanged })
		let unregister1 = () => {}
		let unregister2 = () => {}
		const detach2 = vi.fn(() => unregister2())
		unregister1 = coordinator.register({ detach: () => unregister1() })
		unregister2 = coordinator.register({ detach: detach2 })

		expect(coordinator.proceedWhileRunning()).toBe(2)
		expect(detach2).toHaveBeenCalledOnce()
		expect(coordinator.isRunning).toBe(false)
		expect(coordinator.proceedWhileRunning()).toBe(0)
		expect(onRunningChanged.mock.calls).toEqual([[true], [false]])
	})
})
