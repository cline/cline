import { describe, expect, it, beforeAll } from "@jest/globals"
import { testParseSourceCodeDefinitions, debugLog } from "./helpers"
import sampleRustContent from "./fixtures/sample-rust"
import { rustQuery } from "../queries"

// Rust test options
const rustOptions = {
	language: "rust",
	wasmFile: "tree-sitter-rust.wasm",
	queryString: rustQuery,
	extKey: "rs",
}

describe("Rust Source Code Definition Tests", () => {
	let parseResult: string

	beforeAll(async () => {
		const result = await testParseSourceCodeDefinitions("/test/file.rs", sampleRustContent, rustOptions)
		if (!result) {
			throw new Error("Failed to parse Rust definitions")
		}
		parseResult = result
	})

	it("should parse function declarations", () => {
		// Test standard, async, const, and unsafe functions
		expect(parseResult).toMatch(/\d+--\d+ \| fn test_function_definition/)
		expect(parseResult).toMatch(/\d+--\d+ \| async fn test_async_function_definition/)
		expect(parseResult).toMatch(/\d+--\d+ \| const fn test_const_function_definition/)
		expect(parseResult).toMatch(/\d+--\d+ \| .*unsafe fn test_unsafe_function/)

		debugLog("Function declarations:", parseResult.match(/(?:async |const |unsafe )?fn[\s\S]*?[{(]/g))
	})

	it("should parse struct declarations", () => {
		// Test regular and tuple structs
		expect(parseResult).toMatch(/\d+--\d+ \| struct test_struct_definition/)
		expect(parseResult).toMatch(/\d+--\d+ \| struct test_tuple_struct_definition/)
		expect(parseResult).toMatch(/\d+--\d+ \| struct test_lifetime_definition/)

		debugLog("Struct declarations:", parseResult.match(/struct[\s\S]*?{/g))
	})

	it("should parse enum declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \| enum test_enum_definition/)

		debugLog("Enum declarations:", parseResult.match(/enum[\s\S]*?{/g))
	})

	it("should parse trait declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \| trait test_trait_definition/)

		debugLog("Trait declarations:", parseResult.match(/trait[\s\S]*?{/g))
	})

	it("should parse impl blocks", () => {
		// Test regular and trait implementations
		expect(parseResult).toMatch(/\d+--\d+ \| impl test_struct_definition/)
		expect(parseResult).toMatch(/\d+--\d+ \| impl test_trait_definition for test_struct_definition/)

		debugLog("Impl blocks:", parseResult.match(/impl[\s\S]*?{/g))
	})

	it("should parse module declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \| mod test_module_definition/)

		debugLog("Module declarations:", parseResult.match(/mod[\s\S]*?{/g))
	})

	it("should parse macro declarations", () => {
		// Test macro_rules and proc macros
		expect(parseResult).toMatch(/\d+--\d+ \| macro_rules! test_macro_definition/)
		expect(parseResult).toMatch(/\d+--\d+ \| #\[derive\(/)

		debugLog("Macro declarations:", parseResult.match(/(?:macro_rules!|#\[derive)[\s\S]*?[}|\)]/g))
	})

	it("should parse type aliases", () => {
		expect(parseResult).toMatch(/\d+--\d+ \| type test_generic_type_alias/)

		debugLog("Type aliases:", parseResult.match(/type[\s\S]*?[;|=]/g))
	})
	it("should parse const and static declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \| const fn test_const_function_definition/)
		expect(parseResult).toMatch(/234--238 \| static TEST_STATIC_DEFINITION/)

		debugLog("Const/static declarations:", parseResult.match(/(?:const fn|static)[\s\S]*?[{=]/g))
	})

	it("should parse use declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \| .*use super::/)

		debugLog("Use declarations:", parseResult.match(/use[\s\S]*?[{;]/g))
	})
})
