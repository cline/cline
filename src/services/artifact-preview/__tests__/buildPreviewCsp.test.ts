import { expect } from "chai"
import { describe, it } from "mocha"
import { buildPreviewCsp } from "../buildPreviewCsp"

describe("buildPreviewCsp", () => {
	const cspSource = "vscode-webview://abc"
	const nonce = "n0nc3"

	it("omits the nonce from script-src when scripts are enabled (so 'unsafe-inline' actually applies)", () => {
		// Listing a nonce in script-src causes browsers to ignore
		// 'unsafe-inline'. Folium/Plotly inline scripts have no nonce
		// attribute, so we MUST keep the nonce out of this directive when
		// the iframe needs to run them.
		const csp = buildPreviewCsp({ cspSource, nonce, allowScripts: true })
		const scriptMatch = csp.match(/script-src ([^;]*);/)
		expect(scriptMatch).to.not.be.null
		expect(scriptMatch?.[1]).to.not.contain(`'nonce-${nonce}'`)
		expect(scriptMatch?.[1]).to.contain("'unsafe-inline'")
	})

	it("allows common visualization CDNs in script-src when scripts are enabled", () => {
		const csp = buildPreviewCsp({ cspSource, nonce, allowScripts: true })
		expect(csp).to.contain("https://cdn.plot.ly")
		expect(csp).to.contain("https://cdn.jsdelivr.net")
		expect(csp).to.contain("https://unpkg.com")
	})

	it("locks script-src down to the shell nonce + own origin when scripts are disabled", () => {
		const csp = buildPreviewCsp({ cspSource, nonce, allowScripts: false })
		// No CDNs, no inline — only the shell nonce and its own origin.
		const scriptMatch = csp.match(/script-src ([^;]*);/)
		expect(scriptMatch).to.not.be.null
		expect(scriptMatch?.[1]).to.contain(`'nonce-${nonce}'`)
		expect(scriptMatch?.[1]).to.not.contain("'unsafe-inline'")
	})

	it("includes frame-src for the webview's own resource origin", () => {
		const csp = buildPreviewCsp({ cspSource, nonce, allowScripts: true })
		expect(csp).to.contain(cspSource)
		expect(csp).to.match(/frame-src[^;]*'self'/)
	})

	it("allows the VS Code resource subdomain so src=webviewUri fallback works", () => {
		const csp = buildPreviewCsp({ cspSource, nonce, allowScripts: true })
		expect(csp).to.match(/frame-src[^;]*https:\/\/\*\.vscode-cdn\.net/)
	})

	it("allows OpenStreetMap and CartoDB tile origins in img-src", () => {
		const csp = buildPreviewCsp({ cspSource, nonce, allowScripts: true })
		expect(csp).to.contain("https://*.tile.openstreetmap.org")
		expect(csp).to.contain("https://*.basemaps.cartocdn.com")
	})

	it("declares default-src 'none' so nothing is allowed by accident", () => {
		const csp = buildPreviewCsp({ cspSource, nonce, allowScripts: true })
		expect(csp).to.match(/default-src 'none'/)
	})

	it("scopes connect-src to known CDN/tile origins instead of blanket https: (E-3)", () => {
		const csp = buildPreviewCsp({ cspSource, nonce, allowScripts: true })
		const connectMatch = csp.match(/connect-src ([^;]*);/)
		expect(connectMatch).to.not.be.null
		const directive = connectMatch?.[1] ?? ""
		// Must not contain a bare "https:" token (that would re-open fetch to
		// any HTTPS host — the exfiltration channel this change closes).
		expect(directive.split(/\s+/)).to.not.include("https:")
		expect(directive).to.contain("https://cdn.jsdelivr.net")
		expect(directive).to.contain("https://*.tile.openstreetmap.org")
		expect(directive).to.contain(cspSource)
	})
})
