import { afterEach, beforeEach, describe, it } from "mocha"
import * as should from "should"
import * as sinon from "sinon"
import { createClineAPI } from "@/exports"
import { Logger } from "@/shared/services/Logger"
import type { ClineAPI } from "../exports/cline"
import { setVscodeHostProviderMock } from "./host-provider-test-utils"

describe("ClineAPI Core Functionality", () => {
	let api: ClineAPI
	let mockController: any
	let mockLoggerError: sinon.SinonStub
	let sandbox: sinon.SinonSandbox
	let _getGlobalStateStub: sinon.SinonStub

	beforeEach(async () => {
		sandbox = sinon.createSandbox()

		// Stub Logger.error
		mockLoggerError = sandbox.stub(Logger, "error")
		setVscodeHostProviderMock({})

		// Create a mock controller that matches what the real createClineAPI expects
		// We don't import the real Controller to avoid the webview dependencies
		mockController = {
			id: "test-controller-id",
			context: {
				globalState: {
					get: sandbox.stub(),
					update: sandbox.stub(),
					keys: sandbox.stub().returns([]),
					setKeysForSync: sandbox.stub(),
				},
				secrets: {
					get: sandbox.stub(),
					store: sandbox.stub(),
					delete: sandbox.stub(),
					onDidChange: sandbox.stub(),
				},
			},
			updateCustomInstructions: sandbox.stub().resolves(),
			clearTask: sandbox.stub().resolves(),
			postStateToWebview: sandbox.stub().resolves(),
			postMessageToWebview: sandbox.stub().resolves(),
			initTask: sandbox.stub().resolves(),
			task: undefined,
		}

		// Create API instance
		api = createClineAPI(mockController)
	})

	afterEach(() => {
		sandbox.restore()
	})

	describe("startNewTask", () => {
		it("should clear existing task and start new one with description", async () => {
			const taskDescription = "Create a test function"
			const images = ["image1.png", "image2.png"]

			await api.startNewTask(taskDescription, images)

			// Verify task clearing sequence
			sinon.assert.called(mockController.clearTask)
			sinon.assert.called(mockController.postStateToWebview)
			sinon.assert.calledWith(mockController.initTask, taskDescription, images)
		})

		it("should handle undefined task description", async () => {
			await api.startNewTask(undefined, [])

			sinon.assert.called(mockController.clearTask)
			sinon.assert.calledWith(mockController.initTask, undefined, [])
		})

		it("should handle task with no images", async () => {
			await api.startNewTask("Task without images")

			sinon.assert.calledWith(mockController.initTask, "Task without images", undefined)
		})
	})

	describe("sendMessage", () => {
		it("should send message to active task", async () => {
			const mockTask = {
				handleWebviewAskResponse: sandbox.stub().resolves(),
			}
			mockController.task = mockTask

			await api.sendMessage("Test message", ["image.png"])

			sinon.assert.calledWith(mockTask.handleWebviewAskResponse, "messageResponse", "Test message", ["image.png"])
		})

		it("should handle no active task gracefully", async () => {
			mockController.task = undefined

			await api.sendMessage("Message to nowhere", [])
		})

		it("should handle empty message", async () => {
			const mockTask = {
				handleWebviewAskResponse: sandbox.stub().resolves(),
			}
			mockController.task = mockTask

			await api.sendMessage("", [])

			sinon.assert.calledWith(mockTask.handleWebviewAskResponse, "messageResponse", "", [])
		})

		it("should handle undefined message", async () => {
			const mockTask = {
				handleWebviewAskResponse: sandbox.stub().resolves(),
			}
			mockController.task = mockTask

			await api.sendMessage(undefined, [])

			sinon.assert.calledWith(mockTask.handleWebviewAskResponse, "messageResponse", "", [])
		})
	})

	describe("Button Press Methods", () => {
		describe("pressPrimaryButton", () => {
			it("should handle primary button press with active task", async () => {
				const mockTask = {
					handleWebviewAskResponse: sandbox.stub().resolves(),
				}
				mockController.task = mockTask

				await api.pressPrimaryButton()

				sinon.assert.calledWith(mockTask.handleWebviewAskResponse, "yesButtonClicked", "", [])
			})

			it("should handle primary button press with no active task", async () => {
				mockController.task = undefined

				await api.pressPrimaryButton()

				sinon.assert.calledWith(mockLoggerError, "No active task to press button for")
			})
		})

		describe("pressSecondaryButton", () => {
			it("should handle secondary button press with active task", async () => {
				const mockTask = {
					handleWebviewAskResponse: sandbox.stub().resolves(),
				}
				mockController.task = mockTask

				await api.pressSecondaryButton()

				sinon.assert.calledWith(mockTask.handleWebviewAskResponse, "noButtonClicked", "", [])
			})

			it("should handle secondary button press with no active task", async () => {
				mockController.task = undefined

				await api.pressSecondaryButton()

				sinon.assert.calledWith(mockLoggerError, "No active task to press button for")
			})
		})
	})

	describe("Error Handling", () => {
		it("should handle errors in task initialization", async () => {
			mockController.initTask.rejects(new Error("Init failed"))

			try {
				await api.startNewTask("test task")
				should.fail("", "", "Should have thrown an error", "")
			} catch (error: any) {
				error.message.should.equal("Init failed")
			}
		})
	})
})
