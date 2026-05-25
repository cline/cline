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
	let endListener: (e: any) => void

	beforeEach(() => {
		sandbox = sinon.createSandbox()
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
		sandbox.restore()
		process.removeAllListeners()
		delete (global as any).__TERMINAL_IDLE_TIMEOUT_OVERRIDE
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
				await new Promise((r) => setTimeout(r, 1000)) // Hang stream slightly longer than tests
			})(),
		)

		sandbox.stub(terminal.shellIntegration, "executeCommand").returns(execution)

		const runPromise = process.run(terminal, "cmd")

		// Simulate VS Code event almost immediately
		setTimeout(() => endListener({ execution, exitCode: 42 }), 10)

		const result = await Promise.race([
			runPromise.then(() => "completed"),
			new Promise((r) => setTimeout(() => r("timeout"), 2000)),
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
				await new Promise((r) => setTimeout(r, 1000))
			})(),
		)

		sandbox.stub(terminal.shellIntegration, "executeCommand").returns(execution)

		const runPromise = process.run(terminal, "cmd")

		const result = await Promise.race([
			runPromise.then(() => "completed"),
			new Promise((r) => setTimeout(() => r("timeout"), 2000)),
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
				// Ends immediately
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
		// Override timeout for test to be very short
		;(global as any).__TERMINAL_IDLE_TIMEOUT_OVERRIDE = 100

		const terminal = { shellIntegration: { executeCommand: () => {} } } as any
		const execution = createMockExecution(
			(async function* () {
				yield "Silence follows..."
				await new Promise((r) => setTimeout(r, 1000)) // Hang stream longer than 100ms idle timeout
			})(),
		)

		sandbox.stub(terminal.shellIntegration, "executeCommand").returns(execution)

		const runPromise = process.run(terminal, "cmd")

		const result = await Promise.race([
			runPromise.then(() => "completed"),
			new Promise((r) => setTimeout(() => r("timeout"), 2000)),
		])

		;(result as string).should.equal("completed")
		delete (global as any).__TERMINAL_IDLE_TIMEOUT_OVERRIDE
	})
})
