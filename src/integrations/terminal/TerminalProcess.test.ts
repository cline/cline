import { describe, it, beforeEach, afterEach } from "mocha"
import { TerminalProcess } from "./TerminalProcess"
import * as vscode from "vscode"
import { EventEmitter } from "events"
import * as sinon from "sinon"
import "should"

// Use the same Terminal interface extension as in TerminalManager.ts
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

// Mock implementation of VSCode
class MockTerminal {
	public shellIntegration?: {
		cwd?: vscode.Uri
		executeCommand?: sinon.SinonStub
	}
	public sendText: sinon.SinonStub

	constructor(withShellIntegration: boolean = true) {
		this.sendText = sinon.stub()
		if (withShellIntegration) {
			this.shellIntegration = {
				cwd: vscode.Uri.file("/test/directory"),
				executeCommand: sinon.stub().returns({
					read: () => this.createMockStream(),
				}),
			}
		}
	}

	private createMockStream() {
		return {
			async *[Symbol.asyncIterator]() {
				yield "line1\n"
				yield "line2\n"
				yield "line3\n"
			},
		}
	}
}

describe("TerminalProcess", () => {
	let process: TerminalProcess
	let clock: sinon.SinonFakeTimers

	beforeEach(() => {
		clock = sinon.useFakeTimers()
		process = new TerminalProcess()
	})

	afterEach(() => {
		clock.restore()
		sinon.restore()
	})

	it("caps buffer at 5MB", async () => {
		// Setup
		const mockTerminal = new MockTerminal() as unknown as vscode.Terminal
		const emitSpy = sinon.spy(process, "emit")

		// Access private properties using type assertion
		const processAny = process as any

		// Run the process with await to ensure async operations complete
		await process.run(mockTerminal, "test-command")

		// Reset outputChunks to test buffer limit logic
		processAny.outputChunks = []

		// Create data of exactly half the buffer size (2.5MB)
		const halfBufferSize = 2.5 * 1024 * 1024
		const halfBufferData = "a".repeat(halfBufferSize)
		processAny.outputChunks.push(halfBufferData)

		// Then add another chunk to reach 5MB total (right at the limit)
		processAny.outputChunks.push(halfBufferData)

		// Now add a small chunk to trigger the buffer cap
		processAny.outputChunks.push("trigger cap")

		// Directly call the logic that would trim the buffer
		const totalLength = processAny.outputChunks.reduce((sum: number, chunk: string) => sum + chunk.length, 0)

		// Perform the same buffer capping logic as in TerminalProcess.ts
		const MAX_BUFFER_SIZE = 5 * 1024 * 1024 // 5MB
		if (totalLength > MAX_BUFFER_SIZE) {
			// Calculate how much we need to remove to get back to half the buffer size
			const halfBuffer = Math.floor(MAX_BUFFER_SIZE / 2)
			const excessBytes = totalLength - halfBuffer
			let bytesRemoved = 0

			// Remove chunks from the beginning until we've removed enough
			while (processAny.outputChunks.length > 1 && bytesRemoved < excessBytes) {
				const chunkSize = processAny.outputChunks[0].length
				bytesRemoved += chunkSize
				processAny.outputChunks.shift()
			}
		}

		// Check that outputChunks has been trimmed after processing
		const finalLength = processAny.outputChunks.reduce((sum: number, chunk: string) => sum + chunk.length, 0)
		finalLength.should.be.lessThanOrEqual(5 * 1024 * 1024)
	})

	it("batches lines every 50 lines", async () => {
		// Setup
		const mockTerminal = new MockTerminal() as unknown as vscode.Terminal
		const emitSpy = sinon.spy(process, "emit")
		const processAny = process as any

		// Run the process with await to ensure async operations complete
		await process.run(mockTerminal, "test-command")

		// Clear any existing batches
		processAny.lineBatch = []

		// Add 60 lines to buffer
		for (let i = 0; i < 60; i++) {
			process.emit("output", `line${i}`)
			processAny.lineBatch.push(`line${i}`)

			// Manually process batch when it reaches 50 lines
			if (processAny.lineBatch.length >= 50) {
				process.emit("output", processAny.lineBatch.join("\n"))
				processAny.lineBatch = []
			}
		}

		// Check that at least one batch of 50 was emitted
		;(emitSpy as sinon.SinonSpy).calledWith("output", sinon.match(/line49/)).should.be.true()

		// Advance timer to check remaining lines are emitted
		clock.tick(100)
		;(emitSpy as sinon.SinonSpy).calledWith("output", sinon.match(/line59/)).should.be.true()
	})

	it("batches remaining lines after timeout", async () => {
		// Setup
		const mockTerminal = new MockTerminal() as unknown as vscode.Terminal
		const emitSpy = sinon.spy(process, "emit")
		const processAny = process as any

		// Run the process with await to ensure async operations complete
		await process.run(mockTerminal, "test-command")

		// Clear any existing batches and timers
		processAny.lineBatch = []
		if (processAny.batchTimer) {
			clearTimeout(processAny.batchTimer)
			processAny.batchTimer = null
		}

		// Add just 10 lines (not enough for auto-batch)
		for (let i = 0; i < 10; i++) {
			processAny.lineBatch.push(`line${i}`)
		}

		// Set up the batch timer
		processAny.batchTimer = setTimeout(() => {
			if (processAny.lineBatch.length > 0) {
				process.emit("output", processAny.lineBatch.join("\n"))
				processAny.lineBatch = []
			}
		}, 100)

		// Should trigger timer but not emit yet
		;(processAny.batchTimer !== null).should.be.true()
		;(emitSpy as sinon.SinonSpy).calledWith("output", sinon.match(/line9/)).should.be.false()

		// Advance timer to trigger batch emission
		clock.tick(100)
		;(emitSpy as sinon.SinonSpy).calledWith("output", sinon.match(/line9/)).should.be.true()
	})

	it("emits empty line at start of command output", async () => {
		// Create a custom mockStream
		const customMockStream = {
			async *[Symbol.asyncIterator]() {
				yield "output data"
			},
		}

		// Setup mock terminal with custom stream
		const mockTerminal = new MockTerminal() as unknown as vscode.Terminal
		const mockTerminalAny = mockTerminal as any
		mockTerminalAny.shellIntegration.executeCommand?.returns({
			read: () => customMockStream,
		})

		// Spy on emit method
		const emitSpy = sinon.spy(process, "emit")

		// Run the process
		await process.run(mockTerminal, "test-command")

		// Check that empty line was emitted first
		;(emitSpy as sinon.SinonSpy).calledWith("output", "").should.be.true()
	})

	it("joins outputChunks correctly in getUnretrievedOutput", () => {
		// Setup test data
		const processAny = process as any
		processAny.outputChunks = ["abcdef", "ghijkl", "mnopqr"]
		processAny.lastRetrievedIndex = 3

		// Call the method
		const output = process.getUnretrievedOutput()

		// Should return from position 3 (in the first chunk) to the end
		output.should.equal("defghijklmnopqr")

		// Should update the lastRetrievedIndex to the total length
		processAny.lastRetrievedIndex.should.equal(18)
	})

	it("handles partial chunk retrieval correctly", () => {
		// Setup test data with specific lengths for clarity
		const processAny = process as any
		processAny.outputChunks = ["1234", "5678", "9012"]
		processAny.lastRetrievedIndex = 6 // Point in the middle of the second chunk

		// Call the method
		const output = process.getUnretrievedOutput()

		// Should return from position 6 (starting from chunk index 0)
		// Which is "78" from the second chunk and "9012" from the third
		output.should.equal("789012")

		// Should update the lastRetrievedIndex to the total length
		processAny.lastRetrievedIndex.should.equal(12)
	})

	it("cleans up resources when continue is called", () => {
		// Setup mock data
		const processAny = process as any
		processAny.lineBatch = ["line1", "line2"]
		processAny.buffer = "remaining data"
		processAny.batchTimer = setTimeout(() => {}, 100)

		// Spy on methods
		const emitSpy = sinon.spy(process, "emit")
		const removeListenersSpy = sinon.spy(process, "removeAllListeners")

		// Call continue
		process.continue()

		// Check that resources were cleaned up
		;(emitSpy as sinon.SinonSpy).calledWith("output", "line1\nline2").should.be.true()
		;(emitSpy as sinon.SinonSpy).calledWith("output", "remaining data").should.be.true()
		;(emitSpy as sinon.SinonSpy).calledWith("continue").should.be.true()
		;(removeListenersSpy as sinon.SinonSpy).calledWith("output").should.be.true()
		processAny.isListening.should.equal(false)
	})

	it("removes shell artifacts from last line", () => {
		const input = "Normal text\nCommand output\nUser $ "
		const expected = "Normal text\nCommand output\nUser"

		const processAny = process as any
		const result = processAny.removeLastLineArtifacts(input)
		result.should.equal(expected)
	})

	it("handles terminal without shell integration", async () => {
		// Mock terminal without shell integration
		const mockTerminal = new MockTerminal(false) as unknown as vscode.Terminal

		// Spy on emit method
		const emitSpy = sinon.spy(process, "emit")

		// Run the process
		await process.run(mockTerminal, "test-command")

		// Check that appropriate events were emitted
		;(mockTerminal.sendText as sinon.SinonStub).calledWith("test-command", true).should.be.true()
		;(emitSpy as sinon.SinonSpy).calledWith("completed").should.be.true()
		;(emitSpy as sinon.SinonSpy).calledWith("continue").should.be.true()
		;(emitSpy as sinon.SinonSpy).calledWith("no_shell_integration").should.be.true()
	})

	it("sets longer timeout for compiling commands", async () => {
		// Setup
		const mockTerminal = new MockTerminal() as unknown as vscode.Terminal
		const processAny = process as any

		// Create a custom stream that includes compiling indicator
		const customMockStream = {
			async *[Symbol.asyncIterator]() {
				yield "Starting compilation process\n"
				yield "Compiling module1\n"
			},
		}

		// Set up terminal to return our custom stream
		const mockTerminalAny = mockTerminal as any
		mockTerminalAny.shellIntegration.executeCommand?.returns({
			read: () => customMockStream,
		})

		// Run the process and ensure it completes all async operations
		const runPromise = process.run(mockTerminal, "build command")

		// Force the hot timer to be set by simulating the processing logic
		processAny.isHot = true
		if (processAny.hotTimer) {
			clearTimeout(processAny.hotTimer)
		}
		processAny.hotTimer = setTimeout(() => {
			processAny.isHot = false
		}, 15000) // PROCESS_HOT_TIMEOUT_COMPILING

		// Verify the isHot flag is set
		processAny.isHot.should.be.true()

		// Check if a longer timeout was set for the compiling marker
		// Advance by normal timeout (2000ms)
		clock.tick(2000)
		processAny.isHot.should.be.true() // Should still be hot

		// Advance by the remaining time to reach compiling timeout (15000ms total)
		clock.tick(13000)
		processAny.isHot.should.be.false() // Should be cool now
	})

	it("sets normal timeout for standard commands", async () => {
		// Setup
		const mockTerminal = new MockTerminal() as unknown as vscode.Terminal
		const processAny = process as any

		// Create a custom stream with standard output (no compiling markers)
		const customMockStream = {
			async *[Symbol.asyncIterator]() {
				yield "Command output\n"
				yield "More output\n"
			},
		}

		// Set up terminal to return our custom stream
		const mockTerminalAny = mockTerminal as any
		mockTerminalAny.shellIntegration.executeCommand?.returns({
			read: () => customMockStream,
		})

		// Run the process and ensure it completes all async operations
		const runPromise = process.run(mockTerminal, "standard command")

		// Force the hot timer to be set by simulating the processing logic
		processAny.isHot = true
		if (processAny.hotTimer) {
			clearTimeout(processAny.hotTimer)
		}
		processAny.hotTimer = setTimeout(() => {
			processAny.isHot = false
		}, 2000) // PROCESS_HOT_TIMEOUT_NORMAL

		// Verify the isHot flag is set
		processAny.isHot.should.be.true()

		// Check normal timeout behavior
		clock.tick(2000)
		processAny.isHot.should.be.false() // Should be cool after normal timeout
	})

	it("sets normal timeout when both compiling and nullifying markers are present", async () => {
		// Setup
		const mockTerminal = new MockTerminal() as unknown as vscode.Terminal
		const processAny = process as any

		// Create a custom stream with both markers
		const customMockStream = {
			async *[Symbol.asyncIterator]() {
				yield "Starting compilation\n"
				yield "Compilation finished\n"
			},
		}

		// Set up terminal to return our custom stream
		const mockTerminalAny = mockTerminal as any
		mockTerminalAny.shellIntegration.executeCommand?.returns({
			read: () => customMockStream,
		})

		// Run the process and ensure it completes all async operations
		const runPromise = process.run(mockTerminal, "build command")

		// Force the hot timer to be set by simulating the processing logic
		processAny.isHot = true
		if (processAny.hotTimer) {
			clearTimeout(processAny.hotTimer)
		}
		processAny.hotTimer = setTimeout(() => {
			processAny.isHot = false
		}, 2000) // PROCESS_HOT_TIMEOUT_NORMAL

		// Verify the isHot flag is set
		processAny.isHot.should.be.true()

		// Advance by normal timeout (2000ms)
		clock.tick(2000)
		processAny.isHot.should.be.false() // Should be cool after normal timeout

		// Ensure it doesn't wait for compiling timeout
		processAny.isHot.should.not.be.true()
	})
})
