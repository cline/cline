import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"
import * as vscode from "vscode"
import { VscodeTerminalManager } from "./VscodeTerminalManager"
import { TerminalInfo, TerminalRegistry } from "./VscodeTerminalRegistry"

function createNeverEndingStream(): AsyncIterable<string> {
	return {
		async *[Symbol.asyncIterator]() {
			await new Promise(() => {})
		},
	}
}

describe("VscodeTerminalManager", () => {
	let sandbox: sinon.SinonSandbox
	let manager: VscodeTerminalManager

	beforeEach(() => {
		sandbox = sinon.createSandbox({ useFakeTimers: true })
		manager = new VscodeTerminalManager()
	})

	afterEach(() => {
		manager.disposeAll()
		sandbox.restore()
	})

	it("returns after timing out a reused terminal cwd command", async () => {
		const targetCwd = "/tmp/cline-target"
		const executeCommandStub = sandbox.stub().returns({
			read: () => createNeverEndingStream(),
		})
		const terminalInfo: TerminalInfo = {
			id: 1,
			busy: false,
			lastCommand: "",
			lastActive: Date.now(),
			terminal: {
				shellIntegration: {
					cwd: vscode.Uri.file("/tmp/cline-original"),
					executeCommand: executeCommandStub,
				},
				show: sandbox.stub(),
			} as unknown as vscode.Terminal,
		}
		const getAllTerminalsStub = sandbox.stub(TerminalRegistry, "getAllTerminals").returns([terminalInfo])

		let didResolve = false
		const terminalPromise = manager.getOrCreateTerminal(targetCwd).then((terminal) => {
			didResolve = true
			return terminal
		})

		await sandbox.clock.tickAsync(4999)
		assert.equal(didResolve, false)

		await sandbox.clock.tickAsync(1)
		const terminal = await terminalPromise

		assert.equal(terminal, terminalInfo)
		assert.equal(terminalInfo.busy, false)
		assert.equal(terminalInfo.pendingCwdChange, undefined)
		assert.equal(terminalInfo.cwdResolved, undefined)
		assert.equal(getAllTerminalsStub.called, true)
		assert.equal(executeCommandStub.calledOnceWith(`cd "${targetCwd}"`), true)
	})

	it("drops a user-closed terminal from the registry so the LRU never reuses it", () => {
		// Capture the onDidCloseTerminal listener registered by the constructor.
		const closeListeners: Array<(terminal: vscode.Terminal) => void> = []
		const onDidCloseStub = sandbox.stub(vscode.window, "onDidCloseTerminal").callsFake((listener) => {
			closeListeners.push(listener)
			return { dispose: sandbox.stub() }
		})

		// Recreate the manager so the constructor registers through the stub.
		manager.disposeAll()
		manager = new VscodeTerminalManager()
		assert.equal(onDidCloseStub.called, true)

		const terminal = {
			shellIntegration: {
				cwd: vscode.Uri.file("/tmp/a"),
				executeCommand: sandbox.stub().returns({ read: () => createNeverEndingStream() }),
			},
			show: sandbox.stub(),
		} as unknown as vscode.Terminal
		const terminalInfo = TerminalRegistry.createTerminal("/tmp/a")
		terminalInfo.terminal = terminal

		assert.equal(TerminalRegistry.getAllTerminals().length, 1)

		// Fire the close event exactly as VS Code would.
		for (const listener of closeListeners) {
			listener(terminal)
		}

		assert.equal(TerminalRegistry.getAllTerminals().length, 0)
	})

	it("ignores close events for terminals it does not track", () => {
		const closeListeners: Array<(terminal: vscode.Terminal) => void> = []
		const removeTerminalSpy = sandbox.spy(TerminalRegistry, "removeTerminal")
		sandbox.stub(vscode.window, "onDidCloseTerminal").callsFake((listener) => {
			closeListeners.push(listener)
			return { dispose: sandbox.stub() }
		})

		manager.disposeAll()
		manager = new VscodeTerminalManager()

		const foreignTerminal = { show: sandbox.stub() } as unknown as vscode.Terminal
		for (const listener of closeListeners) {
			listener(foreignTerminal)
		}
		assert.equal(removeTerminalSpy.called, false)
	})
})
