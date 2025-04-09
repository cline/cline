import * as path from "path"
import { countFileLines } from "../../integrations/misc/line-counter"
import { readLines } from "../../integrations/misc/read-lines"
import { extractTextFromFile, addLineNumbers } from "../../integrations/misc/extract-text"
import { parseSourceCodeDefinitionsForFile } from "../../services/tree-sitter"
import { isBinaryFile } from "isbinaryfile"
import { ReadFileToolUse } from "../assistant-message"
import { Cline } from "../Cline"

// Mock dependencies
jest.mock("../../integrations/misc/line-counter")
jest.mock("../../integrations/misc/read-lines")
jest.mock("../../integrations/misc/extract-text", () => {
	const actual = jest.requireActual("../../integrations/misc/extract-text")
	// Create a spy on the actual addLineNumbers function
	const addLineNumbersSpy = jest.spyOn(actual, "addLineNumbers")

	return {
		...actual,
		// Expose the spy so tests can access it
		__addLineNumbersSpy: addLineNumbersSpy,
		extractTextFromFile: jest.fn().mockImplementation((filePath) => {
			// Use the actual addLineNumbers function
			const content = mockInputContent
			return Promise.resolve(actual.addLineNumbers(content))
		}),
	}
})

// Get a reference to the spy
const addLineNumbersSpy = jest.requireMock("../../integrations/misc/extract-text").__addLineNumbersSpy

// Variable to control what content is used by the mock
let mockInputContent = ""
jest.mock("../../services/tree-sitter")
jest.mock("isbinaryfile")
jest.mock("../ignore/RooIgnoreController", () => ({
	RooIgnoreController: class {
		initialize() {
			return Promise.resolve()
		}
		validateAccess() {
			return true
		}
	},
}))
jest.mock("fs/promises", () => ({
	mkdir: jest.fn().mockResolvedValue(undefined),
	writeFile: jest.fn().mockResolvedValue(undefined),
	readFile: jest.fn().mockResolvedValue("{}"),
}))
jest.mock("../../utils/fs", () => ({
	fileExistsAtPath: jest.fn().mockReturnValue(true),
}))

// Mock path
jest.mock("path", () => {
	const originalPath = jest.requireActual("path")
	return {
		...originalPath,
		resolve: jest.fn().mockImplementation((...args) => args.join("/")),
	}
})

describe("read_file tool XML output structure", () => {
	// Test data
	const testFilePath = "test/file.txt"
	const absoluteFilePath = "/test/file.txt"
	const fileContent = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5"
	const numberedFileContent = "1 | Line 1\n2 | Line 2\n3 | Line 3\n4 | Line 4\n5 | Line 5\n"
	const sourceCodeDef = "\n\n# file.txt\n1--5 | Content"

	// Mocked functions with correct types
	const mockedCountFileLines = countFileLines as jest.MockedFunction<typeof countFileLines>
	const mockedReadLines = readLines as jest.MockedFunction<typeof readLines>
	const mockedExtractTextFromFile = extractTextFromFile as jest.MockedFunction<typeof extractTextFromFile>
	const mockedParseSourceCodeDefinitionsForFile = parseSourceCodeDefinitionsForFile as jest.MockedFunction<
		typeof parseSourceCodeDefinitionsForFile
	>
	const mockedIsBinaryFile = isBinaryFile as jest.MockedFunction<typeof isBinaryFile>
	const mockedPathResolve = path.resolve as jest.MockedFunction<typeof path.resolve>

	// Mock instances
	const mockCline: any = {}
	let mockProvider: any
	let toolResult: string | undefined

	beforeEach(() => {
		jest.clearAllMocks()

		// Setup path resolution
		mockedPathResolve.mockReturnValue(absoluteFilePath)

		// Setup mocks for file operations
		mockedIsBinaryFile.mockResolvedValue(false)

		// Set the default content for the mock
		mockInputContent = fileContent

		// Setup mock provider
		mockProvider = {
			getState: jest.fn().mockResolvedValue({ maxReadFileLine: 500 }),
			deref: jest.fn().mockReturnThis(),
		}

		// Setup Cline instance with mock methods
		mockCline.cwd = "/"
		mockCline.task = "Test"
		mockCline.providerRef = mockProvider
		mockCline.rooIgnoreController = {
			validateAccess: jest.fn().mockReturnValue(true),
		}
		mockCline.say = jest.fn().mockResolvedValue(undefined)
		mockCline.ask = jest.fn().mockResolvedValue(true)
		mockCline.presentAssistantMessage = jest.fn()
		mockCline.sayAndCreateMissingParamError = jest.fn().mockResolvedValue("Missing required parameter")

		// Reset tool result
		toolResult = undefined
	})

	/**
	 * Helper function to execute the read file tool with custom parameters
	 */
	async function executeReadFileTool(
		params: Partial<ReadFileToolUse["params"]> = {},
		options: {
			totalLines?: number
			maxReadFileLine?: number
			isBinary?: boolean
			validateAccess?: boolean
			skipAddLineNumbersCheck?: boolean // Flag to skip addLineNumbers check
		} = {},
	): Promise<string | undefined> {
		// Configure mocks based on test scenario
		const totalLines = options.totalLines ?? 5
		const maxReadFileLine = options.maxReadFileLine ?? 500
		const isBinary = options.isBinary ?? false
		const validateAccess = options.validateAccess ?? true

		mockProvider.getState.mockResolvedValue({ maxReadFileLine })
		mockedCountFileLines.mockResolvedValue(totalLines)
		mockedIsBinaryFile.mockResolvedValue(isBinary)
		mockCline.rooIgnoreController.validateAccess = jest.fn().mockReturnValue(validateAccess)

		// Create a tool use object
		const toolUse: ReadFileToolUse = {
			type: "tool_use",
			name: "read_file",
			params: {
				path: testFilePath,
				...params,
			},
			partial: false,
		}

		// Import the tool implementation dynamically to avoid hoisting issues
		const { readFileTool } = require("../tools/readFileTool")

		// Reset the spy's call history before each test
		addLineNumbersSpy.mockClear()

		// Execute the tool
		await readFileTool(
			mockCline,
			toolUse,
			mockCline.ask,
			jest.fn(),
			(result: string) => {
				toolResult = result
			},
			(param: string, value: string) => value,
		)
		// Verify addLineNumbers was called (unless explicitly skipped)
		if (!options.skipAddLineNumbersCheck) {
			expect(addLineNumbersSpy).toHaveBeenCalled()
		} else {
			// For cases where we expect addLineNumbers NOT to be called
			expect(addLineNumbersSpy).not.toHaveBeenCalled()
		}

		return toolResult
	}

	describe("Basic XML Structure Tests", () => {
		it("should produce XML output with no unnecessary indentation", async () => {
			// Setup - use default mockInputContent (fileContent)
			mockInputContent = fileContent

			// Execute
			const result = await executeReadFileTool()

			// Verify
			expect(result).toBe(
				`<file><path>${testFilePath}</path>\n<content lines="1-5">\n${numberedFileContent}</content>\n</file>`,
			)
		})

		it("should follow the correct XML structure format", async () => {
			// Setup - use default mockInputContent (fileContent)
			mockInputContent = fileContent

			// Execute
			const result = await executeReadFileTool()

			// Verify using regex to check structure
			const xmlStructureRegex = new RegExp(
				`^<file><path>${testFilePath}</path>\\n<content lines="1-5">\\n.*</content>\\n</file>$`,
				"s",
			)
			expect(result).toMatch(xmlStructureRegex)
		})
	})

	describe("Line Range Tests", () => {
		it("should include lines attribute when start_line is specified", async () => {
			// Setup
			const startLine = 2
			mockedReadLines.mockResolvedValue(
				fileContent
					.split("\n")
					.slice(startLine - 1)
					.join("\n"),
			)

			// Execute
			const result = await executeReadFileTool({ start_line: startLine.toString() })

			// Verify
			expect(result).toContain(`<content lines="${startLine}-5">`)
		})

		it("should include lines attribute when end_line is specified", async () => {
			// Setup
			const endLine = 3
			mockedReadLines.mockResolvedValue(fileContent.split("\n").slice(0, endLine).join("\n"))

			// Execute
			const result = await executeReadFileTool({ end_line: endLine.toString() })

			// Verify
			expect(result).toContain(`<content lines="1-${endLine}">`)
		})

		it("should include lines attribute when both start_line and end_line are specified", async () => {
			// Setup
			const startLine = 2
			const endLine = 4
			mockedReadLines.mockResolvedValue(
				fileContent
					.split("\n")
					.slice(startLine - 1, endLine)
					.join("\n"),
			)

			// Execute
			const result = await executeReadFileTool({
				start_line: startLine.toString(),
				end_line: endLine.toString(),
			})

			// Verify
			expect(result).toContain(`<content lines="${startLine}-${endLine}">`)
		})

		it("should include lines attribute even when no range is specified", async () => {
			// Setup - use default mockInputContent (fileContent)
			mockInputContent = fileContent

			// Execute
			const result = await executeReadFileTool()

			// Verify
			expect(result).toContain(`<content lines="1-5">\n`)
		})

		it("should include content when maxReadFileLine=0 and range is specified", async () => {
			// Setup
			const maxReadFileLine = 0
			const startLine = 2
			const endLine = 4
			const totalLines = 10

			mockedReadLines.mockResolvedValue(
				fileContent
					.split("\n")
					.slice(startLine - 1, endLine)
					.join("\n"),
			)

			// Execute
			const result = await executeReadFileTool(
				{
					start_line: startLine.toString(),
					end_line: endLine.toString(),
				},
				{ maxReadFileLine, totalLines },
			)

			// Verify
			// Should include content tag with line range
			expect(result).toContain(`<content lines="${startLine}-${endLine}">`)

			// Should NOT include definitions (range reads never show definitions)
			expect(result).not.toContain("<list_code_definition_names>")

			// Should NOT include truncation notice
			expect(result).not.toContain(`<notice>Showing only ${maxReadFileLine} of ${totalLines} total lines`)
		})

		it("should include content when maxReadFileLine=0 and only start_line is specified", async () => {
			// Setup
			const maxReadFileLine = 0
			const startLine = 3
			const totalLines = 10

			mockedReadLines.mockResolvedValue(
				fileContent
					.split("\n")
					.slice(startLine - 1)
					.join("\n"),
			)

			// Execute
			const result = await executeReadFileTool(
				{
					start_line: startLine.toString(),
				},
				{ maxReadFileLine, totalLines },
			)

			// Verify
			// Should include content tag with line range
			expect(result).toContain(`<content lines="${startLine}-${totalLines}">`)

			// Should NOT include definitions (range reads never show definitions)
			expect(result).not.toContain("<list_code_definition_names>")

			// Should NOT include truncation notice
			expect(result).not.toContain(`<notice>Showing only ${maxReadFileLine} of ${totalLines} total lines`)
		})

		it("should include content when maxReadFileLine=0 and only end_line is specified", async () => {
			// Setup
			const maxReadFileLine = 0
			const endLine = 3
			const totalLines = 10

			mockedReadLines.mockResolvedValue(fileContent.split("\n").slice(0, endLine).join("\n"))

			// Execute
			const result = await executeReadFileTool(
				{
					end_line: endLine.toString(),
				},
				{ maxReadFileLine, totalLines },
			)

			// Verify
			// Should include content tag with line range
			expect(result).toContain(`<content lines="1-${endLine}">`)

			// Should NOT include definitions (range reads never show definitions)
			expect(result).not.toContain("<list_code_definition_names>")

			// Should NOT include truncation notice
			expect(result).not.toContain(`<notice>Showing only ${maxReadFileLine} of ${totalLines} total lines`)
		})

		it("should include full range content when maxReadFileLine=5 and content has more than 5 lines", async () => {
			// Setup
			const maxReadFileLine = 5
			const startLine = 2
			const endLine = 8
			const totalLines = 10

			// Create mock content with 7 lines (more than maxReadFileLine)
			const rangeContent = Array(endLine - startLine + 1)
				.fill("Range line content")
				.join("\n")

			mockedReadLines.mockResolvedValue(rangeContent)

			// Execute
			const result = await executeReadFileTool(
				{
					start_line: startLine.toString(),
					end_line: endLine.toString(),
				},
				{ maxReadFileLine, totalLines },
			)

			// Verify
			// Should include content tag with the full requested range (not limited by maxReadFileLine)
			expect(result).toContain(`<content lines="${startLine}-${endLine}">`)

			// Should NOT include definitions (range reads never show definitions)
			expect(result).not.toContain("<list_code_definition_names>")

			// Should NOT include truncation notice
			expect(result).not.toContain(`<notice>Showing only ${maxReadFileLine} of ${totalLines} total lines`)

			// Should contain all the requested lines, not just maxReadFileLine lines
			expect(result).toBeDefined()
			if (result) {
				expect(result.split("\n").length).toBeGreaterThan(maxReadFileLine)
			}
		})
	})

	describe("Notice and Definition Tags Tests", () => {
		it("should include notice tag for truncated files", async () => {
			// Setup
			const maxReadFileLine = 3
			const totalLines = 10
			mockedReadLines.mockResolvedValue(fileContent.split("\n").slice(0, maxReadFileLine).join("\n"))

			// Execute
			const result = await executeReadFileTool({}, { maxReadFileLine, totalLines })

			// Verify
			expect(result).toContain(`<notice>Showing only ${maxReadFileLine} of ${totalLines} total lines`)
		})

		it("should include list_code_definition_names tag when source code definitions are available", async () => {
			// Setup
			const maxReadFileLine = 3
			const totalLines = 10
			mockedReadLines.mockResolvedValue(fileContent.split("\n").slice(0, maxReadFileLine).join("\n"))
			mockedParseSourceCodeDefinitionsForFile.mockResolvedValue(sourceCodeDef)

			// Execute
			const result = await executeReadFileTool({}, { maxReadFileLine, totalLines })

			// Verify
			// Use regex to match the tag content regardless of whitespace
			expect(result).toMatch(
				new RegExp(
					`<list_code_definition_names>[\\s\\S]*${sourceCodeDef.trim()}[\\s\\S]*</list_code_definition_names>`,
				),
			)
		})

		it("should only have definitions, no content when maxReadFileLine=0", async () => {
			// Setup
			const maxReadFileLine = 0
			const totalLines = 10
			// Mock content with exactly 10 lines to match totalLines
			const rawContent = Array(10).fill("Line content").join("\n")
			mockInputContent = rawContent
			mockedParseSourceCodeDefinitionsForFile.mockResolvedValue(sourceCodeDef)

			// Execute - skip addLineNumbers check as it's not called for maxReadFileLine=0
			const result = await executeReadFileTool({}, { maxReadFileLine, totalLines, skipAddLineNumbersCheck: true })

			// Verify
			expect(result).toContain(`<notice>Showing only 0 of ${totalLines} total lines`)
			// Use regex to match the tag content regardless of whitespace
			expect(result).toMatch(
				new RegExp(
					`<list_code_definition_names>[\\s\\S]*${sourceCodeDef.trim()}[\\s\\S]*</list_code_definition_names>`,
				),
			)
			expect(result).not.toContain(`<content`)
		})

		it("should handle maxReadFileLine=0 with no source code definitions", async () => {
			// Setup
			const maxReadFileLine = 0
			const totalLines = 10
			// Mock that no source code definitions are available
			mockedParseSourceCodeDefinitionsForFile.mockResolvedValue("")
			// Mock content with exactly 10 lines to match totalLines
			const rawContent = Array(10).fill("Line content").join("\n")
			mockInputContent = rawContent

			// Execute - skip addLineNumbers check as it's not called for maxReadFileLine=0
			const result = await executeReadFileTool({}, { maxReadFileLine, totalLines, skipAddLineNumbersCheck: true })

			// Verify
			// Should include notice
			expect(result).toContain(
				`<file><path>${testFilePath}</path>\n<notice>Showing only 0 of ${totalLines} total lines. Use start_line and end_line if you need to read more</notice>\n</file>`,
			)
			// Should not include list_code_definition_names tag since there are no definitions
			expect(result).not.toContain("<list_code_definition_names>")
			// Should not include content tag for non-empty files with maxReadFileLine=0
			expect(result).not.toContain("<content")
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

			// Import the tool implementation dynamically
			const { readFileTool } = require("../tools/readFileTool")

			// Execute the tool
			await readFileTool(
				mockCline,
				toolUse,
				mockCline.ask,
				jest.fn(),
				(result: string) => {
					toolResult = result
				},
				(param: string, value: string) => value,
			)

			// Verify
			expect(toolResult).toContain(`<file><path></path><error>`)
			expect(toolResult).not.toContain(`<content`)
		})

		it("should include error tag for invalid start_line", async () => {
			// Execute - skip addLineNumbers check as it returns early with an error
			const result = await executeReadFileTool({ start_line: "invalid" }, { skipAddLineNumbersCheck: true })

			// Verify
			expect(result).toContain(`<file><path>${testFilePath}</path><error>Invalid start_line value</error></file>`)
			expect(result).not.toContain(`<content`)
		})

		it("should include error tag for invalid end_line", async () => {
			// Execute - skip addLineNumbers check as it returns early with an error
			const result = await executeReadFileTool({ end_line: "invalid" }, { skipAddLineNumbersCheck: true })

			// Verify
			expect(result).toContain(`<file><path>${testFilePath}</path><error>Invalid end_line value</error></file>`)
			expect(result).not.toContain(`<content`)
		})

		it("should include error tag for RooIgnore error", async () => {
			// Execute - skip addLineNumbers check as it returns early with an error
			const result = await executeReadFileTool({}, { validateAccess: false, skipAddLineNumbersCheck: true })

			// Verify
			expect(result).toContain(`<file><path>${testFilePath}</path><error>`)
			expect(result).not.toContain(`<content`)
		})
	})

	describe("Edge Cases Tests", () => {
		it("should handle empty files correctly with maxReadFileLine=-1", async () => {
			// Setup - use empty string
			mockInputContent = ""
			const maxReadFileLine = -1
			const totalLines = 0
			mockedCountFileLines.mockResolvedValue(totalLines)

			// Execute
			const result = await executeReadFileTool({}, { maxReadFileLine, totalLines })

			// Verify
			// Empty files should include a content tag and notice
			expect(result).toBe(`<file><path>${testFilePath}</path>\n<content/><notice>File is empty</notice>\n</file>`)
			// And make sure there's no error
			expect(result).not.toContain(`<error>`)
		})

		it("should handle empty files correctly with maxReadFileLine=0", async () => {
			// Setup - use empty string
			mockInputContent = ""
			const maxReadFileLine = 0
			const totalLines = 0
			mockedCountFileLines.mockResolvedValue(totalLines)

			// Execute
			const result = await executeReadFileTool({}, { maxReadFileLine, totalLines })

			// Verify
			// Empty files should include a content tag and notice even with maxReadFileLine=0
			expect(result).toBe(`<file><path>${testFilePath}</path>\n<content/><notice>File is empty</notice>\n</file>`)
		})

		it("should handle binary files correctly", async () => {
			// Setup
			// For binary content, we need to override the mock since we don't use addLineNumbers
			mockedExtractTextFromFile.mockResolvedValue("Binary content")

			// Execute - skip addLineNumbers check as we're directly mocking extractTextFromFile
			const result = await executeReadFileTool({}, { isBinary: true, skipAddLineNumbersCheck: true })

			// Verify
			expect(result).toBe(
				`<file><path>${testFilePath}</path>\n<content lines="1-5">\nBinary content</content>\n</file>`,
			)
			expect(mockedExtractTextFromFile).toHaveBeenCalledWith(absoluteFilePath)
		})

		it("should handle file read errors correctly", async () => {
			// Setup
			const errorMessage = "File not found"
			// For error cases, we need to override the mock to simulate a failure
			mockedExtractTextFromFile.mockRejectedValue(new Error(errorMessage))

			// Execute - skip addLineNumbers check as it throws an error
			const result = await executeReadFileTool({}, { skipAddLineNumbersCheck: true })

			// Verify
			expect(result).toContain(
				`<file><path>${testFilePath}</path><error>Error reading file: ${errorMessage}</error></file>`,
			)
			expect(result).not.toContain(`<content`)
		})
	})
})
