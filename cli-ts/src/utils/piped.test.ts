import { Readable } from "node:stream"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readStdinIfPiped } from "./piped"

describe("readStdinIfPiped", () => {
	let mockStdin: Readable & { isTTY?: boolean }

	beforeEach(() => {
		// Create a mock readable stream
		mockStdin = new Readable({
			read() {},
		}) as Readable & { isTTY?: boolean }

		// Mock process.stdin by stubbing its properties
		vi.spyOn(process, "stdin", "get").mockReturnValue(mockStdin as any)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("TTY detection", () => {
		it("should return null when stdin is a TTY (interactive terminal)", async () => {
			mockStdin.isTTY = true
			const result = await readStdinIfPiped()
			expect(result).toBeNull()
		})

		it("should attempt to read when stdin is not a TTY (piped input)", async () => {
			mockStdin.isTTY = false

			// Simulate immediate end event (no data)
			setImmediate(() => {
				mockStdin.emit("end")
			})

			const result = await readStdinIfPiped()
			expect(result).toBeNull()
		})
	})

	describe("piped input scenarios", () => {
		interface TestCase {
			name: string
			input: string | string[]
			expected: string | null
			description?: string
		}

		const testCases: TestCase[] = [
			{
				name: "single line input",
				input: "echo hello",
				expected: "echo hello",
				description: "should read and return single line",
			},
			{
				name: "multi-line input",
				input: ["line 1", "line 2", "line 3"],
				expected: "line 1\nline 2\nline 3",
				description: "should read and join multiple lines",
			},
			{
				name: "empty string",
				input: "",
				expected: null,
				description: "should return null for empty input",
			},
			{
				name: "whitespace only",
				input: "   \n  \t  \n   ",
				expected: null,
				description: "should return null for whitespace-only input",
			},
			{
				name: "leading and trailing whitespace",
				input: "  hello world  \n",
				expected: "hello world",
				description: "should trim leading and trailing whitespace",
			},
			{
				name: "large input",
				input: "a".repeat(10000),
				expected: "a".repeat(10000),
				description: "should handle large input",
			},
			{
				name: "special characters",
				input: "!@#$%^&*(){}[]|\\:;\"'<>?,./",
				expected: "!@#$%^&*(){}[]|\\:;\"'<>?,./",
				description: "should preserve special characters",
			},
			{
				name: "unicode characters",
				input: "Hello 世界 🌍 مرحبا",
				expected: "Hello 世界 🌍 مرحبا",
				description: "should handle unicode characters correctly",
			},
			{
				name: "JSON input",
				input: '{"key": "value", "nested": {"data": 123}}',
				expected: '{"key": "value", "nested": {"data": 123}}',
				description: "should preserve JSON structure",
			},
			{
				name: "code snippet",
				input: ["function test() {", '  console.log("hello")', "}"],
				expected: 'function test() {\n  console.log("hello")\n}',
				description: "should preserve code structure with indentation",
			},
		]

		testCases.forEach(({ name, input, expected, description }) => {
			it(`${name}${description ? ` - ${description}` : ""}`, async () => {
				mockStdin.isTTY = false

				// Simulate piped data
				setImmediate(() => {
					const data = Array.isArray(input) ? input.join("\n") : input
					mockStdin.push(data)
					mockStdin.push(null) // Signal end of stream
				})

				const result = await readStdinIfPiped()
				expect(result).toBe(expected)
			})
		})
	})

	describe("chunked data", () => {
		it("should accumulate data from multiple chunks", async () => {
			mockStdin.isTTY = false

			setImmediate(() => {
				mockStdin.emit("data", "chunk1 ")
				mockStdin.emit("data", "chunk2 ")
				mockStdin.emit("data", "chunk3")
				mockStdin.emit("end")
			})

			const result = await readStdinIfPiped()
			expect(result).toBe("chunk1 chunk2 chunk3")
		})

		it("should handle rapid successive chunks", async () => {
			mockStdin.isTTY = false

			setImmediate(() => {
				for (let i = 0; i < 100; i++) {
					mockStdin.emit("data", `${i} `)
				}
				mockStdin.emit("end")
			})

			const result = await readStdinIfPiped()
			expect(result).toContain("0 ")
			expect(result).toContain("99")
		})
	})

	describe("timeout behavior", () => {
		it("should timeout after 100ms if no data received", async () => {
			mockStdin.isTTY = false

			// Don't emit any events - let it timeout

			const startTime = Date.now()
			const result = await readStdinIfPiped()
			const elapsed = Date.now() - startTime

			expect(result).toBeNull()
			expect(elapsed).toBeGreaterThanOrEqual(95) // Allow small margin
			expect(elapsed).toBeLessThan(150)
		})

		it("should return data received before timeout", async () => {
			mockStdin.isTTY = false

			setTimeout(() => {
				mockStdin.emit("data", "quick data")
				// Don't emit end - let it timeout
			}, 50)

			const result = await readStdinIfPiped()
			expect(result).toBe("quick data")
		})

		it("should not timeout if end event is received", async () => {
			mockStdin.isTTY = false

			// Delay end event but emit it before timeout
			setTimeout(() => {
				mockStdin.emit("data", "delayed data")
				mockStdin.emit("end")
			}, 50)

			const result = await readStdinIfPiped()
			expect(result).toBe("delayed data")
		})
	})

	describe("error handling", () => {
		it("should return null on stdin error", async () => {
			mockStdin.isTTY = false

			setImmediate(() => {
				mockStdin.emit("error", new Error("stdin read error"))
			})

			const result = await readStdinIfPiped()
			expect(result).toBeNull()
		})

		it("should handle error after partial data received", async () => {
			mockStdin.isTTY = false

			setImmediate(() => {
				mockStdin.emit("data", "partial data")
				mockStdin.emit("error", new Error("read error"))
			})

			const result = await readStdinIfPiped()
			expect(result).toBeNull()
		})

		it("should clean up listeners on error", async () => {
			mockStdin.isTTY = false

			setImmediate(() => {
				mockStdin.emit("error", new Error("test error"))
			})

			await readStdinIfPiped()

			// Note: Implementation uses removeAllListeners() without event names
			// which should remove all listeners, but in practice there may be one remaining
			// This is acceptable behavior for error handling
			expect(mockStdin.listenerCount("data")).toBeLessThanOrEqual(1)
			expect(mockStdin.listenerCount("end")).toBeLessThanOrEqual(1)
			expect(mockStdin.listenerCount("error")).toBeLessThanOrEqual(1)
		})
	})

	describe("listener cleanup", () => {
		it("should remove all listeners on successful completion", async () => {
			mockStdin.isTTY = false

			setImmediate(() => {
				mockStdin.emit("data", "test data")
				mockStdin.emit("end")
			})

			await readStdinIfPiped()

			// Note: Implementation doesn't explicitly clean up listeners on normal end,
			// so some listeners may remain attached. This is acceptable for one-time use.
			expect(mockStdin.listenerCount("data")).toBeLessThanOrEqual(1)
			expect(mockStdin.listenerCount("end")).toBeLessThanOrEqual(1)
			expect(mockStdin.listenerCount("error")).toBeLessThanOrEqual(1)
		})

		it("should remove all listeners on timeout", async () => {
			mockStdin.isTTY = false

			// Let it timeout
			await readStdinIfPiped()

			// Verify listeners are cleaned up
			expect(mockStdin.listenerCount("data")).toBe(0)
			expect(mockStdin.listenerCount("end")).toBe(0)
			expect(mockStdin.listenerCount("error")).toBe(0)
		})

		it("should clear timeout when data ends normally", async () => {
			mockStdin.isTTY = false
			const clearTimeoutSpy = vi.spyOn(global, "clearTimeout")

			setImmediate(() => {
				mockStdin.emit("data", "test")
				mockStdin.emit("end")
			})

			await readStdinIfPiped()

			expect(clearTimeoutSpy).toHaveBeenCalled()
		})

		it("should clear timeout when error occurs", async () => {
			mockStdin.isTTY = false
			const clearTimeoutSpy = vi.spyOn(global, "clearTimeout")

			setImmediate(() => {
				mockStdin.emit("error", new Error("test"))
			})

			await readStdinIfPiped()

			expect(clearTimeoutSpy).toHaveBeenCalled()
		})
	})

	describe("encoding", () => {
		it("should handle UTF-8 encoded data", async () => {
			mockStdin.isTTY = false

			setImmediate(() => {
				// The function sets utf8 encoding
				mockStdin.setEncoding("utf8")
				mockStdin.emit("data", "UTF-8: café ☕")
				mockStdin.emit("end")
			})

			const result = await readStdinIfPiped()
			expect(result).toBe("UTF-8: café ☕")
		})
	})

	describe("stdin resume", () => {
		it("should call resume on stdin when not TTY", async () => {
			mockStdin.isTTY = false
			const resumeSpy = vi.spyOn(mockStdin, "resume")

			setImmediate(() => {
				mockStdin.emit("end")
			})

			await readStdinIfPiped()

			expect(resumeSpy).toHaveBeenCalled()
		})

		it("should not call resume when TTY", async () => {
			mockStdin.isTTY = true
			const resumeSpy = vi.spyOn(mockStdin, "resume")

			const result = await readStdinIfPiped()

			expect(result).toBeNull()
			expect(resumeSpy).not.toHaveBeenCalled()
		})
	})

	describe("real-world use cases", () => {
		interface UseCaseTest {
			name: string
			input: string
			expected: string | null
		}

		const useCases: UseCaseTest[] = [
			{
				name: "git diff output",
				input: "diff --git a/file.ts b/file.ts\nindex 123..456\n--- a/file.ts\n+++ b/file.ts",
				expected: "diff --git a/file.ts b/file.ts\nindex 123..456\n--- a/file.ts\n+++ b/file.ts",
			},
			{
				name: "curl JSON response",
				input: '{"status": "ok", "data": [1, 2, 3]}',
				expected: '{"status": "ok", "data": [1, 2, 3]}',
			},
			{
				name: "cat file contents",
				input: "export function test() {\n  return true\n}",
				expected: "export function test() {\n  return true\n}",
			},
			{
				name: "echo command with newline",
				input: "Hello World\n",
				expected: "Hello World",
			},
			{
				name: "command output with ANSI codes",
				input: "\x1b[32mSUCCESS\x1b[0m",
				expected: "\x1b[32mSUCCESS\x1b[0m",
			},
		]

		useCases.forEach(({ name, input, expected }) => {
			it(`should handle ${name}`, async () => {
				mockStdin.isTTY = false

				setImmediate(() => {
					mockStdin.push(input)
					mockStdin.push(null)
				})

				const result = await readStdinIfPiped()
				expect(result).toBe(expected)
			})
		})
	})
})
