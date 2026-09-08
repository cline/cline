import { describe, expect, it, vi } from "vitest"
import { VscodeRunCommandExecutionController } from "./vscode-run-command-execution-controller"

describe("VscodeRunCommandExecutionController", () => {
	it("reports isRunning while a handle is registered and notifies on changes", () => {
		const onRunningChanged = vi.fn()
		const coordinator = new VscodeRunCommandExecutionController({ onRunningChanged })

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
		const coordinator = new VscodeRunCommandExecutionController({ onRunningChanged })

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
		const coordinator = new VscodeRunCommandExecutionController({ onRunningChanged })

		const unregister = coordinator.register({ detach: () => {} })
		unregister()
		unregister()
		expect(onRunningChanged).toHaveBeenCalledTimes(2)
	})

	it("proceedWhileRunning detaches every registered handle and reports the count", () => {
		const coordinator = new VscodeRunCommandExecutionController()
		const detach1 = vi.fn()
		const detach2 = vi.fn()
		coordinator.register({ detach: detach1 })
		coordinator.register({ detach: detach2 })

		expect(coordinator.proceedWhileRunning()).toBe(2)
		expect(detach1).toHaveBeenCalledWith("user")
		expect(detach2).toHaveBeenCalledWith("user")
	})

	it("proceedWhileRunning is a no-op returning 0 when nothing is running", () => {
		const coordinator = new VscodeRunCommandExecutionController()
		expect(coordinator.proceedWhileRunning()).toBe(0)
	})

	it("proceedWhileRunning survives a handle whose detach throws", () => {
		const coordinator = new VscodeRunCommandExecutionController()
		const detach2 = vi.fn()
		coordinator.register({
			detach: () => {
				throw new Error("boom")
			},
		})
		coordinator.register({ detach: detach2 })

		expect(coordinator.proceedWhileRunning()).toBe(1)
		expect(detach2).toHaveBeenCalledTimes(1)
	})
})
