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

	it("redacts parenthesized and bracketed parts of a URL instead of stopping at them", () => {
		expect(redactUrlsInText("redirect to https://example.com/cb?code=(SECRET) failed")).toBe(
			"redirect to https://example.com failed",
		)
		expect(redactUrlsInText("GET https://example.com/a[SECRET]/b")).toBe("GET https://example.com")
		expect(redactUrlsInText("GET https://example.com/a{SECRET}")).toBe("GET https://example.com")
	})

	it("keeps IPv6 hosts intact", () => {
		expect(redactUrlsInText("connect http://[::1]:3000/cb?code=SECRET")).toBe("connect http://[::1]:3000")
		expect(redactUrlsInText("connect http://[::1]:3000.")).toBe("connect http://[::1]:3000.")
	})

	it("keeps punctuation that closes the surrounding sentence", () => {
		expect(redactUrlsInText("(see https://example.com/p?k=1), then retry.")).toBe("(see https://example.com), then retry.")
	})

	it("runs in linear time on adversarial input", () => {
		const inputs = [`https://a${"!".repeat(50_000)}`, "a.".repeat(50_000), `${"a".repeat(50_000)}:/`]
		for (const input of inputs) {
			const start = performance.now()
			redactUrlsInText(input)
			expect(performance.now() - start).toBeLessThan(250)
		}
	})

	it("leaves text without URLs untouched", () => {
		expect(redactUrlsInText("connect ECONNREFUSED 127.0.0.1:443")).toBe("connect ECONNREFUSED 127.0.0.1:443")
	})
})
