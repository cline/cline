import { readFile } from "fs/promises"
import { describe, it } from "mocha"
import path from "path"
import "should"

/**
 * Regression test: deactivate() must await tearDown().
 *
 * Without the await, VS Code's extension host races against async cleanup
 * (webview disposal, hook process termination) causing:
 * - Slow/stuck "Stopping Extension Hosts" dialog
 * - Tasks auto-restarting on reload, burning API credits
 *
 * See: https://github.com/cline/cline/issues/10051
 */

describe("deactivate() regression guard", () => {
	it("should await tearDown() in the deactivate function", async () => {
		const extensionPath = path.join(__dirname, "..", "extension.ts")
		const source = await readFile(extensionPath, "utf8")

		// Extract the deactivate function body
		const deactivateMatch = source.match(/export\s+async\s+function\s+deactivate\s*\(\s*\)\s*\{([\s\S]*?)\n\}/)

		should.exist(deactivateMatch, "deactivate function should exist in extension.ts")

		const deactivateBody = deactivateMatch![1]

		// Verify tearDown() is called with await
		const hasTearDownAwait = /await\s+tearDown\s*\(\s*\)/.test(deactivateBody)
		hasTearDownAwait.should.be.true()

		// Verify there's no un-awaited tearDown call (defensive: no tearDown() without a preceding await)
		const tearDownCalls = deactivateBody.match(/tearDown\s*\(\s*\)/g) || []
		const awaitedTearDownCalls = deactivateBody.match(/await\s+tearDown\s*\(\s*\)/g) || []
		tearDownCalls.length.should.equal(awaitedTearDownCalls.length, "Every tearDown() call in deactivate must be awaited")
	})
})
