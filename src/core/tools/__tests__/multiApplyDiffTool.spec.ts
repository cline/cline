import { applyDiffTool } from "../multiApplyDiffTool"
import { EXPERIMENT_IDS } from "../../../shared/experiments"
import * as fs from "fs/promises"
import * as fileUtils from "../../../utils/fs"
import * as pathUtils from "../../../utils/path"

// Mock dependencies
vi.mock("fs/promises")
vi.mock("../../../utils/fs")
vi.mock("../../../utils/path")
vi.mock("../../../utils/xml")
vi.mock("../applyDiffTool", () => ({
	applyDiffToolLegacy: vi.fn(),
}))

// Mock TelemetryService
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		get instance() {
			return {
				trackEvent: vi.fn(),
				trackError: vi.fn(),
				captureDiffApplicationError: vi.fn(),
			}
		},
	},
}))

describe("multiApplyDiffTool", () => {
	let mockCline: any
	let mockBlock: any
	let mockAskApproval: any
	let mockHandleError: any
	let mockPushToolResult: any
	let mockRemoveClosingTag: any
	let mockProvider: any

	beforeEach(() => {
		vi.clearAllMocks()

		mockProvider = {
			getState: vi.fn().mockResolvedValue({
				experiments: {
					[EXPERIMENT_IDS.MULTI_FILE_APPLY_DIFF]: true,
				},
				diagnosticsEnabled: true,
				writeDelayMs: 0,
			}),
		}

		mockCline = {
			providerRef: {
				deref: vi.fn().mockReturnValue(mockProvider),
			},
			cwd: "/test",
			taskId: "test-task",
			consecutiveMistakeCount: 0,
			consecutiveMistakeCountForApplyDiff: new Map(),
			recordToolError: vi.fn(),
			say: vi.fn().mockResolvedValue(undefined),
			sayAndCreateMissingParamError: vi.fn().mockResolvedValue("Missing parameter error"),
			ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked", text: "", images: [] }),
			diffStrategy: {
				applyDiff: vi.fn().mockResolvedValue({
					success: true,
					content: "modified content",
				}),
				getProgressStatus: vi.fn(),
			},
			diffViewProvider: {
				reset: vi.fn().mockResolvedValue(undefined),
				editType: undefined,
				originalContent: undefined,
				open: vi.fn().mockResolvedValue(undefined),
				update: vi.fn().mockResolvedValue(undefined),
				scrollToFirstDiff: vi.fn(),
				saveDirectly: vi.fn().mockResolvedValue(undefined),
				saveChanges: vi.fn().mockResolvedValue(undefined),
				pushToolWriteResult: vi.fn().mockResolvedValue("File modified successfully"),
			},
			api: {
				getModel: vi.fn().mockReturnValue({ id: "test-model" }),
			},
			rooIgnoreController: {
				validateAccess: vi.fn().mockReturnValue(true),
			},
			rooProtectedController: {
				isWriteProtected: vi.fn().mockReturnValue(false),
			},
			fileContextTracker: {
				trackFileContext: vi.fn().mockResolvedValue(undefined),
			},
			didEditFile: false,
			processQueuedMessages: vi.fn(),
		} as any

		mockAskApproval = vi.fn().mockResolvedValue(true)
		mockHandleError = vi.fn()
		mockPushToolResult = vi.fn()
		mockRemoveClosingTag = vi.fn((tag, value) => value)

		// Mock file system operations
		;(fileUtils.fileExistsAtPath as any).mockResolvedValue(true)
		;(fs.readFile as any).mockResolvedValue("original content")
		;(pathUtils.getReadablePath as any).mockImplementation((cwd: string, path: string) => path)
	})

	describe("Early content validation", () => {
		it("should filter out non-string content at parse time", async () => {
			mockBlock = {
				params: {
					args: `<file>
						<path>test.ts</path>
						<diff>
							<content>valid string content</content>
						</diff>
					</file>`,
				},
				partial: false,
			}

			// Mock parseXml to return mixed content types
			const parseXml = await import("../../../utils/xml")
			;(parseXml.parseXml as any).mockReturnValue({
				file: {
					path: "test.ts",
					diff: [
						{ content: "<<<<<<< SEARCH\ntest\n=======\nreplaced\n>>>>>>> REPLACE" },
						{ content: null },
						{ content: undefined },
						{ content: 42 },
						{ content: "" }, // Empty string should also be filtered
						{ content: "<<<<<<< SEARCH\nmore\n=======\nchanges\n>>>>>>> REPLACE" },
					],
				},
			})

			await applyDiffTool(
				mockCline,
				mockBlock,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			// Should complete without error and only process valid string content
			expect(mockPushToolResult).toHaveBeenCalled()
			expect(mockHandleError).not.toHaveBeenCalled()

			// Verify that only valid diffs were processed
			const resultCall = mockPushToolResult.mock.calls[0][0]
			// Should not include the single block notice since we have 2 valid blocks
			expect(resultCall).not.toContain("Making multiple related changes")
		})
	})

	describe("SEARCH block counting with non-string content", () => {
		it("should handle diffItem.content being undefined", async () => {
			mockBlock = {
				params: {
					path: "test.ts",
					diff: undefined, // This will result in undefined content
				},
				partial: false,
			}

			await applyDiffTool(
				mockCline,
				mockBlock,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			// Should complete without throwing an error
			expect(mockPushToolResult).toHaveBeenCalled()
			expect(mockHandleError).not.toHaveBeenCalled()
		})

		it("should handle diffItem.content being null", async () => {
			mockBlock = {
				params: {
					args: `<file>
						<path>test.ts</path>
						<diff>
							<content></content>
						</diff>
					</file>`,
				},
				partial: false,
			}

			// Mock parseXml to return null content
			const parseXml = await import("../../../utils/xml")
			;(parseXml.parseXml as any).mockReturnValue({
				file: {
					path: "test.ts",
					diff: {
						content: null,
					},
				},
			})

			await applyDiffTool(
				mockCline,
				mockBlock,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			// Should complete without throwing an error
			expect(mockPushToolResult).toHaveBeenCalled()
			expect(mockHandleError).not.toHaveBeenCalled()
		})

		it("should handle diffItem.content being a number", async () => {
			mockBlock = {
				params: {
					args: `<file>
						<path>test.ts</path>
						<diff>
							<content>123</content>
						</diff>
					</file>`,
				},
				partial: false,
			}

			// Mock parseXml to return number content
			const parseXml = await import("../../../utils/xml")
			;(parseXml.parseXml as any).mockReturnValue({
				file: {
					path: "test.ts",
					diff: {
						content: 123, // Number instead of string
					},
				},
			})

			await applyDiffTool(
				mockCline,
				mockBlock,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			// Should complete without throwing an error
			expect(mockPushToolResult).toHaveBeenCalled()
			expect(mockHandleError).not.toHaveBeenCalled()
		})

		it("should correctly count SEARCH blocks when content is a valid string", async () => {
			const diffContent = `<<<<<<< SEARCH
old content
=======
new content
>>>>>>> REPLACE

<<<<<<< SEARCH
another old content
=======
another new content
>>>>>>> REPLACE`

			mockBlock = {
				params: {
					path: "test.ts",
					diff: diffContent,
				},
				partial: false,
			}

			await applyDiffTool(
				mockCline,
				mockBlock,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			// Should complete successfully
			expect(mockPushToolResult).toHaveBeenCalled()
			const resultCall = mockPushToolResult.mock.calls[0][0]
			// Should not include the single block notice since we have 2 blocks
			expect(resultCall).not.toContain("Making multiple related changes")
		})

		it("should show single block notice when only one SEARCH block exists", async () => {
			const diffContent = `<<<<<<< SEARCH
old content
=======
new content
>>>>>>> REPLACE`

			mockBlock = {
				params: {
					path: "test.ts",
					diff: diffContent,
				},
				partial: false,
			}

			await applyDiffTool(
				mockCline,
				mockBlock,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			// Should complete successfully
			expect(mockPushToolResult).toHaveBeenCalled()
			const resultCall = mockPushToolResult.mock.calls[0][0]
			// Should include the single block notice
			expect(resultCall).toContain("Making multiple related changes")
		})
	})

	describe("Edge cases for diff content", () => {
		it("should handle empty diff array", async () => {
			mockBlock = {
				params: {
					args: `<file>
						<path>test.ts</path>
						<diff></diff>
					</file>`,
				},
				partial: false,
			}

			const parseXml = await import("../../../utils/xml")
			;(parseXml.parseXml as any).mockReturnValue({
				file: {
					path: "test.ts",
					diff: [],
				},
			})

			await applyDiffTool(
				mockCline,
				mockBlock,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			// Should complete without error
			expect(mockPushToolResult).toHaveBeenCalled()
			expect(mockHandleError).not.toHaveBeenCalled()
		})

		it("should handle mixed content types in diff array", async () => {
			mockBlock = {
				params: {
					args: `<file>
						<path>test.ts</path>
						<diff>
							<content>valid string content</content>
						</diff>
					</file>`,
				},
				partial: false,
			}

			const parseXml = await import("../../../utils/xml")
			;(parseXml.parseXml as any).mockReturnValue({
				file: {
					path: "test.ts",
					diff: [
						{ content: "<<<<<<< SEARCH\ntest\n=======\nreplaced\n>>>>>>> REPLACE" },
						{ content: null },
						{ content: undefined },
						{ content: 42 },
						{ content: "<<<<<<< SEARCH\nmore\n=======\nchanges\n>>>>>>> REPLACE" },
					],
				},
			})

			await applyDiffTool(
				mockCline,
				mockBlock,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			// Should complete without error and count only valid string SEARCH blocks
			expect(mockPushToolResult).toHaveBeenCalled()
			expect(mockHandleError).not.toHaveBeenCalled()
		})
	})
})
