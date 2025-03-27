const DEBUG = false

import * as path from "path"
import { countFileLines } from "../../integrations/misc/line-counter"
import { readLines } from "../../integrations/misc/read-lines"
import { extractTextFromFile, addLineNumbers } from "../../integrations/misc/extract-text"
import { parseSourceCodeDefinitionsForFile } from "../../services/tree-sitter"
import { isBinaryFile } from "isbinaryfile"
import { ReadFileToolUse } from "../assistant-message"
import { Cline } from "../Cline"
import { ClineProvider } from "../webview/ClineProvider"

// Mock dependencies
jest.mock("../../integrations/misc/line-counter")
jest.mock("../../integrations/misc/read-lines")
jest.mock("../../integrations/misc/extract-text")
jest.mock("../../services/tree-sitter")
jest.mock("isbinaryfile")
jest.mock("../ignore/RooIgnoreController", () => ({
	RooIgnoreController: class {
		initialize() {
			return Promise.resolve()
		}
		validateAccess(filePath: string) {
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
	// Mock original implementation first to use in tests
	const originalCountFileLines = jest.requireActual("../../integrations/misc/line-counter").countFileLines
	const originalReadLines = jest.requireActual("../../integrations/misc/read-lines").readLines
	const originalExtractTextFromFile = jest.requireActual("../../integrations/misc/extract-text").extractTextFromFile
	const originalAddLineNumbers = jest.requireActual("../../integrations/misc/extract-text").addLineNumbers
	const originalParseSourceCodeDefinitionsForFile =
		jest.requireActual("../../services/tree-sitter").parseSourceCodeDefinitionsForFile
	const originalIsBinaryFile = jest.requireActual("isbinaryfile").isBinaryFile

	let cline: Cline
	let mockProvider: any
	const testFilePath = "test/file.txt"
	const absoluteFilePath = "/home/ewheeler/src/roo/roo-main/test/file.txt"
	const fileContent = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5"
	const numberedFileContent = "1 | Line 1\n2 | Line 2\n3 | Line 3\n4 | Line 4\n5 | Line 5"
	const sourceCodeDef = "\n\n# file.txt\n1--5 | Content"

	beforeEach(() => {
		jest.resetAllMocks()

		// Reset mocks to simulate original behavior
		;(countFileLines as jest.Mock).mockImplementation(originalCountFileLines)
		;(readLines as jest.Mock).mockImplementation(originalReadLines)
		;(extractTextFromFile as jest.Mock).mockImplementation(originalExtractTextFromFile)
		;(parseSourceCodeDefinitionsForFile as jest.Mock).mockImplementation(originalParseSourceCodeDefinitionsForFile)
		;(isBinaryFile as jest.Mock).mockImplementation(originalIsBinaryFile)

		// Default mock implementations
		;(countFileLines as jest.Mock).mockResolvedValue(5)
		;(readLines as jest.Mock).mockResolvedValue(fileContent)
		;(extractTextFromFile as jest.Mock).mockResolvedValue(numberedFileContent)
		// Use the real addLineNumbers function
		;(addLineNumbers as jest.Mock).mockImplementation(originalAddLineNumbers)
		;(parseSourceCodeDefinitionsForFile as jest.Mock).mockResolvedValue(sourceCodeDef)
		;(isBinaryFile as jest.Mock).mockResolvedValue(false)

		// Add spy to debug the readLines calls
		const readLinesSpy = jest.spyOn(require("../../integrations/misc/read-lines"), "readLines")

		// Mock path.resolve to return a predictable path
		;(path.resolve as jest.Mock).mockReturnValue(absoluteFilePath)

		// Create mock provider
		mockProvider = {
			getState: jest.fn(),
			deref: jest.fn().mockReturnThis(),
		}

		// Create a Cline instance with the necessary configuration
		cline = new Cline({
			provider: mockProvider,
			apiConfiguration: { apiProvider: "anthropic" } as any,
			task: "Test read_file tool", // Required to satisfy constructor check
			startTask: false, // Prevent actual task initialization
		})

		// Set up the read_file tool use
		const readFileToolUse: ReadFileToolUse = {
			type: "tool_use",
			name: "read_file",
			params: {
				path: testFilePath,
			},
			partial: false,
		}

		// Set up the Cline instance for testing
		const clineAny = cline as any

		// Set up the required properties for the test
		clineAny.assistantMessageContent = [readFileToolUse]
		clineAny.currentStreamingContentIndex = 0
		clineAny.userMessageContent = []
		clineAny.presentAssistantMessageLocked = false
		clineAny.didCompleteReadingStream = true
		clineAny.didRejectTool = false
		clineAny.didAlreadyUseTool = false

		// Mock methods that would be called during presentAssistantMessage
		clineAny.say = jest.fn().mockResolvedValue(undefined)
		clineAny.ask = jest.fn().mockImplementation((type, message) => {
			return Promise.resolve({ response: "yesButtonClicked" })
		})
	})

	// Helper function to get user message content
	const getUserMessageContent = (clineInstance: Cline) => {
		const clineAny = clineInstance as any
		return clineAny.userMessageContent
	}

	// Helper function to validate response lines
	const validateResponseLines = (
		responseLines: string[],
		options: {
			expectedLineCount: number
			shouldContainLines?: number[]
			shouldNotContainLines?: number[]
		},
	) => {
		if (options.shouldContainLines) {
			const contentLines = responseLines.filter((line) => line.includes("Line "))
			expect(contentLines.length).toBe(options.expectedLineCount)
			options.shouldContainLines.forEach((lineNum) => {
				expect(contentLines[lineNum - 1]).toContain(`Line ${lineNum}`)
			})
		}

		if (options.shouldNotContainLines) {
			options.shouldNotContainLines.forEach((lineNum) => {
				expect(responseLines.some((line) => line.includes(`Line ${lineNum}`))).toBe(false)
			})
		}
	}

	interface TestExpectations {
		extractTextCalled: boolean
		readLinesCalled: boolean
		sourceCodeDefCalled: boolean
		readLinesParams?: [string, number, number]
		responseValidation: {
			expectedLineCount: number
			shouldContainLines?: number[]
			shouldNotContainLines?: number[]
		}
		expectedContent?: string
		truncationMessage?: string
		includeSourceCodeDef?: boolean
	}

	interface TestCase {
		name: string
		maxReadFileLine: number
		setup?: () => void
		expectations: TestExpectations
	}

	// Test cases
	const testCases: TestCase[] = [
		{
			name: "read entire file when maxReadFileLine is -1",
			maxReadFileLine: -1,
			expectations: {
				extractTextCalled: true,
				readLinesCalled: false,
				sourceCodeDefCalled: false,
				responseValidation: {
					expectedLineCount: 5,
					shouldContainLines: [1, 2, 3, 4, 5],
				},
				expectedContent: numberedFileContent,
			},
		},
		{
			name: "read entire file when maxReadFileLine >= file length",
			maxReadFileLine: 10,
			expectations: {
				extractTextCalled: true,
				readLinesCalled: false,
				sourceCodeDefCalled: false,
				responseValidation: {
					expectedLineCount: 5,
					shouldContainLines: [1, 2, 3, 4, 5],
				},
				expectedContent: numberedFileContent,
			},
		},
		{
			name: "read zero lines and only provide line declaration definitions when maxReadFileLine is 0",
			maxReadFileLine: 0,
			expectations: {
				extractTextCalled: false,
				readLinesCalled: false,
				sourceCodeDefCalled: true,
				responseValidation: {
					expectedLineCount: 0,
				},
				truncationMessage: `[Showing only 0 of 5 total lines. Use start_line and end_line if you need to read more]`,
				includeSourceCodeDef: true,
			},
		},
		{
			name: "read maxReadFileLine lines and provide line declaration definitions when maxReadFileLine < file length",
			maxReadFileLine: 3,
			setup: () => {
				jest.clearAllMocks()
				;(countFileLines as jest.Mock).mockResolvedValue(5)
				;(readLines as jest.Mock).mockImplementation((path, endLine, startLine = 0) => {
					const lines = fileContent.split("\n")
					const actualEndLine = endLine !== undefined ? Math.min(endLine, lines.length - 1) : lines.length - 1
					const actualStartLine = startLine !== undefined ? Math.min(startLine, lines.length - 1) : 0
					const requestedLines = lines.slice(actualStartLine, actualEndLine + 1)
					return Promise.resolve(requestedLines.join("\n"))
				})
			},
			expectations: {
				extractTextCalled: false,
				readLinesCalled: true,
				sourceCodeDefCalled: true,
				readLinesParams: [absoluteFilePath, 2, 0],
				responseValidation: {
					expectedLineCount: 3,
					shouldContainLines: [1, 2, 3],
					shouldNotContainLines: [4, 5],
				},
				truncationMessage: `[Showing only 3 of 5 total lines. Use start_line and end_line if you need to read more]`,
				includeSourceCodeDef: true,
			},
		},
	]

	test.each(testCases)("should $name", async (testCase) => {
		// Setup
		if (testCase.setup) {
			testCase.setup()
		}
		mockProvider.getState.mockResolvedValue({ maxReadFileLine: testCase.maxReadFileLine })

		// Execute
		await cline.presentAssistantMessage()

		// Verify mock calls
		if (testCase.expectations.extractTextCalled) {
			expect(extractTextFromFile).toHaveBeenCalledWith(absoluteFilePath)
		} else {
			expect(extractTextFromFile).not.toHaveBeenCalled()
		}

		if (testCase.expectations.readLinesCalled) {
			const params = testCase.expectations.readLinesParams
			if (!params) {
				throw new Error("readLinesParams must be defined when readLinesCalled is true")
			}
			expect(readLines).toHaveBeenCalledWith(...params)
		} else {
			expect(readLines).not.toHaveBeenCalled()
		}

		if (testCase.expectations.sourceCodeDefCalled) {
			expect(parseSourceCodeDefinitionsForFile).toHaveBeenCalled()
		} else {
			expect(parseSourceCodeDefinitionsForFile).not.toHaveBeenCalled()
		}

		// Verify response content
		const userMessageContent = getUserMessageContent(cline)

		if (DEBUG) {
			console.log(`\n=== Test: ${testCase.name} ===`)
			console.log(`maxReadFileLine: ${testCase.maxReadFileLine}`)
			console.log("Response content:", JSON.stringify(userMessageContent, null, 2))
		}
		const responseLines = userMessageContent[1].text.split("\n")

		if (DEBUG) {
			console.log(`Number of lines in response: ${responseLines.length}`)
		}

		expect(userMessageContent.length).toBe(2)
		expect(userMessageContent[0].text).toBe(`[read_file for '${testFilePath}'] Result:`)

		if (testCase.expectations.expectedContent) {
			expect(userMessageContent[1].text).toBe(testCase.expectations.expectedContent)
		}

		if (testCase.expectations.responseValidation) {
			validateResponseLines(responseLines, testCase.expectations.responseValidation)
		}

		if (testCase.expectations.truncationMessage) {
			expect(userMessageContent[1].text).toContain(testCase.expectations.truncationMessage)
		}

		if (testCase.expectations.includeSourceCodeDef) {
			expect(userMessageContent[1].text).toContain(sourceCodeDef)
		}
	})
})
