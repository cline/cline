import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import { performTaskAbortCleanup } from "../taskAbortCleanup"

function createDeferred() {
	let resolve!: () => void
	const promise = new Promise<void>((res) => {
		resolve = res
	})
	return { promise, resolve }
}

async function flushMicrotasks(iterations = 5) {
	for (let i = 0; i < iterations; i++) {
		await Promise.resolve()
	}
}

describe("performTaskAbortCleanup", () => {
	it("waits for async disposers before completing abort cleanup", async () => {
		const ignoreDeferred = createDeferred()
		const trackerDeferred = createDeferred()
		const events: string[] = []

		const cleanupPromise = performTaskAbortCleanup({
			urlContentFetcher: {
				closeBrowser: () => {
					events.push("closeBrowser")
				},
			},
			browserSession: {
				dispose: async () => {
					events.push("browserSession")
				},
			},
			clineIgnoreController: {
				dispose: async () => {
					events.push("clineIgnore:start")
					await ignoreDeferred.promise
					events.push("clineIgnore:end")
				},
			},
			fileContextTracker: {
				dispose: async () => {
					events.push("fileTracker:start")
					await trackerDeferred.promise
					events.push("fileTracker:end")
				},
			},
			focusChainManager: {
				dispose: () => {
					events.push("focusChain")
				},
			},
			presentationScheduler: {
				dispose: async () => {
					events.push("presentationScheduler")
				},
			},
		})

		await flushMicrotasks()
		assert.deepStrictEqual(events, ["closeBrowser", "browserSession", "clineIgnore:start", "fileTracker:start", "focusChain"])

		let settled = false
		void cleanupPromise.then(() => {
			settled = true
		})

		await flushMicrotasks()
		assert.equal(settled, false)

		ignoreDeferred.resolve()
		await flushMicrotasks()
		assert.equal(settled, false)

		trackerDeferred.resolve()
		await cleanupPromise

		assert.deepStrictEqual(events, [
			"closeBrowser",
			"browserSession",
			"clineIgnore:start",
			"fileTracker:start",
			"focusChain",
			"clineIgnore:end",
			"fileTracker:end",
			"presentationScheduler",
		])
	})
})
