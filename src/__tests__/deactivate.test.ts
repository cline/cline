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
	it("should await tearDown() in extension.ts", async () => {
		const extensionPath = path.join(__dirname, "..", "extension.ts")
		const source = await readFile(extensionPath, "utf8")

		// Verify that `await tearDown()` exists somewhere in the file.
		// This is intentionally simple — no function-body extraction needed.
		const hasAwaitedTearDown = /await\s+tearDown\s*\(\s*\)/.test(source)
		hasAwaitedTearDown.should.be.true()
	})
})
