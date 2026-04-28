import assert from "node:assert/strict"
import { EventEmitter } from "events"
import { describe, it } from "mocha"
import sinon from "sinon"
import { CommandExecutor } from "../CommandExecutor"
import { StandaloneTerminalManager } from "../standalone/StandaloneTerminalManager"
import type {
	CommandExecutorCallbacks,
	ITerminal,
	ITerminalManager,
	ITerminalProcess,
	TerminalCompletionDetails,
	TerminalInfo,
	TerminalProcessEvents,
	TerminalProcessResultPromise,
} from "../types"

class FakeTerminalProcess extends EventEmitter<TerminalProcessEvents> implements ITerminalProcess {
	isHot = false
	waitForShellIntegration = false
	private readonly promise: Promise<void>
	private resolvePromise!: () => void
	private rejectPromise!: (error: Error) => void

	constructor() {
		super()
		this.promise = new Promise<void>((resolve, reject) => {
			this.resolvePromise = resolve
			this.rejectPromise = reject
		})
	}

	continue(): void {
		this.emit("continue")
		this.resolvePromise()
	}

	getUnretrievedOutput(): string {
		return ""
	}

	getCompletionDetails(): TerminalCompletionDetails {
		return {}
	}

	complete(details?: TerminalCompletionDetails): void {
		this.emit("completed", details)
		this.emit("continue")
		this.resolvePromise()
	}

	fail(error: Error): void {
		this.emit("error", error)
		this.rejectPromise(error)
	}

	asResultPromise(): TerminalProcessResultPromise {
		const processWithPromise = this as unknown as FakeTerminalProcess & Partial<TerminalProcessResultPromise>
		processWithPromise.then = this.promise.then.bind(this.promise)
		processWithPromise.catch = this.promise.catch.bind(this.promise)
		processWithPromise.finally = this.promise.finally.bind(this.promise)
		return processWithPromise as TerminalProcessResultPromise
	}
}

function createTerminal(): ITerminal {
	return {
		name: "test-terminal",
		processId: Promise.resolve(1),
		sendText: () => {},
		show: () => {},
		hide: () => {},
		dispose: () => {},
	}
}

function createTerminalInfo(): TerminalInfo {
	return {
		id: 1,
		terminal: createTerminal(),
		busy: false,
		lastCommand: "",
		lastActive: Date.now(),
	}
}

function createCallbacks(): CommandExecutorCallbacks {
	return {
		say: async () => undefined,
		ask: async () => ({ response: "messageResponse" }),
		updateBackgroundCommandState: () => {},
		updateClineMessage: async () => {},
		getClineMessages: () => [],
		addToUserMessageContent: () => {},
	}
}

function createManagerSpies() {
	const terminalInfo = createTerminalInfo()
	const getOrCreateTerminal = sinon.stub().resolves(terminalInfo)
	const runCommand = sinon.stub().callsFake(() => {
		const process = new FakeTerminalProcess()
		queueMicrotask(() => process.complete({ exitCode: 0, signal: null }))
		return process.asResultPromise()
	})

	const manager: ITerminalManager = {
		getOrCreateTerminal,
		runCommand,
		getTerminals: () => [],
		getUnretrievedOutput: () => "",
		isProcessHot: () => false,
		disposeAll: () => {},
		processOutput: (outputLines: string[]) => outputLines.join("\n"),
	}

	return { manager, getOrCreateTerminal, runCommand }
}

describe("CommandExecutor routing", () => {
	it("uses the configured terminal manager for the direct-instantiation fallback path", async () => {
		const { manager, getOrCreateTerminal, runCommand } = createManagerSpies()
		const executor = new CommandExecutor(
			{
				cwd: "/workspace",
				taskId: "task-1",
				ulid: "ulid-1",
				terminalExecutionMode: "vscodeTerminal",
				terminalManager: manager,
			},
			createCallbacks(),
		)

		const [userRejected, result] = await executor.execute("echo hello", undefined, { suppressUserInteraction: true })

		assert.equal(userRejected, false)
		assert.match(String(result), /^Command executed successfully \(exit code 0\)\./)
		assert.equal(getOrCreateTerminal.callCount, 1)
		assert.equal(runCommand.callCount, 1)
		assert.equal(runCommand.firstCall.args[1], "echo hello")
	})

	it("uses the standalone manager when background execution is requested", async () => {
		const { manager, getOrCreateTerminal, runCommand } = createManagerSpies()
		const standaloneGetOrCreateTerminal = sinon
			.stub(StandaloneTerminalManager.prototype, "getOrCreateTerminal")
			.resolves(createTerminalInfo())
		const standaloneRunCommand = sinon.stub(StandaloneTerminalManager.prototype, "runCommand").callsFake(() => {
			const process = new FakeTerminalProcess()
			queueMicrotask(() => process.complete({ exitCode: 0, signal: null }))
			return process.asResultPromise()
		})

		try {
			const executor = new CommandExecutor(
				{
					cwd: "/workspace",
					taskId: "task-2",
					ulid: "ulid-2",
					terminalExecutionMode: "vscodeTerminal",
					terminalManager: manager,
				},
				createCallbacks(),
			)

			const [userRejected, result] = await executor.execute("echo background", undefined, {
				useBackgroundExecution: true,
				suppressUserInteraction: true,
			})

			assert.equal(userRejected, false)
			assert.match(String(result), /^Command executed successfully \(exit code 0\)\./)
			assert.equal(getOrCreateTerminal.callCount, 0)
			assert.equal(runCommand.callCount, 0)
			assert.equal(standaloneGetOrCreateTerminal.callCount, 1)
			assert.equal(standaloneRunCommand.callCount, 1)
			assert.equal(standaloneRunCommand.firstCall.args[1], "echo background")
		} finally {
			standaloneGetOrCreateTerminal.restore()
			standaloneRunCommand.restore()
		}
	})
})
