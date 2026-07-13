import { describe, expect, it } from "vitest"
import { applyInstalledPackCsp, buildInstalledPackCsp, INSTALLED_PACK_CSP } from "../installedPackCsp"

describe("installed Learning Pack CSP", () => {
	it("blocks every external resource class while retaining inline bridge and embedded assets", () => {
		expect(INSTALLED_PACK_CSP).to.contain("default-src 'none'")
		expect(INSTALLED_PACK_CSP).to.contain("script-src 'unsafe-inline'")
		expect(INSTALLED_PACK_CSP).to.contain("style-src 'unsafe-inline'")
		expect(INSTALLED_PACK_CSP).to.contain("img-src data: blob:")
		expect(INSTALLED_PACK_CSP).to.contain("font-src data:")
		expect(INSTALLED_PACK_CSP).to.contain("media-src data: blob:")
		for (const directive of [
			"connect-src 'none'",
			"frame-src 'none'",
			"worker-src 'none'",
			"object-src 'none'",
			"form-action 'none'",
			"base-uri 'none'",
		]) {
			expect(INSTALLED_PACK_CSP).to.contain(directive)
		}
		expect(INSTALLED_PACK_CSP).not.to.match(/https?:/)
	})

	it("places the host policy before authored scripts and removes authored CSP", () => {
		const html =
			'<html><head><meta http-equiv="content-security-policy" content="default-src *"><script src="https://evil.invalid/x.js"></script></head><body></body></html>'
		const secured = applyInstalledPackCsp(html)
		expect(secured.match(/content-security-policy/gi)).to.have.length(1)
		expect(secured.indexOf(INSTALLED_PACK_CSP)).to.be.lessThan(secured.indexOf("<script"))
		expect(secured).not.to.contain("default-src *")
	})

	it("creates a head when generated HTML omitted one", () => {
		const secured = applyInstalledPackCsp("<html><body>module</body></html>")
		expect(secured).to.contain(`<head><meta http-equiv="Content-Security-Policy" content="${INSTALLED_PACK_CSP}"></head>`)
	})

	it("allows only the verified packaged-resource origin and installs its base URI", () => {
		const dirUri = "https://file+.vscode-resource.vscode-cdn.net/verified/modules/one"
		const csp = buildInstalledPackCsp(dirUri)
		expect(csp).to.contain("script-src 'unsafe-inline'")
		expect(csp).to.contain("img-src data: blob: https://file+.vscode-resource.vscode-cdn.net")
		expect(csp).to.contain("connect-src 'none'")
		expect(csp).not.to.contain("evil.invalid")
		const secured = applyInstalledPackCsp("<html><head><base href=\"https://evil.invalid/\"></head></html>", dirUri)
		expect(secured).to.contain(`<base href="${dirUri}/">`)
		expect(secured).not.to.contain("evil.invalid")
	})
})
