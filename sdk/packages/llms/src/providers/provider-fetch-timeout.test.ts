import { afterEach, describe, expect, it, vi } from "vitest";
import { isTransientNetworkError } from "./middleware/retry-empty-response";
import {
	PROVIDER_RESPONSE_TIMEOUT_MS,
	wrapFetchWithResponseTimeout,
} from "./provider-fetch-timeout";

type RecordedInit = RequestInit & { timeout?: unknown };

function recordingFetch(respond: (init: RecordedInit) => Promise<Response>): {
	fetch: typeof fetch;
	inits: RecordedInit[];
} {
	const inits: RecordedInit[] = [];
	const fetch = ((_input, init) => {
		inits.push((init ?? {}) as RecordedInit);
		return respond((init ?? {}) as RecordedInit);
	}) as typeof fetch;
	return { fetch, inits };
}

/** Resolves when `signal` aborts, with its reason. */
function rejectOnAbort(signal: AbortSignal | null | undefined): Promise<never> {
	return new Promise((_resolve, reject) => {
		if (!signal) return;
		if (signal.aborted) {
			reject(signal.reason);
			return;
		}
		signal.addEventListener("abort", () => reject(signal.reason), {
			once: true,
		});
	});
}

describe("wrapFetchWithResponseTimeout", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("disables Bun's native timeout and passes the request through", async () => {
		const { fetch, inits } = recordingFetch(async () => new Response("ok"));
		const wrapped = wrapFetchWithResponseTimeout(fetch);

		const response = await wrapped?.("https://api.example.com/v1/chat", {
			method: "POST",
			body: "{}",
		});

		expect(await response?.text()).toBe("ok");
		expect(inits).toHaveLength(1);
		expect(inits[0]).toMatchObject({
			method: "POST",
			body: "{}",
			timeout: false,
		});
		expect(inits[0]?.signal).toBeInstanceOf(AbortSignal);
	});

	it("aborts with a transient TimeoutError when no response arrives in time", async () => {
		vi.useFakeTimers();
		const { fetch } = recordingFetch((init) => rejectOnAbort(init.signal));
		const wrapped = wrapFetchWithResponseTimeout(fetch, 5_000);

		const pending = wrapped?.("https://api.example.com/v1/chat");
		const outcome = pending?.then(
			() => "resolved",
			(error: unknown) => error,
		);
		await vi.advanceTimersByTimeAsync(5_000);
		const error = await outcome;

		expect(error).toBeInstanceOf(DOMException);
		expect((error as DOMException).name).toBe("TimeoutError");
		expect(isTransientNetworkError(error)).toBe(true);
	});

	it("does not fire once the response headers have arrived", async () => {
		vi.useFakeTimers();
		let bodySignal: AbortSignal | null | undefined;
		const { fetch } = recordingFetch(async (init) => {
			bodySignal = init.signal;
			return new Response("streaming");
		});
		const wrapped = wrapFetchWithResponseTimeout(fetch, 5_000);

		const response = await wrapped?.("https://api.example.com/v1/chat");
		await vi.advanceTimersByTimeAsync(60_000);

		expect(bodySignal?.aborted).toBe(false);
		expect(await response?.text()).toBe("streaming");
	});

	it("still honors the caller's own abort signal", async () => {
		const { fetch } = recordingFetch((init) => rejectOnAbort(init.signal));
		const wrapped = wrapFetchWithResponseTimeout(fetch);
		const controller = new AbortController();
		const reason = new Error("user cancelled");

		const pending = wrapped?.("https://api.example.com/v1/chat", {
			signal: controller.signal,
		});
		controller.abort(reason);

		await expect(pending).rejects.toBe(reason);
	});

	it("honors the signal carried by a Request input when init has none", async () => {
		const { fetch } = recordingFetch((init) => rejectOnAbort(init.signal));
		const wrapped = wrapFetchWithResponseTimeout(fetch);
		const controller = new AbortController();
		const reason = new Error("user cancelled");

		const pending = wrapped?.(
			new Request("https://api.example.com/v1/chat", {
				signal: controller.signal,
			}),
		);
		controller.abort(reason);

		await expect(pending).rejects.toBe(reason);
	});

	it("preserves preconnect from the delegate", () => {
		const preconnect = vi.fn();
		const fetch = Object.assign(
			(() => Promise.resolve(new Response())) as typeof fetch,
			{ preconnect },
		);
		const wrapped = wrapFetchWithResponseTimeout(fetch) as typeof fetch & {
			preconnect?: (...args: unknown[]) => unknown;
		};

		wrapped.preconnect?.("https://api.example.com");

		expect(preconnect).toHaveBeenCalledWith("https://api.example.com");
	});

	it("uses a response timeout well above Bun's 300s default", () => {
		expect(PROVIDER_RESPONSE_TIMEOUT_MS).toBeGreaterThan(300_000);
	});
});
