import { testParseSourceCodeDefinitions, debugLog } from "./helpers"
import { javascriptQuery } from "../queries"
import sampleJsonContent from "./fixtures/sample-json"

// JSON test options
const jsonOptions = {
	language: "javascript",
	wasmFile: "tree-sitter-javascript.wasm",
	queryString: javascriptQuery,
	extKey: "json",
	content: sampleJsonContent,
}

describe("JSON Structure Tests", () => {
	const testFile = "/test/test.json"

	it("should capture basic value types", async () => {
		debugLog("\n=== Basic Value Types ===")
		await testParseSourceCodeDefinitions(testFile, sampleJsonContent, jsonOptions)
	})

	it("should capture nested object structures", async () => {
		debugLog("\n=== Nested Object Structures ===")
		await testParseSourceCodeDefinitions(testFile, sampleJsonContent, jsonOptions)
	})

	it("should capture array structures", async () => {
		debugLog("\n=== Array Structures ===")
		await testParseSourceCodeDefinitions(testFile, sampleJsonContent, jsonOptions)
	})

	it("should capture object arrays", async () => {
		debugLog("\n=== Object Arrays ===")
		await testParseSourceCodeDefinitions(testFile, sampleJsonContent, jsonOptions)
	})

	it("should capture mixed nesting", async () => {
		debugLog("\n=== Mixed Nesting ===")
		await testParseSourceCodeDefinitions(testFile, sampleJsonContent, jsonOptions)
	})

	it("should capture all value types", async () => {
		debugLog("\n=== All Value Types ===")
		await testParseSourceCodeDefinitions(testFile, sampleJsonContent, jsonOptions)
	})

	it("should capture special string content", async () => {
		debugLog("\n=== Special String Content ===")
		await testParseSourceCodeDefinitions(testFile, sampleJsonContent, jsonOptions)
	})
})
