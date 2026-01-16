/**
 * Tests for task new command
 */

import { expect } from "chai"
import fs from "fs"
import os from "os"
import path from "path"
import sinon from "sinon"
import { createTaskNewCommand } from "../../../../src/commands/task/new.js"
import type { OutputFormatter } from "../../../../src/core/output/types.js"
import { createTaskStorage } from "../../../../src/core/task-client.js"
import type { CliConfig } from "../../../../src/types/config.js"
import type { Logger } from "../../../../src/types/logger.js"

describe("task new command", () => {
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
		const cmd = createTaskNewCommand(config, logger, formatter)

		expect(cmd.name()).to.equal("new")
		expect(cmd.aliases()).to.include("n")
	})

	it("should create a task with prompt argument", async () => {
		const cmd = createTaskNewCommand(config, logger, formatter)

		await cmd.parseAsync(["node", "test", "Test prompt for new task"])

		// Verify task was created
		const storage = createTaskStorage(tempDir)
		const tasks = storage.list()
		expect(tasks).to.have.lengthOf(1)
		expect(tasks[0].prompt).to.equal("Test prompt for new task")
		expect(tasks[0].mode).to.equal("act")
		expect(tasks[0].status).to.equal("active")

		// Verify success message
		expect((formatter.success as sinon.SinonStub).calledOnce).to.be.true
	})

	it("should create task with plan mode", async () => {
		const cmd = createTaskNewCommand(config, logger, formatter)

		await cmd.parseAsync(["node", "test", "Plan task", "-m", "plan"])

		const storage = createTaskStorage(tempDir)
		const tasks = storage.list()
		expect(tasks[0].mode).to.equal("plan")
	})

	it("should create task with settings", async () => {
		const cmd = createTaskNewCommand(config, logger, formatter)

		await cmd.parseAsync(["node", "test", "Task with settings", "-s", "key1=value1", "-s", "key2=value2"])

		const storage = createTaskStorage(tempDir)
		const tasks = storage.list()
		expect(tasks[0].settings).to.deep.equal({ key1: "value1", key2: "value2" })
	})

	it("should create task with custom workspace", async () => {
		const cmd = createTaskNewCommand(config, logger, formatter)
		const workspacePath = "/custom/workspace"

		await cmd.parseAsync(["node", "test", "Task with workspace", "-w", workspacePath])

		const storage = createTaskStorage(tempDir)
		const tasks = storage.list()
		expect(tasks[0].workingDirectory).to.equal(workspacePath)
	})

	it("should error on invalid mode", async () => {
		const cmd = createTaskNewCommand(config, logger, formatter)

		await cmd.parseAsync(["node", "test", "Invalid mode task", "-m", "invalid"])

		expect((formatter.error as sinon.SinonStub).calledOnce).to.be.true
		expect((formatter.error as sinon.SinonStub).firstCall.args[0]).to.include("Invalid mode")
		expect(exitStub.calledWith(1)).to.be.true
	})

	it("should error on invalid setting format", async () => {
		const cmd = createTaskNewCommand(config, logger, formatter)

		await cmd.parseAsync(["node", "test", "Bad settings task", "-s", "noequals"])

		expect((formatter.error as sinon.SinonStub).calledOnce).to.be.true
		expect((formatter.error as sinon.SinonStub).firstCall.args[0]).to.include("Invalid setting format")
		expect(exitStub.calledWith(1)).to.be.true
	})
})
