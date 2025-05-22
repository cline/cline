// npx jest src/integrations/terminal/__tests__/TerminalProcessExec.bash.test.ts

import * as vscode from "vscode"
import { execSync } from "child_process"

import { ExitCodeDetails } from "../types"
import { TerminalProcess } from "../TerminalProcess"
import { Terminal } from "../Terminal"
import { TerminalRegistry } from "../TerminalRegistry"

// Mock the vscode module
jest.mock("vscode", () => {
	// Store event handlers so we can trigger them in tests
	const eventHandlers = {
		startTerminalShellExecution: null,
		endTerminalShellExecution: null,
		closeTerminal: null,
	}

	return {
		workspace: {
			getConfiguration: jest.fn().mockReturnValue({
				get: jest.fn().mockReturnValue(null),
			}),
		},
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
			onDidCloseTerminal: jest.fn().mockImplementation((handler) => {
				eventHandlers.closeTerminal = handler
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

jest.mock("execa", () => ({
	execa: jest.fn(),
}))

// Create a mock stream that uses real command output with realistic chunking
function createRealCommandStream(command: string): { stream: AsyncIterable<string>; exitCode: number } {
	let realOutput: string
	let exitCode: number

	try {
		// Execute the command and get the real output, redirecting stderr to /dev/null
		realOutput = execSync(command + " 2>/dev/null", {
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
	let timeoutId: NodeJS.Timeout | undefined
	// Create a mock terminal with shell integration
	const mockTerminal = {
		shellIntegration: {
			executeCommand: jest.fn(),
			cwd: vscode.Uri.file("/test/path"),
		},
		name: "Roo Code",
		processId: Promise.resolve(123),
		creationOptions: {},
		exitStatus: undefined,
		state: { isInteractedWith: true, shell: undefined },
		dispose: jest.fn(),
		hide: jest.fn(),
		show: jest.fn(),
		sendText: jest.fn(),
	}

	// Create terminal info with running state
	const mockTerminalInfo = new Terminal(1, mockTerminal, "/test/path")
	mockTerminalInfo.running = true

	// Add the terminal to the registry
	TerminalRegistry["terminals"] = [mockTerminalInfo]

	// Create a new terminal process for testing
	startTime = process.hrtime.bigint() // Start timing from terminal process creation
	const terminalProcess = new TerminalProcess(mockTerminalInfo)

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

		// Set the process on the terminal
		mockTerminalInfo.process = terminalProcess

		// Run the command (now handled by constructor)
		// We've already created the process, so we'll trigger the events manually

		// Get the event handlers from the mock
		const eventHandlers = (vscode as any).__eventHandlers

		// Execute the command first to set up the process
		terminalProcess.run(command)

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

		// Wait for some output to be processed
		await new Promise<void>((resolve) => {
			terminalProcess.once("line", () => resolve())
		})

		// Then trigger the end event
		if (eventHandlers.endTerminalShellExecution) {
			eventHandlers.endTerminalShellExecution({
				terminal: mockTerminal,
				exitCode: exitCode,
			})
		}

		// Store exit details for return
		const exitDetails = TerminalProcess.interpretExitCode(exitCode)

		// Set a timeout to avoid hanging tests
		const timeoutPromise = new Promise<void>((_, reject) => {
			timeoutId = setTimeout(() => {
				reject(new Error("Test timed out after 1000ms"))
			}, 1000)
		})

		// Wait for the command to complete or timeout
		await Promise.race([completedPromise, timeoutPromise])
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
		TerminalRegistry["terminals"] = []

		// Clear the timeout if it exists
		if (timeoutId) {
			clearTimeout(timeoutId)
		}

		// Ensure we don't have any lingering timeouts
		// This is a safety measure in case the test exits before the timeout is cleared
		if (typeof global.gc === "function") {
			global.gc() // Force garbage collection if available
		}
	}
}

// Import the test purposes from the common file
import { TEST_PURPOSES, LARGE_OUTPUT_PARAMS, TEST_TEXT } from "./TerminalProcessExec.common"

describe("TerminalProcess with Bash Command Output", () => {
	beforeAll(() => {
		// Initialize TerminalRegistry event handlers once globally
		TerminalRegistry.initialize()
	})

	beforeEach(() => {
		// Reset the terminals array before each test
		TerminalRegistry["terminals"] = []
		jest.clearAllMocks()
	})

	// Each test uses Bash-specific commands to test the same functionality
	it(TEST_PURPOSES.BASIC_OUTPUT, async () => {
		const { executionTimeUs, capturedOutput } = await testTerminalCommand("echo a", "a\n")
		console.log(`'echo a' execution time: ${executionTimeUs} microseconds (${executionTimeUs / 1000} ms)`)
		expect(capturedOutput).toBe("a\n")
	})

	it(TEST_PURPOSES.OUTPUT_WITHOUT_NEWLINE, async () => {
		// Bash command for output without newline
		const { executionTimeUs } = await testTerminalCommand("/bin/echo -n a", "a")
		console.log(`'echo -n a' execution time: ${executionTimeUs} microseconds`)
	})

	it(TEST_PURPOSES.MULTILINE_OUTPUT, async () => {
		const expectedOutput = "a\nb\n"
		// Bash multiline command using printf
		const { executionTimeUs } = await testTerminalCommand('printf "a\\nb\\n"', expectedOutput)
		console.log(`Multiline command execution time: ${executionTimeUs} microseconds`)
	})

	it(TEST_PURPOSES.EXIT_CODE_SUCCESS, async () => {
		// Success exit code
		const { exitDetails } = await testTerminalCommand("exit 0", "")
		expect(exitDetails).toEqual({ exitCode: 0 })
	})

	it(TEST_PURPOSES.EXIT_CODE_ERROR, async () => {
		// Error exit code
		const { exitDetails } = await testTerminalCommand("exit 1", "")
		expect(exitDetails).toEqual({ exitCode: 1 })
	})

	it(TEST_PURPOSES.EXIT_CODE_CUSTOM, async () => {
		// Custom exit code
		const { exitDetails } = await testTerminalCommand("exit 2", "")
		expect(exitDetails).toEqual({ exitCode: 2 })
	})

	it(TEST_PURPOSES.COMMAND_NOT_FOUND, async () => {
		// Test a non-existent command
		const { exitDetails } = await testTerminalCommand("nonexistentcommand", "")
		expect(exitDetails?.exitCode).toBe(127) // Command not found exit code in bash
	})

	it(TEST_PURPOSES.CONTROL_SEQUENCES, async () => {
		// Use printf instead of echo -e for more consistent behavior across platforms
		const { capturedOutput } = await testTerminalCommand(
			'printf "\\033[31mRed Text\\033[0m\\n"',
			"\x1B[31mRed Text\x1B[0m\n",
		)
		expect(capturedOutput).toBe("\x1B[31mRed Text\x1B[0m\n")
	})

	it(TEST_PURPOSES.LARGE_OUTPUT, async () => {
		// Generate a larger output stream
		const lines = LARGE_OUTPUT_PARAMS.LINES
		const command = `for i in $(seq 1 ${lines}); do echo "${TEST_TEXT.LARGE_PREFIX}$i"; done`

		// Build expected output
		const expectedOutput =
			Array.from({ length: lines }, (_, i) => `${TEST_TEXT.LARGE_PREFIX}${i + 1}`).join("\n") + "\n"

		const { executionTimeUs, capturedOutput } = await testTerminalCommand(command, expectedOutput)

		// Verify a sample of the output
		const outputLines = capturedOutput.split("\n")
		// Check if we have the expected number of lines
		expect(outputLines.length - 1).toBe(lines) // -1 for trailing newline

		console.log(`Large output command (${lines} lines) execution time: ${executionTimeUs} microseconds`)
	})

	it(TEST_PURPOSES.SIGNAL_TERMINATION, async () => {
		// Run kill in subshell to ensure signal affects the command
		const { exitDetails } = await testTerminalCommand("bash -c 'kill $$'", "")
		expect(exitDetails).toEqual({
			exitCode: 143, // 128 + 15 (SIGTERM)
			signal: 15,
			signalName: "SIGTERM",
			coreDumpPossible: false,
		})
	})

	it(TEST_PURPOSES.SIGNAL_SEGV, async () => {
		// Run kill in subshell to ensure signal affects the command
		const { exitDetails } = await testTerminalCommand("bash -c 'kill -SIGSEGV $$'", "")
		expect(exitDetails).toEqual({
			exitCode: 139, // 128 + 11 (SIGSEGV)
			signal: 11,
			signalName: "SIGSEGV",
			coreDumpPossible: true,
		})
	})

	// We can skip this very large test for normal development
	it.skip(`should execute 'yes AAA... | head -n ${1_000_000}' and verify lines of 'A's`, async () => {
		const TEST_LINES = 1_000_000
		const expectedOutput = Array(TEST_LINES).fill("A".repeat(76)).join("\n") + "\n"

		// This command will generate 1M lines with 76 'A's each.
		const { executionTimeUs, capturedOutput } = await testTerminalCommand(
			`yes "${"A".repeat(76)}" | head -n ${TEST_LINES}`,
			expectedOutput,
		)

		console.log(
			`'yes "${"A".repeat(76)}" | head -n ${TEST_LINES}' execution time: ${executionTimeUs} microseconds (${executionTimeUs / 1000} milliseconds)`,
		)

		// Display a truncated output sample (first 3 lines and last 3 lines)
		const lines = capturedOutput.split("\n")
		const truncatedOutput =
			lines.slice(0, 3).join("\n") +
			`\n... (truncated ${lines.length - 6} lines) ...\n` +
			lines.slice(Math.max(0, lines.length - 3), lines.length).join("\n")

		console.log("Output sample (first 3 lines):\n", truncatedOutput)

		// Verify the output.
		// Check if we have TEST_LINES lines (may have an empty line at the end).
		expect(lines.length).toBeGreaterThanOrEqual(TEST_LINES)

		// Sample some lines to verify they contain 76 'A' characters.
		// Sample indices at beginning, 1%, 10%, 50%, and end of the output.
		const sampleIndices = [
			0,
			Math.floor(TEST_LINES * 0.01),
			Math.floor(TEST_LINES * 0.1),
			Math.floor(TEST_LINES * 0.5),
			TEST_LINES - 1,
		].filter((i) => i < lines.length)

		for (const index of sampleIndices) {
			expect(lines[index]).toBe("A".repeat(76))
		}
	})
})
