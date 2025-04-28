import { describe, it } from "@jest/globals"
import { inspectTreeStructure, testParseSourceCodeDefinitions } from "./helpers"
import { elispQuery } from "../queries/elisp"
import sampleElispContent from "./fixtures/sample-elisp"

describe("inspectElisp", () => {
	const testOptions = {
		language: "elisp",
		wasmFile: "tree-sitter-elisp.wasm",
		queryString: elispQuery,
		extKey: "el",
	}

	it("should validate Elisp tree structure inspection", async () => {
		const result = await inspectTreeStructure(sampleElispContent, "elisp")
		expect(result).toBeDefined()
		expect(result.length).toBeGreaterThan(0)
	})

	it("should validate Elisp definitions parsing", async () => {
		const result = await testParseSourceCodeDefinitions("test.el", sampleElispContent, testOptions)
		expect(result).toBeDefined()
		expect(result).toMatch(/\d+--\d+ \|/) // Verify line number format

		// Verify some sample content is parsed
		expect(result).toMatch(/defun test-function/)
		expect(result).toMatch(/defmacro test-macro/)
	})
})
