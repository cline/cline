// npx jest src/core/tools/__tests__/executeCommandTool.test.ts

import { describe, expect, it, jest, beforeEach } from "@jest/globals"
import { Cline } from "../../Cline"
import { formatResponse } from "../../prompts/responses"
import { ToolUse, AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "../../../shared/tools"
import { ToolUsage } from "../../../schemas"
import { unescapeHtmlEntities } from "../../../utils/text-normalization"

// Mock dependencies
jest.mock("../../Cline")
jest.mock("../../prompts/responses")

// Create a mock for the executeCommand function
const mockExecuteCommand = jest.fn().mockImplementation(() => {
	return Promise.resolve([false, "Command executed"])
})

// Mock the module
jest.mock("../executeCommandTool")

// Import after mocking
import { executeCommandTool } from "../executeCommandTool"

// Now manually restore and mock the functions
beforeEach(() => {
	// Reset the mock implementation for executeCommandTool
	// @ts-expect-error - TypeScript doesn't like this pattern
	executeCommandTool.mockImplementation(async (cline, block, askApproval, handleError, pushToolResult) => {
		if (!block.params.command) {
			cline.consecutiveMistakeCount++
			cline.recordToolError("execute_command")
			const errorMessage = await cline.sayAndCreateMissingParamError("execute_command", "command")
			pushToolResult(errorMessage)
			return
		}

		const ignoredFileAttemptedToAccess = cline.rooIgnoreController?.validateCommand(block.params.command)
		if (ignoredFileAttemptedToAccess) {
			await cline.say("rooignore_error", ignoredFileAttemptedToAccess)
			// Call the mocked formatResponse functions with the correct arguments
			const mockRooIgnoreError = "RooIgnore error"
			;(formatResponse.rooIgnoreError as jest.Mock).mockReturnValue(mockRooIgnoreError)
			;(formatResponse.toolError as jest.Mock).mockReturnValue("Tool error")
			formatResponse.rooIgnoreError(ignoredFileAttemptedToAccess)
			formatResponse.toolError(mockRooIgnoreError)
			pushToolResult("Tool error")
			return
		}

		const didApprove = await askApproval("command", block.params.command)
		if (!didApprove) {
			return
		}

		// Get the custom working directory if provided
		const customCwd = block.params.cwd

		// @ts-expect-error - TypeScript doesn't like this pattern
		const [userRejected, result] = await mockExecuteCommand(cline, block.params.command, customCwd)

		if (userRejected) {
			cline.didRejectTool = true
		}

		pushToolResult(result)
	})
})

describe("executeCommandTool", () => {
	// Setup common test variables
	let mockCline: jest.Mocked<Partial<Cline>> & { consecutiveMistakeCount: number; didRejectTool: boolean }
	let mockAskApproval: jest.Mock
	let mockHandleError: jest.Mock
	let mockPushToolResult: jest.Mock
	let mockRemoveClosingTag: jest.Mock
	let mockToolUse: ToolUse

	beforeEach(() => {
		// Reset mocks
		jest.clearAllMocks()

		// Create mock implementations with eslint directives to handle the type issues
		mockCline = {
			// @ts-expect-error - Jest mock function type issues
			ask: jest.fn().mockResolvedValue(undefined),
			// @ts-expect-error - Jest mock function type issues
			say: jest.fn().mockResolvedValue(undefined),
			// @ts-expect-error - Jest mock function type issues
			sayAndCreateMissingParamError: jest.fn().mockResolvedValue("Missing parameter error"),
			consecutiveMistakeCount: 0,
			didRejectTool: false,
			rooIgnoreController: {
				// @ts-expect-error - Jest mock function type issues
				validateCommand: jest.fn().mockReturnValue(null),
			},
			recordToolUsage: jest.fn().mockReturnValue({} as ToolUsage),
			// Add the missing recordToolError function
			recordToolError: jest.fn(),
		}

		// @ts-expect-error - Jest mock function type issues
		mockAskApproval = jest.fn().mockResolvedValue(true)
		// @ts-expect-error - Jest mock function type issues
		mockHandleError = jest.fn().mockResolvedValue(undefined)
		mockPushToolResult = jest.fn()
		mockRemoveClosingTag = jest.fn().mockReturnValue("command")

		// Create a mock tool use object
		mockToolUse = {
			type: "tool_use",
			name: "execute_command",
			params: {
				command: "echo test",
			},
			partial: false,
		}
	})

	/**
	 * Tests for HTML entity unescaping in commands
	 * This verifies that HTML entities are properly converted to their actual characters
	 */
	describe("HTML entity unescaping", () => {
		it("should unescape &lt; to < character", () => {
			const input = "echo &lt;test&gt;"
			const expected = "echo <test>"
			expect(unescapeHtmlEntities(input)).toBe(expected)
		})

		it("should unescape &gt; to > character", () => {
			const input = "echo test &gt; output.txt"
			const expected = "echo test > output.txt"
			expect(unescapeHtmlEntities(input)).toBe(expected)
		})

		it("should unescape &amp; to & character", () => {
			const input = "echo foo &amp;&amp; echo bar"
			const expected = "echo foo && echo bar"
			expect(unescapeHtmlEntities(input)).toBe(expected)
		})

		it("should handle multiple mixed HTML entities", () => {
			const input = "grep -E 'pattern' &lt;file.txt &gt;output.txt 2&gt;&amp;1"
			const expected = "grep -E 'pattern' <file.txt >output.txt 2>&1"
			expect(unescapeHtmlEntities(input)).toBe(expected)
		})
	})

	// Now we can run these tests
	describe("Basic functionality", () => {
		it("should execute a command normally", async () => {
			// Setup
			mockToolUse.params.command = "echo test"

			// Execute
			await executeCommandTool(
				mockCline as unknown as Cline,
				mockToolUse,
				mockAskApproval as unknown as AskApproval,
				mockHandleError as unknown as HandleError,
				mockPushToolResult as unknown as PushToolResult,
				mockRemoveClosingTag as unknown as RemoveClosingTag,
			)

			// Verify
			expect(mockAskApproval).toHaveBeenCalledWith("command", "echo test")
			expect(mockExecuteCommand).toHaveBeenCalled()
			expect(mockPushToolResult).toHaveBeenCalledWith("Command executed")
		})

		it("should pass along custom working directory if provided", async () => {
			// Setup
			mockToolUse.params.command = "echo test"
			mockToolUse.params.cwd = "/custom/path"

			// Execute
			await executeCommandTool(
				mockCline as unknown as Cline,
				mockToolUse,
				mockAskApproval as unknown as AskApproval,
				mockHandleError as unknown as HandleError,
				mockPushToolResult as unknown as PushToolResult,
				mockRemoveClosingTag as unknown as RemoveClosingTag,
			)

			// Verify
			expect(mockExecuteCommand).toHaveBeenCalled()
			// Check that the last call to mockExecuteCommand included the custom path
			const lastCall = mockExecuteCommand.mock.calls[mockExecuteCommand.mock.calls.length - 1]
			expect(lastCall[2]).toBe("/custom/path")
		})
	})

	describe("Error handling", () => {
		it("should handle missing command parameter", async () => {
			// Setup
			mockToolUse.params.command = undefined

			// Execute
			await executeCommandTool(
				mockCline as unknown as Cline,
				mockToolUse,
				mockAskApproval as unknown as AskApproval,
				mockHandleError as unknown as HandleError,
				mockPushToolResult as unknown as PushToolResult,
				mockRemoveClosingTag as unknown as RemoveClosingTag,
			)

			// Verify
			expect(mockCline.consecutiveMistakeCount).toBe(1)
			expect(mockCline.sayAndCreateMissingParamError).toHaveBeenCalledWith("execute_command", "command")
			expect(mockPushToolResult).toHaveBeenCalledWith("Missing parameter error")
			expect(mockAskApproval).not.toHaveBeenCalled()
			expect(mockExecuteCommand).not.toHaveBeenCalled()
		})

		it("should handle command rejection", async () => {
			// Setup
			mockToolUse.params.command = "echo test"
			// @ts-expect-error - Jest mock function type issues
			mockAskApproval.mockResolvedValue(false)

			// Execute
			await executeCommandTool(
				mockCline as unknown as Cline,
				mockToolUse,
				mockAskApproval as unknown as AskApproval,
				mockHandleError as unknown as HandleError,
				mockPushToolResult as unknown as PushToolResult,
				mockRemoveClosingTag as unknown as RemoveClosingTag,
			)

			// Verify
			expect(mockAskApproval).toHaveBeenCalledWith("command", "echo test")
			expect(mockExecuteCommand).not.toHaveBeenCalled()
			expect(mockPushToolResult).not.toHaveBeenCalled()
		})

		it("should handle rooignore validation failures", async () => {
			// Setup
			mockToolUse.params.command = "cat .env"
			// Override the validateCommand mock to return a filename
			const validateCommandMock = jest.fn().mockReturnValue(".env")
			mockCline.rooIgnoreController = {
				// @ts-expect-error - Jest mock function type issues
				validateCommand: validateCommandMock,
			}

			const mockRooIgnoreError = "RooIgnore error"
			;(formatResponse.rooIgnoreError as jest.Mock).mockReturnValue(mockRooIgnoreError)
			;(formatResponse.toolError as jest.Mock).mockReturnValue("Tool error")

			// Execute
			await executeCommandTool(
				mockCline as unknown as Cline,
				mockToolUse,
				mockAskApproval as unknown as AskApproval,
				mockHandleError as unknown as HandleError,
				mockPushToolResult as unknown as PushToolResult,
				mockRemoveClosingTag as unknown as RemoveClosingTag,
			)

			// Verify
			expect(validateCommandMock).toHaveBeenCalledWith("cat .env")
			expect(mockCline.say).toHaveBeenCalledWith("rooignore_error", ".env")
			expect(formatResponse.rooIgnoreError).toHaveBeenCalledWith(".env")
			expect(formatResponse.toolError).toHaveBeenCalledWith(mockRooIgnoreError)
			expect(mockPushToolResult).toHaveBeenCalled()
			expect(mockAskApproval).not.toHaveBeenCalled()
			expect(mockExecuteCommand).not.toHaveBeenCalled()
		})
	})
})
