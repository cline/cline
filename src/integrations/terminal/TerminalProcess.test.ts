import { describe, it, beforeEach, afterEach } from "mocha"
import "should"
import * as sinon from "sinon"
import { TerminalProcess } from "./TerminalProcess"
import * as vscode from "vscode"

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

class MockTerminal {
	public shellIntegration?: {
		cwd?: { fsPath: string }
		executeCommand?: sinon.SinonStub
	}
	public sendText: sinon.SinonStub

	constructor(withShellIntegration = true) {
		this.sendText = sinon.stub()
		if (withShellIntegration) {
			this.shellIntegration = {
				cwd: { fsPath: "/test/directory" }, // Plain object instead of vscode.Uri.file
				executeCommand: sinon.stub().returns({
					read: () => this.createMockStream(),
				}),
			}
		}
	}

	private createMockStream() {
		return {
			async *[Symbol.asyncIterator]() {
				yield "test-command\n"
				yield "line1\n"
				yield "line2\n"
				yield "line3\n"
			},
		}
	}
}

describe("TerminalProcess (Mock-based Tests)", () => {
	let process: TerminalProcess
	let sandbox: sinon.SinonSandbox

	beforeEach(() => {
		sandbox = sinon.createSandbox({ useFakeTimers: true })
		process = new TerminalProcess()
	})

	afterEach(() => {
		// Restore sandbox, which restores timers and all Sinon fakes
		sandbox.restore()
		// Remove any event listeners left on the TerminalProcess
		process.removeAllListeners()
	})

	it("should use mock terminal", async () => {
		const mockTerminal = new MockTerminal() as any
		await process.run(mockTerminal, "test-command")
		mockTerminal.shellIntegration.executeCommand.calledOnce.should.be.true()
	})

	it("should emit line events for each line of output", async () => {
		// Arrange
		const mockTerminal = new MockTerminal() as any
		const emitSpy = sandbox.spy(process, "emit")

		// Act
		await process.run(mockTerminal, "test-command")

		// Assert
		;(emitSpy as sinon.SinonSpy).calledWith("line", "line1").should.be.true()
		;(emitSpy as sinon.SinonSpy).calledWith("line", "line2").should.be.true()
		;(emitSpy as sinon.SinonSpy).calledWith("line", "line3").should.be.true()
	})

	it("should emit completed and continue events when command finishes", async () => {
		const mockTerminal = new MockTerminal() as any
		const emitSpy = sandbox.spy(process, "emit")

		await process.run(mockTerminal, "test-command")
		;(emitSpy as sinon.SinonSpy).calledWith("completed").should.be.true()
		;(emitSpy as sinon.SinonSpy).calledWith("continue").should.be.true()
	})

	it("should handle terminals without shell integration", async () => {
		const mockTerminal = new MockTerminal(false) as any // No shellIntegration
		const emitSpy = sandbox.spy(process, "emit")

		await process.run(mockTerminal, "test-command")

		mockTerminal.sendText.calledWith("test-command", true).should.be.true()
		;(emitSpy as sinon.SinonSpy).calledWith("completed").should.be.true()
		;(emitSpy as sinon.SinonSpy).calledWith("continue").should.be.true()
		;(emitSpy as sinon.SinonSpy).calledWith("no_shell_integration").should.be.true()
	})

	it("should properly handle process hot state (e.g. compiling)", async () => {
		// Create a mock stream that yields something like "compiling..."
		const compilingMockStream = {
			async *[Symbol.asyncIterator]() {
				yield "compiling...\n"
			},
		}
		const mockTerminal = new MockTerminal() as any
		// Stub the executeCommand to return the "compiling" output
		mockTerminal.shellIntegration.executeCommand = sandbox.stub().returns({
			read: () => compilingMockStream,
		})
		// Spy on global setTimeout
		const setTimeoutSpy = sandbox.spy(global, "setTimeout")

		await process.run(mockTerminal, "build command")

		// Move time forward enough to schedule
		sandbox.clock.tick(100)

		// Expect a 15-second (>= 10000ms) hot timeout, since it saw "compiling"
		const foundCompilingTimeout = setTimeoutSpy.args.filter((args) => args[1] && args[1] >= 10000)
		foundCompilingTimeout.length.should.be.greaterThan(0)
	})

	it("should handle standard commands with normal hot timeout", async () => {
		// A stream that doesn't mention compiling => normal 2-second timeout
		const standardMockStream = {
			async *[Symbol.asyncIterator]() {
				yield "some normal output\n"
			},
		}
		const mockTerminal = new MockTerminal() as any
		mockTerminal.shellIntegration.executeCommand = sandbox.stub().returns({
			read: () => standardMockStream,
		})
		const setTimeoutSpy = sandbox.spy(global, "setTimeout")

		await process.run(mockTerminal, "standard command")
		sandbox.clock.tick(100)

		// Expect a short hot timeout (<= 5000)
		const foundNormalTimeout = setTimeoutSpy.args.filter((args) => args[1] && args[1] <= 5000)
		foundNormalTimeout.length.should.be.greaterThan(0)

		// Also check that "completed" eventually emits
		const emitSpy = sandbox.spy(process, "emit")
		await process.run(mockTerminal, "another command")
		;(emitSpy as sinon.SinonSpy).calledWith("completed").should.be.true()
	})

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

	it("should correctly filter command echoes based on current implementation", async () => {
		// This test verifies the current filtering implementation:
		// if command.includes(line.trim()), the line is filtered out
		const commandEchoStream = {
			async *[Symbol.asyncIterator]() {
				yield "test-command\n" // This should be filtered (command contains this exactly)
				yield "test command\n" // This should NOT be filtered (doesn't match exactly)
				yield "other output\n"
			},
		}
		const mockTerminal = new MockTerminal() as any
		mockTerminal.shellIntegration.executeCommand = sandbox.stub().returns({
			read: () => commandEchoStream,
		})
		const emitSpy = sandbox.spy(process, "emit")

		await process.run(mockTerminal, "test-command")

		// Should not emit the first line (it's the command echo)
		;(emitSpy as sinon.SinonSpy).calledWith("line", "test-command").should.be.false()
		// Should emit the other lines
		;(emitSpy as sinon.SinonSpy).calledWith("line", "test command").should.be.true()
		;(emitSpy as sinon.SinonSpy).calledWith("line", "other output").should.be.true()
	})

	it("should correctly handle 'npm run' commands", async () => {
		// When running 'npm run build', the initial output might contain "npm run build"
		// which would be filtered, but we need other related output
		const npmRunStream = {
			async *[Symbol.asyncIterator]() {
				yield "npm run build\n" // This should be filtered
				yield "> project@1.0.0 build\n" // Should be kept
				yield "> webpack --mode production\n" // Should be kept
				yield "Hash: 1a2b3c4d5e\n" // Should be kept
			},
		}
		const mockTerminal = new MockTerminal() as any
		mockTerminal.shellIntegration.executeCommand = sandbox.stub().returns({
			read: () => npmRunStream,
		})
		const emitSpy = sandbox.spy(process, "emit")

		await process.run(mockTerminal, "npm run build")

		// Should not emit the npm run build line (it's the command echo)
		;(emitSpy as sinon.SinonSpy).calledWith("line", "npm run build").should.be.false()
		// Should emit the other lines
		;(emitSpy as sinon.SinonSpy).calledWith("line", "> project@1.0.0 build").should.be.true()
		;(emitSpy as sinon.SinonSpy).calledWith("line", "> webpack --mode production").should.be.true()
		;(emitSpy as sinon.SinonSpy).calledWith("line", "Hash: 1a2b3c4d5e").should.be.true()
	})
})
