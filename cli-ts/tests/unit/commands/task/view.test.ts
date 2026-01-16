/**
 * Tests for task view command with embedded Controller
 */

import { expect } from "chai"
import fs from "fs"
import os from "os"
import path from "path"
import sinon from "sinon"
import { createTaskViewCommand } from "../../../../src/commands/task/view.js"
// Mock the embedded controller module
import * as embeddedController from "../../../../src/core/embedded-controller.js"
import type { OutputFormatter } from "../../../../src/core/output/types.js"
import type { CliConfig } from "../../../../src/types/config.js"
import type { Logger } from "../../../../src/types/logger.js"

describe("task view command", () => {
	let tempDir: string
	let config: CliConfig
	let logger: Logger
	let formatter: OutputFormatter
	let exitStub: sinon.SinonStub
	let getControllerStub: sinon.SinonStub
	let disposeControllerStub: sinon.SinonStub

	// Mock task
	const mockTask = {
		taskId: "test-task-123",
		handleWebviewAskResponse: sinon.stub(),
		messageStateHandler: {
			getClineMessages: sinon.stub().returns([]),
		},
	}

	// Mock controller
	const mockController = {
		task: null as any,
		initTask: sinon.stub(),
		cancelTask: sinon.stub(),
		togglePlanActMode: sinon.stub(),
		getTaskWithId: sinon.stub(),
		getStateToPostToWebview: sinon.stub(),
	}

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

		// Reset mock task
		mockTask.handleWebviewAskResponse.reset()
		mockTask.messageStateHandler.getClineMessages.returns([])

		// Reset mock controller
		mockController.task = null
		mockController.initTask.reset()
		mockController.cancelTask.reset()
		mockController.togglePlanActMode.reset()
		mockController.getTaskWithId.reset()
		mockController.getStateToPostToWebview.reset()

		// Setup default stubs
		mockController.getStateToPostToWebview.resolves({
			mode: "act",
			clineMessages: [],
			taskHistory: [],
		})
		mockController.initTask.resolves("test-task-123")

		// Stub the embedded controller functions
		getControllerStub = sinon.stub(embeddedController, "getEmbeddedController").resolves(mockController as any)
		disposeControllerStub = sinon.stub(embeddedController, "disposeEmbeddedController").resolves()
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

	it("should initialize controller on command start", async () => {
		mockController.getStateToPostToWebview.resolves({
			mode: "act",
			clineMessages: [],
			taskHistory: [{ id: "task-1", task: "Test task" }],
		})
		mockController.getTaskWithId.resolves({
			historyItem: { id: "task-1", task: "Test task" },
		})
		mockController.task = mockTask

		const cmd = createTaskViewCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test"])

		expect(getControllerStub.calledOnce).to.be.true
		expect((formatter.info as sinon.SinonStub).calledWith("Initializing Cline...")).to.be.true
	})

	it("should error when no tasks found", async () => {
		mockController.getStateToPostToWebview.resolves({
			mode: "act",
			clineMessages: [],
			taskHistory: [],
		})

		const cmd = createTaskViewCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test"])

		expect((formatter.error as sinon.SinonStub).calledOnce).to.be.true
		expect((formatter.error as sinon.SinonStub).firstCall.args[0]).to.include("No tasks found")
		expect(exitStub.calledWith(1)).to.be.true
	})

	it("should error when task ID not found", async () => {
		mockController.getStateToPostToWebview.resolves({
			mode: "act",
			clineMessages: [],
			taskHistory: [{ id: "task-1", task: "Test task" }],
		})

		const cmd = createTaskViewCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "nonexistent-task-id"])

		expect((formatter.error as sinon.SinonStub).calledOnce).to.be.true
		expect((formatter.error as sinon.SinonStub).firstCall.args[0]).to.include("Task not found")
		expect(exitStub.calledWith(1)).to.be.true
	})

	it("should view task by ID", async () => {
		const taskHistory = [
			{ id: "task-1", task: "First task" },
			{ id: "task-2", task: "Second task" },
		]
		mockController.getStateToPostToWebview.resolves({
			mode: "act",
			clineMessages: [],
			taskHistory,
		})
		mockController.getTaskWithId.resolves({
			historyItem: taskHistory[1],
		})

		// Simulate task being initialized
		mockController.initTask.callsFake(async () => {
			mockController.task = mockTask
			return "task-2"
		})

		const cmd = createTaskViewCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "task-2"])

		expect(mockController.getTaskWithId.calledWith("task-2")).to.be.true
	})

	it("should view task by partial ID", async () => {
		const taskHistory = [{ id: "task-123456789", task: "Test task" }]
		mockController.getStateToPostToWebview.resolves({
			mode: "act",
			clineMessages: [],
			taskHistory,
		})
		mockController.getTaskWithId.resolves({
			historyItem: taskHistory[0],
		})
		mockController.initTask.callsFake(async () => {
			mockController.task = mockTask
			return "task-123456789"
		})

		const cmd = createTaskViewCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "task-1234"])

		// Should find the task by partial match
		expect((formatter.info as sinon.SinonStub).calledWith(sinon.match(/Task: task-123456789/))).to.be.true
	})

	it("should display messages from task", async () => {
		const messages = [
			{ ts: Date.now(), type: "say" as const, say: "task" as const, text: "Test task prompt" },
			{ ts: Date.now() + 1, type: "say" as const, say: "text" as const, text: "Hello from AI" },
		]
		mockTask.messageStateHandler.getClineMessages.returns(messages)
		mockController.task = mockTask

		const taskHistory = [{ id: "task-1", task: "Test task" }]
		mockController.getStateToPostToWebview.resolves({
			mode: "act",
			clineMessages: messages,
			taskHistory,
		})

		const cmd = createTaskViewCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test"])

		// Should display messages
		expect(disposeControllerStub.calledOnce).to.be.true
	})

	it("should filter messages by --last option", async () => {
		const messages = [
			{ ts: Date.now(), type: "say" as const, say: "task" as const, text: "Task 1" },
			{ ts: Date.now() + 1, type: "say" as const, say: "text" as const, text: "Message 2" },
			{ ts: Date.now() + 2, type: "say" as const, say: "text" as const, text: "Message 3" },
		]
		mockTask.messageStateHandler.getClineMessages.returns(messages)
		mockController.task = mockTask

		const taskHistory = [{ id: "task-1", task: "Test task" }]
		mockController.getStateToPostToWebview.resolves({
			mode: "act",
			clineMessages: messages,
			taskHistory,
		})

		const cmd = createTaskViewCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "-n", "2"])

		// Should only process last 2 messages
		expect(disposeControllerStub.calledOnce).to.be.true
	})

	it("should error on invalid --last count", async () => {
		const taskHistory = [{ id: "task-1", task: "Test task" }]
		mockController.getStateToPostToWebview.resolves({
			mode: "act",
			clineMessages: [],
			taskHistory,
		})
		mockController.getTaskWithId.resolves({
			historyItem: taskHistory[0],
		})
		mockController.task = mockTask

		const cmd = createTaskViewCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "-n", "invalid"])

		expect((formatter.error as sinon.SinonStub).calledOnce).to.be.true
		expect((formatter.error as sinon.SinonStub).firstCall.args[0]).to.include("Invalid count")
		expect(exitStub.calledWith(1)).to.be.true
	})

	it("should error on invalid --since timestamp", async () => {
		const taskHistory = [{ id: "task-1", task: "Test task" }]
		mockController.getStateToPostToWebview.resolves({
			mode: "act",
			clineMessages: [],
			taskHistory,
		})
		mockController.getTaskWithId.resolves({
			historyItem: taskHistory[0],
		})
		mockController.task = mockTask

		const cmd = createTaskViewCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "--since", "invalid"])

		expect((formatter.error as sinon.SinonStub).calledOnce).to.be.true
		expect((formatter.error as sinon.SinonStub).firstCall.args[0]).to.include("Invalid timestamp")
		expect(exitStub.calledWith(1)).to.be.true
	})

	it("should dispose controller after completion", async () => {
		const taskHistory = [{ id: "task-1", task: "Test task" }]
		mockController.getStateToPostToWebview.resolves({
			mode: "act",
			clineMessages: [],
			taskHistory,
		})
		mockController.getTaskWithId.resolves({
			historyItem: taskHistory[0],
		})
		mockController.task = mockTask

		const cmd = createTaskViewCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test"])

		expect(disposeControllerStub.calledOnce).to.be.true
	})

	describe("command options", () => {
		it("should have -f/--follow option", () => {
			const cmd = createTaskViewCommand(config, logger, formatter)
			const followOption = cmd.options.find((opt) => opt.short === "-f" || opt.long === "--follow")

			expect(followOption).to.exist
		})

		it("should have -c/--follow-complete option", () => {
			const cmd = createTaskViewCommand(config, logger, formatter)
			const followCompleteOption = cmd.options.find((opt) => opt.short === "-c" || opt.long === "--follow-complete")

			expect(followCompleteOption).to.exist
		})

		it("should have -n/--last option", () => {
			const cmd = createTaskViewCommand(config, logger, formatter)
			const lastOption = cmd.options.find((opt) => opt.short === "-n" || opt.long === "--last")

			expect(lastOption).to.exist
		})

		it("should have --since option", () => {
			const cmd = createTaskViewCommand(config, logger, formatter)
			const sinceOption = cmd.options.find((opt) => opt.long === "--since")

			expect(sinceOption).to.exist
		})

		it("should have -r/--raw option", () => {
			const cmd = createTaskViewCommand(config, logger, formatter)
			const rawOption = cmd.options.find((opt) => opt.short === "-r" || opt.long === "--raw")

			expect(rawOption).to.exist
		})
	})

	describe("JSON output", () => {
		it("should output JSON when format is json", async () => {
			config.outputFormat = "json"

			const taskHistory = [{ id: "task-1", task: "Test task" }]
			mockController.getStateToPostToWebview.resolves({
				mode: "act",
				clineMessages: [],
				taskHistory,
			})
			mockController.getTaskWithId.resolves({
				historyItem: taskHistory[0],
			})
			mockController.task = mockTask

			const cmd = createTaskViewCommand(config, logger, formatter)
			await cmd.parseAsync(["node", "test"])

			// Check that raw was called with JSON
			const rawCalls = (formatter.raw as sinon.SinonStub).getCalls()
			const jsonCall = rawCalls.find((call) => {
				try {
					const parsed = JSON.parse(call.args[0])
					return parsed.taskId !== undefined
				} catch {
					return false
				}
			})
			expect(jsonCall).to.exist
		})
	})

	describe("current task", () => {
		it("should use current task when no ID provided and task is active", async () => {
			mockController.task = {
				...mockTask,
				taskId: "active-task-123",
			}

			const taskHistory = [
				{ id: "active-task-123", task: "Active task" },
				{ id: "older-task", task: "Older task" },
			]
			mockController.getStateToPostToWebview.resolves({
				mode: "act",
				clineMessages: [],
				taskHistory,
			})

			const cmd = createTaskViewCommand(config, logger, formatter)
			await cmd.parseAsync(["node", "test"])

			// Should show the active task, not the most recent from history
			expect((formatter.info as sinon.SinonStub).calledWith(sinon.match(/Task: active-task-123/))).to.be.true
		})
	})
})
