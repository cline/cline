// npx jest src/core/tools/__tests__/executeCommandTool.test.ts

import { describe, expect, it, jest, beforeEach } from "@jest/globals"
import { executeCommandTool } from "../executeCommandTool"
import { Cline } from "../../Cline"
import { ToolUse } from "../../assistant-message"
import { formatResponse } from "../../prompts/responses"
import { AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "../types"
import { ClineAsk } from "../../../schemas"

// Mock dependencies
jest.mock("../../Cline")
jest.mock("../../prompts/responses")

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
			// @ts-expect-error - Jest mock function type issues
			executeCommandTool: jest.fn().mockResolvedValue([false, "Command executed"]),
			consecutiveMistakeCount: 0,
			didRejectTool: false,
			rooIgnoreController: {
				// @ts-expect-error - Jest mock function type issues
				validateCommand: jest.fn().mockReturnValue(null),
			},
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
	 * before the command is executed
	 */
	describe("HTML entity unescaping", () => {
		it("should unescape &lt; to < character in commands", async () => {
			// Setup
			mockToolUse.params.command = "echo &lt;test&gt;"

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
			expect(mockAskApproval).toHaveBeenCalledWith("command", "echo <test>")
			expect(mockCline.executeCommandTool).toHaveBeenCalledWith("echo <test>", undefined)
		})

		it("should unescape &gt; to > character in commands", async () => {
			// Setup
			mockToolUse.params.command = "echo test &gt; output.txt"

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
			expect(mockAskApproval).toHaveBeenCalledWith("command", "echo test > output.txt")
			expect(mockCline.executeCommandTool).toHaveBeenCalledWith("echo test > output.txt", undefined)
		})

		it("should unescape &amp; to & character in commands", async () => {
			// Setup
			mockToolUse.params.command = "echo foo &amp;&amp; echo bar"

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
			expect(mockAskApproval).toHaveBeenCalledWith("command", "echo foo && echo bar")
			expect(mockCline.executeCommandTool).toHaveBeenCalledWith("echo foo && echo bar", undefined)
		})

		it("should handle multiple mixed HTML entities in commands", async () => {
			// Setup
			mockToolUse.params.command = "grep -E 'pattern' &lt;file.txt &gt;output.txt 2&gt;&amp;1"

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
			const expectedCommand = "grep -E 'pattern' <file.txt >output.txt 2>&1"
			expect(mockAskApproval).toHaveBeenCalledWith("command", expectedCommand)
			expect(mockCline.executeCommandTool).toHaveBeenCalledWith(expectedCommand, undefined)
		})
	})

	// Other functionality tests
	describe("Basic functionality", () => {
		it("should execute a command normally without HTML entities", async () => {
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
			expect(mockCline.executeCommandTool).toHaveBeenCalledWith("echo test", undefined)
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
			expect(mockCline.executeCommandTool).toHaveBeenCalledWith("echo test", "/custom/path")
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
			expect(mockCline.executeCommandTool).not.toHaveBeenCalled()
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
			expect(mockCline.executeCommandTool).not.toHaveBeenCalled()
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
			expect(mockCline.executeCommandTool).not.toHaveBeenCalled()
		})
	})
})
