import { describe, expect, it } from "bun:test"
import { redactUrlForLog } from "./redact-url"

describe("redactUrlForLog", () => {
	it("drops the query string and fragment", () => {
		expect(redactUrlForLog("https://api.cline.bot/api/v1/auth/authorize?state=abc&code_challenge=xyz#frag")).toBe(
			"https://api.cline.bot/api/v1/auth/authorize",
		)
	})

	it("drops userinfo", () => {
		expect(redactUrlForLog("https://user:secret@example.com/path?x=1")).toBe("https://example.com/path")
	})

	it("keeps a non-default port", () => {
		expect(redactUrlForLog("http://127.0.0.1:3000/callback?code=1")).toBe("http://127.0.0.1:3000/callback")
	})

	it("does not echo non-hierarchical URLs or unparseable input", () => {
		expect(redactUrlForLog("mailto:someone@example.com")).toBe("mailto:<redacted>")
		expect(redactUrlForLog("not a url ?token=secret")).toBe("<invalid url>")
	})
})
