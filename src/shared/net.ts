/**
 * # Network Support for Cline
 *
 * ## Development Guidelines
 *
 * **Do** use `import { fetch } from '@/shared/net'` instead of global `fetch`.
 *
 * Global `fetch` will appear to work in VSCode, but proxy support will be
 * broken in JetBrains or CLI.
 *
 * If you use Axios, **do** call `getAxiosSettings()` and spread into
 * your Axios configuration:
 *
 * ```typescript
 * import { getAxiosSettings } from '@/shared/net'
 * await axios.get(url, {
 *   headers: { 'X-FOO': 'BAR' },
 *   ...getAxiosSettings()
 * })
 * ```
 *
 * **Do** remember to pass our `fetch` into your API clients:
 *
 * ```typescript
 * import OpenAI from "openai"
 * import { fetch } from "@/shared/net"
 * this.client = new OpenAI({
 *   apiKey: '...',
 *   fetch, // Use configured fetch with proxy support
 * })
 * ```
 *
 * If you neglect this step, inference won't work in JetBrains and CLI
 * through proxies.
 *
 * ## Proxy Support
 *
 * Cline uses platform-specific fetch implementations to handle proxy
 * configuration:
 * - **VSCode**: Uses global fetch (VSCode provides proxy configuration)
 * - **JetBrains, CLI**: Uses undici fetch with explicit ProxyAgent
 *
 * Proxy configuration via standard environment variables:
 * - `http_proxy` / `HTTP_PROXY` - Proxy for HTTP requests
 * - `https_proxy` / `HTTPS_PROXY` - Proxy for HTTPS requests
 * - `no_proxy` / `NO_PROXY` - Comma-separated list of hosts to bypass proxy
 *
 * Note, `http_proxy` etc. MUST specify the protocol to use for the proxy,
 * for example, `https_proxy=http://proxy.corp.example:3128`. Simply specifying
 * the proxy hostname will result in errors.
 *
 * ## Certificate Trust
 *
 * Proxies often machine-in-the-middle HTTPS connections. To make this work,
 * they generate self-signed certificates for a host, and the client is
 * configured to trust the proxy as a certificate authority.
 *
 * VSCode transparently pulls trusted certificates from the operating system
 * and configures node trust.
 *
 * JetBrains exports trusted certificates from the OS and writes them to a
 * temporary file, then configures node TLS by setting NODE_EXTRA_CA_CERTS.
 *
 * CLI users should set the NODE_EXTRA_CA_CERTS environment variable if
 * necessary, because node does not automatically use the OS' trusted certs.
 *
 * ## Limitations in JetBrains & CLI
 *
 * - Proxy settings are static at startup--restart required for changes
 * - SOCKS proxies, PAC files not supported
 * - Proxy authentication via env vars only
 *
 * These are not fundamental limitations, they just need integration work.
 *
 * ## Troubleshooting
 *
 * 1. Verify proxy env vars: `echo $http_proxy $https_proxy`
 * 2. Check certificates: `echo $NODE_EXTRA_CA_CERTS` (should point to PEM file)
 * 3. View logs: Check ~/.cline/cline-core-service.log for network-related
 *    failures.
 * 4. Test connection: Use `curl -x host:port` etc. to isolate proxy
 *    configuration versus client issues.
 *
 * @example
 * ```typescript
 * // Good - uses configured fetch
 * import { fetch } from '@/shared/net'
 * const response = await fetch(url)
 *
 * // Good - configures axios to use configured fetch
 * import { getAxiosSettings } from '@/shared/net'
 * await axios.get(url, { ...getAxiosSettings() })
 * ```
 */

import { EnvHttpProxyAgent, setGlobalDispatcher, fetch as undiciFetch } from "undici"
import { Logger } from "@/services/logging/Logger"

let mockFetch: typeof globalThis.fetch | undefined

/**
 * Platform-configured fetch that respects proxy settings.
 * Use this instead of global fetch to ensure proper proxy configuration.
 *
 * @example
 * ```typescript
 * import { fetch } from '@/shared/net'
 * const response = await fetch('https://api.example.com')
 * ```
 */
export const fetch: typeof globalThis.fetch = (() => {
	// Note: Don't use Logger here; it may not be initialized.

	let baseFetch: typeof globalThis.fetch = globalThis.fetch
	// Note: See esbuild.mjs, process.env.IS_STANDALONE is statically rewritten
	// to "true" or "false" (as strings) in the JetBrains/CLI build.
	// We must use explicit string comparison because "false" is truthy in JS.
	if (process.env.IS_STANDALONE === "true") {
		// Configure undici with ProxyAgent
		const agent = new EnvHttpProxyAgent({})
		setGlobalDispatcher(agent)
		baseFetch = undiciFetch as any as typeof globalThis.fetch
	}

	return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
		const method = init?.method || (input instanceof Request ? input.method : "GET")

		// Log request details
		console.log(`[Cline Network Request] ${method} ${url}`)
		console.log(init?.body)
		if (init?.headers) {
			console.log(
				"[Cline Network Request Headers]:",
				JSON.stringify(Object.fromEntries(Object.entries(init.headers).map(([k, v]) => [k, String(v)])), null, 2),
			)
		}
		if (init?.body && typeof init.body === "string") {
			try {
				// Try to parse as JSON for pretty printing
				console.log(init.body)
				Logger.debug("body: " + init?.body)
				const parsed = JSON.parse(init.body)
				console.log("[Cline Network Request Body]:", JSON.stringify(parsed, null, 2))
			} catch {
				// If not JSON, log as string
				console.log("[Cline Network Request Body]:", init.body)
			}
		} else if (init?.body) {
			console.log("[Cline Network Request Body]:", "[Binary data or FormData]")
		}

		const startTime = Date.now()
		const response = await (mockFetch || baseFetch)(input, init)
		const duration = Date.now() - startTime

		// Clone the response to read its body without consuming it
		const clonedResponse = response.clone()

		// Log response details
		console.log(`[Cline Network Response] ${response.status} ${response.statusText} (${duration}ms)`)

		// Log response headers
		const responseHeaders: Record<string, string> = {}
		clonedResponse.headers.forEach((value, key) => {
			responseHeaders[key] = value
		})
		console.log("[Cline Network Response Headers]:", JSON.stringify(responseHeaders, null, 2))

		// Try to log response body for JSON responses
		try {
			const contentType = clonedResponse.headers.get("content-type")
			if (contentType?.includes("application/json")) {
				const responseText = await clonedResponse.text()
				try {
					const parsed = JSON.parse(responseText)
					console.log("[Cline Network Response Body]:", JSON.stringify(parsed, null, 2))
				} catch {
					console.log("[Cline Network Response Body]:", responseText)
				}
			} else {
				console.log("[Cline Network Response Body]:", "[Non-JSON content or streaming response]")
			}
		} catch (error) {
			console.log("[Cline Network Response Body]:", "[Error reading response body]", error)
		}

		return response
	}
})()

/**
 * Mocks `fetch` for testing and calls `callback`. Then restores `fetch`. If the
 * specified callback returns a Promise, the fetch is restored when that Promise
 * is settled.
 * @param theFetch the replacement function to call to implement `fetch`.
 * @param callback `fetch` will be mocked for the duration of `callback()`.
 * @returns the result of `callback()`.
 */
export function mockFetchForTesting<T>(theFetch: typeof globalThis.fetch, callback: () => T): T {
	const originalMockFetch = mockFetch
	mockFetch = theFetch
	let willResetSync = true
	try {
		const result = callback()
		if (result instanceof Promise) {
			willResetSync = false
			return result.finally(() => {
				mockFetch = originalMockFetch
			}) as typeof result
		} else {
			return result
		}
	} finally {
		if (willResetSync) {
			mockFetch = originalMockFetch
		}
	}
}

/**
 * Returns axios configuration for fetch adapter mode with our configured fetch.
 * This ensures axios uses our platform-specific fetch implementation with
 * proper proxy configuration.
 *
 * @returns Configuration object with fetch adapter and configured fetch
 *
 * @example
 * ```typescript
 * const response = await axios.get(url, {
 *   headers: { Authorization: 'Bearer token' },
 *   timeout: 5000,
 *   ...getAxiosSettings()
 * })
 * ```
 */
export function getAxiosSettings(): { adapter?: any; fetch?: typeof globalThis.fetch } {
	return {
		adapter: "fetch" as any,
		fetch, // Use our configured fetch
	}
}
