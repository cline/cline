import { randomBytes } from "node:crypto"
import * as http from "node:http"
import * as https from "node:https"

type RegisteredTileLayer = {
	template: string
	createdAt: number
}

const LOCALHOST = "127.0.0.1"

// GEE tile templates come from `ee.Image.getMapId()["tile_fetcher"].url_format`
// (aihydro-tools/ai_hydro/gee/map_layers.py), which always resolves to this
// host. Rejecting anything else keeps this local proxy from being usable as a
// general-purpose fetch relay if a future caller ever passes an untrusted
// template.
const ALLOWED_TILE_HOST = "earthengine.googleapis.com"

// VS Code webviews run under one of these origin schemes depending on host
// (desktop Electron vs. vscode.dev-style sandboxed iframe). We reflect the
// request's Origin header back only when it matches one of these — never a
// bare `*` — so the proxy isn't a token-gated-but-otherwise-open CORS relay
// any arbitrary web origin could read from once it learned the port+token.
const ALLOWED_ORIGIN_PATTERN = /^(vscode-webview:\/\/[a-z0-9-]+|https:\/\/[a-z0-9-]+\.vscode-webview\.net)$/i

function isAllowedTileTemplate(template: string): boolean {
	try {
		const url = new URL(template.replace("{z}", "0").replace("{x}", "0").replace("{y}", "0"))
		return url.protocol === "https:" && url.hostname === ALLOWED_TILE_HOST
	} catch {
		return false
	}
}

export class GeeTileProxyService {
	private static server: http.Server | undefined
	private static port: number | undefined
	private static readonly token = randomBytes(24).toString("hex")
	private static readonly layers = new Map<string, RegisteredTileLayer>()

	static async proxify(template: string, layerId?: string): Promise<string> {
		if (!isAllowedTileTemplate(template)) {
			throw new Error(`GEE tile proxy refused non-Earth-Engine template host: ${template}`)
		}
		await GeeTileProxyService.ensureServer()
		const id = layerId || randomBytes(8).toString("hex")
		GeeTileProxyService.layers.set(id, { template, createdAt: Date.now() })
		return `http://${LOCALHOST}:${GeeTileProxyService.port}/gee-tile/${encodeURIComponent(id)}/{z}/{x}/{y}?token=${GeeTileProxyService.token}`
	}

	static dispose(): void {
		GeeTileProxyService.server?.close()
		GeeTileProxyService.server = undefined
		GeeTileProxyService.port = undefined
		GeeTileProxyService.layers.clear()
	}

	private static async ensureServer(): Promise<void> {
		if (GeeTileProxyService.server && GeeTileProxyService.port) {
			return
		}

		GeeTileProxyService.server = http.createServer((req, res) => {
			void GeeTileProxyService.handleRequest(req, res)
		})

		await new Promise<void>((resolve, reject) => {
			GeeTileProxyService.server!.once("error", reject)
			GeeTileProxyService.server!.listen(0, LOCALHOST, () => {
				const address = GeeTileProxyService.server!.address()
				if (!address || typeof address === "string") {
					reject(new Error("GEE tile proxy did not bind to a TCP port"))
					return
				}
				GeeTileProxyService.port = address.port
				GeeTileProxyService.server!.off("error", reject)
				resolve()
			})
		})
	}

	private static async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		// Reflect the caller's Origin only if it looks like a VS Code webview
		// (desktop `vscode-webview://` or sandboxed `*.vscode-webview.net`).
		// Never a bare `*` — this is a token-gated proxy, not a public CORS relay,
		// and a wildcard would let any web origin that learns the port+token
		// read tile bytes through it.
		const requestOrigin = req.headers.origin
		const allowedOrigin = requestOrigin && ALLOWED_ORIGIN_PATTERN.test(requestOrigin) ? requestOrigin : undefined
		if (allowedOrigin) {
			res.setHeader("Access-Control-Allow-Origin", allowedOrigin)
			res.setHeader("Vary", "Origin")
		}
		res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS")
		res.setHeader("Access-Control-Allow-Headers", "Content-Type")

		if (req.method === "OPTIONS") {
			res.writeHead(204)
			res.end()
			return
		}

		if (req.method !== "GET" || !req.url) {
			GeeTileProxyService.writeError(res, 405, "Method not allowed")
			return
		}

		const url = new URL(req.url, `http://${LOCALHOST}`)
		if (url.searchParams.get("token") !== GeeTileProxyService.token) {
			GeeTileProxyService.writeError(res, 403, "Forbidden")
			return
		}

		const match = /^\/gee-tile\/([^/]+)\/(\d+)\/(\d+)\/(\d+)$/.exec(url.pathname)
		if (!match) {
			GeeTileProxyService.writeError(res, 404, "Unknown tile path")
			return
		}

		const [, encodedLayerId, z, x, y] = match
		const layer = GeeTileProxyService.layers.get(decodeURIComponent(encodedLayerId))
		if (!layer) {
			GeeTileProxyService.writeError(res, 404, "Unknown GEE layer")
			return
		}

		const remoteUrl = layer.template.replace("{z}", z).replace("{x}", x).replace("{y}", y)
		if (!isAllowedTileTemplate(remoteUrl)) {
			// Defence-in-depth: proxify() already rejects non-Earth-Engine
			// templates at registration time, so this should be unreachable —
			// but a registered layer's template is never re-validated per
			// request, so check again before making an outbound fetch.
			GeeTileProxyService.writeError(res, 502, "Refused non-Earth-Engine tile host")
			return
		}
		GeeTileProxyService.pipeRemoteTile(remoteUrl, res, allowedOrigin)
	}

	private static pipeRemoteTile(remoteUrl: string, res: http.ServerResponse, allowedOrigin: string | undefined): void {
		https
			.get(remoteUrl, (remoteRes) => {
				if (!remoteRes.statusCode || remoteRes.statusCode < 200 || remoteRes.statusCode >= 300) {
					GeeTileProxyService.writeError(
						res,
						remoteRes.statusCode || 502,
						`GEE tile fetch failed: ${remoteRes.statusCode}`,
					)
					remoteRes.resume()
					return
				}

				res.writeHead(200, {
					"Cache-Control": remoteRes.headers["cache-control"] || "private, max-age=3600",
					"Content-Type": remoteRes.headers["content-type"] || "image/png",
					...(allowedOrigin ? { "Access-Control-Allow-Origin": allowedOrigin } : {}),
				})
				remoteRes.pipe(res)
			})
			.on("error", (err) => {
				GeeTileProxyService.writeError(res, 502, `GEE tile proxy error: ${err.message}`)
			})
	}

	private static writeError(res: http.ServerResponse, status: number, message: string): void {
		if (res.headersSent) {
			res.end()
			return
		}
		// No Access-Control-Allow-Origin here: handleRequest() already set it
		// via res.setHeader() (reflected origin or omitted), which Node merges
		// into this writeHead() call. Hardcoding "*" here would override that.
		res.writeHead(status, {
			"Content-Type": "application/json",
		})
		res.end(JSON.stringify({ ok: false, message }))
	}
}
