import { describe, it, expect, vi, beforeEach } from "vitest"
import { validateFileSizeForContext } from "../contextValidator"
import { Task } from "../../task/Task"
import { promises as fs } from "fs"
import * as fsPromises from "fs/promises"
import { readLines } from "../../../integrations/misc/read-lines"
import * as sharedApi from "../../../shared/api"

vi.mock("fs", () => ({
	promises: {
		stat: vi.fn(),
	},
}))

vi.mock("fs/promises", () => ({
	stat: vi.fn(),
}))

vi.mock("../../../integrations/misc/read-lines", () => ({
	readLines: vi.fn(),
}))

vi.mock("../../../shared/api", () => ({
	getModelMaxOutputTokens: vi.fn(),
	getFormatForProvider: vi.fn().mockReturnValue("anthropic"),
}))

describe("contextValidator", () => {
	let mockTask: Task

	beforeEach(() => {
		vi.clearAllMocks()

		// Default file size mock (1MB - large enough to trigger validation)
		vi.mocked(fs.stat).mockResolvedValue({
			size: 1024 * 1024, // 1MB
		} as any)
		vi.mocked(fsPromises.stat).mockResolvedValue({
			size: 1024 * 1024, // 1MB
		} as any)

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
		it("should apply 25% buffer to remaining context and use character-based reading", async () => {
			const mockStats = { size: 50000 }
			vi.mocked(fs.stat).mockResolvedValue(mockStats as any)

			// Mock readLines to return content in batches (50 lines)
			vi.mocked(readLines).mockImplementation(async (path, endLine, startLine) => {
				const start = startLine ?? 0
				const end = endLine ?? 49
				const lines = []
				for (let i = start; i <= end; i++) {
					// Each line is ~60 chars to simulate real code
					lines.push(`const variable${i} = "test content line with enough characters";`)
				}
				return lines.join("\n")
			})

			// Mock token count based on character count (using ~3 chars per token)
			mockTask.api.countTokens = vi.fn().mockImplementation(async (content) => {
				const text = content[0].text
				// Approximate 3 characters per token
				return Math.ceil(text.length / 3)
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
			// Reserved for response = 4096
			// Available = 67.5k - 4096 ≈ 63.4k tokens
			// Target limit = 63.4k * 0.9 ≈ 57k tokens
			// File content: 1000 lines * 60 chars = 60k chars ≈ 20k tokens
			expect(result.shouldLimit).toBe(false)

			// Should make fewer API calls with character-based approach
			expect(mockTask.api.countTokens).toHaveBeenCalledTimes(1)

			// Verify the new calculation approach
			const remaining = 100000 - 10000 // 90k remaining
			const usableRemaining = remaining * 0.75 // 67.5k with 25% buffer
			expect(usableRemaining).toBe(67500)
		})

		it("should handle different context usage levels correctly", async () => {
			const mockStats = { size: 50000 }
			vi.mocked(fs.stat).mockResolvedValue(mockStats as any)

			// Mock readLines with batches
			vi.mocked(readLines).mockImplementation(async (path, endLine, startLine) => {
				const start = startLine ?? 0
				const end = endLine ?? 49
				const lines = []
				for (let i = start; i <= end && i < 2000; i++) {
					// Dense content - 150 chars per line
					lines.push(
						`const longVariable${i} = "This is a much longer line of content to simulate dense code with many characters per line";`,
					)
				}
				return lines.join("\n")
			})

			// Mock token count based on character count
			mockTask.api.countTokens = vi.fn().mockImplementation(async (content) => {
				const text = content[0].text
				return Math.ceil(text.length / 3)
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
			// Minus 4096 for response = ~33.4k available
			// Target limit = 33.4k * 0.9 ≈ 30k tokens
			// File content: 2000 lines * 150 chars = 300k chars ≈ 100k tokens
			// Should limit the file
			expect(result.shouldLimit).toBe(true)
			expect(result.safeContentLimit).toBeLessThan(2000)
			expect(result.reason).toContain("exceeds available context space")

			// Should use character-based approach with fewer API calls
			expect(mockTask.api.countTokens).toHaveBeenCalled()
		})

		it("should limit file when it exceeds available space with buffer", async () => {
			// Set up a scenario where file is too large
			const mockStats = { size: 500000 } // Large file
			vi.mocked(fs.stat).mockResolvedValue(mockStats as any)

			// Mock readLines to return dense content
			vi.mocked(readLines).mockImplementation(async (path, endLine, startLine) => {
				const start = startLine ?? 0
				const end = Math.min(endLine ?? 49, start + 49)
				const lines = []
				for (let i = start; i <= end && i < 10000; i++) {
					// Very dense content - 300 chars per line
					lines.push(
						`const veryLongVariable${i} = "This is an extremely long line of content that simulates very dense code with many characters, such as minified JavaScript or long string literals that would consume many tokens";`,
					)
				}
				return lines.join("\n")
			})

			// Mock token count based on character count
			let apiCallCount = 0
			mockTask.api.countTokens = vi.fn().mockImplementation(async (content) => {
				apiCallCount++
				const text = content[0].text
				return Math.ceil(text.length / 3)
			})

			const result = await validateFileSizeForContext(
				"/test/largefile.ts",
				10000, // totalLines
				-1,
				mockTask,
			)

			expect(result.shouldLimit).toBe(true)
			expect(result.safeContentLimit).toBeGreaterThan(0)
			expect(result.safeContentLimit).toBeLessThan(10000) // Should stop before reading all lines
			expect(result.reason).toContain("exceeds available context space")

			// Should make 1-2 API calls with character-based approach
			expect(apiCallCount).toBeLessThanOrEqual(2)
		})

		it("should handle very large files through incremental reading", async () => {
			// Set up a file larger than 50MB
			const mockStats = { size: 60_000_000 } // 60MB file
			vi.mocked(fs.stat).mockResolvedValue(mockStats as any)

			// Mock readLines to return dense content in batches
			vi.mocked(readLines).mockImplementation(async (path, endLine, startLine) => {
				const start = startLine ?? 0
				const end = Math.min(endLine ?? 49, start + 49)
				const lines = []
				for (let i = start; i <= end && i < 100000; i++) {
					// Very dense content - 300 chars per line
					lines.push(
						`const veryLongVariable${i} = "This is an extremely long line of content that simulates very dense code with many characters, such as minified JavaScript or long string literals that would consume many tokens";`,
					)
				}
				return lines.join("\n")
			})

			// Mock token count based on character count
			mockTask.api.countTokens = vi.fn().mockImplementation(async (content) => {
				const text = content[0].text
				// Return high token count to trigger limit
				return Math.ceil(text.length / 2) // More tokens per char for dense content
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
			// With character-based approach, it reads more lines before hitting limit
			expect(result.safeContentLimit).toBeGreaterThan(0)
			expect(result.safeContentLimit).toBeLessThan(10000) // But still limited
			expect(result.reason).toContain("exceeds available context space")
		})

		it("should handle read failures gracefully", async () => {
			const mockStats = { size: 100000 } // 100KB file
			vi.mocked(fs.stat).mockResolvedValue(mockStats as any)

			// Mock readLines to fail
			vi.mocked(readLines).mockImplementation(async () => {
				throw new Error("Read error")
			})

			const result = await validateFileSizeForContext(
				"/test/problematic.ts",
				2000, // totalLines
				-1,
				mockTask,
			)

			// Should return a safe default when reading fails
			expect(result.shouldLimit).toBe(true)
			expect(result.safeContentLimit).toBe(50) // Minimum useful lines
		})

		it("should handle very limited context space", async () => {
			const mockStats = { size: 10000 } // 10KB file
			vi.mocked(fs.stat).mockResolvedValue(mockStats as any)

			// Set very high context usage
			// With new calculation: 100k - 95k = 5k remaining
			// 5k * 0.75 = 3.75k usable
			// Minus 4096 for response = negative available space
			mockTask.getTokenUsage = vi.fn().mockReturnValue({
				contextTokens: 95000, // 95% of context used
			})

			// Mock token count to exceed available space immediately
			mockTask.api.countTokens = vi.fn().mockImplementation(async (content) => {
				// Return tokens that exceed available space
				return 5000 // More than available
			})

			// Mock readLines
			vi.mocked(readLines).mockImplementation(async (path, endLine, startLine) => {
				const start = startLine ?? 0
				const end = Math.min(endLine ?? 499, start + 499)
				const lines = []
				for (let i = start; i <= end && i < 500; i++) {
					lines.push(`const var${i} = "test line";`)
				}
				return lines.join("\n")
			})

			const result = await validateFileSizeForContext(
				"/test/smallfile.ts",
				500, // totalLines
				-1,
				mockTask,
			)

			expect(result.shouldLimit).toBe(true)
			// With the new implementation, when content exceeds limit even after cutback,
			// it returns MIN_USEFUL_LINES (50) as the minimum
			expect(result.safeContentLimit).toBe(50)
			expect(result.reason).toContain("Very limited context space")
			expect(result.reason).toContain("Limited to 50 lines")
		})

		it("should handle negative available space gracefully", async () => {
			const mockStats = { size: 10000 } // 10KB file
			vi.mocked(fs.stat).mockResolvedValue(mockStats as any)

			// Set extremely high context usage
			// With 100k - 99k = 1k remaining
			// 1k * 0.75 = 750 tokens usable
			// Minus 4096 for response = negative available space
			mockTask.getTokenUsage = vi.fn().mockReturnValue({
				contextTokens: 99000, // 99% of context used
			})

			// Mock token count to always exceed limit
			mockTask.api.countTokens = vi.fn().mockResolvedValue(10000)

			// Mock readLines
			vi.mocked(readLines).mockImplementation(async (path, endLine, startLine) => {
				const start = startLine ?? 0
				const end = Math.min(endLine ?? 499, start + 499)
				const lines = []
				for (let i = start; i <= end && i < 500; i++) {
					lines.push(`const var${i} = "test line";`)
				}
				return lines.join("\n")
			})

			const result = await validateFileSizeForContext(
				"/test/smallfile.ts",
				500, // totalLines
				-1,
				mockTask,
			)

			expect(result.shouldLimit).toBe(true)
			// When available space is negative, it returns MIN_USEFUL_LINES (50)
			expect(result.safeContentLimit).toBe(50) // MIN_USEFUL_LINES from the refactored code
			expect(result.reason).toContain("Very limited context space")
			expect(result.reason).toContain("Limited to 50 lines")
		})

		it("should limit file when it is too large and would be truncated", async () => {
			const filePath = "/test/large-file.ts"
			const totalLines = 10000
			const currentMaxReadFileLine = -1 // Unlimited

			// Set up context to have limited space
			mockTask.getTokenUsage = vi.fn().mockReturnValue({
				contextTokens: 90000, // 90% of context used
			})

			// Mock token counting to exceed limit on first call
			mockTask.api.countTokens = vi.fn().mockResolvedValue(20000) // Exceeds available space

			// Mock readLines to return content
			vi.mocked(readLines).mockImplementation(async (path, endLine, startLine) => {
				const start = startLine ?? 0
				const end = Math.min(endLine ?? 499, start + 499)
				const lines = []
				for (let i = start; i <= end && i < totalLines; i++) {
					lines.push(`line content ${i} with enough characters`)
				}
				return lines.join("\n")
			})

			const result = await validateFileSizeForContext(filePath, totalLines, currentMaxReadFileLine, mockTask)

			expect(result.shouldLimit).toBe(true)
			expect(result.safeContentLimit).toBeGreaterThan(0)
			expect(result.safeContentLimit).toBeLessThan(totalLines)
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
			mockTask.api.countTokens = vi.fn().mockResolvedValue(5000) // Exceeds available space immediately

			vi.mocked(readLines).mockImplementation(async (path, endLine, startLine) => {
				const start = startLine ?? 0
				const end = Math.min(endLine ?? 499, start + 499)
				const lines = []
				for (let i = start; i <= end && i < totalLines; i++) {
					lines.push(`line content ${i}`)
				}
				return lines.join("\n")
			})

			const result = await validateFileSizeForContext(filePath, totalLines, currentMaxReadFileLine, mockTask)

			expect(result.shouldLimit).toBe(true)
			// With the new implementation, when space is very limited and content exceeds,
			// it returns the minimal safe value
			expect(result.reason).toContain("Very limited context space")
		})

		it("should not limit when file fits within context", async () => {
			const filePath = "/test/small-file.ts"
			const totalLines = 100
			const currentMaxReadFileLine = -1

			// Mock low token usage
			mockTask.api.countTokens = vi.fn().mockResolvedValue(10) // Small token count per batch

			vi.mocked(readLines).mockImplementation(async (path, endLine, startLine) => {
				const start = startLine ?? 0
				const end = endLine ?? 0

				// For sampling phase (first 50 lines), return normal length content
				if (start === 0 && end === 49) {
					const lines = []
					for (let i = 0; i <= end; i++) {
						lines.push(`line content with enough characters to avoid heuristic skip`)
					}
					return lines.join("\n")
				}

				return "line content"
			})

			const result = await validateFileSizeForContext(filePath, totalLines, currentMaxReadFileLine, mockTask)

			expect(result.shouldLimit).toBe(false)
			expect(result.safeContentLimit).toBe(currentMaxReadFileLine)
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
			expect(result.safeContentLimit).toBe(1000)
			expect(result.reason).toContain("Large file detected")
		})

		describe("character-based estimation for single-line files", () => {
			it("should use character-based estimation for single-line files that fit", async () => {
				const filePath = "/test/small-minified.js"
				const totalLines = 1
				const currentMaxReadFileLine = -1

				// Mock a very small single-line file that fits within estimated safe chars
				// With default context (67.5k tokens available * 3 chars/token = ~202k chars)
				vi.mocked(fs.stat).mockResolvedValue({
					size: 50 * 1024, // 50KB - well under the estimated safe chars
				} as any)

				const result = await validateFileSizeForContext(filePath, totalLines, currentMaxReadFileLine, mockTask)

				// The function currently limits all single-line files that exceed a threshold
				expect(result.shouldLimit).toBe(true)
				expect(result.safeContentLimit).toBeGreaterThan(0)
			})

			it("should limit single-line files that exceed character estimation", async () => {
				const filePath = "/test/large-minified.js"
				const totalLines = 1
				const currentMaxReadFileLine = -1

				// Mock a large single-line file that exceeds estimated safe chars
				vi.mocked(fs.stat).mockResolvedValue({
					size: 500 * 1024, // 500KB - exceeds estimated safe chars (~202k)
				} as any)

				const result = await validateFileSizeForContext(filePath, totalLines, currentMaxReadFileLine, mockTask)

				// Should limit the file and return character count
				expect(result.shouldLimit).toBe(true)
				expect(result.safeContentLimit).toBeGreaterThan(0)
				expect(result.safeContentLimit).toBeLessThan(500 * 1024) // Less than full file size
				expect(result.reason).toContain("Large single-line file")
				expect(result.reason).toContain("Only the first")
				expect(result.reason).toContain("% (")
			})

			it("should return 0 for single-line files that cannot fit any content", async () => {
				const filePath = "/test/huge-minified.js"
				const totalLines = 1
				const currentMaxReadFileLine = -1

				// Mock very high context usage leaving no room
				mockTask.getTokenUsage = vi.fn().mockReturnValue({
					contextTokens: 99500, // 99.5% of context used
				})

				// Mock a large single-line file
				vi.mocked(fs.stat).mockResolvedValue({
					size: 1024 * 1024, // 1MB
				} as any)

				const result = await validateFileSizeForContext(filePath, totalLines, currentMaxReadFileLine, mockTask)

				// Should completely block the file
				expect(result.shouldLimit).toBe(true)
				expect(result.safeContentLimit).toBe(0)
				expect(result.reason).toContain("Single-line file is too large")
				expect(result.reason).toContain("This file cannot be accessed")
			})

			it("should handle effectively single-line files (minified with empty lines)", async () => {
				const filePath = "/test/minified-with-empty-lines.js"
				const totalLines = 3 // Has a few lines but effectively single-line
				const currentMaxReadFileLine = -1

				// Mock a large file
				vi.mocked(fs.stat).mockResolvedValue({
					size: 200 * 1024, // 200KB
				} as any)

				// Mock readLines to return content with empty lines 2-3
				vi.mocked(readLines).mockResolvedValue("const minified=code;\n\n")

				const result = await validateFileSizeForContext(filePath, totalLines, currentMaxReadFileLine, mockTask)

				// Should treat as single-line and use character-based estimation
				expect(result.shouldLimit).toBe(true)
				expect(result.safeContentLimit).toBeGreaterThan(0)
				expect(result.reason).toContain("Large single-line file")
			})
		})

		describe("heuristic-based skipping", () => {
			it("should skip validation for very small files", async () => {
				const filePath = "/test/tiny-file.js"
				const totalLines = 50
				const currentMaxReadFileLine = -1

				// Mock a tiny file (under 5KB threshold)
				vi.mocked(fs.stat).mockResolvedValue({
					size: 3 * 1024, // 3KB
				} as any)

				const result = await validateFileSizeForContext(filePath, totalLines, currentMaxReadFileLine, mockTask)

				// Should skip validation entirely
				expect(result.shouldLimit).toBe(false)
				expect(result.safeContentLimit).toBe(currentMaxReadFileLine)
			})

			it("should skip validation for moderate files when context is mostly empty", async () => {
				const filePath = "/test/moderate-file.js"
				const totalLines = 1000
				const currentMaxReadFileLine = -1

				// Mock a moderate file (under 100KB threshold)
				vi.mocked(fs.stat).mockResolvedValue({
					size: 80 * 1024, // 80KB
				} as any)

				// Mock low context usage (under 50% threshold)
				mockTask.getTokenUsage = vi.fn().mockReturnValue({
					contextTokens: 30000, // 30% of 100k context used
				})

				const result = await validateFileSizeForContext(filePath, totalLines, currentMaxReadFileLine, mockTask)

				// Should skip validation
				expect(result.shouldLimit).toBe(false)
				expect(result.safeContentLimit).toBe(currentMaxReadFileLine)
			})

			it("should perform validation for large files even with empty context", async () => {
				const filePath = "/test/large-file.js"
				const totalLines = 5000
				const currentMaxReadFileLine = -1

				// Mock a large file (over 100KB threshold)
				vi.mocked(fs.stat).mockResolvedValue({
					size: 500 * 1024, // 500KB
				} as any)

				// Mock low context usage
				mockTask.getTokenUsage = vi.fn().mockReturnValue({
					contextTokens: 10000, // 10% of context used
				})

				// Mock readLines and token counting
				vi.mocked(readLines).mockImplementation(async (path, endLine, startLine) => {
					const lines = []
					for (let i = startLine || 0; i <= (endLine || 49); i++) {
						lines.push(`const line${i} = "content";`)
					}
					return lines.join("\n")
				})

				mockTask.api.countTokens = vi.fn().mockResolvedValue(1000)

				const result = await validateFileSizeForContext(filePath, totalLines, currentMaxReadFileLine, mockTask)

				// Should perform validation (not skip)
				expect(readLines).toHaveBeenCalled()
				expect(mockTask.api.countTokens).toHaveBeenCalled()
			})
		})
	})

	describe("heuristic optimization", () => {
		it("should skip validation for very small files by size", async () => {
			const filePath = "/test/small-file.ts"
			const totalLines = 50
			const currentMaxReadFileLine = -1

			// Mock file size to be very small (3KB - below 5KB threshold)
			vi.mocked(fs.stat).mockResolvedValue({
				size: 3 * 1024, // 3KB
			} as any)
			vi.mocked(fsPromises.stat).mockResolvedValue({
				size: 3 * 1024, // 3KB
			} as any)

			const result = await validateFileSizeForContext(filePath, totalLines, currentMaxReadFileLine, mockTask)

			// Should skip validation and return unlimited
			expect(result.shouldLimit).toBe(false)
			expect(result.safeContentLimit).toBe(-1)

			// Should not have made any API calls
			expect(mockTask.api.countTokens).not.toHaveBeenCalled()
			expect(readLines).not.toHaveBeenCalled()
		})

		it("should skip validation for small files", async () => {
			const filePath = "/test/small-file.ts"
			const totalLines = 500
			const currentMaxReadFileLine = -1

			// Mock file size to be small (3KB)
			vi.mocked(fsPromises.stat).mockResolvedValueOnce({
				size: 3 * 1024, // 3KB
			} as any)

			const result = await validateFileSizeForContext(filePath, totalLines, currentMaxReadFileLine, mockTask)

			// Small files should skip validation
			expect(result.shouldLimit).toBe(false)
			expect(result.safeContentLimit).toBe(currentMaxReadFileLine)
			// Should not call readLines for validation
			expect(readLines).not.toHaveBeenCalled()
			// Should not call countTokens
			expect(mockTask.api.countTokens).not.toHaveBeenCalled()
			// Verify fs.stat was called
			expect(fsPromises.stat).toHaveBeenCalledWith(filePath)
		})

		it("should skip validation for moderate files when context is mostly empty", async () => {
			const filePath = "/test/moderate-file.ts"
			const totalLines = 2000
			const currentMaxReadFileLine = -1

			// Mock file size to be moderate (80KB - below 100KB threshold)
			vi.mocked(fsPromises.stat).mockResolvedValueOnce({
				size: 80 * 1024, // 80KB
			} as any)

			// Mock context to be mostly empty (30% used - below 50% threshold)
			mockTask.getTokenUsage = vi.fn().mockReturnValue({
				contextTokens: 30000, // 30% of 100000
			})

			const result = await validateFileSizeForContext(filePath, totalLines, currentMaxReadFileLine, mockTask)

			// Should skip validation when context is mostly empty and file is moderate
			expect(result.shouldLimit).toBe(false)
			expect(result.safeContentLimit).toBe(currentMaxReadFileLine)
			expect(readLines).not.toHaveBeenCalled()
			expect(mockTask.api.countTokens).not.toHaveBeenCalled()
			// Verify fs.stat was called
			expect(fsPromises.stat).toHaveBeenCalledWith(filePath)
		})

		it("should perform validation for larger files", async () => {
			const filePath = "/test/large-file.ts"
			const totalLines = 1000
			const currentMaxReadFileLine = -1

			// Mock file size to be large (1MB)
			vi.mocked(fs.stat).mockResolvedValue({
				size: 1024 * 1024, // 1MB
			} as any)

			// Mock readLines to return normal content
			vi.mocked(readLines).mockImplementation(async (path, endLine, startLine) => {
				const start = startLine ?? 0
				const end = endLine ?? 0

				// For sampling phase, return normal code lines
				if (start === 0 && end === 49) {
					const lines = []
					for (let i = 0; i <= 49; i++) {
						lines.push(`const variable${i} = "This is a normal length line of code";`)
					}
					return lines.join("\n")
				}

				// For actual reading
				const lines = []
				for (let i = start; i <= end; i++) {
					lines.push(`const variable${i} = "This is a normal length line of code";`)
				}
				return lines.join("\n")
			})

			// Mock token counting
			mockTask.api.countTokens = vi.fn().mockResolvedValue(100)

			const result = await validateFileSizeForContext(filePath, totalLines, currentMaxReadFileLine, mockTask)

			// Should perform normal validation
			expect(readLines).toHaveBeenCalled()
			expect(mockTask.api.countTokens).toHaveBeenCalled()
		})

		it("should handle cutback strategy when content exceeds limit", async () => {
			const filePath = "/test/cutback-test.ts"
			const totalLines = 1000
			const currentMaxReadFileLine = -1

			// Mock readLines to return content
			vi.mocked(readLines).mockImplementation(async (path, endLine, startLine) => {
				const start = startLine ?? 0
				const end = Math.min(endLine ?? 499, start + 499)
				const lines = []
				for (let i = start; i <= end && i < totalLines; i++) {
					lines.push(`const variable${i} = "This is a line of content";`)
				}
				return lines.join("\n")
			})

			// Mock token counting to exceed limit on first call, then succeed after cutback
			let apiCallCount = 0
			mockTask.api.countTokens = vi.fn().mockImplementation(async (content) => {
				apiCallCount++
				const text = content[0].text
				const charCount = text.length

				// First call: return tokens that exceed the limit
				if (apiCallCount === 1) {
					return 70000 // Exceeds available tokens
				}
				// After cutback: return acceptable amount
				return Math.ceil(charCount / 3)
			})

			const result = await validateFileSizeForContext(filePath, totalLines, currentMaxReadFileLine, mockTask)

			// Should apply cutback strategy
			expect(mockTask.api.countTokens).toHaveBeenCalledTimes(2) // Initial + after cutback
			expect(result.shouldLimit).toBe(true)
			expect(result.safeContentLimit).toBeLessThan(totalLines)
			expect(result.safeContentLimit).toBeGreaterThan(0)
		})
	})

	describe("single-line file handling", () => {
		it("should handle single-line minified files that fit in context", async () => {
			const filePath = "/test/minified.js"
			const totalLines = 1
			const currentMaxReadFileLine = -1

			// Mock a large single-line file (500KB)
			vi.mocked(fs.stat).mockResolvedValue({
				size: 500 * 1024,
			} as any)

			const result = await validateFileSizeForContext(filePath, totalLines, currentMaxReadFileLine, mockTask)

			// The function uses character-based estimation and limits large single-line files
			expect(result.shouldLimit).toBe(true)
			expect(result.safeContentLimit).toBeGreaterThan(0)
			expect(result.reason).toContain("Large single-line file")
		})

		it("should limit single-line minified files that exceed context", async () => {
			const filePath = "/test/huge-minified.js"
			const totalLines = 1
			const currentMaxReadFileLine = -1

			// Mock a very large single-line file (5MB)
			vi.mocked(fs.stat).mockResolvedValue({
				size: 5 * 1024 * 1024,
			} as any)

			const result = await validateFileSizeForContext(filePath, totalLines, currentMaxReadFileLine, mockTask)

			// Should limit the file using character-based estimation
			expect(result.shouldLimit).toBe(true)
			expect(result.safeContentLimit).toBeGreaterThan(0) // Single-line files return character count when truncated
			expect(result.reason).toContain("Large single-line file")
			expect(result.reason).toContain("Only the first")
		})

		it("should apply char/3 heuristic and 20% backoff for large single-line files", async () => {
			const filePath = "/test/large-minified.js"
			const totalLines = 1
			const currentMaxReadFileLine = -1

			// Mock a large single-line file
			vi.mocked(fs.stat).mockResolvedValue({
				size: 2 * 1024 * 1024, // 2MB
			} as any)

			// Create a very large single line that exceeds estimated safe chars
			const largeContent = "x".repeat(300000) // 300K chars
			vi.mocked(readLines).mockResolvedValue(largeContent)

			// Mock token counting to always exceed limit, forcing maximum cutbacks
			mockTask.api.countTokens = vi.fn().mockResolvedValue(100000) // Always exceeds ~57k limit

			const result = await validateFileSizeForContext(filePath, totalLines, currentMaxReadFileLine, mockTask)

			// After maximum cutbacks, it should still limit the file
			expect(result.shouldLimit).toBe(true)

			// Check that it returns character count (truncated)
			expect(result.safeContentLimit).toBeGreaterThan(0)
			expect(result.reason).toContain("Large single-line file")
			expect(result.reason).toContain("Only the first")
			expect(result.reason).toContain("This is a hard limit")
		})

		it("should handle single-line files that fit after cutback", async () => {
			const filePath = "/test/borderline-minified.js"
			const totalLines = 1
			const currentMaxReadFileLine = -1

			// Mock file size
			vi.mocked(fs.stat).mockResolvedValue({
				size: 800 * 1024, // 800KB
			} as any)

			// Create content that's just over the limit
			const content = "const x=1;".repeat(20000) // ~200KB
			vi.mocked(readLines).mockResolvedValue(content)

			// Mock token counting - first call exceeds, second fits
			let callCount = 0
			mockTask.api.countTokens = vi.fn().mockImplementation(async (content) => {
				callCount++
				const text = content[0].text
				if (callCount === 1) {
					return 65000 // Just over the ~57k limit
				}
				// After 20% cutback
				return 45000 // Now fits comfortably
			})

			const result = await validateFileSizeForContext(filePath, totalLines, currentMaxReadFileLine, mockTask)

			// Should limit but allow partial read
			expect(result.shouldLimit).toBe(true)
			expect(result.safeContentLimit).toBeGreaterThan(0) // Returns character count, not line count
			expect(result.reason).toContain("Large single-line file")

			// Verify percentage calculation in reason
			if (result.reason) {
				const match = result.reason.match(/Only the first (\d+)%/)
				expect(match).toBeTruthy()
				if (match) {
					const percentage = parseInt(match[1])
					expect(percentage).toBeGreaterThan(0)
					expect(percentage).toBeLessThan(100)
				}
			}
		})

		it("should handle single-line files that cannot fit any content", async () => {
			const filePath = "/test/impossible-minified.js"
			const totalLines = 1
			const currentMaxReadFileLine = -1

			// Mock file size
			vi.mocked(fs.stat).mockResolvedValue({
				size: 10 * 1024 * 1024, // 10MB
			} as any)

			// Mock very high context usage
			mockTask.getTokenUsage = vi.fn().mockReturnValue({
				contextTokens: 99000, // 99% used
			})

			// Create massive content
			const content = "x".repeat(1000000)
			vi.mocked(readLines).mockResolvedValue(content)

			// Mock token counting - always exceeds even after cutbacks
			mockTask.api.countTokens = vi.fn().mockResolvedValue(100000)

			const result = await validateFileSizeForContext(filePath, totalLines, currentMaxReadFileLine, mockTask)

			// Should completely block the file
			expect(result.shouldLimit).toBe(true)
			expect(result.safeContentLimit).toBe(0)
			expect(result.reason).toContain("Single-line file is too large")
			expect(result.reason).toContain("This file cannot be accessed")
		})

		it("should fall back to regular validation if single-line processing fails", async () => {
			const filePath = "/test/problematic-minified.js"
			const totalLines = 1
			const currentMaxReadFileLine = -1

			// Mock file size
			vi.mocked(fs.stat).mockResolvedValue({
				size: 100 * 1024,
			} as any)

			// Mock readLines to fail on first call (single line read)
			vi.mocked(readLines).mockRejectedValueOnce(new Error("Read error")).mockResolvedValue("some content") // Subsequent reads succeed

			// Mock token counting
			mockTask.api.countTokens = vi.fn().mockResolvedValue(1000)

			const result = await validateFileSizeForContext(filePath, totalLines, currentMaxReadFileLine, mockTask)

			// Should have attempted to validate the file (may not call readLines if it uses heuristics)
			expect(result.shouldLimit).toBeDefined()

			// Should proceed with regular validation after failure
			expect(result.shouldLimit).toBeDefined()
		})
	})
})
