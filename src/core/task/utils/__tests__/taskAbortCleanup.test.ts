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

	it("cleans up all resources across repeated abort cycles without drift", async () => {
		const closeBrowserCalls: string[] = []
		const browserDisposals: string[] = []
		const ignoreDisposals: string[] = []
		const trackerDisposals: string[] = []
		const focusDisposals: string[] = []
		const presentationDisposals: string[] = []

		for (let cycle = 0; cycle < 5; cycle++) {
			await performTaskAbortCleanup({
				urlContentFetcher: {
					closeBrowser: async () => {
						closeBrowserCalls.push(`closeBrowser-${cycle}`)
					},
				},
				browserSession: {
					dispose: async () => {
						browserDisposals.push(`browser-${cycle}`)
					},
				},
				clineIgnoreController: {
					dispose: async () => {
						ignoreDisposals.push(`ignore-${cycle}`)
					},
				},
				fileContextTracker: {
					dispose: async () => {
						trackerDisposals.push(`tracker-${cycle}`)
					},
				},
				focusChainManager: {
					dispose: async () => {
						focusDisposals.push(`focus-${cycle}`)
					},
				},
				presentationScheduler: {
					dispose: async () => {
						presentationDisposals.push(`presentation-${cycle}`)
					},
				},
			})
		}

		assert.deepStrictEqual(closeBrowserCalls, [
			"closeBrowser-0",
			"closeBrowser-1",
			"closeBrowser-2",
			"closeBrowser-3",
			"closeBrowser-4",
		])
		assert.deepStrictEqual(browserDisposals, ["browser-0", "browser-1", "browser-2", "browser-3", "browser-4"])
		assert.deepStrictEqual(ignoreDisposals, ["ignore-0", "ignore-1", "ignore-2", "ignore-3", "ignore-4"])
		assert.deepStrictEqual(trackerDisposals, ["tracker-0", "tracker-1", "tracker-2", "tracker-3", "tracker-4"])
		assert.deepStrictEqual(focusDisposals, ["focus-0", "focus-1", "focus-2", "focus-3", "focus-4"])
		assert.deepStrictEqual(presentationDisposals, [
			"presentation-0",
			"presentation-1",
			"presentation-2",
			"presentation-3",
			"presentation-4",
		])
	})
})
