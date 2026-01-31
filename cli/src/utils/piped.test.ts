import * as fs from "node:fs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readStdinIfPiped } from "./piped"

// Mock the fs module
vi.mock("node:fs", () => ({
	readFileSync: vi.fn(),
}))

describe("readStdinIfPiped", () => {
	const mockReadFileSync = fs.readFileSync as ReturnType<typeof vi.fn>
	let originalIsTTY: boolean | undefined

	beforeEach(() => {
		vi.clearAllMocks()
		originalIsTTY = process.stdin.isTTY
	})

	afterEach(() => {
		vi.restoreAllMocks()
		// Restore original isTTY value
		Object.defineProperty(process.stdin, "isTTY", {
			value: originalIsTTY,
			writable: true,
			configurable: true,
		})
	})

	function setTTY(value: boolean | undefined) {
		Object.defineProperty(process.stdin, "isTTY", {
			value,
			writable: true,
			configurable: true,
		})
	}

	describe("TTY detection", () => {
		it("should return null when stdin is a TTY (interactive terminal)", async () => {
			setTTY(true)
			const result = await readStdinIfPiped()
			expect(result).toBeNull()
			expect(mockReadFileSync).not.toHaveBeenCalled()
		})

		it("should attempt to read when stdin is not a TTY (piped input)", async () => {
			setTTY(false)
			mockReadFileSync.mockReturnValue("")

			const result = await readStdinIfPiped()
			expect(result).toBeNull()
			expect(mockReadFileSync).toHaveBeenCalledWith(0, "utf8")
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
				setTTY(false)
				const data = Array.isArray(input) ? input.join("\n") : input
				mockReadFileSync.mockReturnValue(data)

				const result = await readStdinIfPiped()
				expect(result).toBe(expected)
			})
		})
	})

	describe("error handling", () => {
		it("should return null on fs.readFileSync error and fall back to async", async () => {
			setTTY(false)
			mockReadFileSync.mockImplementation(() => {
				throw new Error("EAGAIN: resource temporarily unavailable")
			})

			// The async fallback will timeout since we can't easily mock process.stdin events
			// But we can verify it doesn't throw
			const result = await readStdinIfPiped()
			// Result will be null because async path times out with no data
			expect(result).toBeNull()
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
				setTTY(false)
				mockReadFileSync.mockReturnValue(input)

				const result = await readStdinIfPiped()
				expect(result).toBe(expected)
			})
		})
	})
})
