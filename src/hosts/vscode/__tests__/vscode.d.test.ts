const { expect } = require("chai")
const { describe, it } = require("mocha")
const { runVscodeDeprecationTests } = require("./vscode-deprecation-test")

describe("VSCode API Deprecation Warnings", () => {
	it("should have proper TypeScript declaration overrides with deprecation warnings", () => {
		// This test wraps our standalone test script
		// The script will throw/exit if any test fails, so if we get here, all tests passed
		const result = runVscodeDeprecationTests()
		expect(result).to.be.true
	})
})
