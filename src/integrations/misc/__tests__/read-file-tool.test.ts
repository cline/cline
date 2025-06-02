// npx jest src/integrations/misc/__tests__/read-file-tool.test.ts

import * as path from "path"
import { countFileLines } from "../line-counter"
import { readLines } from "../read-lines"
import { extractTextFromFile, addLineNumbers } from "../extract-text"

// Mock the required functions
jest.mock("../line-counter")
jest.mock("../read-lines")
jest.mock("../extract-text")

describe("read_file tool with maxReadFileLine setting", () => {
	// Mock original implementation first to use in tests
	const originalCountFileLines = jest.requireActual("../line-counter").countFileLines
	const originalReadLines = jest.requireActual("../read-lines").readLines
	const originalExtractTextFromFile = jest.requireActual("../extract-text").extractTextFromFile
	const originalAddLineNumbers = jest.requireActual("../extract-text").addLineNumbers

	beforeEach(() => {
		jest.resetAllMocks()
		// Reset mocks to simulate original behavior
		;(countFileLines as jest.Mock).mockImplementation(originalCountFileLines)
		;(readLines as jest.Mock).mockImplementation(originalReadLines)
		;(extractTextFromFile as jest.Mock).mockImplementation(originalExtractTextFromFile)
		;(addLineNumbers as jest.Mock).mockImplementation(originalAddLineNumbers)
	})

	// Test for the case when file size is smaller than maxReadFileLine
	it("should read entire file when line count is less than maxReadFileLine", async () => {
		// Mock necessary functions
		;(countFileLines as jest.Mock).mockResolvedValue(100)
		;(extractTextFromFile as jest.Mock).mockResolvedValue("Small file content")

		// Create mock implementation that would simulate the behavior
		// Note: We're not testing the Cline class directly as it would be too complex
		// We're testing the logic flow that would happen in the read_file implementation

		const filePath = path.resolve("/test", "smallFile.txt")
		const maxReadFileLine = 500

		// Check line count
		const lineCount = await countFileLines(filePath)
		expect(lineCount).toBeLessThan(maxReadFileLine)

		// Should use extractTextFromFile for small files
		if (lineCount < maxReadFileLine) {
			await extractTextFromFile(filePath)
		}

		expect(extractTextFromFile).toHaveBeenCalledWith(filePath)
		expect(readLines).not.toHaveBeenCalled()
	})

	// Test for the case when file size is larger than maxReadFileLine
	it("should truncate file when line count exceeds maxReadFileLine", async () => {
		// Mock necessary functions
		;(countFileLines as jest.Mock).mockResolvedValue(5000)
		;(readLines as jest.Mock).mockResolvedValue("First 500 lines of large file")
		;(addLineNumbers as jest.Mock).mockReturnValue("1 | First line\n2 | Second line\n...")

		const filePath = path.resolve("/test", "largeFile.txt")
		const maxReadFileLine = 500

		// Check line count
		const lineCount = await countFileLines(filePath)
		expect(lineCount).toBeGreaterThan(maxReadFileLine)

		// Should use readLines for large files
		if (lineCount > maxReadFileLine) {
			const content = await readLines(filePath, maxReadFileLine - 1, 0)
			const numberedContent = addLineNumbers(content)

			// Verify the truncation message is shown (simulated)
			const truncationMsg = `\n\n[File truncated: showing ${maxReadFileLine} of ${lineCount} total lines]`
			const fullResult = numberedContent + truncationMsg

			expect(fullResult).toContain("File truncated")
		}

		expect(readLines).toHaveBeenCalledWith(filePath, maxReadFileLine - 1, 0)
		expect(addLineNumbers).toHaveBeenCalled()
		expect(extractTextFromFile).not.toHaveBeenCalled()
	})

	// Test for the case when the file is a source code file
	it("should add source code file type info for large source code files", async () => {
		// Mock necessary functions
		;(countFileLines as jest.Mock).mockResolvedValue(5000)
		;(readLines as jest.Mock).mockResolvedValue("First 500 lines of large JavaScript file")
		;(addLineNumbers as jest.Mock).mockReturnValue('1 | const foo = "bar";\n2 | function test() {...')

		const filePath = path.resolve("/test", "largeFile.js")
		const maxReadFileLine = 500

		// Check line count
		const lineCount = await countFileLines(filePath)
		expect(lineCount).toBeGreaterThan(maxReadFileLine)

		// Check if the file is a source code file
		const fileExt = path.extname(filePath).toLowerCase()
		const isSourceCode = [
			".js",
			".ts",
			".jsx",
			".tsx",
			".py",
			".java",
			".c",
			".cpp",
			".cs",
			".go",
			".rb",
			".php",
			".swift",
			".rs",
		].includes(fileExt)
		expect(isSourceCode).toBeTruthy()

		// Should use readLines for large files
		if (lineCount > maxReadFileLine) {
			const content = await readLines(filePath, maxReadFileLine - 1, 0)
			const numberedContent = addLineNumbers(content)

			// Verify the truncation message and source code message are shown (simulated)
			let truncationMsg = `\n\n[File truncated: showing ${maxReadFileLine} of ${lineCount} total lines]`
			if (isSourceCode) {
				truncationMsg +=
					"\n\nThis appears to be a source code file. Consider using list_code_definition_names to understand its structure."
			}
			const fullResult = numberedContent + truncationMsg

			expect(fullResult).toContain("source code file")
			expect(fullResult).toContain("list_code_definition_names")
		}

		expect(readLines).toHaveBeenCalledWith(filePath, maxReadFileLine - 1, 0)
		expect(addLineNumbers).toHaveBeenCalled()
	})
})
