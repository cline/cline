import { describe, it } from "mocha"
import "should"
import {
	getLargestLineBytes,
	getSafeEditDisplayContent,
	MAX_FILE_EDIT_CONTENT_BYTES,
	MAX_FILE_EDIT_DISPLAY_BYTES,
	MAX_FILE_EDIT_LINE_BYTES,
	validateFileEditSafety,
} from "../LargeEditGuards"

describe("LargeEditGuards", () => {
	it("measures the largest line in UTF-8 bytes", () => {
		getLargestLineBytes("a\n🙂🙂\nabc").should.equal(Buffer.byteLength("🙂🙂", "utf8"))
	})

	it("allows content within byte and line budgets", () => {
		;(() =>
			validateFileEditSafety("line1\nline2", {
				relPath: "safe.ts",
				operation: "edit",
				maxContentBytes: 32,
				maxLineBytes: 32,
			})).should.not.throw()
	})

	it("rejects oversized total edit payloads", () => {
		const oversized = "x".repeat(MAX_FILE_EDIT_CONTENT_BYTES + 1)
		;(() => validateFileEditSafety(oversized, { relPath: "big.ts", operation: "edit" })).should.throw(
			/edit payload is too large/,
		)
	})

	it("rejects oversized single-line payloads", () => {
		const giantLine = "x".repeat(MAX_FILE_EDIT_LINE_BYTES + 1)
		;(() => validateFileEditSafety(giantLine, { relPath: "big-line.ts", operation: "edit" })).should.throw(
			/at least one line is too large/,
		)
	})

	it("returns original content for small display payloads", () => {
		const result = getSafeEditDisplayContent("line1\nline2", {
			relPath: "safe.ts",
			context: "Patch preview",
			maxDisplayBytes: 128,
			maxLineBytes: 128,
		})

		result.wasSummarized.should.equal(false)
		result.text!.should.equal("line1\nline2")
	})

	it("summarizes oversized display payloads", () => {
		const oversized = "x".repeat(MAX_FILE_EDIT_DISPLAY_BYTES + 1)
		const result = getSafeEditDisplayContent(oversized, {
			relPath: "big.ts",
			context: "Patch preview",
		})

		result.wasSummarized.should.equal(true)
		result.text!.should.match(/omitted from tool payload/)
	})

	it("summarizes payloads with giant lines even if total size is small enough", () => {
		const giantLine = "x".repeat(MAX_FILE_EDIT_LINE_BYTES + 1)
		const result = getSafeEditDisplayContent(giantLine, {
			relPath: "big-line.ts",
			context: "Patch preview",
			maxDisplayBytes: giantLine.length + 10,
		})

		result.wasSummarized.should.equal(true)
		result.text!.should.match(/largest line/)
	})
})
