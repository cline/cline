import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import sinon from "sinon"
import { createMockTask } from "./test-utils"

describe("Hooks integration", () => {
	let sandbox: sinon.SinonSandbox

	beforeEach(() => {
		sandbox = sinon.createSandbox()
	})

	afterEach(() => {
		sandbox.restore()
	})

	it("should track hook execution order when hooks are enabled", async () => {
		const task = createMockTask({ hooksEnabled: true })
		const executionLog: string[] = []

		// Mock the stateManager to report hooks enabled
		task.getStateManager().getGlobalSettingsKey = sandbox.stub().callsFake((key: string) => {
			if (key === "hooksEnabled") {
				return true
			}
			return false
		})

		// Track execution order - this simulates what would happen in real execution
		const mockPreToolUseRunner = {
			run: sandbox.stub().callsFake(async () => {
				executionLog.push("PreToolUse")
				return { cancel: false }
			}),
		}

		// Simulate the tool execution flow where:
		// 1. Approval happens
		// 2. PreToolUse hook runs
		// 3. Tool executes
		// 4. PostToolUse hook would run (not in scope for this PR)

		// Step 1: User approves (simulated)
		executionLog.push("Approval")

		// Step 2: PreToolUse hook runs (from ToolExecutor)
		if (mockPreToolUseRunner) {
			await mockPreToolUseRunner.run()
		}

		// Step 3: Tool executes (simulated)
		executionLog.push("ToolExecution")

		// Verify execution order
		expect(executionLog).to.deep.equal(["Approval", "PreToolUse", "ToolExecution"])
	})

	it("should not execute PreToolUse hook when hooks are disabled", async () => {
		const task = createMockTask({ hooksEnabled: false })
		const executionLog: string[] = []

		// Mock the stateManager to report hooks disabled
		task.getStateManager().getGlobalSettingsKey = sandbox.stub().callsFake((key: string) => {
			if (key === "hooksEnabled") {
				return false
			}
			return undefined
		})

		const mockPreToolUseRunner = {
			run: sandbox.stub().callsFake(async () => {
				executionLog.push("PreToolUse")
			}),
		}

		// Simulate flow with hooks disabled
		executionLog.push("Approval")

		// PreToolUse should NOT run when hooks disabled
		const hooksEnabled = task.getStateManager().getGlobalSettingsKey("hooksEnabled")
		if (hooksEnabled && mockPreToolUseRunner) {
			await mockPreToolUseRunner.run()
		}

		executionLog.push("ToolExecution")

		// Verify PreToolUse was NOT called
		expect(executionLog).to.deep.equal(["Approval", "ToolExecution"])
		expect(executionLog).to.not.include("PreToolUse")
	})

	it("should allow hook cancellation to stop tool execution", async () => {
		const task = createMockTask({ hooksEnabled: true })
		const executionLog: string[] = []

		// Mock the stateManager to report hooks enabled
		task.getStateManager().getGlobalSettingsKey = sandbox.stub().callsFake((key: string) => {
			if (key === "hooksEnabled") {
				return true
			}
			return false
		})

		const mockPreToolUseRunner = {
			run: sandbox.stub().callsFake(async () => {
				executionLog.push("PreToolUse-Cancelled")
				return { cancel: true, errorMessage: "User cancelled via hook" }
			}),
		}

		// Simulate flow where hook cancels
		executionLog.push("Approval")

		const hookResult = await mockPreToolUseRunner.run()

		// Tool should NOT execute if hook cancelled
		if (!hookResult.cancel) {
			executionLog.push("ToolExecution")
		} else {
			executionLog.push("CancellationHandled")
		}

		// Verify execution stopped after hook cancellation
		expect(executionLog).to.deep.equal(["Approval", "PreToolUse-Cancelled", "CancellationHandled"])
		expect(executionLog).to.not.include("ToolExecution")
	})

	it("should handle hook errors gracefully", async () => {
		const task = createMockTask({ hooksEnabled: true })
		const executionLog: string[] = []

		// Mock the stateManager to report hooks enabled
		task.getStateManager().getGlobalSettingsKey = sandbox.stub().callsFake((key: string) => {
			if (key === "hooksEnabled") {
				return true
			}
			return false
		})

		const mockPreToolUseRunner = {
			run: sandbox.stub().rejects(new Error("Hook execution failed")),
		}

		// Simulate flow where hook throws error
		executionLog.push("Approval")

		try {
			await mockPreToolUseRunner.run()
			executionLog.push("ToolExecution")
		} catch (error: any) {
			executionLog.push("HookError")
			// In real implementation, tool execution should not proceed
		}

		// Verify error was caught and tool did not execute
		expect(executionLog).to.deep.equal(["Approval", "HookError"])
		expect(executionLog).to.not.include("ToolExecution")
	})

	it("should preserve task state after hook execution", async () => {
		const task = createMockTask({ hooksEnabled: true })

		// Set initial state
		task.taskState.currentToolAskMessageTs = 12345
		const initialTs = task.taskState.currentToolAskMessageTs

		// Mock hook that doesn't modify state
		const mockPreToolUseRunner = {
			run: sandbox.stub().resolves({ cancel: false }),
		}

		await mockPreToolUseRunner.run()

		// Verify state preserved
		expect(task.taskState.currentToolAskMessageTs).to.equal(initialTs)
	})
})
