import { describe, test, expect, vi, beforeEach, afterEach } from "vitest"

// Mock i18n system
vi.mock("../../i18n", () => ({
	t: vi.fn((key: string, options?: Record<string, any>) => {
		// Mock the specific translation key used in the code
		if (key === "errors.claudeCode.notFound") {
			const claudePath = options?.claudePath || "claude"
			const installationUrl = options?.installationUrl || "https://docs.anthropic.com/en/docs/claude-code/setup"
			const originalError = options?.originalError || "spawn claude ENOENT"

			return `Claude Code executable '${claudePath}' not found.\n\nPlease install Claude Code CLI:\n1. Visit ${installationUrl} to download Claude Code\n2. Follow the installation instructions for your operating system\n3. Ensure the 'claude' command is available in your PATH\n4. Alternatively, configure a custom path in Roo settings under 'Claude Code Path'\n\nOriginal error: ${originalError}`
		}
		// Return the key as fallback for other translations
		return key
	}),
}))

// Mock os module
vi.mock("os", () => ({
	platform: vi.fn(() => "darwin"), // Default to non-Windows
}))

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
		// Clear module cache to ensure fresh imports
		vi.resetModules()
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

	test("should handle platform-specific stdin behavior", async () => {
		const { runClaudeCode } = await import("../run")
		const messages = [{ role: "user" as const, content: "Hello world!" }]
		const systemPrompt = "You are a helpful assistant"
		const options = {
			systemPrompt,
			messages,
		}

		// Test on Windows
		const os = await import("os")
		vi.mocked(os.platform).mockReturnValue("win32")

		const generator = runClaudeCode(options)
		const results = []
		for await (const chunk of generator) {
			results.push(chunk)
		}

		// On Windows, should NOT have --system-prompt in args
		const [, args] = mockExeca.mock.calls[0]
		expect(args).not.toContain("--system-prompt")

		// Should pass both system prompt and messages via stdin
		const expectedStdinData = JSON.stringify({ systemPrompt, messages })
		expect(mockStdin.write).toHaveBeenCalledWith(expectedStdinData, "utf8", expect.any(Function))

		// Reset mocks for non-Windows test
		vi.clearAllMocks()
		mockExeca.mockReturnValue(createMockProcess())

		// Test on non-Windows
		vi.mocked(os.platform).mockReturnValue("darwin")

		const generator2 = runClaudeCode(options)
		const results2 = []
		for await (const chunk of generator2) {
			results2.push(chunk)
		}

		// On non-Windows, should have --system-prompt in args
		const [, args2] = mockExeca.mock.calls[0]
		expect(args2).toContain("--system-prompt")
		expect(args2).toContain(systemPrompt)

		// Should only pass messages via stdin
		expect(mockStdin.write).toHaveBeenCalledWith(JSON.stringify(messages), "utf8", expect.any(Function))
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

	test("should handle ENOENT errors during process spawn with helpful error message", async () => {
		const { runClaudeCode } = await import("../run")

		// Mock execa to throw ENOENT error
		const enoentError = new Error("spawn claude ENOENT")
		;(enoentError as any).code = "ENOENT"
		mockExeca.mockImplementationOnce(() => {
			throw enoentError
		})

		const options = {
			systemPrompt: "You are a helpful assistant",
			messages: [{ role: "user" as const, content: "Hello" }],
		}

		const generator = runClaudeCode(options)

		// Should throw enhanced ENOENT error
		await expect(generator.next()).rejects.toThrow(/errors\.claudeCode\.notFound/)
	})

	test("should handle ENOENT errors during process execution with helpful error message", async () => {
		const { runClaudeCode } = await import("../run")

		// Create a mock process that emits ENOENT error
		const mockProcessWithError = createMockProcess()
		const enoentError = new Error("spawn claude ENOENT")
		;(enoentError as any).code = "ENOENT"

		mockProcessWithError.on = vi.fn((event, callback) => {
			if (event === "error") {
				// Emit ENOENT error immediately
				callback(enoentError)
			} else if (event === "close") {
				// Don't emit close event in this test
			}
		})

		// Mock readline to not yield any data when there's an error
		const mockReadlineForError = {
			[Symbol.asyncIterator]() {
				return {
					async next() {
						// Don't yield anything - simulate error before any output
						return { done: true, value: undefined }
					},
				}
			},
			close: vi.fn(),
		}

		const readline = await import("readline")
		vi.mocked(readline.default.createInterface).mockReturnValueOnce(mockReadlineForError as any)

		mockExeca.mockReturnValueOnce(mockProcessWithError)

		const options = {
			systemPrompt: "You are a helpful assistant",
			messages: [{ role: "user" as const, content: "Hello" }],
		}

		const generator = runClaudeCode(options)

		// Should throw enhanced ENOENT error
		await expect(generator.next()).rejects.toThrow(/errors\.claudeCode\.notFound/)
	})

	test("should handle ENOENT errors with custom claude path", async () => {
		const { runClaudeCode } = await import("../run")

		const customPath = "/custom/path/to/claude"
		const enoentError = new Error(`spawn ${customPath} ENOENT`)
		;(enoentError as any).code = "ENOENT"
		mockExeca.mockImplementationOnce(() => {
			throw enoentError
		})

		const options = {
			systemPrompt: "You are a helpful assistant",
			messages: [{ role: "user" as const, content: "Hello" }],
			path: customPath,
		}

		const generator = runClaudeCode(options)

		// Should throw enhanced ENOENT error with custom path
		await expect(generator.next()).rejects.toThrow(/errors\.claudeCode\.notFound/)
	})

	test("should preserve non-ENOENT errors during process spawn", async () => {
		const { runClaudeCode } = await import("../run")

		// Mock execa to throw non-ENOENT error
		const otherError = new Error("Permission denied")
		mockExeca.mockImplementationOnce(() => {
			throw otherError
		})

		const options = {
			systemPrompt: "You are a helpful assistant",
			messages: [{ role: "user" as const, content: "Hello" }],
		}

		const generator = runClaudeCode(options)

		// Should throw original error, not enhanced ENOENT error
		await expect(generator.next()).rejects.toThrow("Permission denied")
	})

	test("should preserve non-ENOENT errors during process execution", async () => {
		const { runClaudeCode } = await import("../run")

		// Create a mock process that emits non-ENOENT error
		const mockProcessWithError = createMockProcess()
		const otherError = new Error("Permission denied")

		mockProcessWithError.on = vi.fn((event, callback) => {
			if (event === "error") {
				// Emit non-ENOENT error immediately
				callback(otherError)
			} else if (event === "close") {
				// Don't emit close event in this test
			}
		})

		// Mock readline to not yield any data when there's an error
		const mockReadlineForError = {
			[Symbol.asyncIterator]() {
				return {
					async next() {
						// Don't yield anything - simulate error before any output
						return { done: true, value: undefined }
					},
				}
			},
			close: vi.fn(),
		}

		const readline = await import("readline")
		vi.mocked(readline.default.createInterface).mockReturnValueOnce(mockReadlineForError as any)

		mockExeca.mockReturnValueOnce(mockProcessWithError)

		const options = {
			systemPrompt: "You are a helpful assistant",
			messages: [{ role: "user" as const, content: "Hello" }],
		}

		const generator = runClaudeCode(options)

		// Should throw original error, not enhanced ENOENT error
		await expect(generator.next()).rejects.toThrow("Permission denied")
	})

	test("should prioritize ClaudeCodeNotFoundError over generic exit code errors", async () => {
		const { runClaudeCode } = await import("../run")

		// Create a mock process that emits ENOENT error and then exits with non-zero code
		const mockProcessWithError = createMockProcess()
		const enoentError = new Error("spawn claude ENOENT")
		;(enoentError as any).code = "ENOENT"

		let resolveProcess: (value: { exitCode: number }) => void
		const processPromise = new Promise<{ exitCode: number }>((resolve) => {
			resolveProcess = resolve
		})

		mockProcessWithError.on = vi.fn((event, callback) => {
			if (event === "error") {
				// Emit ENOENT error immediately
				callback(enoentError)
			} else if (event === "close") {
				// Emit non-zero exit code
				setTimeout(() => {
					callback(1)
					resolveProcess({ exitCode: 1 })
				}, 10)
			}
		})

		mockProcessWithError.then = processPromise.then.bind(processPromise)
		mockProcessWithError.catch = processPromise.catch.bind(processPromise)
		mockProcessWithError.finally = processPromise.finally.bind(processPromise)

		// Mock readline to not yield any data when there's an error
		const mockReadlineForError = {
			[Symbol.asyncIterator]() {
				return {
					async next() {
						// Don't yield anything - simulate error before any output
						return { done: true, value: undefined }
					},
				}
			},
			close: vi.fn(),
		}

		const readline = await import("readline")
		vi.mocked(readline.default.createInterface).mockReturnValueOnce(mockReadlineForError as any)

		mockExeca.mockReturnValueOnce(mockProcessWithError)

		const options = {
			systemPrompt: "You are a helpful assistant",
			messages: [{ role: "user" as const, content: "Hello" }],
		}

		const generator = runClaudeCode(options)

		// Should throw ClaudeCodeNotFoundError, not generic exit code error
		await expect(generator.next()).rejects.toThrow(/errors\.claudeCode\.notFound/)
	})
})
