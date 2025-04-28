import { describe, it } from "@jest/globals"
import { inspectTreeStructure, testParseSourceCodeDefinitions, debugLog } from "./helpers"
import systemrdlQuery from "../queries/systemrdl"
import sampleSystemRDLContent from "./fixtures/sample-systemrdl"

describe("inspectSystemRDL", () => {
	const testOptions = {
		language: "systemrdl",
		wasmFile: "tree-sitter-systemrdl.wasm",
		queryString: systemrdlQuery,
		extKey: "rdl",
	}

	it("should inspect SystemRDL tree structure", async () => {
		await inspectTreeStructure(sampleSystemRDLContent, "systemrdl")
	})

	it("should parse SystemRDL definitions", async () => {
		const result = await testParseSourceCodeDefinitions("test.rdl", sampleSystemRDLContent, testOptions)
		debugLog("SystemRDL parse result:", result)
	})
})
