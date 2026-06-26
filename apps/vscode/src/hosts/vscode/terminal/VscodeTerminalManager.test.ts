import assert from "node:assert/strict"
import { EventEmitter } from "events"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"
import * as vscode from "vscode"
import type { TerminalProcessEvents, TerminalProcessResultPromise } from "@/integrations/terminal/types"
import { VscodeTerminalManager } from "./VscodeTerminalManager"
import { TerminalInfo, TerminalRegistry } from "./VscodeTerminalRegistry"

class FakeTerminalProcess extends EventEmitter<TerminalProcessEvents> {
	isHot = false
	waitForShellIntegration = false
	private readonly promise: Promise<void>
	private resolvePromise!: () => void

	constructor() {
		super()
		this.promise = new Promise((resolve) => {
			this.resolvePromise = resolve
		})
	}

	continue(): void {
		this.emit("continue")
		this.resolvePromise()
	}

	getUnretrievedOutput(): string {
		return ""
	}

	asResultPromise(): TerminalProcessResultPromise {
		const processWithPromise = this as unknown as FakeTerminalProcess & Partial<TerminalProcessResultPromise>
		processWithPromise.then = this.promise.then.bind(this.promise)
		processWithPromise.catch = this.promise.catch.bind(this.promise)
		processWithPromise.finally = this.promise.finally.bind(this.promise)
		return processWithPromise as TerminalProcessResultPromise
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

	it("continues after timing out a reused terminal cwd command", async () => {
		const targetCwd = "/tmp/cline-target"
		const terminalInfo: TerminalInfo = {
			id: 1,
			busy: false,
			lastCommand: "",
			lastActive: Date.now(),
			terminal: {
				shellIntegration: {
					cwd: vscode.Uri.file("/tmp/cline-original"),
				},
			} as vscode.Terminal,
		}
		const cdProcess = new FakeTerminalProcess()
		const continueSpy = sandbox.spy(cdProcess, "continue")
		const getAllTerminalsStub = sandbox.stub(TerminalRegistry, "getAllTerminals").returns([terminalInfo])
		const runCommandStub = sandbox.stub(manager, "runCommand").returns(cdProcess.asResultPromise())

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
		assert.equal(continueSpy.calledOnce, true)
		assert.equal(getAllTerminalsStub.called, true)
		assert.equal(runCommandStub.firstCall.args[0], terminalInfo)
		assert.equal(runCommandStub.firstCall.args[1], `cd "${targetCwd}"`)
	})
})
