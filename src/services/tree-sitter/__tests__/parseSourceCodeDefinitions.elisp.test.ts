/*
TODO: The following structures can be parsed by tree-sitter but lack query support:

1. Variable Definition:
   (defvar name value docstring)

2. Constant Definition:
   (defconst name value docstring)
*/

import { describe, it, expect } from "@jest/globals"
import { testParseSourceCodeDefinitions } from "./helpers"
import { elispQuery } from "../queries/elisp"
import sampleElispContent from "./fixtures/sample-elisp"

describe("parseSourceCodeDefinitions.elisp", () => {
	const testOptions = {
		language: "elisp",
		wasmFile: "tree-sitter-elisp.wasm",
		queryString: elispQuery,
		extKey: "el",
	}

	let parseResult: string = ""

	beforeAll(async () => {
		const result = await testParseSourceCodeDefinitions("file.el", sampleElispContent, testOptions)
		expect(result).toBeDefined()
		if (!result) {
			throw new Error("Failed to parse source code definitions")
		}
		parseResult = result
	})

	it("should parse function definitions", () => {
		expect(parseResult).toMatch(/\d+--\d+ \| \(defun test-function/)
	})

	it("should parse macro definitions", () => {
		expect(parseResult).toMatch(/\d+--\d+ \| \(defmacro test-macro/)
	})

	it("should parse custom form definitions", () => {
		expect(parseResult).toMatch(/\d+--\d+ \| \(defcustom test-custom/)
	})

	it("should parse face definitions", () => {
		expect(parseResult).toMatch(/\d+--\d+ \| \(defface test-face/)
	})

	it("should parse advice definitions", () => {
		expect(parseResult).toMatch(/\d+--\d+ \| \(defadvice test-advice/)
	})

	it("should parse group definitions", () => {
		expect(parseResult).toMatch(/\d+--\d+ \| \(defgroup test-group nil/)
	})

	it("should verify total number of definitions", () => {
		const matches = parseResult.match(/\d+--\d+ \|/g) || []
		expect(matches.length).toBe(6) // All supported definition types
	})

	it("should verify file header is present", () => {
		expect(parseResult).toMatch(/# file\.el/)
	})
})
