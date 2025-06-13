import path from "path"
import { describe, it, expect, beforeEach, vi, type Mock, type MockedFunction } from "vitest"
import { searchFilesTool } from "../searchFilesTool"
import { Task } from "../../task/Task"
import { SearchFilesToolUse } from "../../../shared/tools"
import { isPathOutsideWorkspace } from "../../../utils/pathUtils"
import { regexSearchFiles } from "../../../services/ripgrep"
import { RooIgnoreController } from "../../ignore/RooIgnoreController"

// Mock dependencies
vi.mock("../../../utils/pathUtils", () => ({
	isPathOutsideWorkspace: vi.fn(),
}))

vi.mock("../../../services/ripgrep", () => ({
	regexSearchFiles: vi.fn(),
}))

vi.mock("../../../utils/path", () => ({
	getReadablePath: vi.fn((cwd: string, relPath: string) => relPath),
}))

vi.mock("../../ignore/RooIgnoreController")

vi.mock("../../../i18n", () => ({
	t: vi.fn((key: string, params?: any) => {
		if (key === "tools:searchFiles.workspaceBoundaryError") {
			return `Cannot search outside workspace. Path '${params?.path}' is outside the current workspace.`
		}
		return key
	}),
}))

const mockedIsPathOutsideWorkspace = isPathOutsideWorkspace as MockedFunction<typeof isPathOutsideWorkspace>
const mockedRegexSearchFiles = regexSearchFiles as MockedFunction<typeof regexSearchFiles>

describe("searchFilesTool", () => {
	let mockTask: Partial<Task>
	let mockAskApproval: Mock
	let mockHandleError: Mock
	let mockPushToolResult: Mock
	let mockRemoveClosingTag: Mock

	beforeEach(() => {
		vi.clearAllMocks()

		mockTask = {
			cwd: "/workspace",
			consecutiveMistakeCount: 0,
			recordToolError: vi.fn(),
			sayAndCreateMissingParamError: vi.fn().mockResolvedValue("Missing parameter error"),
			say: vi.fn().mockResolvedValue(undefined),
			rooIgnoreController: new RooIgnoreController("/workspace"),
		}

		mockAskApproval = vi.fn().mockResolvedValue(true)
		mockHandleError = vi.fn()
		mockPushToolResult = vi.fn()
		mockRemoveClosingTag = vi.fn((tag: string, value: string | undefined) => value || "")

		mockedRegexSearchFiles.mockResolvedValue("Search results")
	})

	describe("workspace boundary validation", () => {
		it("should allow search within workspace", async () => {
			const block: SearchFilesToolUse = {
				type: "tool_use",
				name: "search_files",
				params: {
					path: "src",
					regex: "test",
					file_pattern: "*.ts",
				},
				partial: false,
			}

			mockedIsPathOutsideWorkspace.mockReturnValue(false)

			await searchFilesTool(
				mockTask as Task,
				block,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			expect(mockedIsPathOutsideWorkspace).toHaveBeenCalledWith(path.resolve("/workspace", "src"))
			expect(mockedRegexSearchFiles).toHaveBeenCalled()
			expect(mockPushToolResult).toHaveBeenCalledWith("Search results")
		})

		it("should block search outside workspace", async () => {
			const block: SearchFilesToolUse = {
				type: "tool_use",
				name: "search_files",
				params: {
					path: "../external",
					regex: "test",
					file_pattern: "*.ts",
				},
				partial: false,
			}

			mockedIsPathOutsideWorkspace.mockReturnValue(true)

			await searchFilesTool(
				mockTask as Task,
				block,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			expect(mockedIsPathOutsideWorkspace).toHaveBeenCalledWith(path.resolve("/workspace", "../external"))
			expect(mockedRegexSearchFiles).not.toHaveBeenCalled()
			expect(mockTask.say).toHaveBeenCalledWith(
				"error",
				"Cannot search outside workspace. Path '../external' is outside the current workspace.",
			)
			expect(mockPushToolResult).toHaveBeenCalledWith(
				"Cannot search outside workspace. Path '../external' is outside the current workspace.",
			)
			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockTask.recordToolError).toHaveBeenCalledWith("search_files")
		})

		it("should block search with absolute path outside workspace", async () => {
			const block: SearchFilesToolUse = {
				type: "tool_use",
				name: "search_files",
				params: {
					path: "/etc/passwd",
					regex: "root",
				},
				partial: false,
			}

			mockedIsPathOutsideWorkspace.mockReturnValue(true)

			await searchFilesTool(
				mockTask as Task,
				block,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			expect(mockedIsPathOutsideWorkspace).toHaveBeenCalledWith(path.resolve("/workspace", "/etc/passwd"))
			expect(mockedRegexSearchFiles).not.toHaveBeenCalled()
			expect(mockTask.say).toHaveBeenCalledWith(
				"error",
				"Cannot search outside workspace. Path '/etc/passwd' is outside the current workspace.",
			)
			expect(mockPushToolResult).toHaveBeenCalledWith(
				"Cannot search outside workspace. Path '/etc/passwd' is outside the current workspace.",
			)
		})

		it("should handle relative paths that resolve outside workspace", async () => {
			const block: SearchFilesToolUse = {
				type: "tool_use",
				name: "search_files",
				params: {
					path: "../../..",
					regex: "sensitive",
				},
				partial: false,
			}

			mockedIsPathOutsideWorkspace.mockReturnValue(true)

			await searchFilesTool(
				mockTask as Task,
				block,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			expect(mockedIsPathOutsideWorkspace).toHaveBeenCalledWith(path.resolve("/workspace", "../../.."))
			expect(mockedRegexSearchFiles).not.toHaveBeenCalled()
			expect(mockTask.say).toHaveBeenCalledWith(
				"error",
				"Cannot search outside workspace. Path '../../..' is outside the current workspace.",
			)
			expect(mockPushToolResult).toHaveBeenCalledWith(
				"Cannot search outside workspace. Path '../../..' is outside the current workspace.",
			)
		})
	})

	describe("existing functionality", () => {
		beforeEach(() => {
			mockedIsPathOutsideWorkspace.mockReturnValue(false)
		})

		it("should handle missing path parameter", async () => {
			const block: SearchFilesToolUse = {
				type: "tool_use",
				name: "search_files",
				params: {
					regex: "test",
				},
				partial: false,
			}

			await searchFilesTool(
				mockTask as Task,
				block,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			expect(mockTask.sayAndCreateMissingParamError).toHaveBeenCalledWith("search_files", "path")
			expect(mockedRegexSearchFiles).not.toHaveBeenCalled()
		})

		it("should handle missing regex parameter", async () => {
			const block: SearchFilesToolUse = {
				type: "tool_use",
				name: "search_files",
				params: {
					path: "src",
				},
				partial: false,
			}

			await searchFilesTool(
				mockTask as Task,
				block,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			expect(mockTask.sayAndCreateMissingParamError).toHaveBeenCalledWith("search_files", "regex")
			expect(mockedRegexSearchFiles).not.toHaveBeenCalled()
		})

		it("should handle partial blocks", async () => {
			const block: SearchFilesToolUse = {
				type: "tool_use",
				name: "search_files",
				params: {
					path: "src",
					regex: "test",
				},
				partial: true,
			}

			const mockAsk = vi.fn()
			mockTask.ask = mockAsk

			await searchFilesTool(
				mockTask as Task,
				block,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			expect(mockAsk).toHaveBeenCalled()
			expect(mockedRegexSearchFiles).not.toHaveBeenCalled()
		})

		it("should handle user rejection", async () => {
			const block: SearchFilesToolUse = {
				type: "tool_use",
				name: "search_files",
				params: {
					path: "src",
					regex: "test",
				},
				partial: false,
			}

			mockAskApproval.mockResolvedValue(false)

			await searchFilesTool(
				mockTask as Task,
				block,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			expect(mockedRegexSearchFiles).toHaveBeenCalled()
			expect(mockPushToolResult).not.toHaveBeenCalled()
		})
	})
})
