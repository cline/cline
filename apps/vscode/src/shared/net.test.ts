import http from "node:http"
import type { AddressInfo } from "node:net"
import { Agent, fetch as undiciFetch } from "undici"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { fetchWithoutIdleTimeouts } from "./net"

// A server that answers headers immediately and then stays silent before
// sending the body, like a local model server processing a large prompt.
// undici's idle timers tick at 1s resolution, so the silence has to clear a
// full tick for the control timeout to fire.
const BODY_DELAY_MS = 2_000
const CONTROL_BODY_TIMEOUT_MS = 500

// The dispatcher under test reads the proxy environment when it is first
// built, so a machine-level http_proxy would route these requests away from
// the local server.
const PROXY_ENV_VARS = ["http_proxy", "HTTP_PROXY", "https_proxy", "HTTPS_PROXY", "no_proxy", "NO_PROXY"]

describe("fetchWithoutIdleTimeouts", () => {
	let server: http.Server
	let url: string
	const savedProxyEnv: Record<string, string | undefined> = {}

	beforeAll(async () => {
		for (const name of PROXY_ENV_VARS) {
			savedProxyEnv[name] = process.env[name]
			delete process.env[name]
		}
		server = http.createServer((_req, res) => {
			res.writeHead(200, { "content-type": "text/plain" })
			res.flushHeaders()
			setTimeout(() => res.end("first token"), BODY_DELAY_MS)
		})
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
		url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/chat/completions`
	})

	afterAll(async () => {
		await new Promise<void>((resolve) => server.close(() => resolve()))
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
})
