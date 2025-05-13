// npx jest src/core/tools/__tests__/readFileTool.test.ts

import * as path from "path"

import { countFileLines } from "../../../integrations/misc/line-counter"
import { readLines } from "../../../integrations/misc/read-lines"
import { extractTextFromFile } from "../../../integrations/misc/extract-text"
import { parseSourceCodeDefinitionsForFile } from "../../../services/tree-sitter"
import { isBinaryFile } from "isbinaryfile"
import { ReadFileToolUse, ToolParamName, ToolResponse } from "../../../shared/tools"
import { readFileTool } from "../readFileTool"

jest.mock("path", () => {
	const originalPath = jest.requireActual("path")
	return {
		...originalPath,
		resolve: jest.fn().mockImplementation((...args) => args.join("/")),
	}
})

jest.mock("fs/promises", () => ({
	mkdir: jest.fn().mockResolvedValue(undefined),
	writeFile: jest.fn().mockResolvedValue(undefined),
	readFile: jest.fn().mockResolvedValue("{}"),
}))

jest.mock("isbinaryfile")

jest.mock("../../../integrations/misc/line-counter")
jest.mock("../../../integrations/misc/read-lines")

let mockInputContent = ""

jest.mock("../../../integrations/misc/extract-text", () => {
	const actual = jest.requireActual("../../../integrations/misc/extract-text")
	// Create a spy on the actual addLineNumbers function.
	const addLineNumbersSpy = jest.spyOn(actual, "addLineNumbers")

	return {
		...actual,
		// Expose the spy so tests can access it.
		__addLineNumbersSpy: addLineNumbersSpy,
		extractTextFromFile: jest.fn().mockImplementation((_filePath) => {
			// Use the actual addLineNumbers function.
			const content = mockInputContent
			return Promise.resolve(actual.addLineNumbers(content))
		}),
	}
})

const addLineNumbersSpy = jest.requireMock("../../../integrations/misc/extract-text").__addLineNumbersSpy

jest.mock("../../../services/tree-sitter")

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

jest.mock("../../../utils/fs", () => ({
	fileExistsAtPath: jest.fn().mockReturnValue(true),
}))

describe("read_file tool with maxReadFileLine setting", () => {
	// Test data
	const testFilePath = "test/file.txt"
	const absoluteFilePath = "/test/file.txt"
	const fileContent = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5"
	const numberedFileContent = "1 | Line 1\n2 | Line 2\n3 | Line 3\n4 | Line 4\n5 | Line 5\n"
	const sourceCodeDef = "\n\n# file.txt\n1--5 | Content"
	const expectedFullFileXml = `<file><path>${testFilePath}</path>\n<content lines="1-5">\n${numberedFileContent}</content>\n</file>`

	// Mocked functions with correct types
	const mockedCountFileLines = countFileLines as jest.MockedFunction<typeof countFileLines>
	const mockedReadLines = readLines as jest.MockedFunction<typeof readLines>
	const mockedExtractTextFromFile = extractTextFromFile as jest.MockedFunction<typeof extractTextFromFile>
	const mockedParseSourceCodeDefinitionsForFile = parseSourceCodeDefinitionsForFile as jest.MockedFunction<
		typeof parseSourceCodeDefinitionsForFile
	>

	const mockedIsBinaryFile = isBinaryFile as jest.MockedFunction<typeof isBinaryFile>
	const mockedPathResolve = path.resolve as jest.MockedFunction<typeof path.resolve>

	const mockCline: any = {}
	let mockProvider: any
	let toolResult: ToolResponse | undefined

	beforeEach(() => {
		jest.clearAllMocks()

		mockedPathResolve.mockReturnValue(absoluteFilePath)
		mockedIsBinaryFile.mockResolvedValue(false)

		mockInputContent = fileContent

		// Setup the extractTextFromFile mock implementation with the current
		// mockInputContent.
		mockedExtractTextFromFile.mockImplementation((_filePath) => {
			const actual = jest.requireActual("../../../integrations/misc/extract-text")
			return Promise.resolve(actual.addLineNumbers(mockInputContent))
		})

		// No need to setup the extractTextFromFile mock implementation here
		// as it's already defined at the module level.

		mockProvider = {
			getState: jest.fn(),
			deref: jest.fn().mockReturnThis(),
		}

		mockCline.cwd = "/"
		mockCline.task = "Test"
		mockCline.providerRef = mockProvider
		mockCline.rooIgnoreController = {
			validateAccess: jest.fn().mockReturnValue(true),
		}
		mockCline.say = jest.fn().mockResolvedValue(undefined)
		mockCline.ask = jest.fn().mockResolvedValue(true)
		mockCline.presentAssistantMessage = jest.fn()

		mockCline.fileContextTracker = {
			trackFileContext: jest.fn().mockResolvedValue(undefined),
		}

		mockCline.recordToolUsage = jest.fn().mockReturnValue(undefined)
		mockCline.recordToolError = jest.fn().mockReturnValue(undefined)

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
		} = {},
	): Promise<ToolResponse | undefined> {
		// Configure mocks based on test scenario
		const maxReadFileLine = options.maxReadFileLine ?? 500
		const totalLines = options.totalLines ?? 5

		mockProvider.getState.mockResolvedValue({ maxReadFileLine })
		mockedCountFileLines.mockResolvedValue(totalLines)

		// Reset the spy before each test
		addLineNumbersSpy.mockClear()

		// Create a tool use object
		const toolUse: ReadFileToolUse = {
			type: "tool_use",
			name: "read_file",
			params: { path: testFilePath, ...params },
			partial: false,
		}

		await readFileTool(
			mockCline,
			toolUse,
			mockCline.ask,
			jest.fn(),
			(result: ToolResponse) => {
				toolResult = result
			},
			(_: ToolParamName, content?: string) => content ?? "",
		)

		// Verify addLineNumbers was called appropriately
		if (!options.skipAddLineNumbersCheck) {
			expect(addLineNumbersSpy).toHaveBeenCalled()
		} else {
			expect(addLineNumbersSpy).not.toHaveBeenCalled()
		}

		return toolResult
	}

	describe("when maxReadFileLine is negative", () => {
		it("should read the entire file using extractTextFromFile", async () => {
			// Setup - use default mockInputContent
			mockInputContent = fileContent

			// Execute
			const result = await executeReadFileTool({}, { maxReadFileLine: -1 })

			// Verify
			expect(mockedExtractTextFromFile).toHaveBeenCalledWith(absoluteFilePath)
			expect(mockedReadLines).not.toHaveBeenCalled()
			expect(mockedParseSourceCodeDefinitionsForFile).not.toHaveBeenCalled()
			expect(result).toBe(expectedFullFileXml)
		})

		it("should ignore range parameters and read entire file when maxReadFileLine is -1", async () => {
			// Setup - use default mockInputContent
			mockInputContent = fileContent

			// Execute with range parameters
			const result = await executeReadFileTool(
				{
					start_line: "2",
					end_line: "4",
				},
				{ maxReadFileLine: -1 },
			)

			// Verify that extractTextFromFile is still used (not readLines)
			expect(mockedExtractTextFromFile).toHaveBeenCalledWith(absoluteFilePath)
			expect(mockedReadLines).not.toHaveBeenCalled()
			expect(mockedParseSourceCodeDefinitionsForFile).not.toHaveBeenCalled()
			expect(result).toBe(expectedFullFileXml)
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
			expect(mockedExtractTextFromFile).not.toHaveBeenCalled()
			expect(mockedReadLines).not.toHaveBeenCalled() // Per implementation line 141
			expect(mockedParseSourceCodeDefinitionsForFile).toHaveBeenCalledWith(
				absoluteFilePath,
				mockCline.rooIgnoreController,
			)

			// Verify XML structure
			expect(result).toContain(`<file><path>${testFilePath}</path>`)
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
			mockedReadLines.mockResolvedValue(content)
			mockedParseSourceCodeDefinitionsForFile.mockResolvedValue(sourceCodeDef)

			// Execute
			const result = await executeReadFileTool({}, { maxReadFileLine: 3 })

			// Verify - check behavior but not specific implementation details
			expect(mockedExtractTextFromFile).not.toHaveBeenCalled()
			expect(mockedReadLines).toHaveBeenCalled()
			expect(mockedParseSourceCodeDefinitionsForFile).toHaveBeenCalledWith(
				absoluteFilePath,
				mockCline.rooIgnoreController,
			)

			// Verify XML structure
			expect(result).toContain(`<file><path>${testFilePath}</path>`)
			expect(result).toContain('<content lines="1-3">')
			expect(result).toContain("1 | Line 1")
			expect(result).toContain("2 | Line 2")
			expect(result).toContain("3 | Line 3")
			expect(result).toContain("</content>")
			expect(result).toContain("<notice>Showing only 3 of 5 total lines")
			expect(result).toContain("</notice>")
			expect(result).toContain("<list_code_definition_names>")
			expect(result).toContain(sourceCodeDef.trim())
			expect(result).toContain("</list_code_definition_names>")
			expect(result).toContain("<list_code_definition_names>")
			expect(result).toContain(sourceCodeDef.trim())
		})
	})

	describe("when maxReadFileLine equals or exceeds file length", () => {
		it("should use extractTextFromFile when maxReadFileLine > totalLines", async () => {
			// Setup
			mockedCountFileLines.mockResolvedValue(5) // File shorter than maxReadFileLine
			mockInputContent = fileContent

			// Execute
			const result = await executeReadFileTool({}, { maxReadFileLine: 10, totalLines: 5 })

			// Verify
			expect(mockedExtractTextFromFile).toHaveBeenCalledWith(absoluteFilePath)
			expect(result).toBe(expectedFullFileXml)
		})

		it("should read with extractTextFromFile when file has few lines", async () => {
			// Setup
			mockedCountFileLines.mockResolvedValue(3) // File shorter than maxReadFileLine
			mockInputContent = fileContent

			// Execute
			const result = await executeReadFileTool({}, { maxReadFileLine: 5, totalLines: 3 })

			// Verify
			expect(mockedExtractTextFromFile).toHaveBeenCalledWith(absoluteFilePath)
			expect(mockedReadLines).not.toHaveBeenCalled()
			// Create a custom expected XML with lines="1-3" since totalLines is 3
			const expectedXml = `<file><path>${testFilePath}</path>\n<content lines="1-3">\n${numberedFileContent}</content>\n</file>`
			expect(result).toBe(expectedXml)
		})
	})

	describe("when file is binary", () => {
		it("should always use extractTextFromFile regardless of maxReadFileLine", async () => {
			// Setup
			mockedIsBinaryFile.mockResolvedValue(true)
			// For binary files, we're using a maxReadFileLine of 3 and totalLines is assumed to be 3
			mockedCountFileLines.mockResolvedValue(3)

			// For binary files, we need a special mock implementation that doesn't use addLineNumbers
			// Save the original mock implementation
			const originalMockImplementation = mockedExtractTextFromFile.getMockImplementation()
			// Create a special mock implementation that doesn't call addLineNumbers
			mockedExtractTextFromFile.mockImplementation(() => {
				return Promise.resolve(numberedFileContent)
			})

			// Reset the spy to clear any previous calls
			addLineNumbersSpy.mockClear()

			// Execute - skip addLineNumbers check as we're directly providing the numbered content
			const result = await executeReadFileTool(
				{},
				{
					maxReadFileLine: 3,
					totalLines: 3,
					skipAddLineNumbersCheck: true,
				},
			)

			// Restore the original mock implementation after the test
			mockedExtractTextFromFile.mockImplementation(originalMockImplementation)

			// Verify
			expect(mockedExtractTextFromFile).toHaveBeenCalledWith(absoluteFilePath)
			expect(mockedReadLines).not.toHaveBeenCalled()
			// Create a custom expected XML with lines="1-3" for binary files
			const expectedXml = `<file><path>${testFilePath}</path>\n<content lines="1-3">\n${numberedFileContent}</content>\n</file>`
			expect(result).toBe(expectedXml)
		})
	})

	describe("with range parameters", () => {
		it("should honor start_line and end_line when provided", async () => {
			// Setup
			mockedReadLines.mockResolvedValue("Line 2\nLine 3\nLine 4")

			// Execute using executeReadFileTool with range parameters
			const rangeResult = await executeReadFileTool({
				start_line: "2",
				end_line: "4",
			})

			// Verify
			expect(mockedReadLines).toHaveBeenCalledWith(absoluteFilePath, 3, 1) // end_line - 1, start_line - 1
			expect(addLineNumbersSpy).toHaveBeenCalledWith(expect.any(String), 2) // start with proper line numbers

			// Verify XML structure with lines attribute
			expect(rangeResult).toContain(`<file><path>${testFilePath}</path>`)
			expect(rangeResult).toContain(`<content lines="2-4">`)
			expect(rangeResult).toContain("2 | Line 2")
			expect(rangeResult).toContain("3 | Line 3")
			expect(rangeResult).toContain("4 | Line 4")
			expect(rangeResult).toContain("</content>")
		})
	})
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
	let toolResult: ToolResponse | undefined

	beforeEach(() => {
		jest.clearAllMocks()

		mockedPathResolve.mockReturnValue(absoluteFilePath)
		mockedIsBinaryFile.mockResolvedValue(false)

		mockInputContent = fileContent

		mockProvider = {
			getState: jest.fn().mockResolvedValue({ maxReadFileLine: 500 }),
			deref: jest.fn().mockReturnThis(),
		}

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

		mockCline.fileContextTracker = {
			trackFileContext: jest.fn().mockResolvedValue(undefined),
		}

		mockCline.recordToolUsage = jest.fn().mockReturnValue(undefined)
		mockCline.recordToolError = jest.fn().mockReturnValue(undefined)

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
	): Promise<ToolResponse | undefined> {
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

		// Reset the spy's call history before each test
		addLineNumbersSpy.mockClear()

		// Execute the tool
		await readFileTool(
			mockCline,
			toolUse,
			mockCline.ask,
			jest.fn(),
			(result: ToolResponse) => {
				toolResult = result
			},
			(param: ToolParamName, content?: string) => content ?? "",
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
			expect(typeof result).toBe("string")

			if (typeof result === "string") {
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

			// Execute the tool
			await readFileTool(
				mockCline,
				toolUse,
				mockCline.ask,
				jest.fn(),
				(result: ToolResponse) => {
					toolResult = result
				},
				(param: ToolParamName, content?: string) => content ?? "",
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
			console.log(result)

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
