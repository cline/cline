import { describe, expect, it } from "bun:test"
import { redactUrlForLog } from "./redact-url"

// Origin followed by a 3-hex-digit fingerprint of the full URL, e.g. "https://a (3f1)".
const REDACTED = /^(.*) \(([0-9a-f]{3})\)$/

function split(redacted: string): { text: string; fingerprint: string } {
	const match = redacted.match(REDACTED)
	if (!match) {
		throw new Error(`Unexpected redacted form: ${redacted}`)
	}
	return { text: match[1], fingerprint: match[2] }
}

describe("redactUrlForLog", () => {
	it("keeps only the origin", () => {
		expect(split(redactUrlForLog("https://api.cline.bot/api/v1/auth/authorize?state=abc&code_challenge=xyz#frag")).text).toBe(
			"https://api.cline.bot",
		)
	})

	it("drops path segments, which can carry credentials", () => {
		expect(split(redactUrlForLog("https://actions.example.com/mcp/sk-SECRET/sse")).text).toBe("https://actions.example.com")
	})

	it("drops userinfo", () => {
		expect(split(redactUrlForLog("https://user:secret@example.com/path?x=1")).text).toBe("https://example.com")
	})

	it("keeps a non-default port", () => {
		expect(split(redactUrlForLog("http://127.0.0.1:3000/callback?code=1")).text).toBe("http://127.0.0.1:3000")
	})

	it("does not echo non-hierarchical URLs or unparseable input", () => {
		expect(split(redactUrlForLog("mailto:someone@example.com")).text).toBe("mailto:<redacted>")
		expect(split(redactUrlForLog("not a url ?token=secret")).text).toBe("<invalid url>")
	})

	it("appends the same fingerprint for the same URL", () => {
		const a = redactUrlForLog("https://example.com/cb?state=1")
		const b = redactUrlForLog("https://example.com/cb?state=1")
		expect(a).toBe(b)
	})

	it("tells apart two URLs that share an origin", () => {
		const a = split(redactUrlForLog("https://example.com/cb?state=1"))
		const b = split(redactUrlForLog("https://example.com/cb?state=2"))
		expect(a.text).toBe(b.text)
		expect(a.fingerprint).not.toBe(b.fingerprint)
	})
})
