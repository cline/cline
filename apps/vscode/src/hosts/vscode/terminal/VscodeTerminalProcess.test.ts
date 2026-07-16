import { afterEach, beforeEach, describe, it } from "mocha"
import { EXIT_CODE_EVENT_TIMEOUT_MS } from "@/integrations/terminal/constants"
import { setVscodeHostProviderMock } from "@/test/host-provider-test-utils"
import "should"
import * as sinon from "sinon"
import * as vscode from "vscode"
import { VscodeTerminalProcess } from "./VscodeTerminalProcess"
import { TerminalRegistry } from "./VscodeTerminalRegistry"

// Create a mock stream for simulating terminal output - this is only used for tests
// that need controlled output which can't be guaranteed with real terminals
function createMockStream(lines: string[] = ["test-command", "line1", "line2", "line3"]) {
	return {
		async *[Symbol.asyncIterator]() {
			for (const line of lines) {
				yield line + "\n"
			}
		},
	}
}

// OSC 633 shell integration markers, as raw escape sequences (what read() yields).
const OSC633_C = "\x1b]633;C\x07" // CommandExecuted — output begins
const OSC633_D = "\x1b]633;D;0\x07" // CommandFinished, exit code 0

// Create a mock stream that yields the given chunks and then never ends,
// simulating shell integration that is attached but not emitting OSC 633
// markers — e.g. commands typed into an ssh session, where the remote shell
// produces output but VS Code never sees command start/end sequences and so
// never terminates the read() stream.
function createHangingStream(chunks: string[]) {
	return {
		async *[Symbol.asyncIterator]() {
			for (const chunk of chunks) {
				yield chunk
			}
			await new Promise<never>(() => {})
		},
	}
}

// Create a mock stream that wraps output lines with C/D markers, simulating a
// real shell-integration stream. The commandEcho (if provided) is emitted before
// C and should be excluded from the output by the marker-based gating.
function createMockStreamWithMarkers(outputLines: string[], commandEcho?: string) {
	const lines: string[] = []
	if (commandEcho) {
		lines.push(commandEcho)
	}
	lines.push(OSC633_C)
	lines.push(...outputLines)
	lines.push(OSC633_D)
	return createMockStream(lines)
}

describe("TerminalProcess (Integration Tests)", () => {
	let process: VscodeTerminalProcess
	let sandbox: sinon.SinonSandbox
	let createdTerminals: vscode.Terminal[] = []

	beforeEach(() => {
		sandbox = sinon.createSandbox({ useFakeTimers: true })
		setVscodeHostProviderMock()
		process = new VscodeTerminalProcess()
	})

	afterEach(() => {
		// Restore sandbox, which restores timers and all Sinon fakes
		sandbox.restore()
		// Remove any event listeners left on the TerminalProcess
		process.removeAllListeners()
		// Dispose all terminals created during the test
		createdTerminals.forEach((t) => {
			t.dispose()
		})
		createdTerminals = []
	})

	describe("Real terminal tests", () => {
		// This test works with or without shell integration
		it("should create and run a command in a real terminal", async () => {
			// Create a real VS Code terminal for testing
			const terminal = TerminalRegistry.createTerminal().terminal
			createdTerminals.push(terminal)

			// Spy on emit to verify behavior
			const emitSpy = sandbox.spy(process, "emit")

			// Run a simple command
			const runPromise = process.run(terminal, "echo test")

			// If terminal doesn't have shell integration, advance timer
			if (!terminal.shellIntegration) {
				await sandbox.clock.tickAsync(3000)
			}

			await runPromise

			// Verify that the continue event was emitted
			;(emitSpy as sinon.SinonSpy).calledWith("continue").should.be.true()
			;(emitSpy as sinon.SinonSpy).calledWith("completed").should.be.true()
		})

		it("should execute and capture events from a simple command", async () => {
			// Create a real VS Code terminal
			const terminal = TerminalRegistry.createTerminal().terminal
			createdTerminals.push(terminal)

			// Spy on emit to verify line events
			const emitSpy = sandbox.spy(process, "emit")

			// Run a command that produces predictable output
			const runPromise = process.run(terminal, "echo 'Line 1' && echo 'Line 2'")

			// If terminal doesn't have shell integration, advance timer
			if (!terminal.shellIntegration) {
				await sandbox.clock.tickAsync(3000)
			}

			await runPromise

			// Check that the events were emitted
			;(emitSpy as sinon.SinonSpy).calledWith("completed").should.be.true()
			;(emitSpy as sinon.SinonSpy).calledWith("continue").should.be.true()
		})

		it("should execute a command that lists files", async () => {
			// Create a real VS Code terminal
			const terminal = TerminalRegistry.createTerminal().terminal
			createdTerminals.push(terminal)

			// Spy on emit to verify behavior
			const emitSpy = sandbox.spy(process, "emit")

			// Run a command that lists files
			const runPromise = process.run(terminal, "ls -la")

			// If terminal doesn't have shell integration, advance timer
			if (!terminal.shellIntegration) {
				await sandbox.clock.tickAsync(3000)
			}

			await runPromise

			// Verify that the continue event was emitted
			;(emitSpy as sinon.SinonSpy).calledWith("continue").should.be.true()
			;(emitSpy as sinon.SinonSpy).calledWith("completed").should.be.true()
		})

		it("should handle a longer running command", async () => {
			// Create a real terminal
			const terminal = TerminalRegistry.createTerminal().terminal
			createdTerminals.push(terminal)

			// Spy on emit to verify behavior
			const emitSpy = sandbox.spy(process, "emit")

			// Un-fake timers temporarily for this test since we need real timing
			sandbox.clock.restore()

			// Run a command that sleeps for a short period
			await process.run(terminal, "sleep 0.5 && echo 'Done sleeping'")

			// Verify that the continue and completed events were emitted
			;(emitSpy as sinon.SinonSpy).calledWith("continue").should.be.true()
			;(emitSpy as sinon.SinonSpy).calledWith("completed").should.be.true()

			// Restore fake timers for other tests
			sandbox.useFakeTimers()
		})

		it("should execute a command with arguments", async () => {
			// Create a real VS Code terminal
			const terminal = TerminalRegistry.createTerminal().terminal
			createdTerminals.push(terminal)

			// Spy on emit to verify line events
			const emitSpy = sandbox.spy(process, "emit")

			// Run a command that produces predictable output
			const runPromise = process.run(terminal, "echo 'Line 1' 'Line 2'")

			// If terminal doesn't have shell integration, advance timer
			if (!terminal.shellIntegration) {
				await sandbox.clock.tickAsync(3000)
			}

			await runPromise

			// Check that the events were emitted
			;(emitSpy as sinon.SinonSpy).calledWith("completed").should.be.true()
			;(emitSpy as sinon.SinonSpy).calledWith("continue").should.be.true()
		})

		it("should execute a command with quotes", async () => {
			// Create a real VS Code terminal
			const terminal = TerminalRegistry.createTerminal().terminal
			createdTerminals.push(terminal)

			// Spy on emit to verify line events
			const emitSpy = sandbox.spy(process, "emit")

			// Run a command that produces predictable output
			const runPromise = process.run(terminal, "echo \"Line 1\" && echo 'Line 2'")

			// If terminal doesn't have shell integration, advance timer
			if (!terminal.shellIntegration) {
				await sandbox.clock.tickAsync(3000)
			}

			await runPromise

			// Check that the events were emitted
			;(emitSpy as sinon.SinonSpy).calledWith("completed").should.be.true()
			;(emitSpy as sinon.SinonSpy).calledWith("continue").should.be.true()
		})
	})

	// Test that specifically checks for no shell integration
	it("should handle terminals without shell integration", async () => {
		// Create a real terminal without explicitly providing shell integration
		const terminal = vscode.window.createTerminal({ name: "Test Terminal" })
		createdTerminals.push(terminal)

		// Stub the shellIntegration getter to return undefined for this test
		sandbox.stub(terminal, "shellIntegration").get(() => undefined)

		// Stub the sendText method to verify it's called
		const sendTextStub = sandbox.stub(terminal, "sendText")

		// Spy on the emit function to verify events
		const emitSpy = sandbox.spy(process, "emit")

		// Run the command - this returns a promise
		const runPromise = process.run(terminal, "test-command")

		// Advance the fake timer by 3 seconds to trigger the setTimeout
		await sandbox.clock.tickAsync(3000)

		// Now wait for the promise to resolve
		await runPromise

		// Check that the correct methods were called and events emitted
		sendTextStub.calledWith("test-command", true).should.be.true()
		;(emitSpy as sinon.SinonSpy).calledWith("completed").should.be.true()
		;(emitSpy as sinon.SinonSpy).calledWith("continue").should.be.true()

		// This event should be emitted for terminals without shell integration
		;(emitSpy as sinon.SinonSpy).calledWith("no_shell_integration").should.be.true()
	})

	// The following tests require shell integration and controlled terminal output
	describe("Shell integration tests", () => {
		// We'll mock the terminal run process and TerminalProcess for these tests
		it("should emit completed and continue events when command finishes", async () => {
			// Create a terminal to ensure proper interface, but we'll use mocking under the hood
			const terminal = TerminalRegistry.createTerminal().terminal
			createdTerminals.push(terminal)

			// Create a mock implementation of executeCommand with C/D markers
			const mockExecuteCommand = sandbox.stub().returns({
				read: () => createMockStreamWithMarkers(["test output"], "echo test"),
			})

			// Create a fake shell integration object
			const mockShellIntegration = {
				executeCommand: mockExecuteCommand,
			}

			// Stub terminal.shellIntegration to return our mock
			sandbox.stub(terminal, "shellIntegration").get(() => mockShellIntegration)

			// Spy on emit to verify behavior
			const emitSpy = sandbox.spy(process, "emit")

			// Run the command
			const runPromise = process.run(terminal, "echo test")
			await sandbox.clock.tickAsync(3000)
			await runPromise

			// Verify the executeCommand was called with the right command
			mockExecuteCommand.calledWith("echo test").should.be.true()

			// Check that the events were emitted
			;(emitSpy as sinon.SinonSpy).calledWith("completed").should.be.true()
			;(emitSpy as sinon.SinonSpy).calledWith("continue").should.be.true()
		})

		it("prefers the onDidEndTerminalShellExecution exit code over a conflicting D-marker exit code", async () => {
			const terminal = TerminalRegistry.createTerminal().terminal
			createdTerminals.push(terminal)

			// D marker reports success (0), but the authoritative end event
			// reports failure (1) — the event must win.
			const mockExecution = { read: () => createMockStreamWithMarkers(["test output"], "echo test") }
			const mockExecuteCommand = sandbox.stub().returns(mockExecution)
			sandbox.stub(terminal, "shellIntegration").get(() => ({ executeCommand: mockExecuteCommand }))

			let endListener: ((e: vscode.TerminalShellExecutionEndEvent) => unknown) | undefined
			sandbox.stub(vscode.window, "onDidEndTerminalShellExecution").callsFake((listener) => {
				endListener = listener
				return { dispose: () => {} }
			})

			const runPromise = process.run(terminal, "echo test")
			// Fire the end event with a conflicting exit code before the stream
			// finishes draining — the process must still prefer it over the D
			// marker's exitCode: 0 once the stream completes.
			endListener?.({ terminal, execution: mockExecution, exitCode: 1 } as unknown as vscode.TerminalShellExecutionEndEvent)
			await sandbox.clock.tickAsync(3000)
			await runPromise

			process.getCompletionDetails().exitCode?.should.equal(1)
		})

		it("falls back to no exit code when onDidEndTerminalShellExecution never fires", async () => {
			const terminal = TerminalRegistry.createTerminal().terminal
			createdTerminals.push(terminal)

			const mockExecution = { read: () => createMockStreamWithMarkers(["test output"], "echo test") }
			const mockExecuteCommand = sandbox.stub().returns(mockExecution)
			sandbox.stub(terminal, "shellIntegration").get(() => ({ executeCommand: mockExecuteCommand }))

			// Event is registered but deliberately never invoked, simulating
			// shell integration that is present but not reporting completion
			// for this execution (e.g. a command run inside an ssh session).
			sandbox.stub(vscode.window, "onDidEndTerminalShellExecution").callsFake(() => ({ dispose: () => {} }))

			const runPromise = process.run(terminal, "echo test")
			await sandbox.clock.tickAsync(EXIT_CODE_EVENT_TIMEOUT_MS + 1000)
			await runPromise

			// D marker in createMockStreamWithMarkers reports exit code 0, and
			// with no competing event, that D-marker value is used.
			process.getCompletionDetails().exitCode?.should.equal(0)
		})
	})

	// Tests with controlled output
	describe("Controlled output tests", () => {
		it("should emit line events for each line of output", async () => {
			// Create a terminal
			const terminal = TerminalRegistry.createTerminal().terminal
			createdTerminals.push(terminal)

			// Mock the shell integration with controlled output, wrapped in C/D markers
			const mockExecuteCommand = sandbox.stub().returns({
				read: () => createMockStreamWithMarkers(["line1", "line2", "line3"], "test-command"),
			})

			// Create a mock shell integration object and stub the getter
			sandbox.stub(terminal, "shellIntegration").get(() => ({
				executeCommand: mockExecuteCommand,
			}))

			const emitSpy = sandbox.spy(process, "emit")

			const runPromise = process.run(terminal, "test-command")
			await sandbox.clock.tickAsync(3000)
			await runPromise

			// Check that line events were emitted for each line
			;(emitSpy as sinon.SinonSpy).calledWith("line", "line1").should.be.true()
			;(emitSpy as sinon.SinonSpy).calledWith("line", "line2").should.be.true()
			;(emitSpy as sinon.SinonSpy).calledWith("line", "line3").should.be.true()
		})

		it("should properly handle process hot state (e.g. compiling)", async () => {
			// Create a terminal
			const terminal = TerminalRegistry.createTerminal().terminal
			createdTerminals.push(terminal)

			// Mock the shell integration with C/D markers
			const mockExecuteCommand = sandbox.stub().returns({
				read: () => createMockStreamWithMarkers(["compiling..."]),
			})

			// Create a mock shell integration object and stub the getter
			sandbox.stub(terminal, "shellIntegration").get(() => ({
				executeCommand: mockExecuteCommand,
			}))

			// Spy on global setTimeout
			const setTimeoutSpy = sandbox.spy(global, "setTimeout")

			const runPromise = process.run(terminal, "build command")
			await sandbox.clock.tickAsync(3000)
			await runPromise

			// Move time forward enough to schedule
			sandbox.clock.tick(100)

			// Expect a 15-second (>= 10000ms) hot timeout, since it saw "compiling"
			const foundCompilingTimeout = setTimeoutSpy.args.filter((args) => args[1] && args[1] >= 10000)
			foundCompilingTimeout.length.should.be.greaterThan(0)
		})

		it("should handle standard commands with normal hot timeout", async () => {
			// Create a terminal
			const terminal = TerminalRegistry.createTerminal().terminal
			createdTerminals.push(terminal)

			// Mock the shell integration with C/D markers
			const mockExecuteCommand = sandbox.stub().returns({
				read: () => createMockStreamWithMarkers(["some normal output"]),
			})

			// Create a mock shell integration object and stub the getter
			sandbox.stub(terminal, "shellIntegration").get(() => ({
				executeCommand: mockExecuteCommand,
			}))

			const setTimeoutSpy = sandbox.spy(global, "setTimeout")

			const runPromise = process.run(terminal, "standard command")
			await sandbox.clock.tickAsync(3000)
			await runPromise
			sandbox.clock.tick(100)

			// Expect a short hot timeout (<= 5000)
			const foundNormalTimeout = setTimeoutSpy.args.filter((args) => args[1] && args[1] <= 5000)
			foundNormalTimeout.length.should.be.greaterThan(0)

			const emitSpy = sandbox.spy(process, "emit")
			const runPromise2 = process.run(terminal, "another command")
			await sandbox.clock.tickAsync(3000)
			await runPromise2
			;(emitSpy as sinon.SinonSpy).calledWith("completed").should.be.true()
		})

		it("should exclude command echo (pre-C text) and include output (post-C text)", async () => {
			// Create a terminal
			const terminal = TerminalRegistry.createTerminal().terminal
			createdTerminals.push(terminal)

			// Mock the shell integration with C/D markers around output.
			// "test-command" is the command echo (before C) → excluded by markers.
			// "test command" and "other output" are actual output (after C) → emitted.
			const mockExecuteCommand = sandbox.stub().returns({
				read: () =>
					createMockStreamWithMarkers(
						["test command", "other output"],
						"test-command", // command echo, before C marker
					),
			})

			// Create a mock shell integration object and stub the getter
			sandbox.stub(terminal, "shellIntegration").get(() => ({
				executeCommand: mockExecuteCommand,
			}))

			const emitSpy = sandbox.spy(process, "emit")

			const runPromise = process.run(terminal, "test-command")
			await sandbox.clock.tickAsync(3000)
			await runPromise

			// Output after C should be emitted
			;(emitSpy as sinon.SinonSpy).calledWith("line", "test command").should.be.true()
			;(emitSpy as sinon.SinonSpy).calledWith("line", "other output").should.be.true()
			// Command echo before C should NOT be emitted (excluded by marker gating)
			;(emitSpy as sinon.SinonSpy).calledWith("line", "test-command").should.be.false()
		})

		it("should handle npm run commands", async () => {
			// Create a terminal
			const terminal = TerminalRegistry.createTerminal().terminal
			createdTerminals.push(terminal)

			// Mock the shell integration with C/D markers.
			// "npm run build" is the command echo (before C) → excluded by markers.
			const mockExecuteCommand = sandbox.stub().returns({
				read: () =>
					createMockStreamWithMarkers(
						["> project@1.0.0 build", "> tsc", "files built successfully"],
						"npm run build", // command echo, before C marker
					),
			})

			// Create a mock shell integration object and stub the getter
			sandbox.stub(terminal, "shellIntegration").get(() => ({
				executeCommand: mockExecuteCommand,
			}))

			const emitSpy = sandbox.spy(process, "emit")

			const runPromise = process.run(terminal, "npm run build")
			await sandbox.clock.tickAsync(3000)
			await runPromise

			// The command echo should be excluded; the rest (after C) should be emitted
			;(emitSpy as sinon.SinonSpy).calledWith("line", "> project@1.0.0 build").should.be.true()
			;(emitSpy as sinon.SinonSpy).calledWith("line", "> tsc").should.be.true()
			;(emitSpy as sinon.SinonSpy).calledWith("line", "files built successfully").should.be.true()
		})
	})

	// Markerless fallback: shell integration is attached but not emitting OSC 633
	// markers, e.g. because the user ssh'd from this terminal so commands execute
	// in a remote shell. The read() stream never ends on its own; the process
	// must complete via the idle/prompt heuristics instead of hanging.
	describe("Markerless shell integration (ssh) tests", () => {
		function stubHangingShellIntegration(terminal: vscode.Terminal, chunks: string[]) {
			const mockExecuteCommand = sandbox.stub().returns({
				read: () => createHangingStream(chunks),
			})
			sandbox.stub(terminal, "shellIntegration").get(() => ({
				executeCommand: mockExecuteCommand,
			}))
		}

		it("should complete when output goes quiet on a shell prompt", async () => {
			const terminal = TerminalRegistry.createTerminal().terminal
			createdTerminals.push(terminal)

			// Remote output ending with a prompt line; no C/D markers anywhere.
			stubHangingShellIntegration(terminal, ["remote output\n", "user@remote:~$ "])

			const emitSpy = sandbox.spy(process, "emit")
			const runPromise = process.run(terminal, "ls")

			// First idle check happens after the post-data idle timeout (3s);
			// the buffered text ends with a prompt so the process completes.
			// Add slack for the exit-code race (EXIT_CODE_EVENT_TIMEOUT_MS) that
			// follows the loop.
			await sandbox.clock.tickAsync(15_000)
			await runPromise
			;(emitSpy as sinon.SinonSpy).calledWith("completed").should.be.true()
			;(emitSpy as sinon.SinonSpy).calledWith("continue").should.be.true()
			// The buffered pre-C output is emitted as fallback output
			;(emitSpy as sinon.SinonSpy).calledWith("line", "remote output").should.be.true()
			// The terminal must be evicted from the reuse pool
			;(emitSpy as sinon.SinonSpy).calledWith("no_shell_integration").should.be.true()
		})

		it("should complete after the max quiet time even without a prompt", async () => {
			const terminal = TerminalRegistry.createTerminal().terminal
			createdTerminals.push(terminal)

			// Output that never looks like a prompt.
			stubHangingShellIntegration(terminal, ["output without prompt\n"])

			const emitSpy = sandbox.spy(process, "emit")
			const runPromise = process.run(terminal, "some-command")

			// 30s max quiet time in 3s idle increments, plus the exit-code race
			// (EXIT_CODE_EVENT_TIMEOUT_MS) after the loop.
			await sandbox.clock.tickAsync(45_000)
			await runPromise
			;(emitSpy as sinon.SinonSpy).calledWith("completed").should.be.true()
			;(emitSpy as sinon.SinonSpy).calledWith("continue").should.be.true()
			;(emitSpy as sinon.SinonSpy).calledWith("no_shell_integration").should.be.true()
		})

		it("should complete when no data ever arrives", async () => {
			const terminal = TerminalRegistry.createTerminal().terminal
			createdTerminals.push(terminal)

			// Stream that yields nothing at all.
			stubHangingShellIntegration(terminal, [])

			const emitSpy = sandbox.spy(process, "emit")
			const runPromise = process.run(terminal, "some-command")

			// First-data timeout is 10s; quiet time then accumulates in 10s
			// steps up to the 30s cap. Add slack for the exit-code race.
			await sandbox.clock.tickAsync(60_000)
			await runPromise
			;(emitSpy as sinon.SinonSpy).calledWith("completed").should.be.true()
			;(emitSpy as sinon.SinonSpy).calledWith("continue").should.be.true()
		})

		it("should not apply idle completion once the C marker is seen", async () => {
			const terminal = TerminalRegistry.createTerminal().terminal
			createdTerminals.push(terminal)

			// C marker arrives, then output, then a long silence before the
			// command finishes — a long-running command with working shell
			// integration. The idle fallback must NOT fire during the silence.
			const mockExecuteCommand = sandbox.stub().returns({
				read: () => ({
					async *[Symbol.asyncIterator]() {
						yield OSC633_C
						yield "build started\n"
						await new Promise((resolve) => setTimeout(resolve, 120_000))
						yield "build finished\n"
						yield OSC633_D
					},
				}),
			})
			sandbox.stub(terminal, "shellIntegration").get(() => ({
				executeCommand: mockExecuteCommand,
			}))

			const emitSpy = sandbox.spy(process, "emit")
			const runPromise = process.run(terminal, "slow-build")

			// 120s internal sleep, plus the exit-code race (EXIT_CODE_EVENT_TIMEOUT_MS)
			// after the stream ends — this test's mock never fires
			// onDidEndTerminalShellExecution, so the race always times out.
			await sandbox.clock.tickAsync(120_000 + EXIT_CODE_EVENT_TIMEOUT_MS + 1_000)
			await runPromise
			;(emitSpy as sinon.SinonSpy).calledWith("line", "build started").should.be.true()
			;(emitSpy as sinon.SinonSpy).calledWith("line", "build finished").should.be.true()
			;(emitSpy as sinon.SinonSpy).calledWith("completed").should.be.true()
			// Shell integration worked — the terminal stays reusable
			;(emitSpy as sinon.SinonSpy).calledWith("no_shell_integration").should.be.false()
		})

		it("should complete when the terminal closes mid-command", async () => {
			const terminal = TerminalRegistry.createTerminal().terminal
			createdTerminals.push(terminal)

			stubHangingShellIntegration(terminal, ["partial output\n"])

			// onDidCloseTerminal is driven by real pty shutdown IO, which fake
			// timers cannot advance — use real timers for this test.
			sandbox.clock.restore()

			const emitSpy = sandbox.spy(process, "emit")
			const runPromise = process.run(terminal, "some-command")

			// Let the first chunk arrive, then close the terminal. The close
			// event must interrupt the (otherwise never-ending) stream read.
			await new Promise((resolve) => setTimeout(resolve, 100))
			terminal.dispose()
			await runPromise
			;(emitSpy as sinon.SinonSpy).calledWith("completed").should.be.true()
			;(emitSpy as sinon.SinonSpy).calledWith("continue").should.be.true()
			// A terminal closed mid-command must be distinguishable from a normal
			// completion — callers must not treat this as command success.
			process.getCompletionDetails().terminalClosed?.should.be.true()

			// Restore fake timers for other tests
			sandbox.useFakeTimers()
		})
	})

	it("should emit error without running when the terminal's pty has already exited", async () => {
		const terminal = TerminalRegistry.createTerminal().terminal
		createdTerminals.push(terminal)

		// exitStatus is set when the shell process terminates.
		sandbox.stub(terminal, "exitStatus").get(() => ({ code: 1, reason: 2 }))
		const executeCommandStub = sandbox.stub()
		sandbox.stub(terminal, "shellIntegration").get(() => ({
			executeCommand: executeCommandStub,
		}))
		const sendTextStub = sandbox.stub(terminal, "sendText")

		const errors: Error[] = []
		process.on("error", (error) => errors.push(error))

		await process.run(terminal, "echo test")

		errors.length.should.equal(1)
		errors[0].message.should.containEql("shell process has exited")
		executeCommandStub.called.should.be.false()
		sendTextStub.called.should.be.false()
	})

	// The following tests are shared with the unit tests to ensure consistent behavior
	it("should emit line for remaining buffer when emitRemainingBufferIfListening is called", () => {
		// Access private properties via type assertion
		const processAny = process as any
		processAny.buffer = "test buffer content"
		processAny.isListening = true

		const emitSpy = sandbox.spy(process, "emit")
		processAny.emitRemainingBufferIfListening()
		;(emitSpy as sinon.SinonSpy).calledWith("line", "test buffer content").should.be.true()
		processAny.buffer.should.equal("")
	})

	it("should remove prompt characters from the last line of output", () => {
		const processAny = process as any

		processAny.removeLastLineArtifacts("line 1\nline 2 %").should.equal("line 1\nline 2")
		processAny.removeLastLineArtifacts("line 1\nline 2 $").should.equal("line 1\nline 2")
		processAny.removeLastLineArtifacts("line 1\nline 2 #").should.equal("line 1\nline 2")
		processAny.removeLastLineArtifacts("line 1\nline 2 >").should.equal("line 1\nline 2")
	})

	it("should process buffer and emit lines when newline characters are found", () => {
		const processAny = process as any
		const emitSpy = sandbox.spy(process, "emit")

		processAny.emitIfEol("line 1\nline 2\nline 3")
		;(emitSpy as sinon.SinonSpy).calledWith("line", "line 1").should.be.true()
		;(emitSpy as sinon.SinonSpy).calledWith("line", "line 2").should.be.true()
		processAny.buffer.should.equal("line 3")

		processAny.emitIfEol(" continued\n")
		;(emitSpy as sinon.SinonSpy).calledWith("line", "line 3 continued").should.be.true()
		processAny.buffer.should.equal("")
	})

	it("detach emits continue but keeps line listeners attached and listening", () => {
		const processAny = process as any
		const continueEvents: number[] = []
		const lines: string[] = []
		process.on("continue", () => continueEvents.push(1))
		process.on("line", (line) => lines.push(line))

		process.detach()
		continueEvents.length.should.equal(1)

		// Unlike continue(), detach must not stop listening or drop 'line'
		// listeners: output after detach still reaches subscribers (this is
		// what streams the rest of a detached command to the log file).
		processAny.isListening.should.be.true()
		processAny.emitIfEol("after detach\n")
		lines.should.containEql("after detach")
	})

	it("detach flushes a buffered partial line before emitting continue", () => {
		const processAny = process as any
		const events: string[] = []
		process.on("continue", () => events.push("continue"))
		process.on("line", (line) => events.push(`line:${line}`))

		// A chunk with no trailing newline stays in the internal buffer.
		processAny.emitIfEol("partial output")
		processAny.buffer.should.equal("partial output")

		process.detach()

		// The partial line must reach listeners before 'continue' resolves the
		// awaited promise; otherwise it is missing from the partial output and
		// from the log's initial flush.
		events.should.eql(["line:partial output", "continue"])
		processAny.buffer.should.equal("")
	})
})
