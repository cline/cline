import * as http from "node:http"
import { expect } from "chai"
import { after, describe, it } from "mocha"
import { GeeTileProxyService } from "../GeeTileProxyService"

const EE_TEMPLATE = "https://earthengine.googleapis.com/v1/projects/p/maps/m/tiles/{z}/{x}/{y}"

function get(url: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
	return new Promise((resolve, reject) => {
		http.get(url, { headers }, (res) => {
			res.resume()
			resolve({ status: res.statusCode ?? 0, headers: res.headers })
		}).on("error", reject)
	})
}

// These tests exercise the wrong-token (403) path deliberately: it's the one
// response path that never triggers an outbound fetch to earthengine.googleapis.com,
// so CORS-header behavior can be verified without live network access.
describe("GeeTileProxyService", () => {
	after(() => {
		GeeTileProxyService.dispose()
	})

	it("rejects non-Earth-Engine template hosts at registration time (no network call made)", async () => {
		let threw = false
		try {
			await GeeTileProxyService.proxify("https://evil.example.com/{z}/{x}/{y}")
		} catch {
			threw = true
		}
		expect(threw).to.equal(true)
	})

	it("accepts a real Earth Engine template host at registration time", async () => {
		const proxied = await GeeTileProxyService.proxify(EE_TEMPLATE, "layer-ok")
		expect(proxied).to.include("http://127.0.0.1:")
	})

	it("never reflects a wildcard CORS origin for an unrecognized caller", async () => {
		const proxied = await GeeTileProxyService.proxify(EE_TEMPLATE, "layer1")
		const badTokenUrl = proxied
			.replace(/token=[^&]+/, "token=wrong")
			.replace("{z}", "0")
			.replace("{x}", "0")
			.replace("{y}", "0")
		const res = await get(badTokenUrl, { Origin: "https://evil.example.com" })
		expect(res.status).to.equal(403)
		expect(res.headers["access-control-allow-origin"]).to.equal(undefined)
	})

	it("reflects Origin only when it matches the vscode-webview scheme", async () => {
		const proxied = await GeeTileProxyService.proxify(EE_TEMPLATE, "layer2")
		const badTokenUrl = proxied
			.replace(/token=[^&]+/, "token=wrong")
			.replace("{z}", "0")
			.replace("{x}", "0")
			.replace("{y}", "0")
		const webviewOrigin = "vscode-webview://abc123"
		const res = await get(badTokenUrl, { Origin: webviewOrigin })
		expect(res.status).to.equal(403)
		expect(res.headers["access-control-allow-origin"]).to.equal(webviewOrigin)
	})

	it("rejects requests with a wrong token", async () => {
		const proxied = await GeeTileProxyService.proxify(EE_TEMPLATE, "layer3")
		const badUrl = proxied
			.replace(/token=[^&]+/, "token=wrong")
			.replace("{z}", "0")
			.replace("{x}", "0")
			.replace("{y}", "0")
		const res = await get(badUrl)
		expect(res.status).to.equal(403)
	})
})
