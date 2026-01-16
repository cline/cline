/**
 * Tests for task list command
 */

import { expect } from "chai"
import fs from "fs"
import os from "os"
import path from "path"
import sinon from "sinon"
import { createTaskListCommand } from "../../../../src/commands/task/list.js"
import type { OutputFormatter } from "../../../../src/core/output/types.js"
import { createTaskStorage } from "../../../../src/core/task-client.js"
import type { CliConfig } from "../../../../src/types/config.js"
import type { Logger } from "../../../../src/types/logger.js"

describe("task list command", () => {
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

	it("should create command with correct name and aliases", () => {
		const cmd = createTaskListCommand(config, logger, formatter)

		expect(cmd.name()).to.equal("list")
		expect(cmd.aliases()).to.include("l")
		expect(cmd.aliases()).to.include("ls")
	})

	it("should show message when no tasks exist", async () => {
		const cmd = createTaskListCommand(config, logger, formatter)

		await cmd.parseAsync(["node", "test"])

		expect((formatter.info as sinon.SinonStub).calledWith("No tasks found")).to.be.true
	})

	it("should list tasks with IDs and snippets", async () => {
		// Create some tasks first
		const storage = createTaskStorage(tempDir)
		storage.create({ prompt: "First task" })
		storage.create({ prompt: "Second task" })
		storage.create({ prompt: "Third task" })

		const cmd = createTaskListCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test"])

		// Should output header and rows
		expect((formatter.info as sinon.SinonStub).called).to.be.true
		expect((formatter.raw as sinon.SinonStub).called).to.be.true

		// Check that task info was output (header + separator + 3 rows + footer)
		const rawCalls = (formatter.raw as sinon.SinonStub).getCalls()
		expect(rawCalls.length).to.be.at.least(3)
	})

	it("should respect limit option", async () => {
		// Create multiple tasks
		const storage = createTaskStorage(tempDir)
		for (let i = 0; i < 5; i++) {
			storage.create({ prompt: `Task ${i + 1}` })
		}

		const cmd = createTaskListCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "-n", "2"])

		// Should only show 2 tasks
		const rawCalls = (formatter.raw as sinon.SinonStub).getCalls()
		// Header + separator + 2 rows + empty line
		const taskRows = rawCalls.filter((call) => {
			const text = call.args[0]
			return text.includes("Task") && !text.includes("History")
		})
		expect(taskRows.length).to.equal(2)
	})

	it("should show all tasks with --all flag", async () => {
		// Create multiple tasks
		const storage = createTaskStorage(tempDir)
		for (let i = 0; i < 25; i++) {
			storage.create({ prompt: `Task ${i + 1}` })
		}

		const cmd = createTaskListCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "--all"])

		// Should show all 25 tasks (default limit is 20)
		const rawCalls = (formatter.raw as sinon.SinonStub).getCalls()
		const taskRows = rawCalls.filter((call) => {
			const text = call.args[0]
			return text.includes("Task") && !text.includes("History")
		})
		expect(taskRows.length).to.equal(25)
	})

	it("should filter by status", async () => {
		// Create tasks with different statuses
		const storage = createTaskStorage(tempDir)
		const task1 = storage.create({ prompt: "Active task" })
		const task2 = storage.create({ prompt: "Paused task" })
		storage.updateStatus(task2.id, "paused")
		const task3 = storage.create({ prompt: "Completed task" })
		storage.updateStatus(task3.id, "completed")

		const cmd = createTaskListCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "--status", "paused"])

		// Should only show paused task
		const rawCalls = (formatter.raw as sinon.SinonStub).getCalls()
		const taskRows = rawCalls.filter((call) => {
			const text = call.args[0]
			return text.includes("paused") && text.includes("Paused task")
		})
		expect(taskRows.length).to.equal(1)
	})

	it("should output JSON when format is json", async () => {
		config.outputFormat = "json"

		const storage = createTaskStorage(tempDir)
		storage.create({ prompt: "JSON task" })

		const cmd = createTaskListCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test"])

		// Should output JSON array
		const rawCalls = (formatter.raw as sinon.SinonStub).getCalls()
		const jsonOutput = rawCalls.find((call) => {
			try {
				const parsed = JSON.parse(call.args[0])
				return Array.isArray(parsed)
			} catch {
				return false
			}
		})
		expect(jsonOutput).to.exist
	})

	it("should error on invalid status filter", async () => {
		const cmd = createTaskListCommand(config, logger, formatter)

		await cmd.parseAsync(["node", "test", "--status", "invalid"])

		expect((formatter.error as sinon.SinonStub).calledOnce).to.be.true
		expect((formatter.error as sinon.SinonStub).firstCall.args[0]).to.include("Invalid status")
		expect(exitStub.calledWith(1)).to.be.true
	})
})
