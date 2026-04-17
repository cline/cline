import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import { measureAsyncOperation } from "@/test/stress-utils"
import { performTaskAbortCleanup } from "../taskAbortCleanup"

describe("performTaskAbortCleanup soak", () => {
	it("handles 1,000 repeated abort cleanup cycles within a bounded budget", async function () {
		this.timeout(20_000)

		const closeBrowserCalls: string[] = []
		const diffReverts: string[] = []
		const diffResets: string[] = []
		const browserDisposals: string[] = []
		const ignoreDisposals: string[] = []
		const trackerDisposals: string[] = []
		const focusDisposals: string[] = []
		const presentationDisposals: string[] = []

		const measured = await measureAsyncOperation("taskAbortCleanup soak cycles", async () => {
			for (let cycle = 0; cycle < 1_000; cycle++) {
				await performTaskAbortCleanup({
					urlContentFetcher: {
						closeBrowser: async () => {
							closeBrowserCalls.push(`closeBrowser-${cycle}`)
						},
					},
					diffViewProvider: {
						revertChanges: async () => {
							diffReverts.push(`diffRevert-${cycle}`)
						},
						reset: async () => {
							diffResets.push(`diffReset-${cycle}`)
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

			return closeBrowserCalls.length
		})

		assert.equal(measured.result, 1_000)
		assert.equal(closeBrowserCalls.length, 1_000)
		assert.equal(diffReverts.length, 1_000)
		assert.equal(diffResets.length, 1_000)
		assert.equal(browserDisposals.length, 1_000)
		assert.equal(ignoreDisposals.length, 1_000)
		assert.equal(trackerDisposals.length, 1_000)
		assert.equal(focusDisposals.length, 1_000)
		assert.equal(presentationDisposals.length, 1_000)
		assert.ok(measured.durationMs < 20_000)
		assert.ok(measured.diff.heapUsedDelta < 128 * 1024 * 1024)
		assert.ok(measured.diff.activeHandleCountDelta <= 2)
	})
})
