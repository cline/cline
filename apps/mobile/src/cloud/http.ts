/**
 * Small `fetch` helpers shared by the cloud auth and REST layers.
 *
 * Everything here is pure `fetch` so it is React Native-safe: no `node:*`, no
 * `@cline/core` server code. `fetch` is injectable throughout (the `FetchLike`
 * seam) so tests drive the whole stack with a fake and never touch the network.
 */

/** The subset of the global `fetch` signature the cloud layer relies on. */
export type FetchLike = (
	input: string,
	init?: RequestInit,
) => Promise<Response>;

/**
 * A request timeout signal that tolerates older React Native engines.
 *
 * `AbortSignal.timeout` is missing on some Hermes builds, so
 * feature-detect it and fall back to a manual {@link AbortController}. Returns
 * `undefined` when neither is available, which `fetch` accepts as "no timeout".
 */
export function timeoutSignal(ms: number): AbortSignal | undefined {
	const withTimeout = AbortSignal as {
		timeout?: (delay: number) => AbortSignal;
	};
	if (typeof withTimeout.timeout === "function") {
		return withTimeout.timeout(ms);
	}
	if (typeof AbortController === "undefined") {
		return undefined;
	}
	const controller = new AbortController();
	setTimeout(() => {
		controller.abort();
	}, ms);
	return controller.signal;
}

/** Resolves the effective `fetch`, preferring an injected impl for tests. */
export function resolveFetch(fetchImpl?: FetchLike): FetchLike {
	if (fetchImpl) {
		return fetchImpl;
	}
	if (typeof fetch === "function") {
		return fetch as unknown as FetchLike;
	}
	throw new Error("No fetch implementation available.");
}

/** Best-effort JSON parse of a response body; `{}` on any failure. */
export async function readJson(response: Response): Promise<unknown> {
	try {
		return await response.json();
	} catch {
		return {};
	}
}
