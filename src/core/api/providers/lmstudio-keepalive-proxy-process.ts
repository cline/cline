import http, { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "http"
import https from "https"

const proxyPort = Number.parseInt(process.env.LMSTUDIO_PROXY_PORT || "", 10) || 1234
const targetPort = Number.parseInt(process.env.LMSTUDIO_TARGET_PORT || "", 10) || proxyPort + 1
const targetHost = process.env.LMSTUDIO_TARGET_HOST || "127.0.0.1"
const targetProtocol = process.env.LMSTUDIO_TARGET_PROTOCOL === "https" ? "https" : "http"
const heartbeatIntervalMs = Number.parseInt(process.env.LMSTUDIO_HEARTBEAT_MS || "", 10) || 25_000

function isSse(headers: IncomingHttpHeaders): boolean {
	const contentType = headers["content-type"] || headers["Content-Type"]
	if (!contentType) {
		return false
	}

	if (Array.isArray(contentType)) {
		return contentType.some((value) => value.toLowerCase().includes("text/event-stream"))
	}

	return String(contentType).toLowerCase().includes("text/event-stream")
}

function cloneHeaders(headers: IncomingHttpHeaders): Record<string, string | string[]> {
	const cloned: Record<string, string | string[]> = {}
	for (const [key, value] of Object.entries(headers)) {
		if (typeof value === "undefined") {
			continue
		}
		cloned[key] = Array.isArray(value) ? [...value] : value
	}
	return cloned
}

function removeContentLength(headers: Record<string, string | string[]>): void {
	delete headers["content-length"]
	delete headers["Content-Length"]
}

function createUpstreamRequest(req: IncomingMessage) {
	const headers = {
		...req.headers,
		host: targetHost,
	}

	const requestOptions = {
		hostname: targetHost,
		port: targetPort,
		method: req.method,
		path: req.url,
		headers,
	}

	return targetProtocol === "https" ? https.request(requestOptions) : http.request(requestOptions)
}

function handleProxyRequest(clientReq: IncomingMessage, clientRes: ServerResponse): void {
	const upstreamReq = createUpstreamRequest(clientReq)

	const cleanup = () => {
		if (!upstreamReq.destroyed) {
			upstreamReq.destroy()
		}
	}

	upstreamReq.on("response", (upstreamRes) => {
		const headers = cloneHeaders(upstreamRes.headers)
		removeContentLength(headers)

		clientRes.writeHead(upstreamRes.statusCode ?? 502, headers)

		let heartbeatTimer: NodeJS.Timeout | null = null
		const shouldHeartbeat = isSse(upstreamRes.headers)

		const stopHeartbeat = () => {
			if (heartbeatTimer) {
				clearInterval(heartbeatTimer)
				heartbeatTimer = null
			}
		}

		if (shouldHeartbeat) {
			// Send an initial heartbeat to establish the stream
			try {
				clientRes.write(":\n\n")
			} catch {
				// Ignore if the client already closed the connection
			}

			heartbeatTimer = setInterval(() => {
				try {
					clientRes.write(":\n\n")
				} catch {
					stopHeartbeat()
				}
			}, heartbeatIntervalMs)
		}

		upstreamRes.on("data", (chunk) => {
			clientRes.write(chunk)
		})

		upstreamRes.on("end", () => {
			stopHeartbeat()
			clientRes.end()
		})

		upstreamRes.on("error", (error) => {
			stopHeartbeat()
			if (!clientRes.headersSent) {
				clientRes.statusCode = 502
			}
			clientRes.end(`Upstream error: ${error instanceof Error ? error.message : String(error)}`)
		})

		clientRes.on("close", stopHeartbeat)
	})

	upstreamReq.on("error", (error) => {
		if (!clientRes.headersSent) {
			clientRes.statusCode = 502
		}
		clientRes.end(`Proxy error: ${error instanceof Error ? error.message : String(error)}`)
	})

	clientReq.on("aborted", cleanup)
	clientRes.on("close", cleanup)

	clientReq.pipe(upstreamReq)
}

const server = http.createServer((req, res) => {
	handleProxyRequest(req, res)
})

server.on("clientError", (err, socket) => {
	console.error("LM Studio keep-alive proxy client error:", err)
	socket.end("HTTP/1.1 400 Bad Request\r\n\r\n")
})

server.on("error", (error: NodeJS.ErrnoException) => {
	process.send?.({
		type: "error",
		code: error.code,
		message: error.message,
	})
	process.exit(1)
})

const listenHost = "127.0.0.1"

server.listen(proxyPort, listenHost, () => {
	console.log(
		`LM Studio keep-alive proxy listening on http://${listenHost}:${proxyPort}, forwarding to ${targetProtocol}://${targetHost}:${targetPort}`,
	)
	process.send?.({
		type: "ready",
		port: proxyPort,
	})
})

const shutdown = () => {
	server.close(() => {
		process.exit(0)
	})
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
