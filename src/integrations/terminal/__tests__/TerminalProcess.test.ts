// npx jest src/integrations/terminal/__tests__/TerminalProcess.test.ts

import * as vscode from "vscode"

import { TerminalProcess } from "../TerminalProcess"
import { TerminalInfo, TerminalRegistry } from "../TerminalRegistry"

// Mock vscode.window.createTerminal
const mockCreateTerminal = jest.fn()

jest.mock("vscode", () => ({
	window: {
		createTerminal: (...args: any[]) => {
			mockCreateTerminal(...args)
			return {
				exitStatus: undefined,
			}
		},
	},
	ThemeIcon: jest.fn(),
}))

const TERMINAL_OUTPUT_LIMIT = 100 * 1024
const STALL_TIMEOUT = 100

describe("TerminalProcess", () => {
	let terminalProcess: TerminalProcess
	let mockTerminal: jest.Mocked<
		vscode.Terminal & {
			shellIntegration: {
				executeCommand: jest.Mock
			}
		}
	>
	let mockTerminalInfo: TerminalInfo
	let mockExecution: any
	let mockStream: AsyncIterableIterator<string>

	beforeEach(() => {
		terminalProcess = new TerminalProcess(TERMINAL_OUTPUT_LIMIT, STALL_TIMEOUT)

		// Create properly typed mock terminal
		mockTerminal = {
			shellIntegration: {
				executeCommand: jest.fn(),
			},
			name: "Roo Code",
			processId: Promise.resolve(123),
			creationOptions: {},
			exitStatus: undefined,
			state: { isInteractedWith: true },
			dispose: jest.fn(),
			hide: jest.fn(),
			show: jest.fn(),
			sendText: jest.fn(),
		} as unknown as jest.Mocked<
			vscode.Terminal & {
				shellIntegration: {
					executeCommand: jest.Mock
				}
			}
		>

		mockTerminalInfo = {
			terminal: mockTerminal,
			busy: false,
			lastCommand: "",
			id: 1,
			running: false,
			streamClosed: false,
		}

		TerminalRegistry["terminals"].push(mockTerminalInfo)

		// Reset event listeners
		terminalProcess.removeAllListeners()
	})

	describe("run", () => {
		it("handles shell integration commands correctly", async () => {
			let lines: string[] = []

			terminalProcess.on("completed", (output) => {
				if (output) {
					lines = output.split("\n")
				}
			})

			// Mock stream data with shell integration sequences.
			mockStream = (async function* () {
				yield "\x1b]633;C\x07" // The first chunk contains the command start sequence with bell character.
				yield "Initial output\n"
				yield "More output\n"
				yield "Final output"
				yield "\x1b]633;D\x07" // The last chunk contains the command end sequence with bell character.
				terminalProcess.emit("shell_execution_complete", mockTerminalInfo.id, { exitCode: 0 })
			})()

			mockExecution = {
				read: jest.fn().mockReturnValue(mockStream),
			}

			mockTerminal.shellIntegration.executeCommand.mockReturnValue(mockExecution)

			const runPromise = terminalProcess.run(mockTerminal, "test command")
			terminalProcess.emit("stream_available", mockTerminalInfo.id, mockStream)
			await runPromise

			expect(lines).toEqual(["Initial output", "More output", "Final output"])
			expect(terminalProcess.isHot).toBe(false)
		})

		it("handles terminals without shell integration", async () => {
			const noShellTerminal = {
				sendText: jest.fn(),
				shellIntegration: undefined,
			} as unknown as vscode.Terminal

			const noShellPromise = new Promise<void>((resolve) => {
				terminalProcess.once("no_shell_integration", resolve)
			})

			await terminalProcess.run(noShellTerminal, "test command")
			await noShellPromise

			expect(noShellTerminal.sendText).toHaveBeenCalledWith("test command", true)
		})

		it("sets hot state for compiling commands", async () => {
			let lines: string[] = []

			terminalProcess.on("completed", (output) => {
				if (output) {
					lines = output.split("\n")
				}
			})

			const completePromise = new Promise<void>((resolve) => {
				terminalProcess.on("shell_execution_complete", () => resolve())
			})

			mockStream = (async function* () {
				yield "\x1b]633;C\x07" // The first chunk contains the command start sequence with bell character.
				yield "compiling...\n"
				yield "still compiling...\n"
				yield "done"
				yield "\x1b]633;D\x07" // The last chunk contains the command end sequence with bell character.
				terminalProcess.emit("shell_execution_complete", mockTerminalInfo.id, { exitCode: 0 })
			})()

			mockTerminal.shellIntegration.executeCommand.mockReturnValue({
				read: jest.fn().mockReturnValue(mockStream),
			})

			const runPromise = terminalProcess.run(mockTerminal, "npm run build")
			terminalProcess.emit("stream_available", mockTerminalInfo.id, mockStream)

			expect(terminalProcess.isHot).toBe(true)
			await runPromise

			expect(lines).toEqual(["compiling...", "still compiling...", "done"])

			await completePromise
			expect(terminalProcess.isHot).toBe(false)
		})
	})

	describe("continue", () => {
		it("stops listening and emits continue event", () => {
			const continueSpy = jest.fn()
			terminalProcess.on("continue", continueSpy)

			terminalProcess.continue()

			expect(continueSpy).toHaveBeenCalled()
			expect(terminalProcess["isListening"]).toBe(false)
		})
	})

	describe("stalled stream handling", () => {
		it("emits stream_stalled event when no output is received within timeout", async () => {
			// Create a promise that resolves when stream_stalled is emitted
			const streamStalledPromise = new Promise<number>((resolve) => {
				terminalProcess.once("stream_stalled", (id: number) => {
					resolve(id)
				})
			})

			// Create a stream that doesn't emit any data
			mockStream = (async function* () {
				yield "\x1b]633;C\x07" // Command start sequence
				// No data is yielded after this, causing the stall
				await new Promise((resolve) => setTimeout(resolve, STALL_TIMEOUT * 2))
				// This would normally be yielded, but the stall timer will fire first
				yield "Output after stall"
				yield "\x1b]633;D\x07" // Command end sequence
				terminalProcess.emit("shell_execution_complete", mockTerminalInfo.id, { exitCode: 0 })
			})()

			mockExecution = {
				read: jest.fn().mockReturnValue(mockStream),
			}

			mockTerminal.shellIntegration.executeCommand.mockReturnValue(mockExecution)

			// Start the terminal process
			const runPromise = terminalProcess.run(mockTerminal, "test command")
			terminalProcess.emit("stream_available", mockTerminalInfo.id, mockStream)

			// Wait for the stream_stalled event
			const stalledId = await streamStalledPromise

			// Verify the event was emitted with the correct terminal ID
			expect(stalledId).toBe(mockTerminalInfo.id)

			// Complete the run
			await runPromise
		})

		it("clears stall timer when output is received", async () => {
			// Spy on the emit method to check if stream_stalled is emitted
			const emitSpy = jest.spyOn(terminalProcess, "emit")

			// Create a stream that emits data before the stall timeout
			mockStream = (async function* () {
				yield "\x1b]633;C\x07" // Command start sequence
				yield "Initial output\n" // This should clear the stall timer

				// Wait longer than the stall timeout
				await new Promise((resolve) => setTimeout(resolve, STALL_TIMEOUT * 2))

				yield "More output\n"
				yield "\x1b]633;D\x07" // Command end sequence
				terminalProcess.emit("shell_execution_complete", mockTerminalInfo.id, { exitCode: 0 })
			})()

			mockExecution = {
				read: jest.fn().mockReturnValue(mockStream),
			}

			mockTerminal.shellIntegration.executeCommand.mockReturnValue(mockExecution)

			// Start the terminal process
			const runPromise = terminalProcess.run(mockTerminal, "test command")
			terminalProcess.emit("stream_available", mockTerminalInfo.id, mockStream)

			// Wait for the run to complete
			await runPromise

			// Wait a bit longer to ensure the stall timer would have fired if not cleared
			await new Promise((resolve) => setTimeout(resolve, STALL_TIMEOUT * 2))

			// Verify stream_stalled was not emitted
			expect(emitSpy).not.toHaveBeenCalledWith("stream_stalled", expect.anything())
		})

		it("returns true from flushLine when a line is emitted", async () => {
			// Create a stream with output
			mockStream = (async function* () {
				yield "\x1b]633;C\x07" // Command start sequence
				yield "Test output\n" // This should be flushed as a line
				yield "\x1b]633;D\x07" // Command end sequence
				terminalProcess.emit("shell_execution_complete", mockTerminalInfo.id, { exitCode: 0 })
			})()

			mockExecution = {
				read: jest.fn().mockReturnValue(mockStream),
			}

			mockTerminal.shellIntegration.executeCommand.mockReturnValue(mockExecution)

			// Spy on the flushLine method
			const flushLineSpy = jest.spyOn(terminalProcess as any, "flushLine")

			// Spy on the emit method to check if line is emitted
			const emitSpy = jest.spyOn(terminalProcess, "emit")

			// Start the terminal process
			const runPromise = terminalProcess.run(mockTerminal, "test command")
			terminalProcess.emit("stream_available", mockTerminalInfo.id, mockStream)

			// Wait for the run to complete
			await runPromise

			// Verify flushLine was called and returned true
			expect(flushLineSpy).toHaveBeenCalled()
			expect(flushLineSpy.mock.results.some((result) => result.value === true)).toBe(true)

			// Verify line event was emitted
			expect(emitSpy).toHaveBeenCalledWith("line", expect.any(String))
		})

		it("returns false from flushLine when no line is emitted", async () => {
			// Create a stream with no complete lines
			mockStream = (async function* () {
				yield "\x1b]633;C\x07" // Command start sequence
				yield "Test output" // No newline, so this won't be flushed as a line yet
				yield "\x1b]633;D\x07" // Command end sequence
				terminalProcess.emit("shell_execution_complete", mockTerminalInfo.id, { exitCode: 0 })
			})()

			mockExecution = {
				read: jest.fn().mockReturnValue(mockStream),
			}

			mockTerminal.shellIntegration.executeCommand.mockReturnValue(mockExecution)

			// Create a custom implementation to test flushLine directly
			const testFlushLine = async () => {
				// Create a new instance with the same configuration
				const testProcess = new TerminalProcess(TERMINAL_OUTPUT_LIMIT, STALL_TIMEOUT)

				// Set up the output builder with content that doesn't have a newline
				testProcess["outputBuilder"] = {
					readLine: jest.fn().mockReturnValue(""),
					append: jest.fn(),
					reset: jest.fn(),
					content: "Test output",
				} as any

				// Call flushLine directly
				const result = testProcess["flushLine"]()
				return result
			}

			// Test flushLine directly
			const flushLineResult = await testFlushLine()
			expect(flushLineResult).toBe(false)
		})
	})
})
