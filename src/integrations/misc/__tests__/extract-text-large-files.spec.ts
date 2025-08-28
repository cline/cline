// npx vitest run integrations/misc/__tests__/extract-text-large-files.spec.ts

import * as fs from "fs/promises"

import { extractTextFromFile } from "../extract-text"
import { countFileLines } from "../line-counter"
import { readLines } from "../read-lines"
import { isBinaryFile } from "isbinaryfile"

// Mock all dependencies
vi.mock("fs/promises")
vi.mock("../line-counter")
vi.mock("../read-lines")
vi.mock("isbinaryfile")

describe("extractTextFromFile - Large File Handling", () => {
	// Type the mocks
	const mockedFs = vi.mocked(fs)
	const mockedCountFileLines = vi.mocked(countFileLines)
	const mockedReadLines = vi.mocked(readLines)
	const mockedIsBinaryFile = vi.mocked(isBinaryFile)

	beforeEach(() => {
		vi.clearAllMocks()
		// Set default mock behavior
		mockedFs.access.mockResolvedValue(undefined)
		mockedIsBinaryFile.mockResolvedValue(false)
	})

	it("should truncate files that exceed maxReadFileLine limit", async () => {
		const largeFileContent = Array(150)
			.fill(null)
			.map((_, i) => `Line ${i + 1}: This is a test line with some content`)
			.join("\n")

		mockedCountFileLines.mockResolvedValue(150)
		mockedReadLines.mockResolvedValue(
			Array(100)
				.fill(null)
				.map((_, i) => `Line ${i + 1}: This is a test line with some content`)
				.join("\n"),
		)

		const result = await extractTextFromFile("/test/large-file.ts", 100)

		// Should only include first 100 lines with line numbers
		expect(result).toContain("  1 | Line 1: This is a test line with some content")
		expect(result).toContain("100 | Line 100: This is a test line with some content")
		expect(result).not.toContain("101 | Line 101: This is a test line with some content")

		// Should include truncation message
		expect(result).toContain(
			"[File truncated: showing 100 of 150 total lines. The file is too large and may exhaust the context window if read in full.]",
		)
	})

	it("should not truncate files within the maxReadFileLine limit", async () => {
		const smallFileContent = Array(50)
			.fill(null)
			.map((_, i) => `Line ${i + 1}: This is a test line`)
			.join("\n")

		mockedCountFileLines.mockResolvedValue(50)
		mockedFs.readFile.mockResolvedValue(smallFileContent as any)

		const result = await extractTextFromFile("/test/small-file.ts", 100)

		// Should include all lines with line numbers
		expect(result).toContain(" 1 | Line 1: This is a test line")
		expect(result).toContain("50 | Line 50: This is a test line")

		// Should not include truncation message
		expect(result).not.toContain("[File truncated:")
	})

	it("should handle files with exactly maxReadFileLine lines", async () => {
		const exactFileContent = Array(100)
			.fill(null)
			.map((_, i) => `Line ${i + 1}`)
			.join("\n")

		mockedCountFileLines.mockResolvedValue(100)
		mockedFs.readFile.mockResolvedValue(exactFileContent as any)

		const result = await extractTextFromFile("/test/exact-file.ts", 100)

		// Should include all lines with line numbers
		expect(result).toContain("  1 | Line 1")
		expect(result).toContain("100 | Line 100")

		// Should not include truncation message
		expect(result).not.toContain("[File truncated:")
	})

	it("should handle undefined maxReadFileLine by not truncating", async () => {
		const largeFileContent = Array(200)
			.fill(null)
			.map((_, i) => `Line ${i + 1}`)
			.join("\n")

		mockedFs.readFile.mockResolvedValue(largeFileContent as any)

		const result = await extractTextFromFile("/test/large-file.ts", undefined)

		// Should include all lines with line numbers when maxReadFileLine is undefined
		expect(result).toContain("  1 | Line 1")
		expect(result).toContain("200 | Line 200")

		// Should not include truncation message
		expect(result).not.toContain("[File truncated:")
	})

	it("should handle empty files", async () => {
		mockedFs.readFile.mockResolvedValue("" as any)

		const result = await extractTextFromFile("/test/empty-file.ts", 100)

		expect(result).toBe("")
		expect(result).not.toContain("[File truncated:")
	})

	it("should handle files with only newlines", async () => {
		const newlineOnlyContent = "\n\n\n\n\n"

		mockedCountFileLines.mockResolvedValue(6) // 5 newlines = 6 lines
		mockedReadLines.mockResolvedValue("\n\n")

		const result = await extractTextFromFile("/test/newline-file.ts", 3)

		// Should truncate at line 3
		expect(result).toContain("[File truncated: showing 3 of 6 total lines")
	})

	it("should handle very large files efficiently", async () => {
		// Simulate a 10,000 line file
		mockedCountFileLines.mockResolvedValue(10000)
		mockedReadLines.mockResolvedValue(
			Array(500)
				.fill(null)
				.map((_, i) => `Line ${i + 1}: Some content here`)
				.join("\n"),
		)

		const result = await extractTextFromFile("/test/very-large-file.ts", 500)

		// Should only include first 500 lines with line numbers
		expect(result).toContain("  1 | Line 1: Some content here")
		expect(result).toContain("500 | Line 500: Some content here")
		expect(result).not.toContain("501 | Line 501: Some content here")

		// Should show truncation message
		expect(result).toContain("[File truncated: showing 500 of 10000 total lines")
	})

	it("should handle maxReadFileLine of 0 by throwing an error", async () => {
		const fileContent = "Line 1\nLine 2\nLine 3"

		mockedFs.readFile.mockResolvedValue(fileContent as any)

		// maxReadFileLine of 0 should throw an error
		await expect(extractTextFromFile("/test/file.ts", 0)).rejects.toThrow(
			"Invalid maxReadFileLine: 0. Must be a positive integer or -1 for unlimited.",
		)
	})

	it("should handle negative maxReadFileLine by treating as undefined", async () => {
		const fileContent = "Line 1\nLine 2\nLine 3"

		mockedFs.readFile.mockResolvedValue(fileContent as any)

		const result = await extractTextFromFile("/test/file.ts", -1)

		// Should include all content with line numbers when negative
		expect(result).toContain("1 | Line 1")
		expect(result).toContain("2 | Line 2")
		expect(result).toContain("3 | Line 3")
		expect(result).not.toContain("[File truncated:")
	})

	it("should preserve file content structure when truncating", async () => {
		const structuredContent = [
			"function example() {",
			"  const x = 1;",
			"  const y = 2;",
			"  return x + y;",
			"}",
			"",
			"// More code below",
		].join("\n")

		mockedCountFileLines.mockResolvedValue(7)
		mockedReadLines.mockResolvedValue(["function example() {", "  const x = 1;", "  const y = 2;"].join("\n"))

		const result = await extractTextFromFile("/test/structured.ts", 3)

		// Should preserve the first 3 lines with line numbers
		expect(result).toContain("1 | function example() {")
		expect(result).toContain("2 |   const x = 1;")
		expect(result).toContain("3 |   const y = 2;")
		expect(result).not.toContain("4 |   return x + y;")

		// Should include truncation info
		expect(result).toContain("[File truncated: showing 3 of 7 total lines")
	})

	it("should handle binary files by throwing an error", async () => {
		mockedIsBinaryFile.mockResolvedValue(true)

		await expect(extractTextFromFile("/test/binary.bin", 100)).rejects.toThrow(
			"Cannot read text for file type: .bin",
		)
	})

	it("should handle file not found errors", async () => {
		mockedFs.access.mockRejectedValue(new Error("ENOENT"))

		await expect(extractTextFromFile("/test/nonexistent.ts", 100)).rejects.toThrow(
			"File not found: /test/nonexistent.ts",
		)
	})
})
