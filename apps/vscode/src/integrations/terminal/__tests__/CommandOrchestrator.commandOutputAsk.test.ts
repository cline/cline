import assert from "node:assert/strict"
import { EventEmitter } from "events"
import { describe, it } from "mocha"
import { orchestrateCommandExecution } from "../CommandOrchestrator"
import { CHUNK_DEBOUNCE_MS } from "../constants"
import type {
	CommandExecutorCallbacks,
	ITerminalManager,
	ITerminalProcess,
	TerminalCompletionDetails,
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

async function waitFor(predicate: () => boolean, timeoutMs = 300): Promise<void> {
	const start = Date.now()
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) {
			throw new Error("Condition not met before timeout")
		}
		await new Promise((resolve) => setTimeout(resolve, 10))
	}
}

describe("CommandOrchestrator command_output ask lifecycle", () => {
	it("settles a pending command_output ask when the process completes", async () => {
		const process = new FakeTerminalProcess()
		let askCalls = 0
		let askSettled = false
		let resolvePendingAsk: ((value: { response: "messageResponse" }) => void) | null = null

		const callbacks = createCallbacks()
		callbacks.ask = async () => {
			askCalls++
			return new Promise<{ response: "messageResponse" }>((resolve) => {
				resolvePendingAsk = resolve
			}).finally(() => {
				askSettled = true
			})
		}
		callbacks.resolvePendingAsk = () => {
			resolvePendingAsk?.({ response: "messageResponse" })
		}

		const orchestrationPromise = orchestrateCommandExecution(process.asResultPromise(), createTerminalManager(), callbacks, {
			command: "echo test",
		})

		process.emit("line", "line one")
		await new Promise((resolve) => setTimeout(resolve, CHUNK_DEBOUNCE_MS + 40))
		assert.equal(askCalls, 1, "expected command_output ask after buffered output flush")

		process.complete({ exitCode: 0, signal: null })
		await orchestrationPromise

		try {
			await waitFor(() => askSettled, 500)
			assert.equal(askSettled, true, "pending command_output ask should settle after process completion")
		} finally {
			;(resolvePendingAsk as ((value: { response: "messageResponse" }) => void) | null)?.({
				response: "messageResponse",
			})
		}
	})

	it("settles a pending command_output ask when the process errors", async () => {
		const process = new FakeTerminalProcess()
		let askCalls = 0
		let askSettled = false
		let resolvePendingAsk: ((value: { response: "messageResponse" }) => void) | null = null

		const callbacks = createCallbacks()
		callbacks.ask = async () => {
			askCalls++
			return new Promise<{ response: "messageResponse" }>((resolve) => {
				resolvePendingAsk = resolve
			}).finally(() => {
				askSettled = true
			})
		}
		callbacks.resolvePendingAsk = () => {
			resolvePendingAsk?.({ response: "messageResponse" })
		}

		const orchestrationPromise = orchestrateCommandExecution(process.asResultPromise(), createTerminalManager(), callbacks, {
			command: "echo test",
		})

		process.emit("line", "line one")
		await new Promise((resolve) => setTimeout(resolve, CHUNK_DEBOUNCE_MS + 40))
		assert.equal(askCalls, 1, "expected command_output ask after buffered output flush")

		process.fail(new Error("process failed"))
		await assert.rejects(orchestrationPromise, /process failed/)

		try {
			await waitFor(() => askSettled, 500)
			assert.equal(askSettled, true, "pending command_output ask should settle after process error")
		} finally {
			;(resolvePendingAsk as ((value: { response: "messageResponse" }) => void) | null)?.({
				response: "messageResponse",
			})
		}
	})

	it("settles a pending command_output ask when execution transitions on timeout", async () => {
		const process = new FakeTerminalProcess()
		let askCalls = 0
		let askSettled = false
		let resolvePendingAsk: ((value: { response: "messageResponse" }) => void) | null = null

		const callbacks = createCallbacks()
		callbacks.ask = async () => {
			askCalls++
			return new Promise<{ response: "messageResponse" }>((resolve) => {
				resolvePendingAsk = resolve
			}).finally(() => {
				askSettled = true
			})
		}
		callbacks.resolvePendingAsk = () => {
			resolvePendingAsk?.({ response: "messageResponse" })
		}

		const orchestrationPromise = orchestrateCommandExecution(process.asResultPromise(), createTerminalManager(), callbacks, {
			command: "sleep 10",
			timeoutSeconds: 0.3,
		})

		process.emit("line", "line one")
		await new Promise((resolve) => setTimeout(resolve, CHUNK_DEBOUNCE_MS + 40))
		assert.equal(askCalls, 1, "expected command_output ask after buffered output flush")
		const result = await orchestrationPromise

		try {
			await waitFor(() => askSettled, 500)
			assert.equal(askSettled, true, "pending command_output ask should settle after timeout transition")
			assert.equal(result.completed, false)
			assert.match(result.result as string, /Command execution timed out/)
		} finally {
			;(resolvePendingAsk as ((value: { response: "messageResponse" }) => void) | null)?.({
				response: "messageResponse",
			})
		}
	})

	it("does not attempt to resolve the same pending ask twice across lifecycle events", async () => {
		const process = new FakeTerminalProcess()
		let askCalls = 0
		let resolvePendingAsk: ((value: { response: "messageResponse" }) => void) | null = null
		let resolvePendingAskCalls = 0

		const callbacks = createCallbacks()
		callbacks.ask = async () => {
			askCalls++
			return new Promise<{ response: "messageResponse" }>((resolve) => {
				resolvePendingAsk = resolve
			})
		}
		callbacks.resolvePendingAsk = () => {
			resolvePendingAskCalls++
			resolvePendingAsk?.({ response: "messageResponse" })
		}

		const orchestrationPromise = orchestrateCommandExecution(process.asResultPromise(), createTerminalManager(), callbacks, {
			command: "echo test",
		})

		process.emit("line", "line one")
		await new Promise((resolve) => setTimeout(resolve, CHUNK_DEBOUNCE_MS + 40))
		assert.equal(askCalls, 1, "expected command_output ask after buffered output flush")

		process.complete({ exitCode: 0, signal: null })
		await orchestrationPromise

		process.emit("error", new Error("late error event"))
		assert.equal(resolvePendingAskCalls, 1, "pending ask should be released at most once")
	})
})
