/**
 * Tests for task chat command
 */

import { expect } from "chai"
import fs from "fs"
import os from "os"
import path from "path"
import sinon from "sinon"
import { createTaskChatCommand } from "../../../../src/commands/task/chat.js"
import type { OutputFormatter } from "../../../../src/core/output/types.js"
import { createTaskStorage } from "../../../../src/core/task-client.js"
import type { CliConfig } from "../../../../src/types/config.js"
import type { Logger } from "../../../../src/types/logger.js"

describe("task chat command", () => {
	let tempDir: string
	let config: CliConfig
	let logger: Logger
	let formatter: OutputFormatter
	let exitStub: sinon.SinonStub

	beforeEach(() => {
		// Create temp directory
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-test-"))

		// Create mock config
		config = {
			verbose: false,
			configDir: tempDir,
			outputFormat: "plain",
		}

		// Create mock logger
		logger = {
			debug: sinon.stub(),
			info: sinon.stub(),
			warn: sinon.stub(),
			error: sinon.stub(),
		}

		// Create mock formatter
		formatter = {
			message: sinon.stub(),
			success: sinon.stub(),
			error: sinon.stub(),
			info: sinon.stub(),
			warn: sinon.stub(),
			table: sinon.stub(),
			list: sinon.stub(),
			tasks: sinon.stub(),
			keyValue: sinon.stub(),
			raw: sinon.stub(),
		}

		// Stub process.exit
		exitStub = sinon.stub(process, "exit")
	})

	afterEach(() => {
		// Restore stubs
		sinon.restore()
		// Clean up temp directory
		fs.rmSync(tempDir, { recursive: true, force: true })
	})

	it("should create command with correct name and alias", () => {
		const cmd = createTaskChatCommand(config, logger, formatter)

		expect(cmd.name()).to.equal("chat")
		expect(cmd.aliases()).to.include("c")
	})

	it("should error when no active task exists", async () => {
		const cmd = createTaskChatCommand(config, logger, formatter)

		// This will error before starting readline, so we can test it
		await cmd.parseAsync(["node", "test"])

		expect((formatter.error as sinon.SinonStub).calledOnce).to.be.true
		expect((formatter.error as sinon.SinonStub).firstCall.args[0]).to.include("No active task found")
		expect(exitStub.calledWith(1)).to.be.true
	})

	it("should error when task not found", async () => {
		const cmd = createTaskChatCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "nonexistent"])

		expect((formatter.error as sinon.SinonStub).calledOnce).to.be.true
		expect((formatter.error as sinon.SinonStub).firstCall.args[0]).to.include("Task not found")
		expect(exitStub.calledWith(1)).to.be.true
	})

	it("should error on invalid mode option", async () => {
		// Create a task
		const storage = createTaskStorage(tempDir)
		storage.create({ prompt: "Test task" })

		const cmd = createTaskChatCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "-m", "invalid"])

		expect((formatter.error as sinon.SinonStub).calledOnce).to.be.true
		expect((formatter.error as sinon.SinonStub).firstCall.args[0]).to.include("Invalid mode")
		expect(exitStub.calledWith(1)).to.be.true
	})

	// Note: Testing the interactive readline functionality is complex
	// These tests focus on the command setup and error cases
	// Full integration tests would use a mock stdin/stdout

	describe("command options", () => {
		it("should have -m/--mode option", () => {
			const cmd = createTaskChatCommand(config, logger, formatter)
			const modeOption = cmd.options.find((opt) => opt.short === "-m" || opt.long === "--mode")

			expect(modeOption).to.exist
		})
	})

	describe("task lookup", () => {
		it("should find task by partial ID", async () => {
			// Create a task
			const storage = createTaskStorage(tempDir)
			const task = storage.create({ prompt: "Test task" })

			// Use first 4 chars of ID
			const partialId = task.id.slice(0, 4)

			const cmd = createTaskChatCommand(config, logger, formatter)
			// This will start readline but we're just checking it doesn't error on task lookup
			// The error about no readline input is expected in test environment
			try {
				await cmd.parseAsync(["node", "test", partialId])
			} catch {
				// Readline errors are expected in test environment
			}

			// Should not have errored with "Task not found"
			const errorCalls = (formatter.error as sinon.SinonStub).getCalls()
			const taskNotFoundError = errorCalls.find((call) => call.args[0].includes("Task not found"))
			expect(taskNotFoundError).to.be.undefined
		})

		it("should use most recent active task when no ID provided", async () => {
			// Create multiple tasks
			const storage = createTaskStorage(tempDir)
			storage.create({ prompt: "Task 1" })
			storage.create({ prompt: "Task 2" })
			const task3 = storage.create({ prompt: "Task 3" }) // Most recent

			const cmd = createTaskChatCommand(config, logger, formatter)
			try {
				await cmd.parseAsync(["node", "test"])
			} catch {
				// Readline errors are expected in test environment
			}

			// Should not have errored
			const errorCalls = (formatter.error as sinon.SinonStub).getCalls()
			const noTaskError = errorCalls.find((call) => call.args[0].includes("No active task found"))
			expect(noTaskError).to.be.undefined

			// Check that the task ID displayed matches task3
			const infoCalls = (formatter.info as sinon.SinonStub).getCalls()
			const taskIdInfo = infoCalls.find((call) => call.args[0].includes(`Task: ${task3.id}`))
			expect(taskIdInfo).to.exist
		})
	})

	describe("mode switching", () => {
		it("should switch mode when --mode option provided", async () => {
			// Create a task in act mode
			const storage = createTaskStorage(tempDir)
			const task = storage.create({ prompt: "Test task", mode: "act" })
			expect(task.mode).to.equal("act")

			const cmd = createTaskChatCommand(config, logger, formatter)
			try {
				await cmd.parseAsync(["node", "test", "-m", "plan"])
			} catch {
				// Readline errors are expected
			}

			// Verify mode was changed
			const updatedTask = storage.get(task.id)
			expect(updatedTask?.mode).to.equal("plan")
		})
	})
})
