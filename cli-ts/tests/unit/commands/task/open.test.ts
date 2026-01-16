/**
 * Tests for task open command
 */

import { expect } from "chai"
import fs from "fs"
import os from "os"
import path from "path"
import sinon from "sinon"
import { createTaskOpenCommand } from "../../../../src/commands/task/open.js"
import type { OutputFormatter } from "../../../../src/core/output/types.js"
import { createTaskStorage } from "../../../../src/core/task-client.js"
import type { CliConfig } from "../../../../src/types/config.js"
import type { Logger } from "../../../../src/types/logger.js"

describe("task open command", () => {
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
		const cmd = createTaskOpenCommand(config, logger, formatter)

		expect(cmd.name()).to.equal("open")
		expect(cmd.aliases()).to.include("o")
	})

	it("should open task by full ID", async () => {
		// Create a task first
		const storage = createTaskStorage(tempDir)
		const task = storage.create({ prompt: "Test task to open" })

		const cmd = createTaskOpenCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", task.id])

		expect((formatter.success as sinon.SinonStub).calledOnce).to.be.true
		expect((formatter.success as sinon.SinonStub).firstCall.args[0]).to.include(task.id)
	})

	it("should open task by partial ID", async () => {
		// Create a task first
		const storage = createTaskStorage(tempDir)
		const task = storage.create({ prompt: "Partial ID test" })
		const partialId = task.id.slice(0, 6)

		const cmd = createTaskOpenCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", partialId])

		expect((formatter.success as sinon.SinonStub).calledOnce).to.be.true
	})

	it("should error on non-existent task", async () => {
		const cmd = createTaskOpenCommand(config, logger, formatter)

		await cmd.parseAsync(["node", "test", "nonexistent123"])

		expect((formatter.error as sinon.SinonStub).called).to.be.true
		expect((formatter.error as sinon.SinonStub).firstCall.args[0]).to.include("Task not found")
	})

	it("should display task information", async () => {
		// Create a task
		const storage = createTaskStorage(tempDir)
		const task = storage.create({
			prompt: "Task with info",
			mode: "plan",
			settings: { key1: "value1" },
		})

		const cmd = createTaskOpenCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", task.id])

		// Verify info output
		const infoCalls = (formatter.info as sinon.SinonStub).getCalls()
		const infoTexts = infoCalls.map((c) => c.args[0]).join(" ")

		expect(infoTexts).to.include("Task with info")
		expect(infoTexts).to.include("plan")
	})

	it("should override mode with -m option", async () => {
		// Create a task in act mode
		const storage = createTaskStorage(tempDir)
		const task = storage.create({ prompt: "Mode override test", mode: "act" })

		const cmd = createTaskOpenCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", task.id, "-m", "plan"])

		// Verify mode was changed
		const updated = storage.get(task.id)
		expect(updated!.mode).to.equal("plan")
	})

	it("should merge settings with -s option", async () => {
		// Create a task with initial settings
		const storage = createTaskStorage(tempDir)
		const task = storage.create({
			prompt: "Settings merge test",
			settings: { existing: "value" },
		})

		const cmd = createTaskOpenCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", task.id, "-s", "new=setting"])

		// Verify settings were merged
		const updated = storage.get(task.id)
		expect(updated!.settings).to.deep.equal({
			existing: "value",
			new: "setting",
		})
	})

	it("should update paused task to active", async () => {
		// Create a paused task
		const storage = createTaskStorage(tempDir)
		const task = storage.create({ prompt: "Paused task" })
		storage.updateStatus(task.id, "paused")

		const cmd = createTaskOpenCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", task.id])

		// Verify status changed to active
		const updated = storage.get(task.id)
		expect(updated!.status).to.equal("active")
	})

	it("should output JSON when format is json", async () => {
		config.outputFormat = "json"

		const storage = createTaskStorage(tempDir)
		const task = storage.create({ prompt: "JSON output test" })

		const cmd = createTaskOpenCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", task.id])

		// Should output JSON object
		const rawCalls = (formatter.raw as sinon.SinonStub).getCalls()
		const jsonOutput = rawCalls.find((call) => {
			try {
				const parsed = JSON.parse(call.args[0])
				return parsed && typeof parsed === "object" && parsed.id
			} catch {
				return false
			}
		})
		expect(jsonOutput).to.exist
	})

	it("should error on invalid mode option", async () => {
		const storage = createTaskStorage(tempDir)
		const task = storage.create({ prompt: "Invalid mode test" })

		const cmd = createTaskOpenCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", task.id, "-m", "invalid"])

		expect((formatter.error as sinon.SinonStub).calledOnce).to.be.true
		expect((formatter.error as sinon.SinonStub).firstCall.args[0]).to.include("Invalid mode")
		expect(exitStub.calledWith(1)).to.be.true
	})

	it("should error on invalid setting format", async () => {
		const storage = createTaskStorage(tempDir)
		const task = storage.create({ prompt: "Invalid settings test" })

		const cmd = createTaskOpenCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", task.id, "-s", "noequals"])

		expect((formatter.error as sinon.SinonStub).calledOnce).to.be.true
		expect((formatter.error as sinon.SinonStub).firstCall.args[0]).to.include("Invalid setting format")
		expect(exitStub.calledWith(1)).to.be.true
	})
})
