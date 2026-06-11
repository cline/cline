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

import OpenAI, { type ClientOptions as OpenAIClientOptions } from "openai"
import type { WebSocket as UndiciWebSocket } from "undici"
import { buildExternalBasicHeaders } from "@/services/EnvUtils"

/**
 * IMPORTANT: undici must only ever be loaded in standalone (JetBrains/CLI)
 * builds, and only via the lazy `require` calls below--never via a top-level
 * value import.
 *
 * Merely evaluating the undici module registers its Agent at the global
 * symbol `Symbol.for("undici.globalDispatcher.1")`, which is shared with
 * Node's built-in fetch. When the bundled undici version differs from the
 * undici built into the Node runtime (e.g. VS Code's Electron), built-in
 * fetch picks up the foreign Agent and requests can fail with errors like
 * `UND_ERR_INVALID_ARG: invalid content-length header`. This broke the
 * Anthropic provider on VS Code 1.124 / Electron 42 / Node 24.
 * See https://github.com/cline/cline/issues/11407
 */
function requireUndici(): typeof import("undici") {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	return require("undici")
}

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
		// Configure undici with ProxyAgent. undici is loaded lazily so that
		// the VSCode build never evaluates it (see requireUndici above).
		const { EnvHttpProxyAgent, setGlobalDispatcher, fetch: undiciFetch } = requireUndici()
		const agent = new EnvHttpProxyAgent({})
		setGlobalDispatcher(agent)
		baseFetch = undiciFetch as any as typeof globalThis.fetch
	}

	return (input: string | URL | Request, init?: RequestInit): Promise<Response> => (mockFetch || baseFetch)(input, init)
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

/**
 * Creates an OpenAI client with proper proxy support and external headers.
 * Use this instead of creating OpenAI clients directly to ensure consistent
 * configuration across all providers.
 */
export function createOpenAIClient(options: OpenAIClientOptions): OpenAI {
	const externalHeaders = buildExternalBasicHeaders()
	return new OpenAI({
		...options,
		defaultHeaders: {
			...externalHeaders,
			...options.defaultHeaders,
		},
		fetch, // Use configured fetch with proxy support
	})
}

/**
 * WebSocket type used by `createWebSocket`. Node 22+'s global WebSocket is
 * undici's implementation, so undici's type describes both branches below.
 */
export type ClineWebSocket = UndiciWebSocket

/**
 * Creates a WebSocket that supports custom request headers (a non-standard
 * extension provided by undici's WebSocket, which is also Node's built-in
 * WebSocket since Node 22).
 *
 * - **VSCode**: uses `globalThis.WebSocket`, which VS Code's extension host
 *   patches for proxy support. We must not use the bundled undici here (see
 *   requireUndici above).
 * - **JetBrains, CLI**: uses the bundled undici WebSocket so the connection
 *   goes through the EnvHttpProxyAgent global dispatcher configured above.
 */
export function createWebSocket(url: string, headers: Record<string, string>): ClineWebSocket {
	if (process.env.IS_STANDALONE === "true") {
		const { WebSocket: StandaloneWebSocket } = requireUndici()
		return new StandaloneWebSocket(url, { headers })
	}
	// Note: `headers` in the init object is non-standard, but supported by
	// Node's (undici-based) global WebSocket implementation.
	return new (
		globalThis.WebSocket as unknown as new (
			url: string,
			init: { headers: Record<string, string> },
		) => ClineWebSocket
	)(url, { headers })
}
