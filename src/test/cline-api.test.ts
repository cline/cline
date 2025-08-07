import { createClineAPI } from "@/exports"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as should from "should"
import * as sinon from "sinon"
import type { ClineAPI } from "../exports/cline"
import { setVscodeHostProviderMock } from "./host-provider-test-utils"

describe("ClineAPI Core Functionality", () => {
	let api: ClineAPI
	let mockController: any
	let mockLogToChannel: sinon.SinonStub<[string], void>
	let sandbox: sinon.SinonSandbox
	let getGlobalStateStub: sinon.SinonStub

	beforeEach(async () => {
		sandbox = sinon.createSandbox()

		// Create mock log function
		mockLogToChannel = sandbox.stub<[string], void>()
		setVscodeHostProviderMock({ logToChannel: mockLogToChannel })

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

			// Verify logging - first it logs "Starting new task"
			sinon.assert.calledWith(mockLogToChannel, "Starting new task")
			// Then it logs the task details
			sinon.assert.calledWith(mockLogToChannel, `Task started with message: "Create a test function" and 2 image(s)`)
		})

		it("should handle undefined task description", async () => {
			await api.startNewTask(undefined, [])

			sinon.assert.called(mockController.clearTask)
			sinon.assert.calledWith(mockController.initTask, undefined, [])

			sinon.assert.calledWith(mockLogToChannel, "Task started with message: undefined and 0 image(s)")
		})

		it("should handle task with no images", async () => {
			await api.startNewTask("Task without images")

			sinon.assert.calledWith(mockController.initTask, "Task without images", undefined)

			sinon.assert.calledWith(mockLogToChannel, `Task started with message: "Task without images" and 0 image(s)`)
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

			sinon.assert.calledWith(mockLogToChannel, `Sending message: "Test message" with 1 image(s)`)
		})

		it("should handle no active task gracefully", async () => {
			mockController.task = undefined

			await api.sendMessage("Message to nowhere", [])

			sinon.assert.calledWith(mockLogToChannel, "No active task to send message to")
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

			sinon.assert.calledWith(mockLogToChannel, `Sending message: undefined with 0 image(s)`)
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

				sinon.assert.calledWith(mockLogToChannel, "Pressing primary button")
			})

			it("should handle primary button press with no active task", async () => {
				mockController.task = undefined

				await api.pressPrimaryButton()

				sinon.assert.calledWith(mockLogToChannel, "No active task to press button for")
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

				sinon.assert.calledWith(mockLogToChannel, "Pressing secondary button")
			})

			it("should handle secondary button press with no active task", async () => {
				mockController.task = undefined

				await api.pressSecondaryButton()

				sinon.assert.calledWith(mockLogToChannel, "No active task to press button for")
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
