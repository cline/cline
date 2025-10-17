import { describe, it, expect, vi, beforeEach } from "vitest"
import { generateImageTool } from "../generateImageTool"
import { ToolUse } from "../../../shared/tools"
import { Task } from "../../task/Task"
import * as fs from "fs/promises"
import * as pathUtils from "../../../utils/pathUtils"
import * as fileUtils from "../../../utils/fs"
import { formatResponse } from "../../prompts/responses"
import { EXPERIMENT_IDS } from "../../../shared/experiments"
import { OpenRouterHandler } from "../../../api/providers/openrouter"

// Mock dependencies
vi.mock("fs/promises")
vi.mock("../../../utils/pathUtils")
vi.mock("../../../utils/fs")
vi.mock("../../../utils/safeWriteJson")
vi.mock("../../../api/providers/openrouter")

describe("generateImageTool", () => {
	let mockCline: any
	let mockAskApproval: any
	let mockHandleError: any
	let mockPushToolResult: any
	let mockRemoveClosingTag: any

	beforeEach(() => {
		vi.clearAllMocks()

		// Setup mock Cline instance
		mockCline = {
			cwd: "/test/workspace",
			consecutiveMistakeCount: 0,
			recordToolError: vi.fn(),
			recordToolUsage: vi.fn(),
			sayAndCreateMissingParamError: vi.fn().mockResolvedValue("Missing parameter error"),
			say: vi.fn(),
			rooIgnoreController: {
				validateAccess: vi.fn().mockReturnValue(true),
			},
			rooProtectedController: {
				isWriteProtected: vi.fn().mockReturnValue(false),
			},
			providerRef: {
				deref: vi.fn().mockReturnValue({
					getState: vi.fn().mockResolvedValue({
						experiments: {
							[EXPERIMENT_IDS.IMAGE_GENERATION]: true,
						},
						openRouterImageApiKey: "test-api-key",
						openRouterImageGenerationSelectedModel: "google/gemini-2.5-flash-image",
					}),
				}),
			},
			fileContextTracker: {
				trackFileContext: vi.fn(),
			},
			didEditFile: false,
		}

		mockAskApproval = vi.fn().mockResolvedValue(true)
		mockHandleError = vi.fn()
		mockPushToolResult = vi.fn()
		mockRemoveClosingTag = vi.fn((tag, content) => content || "")

		// Mock file system operations
		vi.mocked(fileUtils.fileExistsAtPath).mockResolvedValue(true)
		vi.mocked(fs.readFile).mockResolvedValue(Buffer.from("fake-image-data"))
		vi.mocked(fs.mkdir).mockResolvedValue(undefined)
		vi.mocked(fs.writeFile).mockResolvedValue(undefined)
		vi.mocked(pathUtils.isPathOutsideWorkspace).mockReturnValue(false)
	})

	describe("partial block handling", () => {
		it("should return early when block is partial", async () => {
			const partialBlock: ToolUse = {
				type: "tool_use",
				name: "generate_image",
				params: {
					prompt: "Generate a test image",
					path: "test-image.png",
				},
				partial: true,
			}

			await generateImageTool(
				mockCline as Task,
				partialBlock,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			// Should not process anything when partial
			expect(mockAskApproval).not.toHaveBeenCalled()
			expect(mockPushToolResult).not.toHaveBeenCalled()
			expect(mockCline.say).not.toHaveBeenCalled()
		})

		it("should return early when block is partial even with image parameter", async () => {
			const partialBlock: ToolUse = {
				type: "tool_use",
				name: "generate_image",
				params: {
					prompt: "Upscale this image",
					path: "upscaled-image.png",
					image: "source-image.png",
				},
				partial: true,
			}

			await generateImageTool(
				mockCline as Task,
				partialBlock,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			// Should not process anything when partial
			expect(mockAskApproval).not.toHaveBeenCalled()
			expect(mockPushToolResult).not.toHaveBeenCalled()
			expect(mockCline.say).not.toHaveBeenCalled()
			expect(fs.readFile).not.toHaveBeenCalled()
		})

		it("should process when block is not partial", async () => {
			const completeBlock: ToolUse = {
				type: "tool_use",
				name: "generate_image",
				params: {
					prompt: "Generate a test image",
					path: "test-image.png",
				},
				partial: false,
			}

			// Mock the OpenRouterHandler generateImage method
			const mockGenerateImage = vi.fn().mockResolvedValue({
				success: true,
				imageData: "data:image/png;base64,fakebase64data",
			})

			vi.mocked(OpenRouterHandler).mockImplementation(
				() =>
					({
						generateImage: mockGenerateImage,
					}) as any,
			)

			await generateImageTool(
				mockCline as Task,
				completeBlock,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			// Should process the complete block
			expect(mockAskApproval).toHaveBeenCalled()
			expect(mockGenerateImage).toHaveBeenCalled()
			expect(mockPushToolResult).toHaveBeenCalled()
		})

		it("should add cache-busting parameter to image URI", async () => {
			const completeBlock: ToolUse = {
				type: "tool_use",
				name: "generate_image",
				params: {
					prompt: "Generate a test image",
					path: "test-image.png",
				},
				partial: false,
			}

			// Mock convertToWebviewUri to return a test URI
			const mockWebviewUri = "https://file+.vscode-resource.vscode-cdn.net/test/workspace/test-image.png"
			mockCline.providerRef.deref().convertToWebviewUri = vi.fn().mockReturnValue(mockWebviewUri)

			// Mock the OpenRouterHandler generateImage method
			const mockGenerateImage = vi.fn().mockResolvedValue({
				success: true,
				imageData: "data:image/png;base64,fakebase64data",
			})

			vi.mocked(OpenRouterHandler).mockImplementation(
				() =>
					({
						generateImage: mockGenerateImage,
					}) as any,
			)

			await generateImageTool(
				mockCline as Task,
				completeBlock,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			// Check that cline.say was called with image data containing cache-busting parameter
			expect(mockCline.say).toHaveBeenCalledWith("image", expect.stringMatching(/"imageUri":"[^"]+\?t=\d+"/))

			// Verify the imageUri contains the cache-busting parameter
			const sayCall = mockCline.say.mock.calls.find((call: any[]) => call[0] === "image")
			if (sayCall) {
				const imageData = JSON.parse(sayCall[1])
				expect(imageData.imageUri).toMatch(/\?t=\d+$/)
				// Handle both Unix and Windows path separators
				const expectedPath =
					process.platform === "win32"
						? "\\test\\workspace\\test-image.png"
						: "/test/workspace/test-image.png"
				expect(imageData.imagePath).toBe(expectedPath)
			}
		})
	})

	describe("missing parameters", () => {
		it("should handle missing prompt parameter", async () => {
			const block: ToolUse = {
				type: "tool_use",
				name: "generate_image",
				params: {
					path: "test-image.png",
				},
				partial: false,
			}

			await generateImageTool(
				mockCline as Task,
				block,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			expect(mockCline.consecutiveMistakeCount).toBe(1)
			expect(mockCline.recordToolError).toHaveBeenCalledWith("generate_image")
			expect(mockCline.sayAndCreateMissingParamError).toHaveBeenCalledWith("generate_image", "prompt")
			expect(mockPushToolResult).toHaveBeenCalledWith("Missing parameter error")
		})

		it("should handle missing path parameter", async () => {
			const block: ToolUse = {
				type: "tool_use",
				name: "generate_image",
				params: {
					prompt: "Generate a test image",
				},
				partial: false,
			}

			await generateImageTool(
				mockCline as Task,
				block,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			expect(mockCline.consecutiveMistakeCount).toBe(1)
			expect(mockCline.recordToolError).toHaveBeenCalledWith("generate_image")
			expect(mockCline.sayAndCreateMissingParamError).toHaveBeenCalledWith("generate_image", "path")
			expect(mockPushToolResult).toHaveBeenCalledWith("Missing parameter error")
		})
	})

	describe("experiment validation", () => {
		it("should error when image generation experiment is disabled", async () => {
			// Disable the experiment
			mockCline.providerRef.deref().getState.mockResolvedValue({
				experiments: {
					[EXPERIMENT_IDS.IMAGE_GENERATION]: false,
				},
			})

			const block: ToolUse = {
				type: "tool_use",
				name: "generate_image",
				params: {
					prompt: "Generate a test image",
					path: "test-image.png",
				},
				partial: false,
			}

			await generateImageTool(
				mockCline as Task,
				block,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			expect(mockPushToolResult).toHaveBeenCalledWith(
				formatResponse.toolError(
					"Image generation is an experimental feature that must be enabled in settings. Please enable 'Image Generation' in the Experimental Settings section.",
				),
			)
		})
	})

	describe("input image validation", () => {
		it("should handle non-existent input image", async () => {
			vi.mocked(fileUtils.fileExistsAtPath).mockResolvedValue(false)

			const block: ToolUse = {
				type: "tool_use",
				name: "generate_image",
				params: {
					prompt: "Upscale this image",
					path: "upscaled.png",
					image: "non-existent.png",
				},
				partial: false,
			}

			await generateImageTool(
				mockCline as Task,
				block,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			expect(mockCline.say).toHaveBeenCalledWith("error", expect.stringContaining("Input image not found"))
			expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("Input image not found"))
		})

		it("should handle unsupported image format", async () => {
			const block: ToolUse = {
				type: "tool_use",
				name: "generate_image",
				params: {
					prompt: "Upscale this image",
					path: "upscaled.png",
					image: "test.bmp", // Unsupported format
				},
				partial: false,
			}

			await generateImageTool(
				mockCline as Task,
				block,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			expect(mockCline.say).toHaveBeenCalledWith("error", expect.stringContaining("Unsupported image format"))
			expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("Unsupported image format"))
		})
	})
})
