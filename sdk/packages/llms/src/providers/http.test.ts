import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_RESPONSE_START_TIMEOUT_MS,
	readResponseStartTimeoutMs,
	withResponseStartTimeout,
} from "./http";

describe("readResponseStartTimeoutMs", () => {
	it("reads a configured timeout", () => {
		expect(readResponseStartTimeoutMs({ timeoutMs: 180000 })).toBe(180000);
	});

	it("floors fractional timeouts", () => {
		expect(readResponseStartTimeoutMs({ timeoutMs: 1500.75 })).toBe(1500);
	});

	it("falls back to the shared default for missing or invalid values", () => {
		expect(readResponseStartTimeoutMs({})).toBe(
			DEFAULT_RESPONSE_START_TIMEOUT_MS,
		);
		expect(readResponseStartTimeoutMs({ timeoutMs: 0 })).toBe(
			DEFAULT_RESPONSE_START_TIMEOUT_MS,
		);
		expect(readResponseStartTimeoutMs({ timeoutMs: -5 })).toBe(
			DEFAULT_RESPONSE_START_TIMEOUT_MS,
		);
	});

	it("falls back to a caller-supplied default", () => {
		expect(readResponseStartTimeoutMs({}, 30_000)).toBe(30_000);
	});
});

describe("withResponseStartTimeout", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const hangingFetch = ((_input, init) =>
		new Promise((_resolve, reject) => {
			init?.signal?.addEventListener("abort", () =>
				reject(init.signal?.reason),
			);
		})) as typeof fetch;

	it("aborts when the response does not start within the timeout", async () => {
		const wrapped = withResponseStartTimeout(hangingFetch, 1000, "Dead API");
		const pending = wrapped("http://localhost:9999/v1/chat/completions");
		const assertion = expect(pending).rejects.toThrow(
			"Dead API request timed out after 1 seconds waiting for the response to start",
		);
		await vi.advanceTimersByTimeAsync(1001);
		await assertion;
	});

	it("aborts with a TimeoutError so the AI SDK treats it as terminal instead of retrying", async () => {
		const wrapped = withResponseStartTimeout(hangingFetch, 1000);
		const pending = wrapped("http://localhost:9999/v1/chat/completions");
		const assertion = expect(pending).rejects.toMatchObject({
			name: "TimeoutError",
		});
		await vi.advanceTimersByTimeAsync(1001);
		await assertion;
	});

	it("does not abort once the response has started", async () => {
		let requestSignal: AbortSignal | undefined;
		const immediateFetch = (async (_input, init) => {
			requestSignal = init?.signal ?? undefined;
			return new Response("ok");
		}) as typeof fetch;

		const wrapped = withResponseStartTimeout(immediateFetch, 1000);
		const response = await wrapped("http://localhost:9999/v1/chat/completions");
		await vi.advanceTimersByTimeAsync(5000);

		expect(response.ok).toBe(true);
		// Timer was cleared on response start — streaming continues unaborted.
		expect(requestSignal?.aborted).toBe(false);
	});

	it("propagates upstream aborts", async () => {
		const upstream = new AbortController();
		const wrapped = withResponseStartTimeout(hangingFetch, 60_000);
		const pending = wrapped("http://localhost:9999/v1/chat/completions", {
			signal: upstream.signal,
		});
		const assertion = expect(pending).rejects.toThrow("user cancelled");
		upstream.abort(new Error("user cancelled"));
		await assertion;
	});

	it("preserves a preconnect helper on the base fetch", () => {
		const preconnect = vi.fn();
		const baseFetch = Object.assign(
			(async () => new Response("ok")) as typeof fetch,
			{ preconnect },
		);

		const wrapped = withResponseStartTimeout(
			baseFetch,
			1000,
		) as typeof fetch & { preconnect?: (url: string) => void };
		wrapped.preconnect?.("http://localhost:9999");

		expect(preconnect).toHaveBeenCalledWith("http://localhost:9999");
	});
});
