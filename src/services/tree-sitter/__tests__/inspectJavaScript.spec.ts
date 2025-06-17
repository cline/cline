import { inspectTreeStructure, testParseSourceCodeDefinitions } from "./helpers"
import { javascriptQuery } from "../queries"
import sampleJavaScriptContent from "./fixtures/sample-javascript"

describe("inspectJavaScript", () => {
	const testOptions = {
		language: "javascript",
		wasmFile: "tree-sitter-javascript.wasm",
		queryString: javascriptQuery,
		extKey: "js",
	}

	it("should inspect JavaScript tree structure", async () => {
		// Should not throw
		await expect(inspectTreeStructure(sampleJavaScriptContent, "javascript")).resolves.not.toThrow()
	})

	it("should parse JavaScript definitions", async () => {
		const result = await testParseSourceCodeDefinitions("test.js", sampleJavaScriptContent, testOptions)
		expect(result).toBeDefined()
		expect(result).toMatch(/\d+--\d+ \| /)
		expect(result).toMatch(/function testFunctionDefinition/)
	})
})
