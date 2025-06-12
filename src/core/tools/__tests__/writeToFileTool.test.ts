import * as path from "path"

import { fileExistsAtPath } from "../../../utils/fs"
import { detectCodeOmission } from "../../../integrations/editor/detect-omission"
import { isPathOutsideWorkspace } from "../../../utils/pathUtils"
import { getReadablePath } from "../../../utils/path"
import { unescapeHtmlEntities } from "../../../utils/text-normalization"
import { everyLineHasLineNumbers, stripLineNumbers } from "../../../integrations/misc/extract-text"
import { ToolUse, ToolResponse } from "../../../shared/tools"
import { writeToFileTool } from "../writeToFileTool"

jest.mock("path", () => {
	const originalPath = jest.requireActual("path")
	return {
		...originalPath,
		resolve: jest.fn().mockImplementation((...args) => args.join("/")),
	}
})

jest.mock("delay", () => jest.fn())

jest.mock("../../../utils/fs", () => ({
	fileExistsAtPath: jest.fn().mockResolvedValue(false),
}))

jest.mock("../../prompts/responses", () => ({
	formatResponse: {
		toolError: jest.fn((msg) => `Error: ${msg}`),
		rooIgnoreError: jest.fn((path) => `Access denied: ${path}`),
		lineCountTruncationError: jest.fn(
			(count, isNew, diffEnabled) => `Line count error: ${count}, new: ${isNew}, diff: ${diffEnabled}`,
		),
		createPrettyPatch: jest.fn(() => "mock-diff"),
	},
}))

jest.mock("../../../integrations/editor/detect-omission", () => ({
	detectCodeOmission: jest.fn().mockReturnValue(false),
}))

jest.mock("../../../utils/pathUtils", () => ({
	isPathOutsideWorkspace: jest.fn().mockReturnValue(false),
}))

jest.mock("../../../utils/path", () => ({
	getReadablePath: jest.fn().mockReturnValue("test/path.txt"),
}))

jest.mock("../../../utils/text-normalization", () => ({
	unescapeHtmlEntities: jest.fn().mockImplementation((content) => content),
}))

jest.mock("../../../integrations/misc/extract-text", () => ({
	everyLineHasLineNumbers: jest.fn().mockReturnValue(false),
	stripLineNumbers: jest.fn().mockImplementation((content) => content),
	addLineNumbers: jest.fn().mockImplementation((content: string) =>
		content
			.split("\n")
			.map((line: string, i: number) => `${i + 1} | ${line}`)
			.join("\n"),
	),
}))

jest.mock("vscode", () => ({
	window: {
		showWarningMessage: jest.fn().mockResolvedValue(undefined),
	},
	env: {
		openExternal: jest.fn(),
	},
	Uri: {
		parse: jest.fn(),
	},
}))

jest.mock("../../ignore/RooIgnoreController", () => ({
	RooIgnoreController: class {
		initialize() {
			return Promise.resolve()
		}
		validateAccess() {
			return true
		}
	},
}))

describe("writeToFileTool", () => {
	// Test data
	const testFilePath = "test/file.txt"
	const absoluteFilePath = "/test/file.txt"
	const testContent = "Line 1\nLine 2\nLine 3"
	const testContentWithMarkdown = "```javascript\nLine 1\nLine 2\n```"

	// Mocked functions with correct types
	const mockedFileExistsAtPath = fileExistsAtPath as jest.MockedFunction<typeof fileExistsAtPath>
	const mockedDetectCodeOmission = detectCodeOmission as jest.MockedFunction<typeof detectCodeOmission>
	const mockedIsPathOutsideWorkspace = isPathOutsideWorkspace as jest.MockedFunction<typeof isPathOutsideWorkspace>
	const mockedGetReadablePath = getReadablePath as jest.MockedFunction<typeof getReadablePath>
	const mockedUnescapeHtmlEntities = unescapeHtmlEntities as jest.MockedFunction<typeof unescapeHtmlEntities>
	const mockedEveryLineHasLineNumbers = everyLineHasLineNumbers as jest.MockedFunction<typeof everyLineHasLineNumbers>
	const mockedStripLineNumbers = stripLineNumbers as jest.MockedFunction<typeof stripLineNumbers>
	const mockedPathResolve = path.resolve as jest.MockedFunction<typeof path.resolve>

	const mockCline: any = {}
	let mockAskApproval: jest.Mock
	let mockHandleError: jest.Mock
	let mockPushToolResult: jest.Mock
	let mockRemoveClosingTag: jest.Mock
	let toolResult: ToolResponse | undefined

	beforeEach(() => {
		jest.clearAllMocks()

		mockedPathResolve.mockReturnValue(absoluteFilePath)
		mockedFileExistsAtPath.mockResolvedValue(false)
		mockedDetectCodeOmission.mockReturnValue(false)
		mockedIsPathOutsideWorkspace.mockReturnValue(false)
		mockedGetReadablePath.mockReturnValue("test/path.txt")
		mockedUnescapeHtmlEntities.mockImplementation((content) => content)
		mockedEveryLineHasLineNumbers.mockReturnValue(false)
		mockedStripLineNumbers.mockImplementation((content) => content)

		mockCline.cwd = "/"
		mockCline.consecutiveMistakeCount = 0
		mockCline.didEditFile = false
		mockCline.diffStrategy = undefined
		mockCline.rooIgnoreController = {
			validateAccess: jest.fn().mockReturnValue(true),
		}
		mockCline.diffViewProvider = {
			editType: undefined,
			isEditing: false,
			originalContent: "",
			open: jest.fn().mockResolvedValue(undefined),
			update: jest.fn().mockResolvedValue(undefined),
			reset: jest.fn().mockResolvedValue(undefined),
			revertChanges: jest.fn().mockResolvedValue(undefined),
			saveChanges: jest.fn().mockResolvedValue({
				newProblemsMessage: "",
				userEdits: null,
				finalContent: "final content",
			}),
			scrollToFirstDiff: jest.fn(),
			pushToolWriteResult: jest.fn().mockImplementation(async function (
				this: any,
				task: any,
				cwd: string,
				isNewFile: boolean,
			) {
				// Simulate the behavior of pushToolWriteResult
				if (this.userEdits) {
					await task.say(
						"user_feedback_diff",
						JSON.stringify({
							tool: isNewFile ? "newFileCreated" : "editedExistingFile",
							path: "test/path.txt",
							diff: this.userEdits,
						}),
					)
				}
				return "Tool result message"
			}),
		}
		mockCline.api = {
			getModel: jest.fn().mockReturnValue({ id: "claude-3" }),
		}
		mockCline.fileContextTracker = {
			trackFileContext: jest.fn().mockResolvedValue(undefined),
		}
		mockCline.say = jest.fn().mockResolvedValue(undefined)
		mockCline.ask = jest.fn().mockResolvedValue(undefined)
		mockCline.recordToolError = jest.fn()
		mockCline.sayAndCreateMissingParamError = jest.fn().mockResolvedValue("Missing param error")

		mockAskApproval = jest.fn().mockResolvedValue(true)
		mockHandleError = jest.fn().mockResolvedValue(undefined)
		mockRemoveClosingTag = jest.fn((tag, content) => content)

		toolResult = undefined
	})

	/**
	 * Helper function to execute the write file tool with different parameters
	 */
	async function executeWriteFileTool(
		params: Partial<ToolUse["params"]> = {},
		options: {
			fileExists?: boolean
			isPartial?: boolean
			accessAllowed?: boolean
		} = {},
	): Promise<ToolResponse | undefined> {
		// Configure mocks based on test scenario
		const fileExists = options.fileExists ?? false
		const isPartial = options.isPartial ?? false
		const accessAllowed = options.accessAllowed ?? true

		mockedFileExistsAtPath.mockResolvedValue(fileExists)
		mockCline.rooIgnoreController.validateAccess.mockReturnValue(accessAllowed)

		// Create a tool use object
		const toolUse: ToolUse = {
			type: "tool_use",
			name: "write_to_file",
			params: {
				path: testFilePath,
				content: testContent,
				line_count: "3",
				...params,
			},
			partial: isPartial,
		}

		await writeToFileTool(
			mockCline,
			toolUse,
			mockAskApproval,
			mockHandleError,
			(result: ToolResponse) => {
				toolResult = result
			},
			mockRemoveClosingTag,
		)

		return toolResult
	}

	describe("access control", () => {
		it("validates and allows access when rooIgnoreController permits", async () => {
			await executeWriteFileTool({}, { accessAllowed: true })

			expect(mockCline.rooIgnoreController.validateAccess).toHaveBeenCalledWith(testFilePath)
			expect(mockCline.diffViewProvider.open).toHaveBeenCalledWith(testFilePath)
		})
	})

	describe("file existence detection", () => {
		it("detects existing file and sets editType to modify", async () => {
			await executeWriteFileTool({}, { fileExists: true })

			expect(mockedFileExistsAtPath).toHaveBeenCalledWith(absoluteFilePath)
			expect(mockCline.diffViewProvider.editType).toBe("modify")
		})

		it("detects new file and sets editType to create", async () => {
			await executeWriteFileTool({}, { fileExists: false })

			expect(mockedFileExistsAtPath).toHaveBeenCalledWith(absoluteFilePath)
			expect(mockCline.diffViewProvider.editType).toBe("create")
		})

		it("uses cached editType without filesystem check", async () => {
			mockCline.diffViewProvider.editType = "modify"

			await executeWriteFileTool({})

			expect(mockedFileExistsAtPath).not.toHaveBeenCalled()
		})
	})

	describe("content preprocessing", () => {
		it("removes markdown code block markers from content", async () => {
			await executeWriteFileTool({ content: testContentWithMarkdown })

			expect(mockCline.diffViewProvider.update).toHaveBeenCalledWith("Line 1\nLine 2", true)
		})

		it("passes through empty content unchanged", async () => {
			await executeWriteFileTool({ content: "" })

			expect(mockCline.diffViewProvider.update).toHaveBeenCalledWith("", true)
		})

		it("unescapes HTML entities for non-Claude models", async () => {
			mockCline.api.getModel.mockReturnValue({ id: "gpt-4" })

			await executeWriteFileTool({ content: "&lt;test&gt;" })

			expect(mockedUnescapeHtmlEntities).toHaveBeenCalledWith("&lt;test&gt;")
		})

		it("skips HTML unescaping for Claude models", async () => {
			mockCline.api.getModel.mockReturnValue({ id: "claude-3" })

			await executeWriteFileTool({ content: "&lt;test&gt;" })

			expect(mockedUnescapeHtmlEntities).not.toHaveBeenCalled()
		})

		it("strips line numbers from numbered content", async () => {
			const contentWithLineNumbers = "1 | line one\n2 | line two"
			mockedEveryLineHasLineNumbers.mockReturnValue(true)
			mockedStripLineNumbers.mockReturnValue("line one\nline two")

			await executeWriteFileTool({ content: contentWithLineNumbers })

			expect(mockedEveryLineHasLineNumbers).toHaveBeenCalledWith(contentWithLineNumbers)
			expect(mockedStripLineNumbers).toHaveBeenCalledWith(contentWithLineNumbers)
			expect(mockCline.diffViewProvider.update).toHaveBeenCalledWith("line one\nline two", true)
		})
	})

	describe("file operations", () => {
		it("successfully creates new files with full workflow", async () => {
			await executeWriteFileTool({}, { fileExists: false })

			expect(mockCline.consecutiveMistakeCount).toBe(0)
			expect(mockCline.diffViewProvider.open).toHaveBeenCalledWith(testFilePath)
			expect(mockCline.diffViewProvider.update).toHaveBeenCalledWith(testContent, true)
			expect(mockAskApproval).toHaveBeenCalled()
			expect(mockCline.diffViewProvider.saveChanges).toHaveBeenCalled()
			expect(mockCline.fileContextTracker.trackFileContext).toHaveBeenCalledWith(testFilePath, "roo_edited")
			expect(mockCline.didEditFile).toBe(true)
		})

		it("processes files outside workspace boundary", async () => {
			mockedIsPathOutsideWorkspace.mockReturnValue(true)

			await executeWriteFileTool({})

			expect(mockedIsPathOutsideWorkspace).toHaveBeenCalled()
		})

		it("processes files with very large line counts", async () => {
			await executeWriteFileTool({ line_count: "999999" })

			// Should process normally without issues
			expect(mockCline.consecutiveMistakeCount).toBe(0)
		})
	})

	describe("partial block handling", () => {
		it("returns early when path is missing in partial block", async () => {
			await executeWriteFileTool({ path: undefined }, { isPartial: true })

			expect(mockCline.diffViewProvider.open).not.toHaveBeenCalled()
		})

		it("returns early when content is undefined in partial block", async () => {
			await executeWriteFileTool({ content: undefined }, { isPartial: true })

			expect(mockCline.diffViewProvider.open).not.toHaveBeenCalled()
		})

		it("streams content updates during partial execution", async () => {
			await executeWriteFileTool({}, { isPartial: true })

			expect(mockCline.ask).toHaveBeenCalled()
			expect(mockCline.diffViewProvider.open).toHaveBeenCalledWith(testFilePath)
			expect(mockCline.diffViewProvider.update).toHaveBeenCalledWith(testContent, false)
		})
	})

	describe("user interaction", () => {
		it("reverts changes when user rejects approval", async () => {
			mockAskApproval.mockResolvedValue(false)

			await executeWriteFileTool({})

			expect(mockCline.diffViewProvider.revertChanges).toHaveBeenCalled()
			expect(mockCline.diffViewProvider.saveChanges).not.toHaveBeenCalled()
		})

		it("reports user edits with diff feedback", async () => {
			const userEditsValue = "- old line\n+ new line"
			mockCline.diffViewProvider.saveChanges.mockResolvedValue({
				newProblemsMessage: " with warnings",
				userEdits: userEditsValue,
				finalContent: "modified content",
			})
			// Manually set the property on the mock instance because the original saveChanges is not called
			mockCline.diffViewProvider.userEdits = userEditsValue

			await executeWriteFileTool({}, { fileExists: true })

			expect(mockCline.say).toHaveBeenCalledWith(
				"user_feedback_diff",
				expect.stringContaining("editedExistingFile"),
			)
		})
	})

	describe("error handling", () => {
		it("handles general file operation errors", async () => {
			mockCline.diffViewProvider.open.mockRejectedValue(new Error("General error"))

			await executeWriteFileTool({})

			expect(mockHandleError).toHaveBeenCalledWith("writing file", expect.any(Error))
			expect(mockCline.diffViewProvider.reset).toHaveBeenCalled()
		})

		it("handles partial streaming errors", async () => {
			mockCline.diffViewProvider.open.mockRejectedValue(new Error("Open failed"))

			await executeWriteFileTool({}, { isPartial: true })

			expect(mockHandleError).toHaveBeenCalledWith("writing file", expect.any(Error))
			expect(mockCline.diffViewProvider.reset).toHaveBeenCalled()
		})
	})

	describe("parameter validation", () => {
		it("errors and resets on missing path parameter", async () => {
			await executeWriteFileTool({ path: undefined })

			expect(mockCline.consecutiveMistakeCount).toBe(1)
			expect(mockCline.recordToolError).toHaveBeenCalledWith("write_to_file")
			expect(mockCline.sayAndCreateMissingParamError).toHaveBeenCalledWith("write_to_file", "path")
			expect(mockCline.diffViewProvider.reset).toHaveBeenCalled()
		})

		it("errors and resets on empty path parameter", async () => {
			await executeWriteFileTool({ path: "" })

			expect(mockCline.consecutiveMistakeCount).toBe(1)
			expect(mockCline.recordToolError).toHaveBeenCalledWith("write_to_file")
			expect(mockCline.sayAndCreateMissingParamError).toHaveBeenCalledWith("write_to_file", "path")
			expect(mockCline.diffViewProvider.reset).toHaveBeenCalled()
		})

		it("errors and resets on missing content parameter", async () => {
			await executeWriteFileTool({ content: undefined })

			expect(mockCline.consecutiveMistakeCount).toBe(1)
			expect(mockCline.recordToolError).toHaveBeenCalledWith("write_to_file")
			expect(mockCline.sayAndCreateMissingParamError).toHaveBeenCalledWith("write_to_file", "content")
			expect(mockCline.diffViewProvider.reset).toHaveBeenCalled()
		})
	})
})
