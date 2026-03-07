import { EventEmitter } from "node:events"
import * as fs from "node:fs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readStdinIfPiped } from "./piped"

// Mock fs.fstatSync to simulate pipe detection
vi.mock("node:fs", async () => {
	const actual = await vi.importActual("node:fs")
	return {
		...actual,
		fstatSync: vi.fn(),
	}
})

describe("readStdinIfPiped", () => {
	let originalStdin: typeof process.stdin
	let mockStdin: EventEmitter & {
		isTTY?: boolean
		setEncoding: ReturnType<typeof vi.fn>
		resume: ReturnType<typeof vi.fn>
	}

	beforeEach(() => {
		vi.clearAllMocks()
		originalStdin = process.stdin

		// Create a mock stdin
		mockStdin = Object.assign(new EventEmitter(), {
			isTTY: undefined as boolean | undefined,
			setEncoding: vi.fn(),
			resume: vi.fn(),
		})

		// Default: simulate a real pipe (FIFO)
		vi.mocked(fs.fstatSync).mockReturnValue({
			isFIFO: () => true,
			isFile: () => false,
		} as fs.Stats)
	})

	afterEach(() => {
		vi.restoreAllMocks()
		// Restore original stdin
		Object.defineProperty(process, "stdin", {
			value: originalStdin,
			writable: true,
			configurable: true,
		})
	})

	function setTTY(value: boolean | undefined) {
		mockStdin.isTTY = value
		Object.defineProperty(process, "stdin", {
			value: mockStdin,
			writable: true,
			configurable: true,
		})
	}

	function emitData(data: string) {
		mockStdin.emit("data", data)
	}

	function emitEnd() {
		mockStdin.emit("end")
	}

	function emitError(error: Error) {
		mockStdin.emit("error", error)
	}

	describe("TTY detection", () => {
		it("should return null when stdin is a TTY (interactive terminal)", async () => {
			setTTY(true)
			const result = await readStdinIfPiped()
			expect(result).toBeNull()
		})

		it("should attempt to read when stdin is not a TTY (piped input)", async () => {
			setTTY(false)

			const promise = readStdinIfPiped()
			emitEnd()
			const result = await promise

			expect(result).toBe("")
			expect(mockStdin.setEncoding).toHaveBeenCalledWith("utf8")
			expect(mockStdin.resume).toHaveBeenCalled()
		})
	})

	describe("stdin type detection (fstat)", () => {
		it("should return null when stdin is not a FIFO or file (spawned without TTY)", async () => {
			setTTY(false)
			// Simulate a character device or socket (not a pipe)
			vi.mocked(fs.fstatSync).mockReturnValue({
				isFIFO: () => false,
				isFile: () => false,
			} as fs.Stats)

			const result = await readStdinIfPiped()
			expect(result).toBeNull()
		})

		it("should return null when fstatSync throws (detached stdin)", async () => {
			setTTY(false)
			vi.mocked(fs.fstatSync).mockImplementation(() => {
				throw new Error("EBADF: bad file descriptor")
			})

			const result = await readStdinIfPiped()
			expect(result).toBeNull()
		})

		it("should read from stdin when it is a FIFO (pipe)", async () => {
			setTTY(false)
			vi.mocked(fs.fstatSync).mockReturnValue({
				isFIFO: () => true,
				isFile: () => false,
			} as fs.Stats)

			const promise = readStdinIfPiped()
			emitData("piped content")
			emitEnd()
			const result = await promise

			expect(result).toBe("piped content")
		})

		it("should read from stdin when it is a regular file (redirected)", async () => {
			setTTY(false)
			vi.mocked(fs.fstatSync).mockReturnValue({
				isFIFO: () => false,
				isFile: () => true,
			} as fs.Stats)

			const promise = readStdinIfPiped()
			emitData("file content")
			emitEnd()
			const result = await promise

			expect(result).toBe("file content")
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
				expected: "",
				description: "should return empty string for empty input",
			},
			{
				name: "whitespace only",
				input: "   \n  \t  \n   ",
				expected: "",
				description: "should return empty string for whitespace-only input",
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

				const promise = readStdinIfPiped()
				emitData(data)
				emitEnd()
				const result = await promise

				expect(result).toBe(expected)
			})
		})
	})

	describe("error handling", () => {
		it("should return null on stdin error", async () => {
			setTTY(false)

			const promise = readStdinIfPiped()
			emitError(new Error("EAGAIN: resource temporarily unavailable"))
			const result = await promise

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

				const promise = readStdinIfPiped()
				emitData(input)
				emitEnd()
				const result = await promise

				expect(result).toBe(expected)
			})
		})
	})
})
