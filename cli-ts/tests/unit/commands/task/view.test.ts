/**
 * Tests for task view command
 */

import { expect } from "chai"
import fs from "fs"
import os from "os"
import path from "path"
import sinon from "sinon"
import { createTaskViewCommand } from "../../../../src/commands/task/view.js"
import type { OutputFormatter } from "../../../../src/core/output/types.js"
import { createTaskStorage } from "../../../../src/core/task-client.js"
import type { CliConfig } from "../../../../src/types/config.js"
import type { Logger } from "../../../../src/types/logger.js"

describe("task view command", () => {
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
		const cmd = createTaskViewCommand(config, logger, formatter)

		expect(cmd.name()).to.equal("view")
		expect(cmd.aliases()).to.include("v")
	})

	it("should view messages from the most recent task", async () => {
		// Create a task with messages
		const storage = createTaskStorage(tempDir)
		const task = storage.create({ prompt: "Test task" })
		storage.addMessage(task.id, "user", "text", "Hello")
		storage.addMessage(task.id, "assistant", "text", "Hi there!")

		const cmd = createTaskViewCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test"])

		// Verify task info displayed
		expect((formatter.info as sinon.SinonStub).calledWith(`Task: ${task.id}`)).to.be.true
		expect((formatter.info as sinon.SinonStub).calledWith(`Status: ${task.status} | Mode: ${task.mode}`)).to.be.true

		// Verify messages displayed (using raw for formatted messages)
		expect((formatter.raw as sinon.SinonStub).called).to.be.true
	})

	it("should view messages from a specific task by ID", async () => {
		// Create two tasks
		const storage = createTaskStorage(tempDir)
		const task1 = storage.create({ prompt: "Task 1" })
		storage.addMessage(task1.id, "user", "text", "Message 1")
		const task2 = storage.create({ prompt: "Task 2" })
		storage.addMessage(task2.id, "user", "text", "Message 2")

		const cmd = createTaskViewCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", task1.id])

		// Verify correct task displayed
		expect((formatter.info as sinon.SinonStub).calledWith(`Task: ${task1.id}`)).to.be.true
	})

	it("should error when no tasks exist", async () => {
		const cmd = createTaskViewCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test"])

		expect((formatter.error as sinon.SinonStub).calledOnce).to.be.true
		expect((formatter.error as sinon.SinonStub).firstCall.args[0]).to.include("No tasks found")
		expect(exitStub.calledWith(1)).to.be.true
	})

	it("should error when task not found", async () => {
		const cmd = createTaskViewCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "nonexistent"])

		expect((formatter.error as sinon.SinonStub).calledOnce).to.be.true
		expect((formatter.error as sinon.SinonStub).firstCall.args[0]).to.include("Task not found")
		expect(exitStub.calledWith(1)).to.be.true
	})

	it("should show 'No messages yet' for task without messages", async () => {
		// Create a task without messages
		const storage = createTaskStorage(tempDir)
		storage.create({ prompt: "Empty task" })

		const cmd = createTaskViewCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test"])

		expect((formatter.info as sinon.SinonStub).calledWith("No messages yet")).to.be.true
	})

	it("should limit messages with --last option", async () => {
		// Create a task with multiple messages
		const storage = createTaskStorage(tempDir)
		const task = storage.create({ prompt: "Test task" })
		storage.addMessage(task.id, "user", "text", "Message 1")
		storage.addMessage(task.id, "assistant", "text", "Response 1")
		storage.addMessage(task.id, "user", "text", "Message 2")
		storage.addMessage(task.id, "assistant", "text", "Response 2")
		storage.addMessage(task.id, "user", "text", "Message 3")

		const cmd = createTaskViewCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "-n", "2"])

		// Count how many times raw was called for message formatting
		// Should be separator + 2 messages (last 2)
		const rawStub = formatter.raw as sinon.SinonStub
		const messageCalls = rawStub.getCalls().filter((call) => {
			const arg = call.args[0]
			return typeof arg === "string" && (arg.includes("USER") || arg.includes("ASSISTANT"))
		})
		expect(messageCalls).to.have.lengthOf(2)
	})

	it("should error on invalid --last count", async () => {
		// Create a task
		const storage = createTaskStorage(tempDir)
		storage.create({ prompt: "Test task" })

		const cmd = createTaskViewCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "-n", "invalid"])

		expect((formatter.error as sinon.SinonStub).calledOnce).to.be.true
		expect((formatter.error as sinon.SinonStub).firstCall.args[0]).to.include("Invalid count")
		expect(exitStub.calledWith(1)).to.be.true
	})

	it("should filter messages with --since option", async () => {
		// Create a task with messages at different times
		const storage = createTaskStorage(tempDir)
		const task = storage.create({ prompt: "Test task" })

		// Add first message with an older timestamp
		const oldTimestamp = Date.now() - 10000 // 10 seconds ago
		storage.addMessage(task.id, "user", "text", "Old message")

		// Get the messages and manually update the first one's timestamp
		const messagesPath = path.join(tempDir, "tasks", `${task.id}-messages.json`)
		const messages = JSON.parse(fs.readFileSync(messagesPath, "utf-8"))
		messages[0].timestamp = oldTimestamp
		fs.writeFileSync(messagesPath, JSON.stringify(messages, null, 2))

		// Use a timestamp between old and new message
		const middleTimestamp = Date.now() - 5000 // 5 seconds ago

		// Add second message (will have current timestamp)
		storage.addMessage(task.id, "user", "text", "New message")

		const cmd = createTaskViewCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "--since", String(middleTimestamp)])

		// Should only show 1 message (the new one)
		const rawStub = formatter.raw as sinon.SinonStub
		const messageCalls = rawStub.getCalls().filter((call) => {
			const arg = call.args[0]
			return typeof arg === "string" && arg.includes("New message")
		})
		expect(messageCalls).to.have.lengthOf(1)

		// Should NOT show the old message
		const oldMessageCalls = rawStub.getCalls().filter((call) => {
			const arg = call.args[0]
			return typeof arg === "string" && arg.includes("Old message")
		})
		expect(oldMessageCalls).to.have.lengthOf(0)
	})

	it("should error on invalid --since timestamp", async () => {
		// Create a task
		const storage = createTaskStorage(tempDir)
		storage.create({ prompt: "Test task" })

		const cmd = createTaskViewCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "--since", "invalid"])

		expect((formatter.error as sinon.SinonStub).calledOnce).to.be.true
		expect((formatter.error as sinon.SinonStub).firstCall.args[0]).to.include("Invalid timestamp")
		expect(exitStub.calledWith(1)).to.be.true
	})

	it("should output JSON when format is json and not following", async () => {
		// Create a task with messages
		const storage = createTaskStorage(tempDir)
		const task = storage.create({ prompt: "Test task" })
		storage.addMessage(task.id, "user", "text", "Hello")

		// Set JSON output format
		config.outputFormat = "json"

		const cmd = createTaskViewCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test"])

		// Verify JSON output
		const rawStub = formatter.raw as sinon.SinonStub
		const jsonCalls = rawStub.getCalls().filter((call) => {
			const arg = call.args[0]
			try {
				JSON.parse(arg)
				return true
			} catch {
				return false
			}
		})
		expect(jsonCalls.length).to.be.greaterThan(0)
	})
})
