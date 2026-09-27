import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"
import * as vscode from "vscode"
import { setVscodeHostProviderMock } from "@/test/host-provider-test-utils"
import { VscodeTerminalManager } from "./VscodeTerminalManager"
import { TerminalInfo, TerminalRegistry } from "./VscodeTerminalRegistry"

function createNeverEndingStream(): AsyncIterable<string> {
	return {
		async *[Symbol.asyncIterator]() {
			await new Promise(() => {})
		},
	}
}

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

	it("creates a fresh terminal after timing out an unconfirmed reused-terminal cwd change", async () => {
		setVscodeHostProviderMock()
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
		const terminal = (await terminalPromise) as unknown as TerminalInfo

		try {
			assert.notEqual(terminal, terminalInfo)
			assert.equal(terminalInfo.busy, false)
			assert.equal(terminalInfo.pendingCwdChange, undefined)
			assert.equal(terminalInfo.cwdResolved, undefined)
			assert.equal(terminal.busy, true)
			assert.equal(getAllTerminalsStub.called, true)
			assert.equal(executeCommandStub.calledOnceWith(`cd "${targetCwd}"`), true)
		} finally {
			terminal.terminal.dispose()
			TerminalRegistry.removeTerminal(terminal.id)
		}
	})

	it("reuses a terminal after its cwd change is confirmed", async () => {
		const targetCwd = "/tmp/cline-target"
		let currentCwd = vscode.Uri.file("/tmp/cline-original")
		const terminalInfo: TerminalInfo = {
			id: 1,
			busy: false,
			lastCommand: "",
			lastActive: Date.now(),
			terminal: {
				shellIntegration: {
					get cwd() {
						return currentCwd
					},
					executeCommand: () => ({
						read: () => ({
							async *[Symbol.asyncIterator]() {
								currentCwd = vscode.Uri.file(targetCwd)
							},
						}),
					}),
				},
				show: sandbox.stub(),
			} as unknown as vscode.Terminal,
		}
		sandbox.stub(TerminalRegistry, "getAllTerminals").returns([terminalInfo])

		const terminalPromise = manager.getOrCreateTerminal(targetCwd)
		await sandbox.clock.tickAsync(100)
		const terminal = await terminalPromise

		assert.equal(terminal, terminalInfo)
		assert.equal(terminalInfo.busy, true)
		assert.equal(terminalInfo.pendingCwdChange, undefined)
		assert.equal(terminalInfo.cwdResolved, undefined)
	})

	it("releases a reused terminal reservation when showing it fails", async () => {
		const terminalInfo: TerminalInfo = {
			id: 1,
			busy: false,
			lastCommand: "",
			lastActive: Date.now(),
			terminal: {
				shellIntegration: { cwd: vscode.Uri.file("/tmp/cline-original") },
				show: sandbox.stub().throws(new Error("terminal closed")),
			} as unknown as vscode.Terminal,
		}
		sandbox.stub(TerminalRegistry, "getAllTerminals").returns([terminalInfo])

		await assert.rejects(manager.getOrCreateTerminal("/tmp/cline-target"), /terminal closed/)

		assert.equal(terminalInfo.busy, false)
		assert.equal(terminalInfo.pendingCwdChange, undefined)
		assert.equal(terminalInfo.cwdResolved, undefined)
	})

	it("creates a fresh terminal when the reused-terminal cwd command cannot start", async () => {
		setVscodeHostProviderMock()
		const terminalInfo: TerminalInfo = {
			id: 1,
			busy: false,
			lastCommand: "",
			lastActive: Date.now(),
			terminal: {
				shellIntegration: {
					cwd: vscode.Uri.file("/tmp/cline-original"),
					executeCommand: () => {
						throw new Error("cwd command failed")
					},
				},
				show: sandbox.stub(),
			} as unknown as vscode.Terminal,
		}
		sandbox.stub(TerminalRegistry, "getAllTerminals").returns([terminalInfo])

		const terminal = (await manager.getOrCreateTerminal("/tmp/cline-target")) as unknown as TerminalInfo
		try {
			assert.notEqual(terminal, terminalInfo)
			assert.equal(terminal.busy, true)
			assert.equal(terminalInfo.busy, false)
			assert.equal(terminalInfo.pendingCwdChange, undefined)
			assert.equal(terminalInfo.cwdResolved, undefined)
			assert.equal(TerminalRegistry.getTerminal(terminalInfo.id), undefined)
		} finally {
			terminal.terminal.dispose()
			TerminalRegistry.removeTerminal(terminal.id)
		}
	})

	it("creates a fresh terminal when the reused-terminal cwd command stream fails", async () => {
		setVscodeHostProviderMock()
		const terminalInfo: TerminalInfo = {
			id: 1,
			busy: false,
			lastCommand: "",
			lastActive: Date.now(),
			terminal: {
				shellIntegration: {
					cwd: vscode.Uri.file("/tmp/cline-original"),
					executeCommand: () => ({ read: () => createFailingStream(new Error("cwd stream failed")) }),
				},
				show: sandbox.stub(),
			} as unknown as vscode.Terminal,
		}
		sandbox.stub(TerminalRegistry, "getAllTerminals").returns([terminalInfo])

		const terminal = (await manager.getOrCreateTerminal("/tmp/cline-target")) as unknown as TerminalInfo
		try {
			assert.notEqual(terminal, terminalInfo)
			assert.equal(terminal.busy, true)
			assert.equal(terminalInfo.busy, false)
			assert.equal(terminalInfo.pendingCwdChange, undefined)
			assert.equal(terminalInfo.cwdResolved, undefined)
			assert.equal(TerminalRegistry.getTerminal(terminalInfo.id), undefined)
		} finally {
			terminal.terminal.dispose()
			TerminalRegistry.removeTerminal(terminal.id)
		}
	})

	it("releases a reused terminal reservation when it closes during cwd setup", async () => {
		let exitStatus: vscode.TerminalExitStatus | undefined
		const terminalInfo: TerminalInfo = {
			id: 1,
			busy: false,
			lastCommand: "",
			lastActive: Date.now(),
			terminal: {
				get exitStatus() {
					return exitStatus
				},
				shellIntegration: {
					cwd: vscode.Uri.file("/tmp/cline-original"),
					executeCommand: () => ({ read: createNeverEndingStream }),
				},
				show: sandbox.stub(),
			} as unknown as vscode.Terminal,
		}
		sandbox.stub(TerminalRegistry, "getAllTerminals").returns([terminalInfo])

		const rejectedAcquisition = assert.rejects(manager.getOrCreateTerminal("/tmp/cline-target"), /exited while preparing/)
		exitStatus = { code: undefined, reason: vscode.TerminalExitReason.Unknown }
		await sandbox.clock.tickAsync(5000)
		await rejectedAcquisition

		assert.equal(terminalInfo.busy, false)
		assert.equal(terminalInfo.pendingCwdChange, undefined)
		assert.equal(terminalInfo.cwdResolved, undefined)
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

	it("defers fallback terminal disposal until the next terminal acquisition", async () => {
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
			assert.equal(disposeSpy.calledOnce, true, "the next acquisition must reclaim the fallback terminal")
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

	describe("Sandboxed Execution Mode", () => {
		it("defaults to sandboxed execution disabled", () => {
			const config = manager.getSandboxedExecution()
			assert.equal(config.enabled, false)
		})

		it("enables sandboxed execution and updates options", () => {
			manager.setSandboxedExecution(true, {
				containment: "strict",
				backend: "shell-guard",
				blockedPaths: ["/secret"],
			})
			const config = manager.getSandboxedExecution()
			assert.equal(config.enabled, true)
			assert.equal(config.containment, "strict")
			assert.equal(config.backend, "shell-guard")
			assert.deepEqual(config.blockedPaths, ["/secret"])
		})

		it("wraps commands when sandboxed execution is enabled", async () => {
			setVscodeHostProviderMock()
			const terminalInfo = TerminalRegistry.createTerminal("/tmp/cline-sandbox")
			const executeCommandStub = sandbox.stub().returns({
				read: () => createNeverEndingStream(),
			})
			sandbox.stub(terminalInfo.terminal, "shellIntegration").get(() => ({
				cwd: vscode.Uri.file("/tmp/cline-sandbox"),
				executeCommand: executeCommandStub,
			}))

			manager.setSandboxedExecution(true, { backend: "shell-guard" })

			try {
				manager.runCommand(
					terminalInfo as unknown as Parameters<VscodeTerminalManager["runCommand"]>[0],
					"npm test",
				)
				assert.equal(executeCommandStub.calledOnce, true)
				const executedCmd = executeCommandStub.firstCall.args[0]
				assert.equal(executedCmd.includes("CLINE_SANDBOX_ACTIVE=1"), true)
				assert.equal(executedCmd.includes("npm test"), true)
			} finally {
				terminalInfo.terminal.dispose()
				TerminalRegistry.removeTerminal(terminalInfo.id)
			}
		})

		it("applies custom sandbox wrapper if provided", async () => {
			setVscodeHostProviderMock()
			const terminalInfo = TerminalRegistry.createTerminal("/tmp/cline-sandbox")
			const executeCommandStub = sandbox.stub().returns({
				read: () => createNeverEndingStream(),
			})
			sandbox.stub(terminalInfo.terminal, "shellIntegration").get(() => ({
				cwd: vscode.Uri.file("/tmp/cline-sandbox"),
				executeCommand: executeCommandStub,
			}))

			manager.setSandboxedExecution(true, {
				customWrapper: "sandbox-tool --workdir {cwd} -- {command}",
			})

			try {
				manager.runCommand(
					terminalInfo as unknown as Parameters<VscodeTerminalManager["runCommand"]>[0],
					"cargo check",
				)
				assert.equal(executeCommandStub.calledOnce, true)
				const executedCmd = executeCommandStub.firstCall.args[0]
				assert.equal(executedCmd.includes("sandbox-tool --workdir"), true)
				assert.equal(executedCmd.includes("cargo check"), true)
			} finally {
				terminalInfo.terminal.dispose()
				TerminalRegistry.removeTerminal(terminalInfo.id)
			}
		})

		it("blocks commands targeting protected paths when ClineIgnoreController is attached", () => {
			setVscodeHostProviderMock()
			const terminalInfo = TerminalRegistry.createTerminal("/tmp/cline-sandbox")
			const fakeIgnoreController = {
				validateCommand: sandbox.stub().returns(".env"),
			}
			manager.setClineIgnoreController(fakeIgnoreController as unknown as import("@/core/ignore/ClineIgnoreController").ClineIgnoreController)
			manager.setSandboxedExecution(true)

			try {
				assert.throws(
					() => {
						manager.runCommand(
							terminalInfo as unknown as Parameters<VscodeTerminalManager["runCommand"]>[0],
							"cat .env",
						)
					},
					(err: Error) => {
						return err.message.includes('[Sandbox] Command blocked: attempted to access or modify protected path ".env"')
					},
				)
			} finally {
				terminalInfo.terminal.dispose()
				TerminalRegistry.removeTerminal(terminalInfo.id)
			}
		})
	})
})

