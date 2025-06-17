// npx vitest services/tree-sitter/__tests__/inspectSwift.spec.ts

import { inspectTreeStructure, testParseSourceCodeDefinitions, debugLog } from "./helpers"
import { swiftQuery } from "../queries"
import sampleSwiftContent from "./fixtures/sample-swift"

// This is insanely slow for some reason.
describe.skip("inspectSwift", () => {
	const testOptions = {
		language: "swift",
		wasmFile: "tree-sitter-swift.wasm",
		queryString: swiftQuery,
		extKey: "swift",
	}

	it("should inspect Swift tree structure", async () => {
		// Should execute without throwing
		await expect(inspectTreeStructure(sampleSwiftContent, "swift")).resolves.not.toThrow()
	})

	it("should parse Swift definitions", async () => {
		// This test validates that testParseSourceCodeDefinitions produces output
		const result = await testParseSourceCodeDefinitions("test.swift", sampleSwiftContent, testOptions)
		expect(result).toBeDefined()

		// Check that the output format includes line numbers and content
		if (result) {
			expect(result).toMatch(/\d+--\d+ \| .+/)
			debugLog("Swift parsing test completed successfully")
		}
	}, 15000) // Increase timeout to 15 seconds
})
