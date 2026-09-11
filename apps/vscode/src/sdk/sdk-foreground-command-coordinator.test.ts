import { describe, expect, it, vi } from "vitest"
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
		const detach2 = vi.fn()
		coordinator.register({
			detach: () => {
				throw new Error("boom")
			},
		})
		coordinator.register({ detach: detach2 })

		expect(coordinator.proceedWhileRunning()).toBe(2)
		expect(detach2).toHaveBeenCalledTimes(1)
	})
})
