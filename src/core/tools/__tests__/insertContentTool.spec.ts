import * as fs from "fs/promises"
import * as path from "path"
import type { MockedFunction } from "vitest"

import { fileExistsAtPath } from "../../../utils/fs"
import { ToolUse, ToolResponse } from "../../../shared/tools"
import { insertContentTool } from "../insertContentTool"

// Helper to normalize paths to POSIX format for cross-platform testing
const toPosix = (filePath: string) => filePath.replace(/\\/g, "/")

// Mock external dependencies
vi.mock("fs/promises", () => ({
	readFile: vi.fn(),
	writeFile: vi.fn(),
}))

vi.mock("delay", () => ({
	default: vi.fn(),
}))

vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn().mockResolvedValue(false),
}))

vi.mock("../../prompts/responses", () => ({
	formatResponse: {
		toolError: vi.fn((msg) => `Error: ${msg}`),
		rooIgnoreError: vi.fn((path) => `Access denied: ${path}`),
		createPrettyPatch: vi.fn((_path, original, updated) => `Diff: ${original} -> ${updated}`),
	},
}))

vi.mock("../../../utils/path", () => ({
	getReadablePath: vi.fn().mockReturnValue("test/path.txt"),
}))

vi.mock("../../ignore/RooIgnoreController", () => ({
	RooIgnoreController: class {
		initialize() {
			return Promise.resolve()
		}
		validateAccess() {
			return true
		}
	},
}))

describe("insertContentTool", () => {
	const testFilePath = "test/file.txt"
	// Use a consistent mock absolute path for testing
	const absoluteFilePath = "/test/file.txt"

	const mockedFileExistsAtPath = fileExistsAtPath as MockedFunction<typeof fileExistsAtPath>
	const mockedFsReadFile = fs.readFile as MockedFunction<typeof fs.readFile>

	let mockCline: any
	let mockAskApproval: ReturnType<typeof vi.fn>
	let mockHandleError: ReturnType<typeof vi.fn>
	let mockPushToolResult: ReturnType<typeof vi.fn>
	let mockRemoveClosingTag: ReturnType<typeof vi.fn>
	let toolResult: ToolResponse | undefined

	beforeEach(() => {
		vi.clearAllMocks()

		mockedFileExistsAtPath.mockResolvedValue(true) // Assume file exists by default for insert
		mockedFsReadFile.mockResolvedValue("") // Default empty file content

		mockCline = {
			cwd: "/",
			consecutiveMistakeCount: 0,
			didEditFile: false,
			rooIgnoreController: {
				validateAccess: vi.fn().mockReturnValue(true),
			},
			diffViewProvider: {
				editType: undefined,
				isEditing: false,
				originalContent: "",
				open: vi.fn().mockResolvedValue(undefined),
				update: vi.fn().mockResolvedValue(undefined),
				reset: vi.fn().mockResolvedValue(undefined),
				revertChanges: vi.fn().mockResolvedValue(undefined),
				saveChanges: vi.fn().mockResolvedValue({
					newProblemsMessage: "",
					userEdits: null,
					finalContent: "final content",
				}),
				scrollToFirstDiff: vi.fn(),
				pushToolWriteResult: vi.fn().mockImplementation(async function (
					this: any,
					task: any,
					cwd: string,
					isNewFile: boolean,
				) {
					return "Tool result message"
				}),
			},
			fileContextTracker: {
				trackFileContext: vi.fn().mockResolvedValue(undefined),
			},
			say: vi.fn().mockResolvedValue(undefined),
			ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }), // Default to approval
			recordToolError: vi.fn(),
			sayAndCreateMissingParamError: vi.fn().mockResolvedValue("Missing param error"),
		}

		mockAskApproval = vi.fn().mockResolvedValue(true)
		mockHandleError = vi.fn().mockResolvedValue(undefined)
		mockRemoveClosingTag = vi.fn((tag, content) => content)

		toolResult = undefined
	})

	async function executeInsertContentTool(
		params: Partial<ToolUse["params"]> = {},
		options: {
			fileExists?: boolean
			isPartial?: boolean
			accessAllowed?: boolean
			fileContent?: string
			askApprovalResponse?: "yesButtonClicked" | "noButtonClicked" | string
		} = {},
	): Promise<ToolResponse | undefined> {
		const fileExists = options.fileExists ?? true
		const isPartial = options.isPartial ?? false
		const accessAllowed = options.accessAllowed ?? true
		const fileContent = options.fileContent ?? ""

		mockedFileExistsAtPath.mockResolvedValue(fileExists)
		mockedFsReadFile.mockResolvedValue(fileContent)
		mockCline.rooIgnoreController.validateAccess.mockReturnValue(accessAllowed)
		mockCline.ask.mockResolvedValue({ response: options.askApprovalResponse ?? "yesButtonClicked" })

		const toolUse: ToolUse = {
			type: "tool_use",
			name: "insert_content",
			params: {
				path: testFilePath,
				line: "1",
				content: "New content",
				...params,
			},
			partial: isPartial,
		}

		await insertContentTool(
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

	describe("new file creation logic", () => {
		it("creates a new file and inserts content at line 0 (append)", async () => {
			const contentToInsert = "New Line 1\nNew Line 2"
			await executeInsertContentTool(
				{ line: "0", content: contentToInsert },
				{ fileExists: false, fileContent: "" },
			)

			// Normalize the path that was called with to POSIX format for comparison
			const calledPath = mockedFileExistsAtPath.mock.calls[0][0]
			expect(toPosix(calledPath)).toContain(testFilePath)
			expect(mockedFsReadFile).not.toHaveBeenCalled() // Should not read if file doesn't exist
			expect(mockCline.diffViewProvider.update).toHaveBeenCalledWith(contentToInsert, true)
			expect(mockCline.diffViewProvider.editType).toBe("create")
			expect(mockCline.diffViewProvider.pushToolWriteResult).toHaveBeenCalledWith(mockCline, mockCline.cwd, true)
		})

		it("creates a new file and inserts content at line 1 (beginning)", async () => {
			const contentToInsert = "Hello World!"
			await executeInsertContentTool(
				{ line: "1", content: contentToInsert },
				{ fileExists: false, fileContent: "" },
			)

			// Normalize the path that was called with to POSIX format for comparison
			const calledPath = mockedFileExistsAtPath.mock.calls[0][0]
			expect(toPosix(calledPath)).toContain(testFilePath)
			expect(mockedFsReadFile).not.toHaveBeenCalled()
			expect(mockCline.diffViewProvider.update).toHaveBeenCalledWith(contentToInsert, true)
			expect(mockCline.diffViewProvider.editType).toBe("create")
			expect(mockCline.diffViewProvider.pushToolWriteResult).toHaveBeenCalledWith(mockCline, mockCline.cwd, true)
		})

		it("creates an empty new file if content is empty string", async () => {
			await executeInsertContentTool({ line: "1", content: "" }, { fileExists: false, fileContent: "" })

			// Normalize the path that was called with to POSIX format for comparison
			const calledPath = mockedFileExistsAtPath.mock.calls[0][0]
			expect(toPosix(calledPath)).toContain(testFilePath)
			expect(mockedFsReadFile).not.toHaveBeenCalled()
			expect(mockCline.diffViewProvider.update).toHaveBeenCalledWith("", true)
			expect(mockCline.diffViewProvider.editType).toBe("create")
			expect(mockCline.diffViewProvider.pushToolWriteResult).toHaveBeenCalledWith(mockCline, mockCline.cwd, true)
		})

		it("returns an error when inserting content at an arbitrary line number into a new file", async () => {
			const contentToInsert = "Arbitrary insert"
			const result = await executeInsertContentTool(
				{ line: "5", content: contentToInsert },
				{ fileExists: false, fileContent: "" },
			)

			// Normalize the path that was called with to POSIX format for comparison
			const calledPath = mockedFileExistsAtPath.mock.calls[0][0]
			expect(toPosix(calledPath)).toContain(testFilePath)
			expect(mockedFsReadFile).not.toHaveBeenCalled()
			expect(mockCline.consecutiveMistakeCount).toBe(1)
			expect(mockCline.recordToolError).toHaveBeenCalledWith("insert_content")
			expect(mockCline.say).toHaveBeenCalledWith("error", expect.stringContaining("non-existent file"))
			expect(mockCline.diffViewProvider.update).not.toHaveBeenCalled()
			expect(mockCline.diffViewProvider.pushToolWriteResult).not.toHaveBeenCalled()
		})
	})
})
