import { expect } from "chai"
import { describe, it } from "mocha"
import { assertTrustedMarketplaceUrl } from "../marketplaceUrlAllowlist"

describe("assertTrustedMarketplaceUrl", () => {
	it("accepts a URL on the configured modules marketplace origin", () => {
		expect(() =>
			assertTrustedMarketplaceUrl("https://ai-hydro.github.io/Modules/api/some-module/module.html", "test"),
		).to.not.throw()
	})

	it("accepts a URL on the configured research gallery origin", () => {
		expect(() => assertTrustedMarketplaceUrl("https://ai-hydro.github.io/Gallery/api/x.json", "test")).to.not.throw()
	})

	it("rejects a URL on an unrelated origin (audit finding E-2)", () => {
		expect(() => assertTrustedMarketplaceUrl("https://evil.example.com/module.html", "test")).to.throw(/allowlist/)
	})

	it("rejects a lookalike host (typosquat / subdomain trick)", () => {
		expect(() => assertTrustedMarketplaceUrl("https://ai-hydro.github.io.evil.com/x", "test")).to.throw(/allowlist/)
	})

	it("rejects malformed URLs instead of throwing an unrelated parse error", () => {
		expect(() => assertTrustedMarketplaceUrl("not-a-url", "test")).to.throw(/not a valid URL/)
	})

	it("rejects a non-http(s) scheme (e.g. file://) even on the right host string", () => {
		expect(() => assertTrustedMarketplaceUrl("file:///etc/passwd", "test")).to.throw()
	})
})
