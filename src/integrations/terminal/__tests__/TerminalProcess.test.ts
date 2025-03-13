// npx jest src/integrations/terminal/__tests__/TerminalProcess.test.ts

import * as vscode from "vscode"

import { TerminalProcess, mergePromise } from "../TerminalProcess"
import { Terminal } from "../Terminal"
import { TerminalRegistry } from "../TerminalRegistry"

// Mock vscode.window.createTerminal
const mockCreateTerminal = jest.fn()

jest.mock("vscode", () => ({
	workspace: {
		getConfiguration: jest.fn().mockReturnValue({
			get: jest.fn().mockReturnValue(null),
		}),
	},
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

describe("TerminalProcess", () => {
	let terminalProcess: TerminalProcess
	let mockTerminal: jest.Mocked<
		vscode.Terminal & {
			shellIntegration: {
				executeCommand: jest.Mock
			}
		}
	>
	let mockTerminalInfo: Terminal
	let mockExecution: any
	let mockStream: AsyncIterableIterator<string>

	beforeEach(() => {
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

		mockTerminalInfo = new Terminal(1, mockTerminal, "./")

		// Create a process for testing
		terminalProcess = new TerminalProcess(mockTerminalInfo)

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
				terminalProcess.emit("shell_execution_complete", { exitCode: 0 })
			})()

			mockExecution = {
				read: jest.fn().mockReturnValue(mockStream),
			}

			mockTerminal.shellIntegration.executeCommand.mockReturnValue(mockExecution)

			const runPromise = terminalProcess.run("test command")
			terminalProcess.emit("stream_available", mockStream)
			await runPromise

			expect(lines).toEqual(["Initial output", "More output", "Final output"])
			expect(terminalProcess.isHot).toBe(false)
		})

		it("handles terminals without shell integration", async () => {
			// Create a terminal without shell integration
			const noShellTerminal = {
				sendText: jest.fn(),
				shellIntegration: undefined,
				name: "No Shell Terminal",
				processId: Promise.resolve(456),
				creationOptions: {},
				exitStatus: undefined,
				state: { isInteractedWith: true },
				dispose: jest.fn(),
				hide: jest.fn(),
				show: jest.fn(),
			} as unknown as vscode.Terminal

			// Create new terminal info with the no-shell terminal
			const noShellTerminalInfo = new Terminal(2, noShellTerminal, "./")

			// Create new process with the no-shell terminal
			const noShellProcess = new TerminalProcess(noShellTerminalInfo)

			// Set up event listeners to verify events are emitted
			const eventPromises = Promise.all([
				new Promise<void>((resolve) =>
					noShellProcess.once("no_shell_integration", (_message: string) => resolve()),
				),
				new Promise<void>((resolve) => noShellProcess.once("completed", (_output?: string) => resolve())),
				new Promise<void>((resolve) => noShellProcess.once("continue", resolve)),
			])

			// Run command and wait for all events
			await noShellProcess.run("test command")
			await eventPromises

			// Verify sendText was called with the command
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
				terminalProcess.emit("shell_execution_complete", { exitCode: 0 })
			})()

			mockTerminal.shellIntegration.executeCommand.mockReturnValue({
				read: jest.fn().mockReturnValue(mockStream),
			})

			const runPromise = terminalProcess.run("npm run build")
			terminalProcess.emit("stream_available", mockStream)

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

	describe("getUnretrievedOutput", () => {
		it("returns and clears unretrieved output", () => {
			terminalProcess["fullOutput"] = `\x1b]633;C\x07previous\nnew output\x1b]633;D\x07`
			terminalProcess["lastRetrievedIndex"] = 17 // After "previous\n"

			const unretrieved = terminalProcess.getUnretrievedOutput()
			expect(unretrieved).toBe("new output")

			expect(terminalProcess["lastRetrievedIndex"]).toBe(terminalProcess["fullOutput"].length - "previous".length)
		})
	})

	describe("interpretExitCode", () => {
		it("handles undefined exit code", () => {
			const result = TerminalProcess.interpretExitCode(undefined)
			expect(result).toEqual({ exitCode: undefined })
		})

		it("handles normal exit codes (0-128)", () => {
			const result = TerminalProcess.interpretExitCode(0)
			expect(result).toEqual({ exitCode: 0 })

			const result2 = TerminalProcess.interpretExitCode(1)
			expect(result2).toEqual({ exitCode: 1 })

			const result3 = TerminalProcess.interpretExitCode(128)
			expect(result3).toEqual({ exitCode: 128 })
		})

		it("interprets signal exit codes (>128)", () => {
			// SIGTERM (15) -> 128 + 15 = 143
			const result = TerminalProcess.interpretExitCode(143)
			expect(result).toEqual({
				exitCode: 143,
				signal: 15,
				signalName: "SIGTERM",
				coreDumpPossible: false,
			})

			// SIGSEGV (11) -> 128 + 11 = 139
			const result2 = TerminalProcess.interpretExitCode(139)
			expect(result2).toEqual({
				exitCode: 139,
				signal: 11,
				signalName: "SIGSEGV",
				coreDumpPossible: true,
			})
		})

		it("handles unknown signals", () => {
			const result = TerminalProcess.interpretExitCode(255)
			expect(result).toEqual({
				exitCode: 255,
				signal: 127,
				signalName: "Unknown Signal (127)",
				coreDumpPossible: false,
			})
		})
	})

	describe("mergePromise", () => {
		it("merges promise methods with terminal process", async () => {
			const process = new TerminalProcess(mockTerminalInfo)
			const promise = Promise.resolve()

			const merged = mergePromise(process, promise)

			expect(merged).toHaveProperty("then")
			expect(merged).toHaveProperty("catch")
			expect(merged).toHaveProperty("finally")
			expect(merged instanceof TerminalProcess).toBe(true)

			await expect(merged).resolves.toBeUndefined()
		})
	})
})
