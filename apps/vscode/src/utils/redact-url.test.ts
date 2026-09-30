import { describe, expect, it } from "bun:test"
import { redactUrlForLog, redactUrlsInText } from "./redact-url"

describe("redactUrlForLog", () => {
	it("keeps only the origin", () => {
		expect(redactUrlForLog("https://api.cline.bot/api/v1/auth/authorize?state=abc&code_challenge=xyz#frag")).toBe(
			"https://api.cline.bot",
		)
	})

	it("drops path segments, which can carry credentials", () => {
		expect(redactUrlForLog("https://actions.example.com/mcp/sk-SECRET/sse")).toBe("https://actions.example.com")
	})

	it("drops userinfo", () => {
		expect(redactUrlForLog("https://user:secret@example.com/path?x=1")).toBe("https://example.com")
	})

	it("keeps a non-default port", () => {
		expect(redactUrlForLog("http://127.0.0.1:3000/callback?code=1")).toBe("http://127.0.0.1:3000")
	})

	it("does not echo non-hierarchical URLs or unparseable input", () => {
		expect(redactUrlForLog("mailto:someone@example.com")).toBe("mailto:<redacted>")
		expect(redactUrlForLog("not a url ?token=secret")).toBe("<invalid url>")
	})
})

describe("redactUrlsInText", () => {
	it("reduces every URL in the text to its origin", () => {
		expect(redactUrlsInText("from https://a.example.com/x?k=1 to http://b.example.com:8080/y/z done")).toBe(
			"from https://a.example.com to http://b.example.com:8080 done",
		)
	})

	it("stops at quotes so surrounding text survives", () => {
		expect(redactUrlsInText('"https://a.example.com/p?k=SECRET" cannot be parsed as a URL.')).toBe(
			'"https://a.example.com" cannot be parsed as a URL.',
		)
	})

	it("redacts file URLs entirely", () => {
		expect(redactUrlsInText("ENOENT file:///Users/someone/secret.txt")).toBe("ENOENT file:<redacted>")
	})

	it("leaves text without URLs untouched", () => {
		expect(redactUrlsInText("connect ECONNREFUSED 127.0.0.1:443")).toBe("connect ECONNREFUSED 127.0.0.1:443")
	})
})
