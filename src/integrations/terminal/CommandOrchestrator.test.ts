import assert from "node:assert/strict"
import { EventEmitter } from "events"
import { describe, it } from "mocha"
import { orchestrateCommandExecution } from "./CommandOrchestrator"
import { MAX_BYTES_BEFORE_FILE } from "./constants"
import type {
	CommandExecutorCallbacks,
	ITerminalManager,
	ITerminalProcess,
	OrchestrationResult,
	TerminalCompletionDetails,
	TerminalProcessEvents,
	TerminalProcessResultPromise,
} from "./types"

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

function createTerminalManager(): ITerminalManager {
	return {
		processOutput: (outputLines: string[]) => outputLines.join("\n"),
	} as ITerminalManager
}

describe("CommandOrchestrator exit status messaging", () => {
	it("reports non-zero exit codes as command failures", async () => {
		const process = new FakeTerminalProcess()
		const orchestrationPromise = orchestrateCommandExecution(
			process.asResultPromise(),
			createTerminalManager(),
			createCallbacks(),
			{ command: "false" },
		)

		process.complete({ exitCode: 2, signal: null })
		const result: OrchestrationResult = await orchestrationPromise

		assert.equal(result.completed, true)
		assert.equal(result.exitCode, 2)
		assert.match(result.result as string, /^Command failed with exit code 2\./)
	})

	it("reports successful command completion with explicit exit code", async () => {
		const process = new FakeTerminalProcess()
		const orchestrationPromise = orchestrateCommandExecution(
			process.asResultPromise(),
			createTerminalManager(),
			createCallbacks(),
			{ command: "echo ok" },
		)

		process.complete({ exitCode: 0, signal: null })
		const result: OrchestrationResult = await orchestrationPromise

		assert.equal(result.completed, true)
		assert.equal(result.exitCode, 0)
		assert.match(result.result as string, /^Command executed successfully \(exit code 0\)\./)
	})

	it("truncates huge single-line summaries when file logging is triggered by bytes", async () => {
		const process = new FakeTerminalProcess()
		const orchestrationPromise = orchestrateCommandExecution(
			process.asResultPromise(),
			createTerminalManager(),
			createCallbacks(),
			{ command: "echo huge" },
		)

		const hugeLine = `START-${"x".repeat(MAX_BYTES_BEFORE_FILE + 32 * 1024)}-END`
		process.emit("line", hugeLine)
		await new Promise((resolve) => setTimeout(resolve, 0))
		process.complete({ exitCode: 0, signal: null })
		const result: OrchestrationResult = await orchestrationPromise
		const resultText = result.result as string

		assert.equal(result.completed, true)
		assert.match(resultText, /output truncated by size/)
		assert.match(resultText, /Full output saved to:/)
		assert.equal(resultText.includes(hugeLine), false)
	})
})
