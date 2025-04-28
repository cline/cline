import { describe, it } from "@jest/globals"
import { inspectTreeStructure, testParseSourceCodeDefinitions } from "./helpers"
import { javaQuery } from "../queries"
import sampleJavaContent from "./fixtures/sample-java"

describe("inspectJava", () => {
	const testOptions = {
		language: "java",
		wasmFile: "tree-sitter-java.wasm",
		queryString: javaQuery,
		extKey: "java",
	}

	it("should inspect Java tree structure", async () => {
		const result = await inspectTreeStructure(sampleJavaContent, "java")
		expect(result).toBeTruthy()
	})

	it("should parse Java definitions", async () => {
		const result = await testParseSourceCodeDefinitions("test.java", sampleJavaContent, testOptions)
		expect(result).toBeTruthy()
		expect(result).toMatch(/\d+--\d+ \| /) // Verify line number format
	})
})
