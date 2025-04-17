// npx jest src/core/tools/__tests__/appendToFileTool.test.ts

import { describe, expect, it, jest, beforeEach } from "@jest/globals"

import { appendToFileTool } from "../appendToFileTool"
import { Cline } from "../../Cline"
import { formatResponse } from "../../prompts/responses"
import { ToolUse, AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "../../../shared/tools"
import { ClineAsk } from "../../../shared/ExtensionMessage"
import { FileContextTracker } from "../../context-tracking/FileContextTracker"
import { DiffViewProvider } from "../../../integrations/editor/DiffViewProvider"
import { RooIgnoreController } from "../../ignore/RooIgnoreController"

// Mock dependencies
jest.mock("../../Cline")
jest.mock("../../prompts/responses")
jest.mock("delay")

describe("appendToFileTool", () => {
	// Setup common test variables
	let mockCline: jest.Mocked<Partial<Cline>> & {
		consecutiveMistakeCount: number
		didEditFile: boolean
		cwd: string
	}
	let mockAskApproval: jest.Mock
	let mockHandleError: jest.Mock
	let mockPushToolResult: jest.Mock
	let mockRemoveClosingTag: jest.Mock
	let mockToolUse: ToolUse
	let mockDiffViewProvider: jest.Mocked<Partial<DiffViewProvider>>
	let mockFileContextTracker: jest.Mocked<Partial<FileContextTracker>>

	beforeEach(() => {
		// Reset mocks
		jest.clearAllMocks()

		mockDiffViewProvider = {
			editType: undefined,
			isEditing: false,
			originalContent: "",
			open: jest.fn().mockReturnValue(Promise.resolve()),
			update: jest.fn().mockReturnValue(Promise.resolve()),
			reset: jest.fn().mockReturnValue(Promise.resolve()),
			revertChanges: jest.fn().mockReturnValue(Promise.resolve()),
			saveChanges: jest.fn().mockReturnValue(
				Promise.resolve({
					newProblemsMessage: "",
					userEdits: undefined,
					finalContent: "",
				}),
			),
			scrollToFirstDiff: jest.fn(),
			createdDirs: [],
			documentWasOpen: false,
			streamedLines: [],
			preDiagnostics: [],
			postDiagnostics: [],
			isEditorOpen: false,
			hasChanges: false,
		} as unknown as jest.Mocked<DiffViewProvider>

		mockFileContextTracker = {
			trackFileContext: jest.fn().mockReturnValue(Promise.resolve()),
		} as unknown as jest.Mocked<FileContextTracker>

		// Create mock implementations
		const mockClineBase = {
			ask: jest.fn().mockReturnValue(
				Promise.resolve({
					response: { type: "text" as ClineAsk },
					text: "",
				}),
			),
			say: jest.fn().mockReturnValue(Promise.resolve()),
			sayAndCreateMissingParamError: jest.fn().mockReturnValue(Promise.resolve("Missing parameter error")),
			consecutiveMistakeCount: 0,
			didEditFile: false,
			cwd: "/test/path",
			diffViewProvider: mockDiffViewProvider,
			getFileContextTracker: jest.fn().mockReturnValue(mockFileContextTracker),
			rooIgnoreController: {
				validateAccess: jest.fn().mockReturnValue(true),
			} as unknown as RooIgnoreController,
			api: {
				getModel: jest.fn().mockReturnValue({
					id: "gpt-4",
					info: {
						contextWindow: 8000,
						supportsPromptCache: true,
						maxTokens: null,
						supportsImages: false,
						supportsComputerUse: true,
						supportsFunctionCalling: true,
						supportsVision: false,
						isMultiModal: false,
						isChatBased: true,
						isCompletionBased: false,
						cachableFields: [],
					},
				}),
				createMessage: jest.fn(),
				countTokens: jest.fn(),
			},
		}

		// Create a properly typed mock
		mockCline = {
			...mockClineBase,
			consecutiveMistakeCount: 0,
			didEditFile: false,
			cwd: "/test/path",
		} as unknown as jest.Mocked<Partial<Cline>> & {
			consecutiveMistakeCount: number
			didEditFile: boolean
			cwd: string
		}

		mockAskApproval = jest.fn().mockReturnValue(Promise.resolve(true))
		mockHandleError = jest.fn().mockReturnValue(Promise.resolve())
		mockPushToolResult = jest.fn()
		mockRemoveClosingTag = jest.fn().mockImplementation((tag, value) => value)

		// Create a mock tool use object
		mockToolUse = {
			type: "tool_use",
			name: "append_to_file",
			params: {
				path: "test.txt",
				content: "test content",
			},
			partial: false,
		}
	})

	describe("Basic functionality", () => {
		it("should append content to a new file", async () => {
			// Setup
			mockDiffViewProvider.editType = "create"

			// Execute
			await appendToFileTool(
				mockCline as unknown as Cline,
				mockToolUse,
				mockAskApproval as unknown as AskApproval,
				mockHandleError as unknown as HandleError,
				mockPushToolResult as unknown as PushToolResult,
				mockRemoveClosingTag as unknown as RemoveClosingTag,
			)

			// Verify
			expect(mockDiffViewProvider.open).toHaveBeenCalledWith("test.txt")
			expect(mockDiffViewProvider.update).toHaveBeenCalledWith("test content", true)
			expect(mockAskApproval).toHaveBeenCalled()
			expect(mockFileContextTracker.trackFileContext).toHaveBeenCalledWith("test.txt", "roo_edited")
			expect(mockCline.didEditFile).toBe(true)
		})

		it("should append content to an existing file", async () => {
			// Setup
			mockDiffViewProvider.editType = "modify"
			mockDiffViewProvider.originalContent = "existing content"

			// Execute
			await appendToFileTool(
				mockCline as unknown as Cline,
				mockToolUse,
				mockAskApproval as unknown as AskApproval,
				mockHandleError as unknown as HandleError,
				mockPushToolResult as unknown as PushToolResult,
				mockRemoveClosingTag as unknown as RemoveClosingTag,
			)

			// Verify
			expect(mockDiffViewProvider.open).toHaveBeenCalledWith("test.txt")
			expect(mockDiffViewProvider.update).toHaveBeenCalledWith("existing content\ntest content", true)
			// The tool adds its own newline between existing and new content
			expect(mockAskApproval).toHaveBeenCalled()
			expect(mockFileContextTracker.trackFileContext).toHaveBeenCalledWith("test.txt", "roo_edited")
		})
	})

	describe("Content preprocessing", () => {
		it("should remove code block markers", async () => {
			// Setup
			mockToolUse.params.content = "```\ntest content\n```"

			// Execute
			await appendToFileTool(
				mockCline as unknown as Cline,
				mockToolUse,
				mockAskApproval as unknown as AskApproval,
				mockHandleError as unknown as HandleError,
				mockPushToolResult as unknown as PushToolResult,
				mockRemoveClosingTag as unknown as RemoveClosingTag,
			)

			// Verify
			expect(mockDiffViewProvider.update).toHaveBeenCalledWith("test content", true)
		})

		it("should unescape HTML entities for non-Claude models", async () => {
			// Setup
			mockToolUse.params.content = "test &amp; content"

			// Execute
			await appendToFileTool(
				mockCline as unknown as Cline,
				mockToolUse,
				mockAskApproval as unknown as AskApproval,
				mockHandleError as unknown as HandleError,
				mockPushToolResult as unknown as PushToolResult,
				mockRemoveClosingTag as unknown as RemoveClosingTag,
			)

			// Verify
			expect(mockDiffViewProvider.update).toHaveBeenCalledWith("test & content", true)
		})
	})

	describe("Error handling", () => {
		it("should handle missing path parameter", async () => {
			// Setup
			mockToolUse.params.path = undefined

			// Execute
			await appendToFileTool(
				mockCline as unknown as Cline,
				mockToolUse,
				mockAskApproval as unknown as AskApproval,
				mockHandleError as unknown as HandleError,
				mockPushToolResult as unknown as PushToolResult,
				mockRemoveClosingTag as unknown as RemoveClosingTag,
			)

			// Verify
			expect(mockCline.consecutiveMistakeCount).toBe(0)
			expect(mockDiffViewProvider.open).not.toHaveBeenCalled()
		})

		it("should handle missing content parameter", async () => {
			// Setup
			mockToolUse.params.content = undefined

			// Execute
			await appendToFileTool(
				mockCline as unknown as Cline,
				mockToolUse,
				mockAskApproval as unknown as AskApproval,
				mockHandleError as unknown as HandleError,
				mockPushToolResult as unknown as PushToolResult,
				mockRemoveClosingTag as unknown as RemoveClosingTag,
			)

			// Verify
			expect(mockCline.consecutiveMistakeCount).toBe(0)
			expect(mockDiffViewProvider.open).not.toHaveBeenCalled()
		})

		it("should handle rooignore validation failures", async () => {
			// Setup
			const validateAccessMock = jest.fn().mockReturnValue(false) as jest.MockedFunction<
				(filePath: string) => boolean
			>
			mockCline.rooIgnoreController = {
				validateAccess: validateAccessMock,
			} as unknown as RooIgnoreController
			const mockRooIgnoreError = "RooIgnore error"
			;(formatResponse.rooIgnoreError as jest.Mock).mockReturnValue(mockRooIgnoreError)
			;(formatResponse.toolError as jest.Mock).mockReturnValue("Tool error")

			// Execute
			await appendToFileTool(
				mockCline as unknown as Cline,
				mockToolUse,
				mockAskApproval as unknown as AskApproval,
				mockHandleError as unknown as HandleError,
				mockPushToolResult as unknown as PushToolResult,
				mockRemoveClosingTag as unknown as RemoveClosingTag,
			)

			// Verify
			expect(mockCline.say).toHaveBeenCalledWith("rooignore_error", "test.txt")
			expect(formatResponse.rooIgnoreError).toHaveBeenCalledWith("test.txt")
			expect(mockPushToolResult).toHaveBeenCalled()
			expect(mockDiffViewProvider.open).not.toHaveBeenCalled()
		})

		it("should handle user rejection", async () => {
			// Setup
			mockAskApproval.mockReturnValue(Promise.resolve(false))

			// Execute
			await appendToFileTool(
				mockCline as unknown as Cline,
				mockToolUse,
				mockAskApproval as unknown as AskApproval,
				mockHandleError as unknown as HandleError,
				mockPushToolResult as unknown as PushToolResult,
				mockRemoveClosingTag as unknown as RemoveClosingTag,
			)

			// Verify
			expect(mockDiffViewProvider.revertChanges).toHaveBeenCalled()
			expect(mockFileContextTracker.trackFileContext).not.toHaveBeenCalled()
		})
	})

	describe("Partial updates", () => {
		it("should handle partial updates", async () => {
			// Setup
			mockToolUse.partial = true

			// Execute
			await appendToFileTool(
				mockCline as unknown as Cline,
				mockToolUse,
				mockAskApproval as unknown as AskApproval,
				mockHandleError as unknown as HandleError,
				mockPushToolResult as unknown as PushToolResult,
				mockRemoveClosingTag as unknown as RemoveClosingTag,
			)

			// Verify
			expect(mockCline.ask).toHaveBeenCalledWith("tool", expect.any(String), true)
			expect(mockDiffViewProvider.update).toHaveBeenCalledWith("test content", false)
			expect(mockAskApproval).not.toHaveBeenCalled()
		})
	})
})
