import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { describe, it } from "mocha"
import type { TerminalCompletionDetails, TerminalProcessEvents, TerminalProcessResultPromise } from "../types"
import { StandaloneTerminalManager } from "./StandaloneTerminalManager"

class FakeBackgroundProcess extends EventEmitter<TerminalProcessEvents> {
	public isHot = false
	public waitForShellIntegration = false
	public terminateCalls = 0

	continue(): void {}

	getUnretrievedOutput(): string {
		return ""
	}

	getCompletionDetails(): TerminalCompletionDetails {
		return {}
	}

	terminate(): void {
		this.terminateCalls++
	}

	asResultPromise(): TerminalProcessResultPromise {
		const promise = Promise.resolve() as TerminalProcessResultPromise
		const process = this as FakeBackgroundProcess & Partial<TerminalProcessResultPromise>
		process.then = promise.then.bind(promise)
		process.catch = promise.catch.bind(promise)
		process.finally = promise.finally.bind(promise)
		return process as TerminalProcessResultPromise
	}
}

describe("StandaloneTerminalManager background command cleanup", () => {
	it("does not accumulate tracked background commands across repeated track/cancel cycles", () => {
		const manager = new StandaloneTerminalManager()
		const createdProcesses: FakeBackgroundProcess[] = []

		for (let cycle = 0; cycle < 5; cycle++) {
			const process = new FakeBackgroundProcess()
			createdProcesses.push(process)
			const tracked = manager.trackBackgroundCommand(process.asResultPromise(), `sleep ${cycle}`, [`line ${cycle}`])

			assert.equal(manager.hasActiveBackgroundCommands(), true)
			assert.equal(manager.getRunningBackgroundCommands().length, 1)
			assert.equal(manager.cancelBackgroundCommand(tracked.id), true)
			assert.equal(process.terminateCalls, 1)
			assert.equal(manager.hasActiveBackgroundCommands(), false)
			assert.equal(manager.getRunningBackgroundCommands().length, 0)
			assert.equal(manager.getAllBackgroundCommands().length, 0)
			assert.equal((manager as any).backgroundTimeouts.size, 0)
			assert.equal((manager as any).logStreams.size, 0)
		}

		manager.disposeAll()

		for (const process of createdProcesses) {
			assert.equal(process.terminateCalls, 1)
		}
	})
})
