import { describe, test, expect, vi, beforeEach } from "vitest"

// Mock vscode workspace
vi.mock("vscode", () => ({
	workspace: {
		workspaceFolders: [
			{
				uri: {
					fsPath: "/test/workspace",
				},
			},
		],
	},
}))

// Mock execa to test stdin behavior
const mockExeca = vi.fn()
const mockStdin = {
	write: vi.fn((data, encoding, callback) => {
		// Simulate successful write
		if (callback) callback(null)
	}),
	end: vi.fn(),
}

// Mock process that simulates successful execution
const createMockProcess = () => {
	let resolveProcess: (value: { exitCode: number }) => void
	const processPromise = new Promise<{ exitCode: number }>((resolve) => {
		resolveProcess = resolve
	})

	const mockProcess = {
		stdin: mockStdin,
		stdout: {
			on: vi.fn(),
		},
		stderr: {
			on: vi.fn((event, callback) => {
				// Don't emit any stderr data in tests
			}),
		},
		on: vi.fn((event, callback) => {
			if (event === "close") {
				// Simulate successful process completion after a short delay
				setTimeout(() => {
					callback(0)
					resolveProcess({ exitCode: 0 })
				}, 10)
			}
			if (event === "error") {
				// Don't emit any errors in tests
			}
		}),
		killed: false,
		kill: vi.fn(),
		then: processPromise.then.bind(processPromise),
		catch: processPromise.catch.bind(processPromise),
		finally: processPromise.finally.bind(processPromise),
	}
	return mockProcess
}

vi.mock("execa", () => ({
	execa: mockExeca,
}))

// Mock readline with proper interface simulation
let mockReadlineInterface: any = null

vi.mock("readline", () => ({
	default: {
		createInterface: vi.fn(() => {
			mockReadlineInterface = {
				async *[Symbol.asyncIterator]() {
					// Simulate Claude CLI JSON output
					yield '{"type":"text","text":"Hello"}'
					yield '{"type":"text","text":" world"}'
					// Simulate end of stream - must return to terminate the iterator
					return
				},
				close: vi.fn(),
			}
			return mockReadlineInterface
		}),
	},
}))

describe("runClaudeCode", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockExeca.mockReturnValue(createMockProcess())
		// Mock setImmediate to run synchronously in tests
		vi.spyOn(global, "setImmediate").mockImplementation((callback: any) => {
			callback()
			return {} as any
		})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	test("should export runClaudeCode function", async () => {
		const { runClaudeCode } = await import("../run")
		expect(typeof runClaudeCode).toBe("function")
	})

	test("should be an async generator function", async () => {
		const { runClaudeCode } = await import("../run")
		const options = {
			systemPrompt: "You are a helpful assistant",
			messages: [{ role: "user" as const, content: "Hello" }],
		}

		const result = runClaudeCode(options)
		expect(Symbol.asyncIterator in result).toBe(true)
		expect(typeof result[Symbol.asyncIterator]).toBe("function")
	})

	test("should use stdin instead of command line arguments for messages", async () => {
		const { runClaudeCode } = await import("../run")
		const messages = [{ role: "user" as const, content: "Hello world!" }]
		const options = {
			systemPrompt: "You are a helpful assistant",
			messages,
		}

		const generator = runClaudeCode(options)

		// Consume the generator to completion
		const results = []
		for await (const chunk of generator) {
			results.push(chunk)
		}

		// Verify execa was called with correct arguments (no JSON.stringify(messages) in args)
		expect(mockExeca).toHaveBeenCalledWith(
			"claude",
			expect.arrayContaining([
				"-p",
				"--system-prompt",
				"You are a helpful assistant",
				"--verbose",
				"--output-format",
				"stream-json",
				"--disallowedTools",
				expect.any(String),
				"--max-turns",
				"1",
			]),
			expect.objectContaining({
				stdin: "pipe",
				stdout: "pipe",
				stderr: "pipe",
			}),
		)

		// Verify the arguments do NOT contain the stringified messages
		const [, args] = mockExeca.mock.calls[0]
		expect(args).not.toContain(JSON.stringify(messages))

		// Verify messages were written to stdin with callback
		expect(mockStdin.write).toHaveBeenCalledWith(JSON.stringify(messages), "utf8", expect.any(Function))
		expect(mockStdin.end).toHaveBeenCalled()

		// Verify we got the expected mock output
		expect(results).toHaveLength(2)
		expect(results[0]).toEqual({ type: "text", text: "Hello" })
		expect(results[1]).toEqual({ type: "text", text: " world" })
	})

	test("should include model parameter when provided", async () => {
		const { runClaudeCode } = await import("../run")
		const options = {
			systemPrompt: "You are a helpful assistant",
			messages: [{ role: "user" as const, content: "Hello" }],
			modelId: "claude-3-5-sonnet-20241022",
		}

		const generator = runClaudeCode(options)

		// Consume at least one item to trigger process spawn
		await generator.next()

		// Clean up the generator
		await generator.return(undefined)

		const [, args] = mockExeca.mock.calls[0]
		expect(args).toContain("--model")
		expect(args).toContain("claude-3-5-sonnet-20241022")
	})

	test("should use custom claude path when provided", async () => {
		const { runClaudeCode } = await import("../run")
		const options = {
			systemPrompt: "You are a helpful assistant",
			messages: [{ role: "user" as const, content: "Hello" }],
			path: "/custom/path/to/claude",
		}

		const generator = runClaudeCode(options)

		// Consume at least one item to trigger process spawn
		await generator.next()

		// Clean up the generator
		await generator.return(undefined)

		const [claudePath] = mockExeca.mock.calls[0]
		expect(claudePath).toBe("/custom/path/to/claude")
	})

	test("should handle stdin write errors gracefully", async () => {
		const { runClaudeCode } = await import("../run")

		// Create a mock process with stdin that fails
		const mockProcessWithError = createMockProcess()
		mockProcessWithError.stdin.write = vi.fn((data, encoding, callback) => {
			// Simulate write error
			if (callback) callback(new Error("EPIPE: broken pipe"))
		})

		// Mock console.error to verify error logging
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

		mockExeca.mockReturnValueOnce(mockProcessWithError)

		const options = {
			systemPrompt: "You are a helpful assistant",
			messages: [{ role: "user" as const, content: "Hello" }],
		}

		const generator = runClaudeCode(options)

		// Try to consume the generator
		try {
			await generator.next()
		} catch (error) {
			// Expected to fail
		}

		// Verify error was logged
		expect(consoleErrorSpy).toHaveBeenCalledWith("Error writing to Claude Code stdin:", expect.any(Error))

		// Verify process was killed
		expect(mockProcessWithError.kill).toHaveBeenCalled()

		// Clean up
		consoleErrorSpy.mockRestore()
		await generator.return(undefined)
	})

	test("should handle stdin access errors gracefully", async () => {
		const { runClaudeCode } = await import("../run")

		// Create a mock process without stdin
		const mockProcessWithoutStdin = createMockProcess()
		mockProcessWithoutStdin.stdin = null as any

		// Mock console.error to verify error logging
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

		mockExeca.mockReturnValueOnce(mockProcessWithoutStdin)

		const options = {
			systemPrompt: "You are a helpful assistant",
			messages: [{ role: "user" as const, content: "Hello" }],
		}

		const generator = runClaudeCode(options)

		// Try to consume the generator
		try {
			await generator.next()
		} catch (error) {
			// Expected to fail
		}

		// Verify error was logged
		expect(consoleErrorSpy).toHaveBeenCalledWith("Error accessing Claude Code stdin:", expect.any(Error))

		// Verify process was killed
		expect(mockProcessWithoutStdin.kill).toHaveBeenCalled()

		// Clean up
		consoleErrorSpy.mockRestore()
		await generator.return(undefined)
	})
})
