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
 * The CLI's npm wrapper (bin/cline) does the same automatically: it harvests
 * the OS trust store and points the child's NODE_EXTRA_CA_CERTS at a managed
 * bundle, because the Bun runtime does not read the OS store on its own. A
 * user-set NODE_EXTRA_CA_CERTS is merged in rather than replaced.
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
 * 3. View logs: check for network-related failures in ~/.cline/data/logs/cline.log
 *    (CLI, override with CLINE_LOG_PATH). If the hub is involved, also check
 *    ~/.cline/data/logs/hub-daemon.log. In JetBrains, check
 *    ~/.cline/cline-core-service.log, which every open project's core writes to.
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

import { BlockList, isIP } from "node:net"
import { Agent, type Dispatcher, EnvHttpProxyAgent, setGlobalDispatcher, fetch as undiciFetch } from "undici"

type FetchFunction = (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>

let mockFetch: FetchFunction | undefined

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

	return ((input: string | URL | Request, init?: RequestInit): Promise<Response> =>
		(mockFetch || baseFetch)(input, init)) as typeof globalThis.fetch
})()

const NO_IDLE_TIMEOUTS = { headersTimeout: 0, bodyTimeout: 0 }
let directDispatcher: Agent | undefined
let proxiedDispatcher: EnvHttpProxyAgent | undefined

// The same hosts VS Code's proxy resolver always connects to directly.
// `EnvHttpProxyAgent` would otherwise send them through `http_proxy` whenever
// `no_proxy` is unset, which is exactly the shape of a corporate environment.
// BlockList matches IPv4-mapped IPv6 (`[::ffff:127.0.0.1]`, which the URL
// parser rewrites to `[::ffff:7f00:1]`) against the IPv4 rules.
const LOOPBACK_ADDRESSES = new BlockList()
LOOPBACK_ADDRESSES.addSubnet("127.0.0.0", 8, "ipv4")
LOOPBACK_ADDRESSES.addAddress("0.0.0.0", "ipv4")
LOOPBACK_ADDRESSES.addAddress("::1", "ipv6")

function isLoopbackHost(input: string | URL | Request): boolean {
	try {
		const host = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).hostname
			.replace(/^\[|\]$/g, "")
			.toLowerCase()
		if (host === "localhost") {
			return true
		}
		const family = isIP(host)
		return family !== 0 && LOOPBACK_ADDRESSES.check(host, family === 6 ? "ipv6" : "ipv4")
	} catch {
		return false
	}
}

/**
 * Fetch for providers that may point at a local model server, with undici's
 * idle timeouts disabled.
 *
 * undici aborts a response after `headersTimeout` / `bodyTimeout` (300s
 * each) of silence on the wire. A local model processing a large prompt
 * sends its headers at once and then nothing until the first token, often
 * for longer than that, so the request dies with `UND_ERR_BODY_TIMEOUT`
 * while the server is still generating (cline/cline#13371, #13464).
 * Cancellation stays with the request's AbortSignal, i.e. the stop button.
 *
 * This goes through undici's own fetch rather than global fetch: the VS Code
 * extension host wraps global fetch and swaps any caller-supplied dispatcher
 * for its own default-timeout Agent, so the override would be dropped. The
 * trade-off is that these requests honour `http_proxy` / `https_proxy` /
 * `no_proxy` rather than VS Code's `http.proxy` setting, except that loopback
 * always goes direct, as it does in VS Code. On the standalone build the
 * proxy agent is the same one installed globally above.
 */
export const fetchWithoutIdleTimeouts: typeof globalThis.fetch = ((
	input: string | URL | Request,
	init?: RequestInit,
): Promise<Response> => {
	if (mockFetch) {
		return mockFetch(input, init)
	}
	let dispatcher: Dispatcher
	if (isLoopbackHost(input)) {
		dispatcher = directDispatcher ??= new Agent(NO_IDLE_TIMEOUTS)
	} else {
		dispatcher = proxiedDispatcher ??= new EnvHttpProxyAgent(NO_IDLE_TIMEOUTS)
	}
	return undiciFetch(
		input as Parameters<typeof undiciFetch>[0],
		{ ...init, dispatcher } as Parameters<typeof undiciFetch>[1],
	) as unknown as Promise<Response>
}) as typeof globalThis.fetch

/**
 * Mocks `fetch` for testing and calls `callback`. Then restores `fetch`. If the
 * specified callback returns a Promise, the fetch is restored when that Promise
 * is settled.
 * @param theFetch the replacement function to call to implement `fetch`.
 * @param callback `fetch` will be mocked for the duration of `callback()`.
 * @returns the result of `callback()`.
 */
export function mockFetchForTesting<T>(theFetch: FetchFunction, callback: () => T): T {
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
		}
		return result
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
export function getAxiosSettings(): {
	adapter?: any
	fetch?: typeof globalThis.fetch
	maxBodyLength?: number
	maxContentLength?: number
} {
	return {
		adapter: "fetch" as any,
		fetch, // Use our configured fetch
		maxBodyLength: Number.POSITIVE_INFINITY,
		maxContentLength: Number.POSITIVE_INFINITY,
	}
}
