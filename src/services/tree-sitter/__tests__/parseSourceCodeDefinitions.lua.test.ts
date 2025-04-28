import { describe, expect, it, beforeAll } from "@jest/globals"
import { testParseSourceCodeDefinitions } from "./helpers"
import sampleLuaContent from "./fixtures/sample-lua"
import { luaQuery } from "../queries"

const luaOptions = {
	language: "lua",
	wasmFile: "tree-sitter-lua.wasm",
	queryString: luaQuery,
	extKey: "lua",
}

describe("Lua Source Code Definition Tests", () => {
	let parseResult: string | undefined

	beforeAll(async () => {
		parseResult = await testParseSourceCodeDefinitions("file.lua", sampleLuaContent, luaOptions)
		expect(parseResult).toBeDefined()
	})

	it("should parse global function definitions", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*function test_function/)
	})

	it("should parse local function definitions", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*local function test_local_function/)
	})

	it("should parse method definitions", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*function test_module\.test_module_function/)
	})

	it("should parse table declarations with methods", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*local test_table_with_methods = {/)
	})

	it("should parse table declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*local test_table = {/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*local test_array_table = {/)
	})

	it("should parse global variable declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*test_variable_declaration =/)
	})

	it("should parse local variable declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*local test_local_variable =/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*local test_require =/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*local test_module =/)
	})
})
