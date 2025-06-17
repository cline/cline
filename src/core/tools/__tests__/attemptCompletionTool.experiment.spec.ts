// Mocks must come first, before imports
vi.mock("../executeCommandTool", () => ({
	executeCommand: vi.fn(),
}))

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureTaskCompleted: vi.fn(),
		},
	},
}))

// Then imports
import type { Mock } from "vitest"
import { attemptCompletionTool } from "../attemptCompletionTool"
import { EXPERIMENT_IDS } from "../../../shared/experiments"
import { executeCommand } from "../executeCommandTool"

describe("attemptCompletionTool - DISABLE_COMPLETION_COMMAND experiment", () => {
	let mockCline: any
	let mockAskApproval: Mock
	let mockHandleError: Mock
	let mockPushToolResult: Mock
	let mockRemoveClosingTag: Mock
	let mockToolDescription: Mock
	let mockAskFinishSubTaskApproval: Mock

	beforeEach(() => {
		vi.clearAllMocks()

		mockAskApproval = vi.fn().mockResolvedValue(true)
		mockHandleError = vi.fn()
		mockPushToolResult = vi.fn()
		mockRemoveClosingTag = vi.fn((tag, content) => content)
		mockToolDescription = vi.fn().mockReturnValue("attempt_completion")
		mockAskFinishSubTaskApproval = vi.fn()

		mockCline = {
			say: vi.fn(),
			ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked", text: "", images: [] }),
			clineMessages: [],
			lastMessageTs: Date.now(),
			consecutiveMistakeCount: 0,
			sayAndCreateMissingParamError: vi.fn(),
			recordToolError: vi.fn(),
			emit: vi.fn(),
			getTokenUsage: vi.fn().mockReturnValue({}),
			toolUsage: {},
			userMessageContent: [],
			taskId: "test-task-id",
			providerRef: {
				deref: vi.fn().mockReturnValue({
					getState: vi.fn().mockResolvedValue({
						experiments: {},
					}),
				}),
			},
		}
	})

	describe("when experiment is disabled (default)", () => {
		beforeEach(() => {
			mockCline.providerRef.deref().getState.mockResolvedValue({
				experiments: {
					[EXPERIMENT_IDS.DISABLE_COMPLETION_COMMAND]: false,
				},
			})
		})

		it("should execute command when provided", async () => {
			const mockExecuteCommand = executeCommand as Mock
			mockExecuteCommand.mockResolvedValue([false, "Command executed successfully"])

			// Mock clineMessages with a previous message that's not a command ask
			mockCline.clineMessages = [{ say: "previous_message", text: "Previous message" }]

			const block = {
				params: {
					result: "Task completed successfully",
					command: "npm test",
				},
				partial: false,
			}

			await attemptCompletionTool(
				mockCline,
				block as any,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
				mockToolDescription,
				mockAskFinishSubTaskApproval,
			)

			// When there's a lastMessage that's not a command ask, it should say completion_result first
			expect(mockCline.say).toHaveBeenCalledWith(
				"completion_result",
				"Task completed successfully",
				undefined,
				false,
			)
			expect(mockCline.emit).toHaveBeenCalledWith(
				"taskCompleted",
				mockCline.taskId,
				expect.any(Object),
				expect.any(Object),
			)
			expect(mockAskApproval).toHaveBeenCalledWith("command", "npm test")
			expect(mockExecuteCommand).toHaveBeenCalled()
		})

		it("should not execute command when user rejects", async () => {
			mockAskApproval.mockResolvedValue(false)
			const mockExecuteCommand = executeCommand as Mock

			// Mock clineMessages with a previous message that's not a command ask
			mockCline.clineMessages = [{ say: "previous_message", text: "Previous message" }]

			const block = {
				params: {
					result: "Task completed successfully",
					command: "npm test",
				},
				partial: false,
			}

			await attemptCompletionTool(
				mockCline,
				block as any,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
				mockToolDescription,
				mockAskFinishSubTaskApproval,
			)

			// Should say completion_result and emit before asking for approval
			expect(mockCline.say).toHaveBeenCalledWith(
				"completion_result",
				"Task completed successfully",
				undefined,
				false,
			)
			expect(mockCline.emit).toHaveBeenCalledWith(
				"taskCompleted",
				mockCline.taskId,
				expect.any(Object),
				expect.any(Object),
			)
			expect(mockAskApproval).toHaveBeenCalledWith("command", "npm test")
			expect(mockExecuteCommand).not.toHaveBeenCalled()
		})
	})

	describe("when experiment is enabled", () => {
		beforeEach(() => {
			mockCline.providerRef.deref().getState.mockResolvedValue({
				experiments: {
					[EXPERIMENT_IDS.DISABLE_COMPLETION_COMMAND]: true,
				},
			})
		})

		it("should NOT execute command even when provided", async () => {
			const mockExecuteCommand = executeCommand as Mock

			const block = {
				params: {
					result: "Task completed successfully",
					command: "npm test",
				},
				partial: false,
			}

			await attemptCompletionTool(
				mockCline,
				block as any,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
				mockToolDescription,
				mockAskFinishSubTaskApproval,
			)

			expect(mockCline.say).toHaveBeenCalledWith(
				"completion_result",
				"Task completed successfully",
				undefined,
				false,
			)
			expect(mockAskApproval).not.toHaveBeenCalled()
			expect(mockExecuteCommand).not.toHaveBeenCalled()
		})

		it("should complete normally without command execution", async () => {
			const block = {
				params: {
					result: "Task completed successfully",
					command: "npm test",
				},
				partial: false,
			}

			await attemptCompletionTool(
				mockCline,
				block as any,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
				mockToolDescription,
				mockAskFinishSubTaskApproval,
			)

			expect(mockCline.say).toHaveBeenCalledWith(
				"completion_result",
				"Task completed successfully",
				undefined,
				false,
			)
			expect(mockCline.emit).toHaveBeenCalledWith(
				"taskCompleted",
				mockCline.taskId,
				expect.any(Object),
				expect.any(Object),
			)
			expect(mockAskApproval).not.toHaveBeenCalled()
		})
	})

	describe("when no command is provided", () => {
		it("should work the same regardless of experiment state", async () => {
			const block = {
				params: {
					result: "Task completed successfully",
				},
				partial: false,
			}

			// Test with experiment disabled
			mockCline.providerRef.deref().getState.mockResolvedValue({
				experiments: {
					[EXPERIMENT_IDS.DISABLE_COMPLETION_COMMAND]: false,
				},
			})

			await attemptCompletionTool(
				mockCline,
				block as any,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
				mockToolDescription,
				mockAskFinishSubTaskApproval,
			)

			expect(mockCline.say).toHaveBeenCalledWith(
				"completion_result",
				"Task completed successfully",
				undefined,
				false,
			)
			expect(mockAskApproval).not.toHaveBeenCalled()

			// Reset mocks
			vi.clearAllMocks()

			// Test with experiment enabled
			mockCline.providerRef.deref().getState.mockResolvedValue({
				experiments: {
					[EXPERIMENT_IDS.DISABLE_COMPLETION_COMMAND]: true,
				},
			})

			await attemptCompletionTool(
				mockCline,
				block as any,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
				mockToolDescription,
				mockAskFinishSubTaskApproval,
			)

			expect(mockCline.say).toHaveBeenCalledWith(
				"completion_result",
				"Task completed successfully",
				undefined,
				false,
			)
			expect(mockAskApproval).not.toHaveBeenCalled()
		})
	})

	describe("error handling", () => {
		it("should handle missing result parameter", async () => {
			const block = {
				params: {},
				partial: false,
			}

			await attemptCompletionTool(
				mockCline,
				block as any,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
				mockToolDescription,
				mockAskFinishSubTaskApproval,
			)

			expect(mockCline.consecutiveMistakeCount).toBe(1)
			expect(mockCline.recordToolError).toHaveBeenCalledWith("attempt_completion")
			expect(mockCline.sayAndCreateMissingParamError).toHaveBeenCalledWith("attempt_completion", "result")
		})

		it("should handle state retrieval errors gracefully", async () => {
			// Mock provider ref to return null
			mockCline.providerRef.deref.mockReturnValue(null)

			// Mock clineMessages to simulate no previous messages
			mockCline.clineMessages = []

			const block = {
				params: {
					result: "Task completed successfully",
					command: "npm test",
				},
				partial: false,
			}

			await attemptCompletionTool(
				mockCline,
				block as any,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
				mockToolDescription,
				mockAskFinishSubTaskApproval,
			)

			// When state retrieval fails, it defaults to not disabled (false), so it will try to execute command
			// Since there's no lastMessage, it goes directly to askApproval
			expect(mockAskApproval).toHaveBeenCalledWith("command", "npm test")
			expect(mockCline.say).not.toHaveBeenCalled()
		})
	})
})
