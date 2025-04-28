import { describe, it } from "@jest/globals"
import { inspectTreeStructure, testParseSourceCodeDefinitions } from "./helpers"
import { elixirQuery } from "../queries"
import sampleElixirContent from "./fixtures/sample-elixir"

describe("inspectElixir", () => {
	const testOptions = {
		language: "elixir",
		wasmFile: "tree-sitter-elixir.wasm",
		queryString: elixirQuery,
		extKey: "ex",
	}

	it("should inspect Elixir tree structure", async () => {
		const result = await inspectTreeStructure(sampleElixirContent, "elixir")
		expect(result).toBeDefined()
		expect(result.length).toBeGreaterThan(0)
	})

	it("should parse Elixir definitions", async () => {
		const result = await testParseSourceCodeDefinitions("test.ex", sampleElixirContent, testOptions)
		expect(result).toBeDefined()
		expect(result).toContain("--")
		expect(result).toMatch(/\d+--\d+ \|/)
	})
})
