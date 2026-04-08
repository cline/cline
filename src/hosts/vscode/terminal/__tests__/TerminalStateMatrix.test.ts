import { afterEach, beforeEach, describe, it } from "mocha"
import { setVscodeHostProviderMock } from "@/test/host-provider-test-utils"
import "should"
import * as sinon from "sinon"
import * as vscode from "vscode"
import { VscodeTerminalProcess } from "../VscodeTerminalProcess"

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

describe("Terminal Completion Priority Matrix", () => {
	let process: VscodeTerminalProcess
	let sandbox: sinon.SinonSandbox
	let clock: sinon.SinonFakeTimers
	let endListener: (e: any) => void

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		clock = sandbox.useFakeTimers()
		setVscodeHostProviderMock()
		process = new VscodeTerminalProcess()

		// Ensure the property exists on the mock before stubbing
		if (!(vscode.window as any).onDidEndTerminalShellExecution) {
			;(vscode.window as any).onDidEndTerminalShellExecution = () => ({ dispose: () => {} })
		}

		// Capture the listener for onDidEndTerminalShellExecution
		sandbox.stub(vscode.window as any, "onDidEndTerminalShellExecution").callsFake((listener: any) => {
			endListener = listener
			return { dispose: () => {} } as any
		})
	})

	afterEach(() => {
		clock.restore()
		sandbox.restore()
		process.removeAllListeners()
	})

	const createMockExecution = (stream: AsyncIterable<string>) => ({
		read: () => stream,
	})

	/**
	 * LEVEL 1 PRIORITY: VS Code API Event
	 * Should complete when onDidEndTerminalShellExecution fires,
	 * even if marker is missing and stream is open.
	 */
	it("should prioritize onDidEndTerminalShellExecution over missing markers", async () => {
		const terminal = { shellIntegration: { executeCommand: () => {} } } as any
		const execution = createMockExecution(
			(async function* () {
				yield "Output without marker"
				await new Promise(() => {}) // Hang stream
			})(),
		)

		sandbox.stub(terminal.shellIntegration, "executeCommand").returns(execution)

		const runPromise = process.run(terminal, "cmd")

		// Wait for initialization
		await clock.tickAsync(100)

		// Simulate VS Code event
		endListener({ execution, exitCode: 42 })

		// We use setInterval(100) in implementation, so wait a bit
		await clock.tickAsync(200)

		const result = await Promise.race([
			runPromise.then(() => "completed"),
			new Promise((r) => setTimeout(() => r("timeout"), 1000)),
		])

		;(result as string).should.equal("completed")
		process.getCompletionDetails().exitCode!.should.equal(42)
	})

	/**
	 * LEVEL 2 PRIORITY: OSC Marker
	 * Should complete when ]633;D is found, even if event doesn't fire.
	 */
	it("should fall back to OSC marker if API event is missing", async () => {
		const terminal = { shellIntegration: { executeCommand: () => {} } } as any
		const execution = createMockExecution(
			(async function* () {
				yield "Output]633;D;7\n"
				await new Promise(() => {})
			})(),
		)

		sandbox.stub(terminal.shellIntegration, "executeCommand").returns(execution)

		const runPromise = process.run(terminal, "cmd")

		// Advance enough to trigger yield and parsing
		await clock.tickAsync(100)
		await clock.tickAsync(100)

		const result = await Promise.race([
			runPromise.then(() => "completed"),
			new Promise((r) => setTimeout(() => r("timeout"), 1000)),
		])

		;(result as string).should.equal("completed")
		process.getCompletionDetails().exitCode!.should.equal(7)
	})

	/**
	 * LEVEL 3 PRIORITY: Stream Closure
	 * Should complete when stream ends naturally.
	 */
	it("should complete when stream closes even if both event and marker are missing", async () => {
		const terminal = { shellIntegration: { executeCommand: () => {} } } as any
		const execution = createMockExecution(
			(async function* () {
				yield "Simple output"
				// Ends here
			})(),
		)

		sandbox.stub(terminal.shellIntegration, "executeCommand").returns(execution)

		await process.run(terminal, "cmd")
		// Should succeed without hang
	})

	/**
	 * LEVEL 4 PRIORITY: Idle Timeout
	 * Should complete after silence.
	 */
	it("should finally fall back to idle timeout after silence", async () => {
		// Override timeout for test
		;(global as any).__TERMINAL_IDLE_TIMEOUT_OVERRIDE = 1000

		const terminal = { shellIntegration: { executeCommand: () => {} } } as any
		const execution = createMockExecution(
			(async function* () {
				yield "Silence follows..."
				await new Promise(() => {})
			})(),
		)

		sandbox.stub(terminal.shellIntegration, "executeCommand").returns(execution)

		const runPromise = process.run(terminal, "cmd")

		// Advance enough to trigger idle timeout
		await clock.tickAsync(2000)

		const result = await Promise.race([
			runPromise.then(() => "completed"),
			new Promise((r) => setTimeout(() => r("timeout"), 1000)),
		])

		;(result as string).should.equal("completed")
		delete (global as any).__TERMINAL_IDLE_TIMEOUT_OVERRIDE
	})
})
