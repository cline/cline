/**
 * Tests for task send command with embedded Controller
 */

import { expect } from "chai"
import fs from "fs"
import os from "os"
import path from "path"
import sinon from "sinon"
import { createTaskSendCommand } from "../../../../src/commands/task/send.js"
// Mock the embedded controller module
import * as embeddedController from "../../../../src/core/embedded-controller.js"
import type { OutputFormatter } from "../../../../src/core/output/types.js"
import type { CliConfig } from "../../../../src/types/config.js"
import type { Logger } from "../../../../src/types/logger.js"

describe("task send command", () => {
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
		const cmd = createTaskSendCommand(config, logger, formatter)

		expect(cmd.name()).to.equal("send")
		expect(cmd.aliases()).to.include("s")
	})

	it("should initialize controller on command start", async () => {
		const cmd = createTaskSendCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "Hello Cline"])

		expect(getControllerStub.calledOnce).to.be.true
	})

	it("should error when no message provided", async () => {
		const cmd = createTaskSendCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test"])

		expect((formatter.error as sinon.SinonStub).calledOnce).to.be.true
		expect((formatter.error as sinon.SinonStub).firstCall.args[0]).to.include("No message provided")
		expect(exitStub.calledWith(1)).to.be.true
	})

	it("should error when using both --approve and --deny", async () => {
		const cmd = createTaskSendCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "--approve", "--deny"])

		expect((formatter.error as sinon.SinonStub).calledOnce).to.be.true
		expect((formatter.error as sinon.SinonStub).firstCall.args[0]).to.include("Cannot use both --approve and --deny")
		expect(exitStub.calledWith(1)).to.be.true
	})

	it("should error when file not found", async () => {
		const cmd = createTaskSendCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "-f", "/nonexistent/file.txt", "message"])

		expect((formatter.error as sinon.SinonStub).calledOnce).to.be.true
		expect((formatter.error as sinon.SinonStub).firstCall.args[0]).to.include("File not found")
		expect(exitStub.calledWith(1)).to.be.true
	})

	it("should error on invalid mode option", async () => {
		const cmd = createTaskSendCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "-m", "invalid", "message"])

		expect((formatter.error as sinon.SinonStub).calledOnce).to.be.true
		expect((formatter.error as sinon.SinonStub).firstCall.args[0]).to.include("Invalid mode")
		expect(exitStub.calledWith(1)).to.be.true
	})

	it("should start new task with message when no active task", async () => {
		const cmd = createTaskSendCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "Hello Cline"])

		expect(mockController.initTask.calledWith("Hello Cline")).to.be.true
		expect((formatter.info as sinon.SinonStub).calledWith(sinon.match(/Started new task/))).to.be.true
	})

	it("should send message to existing active task", async () => {
		mockController.task = mockTask
		mockTask.handleWebviewAskResponse.resolves()

		const cmd = createTaskSendCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "Hello Cline"])

		expect(mockTask.handleWebviewAskResponse.calledWith("messageResponse", "Hello Cline")).to.be.true
		expect((formatter.info as sinon.SinonStub).calledWith(sinon.match(/Message sent/))).to.be.true
	})

	it("should resume task with --task option", async () => {
		const historyItem = { id: "existing-task-456", task: "Previous task" }
		mockController.getTaskWithId.resolves({ historyItem })
		mockController.initTask.resolves("existing-task-456")

		// Set up task after init
		mockController.initTask.callsFake(async () => {
			mockController.task = mockTask
			return "existing-task-456"
		})

		const cmd = createTaskSendCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "-t", "existing-task-456", "Hello"])

		expect(mockController.getTaskWithId.calledWith("existing-task-456")).to.be.true
		expect(mockController.initTask.calledWith(undefined, undefined, undefined, historyItem)).to.be.true
	})

	it("should approve action with --approve flag", async () => {
		mockController.task = mockTask

		const cmd = createTaskSendCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "--approve"])

		expect(mockTask.handleWebviewAskResponse.calledWith("yesButtonClicked")).to.be.true
		expect((formatter.success as sinon.SinonStub).calledWith("Action approved")).to.be.true
	})

	it("should deny action with --deny flag", async () => {
		mockController.task = mockTask

		const cmd = createTaskSendCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "--deny"])

		expect(mockTask.handleWebviewAskResponse.calledWith("noButtonClicked")).to.be.true
		expect((formatter.success as sinon.SinonStub).calledWith("Action denied")).to.be.true
	})

	it("should error when approving without active task", async () => {
		const cmd = createTaskSendCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "--approve"])

		expect((formatter.error as sinon.SinonStub).calledOnce).to.be.true
		expect((formatter.error as sinon.SinonStub).firstCall.args[0]).to.include("No active task")
		expect(exitStub.calledWith(1)).to.be.true
	})

	it("should switch mode when --mode option provided", async () => {
		const cmd = createTaskSendCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "-m", "plan", "Hello"])

		expect(mockController.togglePlanActMode.calledWith("plan")).to.be.true
		expect((formatter.info as sinon.SinonStub).calledWith("Switched to plan mode")).to.be.true
	})

	it("should dispose controller after completion", async () => {
		const cmd = createTaskSendCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "Hello"])

		expect(disposeControllerStub.calledOnce).to.be.true
	})

	describe("command options", () => {
		it("should have -t/--task option", () => {
			const cmd = createTaskSendCommand(config, logger, formatter)
			const taskOption = cmd.options.find((opt) => opt.short === "-t" || opt.long === "--task")

			expect(taskOption).to.exist
		})

		it("should have -a/--approve option", () => {
			const cmd = createTaskSendCommand(config, logger, formatter)
			const approveOption = cmd.options.find((opt) => opt.short === "-a" || opt.long === "--approve")

			expect(approveOption).to.exist
		})

		it("should have -d/--deny option", () => {
			const cmd = createTaskSendCommand(config, logger, formatter)
			const denyOption = cmd.options.find((opt) => opt.short === "-d" || opt.long === "--deny")

			expect(denyOption).to.exist
		})

		it("should have -f/--file option", () => {
			const cmd = createTaskSendCommand(config, logger, formatter)
			const fileOption = cmd.options.find((opt) => opt.short === "-f" || opt.long === "--file")

			expect(fileOption).to.exist
		})

		it("should have -m/--mode option", () => {
			const cmd = createTaskSendCommand(config, logger, formatter)
			const modeOption = cmd.options.find((opt) => opt.short === "-m" || opt.long === "--mode")

			expect(modeOption).to.exist
		})

		it("should have -w/--wait option", () => {
			const cmd = createTaskSendCommand(config, logger, formatter)
			const waitOption = cmd.options.find((opt) => opt.short === "-w" || opt.long === "--wait")

			expect(waitOption).to.exist
		})
	})

	describe("JSON output", () => {
		it("should output JSON when format is json", async () => {
			config.outputFormat = "json"

			const cmd = createTaskSendCommand(config, logger, formatter)
			await cmd.parseAsync(["node", "test", "Hello Cline"])

			// Check that raw was called with JSON
			const rawCalls = (formatter.raw as sinon.SinonStub).getCalls()
			const jsonCall = rawCalls.find((call) => {
				try {
					JSON.parse(call.args[0])
					return true
				} catch {
					return false
				}
			})
			expect(jsonCall).to.exist
		})
	})
})
