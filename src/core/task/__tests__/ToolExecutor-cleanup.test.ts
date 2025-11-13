import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import sinon from "sinon"
import { createMockToolExecutor, createMockToolUse } from "./test-utils"

describe("ToolExecutor state cleanup", () => {
	let sandbox: sinon.SinonSandbox

	beforeEach(() => {
		sandbox = sinon.createSandbox()
	})

	afterEach(() => {
		sandbox.restore()
	})

	it("should clean up preToolUseRunner in finally block on success", async () => {
		const executor = createMockToolExecutor()
		const config = executor.asToolConfig()
		const block = createMockToolUse("read_file", { path: "test.txt" })

		// Add a preToolUseRunner to the config
		config.preToolUseRunner = {
			run: sandbox.stub().resolves(),
		}

		// Mock coordinator to succeed
		config.coordinator.execute = sandbox.stub().resolves("Success")

		await executor.handleCompleteBlock(block, config)

		// Verify cleanup happened
		expect(config.preToolUseRunner).to.be.undefined
	})

	it("should clean up state even when tool execution fails", async () => {
		const executor = createMockToolExecutor()
		const config = executor.asToolConfig()
		const block = createMockToolUse("read_file", { path: "nonexistent.txt" })

		// Add a preToolUseRunner to the config
		config.preToolUseRunner = {
			run: sandbox.stub().resolves(),
		}

		// Mock tool to throw error
		config.coordinator.execute = sandbox.stub().rejects(new Error("File not found"))

		// Set current tool ask message ts
		executor.taskState.currentToolAskMessageTs = 12345

		try {
			await executor.handleCompleteBlock(block, config)
		} catch (e) {
			// Expected error
		}

		// Verify cleanup happened despite error
		expect(config.preToolUseRunner).to.be.undefined
		expect(executor.taskState.currentToolAskMessageTs).to.be.undefined
	})

	it("should clean up state when task is aborted during execution", async () => {
		const executor = createMockToolExecutor()
		const config = executor.asToolConfig()
		const block = createMockToolUse("execute_command", { command: "long_running_cmd" })

		// Add a preToolUseRunner to the config
		config.preToolUseRunner = {
			run: sandbox.stub().resolves(),
		}

		// Set current tool ask message ts
		executor.taskState.currentToolAskMessageTs = 12345

		// Mock coordinator to simulate abort
		config.coordinator.execute = sandbox.stub().callsFake(async () => {
			executor.taskState.abort = true
			return "Aborted"
		})

		await executor.handleCompleteBlock(block, config)

		// Verify cleanup happened
		expect(config.preToolUseRunner).to.be.undefined
		expect(executor.taskState.currentToolAskMessageTs).to.be.undefined
	})

	it("should clean up even if preToolUseRunner throws", async () => {
		const executor = createMockToolExecutor()
		const config = executor.asToolConfig()
		const block = createMockToolUse("read_file", { path: "test.txt" })

		// Add a preToolUseRunner that throws
		config.preToolUseRunner = {
			run: sandbox.stub().rejects(new Error("Hook failed")),
		}

		try {
			await executor.handleCompleteBlock(block, config)
		} catch (e) {
			// Expected error from hook
		}

		// Verify cleanup happened despite hook failure
		expect(config.preToolUseRunner).to.be.undefined
	})

	it("should handle case where preToolUseRunner is not set", async () => {
		const executor = createMockToolExecutor()
		const config = executor.asToolConfig()
		const block = createMockToolUse("read_file", { path: "test.txt" })

		// Don't set preToolUseRunner
		expect(config.preToolUseRunner).to.be.undefined

		// Mock coordinator to succeed
		config.coordinator.execute = sandbox.stub().resolves("Success")

		// Should not throw
		await executor.handleCompleteBlock(block, config)

		// Should still be undefined (no error)
		expect(config.preToolUseRunner).to.be.undefined
	})
})
