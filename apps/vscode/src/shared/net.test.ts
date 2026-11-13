import http from "node:http"
import net, { type AddressInfo } from "node:net"
import { Agent, fetch as undiciFetch } from "undici"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { fetchWithoutIdleTimeouts } from "./net"

// A server that answers headers immediately and then stays silent before
// sending the body, like a local model server processing a large prompt.
// undici's idle timers tick at 1s resolution, so the silence has to clear a
// full tick for the control timeout to fire.
const BODY_DELAY_MS = 2_000
const CONTROL_BODY_TIMEOUT_MS = 500

// A corporate-shaped environment: a proxy is configured and nothing is
// excluded from it. The dispatchers under test read this when first built.
const PROXY_ENV_VARS = ["http_proxy", "HTTP_PROXY", "https_proxy", "HTTPS_PROXY", "no_proxy", "NO_PROXY"]

// Unroutable (TEST-NET-1), so a request to it can only succeed via the proxy.
const REMOTE_URL = "http://192.0.2.1:8000/v1/chat/completions"

function listen(server: http.Server): Promise<string> {
	return new Promise((resolve) =>
		server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
	)
}

function close(server: http.Server): Promise<void> {
	return new Promise((resolve) => server.close(() => resolve()))
}

describe("fetchWithoutIdleTimeouts", () => {
	let modelServer: http.Server
	let proxyServer: http.Server
	let url: string
	let proxiedRequests: string[]
	const savedProxyEnv: Record<string, string | undefined> = {}

	beforeAll(async () => {
		modelServer = http.createServer((_req, res) => {
			res.writeHead(200, { "content-type": "text/plain" })
			res.flushHeaders()
			setTimeout(() => res.end("first token"), BODY_DELAY_MS)
		})
		url = `${await listen(modelServer)}/v1/chat/completions`

		// undici tunnels every proxied request with CONNECT. Record the target
		// and tunnel to the model server so the response proves the route.
		proxiedRequests = []
		proxyServer = http.createServer()
		proxyServer.on("connect", (req, clientSocket, head) => {
			proxiedRequests.push(req.url ?? "")
			const upstream = net.connect((modelServer.address() as AddressInfo).port, "127.0.0.1", () => {
				clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
				upstream.write(head)
				upstream.pipe(clientSocket)
				clientSocket.pipe(upstream)
			})
		})
		const proxyUrl = await listen(proxyServer)

		for (const name of PROXY_ENV_VARS) {
			savedProxyEnv[name] = process.env[name]
			delete process.env[name]
		}
		process.env.HTTP_PROXY = proxyUrl
	})

	afterAll(async () => {
		await close(modelServer)
		await close(proxyServer)
		for (const name of PROXY_ENV_VARS) {
			if (savedProxyEnv[name] === undefined) {
				delete process.env[name]
			} else {
				process.env[name] = savedProxyEnv[name]
			}
		}
	})

	it("waits through a silent body where undici's idle timeout would abort", async () => {
		// Control: the same request through a dispatcher with a short idle
		// timeout dies, proving the server really is silent long enough.
		const impatient = new Agent({ bodyTimeout: CONTROL_BODY_TIMEOUT_MS })
		await expect(undiciFetch(url, { dispatcher: impatient }).then((r) => r.text())).rejects.toThrow()
		await impatient.close()

		const response = await fetchWithoutIdleTimeouts(url)
		expect(await response.text()).toBe("first token")
	})

	it("still honours the caller's AbortSignal while the body is silent", async () => {
		const controller = new AbortController()
		const response = await fetchWithoutIdleTimeouts(url, { signal: controller.signal })
		setTimeout(() => controller.abort(), 20)
		await expect(response.text()).rejects.toThrow()
	})

	it("connects to loopback directly even when HTTP_PROXY is set and NO_PROXY is not", async () => {
		const response = await fetchWithoutIdleTimeouts(url)
		expect(await response.text()).toBe("first token")
		expect(proxiedRequests).toEqual([])
	})

	it("treats IPv4-mapped loopback as loopback", async () => {
		const mapped = url.replace("127.0.0.1", "[::ffff:127.0.0.1]")
		const response = await fetchWithoutIdleTimeouts(mapped)
		expect(await response.text()).toBe("first token")
		expect(proxiedRequests).toEqual([])
	})

	it("routes other hosts through the configured proxy, still without idle timeouts", async () => {
		const response = await fetchWithoutIdleTimeouts(REMOTE_URL)
		expect(await response.text()).toBe("first token")
		expect(proxiedRequests).toEqual([new URL(REMOTE_URL).host])
	})
})
