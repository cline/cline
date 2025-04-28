import { describe, it, expect } from "@jest/globals"
import { inspectTreeStructure, testParseSourceCodeDefinitions } from "./helpers"
import { ocamlQuery } from "../queries"
import { sampleOCaml } from "./fixtures/sample-ocaml"

describe("inspectOCaml", () => {
	const testOptions = {
		language: "ocaml",
		wasmFile: "tree-sitter-ocaml.wasm",
		queryString: ocamlQuery,
		extKey: "ml",
	}

	it("should inspect OCaml tree structure", async () => {
		const result = await inspectTreeStructure(sampleOCaml, "ocaml")
		expect(result).toBeDefined()
		expect(result.length).toBeGreaterThan(0)
	})

	it("should parse OCaml definitions", async () => {
		const result = await testParseSourceCodeDefinitions("test.ml", sampleOCaml, testOptions)
		expect(result).toBeDefined()
		expect(result).toMatch(/\d+--\d+ \| module StringSet/)
		expect(result).toMatch(/\d+--\d+ \| type shape/)
		expect(result).toMatch(/\d+--\d+ \| let rec process_list/)
	})
})
