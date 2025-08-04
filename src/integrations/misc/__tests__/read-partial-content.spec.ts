import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { readPartialSingleLineContent, readPartialContent } from "../read-partial-content"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

describe("read-partial-content", () => {
	let tempDir: string
	let testFiles: string[] = []

	beforeEach(async () => {
		// Create a temporary directory for test files
		tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "read-partial-test-"))
		testFiles = []
	})

	afterEach(async () => {
		// Clean up test files
		for (const file of testFiles) {
			try {
				await fs.promises.unlink(file)
			} catch (error) {
				// Ignore cleanup errors
			}
		}
		try {
			await fs.promises.rmdir(tempDir)
		} catch (error) {
			// Ignore cleanup errors
		}
	})

	async function createTestFile(filename: string, content: string): Promise<string> {
		const filePath = path.join(tempDir, filename)
		await fs.promises.writeFile(filePath, content, "utf8")
		testFiles.push(filePath)
		return filePath
	}

	describe("readPartialContent", () => {
		describe("Basic functionality", () => {
			it("should read partial content with line tracking", async () => {
				const content = "Line 1\nLine 2\nLine 3\nLine 4"
				const filePath = await createTestFile("multiline.txt", content)

				const result = await readPartialContent(filePath, 15)

				expect(result.content).toBe("Line 1\nLine 2\nL")
				expect(result.charactersRead).toBe(15)
				expect(result.totalCharacters).toBe(content.length)
				expect(result.linesRead).toBe(3) // Counting starts at 1, and we read into line 3
				expect(result.totalLines).toBe(4)
				expect(result.lastLineRead).toBe(3)
			})

			it("should handle single-line files", async () => {
				const content = "This is a single line file with no newlines"
				const filePath = await createTestFile("single-line.txt", content)

				const result = await readPartialContent(filePath, 20)

				expect(result.content).toBe("This is a single lin")
				expect(result.charactersRead).toBe(20)
				expect(result.linesRead).toBe(1)
				expect(result.totalLines).toBe(1)
				expect(result.lastLineRead).toBe(1)
			})

			it("should read entire file when maxChars exceeds file size", async () => {
				const content = "Small\nFile\nContent"
				const filePath = await createTestFile("small.txt", content)

				const result = await readPartialContent(filePath, 1000)

				expect(result.content).toBe(content)
				expect(result.charactersRead).toBe(content.length)
				expect(result.totalCharacters).toBe(content.length)
				expect(result.linesRead).toBe(3)
				expect(result.totalLines).toBe(3)
				expect(result.lastLineRead).toBe(3)
			})

			it("should handle empty files", async () => {
				const filePath = await createTestFile("empty.txt", "")

				const result = await readPartialContent(filePath, 10)

				expect(result.content).toBe("")
				expect(result.charactersRead).toBe(0)
				expect(result.totalCharacters).toBe(0)
				expect(result.linesRead).toBe(0)
				expect(result.totalLines).toBe(0)
				expect(result.lastLineRead).toBe(0)
			})

			it("should handle maxChars of 0", async () => {
				const content = "This content should not be read"
				const filePath = await createTestFile("zero-chars.txt", content)

				const result = await readPartialContent(filePath, 0)

				expect(result.content).toBe("")
				expect(result.charactersRead).toBe(0)
				expect(result.linesRead).toBe(0)
				expect(result.lastLineRead).toBe(0)
			})
		})

		describe("Line counting accuracy", () => {
			it("should count lines correctly when stopping mid-line", async () => {
				const content = "Line 1\nLine 2 is longer\nLine 3"
				const filePath = await createTestFile("mid-line.txt", content)

				const result = await readPartialContent(filePath, 10)

				expect(result.content).toBe("Line 1\nLin")
				expect(result.linesRead).toBe(2) // We're in line 2
				expect(result.lastLineRead).toBe(2)
			})

			it("should count lines correctly when stopping at newline", async () => {
				const content = "Line 1\nLine 2\nLine 3"
				const filePath = await createTestFile("at-newline.txt", content)

				const result = await readPartialContent(filePath, 7) // Exactly at the first newline

				expect(result.content).toBe("Line 1\n")
				expect(result.linesRead).toBe(2) // We've entered line 2
				expect(result.lastLineRead).toBe(2)
			})

			it("should handle files with empty lines", async () => {
				const content = "Line 1\n\nLine 3\n\n\nLine 6"
				const filePath = await createTestFile("empty-lines.txt", content)

				const result = await readPartialContent(filePath, 15)

				expect(result.content).toBe("Line 1\n\nLine 3\n")
				expect(result.linesRead).toBe(4) // We've entered line 4
				expect(result.totalLines).toBe(6)
			})

			it("should handle files ending with newline", async () => {
				const content = "Line 1\nLine 2\n"
				const filePath = await createTestFile("ending-newline.txt", content)

				const result = await readPartialContent(filePath, 100)

				expect(result.content).toBe(content)
				expect(result.linesRead).toBe(3) // The empty line after the last newline
				expect(result.totalLines).toBe(2) // countFileLines counts actual lines, not the trailing empty line
			})
		})

		describe("Large file handling", () => {
			it("should handle large files with many lines", async () => {
				const lines = Array.from({ length: 1000 }, (_, i) => `Line ${i + 1}`).join("\n")
				const filePath = await createTestFile("many-lines.txt", lines)

				const result = await readPartialContent(filePath, 100)

				expect(result.charactersRead).toBe(100)
				expect(result.totalLines).toBe(1000)
				expect(result.linesRead).toBeGreaterThan(1)
				expect(result.linesRead).toBeLessThan(50) // Should not have read too many lines
			})

			it("should handle very long single lines", async () => {
				const content = "x".repeat(100000) // 100KB single line
				const filePath = await createTestFile("long-single-line.txt", content)

				const result = await readPartialContent(filePath, 1000)

				expect(result.content).toBe("x".repeat(1000))
				expect(result.linesRead).toBe(1)
				expect(result.totalLines).toBe(1)
				expect(result.lastLineRead).toBe(1)
			})
		})

		describe("Unicode and special characters", () => {
			it("should handle Unicode characters with line tracking", async () => {
				const content = "Hello 世界!\n🌍 Émojis\nñoñó chars"
				const filePath = await createTestFile("unicode-lines.txt", content)

				const result = await readPartialContent(filePath, 20)

				expect(result.linesRead).toBeGreaterThanOrEqual(2)
				expect(result.totalLines).toBe(3)
			})
		})

		describe("Error handling", () => {
			it("should reject when file does not exist", async () => {
				const nonExistentPath = path.join(tempDir, "does-not-exist.txt")

				await expect(readPartialContent(nonExistentPath, 10)).rejects.toThrow()
			})

			it("should handle negative maxChars gracefully", async () => {
				const content = "Test content"
				const filePath = await createTestFile("negative-max.txt", content)

				const result = await readPartialContent(filePath, -5)

				expect(result.content).toBe("")
				expect(result.charactersRead).toBe(0)
				expect(result.linesRead).toBe(0)
			})
		})
	})

	describe("readPartialSingleLineContent (legacy)", () => {
		describe("Basic functionality", () => {
			it("should read partial content from a small file", async () => {
				const content = "Hello, world! This is a test file."
				const filePath = await createTestFile("small.txt", content)

				const result = await readPartialSingleLineContent(filePath, 10)

				expect(result).toBe("Hello, wor")
			})

			it("should read entire content when maxChars exceeds file size", async () => {
				const content = "Short file"
				const filePath = await createTestFile("short.txt", content)

				const result = await readPartialSingleLineContent(filePath, 100)

				expect(result).toBe(content)
			})

			it("should handle empty files", async () => {
				const filePath = await createTestFile("empty.txt", "")

				const result = await readPartialSingleLineContent(filePath, 10)

				expect(result).toBe("")
			})

			it("should handle maxChars of 0", async () => {
				const content = "This content should not be read"
				const filePath = await createTestFile("zero-chars.txt", content)

				const result = await readPartialSingleLineContent(filePath, 0)

				expect(result).toBe("")
			})
		})

		describe("Large file handling", () => {
			it("should handle large files efficiently", async () => {
				// Create a large file (1MB of repeated text)
				const chunk = "This is a repeated chunk of text that will be used to create a large file. "
				const largeContent = chunk.repeat(Math.ceil((1024 * 1024) / chunk.length))
				const filePath = await createTestFile("large.txt", largeContent)

				const result = await readPartialSingleLineContent(filePath, 100)

				expect(result).toBe(largeContent.substring(0, 100))
				expect(result.length).toBe(100)
			})

			it("should handle very large maxChars values", async () => {
				const content = "Small content for large maxChars test"
				const filePath = await createTestFile("small-for-large-max.txt", content)

				const result = await readPartialSingleLineContent(filePath, 1000000)

				expect(result).toBe(content)
			})
		})

		describe("Unicode and special characters", () => {
			it("should handle Unicode characters correctly", async () => {
				const content = "Hello 世界! 🌍 Émojis and ñoñó characters"
				const filePath = await createTestFile("unicode.txt", content)

				const result = await readPartialSingleLineContent(filePath, 15)

				// Should handle Unicode characters properly
				expect(result.length).toBeLessThanOrEqual(15)
				expect(result).toBe(content.substring(0, result.length))
			})

			it("should handle newlines in content", async () => {
				const content = "Line 1\nLine 2\nLine 3"
				const filePath = await createTestFile("multiline.txt", content)

				const result = await readPartialSingleLineContent(filePath, 10)

				expect(result).toBe("Line 1\nLin")
			})

			it("should handle special characters and symbols", async () => {
				const content = "Special chars: !@#$%^&*()_+-=[]{}|;':\",./<>?"
				const filePath = await createTestFile("special.txt", content)

				const result = await readPartialSingleLineContent(filePath, 20)

				expect(result).toBe("Special chars: !@#$%")
			})
		})

		describe("Edge cases", () => {
			it("should handle exact character limit", async () => {
				const content = "Exactly twenty chars"
				const filePath = await createTestFile("exact.txt", content)

				const result = await readPartialSingleLineContent(filePath, 20)

				expect(result).toBe(content)
				expect(result.length).toBe(20)
			})

			it("should handle maxChars = 1", async () => {
				const content = "Single character test"
				const filePath = await createTestFile("single-char.txt", content)

				const result = await readPartialSingleLineContent(filePath, 1)

				expect(result).toBe("S")
			})

			it("should handle files with only whitespace", async () => {
				const content = "   \t\n   "
				const filePath = await createTestFile("whitespace.txt", content)

				const result = await readPartialSingleLineContent(filePath, 5)

				expect(result).toBe("   \t\n")
			})
		})

		describe("Error handling", () => {
			it("should reject when file does not exist", async () => {
				const nonExistentPath = path.join(tempDir, "does-not-exist.txt")

				await expect(readPartialSingleLineContent(nonExistentPath, 10)).rejects.toThrow()
			})

			it("should reject when file path is invalid", async () => {
				const invalidPath = "\0invalid\0path"

				await expect(readPartialSingleLineContent(invalidPath, 10)).rejects.toThrow()
			})

			it("should handle negative maxChars gracefully", async () => {
				const content = "Test content"
				const filePath = await createTestFile("negative-max.txt", content)

				const result = await readPartialSingleLineContent(filePath, -5)

				expect(result).toBe("")
			})
		})

		describe("Performance and memory efficiency", () => {
			it("should not load entire large file into memory", async () => {
				// Create a file larger than typical memory chunks
				const largeContent = "x".repeat(5 * 1024 * 1024) // 5MB file
				const filePath = await createTestFile("memory-test.txt", largeContent)

				// Read only a small portion
				const result = await readPartialSingleLineContent(filePath, 1000)

				expect(result).toBe("x".repeat(1000))
				expect(result.length).toBe(1000)
			})

			it("should handle multiple consecutive reads efficiently", async () => {
				const content = "Repeated read test content that is somewhat long"
				const filePath = await createTestFile("repeated-read.txt", content)

				// Perform multiple reads
				const results = await Promise.all([
					readPartialSingleLineContent(filePath, 10),
					readPartialSingleLineContent(filePath, 20),
					readPartialSingleLineContent(filePath, 30),
				])

				expect(results[0]).toBe(content.substring(0, 10))
				expect(results[1]).toBe(content.substring(0, 20))
				expect(results[2]).toBe(content.substring(0, 30))
			})
		})

		describe("Stream handling", () => {
			it("should handle normal stream completion", async () => {
				const content = "Stream test content"
				const filePath = await createTestFile("stream-test.txt", content)

				const result = await readPartialSingleLineContent(filePath, 10)

				expect(result).toBe("Stream tes")
			})

			it("should handle file access errors", async () => {
				// Test with a directory instead of a file to trigger an error
				await expect(readPartialSingleLineContent(tempDir, 10)).rejects.toThrow()
			})
		})

		describe("Boundary conditions", () => {
			it("should handle chunk boundaries correctly", async () => {
				// Create content that will span multiple chunks
				const chunkSize = 16 * 1024 // Default highWaterMark
				const content = "a".repeat(chunkSize + 100)
				const filePath = await createTestFile("chunk-boundary.txt", content)

				const result = await readPartialSingleLineContent(filePath, chunkSize + 50)

				expect(result).toBe("a".repeat(chunkSize + 50))
				expect(result.length).toBe(chunkSize + 50)
			})

			it("should handle maxChars at chunk boundary", async () => {
				const chunkSize = 16 * 1024
				const content = "b".repeat(chunkSize * 2)
				const filePath = await createTestFile("exact-chunk.txt", content)

				const result = await readPartialSingleLineContent(filePath, chunkSize)

				expect(result).toBe("b".repeat(chunkSize))
				expect(result.length).toBe(chunkSize)
			})
		})
	})
})
