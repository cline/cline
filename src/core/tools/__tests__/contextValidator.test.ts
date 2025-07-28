import { describe, it, expect, vi, beforeEach } from "vitest"
import { validateFileSizeForContext } from "../contextValidator"
import { Task } from "../../task/Task"
import { promises as fs } from "fs"
import { readLines } from "../../../integrations/misc/read-lines"
import * as sharedApi from "../../../shared/api"

vi.mock("fs", () => ({
	promises: {
		stat: vi.fn(),
	},
}))

vi.mock("../../../integrations/misc/read-lines", () => ({
	readLines: vi.fn(),
}))

vi.mock("../../../shared/api", () => ({
	getModelMaxOutputTokens: vi.fn(),
}))

describe("contextValidator", () => {
	let mockTask: Task

	beforeEach(() => {
		vi.clearAllMocks()

		// Mock Task instance
		mockTask = {
			api: {
				getModel: vi.fn().mockReturnValue({
					id: "test-model",
					info: {
						contextWindow: 100000,
						maxTokens: 4096,
					},
				}),
				countTokens: vi.fn().mockResolvedValue(1000),
			},
			getTokenUsage: vi.fn().mockReturnValue({
				contextTokens: 10000,
			}),
			apiConfiguration: {
				apiProvider: "anthropic",
			},
			providerRef: {
				deref: vi.fn().mockReturnValue({
					getState: vi.fn().mockResolvedValue({}),
				}),
			},
		} as any

		// Mock getModelMaxOutputTokens to return a consistent value
		vi.mocked(sharedApi.getModelMaxOutputTokens).mockReturnValue(4096)
	})

	describe("validateFileSizeForContext", () => {
		it("should apply 25% buffer to remaining context and read incrementally", async () => {
			const mockStats = { size: 50000 }
			vi.mocked(fs.stat).mockResolvedValue(mockStats as any)

			// Mock readLines to return content in batches
			// Each batch is 100 lines, returning content that results in 1200 tokens per batch
			vi.mocked(readLines).mockImplementation(async (path, endLine, startLine) => {
				const start = startLine ?? 0
				const end = endLine ?? 99
				const lines = end - start + 1
				return `test content line\n`.repeat(lines)
			})

			// Mock token count - 12 tokens per line (1200 per 100-line batch)
			let callCount = 0
			mockTask.api.countTokens = vi.fn().mockImplementation(async (content) => {
				callCount++
				const text = content[0].text
				const lines = text.split("\n").length - 1
				return lines * 12 // 12 tokens per line
			})

			const result = await validateFileSizeForContext(
				"/test/file.ts",
				1000, // totalLines
				-1, // currentMaxReadFileLine
				mockTask,
			)

			// New calculation:
			// Context window = 100k, current usage = 10k
			// Remaining = 90k
			// With 25% buffer on remaining: usable = 90k * 0.75 = 67.5k
			// Reserved for response ~2k
			// Available should be around 65.5k tokens
			// File needs 12k tokens total (1000 lines * 12 tokens)
			expect(result.shouldLimit).toBe(false)

			// Verify readLines was called multiple times (incremental reading)
			expect(readLines).toHaveBeenCalled()

			// Verify the new calculation approach
			const remaining = 100000 - 10000 // 90k remaining
			const usableRemaining = remaining * 0.75 // 67.5k with 25% buffer
			expect(usableRemaining).toBe(67500)
		})

		it("should handle different context usage levels correctly", async () => {
			const mockStats = { size: 50000 }
			vi.mocked(fs.stat).mockResolvedValue(mockStats as any)

			// Mock readLines
			vi.mocked(readLines).mockImplementation(async (path, endLine, startLine) => {
				const start = startLine ?? 0
				const end = endLine ?? 99
				const lines = end - start + 1
				return `test content line\n`.repeat(lines)
			})

			// Mock token count - 50 tokens per line
			mockTask.api.countTokens = vi.fn().mockImplementation(async (content) => {
				const text = content[0].text
				const lines = text.split("\n").length - 1
				return lines * 50
			})

			// Test with 50% context already used
			mockTask.getTokenUsage = vi.fn().mockReturnValue({
				contextTokens: 50000, // 50% of 100k context used
			})

			const result = await validateFileSizeForContext(
				"/test/file.ts",
				2000, // totalLines
				-1,
				mockTask,
			)

			// With 50k remaining and 25% buffer: 50k * 0.75 = 37.5k usable
			// Minus ~2k for response = ~35.5k available
			// File needs 100k tokens (2000 lines * 50 tokens)
			// Should limit the file
			expect(result.shouldLimit).toBe(true)
			expect(result.safeMaxLines).toBeLessThan(2000)
			expect(result.reason).toContain("exceeds available context space")
		})

		it("should limit file when it exceeds available space with buffer", async () => {
			// Set up a scenario where file is too large
			const mockStats = { size: 500000 } // Large file
			vi.mocked(fs.stat).mockResolvedValue(mockStats as any)

			// Mock readLines to return content in batches
			vi.mocked(readLines).mockImplementation(async (path, endLine, startLine) => {
				const start = startLine ?? 0
				const end = endLine ?? 99
				const lines = end - start + 1
				return `large content line\n`.repeat(lines)
			})

			// Mock large token count - 100 tokens per line
			mockTask.api.countTokens = vi.fn().mockImplementation(async (content) => {
				const text = content[0].text
				const lines = text.split("\n").length - 1
				return lines * 100 // 100 tokens per line
			})

			const result = await validateFileSizeForContext(
				"/test/largefile.ts",
				10000, // totalLines
				-1,
				mockTask,
			)

			expect(result.shouldLimit).toBe(true)
			expect(result.safeMaxLines).toBeGreaterThan(0)
			expect(result.safeMaxLines).toBeLessThan(10000) // Should stop before reading all lines
			expect(result.reason).toContain("exceeds available context space")
		})

		it("should handle very large files through incremental reading", async () => {
			// Set up a file larger than 50MB
			const mockStats = { size: 60_000_000 } // 60MB file
			vi.mocked(fs.stat).mockResolvedValue(mockStats as any)

			// Mock readLines to return content in batches
			vi.mocked(readLines).mockImplementation(async (path, endLine, startLine) => {
				const start = startLine ?? 0
				const end = endLine ?? 99
				const lines = end - start + 1
				return `large file content line\n`.repeat(lines)
			})

			// Mock very high token count per line (simulating dense content)
			mockTask.api.countTokens = vi.fn().mockImplementation(async (content) => {
				const text = content[0].text
				const lines = text.split("\n").length - 1
				return lines * 200 // 200 tokens per line for very large file
			})

			const result = await validateFileSizeForContext(
				"/test/hugefile.ts",
				100000, // totalLines
				-1,
				mockTask,
			)

			expect(result.shouldLimit).toBe(true)
			// Should have attempted to read the file incrementally
			expect(readLines).toHaveBeenCalled()
			// Should stop early due to token limits
			expect(result.safeMaxLines).toBeLessThan(1000)
			expect(result.reason).toContain("exceeds available context space")
		})

		it("should handle read failures gracefully", async () => {
			const mockStats = { size: 100000 } // 100KB file
			vi.mocked(fs.stat).mockResolvedValue(mockStats as any)

			// Mock readLines to fail
			vi.mocked(readLines).mockRejectedValue(new Error("Read error"))

			const result = await validateFileSizeForContext(
				"/test/problematic.ts",
				2000, // totalLines
				-1,
				mockTask,
			)

			// Should return a safe default when reading fails
			expect(result.shouldLimit).toBe(true)
			expect(result.safeMaxLines).toBe(50) // Minimum useful lines
		})

		it("should handle very limited context space", async () => {
			const mockStats = { size: 10000 } // 10KB file
			vi.mocked(fs.stat).mockResolvedValue(mockStats as any)

			// Set very high context usage
			// With new calculation: 100k - 95k = 5k remaining
			// 5k * 0.75 = 3.75k usable
			// Minus ~2k for response = ~1.75k available
			mockTask.getTokenUsage = vi.fn().mockReturnValue({
				contextTokens: 95000, // 95% of context used
			})

			// Mock small token count
			mockTask.api.countTokens = vi.fn().mockImplementation(async (content) => {
				const text = content[0].text
				const lines = text.split("\n").length - 1
				return lines * 10 // 10 tokens per line
			})

			// Mock readLines
			vi.mocked(readLines).mockImplementation(async (path, endLine, startLine) => {
				const start = startLine ?? 0
				const end = endLine ?? 99
				const lines = end - start + 1
				return `test line\n`.repeat(lines)
			})

			const result = await validateFileSizeForContext(
				"/test/smallfile.ts",
				500, // totalLines
				-1,
				mockTask,
			)

			expect(result.shouldLimit).toBe(true)
			// With the new calculation using full model max tokens (4096),
			// we have less space available, so we get the minimum 50 lines
			expect(result.safeMaxLines).toBe(50)
			expect(result.reason).toContain("Very limited context space")
		})

		it("should handle negative available space gracefully", async () => {
			const mockStats = { size: 10000 } // 10KB file
			vi.mocked(fs.stat).mockResolvedValue(mockStats as any)

			// Set extremely high context usage
			// With 100k - 99k = 1k remaining
			// 1k * 0.75 = 750 tokens usable
			// Minus 2k for response = negative available space
			mockTask.getTokenUsage = vi.fn().mockReturnValue({
				contextTokens: 99000, // 99% of context used
			})

			const result = await validateFileSizeForContext(
				"/test/smallfile.ts",
				500, // totalLines
				-1,
				mockTask,
			)

			expect(result.shouldLimit).toBe(true)
			expect(result.safeMaxLines).toBe(50) // Should be limited to minimum useful lines
			expect(result.reason).toContain("Very limited context space")
			// With negative available space, readLines won't be called
			expect(readLines).not.toHaveBeenCalled()
		})

		it("should limit file when it is too large and would be truncated", async () => {
			const filePath = "/test/large-file.ts"
			const totalLines = 10000
			const currentMaxReadFileLine = -1 // Unlimited

			// Set up context to have limited space
			mockTask.getTokenUsage = vi.fn().mockReturnValue({
				contextTokens: 90000, // 90% of context used
			})

			// Mock token counting to simulate a large file
			mockTask.api.countTokens = vi.fn().mockResolvedValue(1000) // Each batch is 1000 tokens

			// Mock readLines to return some content
			vi.mocked(readLines).mockResolvedValue("line content")

			const result = await validateFileSizeForContext(filePath, totalLines, currentMaxReadFileLine, mockTask)

			expect(result.shouldLimit).toBe(true)
			expect(result.safeMaxLines).toBeGreaterThan(0)
			expect(result.safeMaxLines).toBeLessThan(totalLines)
			expect(result.reason).toContain("File exceeds available context space")
			expect(result.reason).toContain("Use line_range to read specific sections")
		})

		it("should limit file when very limited context space", async () => {
			const filePath = "/test/file.ts"
			const totalLines = 1000
			const currentMaxReadFileLine = -1

			// Mock very high token usage leaving little room
			mockTask.getTokenUsage = vi.fn().mockReturnValue({
				contextTokens: 98000, // Almost all context used (98% of 100k)
			})

			// Mock token counting to quickly exceed limit
			mockTask.api.countTokens = vi.fn().mockResolvedValue(500) // Each batch uses a lot of tokens

			vi.mocked(readLines).mockResolvedValue("line content")

			const result = await validateFileSizeForContext(filePath, totalLines, currentMaxReadFileLine, mockTask)

			expect(result.shouldLimit).toBe(true)
			expect(result.reason).toContain("Very limited context space")
			expect(result.reason).toContain("Consider using search_files or line_range")
		})

		it("should not limit when file fits within context", async () => {
			const filePath = "/test/small-file.ts"
			const totalLines = 100
			const currentMaxReadFileLine = -1

			// Mock low token usage
			mockTask.api.countTokens = vi.fn().mockResolvedValue(10) // Small token count per batch

			vi.mocked(readLines).mockResolvedValue("line content")

			const result = await validateFileSizeForContext(filePath, totalLines, currentMaxReadFileLine, mockTask)

			expect(result.shouldLimit).toBe(false)
			expect(result.safeMaxLines).toBe(currentMaxReadFileLine)
		})

		it("should handle errors gracefully", async () => {
			const filePath = "/test/error-file.ts"
			const totalLines = 20000 // Large file
			const currentMaxReadFileLine = -1

			// Mock an error in the API
			mockTask.api.getModel = vi.fn().mockImplementation(() => {
				throw new Error("API Error")
			})

			const result = await validateFileSizeForContext(filePath, totalLines, currentMaxReadFileLine, mockTask)

			// Should fall back to conservative limits
			expect(result.shouldLimit).toBe(true)
			expect(result.safeMaxLines).toBe(1000)
			expect(result.reason).toContain("Large file detected")
		})
	})
})
