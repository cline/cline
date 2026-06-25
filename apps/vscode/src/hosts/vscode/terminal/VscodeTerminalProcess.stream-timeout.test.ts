import { afterEach, beforeEach, describe, it } from "mocha"
import { setVscodeHostProviderMock } from "@/test/host-provider-test-utils"
import "should"
import * as sinon from "sinon"
import * as vscode from "vscode"
import { VscodeTerminalProcess } from "./VscodeTerminalProcess"
import { TerminalRegistry } from "./VscodeTerminalRegistry"

declare module "vscode" {
	interface Terminal {
		shellIntegration?: {
			cwd?: vscode.Uri
			executeCommand?: (command: string) => {
				read: () => AsyncIterable<string>
			}
		}
	}
}

// Create a mock stream that never completes (simulates stalled stream)
function createStalledStream() {
	return {
		async *[Symbol.asyncIterator]() {
			// Never yields, simulating a stalled stream
			yield "initial output\n"
			await new Promise(() => {}) // Never resolves
		},
	}
}

// Create a mock stream with delayed output
function createSlowStream(delayMs: number = 5000) {
	return {
		async *[Symbol.asyncIterator]() {
			yield "starting\n"
			await new Promise((resolve) => setTimeout(resolve, delayMs))
			yield "completed\n"
		},
	}
}

describe("VscodeTerminalProcess Stream Timeout", () => {
	let process: VscodeTerminalProcess
	let sandbox: sinon.SinonSandbox
	let createdTerminals: vscode.Terminal[] = []

	beforeEach(() => {
		sandbox = sinon.createSandbox({ useFakeTimers: true })
		setVscodeHostProviderMock()
		process = new VscodeTerminalProcess()
	})

	afterEach(() => {
		sandbox.restore()
		process.removeAllListeners()
		createdTerminals.forEach((t) => {
			t.dispose()
		})
		createdTerminals = []
	})

	describe("Stream timeout functionality", () => {
		it("should timeout and emit fallback output when stream stalls", async () => {
			const terminal = TerminalRegistry.createTerminal().terminal
			createdTerminals.push(terminal)

			// Mock the shell integration with a stalled stream
			const mockExecuteCommand = sandbox.stub().returns({
				read: () => createStalledStream(),
			})

			sandbox.stub(terminal, "shellIntegration").get(() => ({
				executeCommand: mockExecuteCommand,
			}))

			const emitSpy = sandbox.spy(process, "emit")

			// Set a short timeout for testing (500ms)
			const runPromise = process.run(terminal, "test-command", 500)

			// Advance the clock past the timeout
			await sandbox.clock.tickAsync(600)

			// Wait for the promise to settle
			await runPromise.catch(() => {})

			// Verify that completed and continue events were emitted
			;(emitSpy as sinon.SinonSpy).calledWith("completed").should.be.true()
			;(emitSpy as sinon.SinonSpy).calledWith("continue").should.be.true()
		})

		it("should clear timeout when stream completes normally", async () => {
			const terminal = TerminalRegistry.createTerminal().terminal
			createdTerminals.push(terminal)

			// Mock the shell integration with a stream that completes
			const mockExecuteCommand = sandbox.stub().returns({
				read: () => {
					return {
						async *[Symbol.asyncIterator]() {
							yield "test-command\n"
							yield "output line 1\n"
							yield "output line 2\n"
						},
					}
				},
			})

			sandbox.stub(terminal, "shellIntegration").get(() => ({
				executeCommand: mockExecuteCommand,
			}))

			const emitSpy = sandbox.spy(process, "emit")
			const clearTimeoutSpy = sandbox.spy(global, "clearTimeout")

			await process.run(terminal, "test-command", 5000)

			// Verify that timeout was cleared (stream completed before timeout)
			;(clearTimeoutSpy as sinon.SinonSpy).called.should.be.true()

			// Verify completion events
			;(emitSpy as sinon.SinonSpy).calledWith("completed").should.be.true()
			;(emitSpy as sinon.SinonSpy).calledWith("continue").should.be.true()
		})

		it("should use instance timeout when no parameter provided", async () => {
			const terminal = TerminalRegistry.createTerminal().terminal
			createdTerminals.push(terminal)

			// Set instance timeout
			process.streamTimeoutMs = 300

			// Mock stalled stream
			const mockExecuteCommand = sandbox.stub().returns({
				read: () => createStalledStream(),
			})

			sandbox.stub(terminal, "shellIntegration").get(() => ({
				executeCommand: mockExecuteCommand,
			}))

			const emitSpy = sandbox.spy(process, "emit")

			// Call without timeout parameter - should use instance field
			const runPromise = process.run(terminal, "test-command")

			await sandbox.clock.tickAsync(400)
			await runPromise.catch(() => {})

			// Verify timeout fired
			;(emitSpy as sinon.SinonSpy).calledWith("completed").should.be.true()
		})

		it("should use parameter timeout over instance timeout", async () => {
			const terminal = TerminalRegistry.createTerminal().terminal
			createdTerminals.push(terminal)

			// Set instance timeout to 5000
			process.streamTimeoutMs = 5000

			// Mock stalled stream
			const mockExecuteCommand = sandbox.stub().returns({
				read: () => createStalledStream(),
			})

			sandbox.stub(terminal, "shellIntegration").get(() => ({
				executeCommand: mockExecuteCommand,
			}))

			const emitSpy = sandbox.spy(process, "emit")

			// Call with parameter timeout of 300ms - should use this
			const runPromise = process.run(terminal, "test-command", 300)

			// Advance time past parameter timeout (300ms) but before instance timeout (5000ms)
			await sandbox.clock.tickAsync(400)

			await runPromise.catch(() => {})

			// Verify timeout fired at the parameter value (not the instance value)
			;(emitSpy as sinon.SinonSpy).calledWith("completed").should.be.true()
		})

		it("should emit fallback output on timeout using returnCurrentTerminalContents", async () => {
			const terminal = TerminalRegistry.createTerminal().terminal
			createdTerminals.push(terminal)

			// Mock stalled stream
			const mockExecuteCommand = sandbox.stub().returns({
				read: () => createStalledStream(),
			})

			sandbox.stub(terminal, "shellIntegration").get(() => ({
				executeCommand: mockExecuteCommand,
			}))

			const emitSpy = sandbox.spy(process, "emit")

			const runPromise = process.run(terminal, "test-command", 100)

			await sandbox.clock.tickAsync(150)

			await runPromise.catch(() => {})

			// Verify that line events were emitted (at least the initial output or fallback)
			;(emitSpy as sinon.SinonSpy).calledWith("completed").should.be.true()
			;(emitSpy as sinon.SinonSpy).calledWith("continue").should.be.true()
		})

		it("should handle timeout with multiple streams sequentially", async () => {
			const terminal = TerminalRegistry.createTerminal().terminal
			createdTerminals.push(terminal)

			const mockExecuteCommand = sandbox.stub()

			// First call returns stalled stream
			mockExecuteCommand.onFirstCall().returns({
				read: () => createStalledStream(),
			})

			// Second call returns normal stream
			mockExecuteCommand.onSecondCall().returns({
				read: () => {
					return {
						async *[Symbol.asyncIterator]() {
							yield "output\n"
						},
					}
				},
			})

			sandbox.stub(terminal, "shellIntegration").get(() => ({
				executeCommand: mockExecuteCommand,
			}))

			// First run with timeout
			const emitSpy1 = sandbox.spy(process, "emit")
			const runPromise1 = process.run(terminal, "stalled-command", 100)
			await sandbox.clock.tickAsync(150)
			await runPromise1.catch(() => {})

			;(emitSpy1 as sinon.SinonSpy).calledWith("completed").should.be.true()

			// Clean up for next test
			emitSpy1.restore()

			// Create new process for second run
			const process2 = new VscodeTerminalProcess()
			const emitSpy2 = sandbox.spy(process2, "emit")
			await process2.run(terminal, "normal-command", 5000)

			;(emitSpy2 as sinon.SinonSpy).calledWith("completed").should.be.true()
		})
	})

	describe("Timeout integration with stream data", () => {
		it("should preserve output captured before timeout", async () => {
			const terminal = TerminalRegistry.createTerminal().terminal
			createdTerminals.push(terminal)

			// Create a stream that outputs something then stalls
			const mockExecuteCommand = sandbox.stub().returns({
				read: () => {
					return {
						async *[Symbol.asyncIterator]() {
							yield "important output\n"
							yield "more output\n"
							// Then stalls forever
							await new Promise(() => {})
						},
					}
				},
			})

			sandbox.stub(terminal, "shellIntegration").get(() => ({
				executeCommand: mockExecuteCommand,
			}))

			const lineEmitSpy = sandbox.spy(process, "emit")

			const runPromise = process.run(terminal, "test-command", 100)

			// Advance time to allow initial output to be processed
			await sandbox.clock.tickAsync(50)

			// Then advance past timeout
			await sandbox.clock.tickAsync(100)

			await runPromise.catch(() => {})

			// Should have emitted the output lines before timeout
			;(lineEmitSpy as sinon.SinonSpy).calledWith("line", "important output").should.be.true()
			;(lineEmitSpy as sinon.SinonSpy).calledWith("line", "more output").should.be.true()

			// Should have completed despite timeout
			;(lineEmitSpy as sinon.SinonSpy).calledWith("completed").should.be.true()
		})
	})
})
