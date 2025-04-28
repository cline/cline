import { describe, it } from "@jest/globals"
import { inspectTreeStructure, testParseSourceCodeDefinitions } from "./helpers"
import { tlaPlusQuery } from "../queries"
import sampleTLAPlusContent from "./fixtures/sample-tlaplus"

describe("inspectTLAPlus", () => {
	const testOptions = {
		language: "tlaplus",
		wasmFile: "tree-sitter-tlaplus.wasm",
		queryString: tlaPlusQuery,
		extKey: "tla",
	}

	it("should inspect TLA+ tree structure", async () => {
		await inspectTreeStructure(sampleTLAPlusContent, "tlaplus")
	})

	it("should parse TLA+ definitions", async () => {
		await testParseSourceCodeDefinitions("test.tla", sampleTLAPlusContent, testOptions)
	})
})
