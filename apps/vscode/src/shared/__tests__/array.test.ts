import assert from "node:assert/strict"
import { describe, it } from "mocha"
import { parsePartialArrayString } from "../array"

describe("parsePartialArrayString", () => {
	it("parses complete JSON string arrays", () => {
		assert.deepEqual(parsePartialArrayString('["Read all files", "Pick files"]'), ["Read all files", "Pick files"])
	})

	it("parses partial array strings", () => {
		assert.deepEqual(parsePartialArrayString('["Read all files", "Pick'), ["Read all files", "Pick"])
	})

	it("returns an empty array for complete JSON values that are not arrays", () => {
		assert.deepEqual(parsePartialArrayString('{"files":["README.md"]}'), [])
		assert.deepEqual(parsePartialArrayString("null"), [])
		assert.deepEqual(parsePartialArrayString('"Read README.md"'), [])
	})

	it("accepts runtime array values and keeps only string options", () => {
		assert.deepEqual(parsePartialArrayString(["Read all files", 42, "Pick files"]), ["Read all files", "Pick files"])
	})
})
