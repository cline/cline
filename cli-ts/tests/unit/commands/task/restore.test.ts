/**
 * Tests for task restore command
 */

import { expect } from "chai"
import fs from "fs"
import os from "os"
import path from "path"
import sinon from "sinon"
import {
	createTaskRestoreCommand,
	findCheckpoints,
	formatCheckpointList,
	validateCheckpoint,
} from "../../../../src/commands/task/restore.js"
// Mock the embedded controller module
import * as embeddedController from "../../../../src/core/embedded-controller.js"
import type { OutputFormatter } from "../../../../src/core/output/types.js"
import type { CliConfig } from "../../../../src/types/config.js"
import type { Logger } from "../../../../src/types/logger.js"

describe("task restore command", () => {
	let tempDir: string
	let config: CliConfig
	let logger: Logger
	let formatter: OutputFormatter
	let exitStub: sinon.SinonStub
	let getControllerStub: sinon.SinonStub
	let disposeControllerStub: sinon.SinonStub

	// Mock checkpoint manager
	const mockCheckpointManager = {
		restoreCheckpoint: sinon.stub().resolves({}),
	}

	// Mock task
	const mockTask = {
		taskId: "test-task-123",
		handleWebviewAskResponse: sinon.stub(),
		messageStateHandler: {
			getClineMessages: sinon.stub().returns([]),
		},
		checkpointManager: mockCheckpointManager,
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
		mockCheckpointManager.restoreCheckpoint.reset()
		mockCheckpointManager.restoreCheckpoint.resolves({})

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
		mockController.cancelTask.resolves()

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

	describe("command setup", () => {
		it("should create command with correct name and alias", () => {
			const cmd = createTaskRestoreCommand(config, logger, formatter)

			expect(cmd.name()).to.equal("restore")
			expect(cmd.aliases()).to.include("r")
		})

		it("should have -t/--type option", () => {
			const cmd = createTaskRestoreCommand(config, logger, formatter)
			const typeOption = cmd.options.find((opt) => opt.short === "-t" || opt.long === "--type")

			expect(typeOption).to.exist
		})

		it("should have -l/--list option", () => {
			const cmd = createTaskRestoreCommand(config, logger, formatter)
			const listOption = cmd.options.find((opt) => opt.short === "-l" || opt.long === "--list")

			expect(listOption).to.exist
		})
	})

	describe("checkpoint validation", () => {
		it("should error on invalid checkpoint ID format", async () => {
			mockController.task = mockTask
			const taskHistory = [{ id: "task-1", task: "Test task" }]
			mockController.getStateToPostToWebview.resolves({
				mode: "act",
				clineMessages: [],
				taskHistory,
			})

			const cmd = createTaskRestoreCommand(config, logger, formatter)
			await cmd.parseAsync(["node", "test", "not-a-number"])

			expect((formatter.error as sinon.SinonStub).calledOnce).to.be.true
			expect((formatter.error as sinon.SinonStub).firstCall.args[0]).to.include("Invalid checkpoint ID")
			expect(exitStub.calledWith(1)).to.be.true
		})

		it("should error when checkpoint not found", async () => {
			const messages = [{ ts: 1000, type: "say" as const, say: "text" as const, text: "Hello" }]
			mockTask.messageStateHandler.getClineMessages.returns(messages)
			mockController.task = mockTask

			const taskHistory = [{ id: "task-1", task: "Test task" }]
			mockController.getStateToPostToWebview.resolves({
				mode: "act",
				clineMessages: messages,
				taskHistory,
			})

			const cmd = createTaskRestoreCommand(config, logger, formatter)
			await cmd.parseAsync(["node", "test", "9999"])

			expect((formatter.error as sinon.SinonStub).calledOnce).to.be.true
			expect((formatter.error as sinon.SinonStub).firstCall.args[0]).to.include("not found")
			expect(exitStub.calledWith(1)).to.be.true
		})

		it("should error when timestamp exists but is not a checkpoint", async () => {
			const messages = [{ ts: 1000, type: "say" as const, say: "text" as const, text: "Hello" }]
			mockTask.messageStateHandler.getClineMessages.returns(messages)
			mockController.task = mockTask

			const taskHistory = [{ id: "task-1", task: "Test task" }]
			mockController.getStateToPostToWebview.resolves({
				mode: "act",
				clineMessages: messages,
				taskHistory,
			})

			const cmd = createTaskRestoreCommand(config, logger, formatter)
			await cmd.parseAsync(["node", "test", "1000"])

			expect((formatter.error as sinon.SinonStub).calledOnce).to.be.true
			expect((formatter.error as sinon.SinonStub).firstCall.args[0]).to.include("not a checkpoint")
			expect(exitStub.calledWith(1)).to.be.true
		})

		it("should error on invalid restore type", async () => {
			const messages = [{ ts: 1000, type: "say" as const, say: "checkpoint_created" as const, text: "" }]
			mockTask.messageStateHandler.getClineMessages.returns(messages)
			mockController.task = mockTask

			const taskHistory = [{ id: "task-1", task: "Test task" }]
			mockController.getStateToPostToWebview.resolves({
				mode: "act",
				clineMessages: messages,
				taskHistory,
			})

			const cmd = createTaskRestoreCommand(config, logger, formatter)
			await cmd.parseAsync(["node", "test", "1000", "-t", "invalid"])

			expect((formatter.error as sinon.SinonStub).calledOnce).to.be.true
			expect((formatter.error as sinon.SinonStub).firstCall.args[0]).to.include("Invalid restore type")
			expect(exitStub.calledWith(1)).to.be.true
		})
	})

	describe("successful restore", () => {
		it("should restore to checkpoint with default type (task)", async () => {
			const messages = [
				{ ts: 1000, type: "say" as const, say: "checkpoint_created" as const, text: "" },
				{ ts: 1001, type: "say" as const, say: "text" as const, text: "After checkpoint" },
			]
			mockTask.messageStateHandler.getClineMessages.returns(messages)
			mockController.task = mockTask

			const taskHistory = [{ id: "task-1", task: "Test task" }]
			mockController.getStateToPostToWebview.resolves({
				mode: "act",
				clineMessages: messages,
				taskHistory,
			})

			const cmd = createTaskRestoreCommand(config, logger, formatter)
			await cmd.parseAsync(["node", "test", "1000"])

			expect(mockController.cancelTask.calledOnce).to.be.true
			expect(mockCheckpointManager.restoreCheckpoint.calledOnce).to.be.true
			expect(mockCheckpointManager.restoreCheckpoint.firstCall.args[0]).to.equal(1000)
			expect(mockCheckpointManager.restoreCheckpoint.firstCall.args[1]).to.equal("task")
			expect((formatter.success as sinon.SinonStub).calledWith("Checkpoint restored successfully")).to.be.true
		})

		it("should restore with taskAndWorkspace type when checkpoint has hash", async () => {
			const messages = [
				{ ts: 1000, type: "say" as const, say: "checkpoint_created" as const, text: "", lastCheckpointHash: "abc123" },
			]
			mockTask.messageStateHandler.getClineMessages.returns(messages)
			mockController.task = mockTask

			const taskHistory = [{ id: "task-1", task: "Test task" }]
			mockController.getStateToPostToWebview.resolves({
				mode: "act",
				clineMessages: messages,
				taskHistory,
			})

			const cmd = createTaskRestoreCommand(config, logger, formatter)
			await cmd.parseAsync(["node", "test", "1000", "-t", "taskAndWorkspace"])

			expect(mockCheckpointManager.restoreCheckpoint.calledOnce).to.be.true
			expect(mockCheckpointManager.restoreCheckpoint.firstCall.args[1]).to.equal("taskAndWorkspace")
		})

		it("should warn when workspace restore requested but no hash available", async () => {
			const messages = [{ ts: 1000, type: "say" as const, say: "checkpoint_created" as const, text: "" }]
			mockTask.messageStateHandler.getClineMessages.returns(messages)
			mockController.task = mockTask

			const taskHistory = [{ id: "task-1", task: "Test task" }]
			mockController.getStateToPostToWebview.resolves({
				mode: "act",
				clineMessages: messages,
				taskHistory,
			})

			const cmd = createTaskRestoreCommand(config, logger, formatter)
			await cmd.parseAsync(["node", "test", "1000", "-t", "taskAndWorkspace"])

			expect((formatter.warn as sinon.SinonStub).called).to.be.true
			expect((formatter.warn as sinon.SinonStub).firstCall.args[0]).to.include("does not have workspace restore data")
		})

		it("should error when workspace-only restore requested but no hash available", async () => {
			const messages = [{ ts: 1000, type: "say" as const, say: "checkpoint_created" as const, text: "" }]
			mockTask.messageStateHandler.getClineMessages.returns(messages)
			mockController.task = mockTask

			const taskHistory = [{ id: "task-1", task: "Test task" }]
			mockController.getStateToPostToWebview.resolves({
				mode: "act",
				clineMessages: messages,
				taskHistory,
			})

			const cmd = createTaskRestoreCommand(config, logger, formatter)
			await cmd.parseAsync(["node", "test", "1000", "-t", "workspace"])

			expect((formatter.error as sinon.SinonStub).calledOnce).to.be.true
			expect((formatter.error as sinon.SinonStub).firstCall.args[0]).to.include("Cannot restore workspace")
			expect(exitStub.calledWith(1)).to.be.true
		})
	})

	describe("list checkpoints (--list option)", () => {
		it("should list checkpoints when --list is provided", async () => {
			const messages = [
				{ ts: 1000, type: "say" as const, say: "text" as const, text: "User message" },
				{ ts: 1001, type: "say" as const, say: "checkpoint_created" as const, text: "", lastCheckpointHash: "abc" },
				{ ts: 1002, type: "say" as const, say: "text" as const, text: "Another message" },
				{ ts: 1003, type: "say" as const, say: "checkpoint_created" as const, text: "" },
			]
			mockTask.messageStateHandler.getClineMessages.returns(messages)
			mockController.task = mockTask

			const taskHistory = [{ id: "task-1", task: "Test task" }]
			mockController.getStateToPostToWebview.resolves({
				mode: "act",
				clineMessages: messages,
				taskHistory,
			})

			const cmd = createTaskRestoreCommand(config, logger, formatter)
			// Use a dummy checkpoint ID since --list overrides
			await cmd.parseAsync(["node", "test", "dummy", "--list"])

			expect((formatter.info as sinon.SinonStub).calledWith(sinon.match(/Checkpoints \(2\)/))).to.be.true
		})

		it("should show no checkpoints message when none exist", async () => {
			const messages = [{ ts: 1000, type: "say" as const, say: "text" as const, text: "Just a message" }]
			mockTask.messageStateHandler.getClineMessages.returns(messages)
			mockController.task = mockTask

			const taskHistory = [{ id: "task-1", task: "Test task" }]
			mockController.getStateToPostToWebview.resolves({
				mode: "act",
				clineMessages: messages,
				taskHistory,
			})

			const cmd = createTaskRestoreCommand(config, logger, formatter)
			await cmd.parseAsync(["node", "test", "dummy", "--list"])

			expect((formatter.info as sinon.SinonStub).calledWith("No checkpoints found in current task")).to.be.true
		})
	})

	describe("helper functions", () => {
		describe("findCheckpoints", () => {
			it("should find all checkpoint messages", () => {
				const messages = [
					{ ts: 1000, type: "say" as const, say: "text" as const, text: "Hello" },
					{ ts: 1001, type: "say" as const, say: "checkpoint_created" as const, text: "" },
					{ ts: 1002, type: "say" as const, say: "text" as const, text: "World" },
					{ ts: 1003, type: "say" as const, say: "checkpoint_created" as const, text: "" },
				] as any[]

				const checkpoints = findCheckpoints(messages)

				expect(checkpoints).to.have.length(2)
				expect(checkpoints[0].ts).to.equal(1001)
				expect(checkpoints[1].ts).to.equal(1003)
			})

			it("should return empty array when no checkpoints", () => {
				const messages = [{ ts: 1000, type: "say" as const, say: "text" as const, text: "Hello" }] as any[]

				const checkpoints = findCheckpoints(messages)

				expect(checkpoints).to.have.length(0)
			})
		})

		describe("validateCheckpoint", () => {
			it("should return checkpoint when valid", () => {
				const messages = [{ ts: 1000, type: "say" as const, say: "checkpoint_created" as const, text: "" }] as any[]

				const result = validateCheckpoint(messages, 1000)

				expect(result).to.not.be.null
				expect(result?.ts).to.equal(1000)
			})

			it("should return null when timestamp not found", () => {
				const messages = [{ ts: 1000, type: "say" as const, say: "checkpoint_created" as const, text: "" }] as any[]

				const result = validateCheckpoint(messages, 9999)

				expect(result).to.be.null
			})

			it("should return null when timestamp exists but not a checkpoint", () => {
				const messages = [{ ts: 1000, type: "say" as const, say: "text" as const, text: "Hello" }] as any[]

				const result = validateCheckpoint(messages, 1000)

				expect(result).to.be.null
			})
		})

		describe("formatCheckpointList", () => {
			it("should format checkpoints with context", () => {
				const now = Date.now()
				const messages = [
					{ ts: now - 60000, type: "say" as const, say: "text" as const, text: "User asked something" },
					{
						ts: now - 59000,
						type: "say" as const,
						say: "checkpoint_created" as const,
						text: "",
						lastCheckpointHash: "abc",
					},
				] as any[]

				const formatted = formatCheckpointList(messages)

				expect(formatted).to.have.length(1)
				expect(formatted[0].id).to.equal(now - 59000)
				expect(formatted[0].hasWorkspaceRestore).to.be.true
				expect(formatted[0].context).to.include("User asked")
			})

			it("should indicate when workspace restore is not available", () => {
				const now = Date.now()
				const messages = [
					{ ts: now - 60000, type: "say" as const, say: "text" as const, text: "User message" },
					{ ts: now - 59000, type: "say" as const, say: "checkpoint_created" as const, text: "" },
				] as any[]

				const formatted = formatCheckpointList(messages)

				expect(formatted[0].hasWorkspaceRestore).to.be.false
			})
		})
	})

	describe("no active task", () => {
		it("should initialize most recent task when no task is active", async () => {
			mockController.task = null
			const taskHistory = [{ id: "task-1", task: "Test task" }]
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
				return "task-1"
			})

			const messages = [{ ts: 1000, type: "say" as const, say: "checkpoint_created" as const, text: "" }]
			mockTask.messageStateHandler.getClineMessages.returns(messages)

			const cmd = createTaskRestoreCommand(config, logger, formatter)
			await cmd.parseAsync(["node", "test", "1000"])

			expect(mockController.initTask.calledOnce).to.be.true
		})

		it("should error when no tasks exist", async () => {
			mockController.task = null
			mockController.getStateToPostToWebview.resolves({
				mode: "act",
				clineMessages: [],
				taskHistory: [],
			})

			const cmd = createTaskRestoreCommand(config, logger, formatter)
			await cmd.parseAsync(["node", "test", "1000"])

			expect((formatter.error as sinon.SinonStub).calledOnce).to.be.true
			expect((formatter.error as sinon.SinonStub).firstCall.args[0]).to.include("No tasks found")
			expect(exitStub.calledWith(1)).to.be.true
		})
	})

	describe("cleanup", () => {
		it("should dispose controller after success", async () => {
			const messages = [{ ts: 1000, type: "say" as const, say: "checkpoint_created" as const, text: "" }]
			mockTask.messageStateHandler.getClineMessages.returns(messages)
			mockController.task = mockTask

			const taskHistory = [{ id: "task-1", task: "Test task" }]
			mockController.getStateToPostToWebview.resolves({
				mode: "act",
				clineMessages: messages,
				taskHistory,
			})

			const cmd = createTaskRestoreCommand(config, logger, formatter)
			await cmd.parseAsync(["node", "test", "1000"])

			expect(disposeControllerStub.calledOnce).to.be.true
		})

		it("should dispose controller after error", async () => {
			mockController.task = mockTask
			const taskHistory = [{ id: "task-1", task: "Test task" }]
			mockController.getStateToPostToWebview.resolves({
				mode: "act",
				clineMessages: [],
				taskHistory,
			})

			const cmd = createTaskRestoreCommand(config, logger, formatter)
			await cmd.parseAsync(["node", "test", "invalid-id"])

			expect(disposeControllerStub.calledOnce).to.be.true
		})
	})
})
