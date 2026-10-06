// Replaces Bun's hidden fetch timeout with an explicit response watchdog.
//
// Bun's native `fetch` aborts a request that has not received a byte within
// ~300 s (`DOMException` named `TimeoutError`, "The operation timed out.")
// regardless of any caller `AbortSignal`. Reasoning models behind queued or
// slow-TTFT endpoints routinely exceed that before their first chunk, and
// every such request killed the run with no retry — the dominant failure in
// the SFData benchmark traces (10 of 25 runs). Node's undici has the same
// 300 s `headersTimeout`, but its error is already classified as transient
// and retried; Bun's was not, and the limit itself is too tight.
//
// The wrapper passes Bun's nonstandard `timeout: false` (ignored by other
// runtimes) and arms its own timer for the response headers only, so a dead
// connection still fails — later, and with the same `TimeoutError` shape the
// retry middleware now recognizes — while an SSE body that is flowing is never
// cut off. The caller's own signal still aborts the request at any time.

/**
 * How long a provider request may wait for its response headers. Generous on
 * purpose: this is the backstop for a connection that will never answer, not
 * a latency budget. The pre-content retry middleware re-issues a request that
 * hits it.
 */
export const PROVIDER_RESPONSE_TIMEOUT_MS = 10 * 60_000;

type FetchWithOptionalPreconnect = typeof fetch & {
	preconnect?: (...args: unknown[]) => unknown;
};

/** `RequestInit` plus Bun's nonstandard per-request timeout switch. */
type RequestInitWithBunTimeout = RequestInit & { timeout?: false };

function timeoutError(): DOMException {
	return new DOMException("The operation timed out.", "TimeoutError");
}

/**
 * Wrap `baseFetch` (or the global fetch) so provider requests are not subject
 * to Bun's default idle timeout and instead fail with a `TimeoutError` only
 * when no response headers arrive within `timeoutMs`.
 */
export function wrapFetchWithResponseTimeout(
	baseFetch: typeof fetch | undefined,
	timeoutMs: number = PROVIDER_RESPONSE_TIMEOUT_MS,
): typeof fetch | undefined {
	const delegate = baseFetch ?? globalThis.fetch;
	if (!delegate) {
		return baseFetch;
	}
	const timeoutFetch = (async (input, init) => {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(timeoutError()), timeoutMs);
		const signal = init?.signal
			? AbortSignal.any([init.signal, controller.signal])
			: controller.signal;
		const requestInit: RequestInitWithBunTimeout = {
			...init,
			signal,
			timeout: false,
		};
		try {
			return await delegate(input, requestInit);
		} finally {
			clearTimeout(timer);
		}
	}) as typeof fetch;
	const delegateWithPreconnect = delegate as FetchWithOptionalPreconnect;
	if (typeof delegateWithPreconnect.preconnect === "function") {
		(timeoutFetch as FetchWithOptionalPreconnect).preconnect =
			delegateWithPreconnect.preconnect.bind(delegate);
	}
	return timeoutFetch;
}
