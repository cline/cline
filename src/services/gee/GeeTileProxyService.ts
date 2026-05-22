import { randomBytes } from "node:crypto"
import * as http from "node:http"
import * as https from "node:https"

type RegisteredTileLayer = {
	template: string
	createdAt: number
}

const LOCALHOST = "127.0.0.1"

export class GeeTileProxyService {
	private static server: http.Server | undefined
	private static port: number | undefined
	private static readonly token = randomBytes(24).toString("hex")
	private static readonly layers = new Map<string, RegisteredTileLayer>()

	static async proxify(template: string, layerId?: string): Promise<string> {
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
		res.setHeader("Access-Control-Allow-Origin", "*")
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
		GeeTileProxyService.pipeRemoteTile(remoteUrl, res)
	}

	private static pipeRemoteTile(remoteUrl: string, res: http.ServerResponse): void {
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
					"Access-Control-Allow-Origin": "*",
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
		res.writeHead(status, {
			"Content-Type": "application/json",
			"Access-Control-Allow-Origin": "*",
		})
		res.end(JSON.stringify({ ok: false, message }))
	}
}
