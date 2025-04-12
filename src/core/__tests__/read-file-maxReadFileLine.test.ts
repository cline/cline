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
		extractTextFromFile: jest.fn(),
	}
})

// Get a reference to the spy
const addLineNumbersSpy = jest.requireMock("../../integrations/misc/extract-text").__addLineNumbersSpy

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
	const mockedAddLineNumbers = addLineNumbers as jest.MockedFunction<typeof addLineNumbers>
	const mockedParseSourceCodeDefinitionsForFile = parseSourceCodeDefinitionsForFile as jest.MockedFunction<
		typeof parseSourceCodeDefinitionsForFile
	>

	// Variable to control what content is used by the mock - set in beforeEach
	let mockInputContent = ""

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

		// Setup the extractTextFromFile mock implementation with the current mockInputContent
		mockedExtractTextFromFile.mockImplementation((filePath) => {
			const actual = jest.requireActual("../../integrations/misc/extract-text")
			return Promise.resolve(actual.addLineNumbers(mockInputContent))
		})

		// No need to setup the extractTextFromFile mock implementation here
		// as it's already defined at the module level

		// Setup mock provider
		mockProvider = {
			getState: jest.fn(),
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
		mockCline.getFileContextTracker = jest.fn().mockReturnValue({
			trackFileContext: jest.fn().mockResolvedValue(undefined),
		})

		// Reset tool result
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
	): Promise<string | undefined> {
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
			params: {
				path: testFilePath,
				...params,
			},
			partial: false,
		}

		// Import the tool implementation dynamically to avoid hoisting issues
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
