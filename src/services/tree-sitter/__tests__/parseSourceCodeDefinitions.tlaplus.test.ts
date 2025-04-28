import { describe, it, beforeAll } from "@jest/globals"
import { testParseSourceCodeDefinitions } from "./helpers"
import { tlaPlusQuery } from "../queries"
import sampleTLAPlusContent from "./fixtures/sample-tlaplus"

describe("parseSourceCodeDefinitions (TLA+)", () => {
	let parseResult: string

	beforeAll(async () => {
		const testOptions = {
			language: "tlaplus",
			wasmFile: "tree-sitter-tlaplus.wasm",
			queryString: tlaPlusQuery,
			extKey: "tla",
		}
		const result = await testParseSourceCodeDefinitions("test.tla", sampleTLAPlusContent, testOptions)
		if (!result) {
			throw new Error("Failed to parse TLA+ source code definitions")
		}
		parseResult = result
	})

	it("should parse module declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*---- MODULE SimpleModule ----/)
	})

	it("should parse constant declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*CONSTANT N/)
	})

	it("should parse variable declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*VARIABLE x, y, z/)
	})

	it("should parse simple operator definitions", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*Max\(a, b\) ==/)
	})

	it("should parse complex operator definitions", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*ComplexOperator\(seq\) ==/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*ProcessStep ==/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*HandleCase\(val\) ==/)
	})

	it("should parse function definitions", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*SimpleFunction\[a \\in 1\.\.N\] ==/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*Factorial\[n \\in Nat\] ==/)
	})

	it("should parse let expressions", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*LET sum ==/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*LET square ==/)
	})

	it("should parse variable tuple definitions", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*vars == <<x, y, z>>/)
	})
})
