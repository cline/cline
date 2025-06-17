import { inspectTreeStructure, testParseSourceCodeDefinitions, debugLog } from "./helpers"
import { rustQuery } from "../queries"
import sampleRustContent from "./fixtures/sample-rust"

describe("inspectRust", () => {
	const testOptions = {
		language: "rust",
		wasmFile: "tree-sitter-rust.wasm",
		queryString: rustQuery,
		extKey: "rs",
	}

	it("should inspect Rust tree structure", async () => {
		// This test only validates that inspectTreeStructure succeeds
		// It will output debug information when DEBUG=1 is set
		const result = await inspectTreeStructure(sampleRustContent, "rust")
		expect(result).toBeDefined()
	})

	it("should parse Rust definitions", async () => {
		// This test validates that parsing produces output with line numbers
		const result = await testParseSourceCodeDefinitions("test.rs", sampleRustContent, testOptions)

		// Only validate that we get some output with the expected format
		expect(result).toBeTruthy()

		// Check that the output contains line numbers in the format "N--M | content"
		expect(result).toMatch(/\d+--\d+ \|/)

		// Output for debugging purposes
		debugLog("Rust definitions parsing succeeded")
	})
})
