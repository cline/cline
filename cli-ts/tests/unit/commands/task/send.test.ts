/**
 * Tests for task send command
 */

import { expect } from "chai"
import fs from "fs"
import os from "os"
import path from "path"
import sinon from "sinon"
import { createTaskSendCommand } from "../../../../src/commands/task/send.js"
import type { OutputFormatter } from "../../../../src/core/output/types.js"
import { createTaskStorage } from "../../../../src/core/task-client.js"
import type { CliConfig } from "../../../../src/types/config.js"
import type { Logger } from "../../../../src/types/logger.js"

describe("task send command", () => {
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
		const cmd = createTaskSendCommand(config, logger, formatter)

		expect(cmd.name()).to.equal("send")
		expect(cmd.aliases()).to.include("s")
	})

	it("should send a message to the most recent active task", async () => {
		// Create a task first
		const storage = createTaskStorage(tempDir)
		const task = storage.create({ prompt: "Test task" })

		const cmd = createTaskSendCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "Hello, Cline!"])

		// Verify message was saved
		const messages = storage.getMessages(task.id)
		expect(messages).to.have.lengthOf(1)
		expect(messages[0].content).to.equal("Hello, Cline!")
		expect(messages[0].role).to.equal("user")
		expect(messages[0].type).to.equal("text")

		// Verify success message
		expect((formatter.success as sinon.SinonStub).calledOnce).to.be.true
	})

	it("should send a message to a specific task by ID", async () => {
		// Create two tasks
		const storage = createTaskStorage(tempDir)
		const task1 = storage.create({ prompt: "Task 1" })
		storage.create({ prompt: "Task 2" })

		const cmd = createTaskSendCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "Message to task 1", "-t", task1.id])

		// Verify message was saved to task1
		const messages = storage.getMessages(task1.id)
		expect(messages).to.have.lengthOf(1)
		expect(messages[0].content).to.equal("Message to task 1")
	})

	it("should error when no active task exists", async () => {
		const cmd = createTaskSendCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "Hello"])

		expect((formatter.error as sinon.SinonStub).calledOnce).to.be.true
		expect((formatter.error as sinon.SinonStub).firstCall.args[0]).to.include("No active task found")
		expect(exitStub.calledWith(1)).to.be.true
	})

	it("should error when task not found", async () => {
		const cmd = createTaskSendCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "Hello", "-t", "nonexistent"])

		expect((formatter.error as sinon.SinonStub).calledOnce).to.be.true
		expect((formatter.error as sinon.SinonStub).firstCall.args[0]).to.include("Task not found")
		expect(exitStub.calledWith(1)).to.be.true
	})

	it("should error when no message provided", async () => {
		// Create a task
		const storage = createTaskStorage(tempDir)
		storage.create({ prompt: "Test task" })

		const cmd = createTaskSendCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test"])

		expect((formatter.error as sinon.SinonStub).calledOnce).to.be.true
		expect((formatter.error as sinon.SinonStub).firstCall.args[0]).to.include("No message provided")
		expect(exitStub.calledWith(1)).to.be.true
	})

	it("should error when both approve and deny options are used", async () => {
		// Create a task
		const storage = createTaskStorage(tempDir)
		storage.create({ prompt: "Test task" })

		const cmd = createTaskSendCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "-a", "-d"])

		expect((formatter.error as sinon.SinonStub).calledOnce).to.be.true
		expect((formatter.error as sinon.SinonStub).firstCall.args[0]).to.include("Cannot use both")
		expect(exitStub.calledWith(1)).to.be.true
	})

	it("should approve pending action with --approve flag", async () => {
		// Create a task with pending approval
		const storage = createTaskStorage(tempDir)
		const task = storage.create({ prompt: "Test task" })
		storage.addMessage(task.id, "assistant", "approval_request", "May I run this command?")

		const cmd = createTaskSendCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "-a"])

		// Verify approval response was saved
		const messages = storage.getMessages(task.id)
		expect(messages).to.have.lengthOf(2)
		expect(messages[1].type).to.equal("approval_response")
		expect(messages[1].content).to.equal("approved")
		expect((messages[1].metadata as { approved: boolean }).approved).to.be.true

		expect((formatter.success as sinon.SinonStub).calledOnce).to.be.true
	})

	it("should deny pending action with --deny flag", async () => {
		// Create a task with pending approval
		const storage = createTaskStorage(tempDir)
		const task = storage.create({ prompt: "Test task" })
		storage.addMessage(task.id, "assistant", "approval_request", "May I run this command?")

		const cmd = createTaskSendCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "-d"])

		// Verify denial response was saved
		const messages = storage.getMessages(task.id)
		expect(messages).to.have.lengthOf(2)
		expect(messages[1].type).to.equal("approval_response")
		expect(messages[1].content).to.equal("denied")
		expect((messages[1].metadata as { approved: boolean }).approved).to.be.false

		expect((formatter.success as sinon.SinonStub).calledOnce).to.be.true
	})

	it("should error when approving with no pending approval", async () => {
		// Create a task without pending approval
		const storage = createTaskStorage(tempDir)
		storage.create({ prompt: "Test task" })

		const cmd = createTaskSendCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "-a"])

		expect((formatter.error as sinon.SinonStub).calledOnce).to.be.true
		expect((formatter.error as sinon.SinonStub).firstCall.args[0]).to.include("No pending approval")
		expect(exitStub.calledWith(1)).to.be.true
	})

	it("should switch mode with --mode flag", async () => {
		// Create a task
		const storage = createTaskStorage(tempDir)
		const task = storage.create({ prompt: "Test task", mode: "act" })
		expect(task.mode).to.equal("act")

		const cmd = createTaskSendCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "Hello", "-m", "plan"])

		// Verify mode was changed
		const updatedTask = storage.get(task.id)
		expect(updatedTask?.mode).to.equal("plan")

		// Verify info message about mode switch
		expect((formatter.info as sinon.SinonStub).called).to.be.true
	})

	it("should error on invalid mode", async () => {
		// Create a task
		const storage = createTaskStorage(tempDir)
		storage.create({ prompt: "Test task" })

		const cmd = createTaskSendCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "Hello", "-m", "invalid"])

		expect((formatter.error as sinon.SinonStub).calledOnce).to.be.true
		expect((formatter.error as sinon.SinonStub).firstCall.args[0]).to.include("Invalid mode")
		expect(exitStub.calledWith(1)).to.be.true
	})

	it("should error when file attachment not found", async () => {
		// Create a task
		const storage = createTaskStorage(tempDir)
		storage.create({ prompt: "Test task" })

		const cmd = createTaskSendCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "Hello", "-f", "/nonexistent/file.txt"])

		expect((formatter.error as sinon.SinonStub).calledOnce).to.be.true
		expect((formatter.error as sinon.SinonStub).firstCall.args[0]).to.include("File not found")
		expect(exitStub.calledWith(1)).to.be.true
	})

	it("should attach file when it exists", async () => {
		// Create a task and a temp file
		const storage = createTaskStorage(tempDir)
		const task = storage.create({ prompt: "Test task" })
		const testFile = path.join(tempDir, "test.txt")
		fs.writeFileSync(testFile, "test content")

		const cmd = createTaskSendCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "Hello with file", "-f", testFile])

		// Verify message with attachment
		const messages = storage.getMessages(task.id)
		expect(messages).to.have.lengthOf(1)
		expect(messages[0].attachments).to.deep.equal([testFile])
	})
})
