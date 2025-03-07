// npx jest src/integrations/terminal/__tests__/TerminalProcessExec.test.ts

// Mock strip-ansi before any imports that might use it
jest.mock("strip-ansi", () => {
	return function stripAnsi(string: string): string {
		// Simple implementation to remove ANSI escape codes
		return string.replace(/\x1B\[\d+m/g, "")
	}
})

// Mock p-wait-for before any imports that might use it
jest.mock("p-wait-for", () => {
	return function pWaitFor(condition: () => boolean, options?: { timeout?: number }): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			// Simple implementation that resolves immediately for testing
			if (condition()) {
				resolve()
			} else {
				// Simulate timeout after a short delay
				setTimeout(() => {
					reject(new Error("Timeout"))
				}, 10)
			}
		})
	}
})

import * as vscode from "vscode"
import { execSync } from "child_process"
import { TerminalProcess } from "../TerminalProcess"
import { TerminalInfo, TerminalRegistry } from "../TerminalRegistry"
import { TerminalManager, ExitCodeDetails } from "../TerminalManager"

// Mock the vscode module
jest.mock("vscode", () => {
	// Store event handlers so we can trigger them in tests
	const eventHandlers = {
		startTerminalShellExecution: null as ((e: any) => void) | null,
		endTerminalShellExecution: null as ((e: any) => void) | null,
	}

	return {
		window: {
			createTerminal: jest.fn(),
			onDidStartTerminalShellExecution: jest.fn().mockImplementation((handler) => {
				eventHandlers.startTerminalShellExecution = handler
				return { dispose: jest.fn() }
			}),
			onDidEndTerminalShellExecution: jest.fn().mockImplementation((handler) => {
				eventHandlers.endTerminalShellExecution = handler
				return { dispose: jest.fn() }
			}),
		},
		ThemeIcon: class ThemeIcon {
			constructor(id: string) {
				this.id = id
			}
			id: string
		},
		Uri: {
			file: (path: string) => ({ fsPath: path }),
		},
		// Expose event handlers for testing
		__eventHandlers: eventHandlers,
	}
})

// Helper function to interpret exit codes
function interpretExitCode(exitCode: number | undefined): ExitCodeDetails {
	if (exitCode === undefined) {
		return { exitCode }
	}

	if (exitCode <= 128) {
		return { exitCode }
	}

	const signal = exitCode - 128
	const signals: Record<number, string> = {
		// Standard signals
		1: "SIGHUP",
		2: "SIGINT",
		3: "SIGQUIT",
		4: "SIGILL",
		5: "SIGTRAP",
		6: "SIGABRT",
		7: "SIGBUS",
		8: "SIGFPE",
		9: "SIGKILL",
		10: "SIGUSR1",
		11: "SIGSEGV",
		12: "SIGUSR2",
		13: "SIGPIPE",
		14: "SIGALRM",
		15: "SIGTERM",
		16: "SIGSTKFLT",
		17: "SIGCHLD",
		18: "SIGCONT",
		19: "SIGSTOP",
		20: "SIGTSTP",
		21: "SIGTTIN",
		22: "SIGTTOU",
		23: "SIGURG",
		24: "SIGXCPU",
		25: "SIGXFSZ",
		26: "SIGVTALRM",
		27: "SIGPROF",
		28: "SIGWINCH",
		29: "SIGIO",
		30: "SIGPWR",
		31: "SIGSYS",
	}

	// These signals may produce core dumps:
	//   SIGQUIT, SIGILL, SIGABRT, SIGBUS, SIGFPE, SIGSEGV
	const coreDumpPossible = new Set([3, 4, 6, 7, 8, 11])

	return {
		exitCode,
		signal,
		signalName: signals[signal] || `Unknown Signal (${signal})`,
		coreDumpPossible: coreDumpPossible.has(signal),
	}
}

// Create a mock stream that uses real command output with realistic chunking
function createRealCommandStream(command: string): { stream: AsyncIterable<string>; exitCode: number } {
	let realOutput: string
	let exitCode: number

	try {
		// Execute the command and get the real output
		realOutput = execSync(command, {
			encoding: "utf8",
			maxBuffer: 100 * 1024 * 1024, // Increase buffer size to 100MB
		})
		exitCode = 0 // Command succeeded
	} catch (error: any) {
		// Command failed - get output and exit code from error
		realOutput = error.stdout?.toString() || ""

		// Handle signal termination
		if (error.signal) {
			// Convert signal name to number using Node's constants
			const signals: Record<string, number> = {
				SIGTERM: 15,
				SIGSEGV: 11,
				// Add other signals as needed
			}
			const signalNum = signals[error.signal]
			if (signalNum !== undefined) {
				exitCode = 128 + signalNum // Signal exit codes are 128 + signal number
			} else {
				// Log error and default to 1 if signal not recognized
				console.log(`[DEBUG] Unrecognized signal '${error.signal}' from command '${command}'`)
				exitCode = 1
			}
		} else {
			exitCode = error.status || 1 // Use status if available, default to 1
		}
	}

	// Create an async iterator that yields the command output with proper markers
	// and realistic chunking (not guaranteed to split on newlines)
	const stream = {
		async *[Symbol.asyncIterator]() {
			// First yield the command start marker
			yield "\x1b]633;C\x07"

			// Yield the real output in potentially arbitrary chunks
			// This simulates how terminal data might be received in practice
			if (realOutput.length > 0) {
				// For a simple test like "echo a", we'll just yield the whole output
				// For more complex outputs, we could implement random chunking here
				yield realOutput
			}

			// Last yield the command end marker
			yield "\x1b]633;D\x07"
		},
	}

	return { stream, exitCode }
}

/**
 * Generalized function to test terminal command execution
 * @param command The command to execute
 * @param expectedOutput The expected output after processing
 * @returns A promise that resolves when the test is complete
 */
async function testTerminalCommand(
	command: string,
	expectedOutput: string,
): Promise<{ executionTimeUs: number; capturedOutput: string; exitDetails: ExitCodeDetails }> {
	let startTime: bigint = BigInt(0)
	let endTime: bigint = BigInt(0)
	let timeRecorded = false
	// Create a mock terminal with shell integration
	const mockTerminal = {
		shellIntegration: {
			executeCommand: jest.fn(),
			cwd: vscode.Uri.file("/test/path"),
		},
		name: "Cline",
		processId: Promise.resolve(123),
		creationOptions: {},
		exitStatus: undefined,
		state: { isInteractedWith: true },
		dispose: jest.fn(),
		hide: jest.fn(),
		show: jest.fn(),
		sendText: jest.fn(),
	}

	// Create terminal info
	const mockTerminalInfo: TerminalInfo = {
		terminal: mockTerminal,
		busy: false,
		lastCommand: "",
		id: 1,
		running: false,
		streamClosed: false,
	}

	// Add the terminal to the registry
	TerminalRegistry["terminals"] = [mockTerminalInfo]

	// Create a new terminal process
	startTime = process.hrtime.bigint() // Start timing from terminal process creation
	const terminalProcess = new TerminalProcess()

	// Create a terminal manager (this will set up the event handlers)
	const terminalManager = new TerminalManager()

	try {
		// Set up the mock stream with real command output and exit code
		const { stream, exitCode } = createRealCommandStream(command)

		// Configure the mock terminal to return our stream
		mockTerminal.shellIntegration.executeCommand.mockImplementation(() => {
			return {
				read: jest.fn().mockReturnValue(stream),
			}
		})

		// Set up event listeners to capture output
		let capturedOutput = ""
		terminalProcess.on("completed", (output) => {
			if (!timeRecorded) {
				endTime = process.hrtime.bigint() // End timing when completed event is received with output
				timeRecorded = true
			}
			if (output) {
				capturedOutput = output
			}
		})

		// Create a promise that resolves when the command completes
		const completedPromise = new Promise<void>((resolve) => {
			terminalProcess.once("completed", () => {
				resolve()
			})
		})

		// Store the process in the manager's processes map
		// This is needed for the TerminalManager to find the process when events are triggered
		terminalManager["processes"].set(mockTerminalInfo.id, terminalProcess)
		terminalManager["terminalIds"].add(mockTerminalInfo.id)

		// Run the command
		const runPromise = terminalProcess.run(mockTerminal, command)

		// Get the event handlers from the mock
		const eventHandlers = (vscode as any).__eventHandlers

		// Trigger the start terminal shell execution event through VSCode mock
		if (eventHandlers.startTerminalShellExecution) {
			eventHandlers.startTerminalShellExecution({
				terminal: mockTerminal,
				execution: {
					commandLine: { value: command },
					read: () => stream,
				},
			})
		}

		// Wait a short time to ensure stream processing has started
		await new Promise((resolve) => setTimeout(resolve, 100))

		// Trigger the end terminal shell execution event through VSCode mock
		if (eventHandlers.endTerminalShellExecution) {
			eventHandlers.endTerminalShellExecution({
				terminal: mockTerminal,
				exitCode: exitCode,
			})
		}

		// Store exit details for return
		const exitDetails = interpretExitCode(exitCode)

		// Set a timeout to avoid hanging tests
		const timeoutPromise = new Promise<void>((_, reject) => {
			setTimeout(() => {
				reject(new Error("Test timed out after 1000ms"))
			}, 1000)
		})

		// Wait for the command to complete or timeout
		await Promise.race([completedPromise, timeoutPromise])

		await runPromise
		// Calculate execution time in microseconds
		// If endTime wasn't set (unlikely but possible), set it now
		if (!timeRecorded) {
			endTime = process.hrtime.bigint()
		}
		const executionTimeUs = Number((endTime - startTime) / BigInt(1000))
		// Verify the output matches the expected output
		expect(capturedOutput).toBe(expectedOutput)

		return { executionTimeUs, capturedOutput, exitDetails }
	} finally {
		// Clean up
		terminalProcess.removeAllListeners()
		terminalManager.disposeAll()
		TerminalRegistry["terminals"] = []
	}
}

describe("TerminalProcess with Real Command Output", () => {
	beforeEach(() => {
		// Reset the terminals array before each test
		TerminalRegistry["terminals"] = []
		jest.clearAllMocks()
	})

	it("should execute 'echo a' and return exactly 'a\\n' with execution time", async () => {
		const { executionTimeUs, capturedOutput } = await testTerminalCommand("echo a", "a\n")
		console.log(`'echo a' execution time: ${executionTimeUs} microseconds (${executionTimeUs / 1000} milliseconds)`)
	})

	it("should execute 'echo -n a' and return exactly 'a'", async () => {
		const { executionTimeUs } = await testTerminalCommand("echo -n a", "a")
		console.log(`'echo -n a' execution time: ${executionTimeUs} microseconds (${executionTimeUs / 1000} milliseconds)`)
	})

	it("should execute 'echo -e \"a\\nb\"' and return 'a\\nb\\n'", async () => {
		const { executionTimeUs } = await testTerminalCommand('echo -e "a\\nb"', "a\nb\n")
		console.log(`'echo -e "a\\nb"' execution time: ${executionTimeUs} microseconds (${executionTimeUs / 1000} milliseconds)`)
	})

	it("should properly handle terminal shell execution events", async () => {
		// This test is implicitly testing the event handlers since all tests now use them
		const { executionTimeUs } = await testTerminalCommand("echo test", "test\n")
		console.log(`'echo test' execution time: ${executionTimeUs} microseconds (${executionTimeUs / 1000} milliseconds)`)
	})

	// Configure the number of lines for the base64 test
	const BASE64_TEST_LINES = 1000000

	it(`should execute 'base64 < /dev/zero | head -n ${BASE64_TEST_LINES}' and verify ${BASE64_TEST_LINES} lines of 'A's`, async () => {
		// Create an expected output pattern that matches what base64 produces
		// Each line is 76 'A's followed by a newline
		const expectedOutput = Array(BASE64_TEST_LINES).fill("A".repeat(76)).join("\n") + "\n"

		// This command will generate BASE64_TEST_LINES lines of base64 encoded zeros
		// Each line will contain 76 'A' characters (base64 encoding of zeros)
		const { executionTimeUs, capturedOutput } = await testTerminalCommand(
			`base64 < /dev/zero | head -n ${BASE64_TEST_LINES}`,
			expectedOutput,
		)

		console.log(
			`'base64 < /dev/zero | head -n ${BASE64_TEST_LINES}' execution time: ${executionTimeUs} microseconds (${executionTimeUs / 1000} milliseconds)`,
		)

		// Display a truncated output sample (first 3 lines and last 3 lines)
		const lines = capturedOutput.split("\n")
		const truncatedOutput =
			lines.slice(0, 3).join("\n") +
			`\n... (truncated ${lines.length - 6} lines) ...\n` +
			lines.slice(Math.max(0, lines.length - 3), lines.length).join("\n")
		console.log("Output sample (first 3 lines):\n", truncatedOutput)
		// Verify the output

		// Check if we have BASE64_TEST_LINES lines (may have an empty line at the end)
		expect(lines.length).toBeGreaterThanOrEqual(BASE64_TEST_LINES)

		// Sample some lines to verify they contain 76 'A' characters
		// Sample indices at beginning, 1%, 10%, 50%, and end of the output
		const sampleIndices = [
			0,
			Math.floor(BASE64_TEST_LINES * 0.01),
			Math.floor(BASE64_TEST_LINES * 0.1),
			Math.floor(BASE64_TEST_LINES * 0.5),
			BASE64_TEST_LINES - 1,
		].filter((i) => i < lines.length)
		for (const index of sampleIndices) {
			expect(lines[index]).toBe("A".repeat(76))
		}
	})

	describe("exit code interpretation", () => {
		it("should handle exit 2", async () => {
			const { exitDetails } = await testTerminalCommand("exit 2", "")
			expect(exitDetails).toEqual({ exitCode: 2 })
		})

		it("should handle normal exit codes", async () => {
			// Test successful command
			const { exitDetails } = await testTerminalCommand("true", "")
			expect(exitDetails).toEqual({ exitCode: 0 })

			// Test failed command
			const { exitDetails: exitDetails2 } = await testTerminalCommand("false", "")
			expect(exitDetails2).toEqual({ exitCode: 1 })
		})

		it("should interpret SIGTERM exit code", async () => {
			// Run kill in subshell to ensure signal affects the command
			const { exitDetails } = await testTerminalCommand("bash -c 'kill $$'", "")
			expect(exitDetails).toEqual({
				exitCode: 143, // 128 + 15 (SIGTERM)
				signal: 15,
				signalName: "SIGTERM",
				coreDumpPossible: false,
			})
		})

		it("should interpret SIGSEGV exit code", async () => {
			// Run kill in subshell to ensure signal affects the command
			const { exitDetails } = await testTerminalCommand("bash -c 'kill -SIGSEGV $$'", "")
			expect(exitDetails).toEqual({
				exitCode: 139, // 128 + 11 (SIGSEGV)
				signal: 11,
				signalName: "SIGSEGV",
				coreDumpPossible: true,
			})
		})

		it("should handle command not found", async () => {
			// Test a non-existent command
			const { exitDetails } = await testTerminalCommand("nonexistentcommand", "")
			expect(exitDetails?.exitCode).toBe(127) // Command not found
		})
	})
})
