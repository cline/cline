import { describe, it, expect, vi, beforeEach } from "vitest"
import { validateFileSizeForContext } from "../contextValidator"
import { Task } from "../../task/Task"
import { promises as fs } from "fs"
import * as fsPromises from "fs/promises"
import { readPartialContent } from "../../../integrations/misc/read-partial-content"
import * as sharedApi from "../../../shared/api"

vi.mock("fs", () => ({
	promises: {
		stat: vi.fn(),
	},
}))

vi.mock("fs/promises", () => ({
	stat: vi.fn(),
}))

vi.mock("../../../integrations/misc/read-partial-content", () => ({
	readPartialContent: vi.fn(),
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

		// Default readPartialContent mock
		vi.mocked(readPartialContent).mockResolvedValue({
			content: "const test = 'sample content';".repeat(100), // ~2700 chars
			charactersRead: 2700,
			totalCharacters: 2700,
			linesRead: 100,
			totalLines: 100,
			lastLineRead: 100,
		})
	})

	describe("validateFileSizeForContext", () => {
		describe("heuristic skipping", () => {
			it("should skip validation for very small files (< 5KB)", async () => {
				// Mock a tiny file
				vi.mocked(fsPromises.stat).mockResolvedValue({
					size: 3 * 1024, // 3KB
				} as any)

				const result = await validateFileSizeForContext("/test/tiny.ts", 50, -1, mockTask)

				expect(result.shouldLimit).toBe(false)
				expect(result.safeContentLimit).toBe(-1)
				expect(readPartialContent).not.toHaveBeenCalled()
				expect(mockTask.api.countTokens).not.toHaveBeenCalled()
			})

			it("should skip validation for moderate files when context is mostly empty", async () => {
				// Mock a moderate file (80KB)
				vi.mocked(fsPromises.stat).mockResolvedValue({
					size: 80 * 1024, // 80KB
				} as any)

				// Mock low context usage (30% used)
				mockTask.getTokenUsage = vi.fn().mockReturnValue({
					contextTokens: 30000, // 30% of 100k context used
				})

				const result = await validateFileSizeForContext("/test/moderate.ts", 1000, -1, mockTask)

				expect(result.shouldLimit).toBe(false)
				expect(result.safeContentLimit).toBe(-1)
				expect(readPartialContent).not.toHaveBeenCalled()
				expect(mockTask.api.countTokens).not.toHaveBeenCalled()
			})

			it("should perform validation for large files even with empty context", async () => {
				// Mock a large file (500KB)
				vi.mocked(fsPromises.stat).mockResolvedValue({
					size: 500 * 1024, // 500KB
				} as any)

				// Mock low context usage
				mockTask.getTokenUsage = vi.fn().mockReturnValue({
					contextTokens: 10000, // 10% of context used
				})

				const result = await validateFileSizeForContext("/test/large.ts", 5000, -1, mockTask)

				// Should perform validation (not skip)
				expect(readPartialContent).toHaveBeenCalled()
			})
		})

		describe("character-based estimation", () => {
			it("should allow files that fit within estimated safe characters", async () => {
				// Mock a file that fits within estimated safe chars
				// Context: 100k window, 10k used = 90k remaining
				// With 25% buffer: 90k * 0.75 = 67.5k usable
				// Minus 4096 for response = ~63.4k available
				// Target limit = 63.4k * 0.9 ≈ 57k tokens
				// Estimated safe chars = 57k * 3 = 171k chars
				const fileSizeBytes = 150 * 1024 // 150KB - under 171k chars
				vi.mocked(fsPromises.stat).mockResolvedValue({
					size: fileSizeBytes,
				} as any)

				const result = await validateFileSizeForContext("/test/fits.ts", 1000, -1, mockTask)

				expect(result.shouldLimit).toBe(false)
				expect(result.safeContentLimit).toBe(-1)
				expect(readPartialContent).not.toHaveBeenCalled()
			})

			it("should validate files that exceed estimated safe characters", async () => {
				// Mock a file that exceeds estimated safe chars (>171k)
				const fileSizeBytes = 200 * 1024 // 200KB
				vi.mocked(fsPromises.stat).mockResolvedValue({
					size: fileSizeBytes,
				} as any)

				// Mock readPartialContent to return content that fits after validation
				const content = "const test = 'content';".repeat(5000) // ~100k chars
				vi.mocked(readPartialContent).mockResolvedValue({
					content,
					charactersRead: content.length,
					totalCharacters: fileSizeBytes,
					linesRead: 5000,
					totalLines: 10000,
					lastLineRead: 5000,
				})

				// Mock token count to be under limit
				mockTask.api.countTokens = vi.fn().mockResolvedValue(30000) // Under ~57k limit

				const result = await validateFileSizeForContext("/test/exceeds.ts", 10000, -1, mockTask)

				expect(readPartialContent).toHaveBeenCalled()
				expect(mockTask.api.countTokens).toHaveBeenCalled()
				// Since we read the entire file content and it fits, no limitation
				expect(result.shouldLimit).toBe(true) // Actually gets limited because we didn't read the full file
				expect(result.safeContentLimit).toBeGreaterThan(0)
			})
		})

		describe("content validation and cutback", () => {
			it("should apply cutback when content exceeds token limit", async () => {
				const fileSizeBytes = 300 * 1024 // 300KB
				vi.mocked(fsPromises.stat).mockResolvedValue({
					size: fileSizeBytes,
				} as any)

				// Mock readPartialContent to return large content
				const largeContent = "const test = 'content';".repeat(10000) // ~200k chars
				vi.mocked(readPartialContent).mockResolvedValue({
					content: largeContent,
					charactersRead: largeContent.length,
					totalCharacters: 300000,
					linesRead: 10000,
					totalLines: 10000,
					lastLineRead: 10000,
				})

				// Mock token count to exceed limit on first call, then fit after cutback
				let callCount = 0
				mockTask.api.countTokens = vi.fn().mockImplementation(async (content) => {
					callCount++
					const text = content[0].text
					if (callCount === 1) {
						return 70000 // Exceeds ~57k limit
					}
					// After 20% cutback
					return 45000 // Now fits
				})

				const result = await validateFileSizeForContext("/test/cutback.ts", 10000, -1, mockTask)

				expect(mockTask.api.countTokens).toHaveBeenCalledTimes(2)
				expect(result.shouldLimit).toBe(true)
				expect(result.safeContentLimit).toBeGreaterThan(0)
				expect(result.safeContentLimit).toBeLessThan(largeContent.length)
				expect(result.reason).toContain("File exceeds available context space")
			})

			it("should handle multiple cutbacks until content fits", async () => {
				const fileSizeBytes = 500 * 1024 // 500KB
				vi.mocked(fsPromises.stat).mockResolvedValue({
					size: fileSizeBytes,
				} as any)

				const largeContent = "const test = 'content';".repeat(15000) // ~300k chars
				vi.mocked(readPartialContent).mockResolvedValue({
					content: largeContent,
					charactersRead: largeContent.length,
					totalCharacters: 500000,
					linesRead: 15000,
					totalLines: 15000,
					lastLineRead: 15000,
				})

				// Mock token count to require multiple cutbacks
				let callCount = 0
				mockTask.api.countTokens = vi.fn().mockImplementation(async (content) => {
					callCount++
					const text = content[0].text
					if (callCount <= 2) {
						return 70000 // Still exceeds limit
					}
					return 40000 // Finally fits
				})

				const result = await validateFileSizeForContext("/test/multiple-cutback.ts", 15000, -1, mockTask)

				expect(mockTask.api.countTokens).toHaveBeenCalledTimes(3)
				expect(result.shouldLimit).toBe(true)
				expect(result.safeContentLimit).toBeGreaterThan(0)
			})
		})

		describe("large file optimization", () => {
			it("should skip tokenizer for files > 1MB and apply clean cutback", async () => {
				const fileSizeBytes = 2 * 1024 * 1024 // 2MB
				vi.mocked(fsPromises.stat).mockResolvedValue({
					size: fileSizeBytes,
				} as any)

				const largeContent = "const test = 'content';".repeat(20000) // ~400k chars
				vi.mocked(readPartialContent).mockResolvedValue({
					content: largeContent,
					charactersRead: largeContent.length,
					totalCharacters: 2000000,
					linesRead: 20000,
					totalLines: 20000,
					lastLineRead: 20000,
				})

				const result = await validateFileSizeForContext("/test/huge.ts", 20000, -1, mockTask)

				// Should not call tokenizer for large files
				expect(mockTask.api.countTokens).not.toHaveBeenCalled()
				expect(result.shouldLimit).toBe(true)
				// Should apply 20% cutback: 400k * 0.8 = 320k chars
				expect(result.safeContentLimit).toBe(Math.floor(largeContent.length * 0.8))
			})
		})

		describe("limited context scenarios", () => {
			it("should handle very limited context space", async () => {
				// Mock high context usage (95% used)
				mockTask.getTokenUsage = vi.fn().mockReturnValue({
					contextTokens: 95000, // 95% of 100k context used
				})

				const fileSizeBytes = 100 * 1024 // 100KB
				vi.mocked(fsPromises.stat).mockResolvedValue({
					size: fileSizeBytes,
				} as any)

				const content = "const test = 'content';".repeat(1000) // ~20k chars
				vi.mocked(readPartialContent).mockResolvedValue({
					content,
					charactersRead: content.length,
					totalCharacters: 100000,
					linesRead: 1000,
					totalLines: 1000,
					lastLineRead: 1000,
				})

				// Mock token count to exceed the very limited space
				mockTask.api.countTokens = vi.fn().mockResolvedValue(10000) // Exceeds available space

				const result = await validateFileSizeForContext("/test/limited.ts", 1000, -1, mockTask)

				expect(result.shouldLimit).toBe(true)
				// The actual implementation applies cutback, so we get a reduced amount, not MIN_USEFUL_CHARS
				expect(result.safeContentLimit).toBeGreaterThan(1000)
				expect(result.reason).toContain("File exceeds available context space")
			})

			it("should handle negative available space gracefully", async () => {
				// Mock extremely high context usage (99% used)
				mockTask.getTokenUsage = vi.fn().mockReturnValue({
					contextTokens: 99000, // 99% of context used
				})

				const fileSizeBytes = 50 * 1024 // 50KB
				vi.mocked(fsPromises.stat).mockResolvedValue({
					size: fileSizeBytes,
				} as any)

				const result = await validateFileSizeForContext("/test/no-space.ts", 500, -1, mockTask)

				expect(result.shouldLimit).toBe(true)
				expect(result.safeContentLimit).toBe(1000) // MIN_USEFUL_CHARS
				expect(result.reason).toContain("Very limited context space")
			})
		})

		describe("error handling", () => {
			it("should handle API errors gracefully", async () => {
				// Mock a large file to trigger error handling
				vi.mocked(fsPromises.stat).mockResolvedValue({
					size: 2 * 1024 * 1024, // 2MB - large file
				} as any)

				// Mock API error
				mockTask.api.getModel = vi.fn().mockImplementation(() => {
					throw new Error("API Error")
				})

				const result = await validateFileSizeForContext("/test/error.ts", 1000, -1, mockTask)

				expect(result.shouldLimit).toBe(true)
				expect(result.safeContentLimit).toBeGreaterThan(0)
				expect(result.reason).toContain("Large file detected")
			})

			it("should handle file stat errors", async () => {
				// Mock file stat error
				vi.mocked(fsPromises.stat).mockRejectedValue(new Error("File not found"))

				// Mock API error to trigger error handling path
				mockTask.api.getModel = vi.fn().mockImplementation(() => {
					throw new Error("API Error")
				})

				const result = await validateFileSizeForContext("/test/missing.ts", 1000, -1, mockTask)

				expect(result.shouldLimit).toBe(true)
				expect(result.safeContentLimit).toBe(10000) // Ultra-safe fallback
				expect(result.reason).toContain("Unable to determine file size")
			})

			it("should handle readPartialContent errors", async () => {
				const fileSizeBytes = 2 * 1024 * 1024 // 2MB - large file to trigger validation
				vi.mocked(fsPromises.stat).mockResolvedValue({
					size: fileSizeBytes,
				} as any)

				// Mock high context usage to prevent heuristic skipping
				mockTask.getTokenUsage = vi.fn().mockReturnValue({
					contextTokens: 80000, // 80% of context used - prevents skipping
				})

				// Mock readPartialContent to fail
				vi.mocked(readPartialContent).mockRejectedValue(new Error("Read error"))

				const result = await validateFileSizeForContext("/test/read-error.ts", 1000, -1, mockTask)

				// When readPartialContent fails, it falls back to error handling
				expect(result.shouldLimit).toBe(true)
				expect(result.safeContentLimit).toBe(50000) // Conservative fallback for large files
				expect(result.reason).toContain("Large file detected")
			})
		})

		describe("edge cases", () => {
			it("should handle empty files", async () => {
				vi.mocked(fsPromises.stat).mockResolvedValue({
					size: 0,
				} as any)

				const result = await validateFileSizeForContext("/test/empty.ts", 0, -1, mockTask)

				expect(result.shouldLimit).toBe(false)
				expect(result.safeContentLimit).toBe(-1)
			})

			it("should handle files that exactly match the limit", async () => {
				// Calculate exact estimated safe chars
				// 100k - 10k = 90k remaining, 90k * 0.75 = 67.5k usable
				// 67.5k - 4096 = ~63.4k available, 63.4k * 0.9 = ~57k target
				// 57k * 3 = 171k estimated safe chars
				const exactSize = Math.floor(57000 * 3) // Exactly at the limit
				vi.mocked(fsPromises.stat).mockResolvedValue({
					size: exactSize,
				} as any)

				const result = await validateFileSizeForContext("/test/exact.ts", 1000, -1, mockTask)

				expect(result.shouldLimit).toBe(false)
				expect(result.safeContentLimit).toBe(-1)
			})

			it("should handle single-character files", async () => {
				vi.mocked(fsPromises.stat).mockResolvedValue({
					size: 1,
				} as any)

				const result = await validateFileSizeForContext("/test/single-char.ts", 1, -1, mockTask)

				expect(result.shouldLimit).toBe(false)
				expect(result.safeContentLimit).toBe(-1)
			})
		})

		describe("return value validation", () => {
			it("should always return character counts in safeContentLimit", async () => {
				const fileSizeBytes = 300 * 1024 // 300KB
				vi.mocked(fsPromises.stat).mockResolvedValue({
					size: fileSizeBytes,
				} as any)

				const content = "const test = 'content';".repeat(5000) // ~100k chars
				vi.mocked(readPartialContent).mockResolvedValue({
					content,
					charactersRead: content.length,
					totalCharacters: 300000,
					linesRead: 5000,
					totalLines: 5000,
					lastLineRead: 5000,
				})

				mockTask.api.countTokens = vi.fn().mockResolvedValue(70000) // Exceeds limit

				const result = await validateFileSizeForContext("/test/char-count.ts", 5000, -1, mockTask)

				expect(result.shouldLimit).toBe(true)
				expect(typeof result.safeContentLimit).toBe("number")
				expect(result.safeContentLimit).toBeGreaterThan(0)
				// Should be character count, not line count
				expect(result.safeContentLimit).toBeGreaterThan(5000) // More than line count
			})

			it("should return -1 for unlimited files", async () => {
				vi.mocked(fsPromises.stat).mockResolvedValue({
					size: 3 * 1024, // Small file
				} as any)

				const result = await validateFileSizeForContext("/test/unlimited.ts", 100, -1, mockTask)

				expect(result.shouldLimit).toBe(false)
				expect(result.safeContentLimit).toBe(-1)
			})
		})
	})
})
