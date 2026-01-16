/**
 * Tests for task chat command with embedded Controller
 */

import { expect } from "chai"
import fs from "fs"
import os from "os"
import path from "path"
import sinon from "sinon"
import { createTaskChatCommand } from "../../../../src/commands/task/chat.js"
// Mock the embedded controller module
import * as embeddedController from "../../../../src/core/embedded-controller.js"
import type { OutputFormatter } from "../../../../src/core/output/types.js"
import type { CliConfig } from "../../../../src/types/config.js"
import type { Logger } from "../../../../src/types/logger.js"

describe("task chat command", () => {
	let tempDir: string
	let config: CliConfig
	let logger: Logger
	let formatter: OutputFormatter
	let exitStub: sinon.SinonStub
	let getControllerStub: sinon.SinonStub
	let disposeControllerStub: sinon.SinonStub

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
		const cmd = createTaskChatCommand(config, logger, formatter)

		expect(cmd.name()).to.equal("chat")
		expect(cmd.aliases()).to.include("c")
	})

	it("should initialize controller on command start", async () => {
		const cmd = createTaskChatCommand(config, logger, formatter)

		// Start chat with a prompt (this will initialize controller but hang on readline)
		// We need to cause it to error to avoid hanging
		mockController.initTask.rejects(new Error("Test error"))

		await cmd.parseAsync(["node", "test", "Hello Cline"])

		expect(getControllerStub.calledOnce).to.be.true
		expect((formatter.info as sinon.SinonStub).calledWith("Initializing Cline...")).to.be.true
	})

	it("should error on invalid mode option", async () => {
		const cmd = createTaskChatCommand(config, logger, formatter)

		// Make initTask throw to exit the command
		mockController.initTask.rejects(new Error("Test"))

		await cmd.parseAsync(["node", "test", "-m", "invalid", "prompt"])

		expect((formatter.error as sinon.SinonStub).calledOnce).to.be.true
		expect((formatter.error as sinon.SinonStub).firstCall.args[0]).to.include("Invalid mode")
		expect(exitStub.calledWith(1)).to.be.true
	})

	it("should start new task with prompt argument", async () => {
		const cmd = createTaskChatCommand(config, logger, formatter)

		// Make initTask throw after being called to exit the command
		mockController.initTask.callsFake(async () => {
			throw new Error("Exit after init")
		})

		await cmd.parseAsync(["node", "test", "Hello Cline"])

		expect(mockController.initTask.calledWith("Hello Cline")).to.be.true
	})

	it("should resume existing task with --task option", async () => {
		const historyItem = { id: "existing-task-456", task: "Previous task" }
		mockController.getTaskWithId.resolves({ historyItem })
		mockController.initTask.callsFake(async () => {
			throw new Error("Exit after init")
		})

		const cmd = createTaskChatCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "-t", "existing-task-456"])

		expect(mockController.getTaskWithId.calledWith("existing-task-456")).to.be.true
		expect(mockController.initTask.calledWith(undefined, undefined, undefined, historyItem)).to.be.true
	})

	it("should switch mode when --mode option provided", async () => {
		mockController.initTask.callsFake(async () => {
			throw new Error("Exit after init")
		})

		const cmd = createTaskChatCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "-m", "plan", "prompt"])

		expect(mockController.togglePlanActMode.calledWith("plan")).to.be.true
	})

	it("should dispose controller on error", async () => {
		mockController.initTask.rejects(new Error("Test error"))

		const cmd = createTaskChatCommand(config, logger, formatter)
		await cmd.parseAsync(["node", "test", "prompt"])

		expect(disposeControllerStub.calledOnce).to.be.true
	})

	describe("command options", () => {
		it("should have -m/--mode option", () => {
			const cmd = createTaskChatCommand(config, logger, formatter)
			const modeOption = cmd.options.find((opt) => opt.short === "-m" || opt.long === "--mode")

			expect(modeOption).to.exist
		})

		it("should have -t/--task option", () => {
			const cmd = createTaskChatCommand(config, logger, formatter)
			const taskOption = cmd.options.find((opt) => opt.short === "-t" || opt.long === "--task")

			expect(taskOption).to.exist
		})

		it("should have -y/--yolo option", () => {
			const cmd = createTaskChatCommand(config, logger, formatter)
			const yoloOption = cmd.options.find((opt) => opt.short === "-y" || opt.long === "--yolo")

			expect(yoloOption).to.exist
		})
	})

	describe("task resume", () => {
		it("should error when task not found", async () => {
			mockController.getTaskWithId.rejects(new Error("Task not found"))

			const cmd = createTaskChatCommand(config, logger, formatter)
			await cmd.parseAsync(["node", "test", "-t", "nonexistent"])

			expect((formatter.error as sinon.SinonStub).calledOnce).to.be.true
			expect(exitStub.calledWith(1)).to.be.true
		})
	})
})
