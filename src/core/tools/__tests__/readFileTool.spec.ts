// npx vitest src/core/tools/__tests__/readFileTool.spec.ts

import * as path from "path"

import { countFileLines } from "../../../integrations/misc/line-counter"
import { readLines } from "../../../integrations/misc/read-lines"
import { extractTextFromFile } from "../../../integrations/misc/extract-text"
import { parseSourceCodeDefinitionsForFile } from "../../../services/tree-sitter"
import { isBinaryFile } from "isbinaryfile"
import { ReadFileToolUse, ToolParamName, ToolResponse } from "../../../shared/tools"
import { readFileTool } from "../readFileTool"
import { formatResponse } from "../../prompts/responses"
import { DEFAULT_MAX_IMAGE_FILE_SIZE_MB, DEFAULT_MAX_TOTAL_IMAGE_SIZE_MB } from "../helpers/imageHelpers"

vi.mock("path", async () => {
	const originalPath = await vi.importActual("path")
	return {
		default: originalPath,
		...originalPath,
		resolve: vi.fn().mockImplementation((...args) => args.join("/")),
	}
})

// Already mocked above with hoisted fsPromises

vi.mock("isbinaryfile")

vi.mock("../../../integrations/misc/line-counter")
vi.mock("../../../integrations/misc/read-lines")

// Mock fs/promises readFile for image tests
const fsPromises = vi.hoisted(() => ({
	readFile: vi.fn(),
	stat: vi.fn().mockResolvedValue({ size: 1024 }),
}))
vi.mock("fs/promises", () => fsPromises)

// Mock input content for tests
let mockInputContent = ""

// First create all the mocks
vi.mock("../../../integrations/misc/extract-text", () => ({
	extractTextFromFile: vi.fn(),
	addLineNumbers: vi.fn(),
	getSupportedBinaryFormats: vi.fn(() => [".pdf", ".docx", ".ipynb"]),
}))
vi.mock("../../../services/tree-sitter")

// Then create the mock functions
const addLineNumbersMock = vi.fn().mockImplementation((text, startLine = 1) => {
	if (!text) return ""
	const lines = typeof text === "string" ? text.split("\n") : [text]
	return lines.map((line, i) => `${startLine + i} | ${line}`).join("\n")
})

const extractTextFromFileMock = vi.fn()
const getSupportedBinaryFormatsMock = vi.fn(() => [".pdf", ".docx", ".ipynb"])

// Mock formatResponse - use vi.hoisted to ensure mocks are available before vi.mock
const { toolResultMock, imageBlocksMock } = vi.hoisted(() => {
	const toolResultMock = vi.fn((text: string, images?: string[]) => {
		if (images && images.length > 0) {
			return [
				{ type: "text", text },
				...images.map((img) => {
					const [header, data] = img.split(",")
					const media_type = header.match(/:(.*?);/)?.[1] || "image/png"
					return { type: "image", source: { type: "base64", media_type, data } }
				}),
			]
		}
		return text
	})
	const imageBlocksMock = vi.fn((images?: string[]) => {
		return images
			? images.map((img) => {
					const [header, data] = img.split(",")
					const media_type = header.match(/:(.*?);/)?.[1] || "image/png"
					return { type: "image", source: { type: "base64", media_type, data } }
				})
			: []
	})
	return { toolResultMock, imageBlocksMock }
})

vi.mock("../../prompts/responses", () => ({
	formatResponse: {
		toolDenied: vi.fn(() => "The user denied this operation."),
		toolDeniedWithFeedback: vi.fn(
			(feedback?: string) =>
				`The user denied this operation and provided the following feedback:\n<feedback>\n${feedback}\n</feedback>`,
		),
		toolApprovedWithFeedback: vi.fn(
			(feedback?: string) =>
				`The user approved this operation and provided the following context:\n<feedback>\n${feedback}\n</feedback>`,
		),
		rooIgnoreError: vi.fn(
			(path: string) =>
				`Access to ${path} is blocked by the .rooignore file settings. You must try to continue in the task without using this file, or ask the user to update the .rooignore file.`,
		),
		toolResult: toolResultMock,
		imageBlocks: imageBlocksMock,
	},
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

vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn().mockReturnValue(true),
}))

// Global beforeEach to ensure clean mock state between all test suites
beforeEach(() => {
	// NOTE: Removed vi.clearAllMocks() to prevent interference with setImageSupport calls
	// Instead, individual suites clear their specific mocks to maintain isolation

	// Explicitly reset the hoisted mock implementations to prevent cross-suite pollution
	toolResultMock.mockImplementation((text: string, images?: string[]) => {
		if (images && images.length > 0) {
			return [
				{ type: "text", text },
				...images.map((img) => {
					const [header, data] = img.split(",")
					const media_type = header.match(/:(.*?);/)?.[1] || "image/png"
					return { type: "image", source: { type: "base64", media_type, data } }
				}),
			]
		}
		return text
	})

	imageBlocksMock.mockImplementation((images?: string[]) => {
		return images
			? images.map((img) => {
					const [header, data] = img.split(",")
					const media_type = header.match(/:(.*?);/)?.[1] || "image/png"
					return { type: "image", source: { type: "base64", media_type, data } }
				})
			: []
	})
})

// Mock i18n translation function
vi.mock("../../../i18n", () => ({
	t: vi.fn((key: string, params?: Record<string, any>) => {
		// Map translation keys to English text
		const translations: Record<string, string> = {
			"tools:readFile.imageWithSize": "Image file ({{size}} KB)",
			"tools:readFile.imageTooLarge":
				"Image file is too large ({{size}}). The maximum allowed size is {{max}} MB.",
			"tools:readFile.linesRange": " (lines {{start}}-{{end}})",
			"tools:readFile.definitionsOnly": " (definitions only)",
			"tools:readFile.maxLines": " (max {{max}} lines)",
		}

		let result = translations[key] || key

		// Simple template replacement
		if (params) {
			Object.entries(params).forEach(([param, value]) => {
				result = result.replace(new RegExp(`{{${param}}}`, "g"), String(value))
			})
		}

		return result
	}),
}))

// Shared mock setup function to ensure consistent state across all test suites
function createMockCline(): any {
	const mockProvider = {
		getState: vi.fn(),
		deref: vi.fn().mockReturnThis(),
	}

	const mockCline: any = {
		cwd: "/",
		task: "Test",
		providerRef: mockProvider,
		rooIgnoreController: {
			validateAccess: vi.fn().mockReturnValue(true),
		},
		say: vi.fn().mockResolvedValue(undefined),
		ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
		presentAssistantMessage: vi.fn(),
		handleError: vi.fn().mockResolvedValue(undefined),
		pushToolResult: vi.fn(),
		removeClosingTag: vi.fn((tag, content) => content),
		fileContextTracker: {
			trackFileContext: vi.fn().mockResolvedValue(undefined),
		},
		recordToolUsage: vi.fn().mockReturnValue(undefined),
		recordToolError: vi.fn().mockReturnValue(undefined),
		didRejectTool: false,
		// CRITICAL: Always ensure image support is enabled
		api: {
			getModel: vi.fn().mockReturnValue({
				info: { supportsImages: true },
			}),
		},
	}

	return { mockCline, mockProvider }
}

// Helper function to set image support without affecting shared state
function setImageSupport(mockCline: any, supportsImages: boolean | undefined): void {
	mockCline.api = {
		getModel: vi.fn().mockReturnValue({
			info: { supportsImages },
		}),
	}
}

describe("read_file tool with maxReadFileLine setting", () => {
	// Test data
	const testFilePath = "test/file.txt"
	const absoluteFilePath = "/test/file.txt"
	const fileContent = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5"
	const numberedFileContent = "1 | Line 1\n2 | Line 2\n3 | Line 3\n4 | Line 4\n5 | Line 5\n"
	const sourceCodeDef = "\n\n# file.txt\n1--5 | Content"

	// Mocked functions with correct types
	const mockedCountFileLines = vi.mocked(countFileLines)
	const mockedReadLines = vi.mocked(readLines)
	const mockedExtractTextFromFile = vi.mocked(extractTextFromFile)
	const mockedParseSourceCodeDefinitionsForFile = vi.mocked(parseSourceCodeDefinitionsForFile)

	const mockedIsBinaryFile = vi.mocked(isBinaryFile)
	const mockedPathResolve = vi.mocked(path.resolve)

	let mockCline: any
	let mockProvider: any
	let toolResult: ToolResponse | undefined

	beforeEach(() => {
		// Clear specific mocks (not all mocks to preserve shared state)
		mockedCountFileLines.mockClear()
		mockedExtractTextFromFile.mockClear()
		mockedIsBinaryFile.mockClear()
		mockedPathResolve.mockClear()
		addLineNumbersMock.mockClear()
		extractTextFromFileMock.mockClear()
		toolResultMock.mockClear()

		// Use shared mock setup function
		const mocks = createMockCline()
		mockCline = mocks.mockCline
		mockProvider = mocks.mockProvider

		// Explicitly disable image support for text file tests to prevent cross-suite pollution
		setImageSupport(mockCline, false)

		mockedPathResolve.mockReturnValue(absoluteFilePath)
		mockedIsBinaryFile.mockResolvedValue(false)

		mockInputContent = fileContent

		// Setup the extractTextFromFile mock implementation with the current mockInputContent
		// Reset the spy before each test
		addLineNumbersMock.mockClear()

		// Setup the extractTextFromFile mock to call our spy
		mockedExtractTextFromFile.mockImplementation((_filePath) => {
			// Call the spy and return its result
			return Promise.resolve(addLineNumbersMock(mockInputContent))
		})

		toolResult = undefined
	})

	/**
	 * Helper function to execute the read file tool with different maxReadFileLine settings
	 */
	async function executeReadFileTool(
		params: Partial<ReadFileToolUse["params"]> = {},
		options: {
			maxReadFileLine?: number
			totalLines?: number
			skipAddLineNumbersCheck?: boolean // Flag to skip addLineNumbers check
			path?: string
			start_line?: string
			end_line?: string
		} = {},
	): Promise<ToolResponse | undefined> {
		// Configure mocks based on test scenario
		const maxReadFileLine = options.maxReadFileLine ?? 500
		const totalLines = options.totalLines ?? 5

		mockProvider.getState.mockResolvedValue({ maxReadFileLine, maxImageFileSize: 20, maxTotalImageSize: 20 })
		mockedCountFileLines.mockResolvedValue(totalLines)

		// Reset the spy before each test
		addLineNumbersMock.mockClear()

		// Format args string based on params
		let argsContent = `<file><path>${options.path || testFilePath}</path>`
		if (options.start_line && options.end_line) {
			argsContent += `<line_range>${options.start_line}-${options.end_line}</line_range>`
		}
		argsContent += `</file>`

		// Create a tool use object
		const toolUse: ReadFileToolUse = {
			type: "tool_use",
			name: "read_file",
			params: { args: argsContent, ...params },
			partial: false,
		}

		await readFileTool(
			mockCline,
			toolUse,
			mockCline.ask,
			vi.fn(),
			(result: ToolResponse) => {
				toolResult = result
			},
			(_: ToolParamName, content?: string) => content ?? "",
		)

		return toolResult
	}

	describe("when maxReadFileLine is negative", () => {
		it("should read the entire file using extractTextFromFile", async () => {
			// Setup - use default mockInputContent
			mockInputContent = fileContent

			// Execute
			const result = await executeReadFileTool({}, { maxReadFileLine: -1 })

			// Verify - just check that the result contains the expected elements
			expect(result).toContain(`<file><path>${testFilePath}</path>`)
			expect(result).toContain(`<content lines="1-5">`)
		})

		it("should not show line snippet in approval message when maxReadFileLine is -1", async () => {
			// This test verifies the line snippet behavior for the approval message
			// Setup - use default mockInputContent
			mockInputContent = fileContent

			// Execute - we'll reuse executeReadFileTool to run the tool
			await executeReadFileTool({}, { maxReadFileLine: -1 })

			// Verify the empty line snippet for full read was passed to the approval message
			// Look at the parameters passed to the 'ask' method in the approval message
			const askCall = mockCline.ask.mock.calls[0]
			const completeMessage = JSON.parse(askCall[1])

			// Verify the reason (lineSnippet) is empty or undefined for full read
			expect(completeMessage.reason).toBeFalsy()
		})
	})

	describe("when maxReadFileLine is 0", () => {
		it("should return an empty content with source code definitions", async () => {
			// Setup - for maxReadFileLine = 0, the implementation won't call readLines
			mockedParseSourceCodeDefinitionsForFile.mockResolvedValue(sourceCodeDef)

			// Execute - skip addLineNumbers check as it's not called for maxReadFileLine=0
			const result = await executeReadFileTool(
				{},
				{
					maxReadFileLine: 0,
					totalLines: 5,
					skipAddLineNumbersCheck: true,
				},
			)

			// Verify
			expect(result).toContain(`<file><path>${testFilePath}</path>`)
			expect(result).toContain(`<list_code_definition_names>`)

			// Verify XML structure
			expect(result).toContain("<notice>Showing only 0 of 5 total lines")
			expect(result).toContain("</notice>")
			expect(result).toContain("<list_code_definition_names>")
			expect(result).toContain(sourceCodeDef.trim())
			expect(result).toContain("</list_code_definition_names>")
			expect(result).not.toContain("<content") // No content when maxReadFileLine is 0
		})
	})

	describe("when maxReadFileLine is less than file length", () => {
		it("should read only maxReadFileLine lines and add source code definitions", async () => {
			// Setup
			const content = "Line 1\nLine 2\nLine 3"
			const numberedContent = "1 | Line 1\n2 | Line 2\n3 | Line 3"
			mockedReadLines.mockResolvedValue(content)
			mockedParseSourceCodeDefinitionsForFile.mockResolvedValue(sourceCodeDef)

			// Setup addLineNumbers to always return numbered content
			addLineNumbersMock.mockReturnValue(numberedContent)

			// Execute
			const result = await executeReadFileTool({}, { maxReadFileLine: 3 })

			// Verify - just check that the result contains the expected elements
			expect(result).toContain(`<file><path>${testFilePath}</path>`)
			expect(result).toContain(`<content lines="1-3">`)
			expect(result).toContain(`<list_code_definition_names>`)
			expect(result).toContain("<notice>Showing only 3 of 5 total lines")
		})
	})

	describe("when maxReadFileLine equals or exceeds file length", () => {
		it("should use extractTextFromFile when maxReadFileLine > totalLines", async () => {
			// Setup
			mockedCountFileLines.mockResolvedValue(5) // File shorter than maxReadFileLine
			mockInputContent = fileContent

			// Execute
			const result = await executeReadFileTool({}, { maxReadFileLine: 10, totalLines: 5 })

			// Verify - just check that the result contains the expected elements
			expect(result).toContain(`<file><path>${testFilePath}</path>`)
			expect(result).toContain(`<content lines="1-5">`)
		})

		it("should read with extractTextFromFile when file has few lines", async () => {
			// Setup
			mockedCountFileLines.mockResolvedValue(3) // File shorter than maxReadFileLine
			mockInputContent = fileContent

			// Execute
			const result = await executeReadFileTool({}, { maxReadFileLine: 5, totalLines: 3 })

			// Verify - just check that the result contains the expected elements
			expect(result).toContain(`<file><path>${testFilePath}</path>`)
			expect(result).toContain(`<content lines="1-3">`)
		})
	})

	describe("when file is binary", () => {
		it("should always use extractTextFromFile regardless of maxReadFileLine", async () => {
			// Setup
			mockedIsBinaryFile.mockResolvedValue(true)
			mockedCountFileLines.mockResolvedValue(3)
			mockedExtractTextFromFile.mockResolvedValue("")

			// Execute
			const result = await executeReadFileTool({}, { maxReadFileLine: 3, totalLines: 3 })

			// Verify - just check basic structure, the actual binary handling may vary
			expect(result).toContain(`<file><path>${testFilePath}</path>`)
			expect(typeof result).toBe("string")
		})
	})

	describe("with range parameters", () => {
		it("should honor start_line and end_line when provided", async () => {
			// Setup
			mockedReadLines.mockResolvedValue("Line 2\nLine 3\nLine 4")

			// Execute using executeReadFileTool with range parameters
			const rangeResult = await executeReadFileTool(
				{},
				{
					start_line: "2",
					end_line: "4",
				},
			)

			// Verify - just check that the result contains the expected elements
			expect(rangeResult).toContain(`<file><path>${testFilePath}</path>`)
			expect(rangeResult).toContain(`<content lines="2-4">`)
		})
	})
})

describe("read_file tool XML output structure", () => {
	// Test basic XML structure
	const testFilePath = "test/file.txt"
	const absoluteFilePath = "/test/file.txt"
	const fileContent = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5"

	const mockedCountFileLines = vi.mocked(countFileLines)
	const mockedExtractTextFromFile = vi.mocked(extractTextFromFile)
	const mockedIsBinaryFile = vi.mocked(isBinaryFile)
	const mockedPathResolve = vi.mocked(path.resolve)
	const mockedFsReadFile = vi.mocked(fsPromises.readFile)
	const imageBuffer = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
		"base64",
	)

	let mockCline: any
	let mockProvider: any
	let toolResult: ToolResponse | undefined

	beforeEach(() => {
		// Clear specific mocks (not all mocks to preserve shared state)
		mockedCountFileLines.mockClear()
		mockedExtractTextFromFile.mockClear()
		mockedIsBinaryFile.mockClear()
		mockedPathResolve.mockClear()
		addLineNumbersMock.mockClear()
		extractTextFromFileMock.mockClear()
		toolResultMock.mockClear()

		// CRITICAL: Reset fsPromises mocks to prevent cross-test contamination
		fsPromises.stat.mockClear()
		fsPromises.stat.mockResolvedValue({ size: 1024 })
		fsPromises.readFile.mockClear()

		// Use shared mock setup function
		const mocks = createMockCline()
		mockCline = mocks.mockCline
		mockProvider = mocks.mockProvider

		// Explicitly enable image support for this test suite (contains image memory tests)
		setImageSupport(mockCline, true)

		mockedPathResolve.mockReturnValue(absoluteFilePath)
		mockedIsBinaryFile.mockResolvedValue(false)

		// Set default implementation for extractTextFromFile
		mockedExtractTextFromFile.mockImplementation((filePath) => {
			return Promise.resolve(addLineNumbersMock(mockInputContent))
		})

		mockInputContent = fileContent

		// Setup mock provider with default maxReadFileLine
		mockProvider.getState.mockResolvedValue({ maxReadFileLine: -1, maxImageFileSize: 20, maxTotalImageSize: 20 }) // Default to full file read

		// Add additional properties needed for XML tests
		mockCline.sayAndCreateMissingParamError = vi.fn().mockResolvedValue("Missing required parameter")

		toolResult = undefined
	})

	async function executeReadFileTool(
		params: {
			args?: string
		} = {},
		options: {
			totalLines?: number
			maxReadFileLine?: number
			isBinary?: boolean
			validateAccess?: boolean
		} = {},
	): Promise<ToolResponse | undefined> {
		// Configure mocks based on test scenario
		const totalLines = options.totalLines ?? 5
		const maxReadFileLine = options.maxReadFileLine ?? 500
		const isBinary = options.isBinary ?? false
		const validateAccess = options.validateAccess ?? true

		mockProvider.getState.mockResolvedValue({ maxReadFileLine, maxImageFileSize: 20, maxTotalImageSize: 20 })
		mockedCountFileLines.mockResolvedValue(totalLines)
		mockedIsBinaryFile.mockResolvedValue(isBinary)
		mockCline.rooIgnoreController.validateAccess = vi.fn().mockReturnValue(validateAccess)

		let argsContent = `<file><path>${testFilePath}</path></file>`

		// Create a tool use object
		const toolUse: ReadFileToolUse = {
			type: "tool_use",
			name: "read_file",
			params: { args: argsContent, ...params },
			partial: false,
		}

		// Execute the tool
		await readFileTool(
			mockCline,
			toolUse,
			mockCline.ask,
			vi.fn(),
			(result: ToolResponse) => {
				toolResult = result
			},
			(param: ToolParamName, content?: string) => content ?? "",
		)

		return toolResult
	}

	describe("Basic XML Structure Tests", () => {
		it("should produce XML output with no unnecessary indentation", async () => {
			// Setup
			const numberedContent = "1 | Line 1\n2 | Line 2\n3 | Line 3\n4 | Line 4\n5 | Line 5"
			// For XML structure test
			mockedExtractTextFromFile.mockImplementation(() => {
				addLineNumbersMock(mockInputContent)
				return Promise.resolve(numberedContent)
			})
			mockProvider.getState.mockResolvedValue({
				maxReadFileLine: -1,
				maxImageFileSize: 20,
				maxTotalImageSize: 20,
			}) // Allow up to 20MB per image and total size

			// Execute
			const result = await executeReadFileTool()

			// Verify
			expect(result).toBe(
				`<files>\n<file><path>${testFilePath}</path>\n<content lines="1-5">\n${numberedContent}</content>\n</file>\n</files>`,
			)
		})

		it("should follow the correct XML structure format", async () => {
			// Setup
			mockInputContent = fileContent
			// Execute
			const result = await executeReadFileTool({}, { maxReadFileLine: -1 })

			// Verify using regex to check structure
			const xmlStructureRegex = new RegExp(
				`^<files>\\n<file><path>${testFilePath}</path>\\n<content lines="1-5">\\n.*</content>\\n</file>\\n</files>$`,
				"s",
			)
			expect(result).toMatch(xmlStructureRegex)
		})

		it("should handle empty files correctly", async () => {
			// Setup
			mockedCountFileLines.mockResolvedValue(0)
			mockedExtractTextFromFile.mockResolvedValue("")
			mockProvider.getState.mockResolvedValue({
				maxReadFileLine: -1,
				maxImageFileSize: 20,
				maxTotalImageSize: 20,
			}) // Allow up to 20MB per image and total size

			// Execute
			const result = await executeReadFileTool({}, { totalLines: 0 })

			// Verify
			expect(result).toBe(
				`<files>\n<file><path>${testFilePath}</path>\n<content/><notice>File is empty</notice>\n</file>\n</files>`,
			)
		})

		describe("Total Image Memory Limit", () => {
			const testImages = [
				{ path: "test/image1.png", sizeKB: 5120 }, // 5MB
				{ path: "test/image2.jpg", sizeKB: 10240 }, // 10MB
				{ path: "test/image3.gif", sizeKB: 8192 }, // 8MB
			]

			// Define imageBuffer for this test suite
			const imageBuffer = Buffer.from(
				"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
				"base64",
			)

			beforeEach(() => {
				// CRITICAL: Reset fsPromises mocks to prevent cross-test contamination within this suite
				fsPromises.stat.mockClear()
				fsPromises.readFile.mockClear()
			})

			async function executeReadMultipleImagesTool(imagePaths: string[]): Promise<ToolResponse | undefined> {
				// Ensure image support is enabled before calling the tool
				setImageSupport(mockCline, true)

				// Create args content for multiple files
				const filesXml = imagePaths.map((path) => `<file><path>${path}</path></file>`).join("")
				const argsContent = filesXml

				const toolUse: ReadFileToolUse = {
					type: "tool_use",
					name: "read_file",
					params: { args: argsContent },
					partial: false,
				}

				let localResult: ToolResponse | undefined
				await readFileTool(
					mockCline,
					toolUse,
					mockCline.ask,
					vi.fn(),
					(result: ToolResponse) => {
						localResult = result
					},
					(_: ToolParamName, content?: string) => content ?? "",
				)
				// In multi-image scenarios, the result is pushed to pushToolResult, not returned directly.
				// We need to check the mock's calls to get the result.
				if (mockCline.pushToolResult.mock.calls.length > 0) {
					return mockCline.pushToolResult.mock.calls[0][0]
				}

				return localResult
			}

			it("should allow multiple images under the total memory limit", async () => {
				// Setup required mocks (don't clear all mocks - preserve API setup)
				mockedIsBinaryFile.mockResolvedValue(true)
				mockedCountFileLines.mockResolvedValue(0)
				fsPromises.readFile.mockResolvedValue(
					Buffer.from(
						"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
						"base64",
					),
				)

				// Setup mockProvider
				mockProvider.getState.mockResolvedValue({
					maxReadFileLine: -1,
					maxImageFileSize: 20,
					maxTotalImageSize: 20,
				}) // Allow up to 20MB per image and total size

				// Setup mockCline properties (preserve existing API)
				mockCline.cwd = "/"
				mockCline.task = "Test"
				mockCline.providerRef = mockProvider
				mockCline.rooIgnoreController = {
					validateAccess: vi.fn().mockReturnValue(true),
				}
				mockCline.say = vi.fn().mockResolvedValue(undefined)
				mockCline.ask = vi.fn().mockResolvedValue({ response: "yesButtonClicked" })
				mockCline.presentAssistantMessage = vi.fn()
				mockCline.handleError = vi.fn().mockResolvedValue(undefined)
				mockCline.pushToolResult = vi.fn()
				mockCline.removeClosingTag = vi.fn((tag, content) => content)
				mockCline.fileContextTracker = {
					trackFileContext: vi.fn().mockResolvedValue(undefined),
				}
				mockCline.recordToolUsage = vi.fn().mockReturnValue(undefined)
				mockCline.recordToolError = vi.fn().mockReturnValue(undefined)
				setImageSupport(mockCline, true)

				// Setup - images that fit within 20MB limit
				const smallImages = [
					{ path: "test/small1.png", sizeKB: 2048 }, // 2MB
					{ path: "test/small2.jpg", sizeKB: 3072 }, // 3MB
					{ path: "test/small3.gif", sizeKB: 4096 }, // 4MB
				] // Total: 9MB (under 20MB limit)

				// Mock file stats for each image
				fsPromises.stat = vi.fn().mockImplementation((filePath) => {
					const normalizedFilePath = path.normalize(filePath.toString())
					const image = smallImages.find((img) => normalizedFilePath.includes(path.normalize(img.path)))
					return Promise.resolve({ size: (image?.sizeKB || 1024) * 1024 })
				})

				// Mock path.resolve for each image
				mockedPathResolve.mockImplementation((cwd, relPath) => `/${relPath}`)

				// Execute
				const result = await executeReadMultipleImagesTool(smallImages.map((img) => img.path))

				// Verify all images were processed (should be a multi-part response)
				expect(Array.isArray(result)).toBe(true)
				const parts = result as any[]

				// Should have text part and 3 image parts
				const textPart = parts.find((p) => p.type === "text")?.text
				const imageParts = parts.filter((p) => p.type === "image")

				expect(textPart).toBeDefined()
				expect(imageParts).toHaveLength(3)

				// Verify no memory limit notices
				expect(textPart).not.toContain("Total image memory would exceed")
			})

			it("should skip images that would exceed the total memory limit", async () => {
				// Setup required mocks (don't clear all mocks)
				mockedIsBinaryFile.mockResolvedValue(true)
				mockedCountFileLines.mockResolvedValue(0)
				fsPromises.readFile.mockResolvedValue(
					Buffer.from(
						"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
						"base64",
					),
				)

				// Setup mockProvider
				mockProvider.getState.mockResolvedValue({
					maxReadFileLine: -1,
					maxImageFileSize: 15,
					maxTotalImageSize: 20,
				}) // Allow up to 15MB per image and 20MB total size

				// Setup mockCline properties
				mockCline.cwd = "/"
				mockCline.task = "Test"
				mockCline.providerRef = mockProvider
				mockCline.rooIgnoreController = {
					validateAccess: vi.fn().mockReturnValue(true),
				}
				mockCline.say = vi.fn().mockResolvedValue(undefined)
				mockCline.ask = vi.fn().mockResolvedValue({ response: "yesButtonClicked" })
				mockCline.presentAssistantMessage = vi.fn()
				mockCline.handleError = vi.fn().mockResolvedValue(undefined)
				mockCline.pushToolResult = vi.fn()
				mockCline.removeClosingTag = vi.fn((tag, content) => content)
				mockCline.fileContextTracker = {
					trackFileContext: vi.fn().mockResolvedValue(undefined),
				}
				mockCline.recordToolUsage = vi.fn().mockReturnValue(undefined)
				mockCline.recordToolError = vi.fn().mockReturnValue(undefined)
				setImageSupport(mockCline, true)

				// Setup - images where later ones would exceed 20MB total limit
				// Each must be under 5MB per-file limit (5120KB)
				const largeImages = [
					{ path: "test/large1.png", sizeKB: 5017 }, // ~4.9MB
					{ path: "test/large2.jpg", sizeKB: 5017 }, // ~4.9MB
					{ path: "test/large3.gif", sizeKB: 5017 }, // ~4.9MB
					{ path: "test/large4.png", sizeKB: 5017 }, // ~4.9MB
					{ path: "test/large5.jpg", sizeKB: 5017 }, // ~4.9MB - This should be skipped (total would be ~24.5MB > 20MB)
				]

				// Mock file stats for each image
				fsPromises.stat = vi.fn().mockImplementation((filePath) => {
					const normalizedFilePath = path.normalize(filePath.toString())
					const image = largeImages.find((img) => normalizedFilePath.includes(path.normalize(img.path)))
					return Promise.resolve({ size: (image?.sizeKB || 1024) * 1024 })
				})

				// Mock path.resolve for each image
				mockedPathResolve.mockImplementation((cwd, relPath) => `/${relPath}`)

				// Execute
				const result = await executeReadMultipleImagesTool(largeImages.map((img) => img.path))

				// Verify result structure - should be a mix of successful images and skipped notices
				expect(Array.isArray(result)).toBe(true)
				const parts = result as any[]

				const textPart = Array.isArray(result) ? result.find((p) => p.type === "text")?.text : result
				const imageParts = Array.isArray(result) ? result.filter((p) => p.type === "image") : []

				expect(textPart).toBeDefined()

				// Debug: Show what we actually got vs expected
				if (imageParts.length !== 4) {
					throw new Error(
						`Expected 4 images, got ${imageParts.length}. Full result: ${JSON.stringify(result, null, 2)}. Text part: ${textPart}`,
					)
				}
				expect(imageParts).toHaveLength(4) // First 4 images should be included (~19.6MB total)

				// Verify memory limit notice for the fifth image
				expect(textPart).toContain("Image skipped to avoid size limit (20MB)")
				expect(textPart).toMatch(/Current: \d+(\.\d+)? MB/)
				expect(textPart).toMatch(/this file: \d+(\.\d+)? MB/)
			})

			it("should track memory usage correctly across multiple images", async () => {
				// Setup mocks (don't clear all mocks)

				// Setup required mocks
				mockedIsBinaryFile.mockResolvedValue(true)
				mockedCountFileLines.mockResolvedValue(0)
				fsPromises.readFile.mockResolvedValue(
					Buffer.from(
						"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
						"base64",
					),
				)

				// Setup mockProvider
				mockProvider.getState.mockResolvedValue({
					maxReadFileLine: -1,
					maxImageFileSize: 15,
					maxTotalImageSize: 20,
				}) // Allow up to 15MB per image and 20MB total size

				// Setup mockCline properties
				mockCline.cwd = "/"
				mockCline.task = "Test"
				mockCline.providerRef = mockProvider
				mockCline.rooIgnoreController = {
					validateAccess: vi.fn().mockReturnValue(true),
				}
				mockCline.say = vi.fn().mockResolvedValue(undefined)
				mockCline.ask = vi.fn().mockResolvedValue({ response: "yesButtonClicked" })
				mockCline.presentAssistantMessage = vi.fn()
				mockCline.handleError = vi.fn().mockResolvedValue(undefined)
				mockCline.pushToolResult = vi.fn()
				mockCline.removeClosingTag = vi.fn((tag, content) => content)
				mockCline.fileContextTracker = {
					trackFileContext: vi.fn().mockResolvedValue(undefined),
				}
				mockCline.recordToolUsage = vi.fn().mockReturnValue(undefined)
				mockCline.recordToolError = vi.fn().mockReturnValue(undefined)
				setImageSupport(mockCline, true)

				// Setup - images that exactly reach the limit
				const exactLimitImages = [
					{ path: "test/exact1.png", sizeKB: 10240 }, // 10MB
					{ path: "test/exact2.jpg", sizeKB: 10240 }, // 10MB - Total exactly 20MB
					{ path: "test/exact3.gif", sizeKB: 1024 }, // 1MB - This should be skipped
				]

				// Mock file stats with simpler logic
				fsPromises.stat = vi.fn().mockImplementation((filePath) => {
					const normalizedFilePath = path.normalize(filePath.toString())
					const image = exactLimitImages.find((img) => normalizedFilePath.includes(path.normalize(img.path)))
					if (image) {
						return Promise.resolve({ size: image.sizeKB * 1024 })
					}
					return Promise.resolve({ size: 1024 * 1024 }) // Default 1MB
				})

				// Mock path.resolve
				mockedPathResolve.mockImplementation((cwd, relPath) => `/${relPath}`)

				// Execute
				const result = await executeReadMultipleImagesTool(exactLimitImages.map((img) => img.path))

				// Verify
				const textPart = Array.isArray(result) ? result.find((p) => p.type === "text")?.text : result
				const imageParts = Array.isArray(result) ? result.filter((p) => p.type === "image") : []

				expect(imageParts).toHaveLength(2) // First 2 images should fit
				expect(textPart).toContain("Image skipped to avoid size limit (20MB)")
				expect(textPart).toMatch(/Current: \d+(\.\d+)? MB/)
				expect(textPart).toMatch(/this file: \d+(\.\d+)? MB/)
			})

			it("should handle individual image size limit and total memory limit together", async () => {
				// Setup mocks (don't clear all mocks)

				// Setup required mocks
				mockedIsBinaryFile.mockResolvedValue(true)
				mockedCountFileLines.mockResolvedValue(0)
				fsPromises.readFile.mockResolvedValue(
					Buffer.from(
						"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
						"base64",
					),
				)

				// Setup mockProvider
				mockProvider.getState.mockResolvedValue({
					maxReadFileLine: -1,
					maxImageFileSize: 20,
					maxTotalImageSize: 20,
				}) // Allow up to 20MB per image and total size

				// Setup mockCline properties (complete setup)
				mockCline.cwd = "/"
				mockCline.task = "Test"
				mockCline.providerRef = mockProvider
				mockCline.rooIgnoreController = {
					validateAccess: vi.fn().mockReturnValue(true),
				}
				mockCline.say = vi.fn().mockResolvedValue(undefined)
				mockCline.ask = vi.fn().mockResolvedValue({ response: "yesButtonClicked" })
				mockCline.presentAssistantMessage = vi.fn()
				mockCline.handleError = vi.fn().mockResolvedValue(undefined)
				mockCline.pushToolResult = vi.fn()
				mockCline.removeClosingTag = vi.fn((tag, content) => content)
				mockCline.fileContextTracker = {
					trackFileContext: vi.fn().mockResolvedValue(undefined),
				}
				mockCline.recordToolUsage = vi.fn().mockReturnValue(undefined)
				mockCline.recordToolError = vi.fn().mockReturnValue(undefined)
				setImageSupport(mockCline, true)

				// Setup - mix of images with individual size violations and total memory issues
				const mixedImages = [
					{ path: "test/ok.png", sizeKB: 3072 }, // 3MB - OK
					{ path: "test/too-big.jpg", sizeKB: 6144 }, // 6MB - Exceeds individual 5MB limit
					{ path: "test/ok2.gif", sizeKB: 4096 }, // 4MB - OK individually but might exceed total
				]

				// Mock file stats
				fsPromises.stat = vi.fn().mockImplementation((filePath) => {
					const fileName = path.basename(filePath)
					const baseName = path.parse(fileName).name
					const image = mixedImages.find((img) => img.path.includes(baseName))
					return Promise.resolve({ size: (image?.sizeKB || 1024) * 1024 })
				})

				// Mock provider state with 5MB individual limit
				mockProvider.getState.mockResolvedValue({
					maxReadFileLine: -1,
					maxImageFileSize: 5,
					maxTotalImageSize: 20,
				})

				// Mock path.resolve
				mockedPathResolve.mockImplementation((cwd, relPath) => `/${relPath}`)

				// Execute
				const result = await executeReadMultipleImagesTool(mixedImages.map((img) => img.path))

				// Verify
				expect(Array.isArray(result)).toBe(true)
				const parts = result as any[]

				const textPart = parts.find((p) => p.type === "text")?.text
				const imageParts = parts.filter((p) => p.type === "image")

				// Should have 2 images (ok.png and ok2.gif)
				expect(imageParts).toHaveLength(2)

				// Should show individual size limit violation
				expect(textPart).toMatch(
					/Image file is too large \(\d+(\.\d+)? MB\)\. The maximum allowed size is 5 MB\./,
				)
			})

			it("should correctly calculate total memory and skip the last image", async () => {
				// Setup
				const testImages = [
					{ path: "test/image1.png", sizeMB: 8 },
					{ path: "test/image2.png", sizeMB: 8 },
					{ path: "test/image3.png", sizeMB: 8 }, // This one should be skipped
				]

				mockProvider.getState.mockResolvedValue({
					maxReadFileLine: -1,
					maxImageFileSize: 10, // 10MB per image
					maxTotalImageSize: 20, // 20MB total
				})

				mockedIsBinaryFile.mockResolvedValue(true)
				mockedCountFileLines.mockResolvedValue(0)
				mockedFsReadFile.mockResolvedValue(imageBuffer)

				fsPromises.stat.mockImplementation(async (filePath) => {
					const normalizedFilePath = path.normalize(filePath.toString())
					const file = testImages.find((f) => normalizedFilePath.includes(path.normalize(f.path)))
					if (file) {
						return { size: file.sizeMB * 1024 * 1024 }
					}
					return { size: 1024 * 1024 } // Default 1MB
				})

				const imagePaths = testImages.map((img) => img.path)
				const result = await executeReadMultipleImagesTool(imagePaths)

				expect(Array.isArray(result)).toBe(true)
				const parts = result as any[]
				const textPart = parts.find((p) => p.type === "text")?.text
				const imageParts = parts.filter((p) => p.type === "image")

				expect(imageParts).toHaveLength(2) // First two images should be processed
				expect(textPart).toContain("Image skipped to avoid size limit (20MB)")
				expect(textPart).toMatch(/Current: \d+(\.\d+)? MB/)
				expect(textPart).toMatch(/this file: \d+(\.\d+)? MB/)
			})

			it("should reset total memory tracking for each tool invocation", async () => {
				// Setup mocks (don't clear all mocks)

				// Setup required mocks for first batch
				mockedIsBinaryFile.mockResolvedValue(true)
				mockedCountFileLines.mockResolvedValue(0)
				fsPromises.readFile.mockResolvedValue(
					Buffer.from(
						"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
						"base64",
					),
				)

				// Setup mockProvider
				mockProvider.getState.mockResolvedValue({
					maxReadFileLine: -1,
					maxImageFileSize: 20,
					maxTotalImageSize: 20,
				})

				// Setup mockCline properties (complete setup)
				mockCline.cwd = "/"
				mockCline.task = "Test"
				mockCline.providerRef = mockProvider
				mockCline.rooIgnoreController = {
					validateAccess: vi.fn().mockReturnValue(true),
				}
				mockCline.say = vi.fn().mockResolvedValue(undefined)
				mockCline.ask = vi.fn().mockResolvedValue({ response: "yesButtonClicked" })
				mockCline.presentAssistantMessage = vi.fn()
				mockCline.handleError = vi.fn().mockResolvedValue(undefined)
				mockCline.pushToolResult = vi.fn()
				mockCline.removeClosingTag = vi.fn((tag, content) => content)
				mockCline.fileContextTracker = {
					trackFileContext: vi.fn().mockResolvedValue(undefined),
				}
				mockCline.recordToolUsage = vi.fn().mockReturnValue(undefined)
				mockCline.recordToolError = vi.fn().mockReturnValue(undefined)
				setImageSupport(mockCline, true)

				// Setup - first call with images that use memory
				const firstBatch = [{ path: "test/first.png", sizeKB: 10240 }] // 10MB

				fsPromises.stat = vi.fn().mockResolvedValue({ size: 10240 * 1024 })
				mockedPathResolve.mockImplementation((cwd, relPath) => `/${relPath}`)

				// Execute first batch
				await executeReadMultipleImagesTool(firstBatch.map((img) => img.path))

				// Setup second batch (don't clear all mocks)
				mockedIsBinaryFile.mockResolvedValue(true)
				mockedCountFileLines.mockResolvedValue(0)
				fsPromises.readFile.mockResolvedValue(
					Buffer.from(
						"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
						"base64",
					),
				)
				mockProvider.getState.mockResolvedValue({
					maxReadFileLine: -1,
					maxImageFileSize: 20,
					maxTotalImageSize: 20,
				})

				// Reset path resolving for second batch
				mockedPathResolve.mockClear()

				// Re-setup mockCline properties for second batch (complete setup)
				mockCline.cwd = "/"
				mockCline.task = "Test"
				mockCline.providerRef = mockProvider
				mockCline.rooIgnoreController = {
					validateAccess: vi.fn().mockReturnValue(true),
				}
				mockCline.say = vi.fn().mockResolvedValue(undefined)
				mockCline.ask = vi.fn().mockResolvedValue({ response: "yesButtonClicked" })
				mockCline.presentAssistantMessage = vi.fn()
				mockCline.handleError = vi.fn().mockResolvedValue(undefined)
				mockCline.pushToolResult = vi.fn()
				mockCline.removeClosingTag = vi.fn((tag, content) => content)
				mockCline.fileContextTracker = {
					trackFileContext: vi.fn().mockResolvedValue(undefined),
				}
				mockCline.recordToolUsage = vi.fn().mockReturnValue(undefined)
				mockCline.recordToolError = vi.fn().mockReturnValue(undefined)
				setImageSupport(mockCline, true)

				const secondBatch = [{ path: "test/second.png", sizeKB: 15360 }] // 15MB

				// Clear and reset file system mocks for second batch
				fsPromises.stat.mockClear()
				fsPromises.readFile.mockClear()
				mockedIsBinaryFile.mockClear()
				mockedCountFileLines.mockClear()

				// Reset mocks for second batch
				fsPromises.stat = vi.fn().mockResolvedValue({ size: 15360 * 1024 })
				fsPromises.readFile.mockResolvedValue(
					Buffer.from(
						"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
						"base64",
					),
				)
				mockedIsBinaryFile.mockResolvedValue(true)
				mockedCountFileLines.mockResolvedValue(0)
				mockedPathResolve.mockImplementation((cwd, relPath) => `/${relPath}`)

				// Execute second batch
				const result = await executeReadMultipleImagesTool(secondBatch.map((img) => img.path))

				// Verify second batch is processed successfully (memory tracking was reset)
				expect(Array.isArray(result)).toBe(true)
				const parts = result as any[]
				const imageParts = parts.filter((p) => p.type === "image")

				expect(imageParts).toHaveLength(1) // Second image should be processed
			})

			it("should handle a folder with many images just under the individual size limit", async () => {
				// Setup - Create many images that are each just under the 5MB individual limit
				// but together approach the 20MB total limit
				const manyImages = [
					{ path: "test/img1.png", sizeKB: 4900 }, // 4.78MB
					{ path: "test/img2.png", sizeKB: 4900 }, // 4.78MB
					{ path: "test/img3.png", sizeKB: 4900 }, // 4.78MB
					{ path: "test/img4.png", sizeKB: 4900 }, // 4.78MB
					{ path: "test/img5.png", sizeKB: 4900 }, // 4.78MB - This should be skipped (total would be ~23.9MB)
				]

				// Setup mocks
				mockedIsBinaryFile.mockResolvedValue(true)
				mockedCountFileLines.mockResolvedValue(0)
				fsPromises.readFile.mockResolvedValue(imageBuffer)

				// Setup provider with 5MB individual limit and 20MB total limit
				mockProvider.getState.mockResolvedValue({
					maxReadFileLine: -1,
					maxImageFileSize: 5,
					maxTotalImageSize: 20,
				})

				// Mock file stats for each image
				fsPromises.stat = vi.fn().mockImplementation((filePath) => {
					const normalizedFilePath = path.normalize(filePath.toString())
					const image = manyImages.find((img) => normalizedFilePath.includes(path.normalize(img.path)))
					return Promise.resolve({ size: (image?.sizeKB || 1024) * 1024 })
				})

				// Mock path.resolve
				mockedPathResolve.mockImplementation((cwd, relPath) => `/${relPath}`)

				// Execute
				const result = await executeReadMultipleImagesTool(manyImages.map((img) => img.path))

				// Verify
				expect(Array.isArray(result)).toBe(true)
				const parts = result as any[]
				const textPart = parts.find((p) => p.type === "text")?.text
				const imageParts = parts.filter((p) => p.type === "image")

				// Should process first 4 images (total ~19.12MB, under 20MB limit)
				expect(imageParts).toHaveLength(4)

				// Should show memory limit notice for the 5th image
				expect(textPart).toContain("Image skipped to avoid size limit (20MB)")
				expect(textPart).toContain("test/img5.png")

				// Verify memory tracking worked correctly
				// The notice should show current memory usage around 20MB (4 * 4900KB ≈ 19.14MB, displayed as 20.1MB)
				expect(textPart).toMatch(/Current: \d+(\.\d+)? MB/)
			})

			it("should reset memory tracking between separate tool invocations more explicitly", async () => {
				// This test verifies that totalImageMemoryUsed is reset between calls
				// by making two separate tool invocations and ensuring the second one
				// starts with fresh memory tracking

				// Setup mocks
				mockedIsBinaryFile.mockResolvedValue(true)
				mockedCountFileLines.mockResolvedValue(0)
				fsPromises.readFile.mockResolvedValue(imageBuffer)

				// Setup provider
				mockProvider.getState.mockResolvedValue({
					maxReadFileLine: -1,
					maxImageFileSize: 20,
					maxTotalImageSize: 20,
				})

				// First invocation - use 15MB of memory
				const firstBatch = [{ path: "test/large1.png", sizeKB: 15360 }] // 15MB

				fsPromises.stat = vi.fn().mockResolvedValue({ size: 15360 * 1024 })
				mockedPathResolve.mockImplementation((cwd, relPath) => `/${relPath}`)

				// Execute first batch
				const result1 = await executeReadMultipleImagesTool(firstBatch.map((img) => img.path))

				// Verify first batch processed successfully
				expect(Array.isArray(result1)).toBe(true)
				const parts1 = result1 as any[]
				const imageParts1 = parts1.filter((p) => p.type === "image")
				expect(imageParts1).toHaveLength(1)

				// Second invocation - should start with 0 memory used, not 15MB
				// If memory tracking wasn't reset, this 18MB image would be rejected
				const secondBatch = [{ path: "test/large2.png", sizeKB: 18432 }] // 18MB

				// Reset mocks for second invocation
				fsPromises.stat.mockClear()
				fsPromises.readFile.mockClear()
				mockedPathResolve.mockClear()

				fsPromises.stat = vi.fn().mockResolvedValue({ size: 18432 * 1024 })
				fsPromises.readFile.mockResolvedValue(imageBuffer)
				mockedPathResolve.mockImplementation((cwd, relPath) => `/${relPath}`)

				// Execute second batch
				const result2 = await executeReadMultipleImagesTool(secondBatch.map((img) => img.path))

				// Verify second batch processed successfully
				expect(Array.isArray(result2)).toBe(true)
				const parts2 = result2 as any[]
				const imageParts2 = parts2.filter((p) => p.type === "image")
				const textPart2 = parts2.find((p) => p.type === "text")?.text

				// The 18MB image should be processed successfully because memory was reset
				expect(imageParts2).toHaveLength(1)

				// Should NOT contain any memory limit notices
				expect(textPart2).not.toContain("Image skipped to avoid memory limit")

				// This proves memory tracking was reset between invocations
			})
		})
	})

	describe("Error Handling Tests", () => {
		it("should include error tag for invalid path", async () => {
			// Setup - missing path parameter
			const toolUse: ReadFileToolUse = {
				type: "tool_use",
				name: "read_file",
				params: {},
				partial: false,
			}

			// Execute the tool
			await readFileTool(
				mockCline,
				toolUse,
				mockCline.ask,
				vi.fn(),
				(result: ToolResponse) => {
					toolResult = result
				},
				(param: ToolParamName, content?: string) => content ?? "",
			)

			// Verify
			expect(toolResult).toBe(`<files><error>Missing required parameter</error></files>`)
		})

		it("should include error tag for RooIgnore error", async () => {
			// Execute - skip addLineNumbers check as it returns early with an error
			const result = await executeReadFileTool({}, { validateAccess: false })

			// Verify
			expect(result).toBe(
				`<files>\n<file><path>${testFilePath}</path><error>Access to ${testFilePath} is blocked by the .rooignore file settings. You must try to continue in the task without using this file, or ask the user to update the .rooignore file.</error></file>\n</files>`,
			)
		})
	})
})

describe("read_file tool with image support", () => {
	const testImagePath = "test/image.png"
	const absoluteImagePath = "/test/image.png"
	const base64ImageData =
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
	const imageBuffer = Buffer.from(base64ImageData, "base64")

	const mockedCountFileLines = vi.mocked(countFileLines)
	const mockedIsBinaryFile = vi.mocked(isBinaryFile)
	const mockedPathResolve = vi.mocked(path.resolve)
	const mockedFsReadFile = vi.mocked(fsPromises.readFile)
	const mockedExtractTextFromFile = vi.mocked(extractTextFromFile)

	let localMockCline: any
	let localMockProvider: any
	let toolResult: ToolResponse | undefined

	beforeEach(() => {
		// Clear specific mocks (not all mocks to preserve shared state)
		mockedPathResolve.mockClear()
		mockedIsBinaryFile.mockClear()
		mockedCountFileLines.mockClear()
		mockedFsReadFile.mockClear()
		mockedExtractTextFromFile.mockClear()
		toolResultMock.mockClear()

		// CRITICAL: Reset fsPromises.stat to prevent cross-test contamination
		fsPromises.stat.mockClear()
		fsPromises.stat.mockResolvedValue({ size: 1024 })

		// Use shared mock setup function with local variables
		const mocks = createMockCline()
		localMockCline = mocks.mockCline
		localMockProvider = mocks.mockProvider

		// CRITICAL: Explicitly ensure image support is enabled for all tests in this suite
		setImageSupport(localMockCline, true)

		mockedPathResolve.mockReturnValue(absoluteImagePath)
		mockedIsBinaryFile.mockResolvedValue(true)
		mockedCountFileLines.mockResolvedValue(0)
		mockedFsReadFile.mockResolvedValue(imageBuffer)

		// Setup mock provider with default maxReadFileLine
		localMockProvider.getState.mockResolvedValue({ maxReadFileLine: -1 })

		toolResult = undefined
	})

	async function executeReadImageTool(imagePath: string = testImagePath): Promise<ToolResponse | undefined> {
		const argsContent = `<file><path>${imagePath}</path></file>`
		const toolUse: ReadFileToolUse = {
			type: "tool_use",
			name: "read_file",
			params: { args: argsContent },
			partial: false,
		}

		// Debug: Check if mock is working
		console.log("Mock API:", localMockCline.api)
		console.log("Supports images:", localMockCline.api?.getModel?.()?.info?.supportsImages)

		await readFileTool(
			localMockCline,
			toolUse,
			localMockCline.ask,
			vi.fn(),
			(result: ToolResponse) => {
				toolResult = result
			},
			(_: ToolParamName, content?: string) => content ?? "",
		)

		console.log("Result type:", Array.isArray(toolResult) ? "array" : typeof toolResult)
		console.log("Result:", toolResult)

		return toolResult
	}

	describe("Image Format Detection", () => {
		it.each([
			[".png", "image.png", "image/png"],
			[".jpg", "photo.jpg", "image/jpeg"],
			[".jpeg", "picture.jpeg", "image/jpeg"],
			[".gif", "animation.gif", "image/gif"],
			[".bmp", "bitmap.bmp", "image/bmp"],
			[".svg", "vector.svg", "image/svg+xml"],
			[".webp", "modern.webp", "image/webp"],
			[".ico", "favicon.ico", "image/x-icon"],
			[".avif", "new-format.avif", "image/avif"],
		])("should detect %s as an image format", async (ext, filename, expectedMimeType) => {
			// Setup
			const imagePath = `test/${filename}`
			const absolutePath = `/test/${filename}`
			mockedPathResolve.mockReturnValue(absolutePath)

			// Ensure API mock supports images
			setImageSupport(localMockCline, true)

			// Execute
			const result = await executeReadImageTool(imagePath)

			// Verify result is a multi-part response
			expect(Array.isArray(result)).toBe(true)
			const textPart = (result as any[]).find((p) => p.type === "text")?.text
			const imagePart = (result as any[]).find((p) => p.type === "image")

			// Verify text part
			expect(textPart).toContain(`<file><path>${imagePath}</path>`)
			expect(textPart).not.toContain("<image_data>")
			expect(textPart).toContain(`<notice>Image file`)

			// Verify image part
			expect(imagePart).toBeDefined()
			expect(imagePart.source.media_type).toBe(expectedMimeType)
			expect(imagePart.source.data).toBe(base64ImageData)
		})
	})

	describe("Image Reading Functionality", () => {
		it("should read image file and return a multi-part response", async () => {
			// Execute
			const result = await executeReadImageTool()

			// Verify result is a multi-part response
			expect(Array.isArray(result)).toBe(true)
			const textPart = (result as any[]).find((p) => p.type === "text")?.text
			const imagePart = (result as any[]).find((p) => p.type === "image")

			// Verify text part
			expect(textPart).toContain(`<file><path>${testImagePath}</path>`)
			expect(textPart).not.toContain(`<image_data>`)
			expect(textPart).toContain(`<notice>Image file`)

			// Verify image part
			expect(imagePart).toBeDefined()
			expect(imagePart.source.media_type).toBe("image/png")
			expect(imagePart.source.data).toBe(base64ImageData)
		})

		it("should call formatResponse.toolResult with text and image data", async () => {
			// Execute
			await executeReadImageTool()

			// Verify toolResultMock was called correctly
			expect(toolResultMock).toHaveBeenCalledTimes(1)
			const callArgs = toolResultMock.mock.calls[0]
			const textArg = callArgs[0]
			const imagesArg = callArgs[1]

			expect(textArg).toContain(`<file><path>${testImagePath}</path>`)
			expect(imagesArg).toBeDefined()
			expect(imagesArg).toBeInstanceOf(Array)
			expect(imagesArg!.length).toBe(1)
			expect(imagesArg![0]).toBe(`data:image/png;base64,${base64ImageData}`)
		})

		it("should handle large image files", async () => {
			// Setup - simulate a large image
			const largeBase64 = "A".repeat(1000000) // 1MB of base64 data
			const largeBuffer = Buffer.from(largeBase64, "base64")
			mockedFsReadFile.mockResolvedValue(largeBuffer)

			// Execute
			const result = await executeReadImageTool()

			// Verify it still works with large data
			expect(Array.isArray(result)).toBe(true)
			const imagePart = (result as any[]).find((p) => p.type === "image")
			expect(imagePart).toBeDefined()
			expect(imagePart.source.media_type).toBe("image/png")
			expect(imagePart.source.data).toBe(largeBase64)
		})

		it("should exclude images when model does not support images", async () => {
			// Setup - mock API handler that doesn't support images
			setImageSupport(localMockCline, false)

			// Execute
			const result = await executeReadImageTool()

			// When images are not supported, the tool should return just XML (not call formatResponse.toolResult)
			expect(toolResultMock).not.toHaveBeenCalled()
			expect(typeof result).toBe("string")
			expect(result).toContain(`<file><path>${testImagePath}</path>`)
			expect(result).toContain(`<notice>Image file`)
		})

		it("should include images when model supports images", async () => {
			// Setup - mock API handler that supports images
			setImageSupport(localMockCline, true)

			// Execute
			const result = await executeReadImageTool()

			// Verify toolResultMock was called with images
			expect(toolResultMock).toHaveBeenCalledTimes(1)
			const callArgs = toolResultMock.mock.calls[0]
			const textArg = callArgs[0]
			const imagesArg = callArgs[1]

			expect(textArg).toContain(`<file><path>${testImagePath}</path>`)
			expect(imagesArg).toBeDefined() // Images should be included
			expect(imagesArg).toBeInstanceOf(Array)
			expect(imagesArg!.length).toBe(1)
			expect(imagesArg![0]).toBe(`data:image/png;base64,${base64ImageData}`)
		})

		it("should handle undefined supportsImages gracefully", async () => {
			// Setup - mock API handler with undefined supportsImages
			setImageSupport(localMockCline, undefined)

			// Execute
			const result = await executeReadImageTool()

			// When supportsImages is undefined, should default to false and return just XML
			expect(toolResultMock).not.toHaveBeenCalled()
			expect(typeof result).toBe("string")
			expect(result).toContain(`<file><path>${testImagePath}</path>`)
			expect(result).toContain(`<notice>Image file`)
		})

		it("should handle errors when reading image files", async () => {
			// Setup - simulate read error
			mockedFsReadFile.mockRejectedValue(new Error("Failed to read image"))

			// Create a spy for handleError
			const handleErrorSpy = vi.fn()

			// Execute with the spy
			const argsContent = `<file><path>${testImagePath}</path></file>`
			const toolUse: ReadFileToolUse = {
				type: "tool_use",
				name: "read_file",
				params: { args: argsContent },
				partial: false,
			}

			await readFileTool(
				localMockCline,
				toolUse,
				localMockCline.ask,
				handleErrorSpy, // Use our spy here
				(result: ToolResponse) => {
					toolResult = result
				},
				(_: ToolParamName, content?: string) => content ?? "",
			)

			// Verify error handling
			expect(toolResult).toContain("<error>Error reading image file: Failed to read image</error>")
			expect(handleErrorSpy).toHaveBeenCalled()
		})
	})

	describe("Binary File Handling", () => {
		it("should not treat non-image binary files as images", async () => {
			// Setup
			const binaryPath = "test/document.pdf"
			const absolutePath = "/test/document.pdf"
			mockedPathResolve.mockReturnValue(absolutePath)
			mockedExtractTextFromFile.mockResolvedValue("PDF content extracted")

			// Execute
			const result = await executeReadImageTool(binaryPath)

			// Verify it uses extractTextFromFile instead
			expect(result).not.toContain("<image_data>")
			// Make the test platform-agnostic by checking the call was made (path normalization can vary)
			expect(mockedExtractTextFromFile).toHaveBeenCalledTimes(1)
			const callArgs = mockedExtractTextFromFile.mock.calls[0]
			expect(callArgs[0]).toMatch(/[\\\/]test[\\\/]document\.pdf$/)
		})

		it("should handle unknown binary formats", async () => {
			// Setup
			const binaryPath = "test/unknown.bin"
			const absolutePath = "/test/unknown.bin"
			mockedPathResolve.mockReturnValue(absolutePath)
			mockedExtractTextFromFile.mockResolvedValue("")

			// Execute
			const result = await executeReadImageTool(binaryPath)

			// Verify
			expect(result).not.toContain("<image_data>")
			expect(result).toContain('<binary_file format="bin"')
		})
	})

	describe("Edge Cases", () => {
		it("should handle case-insensitive image extensions", async () => {
			// Test uppercase extensions
			const uppercasePath = "test/IMAGE.PNG"
			const absolutePath = "/test/IMAGE.PNG"
			mockedPathResolve.mockReturnValue(absolutePath)

			// Execute
			const result = await executeReadImageTool(uppercasePath)

			// Verify
			expect(Array.isArray(result)).toBe(true)
			const imagePart = (result as any[]).find((p) => p.type === "image")
			expect(imagePart).toBeDefined()
			expect(imagePart.source.media_type).toBe("image/png")
		})

		it("should handle files with multiple dots in name", async () => {
			// Setup
			const complexPath = "test/my.photo.backup.png"
			const absolutePath = "/test/my.photo.backup.png"
			mockedPathResolve.mockReturnValue(absolutePath)

			// Execute
			const result = await executeReadImageTool(complexPath)

			// Verify
			expect(Array.isArray(result)).toBe(true)
			const imagePart = (result as any[]).find((p) => p.type === "image")
			expect(imagePart).toBeDefined()
			expect(imagePart.source.media_type).toBe("image/png")
		})

		it("should handle empty image files", async () => {
			// Setup - empty buffer
			mockedFsReadFile.mockResolvedValue(Buffer.from(""))

			// Execute
			const result = await executeReadImageTool()

			// Verify - should still create valid data URL
			expect(Array.isArray(result)).toBe(true)
			const imagePart = (result as any[]).find((p) => p.type === "image")
			expect(imagePart).toBeDefined()
			expect(imagePart.source.media_type).toBe("image/png")
			expect(imagePart.source.data).toBe("")
		})
	})
})
