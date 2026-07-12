import { expect } from "chai"
import { describe, it } from "mocha"
import { getHtmlUtf8ByteLength, MAX_INLINE_HTML_BYTES, shouldInlineHtml } from "../inlineHtmlPolicy"

function asciiContent(expectedBytes: number): string {
	const content = "a".repeat(expectedBytes)
	expect(Buffer.byteLength(content, "utf8")).to.equal(expectedBytes)
	return content
}

describe("inlineHtmlPolicy", () => {
	it("inlines a payload one byte below the 8 MiB cap", () => {
		const content = asciiContent(MAX_INLINE_HTML_BYTES - 1)
		expect(getHtmlUtf8ByteLength(content)).to.equal(MAX_INLINE_HTML_BYTES - 1)
		expect(shouldInlineHtml(getHtmlUtf8ByteLength(content))).to.equal(true)
	})

	it("inlines a payload exactly at the 8 MiB cap", () => {
		const content = asciiContent(MAX_INLINE_HTML_BYTES)
		expect(getHtmlUtf8ByteLength(content)).to.equal(MAX_INLINE_HTML_BYTES)
		expect(shouldInlineHtml(getHtmlUtf8ByteLength(content))).to.equal(true)
	})

	it("uses the URI fallback one byte above the 8 MiB cap", () => {
		const content = asciiContent(MAX_INLINE_HTML_BYTES + 1)
		expect(getHtmlUtf8ByteLength(content)).to.equal(MAX_INLINE_HTML_BYTES + 1)
		expect(shouldInlineHtml(getHtmlUtf8ByteLength(content))).to.equal(false)
	})

	it("measures multibyte UTF-8 content by encoded bytes", () => {
		const content = `${"é".repeat(MAX_INLINE_HTML_BYTES / 2)}a`
		expect(Buffer.byteLength(content, "utf8")).to.equal(MAX_INLINE_HTML_BYTES + 1)
		expect(content.length).to.be.lessThan(MAX_INLINE_HTML_BYTES)
		expect(getHtmlUtf8ByteLength(content)).to.equal(MAX_INLINE_HTML_BYTES + 1)
		expect(shouldInlineHtml(getHtmlUtf8ByteLength(content))).to.equal(false)
	})

	it("accepts the empty normalized proto string", () => {
		const content = ""
		expect(Buffer.byteLength(content, "utf8")).to.equal(0)
		expect(getHtmlUtf8ByteLength(content)).to.equal(0)
		expect(shouldInlineHtml(getHtmlUtf8ByteLength(content))).to.equal(true)
	})
})
