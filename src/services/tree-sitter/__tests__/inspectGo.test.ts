import { describe, it, expect } from "@jest/globals"
import { inspectTreeStructure, testParseSourceCodeDefinitions } from "./helpers"
import sampleGoContent from "./fixtures/sample-go"
import goQuery from "../queries/go"

describe("Go Tree-sitter Parser", () => {
	// Test 1: Get query structure output
	it("should inspect tree structure", async () => {
		await inspectTreeStructure(sampleGoContent, "go")
	})

	// Test 2: Get line numbers
	it("should parse source code definitions", async () => {
		const testOptions = {
			language: "go",
			wasmFile: "tree-sitter-go.wasm",
			queryString: goQuery,
			extKey: "go",
		}

		const result = await testParseSourceCodeDefinitions("file.go", sampleGoContent, testOptions)
		expect(result).toBeDefined()
	})
})
