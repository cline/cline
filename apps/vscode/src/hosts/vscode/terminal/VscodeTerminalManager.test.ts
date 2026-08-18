import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"
import * as vscode from "vscode"
import { setVscodeHostProviderMock } from "@/test/host-provider-test-utils"
import { VscodeTerminalManager } from "./VscodeTerminalManager"
import { TerminalInfo, TerminalRegistry } from "./VscodeTerminalRegistry"

function createMarkerlessStream(): AsyncIterable<string> {
	return {
		async *[Symbol.asyncIterator]() {
			yield "remote output\n"
			yield "user@remote:~$ "
			await new Promise(() => {})
		},
	}
}

function createFailingStream(error: Error): AsyncIterable<string> {
	return {
		async *[Symbol.asyncIterator]() {
			throw error
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
		TerminalRegistry.disposeTerminalsPendingCleanup()
		sandbox.restore()
	})

	it("reuses a terminal without shell integration using its tracked cwd", async () => {
		const cwd = "/tmp/cline-target"
		const showStub = sandbox.stub()
		const terminalInfo: TerminalInfo = {
			id: 1,
			busy: false,
			lastCommand: "",
			lastActive: Date.now(),
			trackedCwd: cwd,
			terminal: {
				processId: Promise.resolve(1),
				shellIntegration: undefined,
				show: showStub,
			} as unknown as vscode.Terminal,
		}
		sandbox.stub(TerminalRegistry, "getAllTerminals").returns([terminalInfo])

		const terminal = await manager.getOrCreateTerminal(cwd)

		assert.equal(terminal, terminalInfo)
		assert.equal(terminalInfo.busy, true)
		assert.equal(showStub.called, false)
	})

	it("prefixes cross-directory commands without showing the terminal", async () => {
		const originalCwd = "/tmp/cline-original"
		const targetCwd = "/tmp/cline-target"
		const executeCommandStub = sandbox.stub().throws(new Error("stop after capture"))
		const showStub = sandbox.stub()
		const terminalInfo: TerminalInfo = {
			id: 1,
			busy: true,
			lastCommand: "",
			lastActive: Date.now(),
			trackedCwd: originalCwd,
			terminal: {
				processId: Promise.resolve(1),
				shellIntegration: {
					cwd: vscode.Uri.file(originalCwd),
					executeCommand: executeCommandStub,
				},
				show: showStub,
			} as unknown as vscode.Terminal,
		}

		const process = manager.runCommand(
			terminalInfo as unknown as Parameters<VscodeTerminalManager["runCommand"]>[0],
			"echo hi",
			targetCwd,
		)
		await assert.rejects(process)

		assert.equal(executeCommandStub.calledOnceWith(`cd "${targetCwd}" && echo hi`), true)
		assert.equal(showStub.called, false)
	})

	it("queues an idle evicted terminal for disposal", () => {
		const terminalInfo = TerminalRegistry.createTerminal("/tmp/cline-evicted")
		const disposeSpy = sandbox.spy(terminalInfo.terminal, "dispose")

		;(manager as unknown as { evictTerminal: (info: TerminalInfo) => void }).evictTerminal(terminalInfo)
		TerminalRegistry.disposeTerminalsPendingCleanup()

		assert.equal(disposeSpy.calledOnce, true)
	})

	it("disposes idle terminals while preserving busy terminals", () => {
		const idleTerminal = TerminalRegistry.createTerminal("/tmp/cline-idle")
		const busyTerminal = TerminalRegistry.createTerminal("/tmp/cline-busy")
		busyTerminal.busy = true
		const idleDisposeSpy = sandbox.spy(idleTerminal.terminal, "dispose")
		const busyDisposeSpy = sandbox.spy(busyTerminal.terminal, "dispose")

		manager.disposeAll()

		assert.equal(idleDisposeSpy.calledOnce, true)
		assert.equal(busyDisposeSpy.called, false)
		assert.equal(TerminalRegistry.getTerminal(busyTerminal.id), busyTerminal)
		busyTerminal.terminal.dispose()
		TerminalRegistry.removeTerminal(busyTerminal.id)
	})

	it("reserves different terminals for parallel acquisitions", async () => {
		setVscodeHostProviderMock()
		const first = (await manager.getOrCreateTerminal("/tmp/cline-parallel")) as unknown as TerminalInfo
		const second = (await manager.getOrCreateTerminal("/tmp/cline-parallel")) as unknown as TerminalInfo

		try {
			assert.notEqual(first.id, second.id)
			assert.equal(first.busy, true)
			assert.equal(second.busy, true)
		} finally {
			first.terminal.dispose()
			second.terminal.dispose()
			TerminalRegistry.removeTerminal(first.id)
			TerminalRegistry.removeTerminal(second.id)
		}
	})

	it("rejects the command and releases the terminal when process startup fails", async () => {
		const terminalInfo: TerminalInfo = {
			id: 1,
			busy: true,
			lastCommand: "",
			lastActive: Date.now(),
			trackedCwd: "",
			terminal: {
				shellIntegration: {
					executeCommand: () => {
						throw new Error("command startup failed")
					},
				},
				show: sandbox.stub(),
			} as unknown as vscode.Terminal,
		}

		const process = manager.runCommand(
			terminalInfo as unknown as Parameters<VscodeTerminalManager["runCommand"]>[0],
			"failing-command",
		)

		await assert.rejects(process, /command startup failed/)
		assert.equal(TerminalRegistry.getTerminal(terminalInfo.id), undefined)
	})

	it("does not reuse a terminal after its command stream fails", async () => {
		setVscodeHostProviderMock()
		const terminalInfo = TerminalRegistry.createTerminal("/tmp/cline-stream-error")
		sandbox.stub(terminalInfo.terminal, "shellIntegration").get(() => ({
			cwd: vscode.Uri.file("/tmp/cline-stream-error"),
			executeCommand: () => ({ read: () => createFailingStream(new Error("command stream failed")) }),
		}))

		const process = manager.runCommand(
			terminalInfo as unknown as Parameters<VscodeTerminalManager["runCommand"]>[0],
			"long-running-command",
		)
		await assert.rejects(process, /command stream failed/)

		const nextTerminal = (await manager.getOrCreateTerminal("/tmp/cline-stream-error")) as unknown as TerminalInfo
		try {
			assert.notEqual(nextTerminal.id, terminalInfo.id)
			assert.equal(TerminalRegistry.getTerminal(terminalInfo.id), undefined)
		} finally {
			terminalInfo.terminal.dispose()
			nextTerminal.terminal.dispose()
			TerminalRegistry.removeTerminal(nextTerminal.id)
		}
	})

	it("continues terminal acquisition when pending cleanup fails", async () => {
		setVscodeHostProviderMock()
		const failedCleanup = TerminalRegistry.createTerminal()
		const successfulCleanup = TerminalRegistry.createTerminal()
		const failedDispose = sandbox.stub(failedCleanup.terminal, "dispose").throws(new Error("dispose failed"))
		const successfulDispose = sandbox.spy(successfulCleanup.terminal, "dispose")
		TerminalRegistry.queueTerminalForCleanup(failedCleanup)
		TerminalRegistry.queueTerminalForCleanup(successfulCleanup)
		let acquiredTerminal: TerminalInfo | undefined
		let didRestoreFailedDispose = false

		try {
			acquiredTerminal = (await manager.getOrCreateTerminal("/tmp/cline-after-cleanup-error")) as unknown as TerminalInfo
			assert.equal(successfulDispose.calledOnce, true)
			assert.notEqual(acquiredTerminal.id, failedCleanup.id)

			failedDispose.restore()
			didRestoreFailedDispose = true
			const retryDispose = sandbox.spy(failedCleanup.terminal, "dispose")
			TerminalRegistry.disposeTerminalsPendingCleanup()
			assert.equal(retryDispose.calledOnce, true)
		} finally {
			if (!didRestoreFailedDispose) {
				failedDispose.restore()
			}
			acquiredTerminal?.terminal.dispose()
			if (acquiredTerminal) {
				TerminalRegistry.removeTerminal(acquiredTerminal.id)
			}
			TerminalRegistry.disposeTerminalsPendingCleanup()
		}
	})

	it("disposes an already-exited fallback terminal exactly once", () => {
		const terminalInfo = TerminalRegistry.createTerminal()
		const disposeSpy = sandbox.spy(terminalInfo.terminal, "dispose")
		sandbox.stub(terminalInfo.terminal, "exitStatus").get(() => ({
			code: 0,
			reason: vscode.TerminalExitReason.Process,
		}))
		TerminalRegistry.queueTerminalForCleanup(terminalInfo)

		TerminalRegistry.disposeTerminalsPendingCleanup()
		TerminalRegistry.disposeTerminalsPendingCleanup()

		assert.equal(disposeSpy.calledOnce, true)
	})

	it("preserves an unobserved fallback terminal across the next terminal acquisition", async () => {
		setVscodeHostProviderMock()
		const terminalInfo = TerminalRegistry.createTerminal()
		sandbox.stub(terminalInfo.terminal, "shellIntegration").get(() => undefined)
		sandbox.stub(terminalInfo.terminal, "sendText")
		const disposeSpy = sandbox.spy(terminalInfo.terminal, "dispose")
		let nextTerminal: TerminalInfo | undefined
		let nextManager: VscodeTerminalManager | undefined

		try {
			const process = manager.runCommand(
				terminalInfo as unknown as Parameters<VscodeTerminalManager["runCommand"]>[0],
				"sleep 999",
			)
			await sandbox.clock.tickAsync(4000)
			await sandbox.clock.tickAsync(3000)
			await process

			assert.deepEqual(process.getCompletionDetails?.().unobservedCommand, {
				source: "sendText",
				ownership: "managed",
			})
			assert.equal(disposeSpy.called, false, "the command must not be killed when the fallback result resolves")
			assert.equal(TerminalRegistry.getTerminal(terminalInfo.id), undefined, "the terminal must be evicted from reuse")

			nextManager = new VscodeTerminalManager()
			nextTerminal = (await nextManager.getOrCreateTerminal("/tmp/cline-next-command")) as unknown as TerminalInfo
			assert.equal(disposeSpy.called, false, "an unobserved command remains user-owned")
		} finally {
			nextManager?.disposeAll()
			nextTerminal?.terminal.dispose()
			if (nextTerminal) {
				TerminalRegistry.removeTerminal(nextTerminal.id)
			}
			if (!disposeSpy.called) {
				terminalInfo.terminal.dispose()
				TerminalRegistry.removeTerminal(terminalInfo.id)
			}
		}
	})

	it("preserves a detached fallback terminal across the next terminal acquisition", async () => {
		setVscodeHostProviderMock()
		const terminalInfo = TerminalRegistry.createTerminal()
		sandbox.stub(terminalInfo.terminal, "shellIntegration").get(() => undefined)
		sandbox.stub(terminalInfo.terminal, "sendText")
		const disposeSpy = sandbox.spy(terminalInfo.terminal, "dispose")
		let nextTerminal: TerminalInfo | undefined

		try {
			const process = manager.runCommand(
				terminalInfo as unknown as Parameters<VscodeTerminalManager["runCommand"]>[0],
				"sleep 999",
			)
			const unobservedCommand = new Promise<void>((resolve) => process.once("unobserved_command", () => resolve()))
			process.detach()
			await sandbox.clock.tickAsync(4000)
			await sandbox.clock.tickAsync(3000)
			await unobservedCommand

			nextTerminal = (await manager.getOrCreateTerminal("/tmp/cline-next-command")) as unknown as TerminalInfo
			assert.equal(disposeSpy.called, false, "Proceed While Running transfers terminal ownership to the user")
			assert.equal(TerminalRegistry.getTerminal(terminalInfo.id), undefined, "detached terminals must not be reused")
		} finally {
			nextTerminal?.terminal.dispose()
			if (nextTerminal) {
				TerminalRegistry.removeTerminal(nextTerminal.id)
			}
			terminalInfo.terminal.dispose()
			TerminalRegistry.removeTerminal(terminalInfo.id)
		}
	})

	it("preserves a continued fallback terminal across the next terminal acquisition", async () => {
		setVscodeHostProviderMock()
		const terminalInfo = TerminalRegistry.createTerminal()
		sandbox.stub(terminalInfo.terminal, "shellIntegration").get(() => undefined)
		sandbox.stub(terminalInfo.terminal, "sendText")
		const disposeSpy = sandbox.spy(terminalInfo.terminal, "dispose")
		let nextTerminal: TerminalInfo | undefined

		try {
			const process = manager.runCommand(
				terminalInfo as unknown as Parameters<VscodeTerminalManager["runCommand"]>[0],
				"sleep 999",
			)
			const unobservedCommand = new Promise<void>((resolve) => process.once("unobserved_command", () => resolve()))
			process.continue()
			await sandbox.clock.tickAsync(4000)
			await sandbox.clock.tickAsync(3000)
			await unobservedCommand

			nextTerminal = (await manager.getOrCreateTerminal("/tmp/cline-next-command")) as unknown as TerminalInfo
			assert.equal(disposeSpy.called, false, "stopping the wait relinquishes cleanup ownership")
			assert.equal(TerminalRegistry.getTerminal(terminalInfo.id), undefined, "continued terminals must not be reused")
		} finally {
			nextTerminal?.terminal.dispose()
			if (nextTerminal) {
				TerminalRegistry.removeTerminal(nextTerminal.id)
			}
			terminalInfo.terminal.dispose()
			TerminalRegistry.removeTerminal(terminalInfo.id)
		}
	})

	it("preserves a markerless shell-integration terminal across the next terminal acquisition", async () => {
		setVscodeHostProviderMock()
		const terminalInfo = TerminalRegistry.createTerminal()
		sandbox.stub(terminalInfo.terminal, "shellIntegration").get(() => ({
			executeCommand: () => ({ read: createMarkerlessStream }),
		}))
		const disposeSpy = sandbox.spy(terminalInfo.terminal, "dispose")
		let nextTerminal: TerminalInfo | undefined

		try {
			const process = manager.runCommand(
				terminalInfo as unknown as Parameters<VscodeTerminalManager["runCommand"]>[0],
				"remote-command",
			)
			await sandbox.clock.tickAsync(15_000)
			await process

			assert.deepEqual(process.getCompletionDetails?.().unobservedCommand, {
				source: "markerlessShellIntegration",
				ownership: "managed",
			})
			nextTerminal = (await manager.getOrCreateTerminal("/tmp/cline-next-command")) as unknown as TerminalInfo
			assert.equal(disposeSpy.called, false, "an SSH or nested-shell session remains user-owned")
			assert.equal(TerminalRegistry.getTerminal(terminalInfo.id), undefined, "markerless terminals must not be reused")
		} finally {
			nextTerminal?.terminal.dispose()
			if (nextTerminal) {
				TerminalRegistry.removeTerminal(nextTerminal.id)
			}
			terminalInfo.terminal.dispose()
			TerminalRegistry.removeTerminal(terminalInfo.id)
		}
	})
})
