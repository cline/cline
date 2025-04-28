import { describe, it } from "@jest/globals"
import { inspectTreeStructure, testParseSourceCodeDefinitions } from "./helpers"
import { rubyQuery } from "../queries"
import sampleRubyContent from "./fixtures/sample-ruby"

describe("inspectRuby", () => {
	const testOptions = {
		language: "ruby",
		wasmFile: "tree-sitter-ruby.wasm",
		queryString: rubyQuery,
		extKey: "rb",
	}

	it("should inspect Ruby tree structure and parse definitions", async () => {
		// First inspect the tree structure
		await inspectTreeStructure(sampleRubyContent, "ruby")

		// Then validate definition parsing
		const result = await testParseSourceCodeDefinitions("test.rb", sampleRubyContent, testOptions)
		expect(result).toMatch(/\d+--\d+ \|/) // Verify line number format
	})
})
