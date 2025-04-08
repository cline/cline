import { describe, it, beforeEach, afterEach, expect, vi } from "vitest"
import { TerminalProcess } from "../TerminalProcess"
import * as vscode from "vscode"
import { TerminalRegistry } from "../TerminalRegistry"

declare module "vscode" {
	// https://github.com/microsoft/vscode/blob/f0417069c62e20f3667506f4b7e53ca0004b4e3e/src/vscode-dts/vscode.d.ts#L7442
	interface Terminal {
		shellIntegration?: {
			cwd?: vscode.Uri
			executeCommand?: (command: string) => {
				read: () => AsyncIterable<string>
			}
		}
	}
}

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

describe("TerminalProcess (Integration Tests)", () => {
	let process: TerminalProcess
	let createdTerminals: vscode.Terminal[] = []

	beforeEach(() => {
		vi.useFakeTimers()
		process = new TerminalProcess()
	})

	afterEach(() => {
		// Restore timers
		vi.useRealTimers()
		// Remove any event listeners left on the TerminalProcess
		process.removeAllListeners()
		// Dispose all terminals created during the test
		createdTerminals.forEach((t) => t.dispose())
		createdTerminals = []
	})

	describe("Real terminal tests", () => {
		// This test works with or without shell integration
		it("should create and run a command in a real terminal", async () => {
			// Create a real VS Code terminal for testing
			const terminal = TerminalRegistry.createTerminal().terminal
			createdTerminals.push(terminal)

			// Spy on emit to verify behavior
			const emitSpy = vi.spyOn(process, "emit")

			// Run a simple command
			await process.run(terminal, "echo test")

			// Verify that the continue event was emitted
			expect(emitSpy).toHaveBeenCalledWith("continue")
			expect(emitSpy).toHaveBeenCalledWith("completed")
		})

		it("should execute and capture events from a simple command", async () => {
			// Create a real VS Code terminal
			const terminal = TerminalRegistry.createTerminal().terminal
			createdTerminals.push(terminal)

			// Spy on emit to verify line events
			const emitSpy = vi.spyOn(process, "emit")

			// Run a command that produces predictable output
			await process.run(terminal, "echo 'Line 1' && echo 'Line 2'")

			// Check that the events were emitted
			expect(emitSpy).toHaveBeenCalledWith("completed")
			expect(emitSpy).toHaveBeenCalledWith("continue")
		})

		it("should execute a command that lists files", async () => {
			// Create a real VS Code terminal
			const terminal = TerminalRegistry.createTerminal().terminal
			createdTerminals.push(terminal)

			// Spy on emit to verify behavior
			const emitSpy = vi.spyOn(process, "emit")

			// Run a command that lists files
			await process.run(terminal, "ls -la")

			// Verify that the continue event was emitted
			expect(emitSpy).toHaveBeenCalledWith("continue")
			expect(emitSpy).toHaveBeenCalledWith("completed")
		})

		it("should handle a longer running command", async () => {
			// Create a real terminal
			const terminal = TerminalRegistry.createTerminal().terminal
			createdTerminals.push(terminal)

			// Spy on emit to verify behavior
			const emitSpy = vi.spyOn(process, "emit")

			// Un-fake timers temporarily for this test since we need real timing
			vi.useRealTimers()

			// Run a command that sleeps for a short period
			await process.run(terminal, "sleep 0.5 && echo 'Done sleeping'")

			// Verify that the continue and completed events were emitted
			expect(emitSpy).toHaveBeenCalledWith("continue")
			expect(emitSpy).toHaveBeenCalledWith("completed")

			// Restore fake timers for other tests
			vi.useFakeTimers()
		})

		it("should execute a command with arguments", async () => {
			// Create a real VS Code terminal
			const terminal = TerminalRegistry.createTerminal().terminal
			createdTerminals.push(terminal)

			// Spy on emit to verify line events
			const emitSpy = vi.spyOn(process, "emit")

			// Run a command that produces predictable output
			await process.run(terminal, "echo 'Line 1' 'Line 2'")

			// Check that the events were emitted
			expect(emitSpy).toHaveBeenCalledWith("completed")
			expect(emitSpy).toHaveBeenCalledWith("continue")
		})

		it("should execute a command with quotes", async () => {
			// Create a real VS Code terminal
			const terminal = TerminalRegistry.createTerminal().terminal
			createdTerminals.push(terminal)

			// Spy on emit to verify line events
			const emitSpy = vi.spyOn(process, "emit")

			// Run a command that produces predictable output
			await process.run(terminal, "echo \"Line 1\" && echo 'Line 2'")

			// Check that the events were emitted
			expect(emitSpy).toHaveBeenCalledWith("completed")
			expect(emitSpy).toHaveBeenCalledWith("continue")
		})
	})

	// Test that specifically checks for no shell integration
	it("should handle terminals without shell integration", async () => {
		// Create a real terminal without explicitly providing shell integration
		const terminal = vscode.window.createTerminal({ name: "Test Terminal" })
		createdTerminals.push(terminal)

		// Stub the shellIntegration getter to return undefined for this test
		vi.spyOn(terminal, "shellIntegration", "get").mockReturnValue(undefined)

		// Stub the sendText method to verify it's called
		const sendTextStub = vi.spyOn(terminal, "sendText").mockImplementation(() => {})

		// Spy on the emit function to verify events
		const emitSpy = vi.spyOn(process, "emit")

		// Run the command
		await process.run(terminal, "test-command")

		// Check that the correct methods were called and events emitted
		expect(sendTextStub).toHaveBeenCalledWith("test-command", true)
		expect(emitSpy).toHaveBeenCalledWith("completed")
		expect(emitSpy).toHaveBeenCalledWith("continue")

		// This event should be emitted for terminals without shell integration
		expect(emitSpy).toHaveBeenCalledWith("no_shell_integration")
	})

	// The following tests require shell integration and controlled terminal output
	describe("Shell integration tests", () => {
		// We'll mock the terminal run process and TerminalProcess for these tests
		it("should emit completed and continue events when command finishes", async function () {
			// Create a terminal to ensure proper interface, but we'll use mocking under the hood
			const terminal = TerminalRegistry.createTerminal().terminal
			createdTerminals.push(terminal)

			// Create a mock implementation of executeCommand
			const mockExecuteCommand = vi.fn().mockReturnValue({
				read: () => createMockStream(["echo test", "test output"]),
			})

			// Create a fake shell integration object
			const mockShellIntegration = {
				executeCommand: mockExecuteCommand,
			}

			// Stub terminal.shellIntegration to return our mock
			vi.spyOn(terminal, "shellIntegration", "get").mockReturnValue(mockShellIntegration)

			// Spy on emit to verify behavior
			const emitSpy = vi.spyOn(process, "emit")

			// Run the command
			await process.run(terminal, "echo test")

			// Verify the executeCommand was called with the right command
			expect(mockExecuteCommand).toHaveBeenCalledWith("echo test")

			// Check that the events were emitted
			expect(emitSpy).toHaveBeenCalledWith("completed")
			expect(emitSpy).toHaveBeenCalledWith("continue")
		})
	})

	// Tests with controlled output
	describe("Controlled output tests", () => {
		it("should emit line events for each line of output", async function () {
			// Create a terminal
			const terminal = TerminalRegistry.createTerminal().terminal
			createdTerminals.push(terminal)

			// Mock the shell integration with controlled output
			const mockExecuteCommand = vi.fn().mockReturnValue({
				read: () => createMockStream(["test-command", "line1", "line2", "line3"]),
			})

			// Create a mock shell integration object and stub the getter
			vi.spyOn(terminal, "shellIntegration", "get").mockReturnValue({
				executeCommand: mockExecuteCommand,
			})

			const emitSpy = vi.spyOn(process, "emit")

			await process.run(terminal, "test-command")

			// Check that line events were emitted for each line
			expect(emitSpy).toHaveBeenCalledWith("line", "line1")
			expect(emitSpy).toHaveBeenCalledWith("line", "line2")
			expect(emitSpy).toHaveBeenCalledWith("line", "line3")
		})

		it("should properly handle process hot state (e.g. compiling)", async function () {
			// Create a terminal
			const terminal = TerminalRegistry.createTerminal().terminal
			createdTerminals.push(terminal)

			// Mock the shell integration
			const mockExecuteCommand = vi.fn().mockReturnValue({
				read: () => createMockStream(["compiling..."]),
			})

			// Create a mock shell integration object and stub the getter
			vi.spyOn(terminal, "shellIntegration", "get").mockReturnValue({
				executeCommand: mockExecuteCommand,
			})

			// Spy on global setTimeout
			const setTimeoutSpy = vi.spyOn(global, "setTimeout")

			await process.run(terminal, "build command")

			// Move time forward enough to schedule
			vi.advanceTimersByTime(100)

			// Expect a 15-second (>= 10000ms) hot timeout, since it saw "compiling"
			const foundCompilingTimeout = setTimeoutSpy.mock.calls.filter((args) => args[1] && args[1] >= 10000)
			expect(foundCompilingTimeout.length).toBeGreaterThan(0)
		})

		it("should handle standard commands with normal hot timeout", async function () {
			// Create a terminal
			const terminal = TerminalRegistry.createTerminal().terminal
			createdTerminals.push(terminal)

			// Mock the shell integration
			const mockExecuteCommand = vi.fn().mockReturnValue({
				read: () => createMockStream(["some normal output"]),
			})

			// Create a mock shell integration object and stub the getter
			vi.spyOn(terminal, "shellIntegration", "get").mockReturnValue({
				executeCommand: mockExecuteCommand,
			})

			const setTimeoutSpy = vi.spyOn(global, "setTimeout")

			await process.run(terminal, "standard command")
			vi.advanceTimersByTime(100)

			// Expect a short hot timeout (<= 5000)
			const foundNormalTimeout = setTimeoutSpy.mock.calls.filter((args) => args[1] && args[1] <= 5000)
			expect(foundNormalTimeout.length).toBeGreaterThan(0)

			// Also check that "completed" eventually emits
			const emitSpy = vi.spyOn(process, "emit")
			await process.run(terminal, "another command")
			expect(emitSpy).toHaveBeenCalledWith("completed")
		})

		it("should correctly filter command echoes based on current implementation", async function () {
			// Create a terminal
			const terminal = TerminalRegistry.createTerminal().terminal
			createdTerminals.push(terminal)

			// Mock the shell integration
			const mockExecuteCommand = vi.fn().mockReturnValue({
				read: () =>
					createMockStream([
						"test-command", // This should be filtered (command contains this exactly)
						"test command", // This should NOT be filtered (doesn't match exactly)
						"other output",
					]),
			})

			// Create a mock shell integration object and stub the getter
			vi.spyOn(terminal, "shellIntegration", "get").mockReturnValue({
				executeCommand: mockExecuteCommand,
			})

			const emitSpy = vi.spyOn(process, "emit")

			await process.run(terminal, "test-command")

			// Check that "test-command" was filtered out but "test command" was not
			expect(emitSpy).toHaveBeenCalledWith("line", "test command")
			expect(emitSpy).toHaveBeenCalledWith("line", "other output")
			// This should never be called because it should be filtered
			expect(emitSpy).not.toHaveBeenCalledWith("line", "test-command")
		})

		it("should handle npm run commands", async function () {
			// Create a terminal
			const terminal = TerminalRegistry.createTerminal().terminal
			createdTerminals.push(terminal)

			// Mock the shell integration
			const mockExecuteCommand = vi.fn().mockReturnValue({
				read: () => createMockStream(["npm run build", "> project@1.0.0 build", "> tsc", "files built successfully"]),
			})

			// Create a mock shell integration object and stub the getter
			vi.spyOn(terminal, "shellIntegration", "get").mockReturnValue({
				executeCommand: mockExecuteCommand,
			})

			const emitSpy = vi.spyOn(process, "emit")

			await process.run(terminal, "npm run build")

			// The "npm run build" line should be filtered, but the rest should be emitted
			expect(emitSpy).toHaveBeenCalledWith("line", "> project@1.0.0 build")
			expect(emitSpy).toHaveBeenCalledWith("line", "> tsc")
			expect(emitSpy).toHaveBeenCalledWith("line", "files built successfully")
		})
	})

	// The following tests are shared with the unit tests to ensure consistent behavior
	it("should emit line for remaining buffer when emitRemainingBufferIfListening is called", () => {
		// Access private properties via type assertion
		const processAny = process as any
		processAny.buffer = "test buffer content"
		processAny.isListening = true

		const emitSpy = vi.spyOn(process, "emit")
		processAny.emitRemainingBufferIfListening()
		expect(emitSpy).toHaveBeenCalledWith("line", "test buffer content")
		expect(processAny.buffer).toBe("")
	})

	it("should remove prompt characters from the last line of output", () => {
		const processAny = process as any

		expect(processAny.removeLastLineArtifacts("line 1\nline 2 %")).toBe("line 1\nline 2")
		expect(processAny.removeLastLineArtifacts("line 1\nline 2 $")).toBe("line 1\nline 2")
		expect(processAny.removeLastLineArtifacts("line 1\nline 2 #")).toBe("line 1\nline 2")
		expect(processAny.removeLastLineArtifacts("line 1\nline 2 >")).toBe("line 1\nline 2")
	})

	it("should process buffer and emit lines when newline characters are found", () => {
		const processAny = process as any
		const emitSpy = vi.spyOn(process, "emit")

		processAny.emitIfEol("line 1\nline 2\nline 3")
		expect(emitSpy).toHaveBeenCalledWith("line", "line 1")
		expect(emitSpy).toHaveBeenCalledWith("line", "line 2")
		expect(processAny.buffer).toBe("line 3")

		processAny.emitIfEol(" continued\n")
		expect(emitSpy).toHaveBeenCalledWith("line", "line 3 continued")
		expect(processAny.buffer).toBe("")
	})
})
