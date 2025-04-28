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

import { describe, it, expect, beforeAll } from "@jest/globals"
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

	it("should parse package declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*package main/)
	})

	it("should parse import declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*"fmt"/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*"sync"/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*"time"/)
	})

	it("should parse const declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*TestConstDefinition1 = "test1"/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*TestConstDefinition2 = "test2"/)
	})

	it("should parse var declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*TestVarDefinition1 string = "var1"/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*TestVarDefinition2 int\s*= 42/)
	})

	it("should parse interface declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*type TestInterfaceDefinition interface/)
	})

	it("should parse struct declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*type TestStructDefinition struct/)
	})

	it("should parse type declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*type TestTypeDefinition struct/)
	})

	it("should parse function declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*func TestFunctionDefinition\(/)
	})

	it("should parse method declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*func \(t \*TestStructDefinition\) TestMethodDefinition\(/)
	})

	it("should parse channel function declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*func TestChannelDefinition\(/)
	})

	it("should parse goroutine function declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*func TestGoroutineDefinition\(\)/)
	})

	it("should parse defer function declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*func TestDeferDefinition\(\)/)
	})

	it("should parse select function declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*func TestSelectDefinition\(/)
	})
})
