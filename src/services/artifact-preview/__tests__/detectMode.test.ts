import { expect } from "chai"
import { describe, it } from "mocha"
import { detectMode } from "../detectMode"

describe("detectMode", () => {
	it("returns safe for empty input", () => {
		expect(detectMode("")).to.equal("safe")
	})

	it("returns safe for inert HTML with no scripts and no fingerprints", () => {
		expect(detectMode("<html><body><h1>Hello</h1><p>World</p></body></html>")).to.equal("safe")
	})

	it("returns interactive when a <script> tag is present", () => {
		expect(detectMode('<html><body><script src="x.js"></script></body></html>')).to.equal("interactive")
	})

	it("returns interactive for Plotly fingerprint", () => {
		expect(detectMode("<html><body>Plotly.newPlot('div', [])</body></html>")).to.equal("interactive")
	})

	it("returns interactive for Folium fingerprint", () => {
		expect(detectMode("<html><body><div class='folium-map'></div></body></html>")).to.equal("interactive")
	})

	it("returns interactive for Leaflet fingerprint", () => {
		expect(detectMode("<html><body>L.map('id')</body></html>")).to.equal("interactive")
	})

	it("returns interactive for files larger than 64KB regardless of content", () => {
		const big = "<html><body>" + "x".repeat(70 * 1024) + "</body></html>"
		expect(detectMode(big)).to.equal("interactive")
	})

	it("returns interactive for d3 fingerprint", () => {
		expect(detectMode("<html><body>d3.select('body')</body></html>")).to.equal("interactive")
	})

	it("returns safe for a small CSS-only document", () => {
		expect(detectMode("<style>body{color:red}</style><h1>Hi</h1>")).to.equal("safe")
	})
})
