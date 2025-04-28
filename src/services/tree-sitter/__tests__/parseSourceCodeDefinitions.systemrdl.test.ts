import { describe, it, expect, beforeAll } from "@jest/globals"
import { testParseSourceCodeDefinitions } from "./helpers"
import systemrdlQuery from "../queries/systemrdl"
import sampleSystemRDLContent from "./fixtures/sample-systemrdl"

describe("SystemRDL Source Code Definition Tests", () => {
	let parseResult: string

	beforeAll(async () => {
		const result = await testParseSourceCodeDefinitions("test.rdl", sampleSystemRDLContent, {
			language: "systemrdl",
			wasmFile: "tree-sitter-systemrdl.wasm",
			queryString: systemrdlQuery,
			extKey: "rdl",
		})
		expect(result).toBeDefined()
		expect(typeof result).toBe("string")
		parseResult = result as string
	})

	it("should parse component definitions", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*addrmap top_map {/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*reg block_ctrl {/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*reg status_reg {/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*reg complex_reg {/)
	})

	it("should parse field definitions", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*field {/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*} enable\[1:0\];/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*field {/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*} status;/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*field {/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*} errors\[3:0\];/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*field {/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*} ctrl\[7:0\];/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*field {/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*} status\[15:8\];/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*field {/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*} flags\[23:16\];/)
	})

	it("should parse property definitions", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*property my_custom_prop {/)
	})

	it("should parse parameter definitions", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*parameter DATA_WIDTH {/)
	})

	it("should parse enum definitions", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*enum error_types {/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*enum interrupt_type {/)
	})
})
