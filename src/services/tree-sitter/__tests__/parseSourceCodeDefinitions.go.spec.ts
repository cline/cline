/*
TODO: The following structures can be parsed by tree-sitter but lack query support:

1. Anonymous Functions (func_literal):
   (func_literal parameters: (parameter_list) body: (block ...))
   - Currently visible in goroutine and defer statements
   - Would enable capturing lambda/closure definitions

2. Map Types (map_type):
   (map_type key: (type_identifier) value: (interface_type))
   - Currently visible in struct field declarations
   - Would enable capturing map type definitions

3. Pointer Types (pointer_type):
   (pointer_type (type_identifier))
   - Currently visible in method receiver declarations
   - Would enable capturing pointer type definitions
*/

import sampleGoContent from "./fixtures/sample-go"
import { testParseSourceCodeDefinitions } from "./helpers"
import goQuery from "../queries/go"

describe("Go Source Code Definition Tests", () => {
	let parseResult: string

	beforeAll(async () => {
		const testOptions = {
			language: "go",
			wasmFile: "tree-sitter-go.wasm",
			queryString: goQuery,
			extKey: "go",
		}

		const result = await testParseSourceCodeDefinitions("file.go", sampleGoContent, testOptions)
		expect(result).toBeDefined()
		parseResult = result as string
	})

	it("should capture the entire Go file as a single block", () => {
		// With the universal 50-character threshold, the entire file is captured as one block
		expect(parseResult).toMatch(/2--126 \| \/\/ Package declaration test/)
	})

	it("should contain package declaration in the captured content", () => {
		// The captured block should contain the package declaration
		expect(parseResult).toContain("# file.go")
		expect(parseResult).toContain("2--126")
	})

	it("should not have duplicate captures", () => {
		// Should only have one capture for the entire file
		const lineRanges = parseResult.match(/\d+--\d+ \|/g)
		expect(lineRanges).toBeDefined()
		expect(lineRanges!.length).toBe(1)
	})
})
