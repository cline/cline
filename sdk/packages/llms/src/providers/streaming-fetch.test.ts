import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_INFERENCE_TIMEOUT_MS,
	readInferenceTimeoutMs,
	withInferenceTimeout,
} from "./streaming-fetch";

describe("inference transport deadlines", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());
	it("defaults invalid overrides to 30 minutes", () => {
		expect(DEFAULT_INFERENCE_TIMEOUT_MS).toBe(1_800_000);
		for (const value of [undefined, 0, -1, Number.NaN, Infinity, 0.5])
			expect(readInferenceTimeoutMs(value)).toBe(1_800_000);
		expect(readInferenceTimeoutMs(1234.9)).toBe(1234);
	});
	it("bounds silent startup and disables Bun's hidden deadline", async () => {
		const delegate = vi.fn(
			(_input, init) =>
				new Promise<Response>((_resolve, reject) =>
					init.signal.addEventListener("abort", () =>
						reject(init.signal.reason),
					),
				),
		);
		const pending = withInferenceTimeout(
			delegate as typeof fetch,
			1000,
			"Local model",
		)("https://model.test");
		const assertion = expect(pending).rejects.toThrow(
			"waiting for response headers after 1 seconds",
		);
		expect(delegate.mock.calls[0][1].timeout).toBe(false);
		await vi.advanceTimersByTimeAsync(1001);
		await assertion;
		expect(vi.getTimerCount()).toBe(0);
	});
	it("allows generation past the startup budget while raw heartbeats arrive", async () => {
		let source!: ReadableStreamDefaultController<Uint8Array>;
		const stream = new ReadableStream<Uint8Array>({
			start(c) {
				source = c;
			},
		});
		const delegate = vi.fn(
			async () =>
				new Response(stream, {
					headers: { "content-type": "text/event-stream" },
				}),
		);
		const response = await withInferenceTimeout(
			delegate as typeof fetch,
			1000,
			"Local model",
		)("https://model.test");
		if (!response.body) throw new Error("Expected streaming body");
		const reader = response.body.getReader();
		for (let i = 0; i < 5; i++) {
			const pending = reader.read();
			await vi.advanceTimersByTimeAsync(900);
			source.enqueue(new TextEncoder().encode(": keep-alive\n\n"));
			expect(new TextDecoder().decode((await pending).value)).toBe(
				": keep-alive\n\n",
			);
		}
		source.enqueue(new TextEncoder().encode("data: OK\n\n"));
		source.close();
		expect(new TextDecoder().decode((await reader.read()).value)).toBe(
			"data: OK\n\n",
		);
		expect((await reader.read()).done).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
	});
	it("bounds body inactivity after response headers", async () => {
		const cancel = vi.fn();
		const delegate = vi.fn(
			async () => new Response(new ReadableStream({ cancel })),
		);
		const response = await withInferenceTimeout(
			delegate as typeof fetch,
			1000,
			"Local model",
		)("https://model.test");
		const assertion = expect(response.text()).rejects.toThrow(
			"waiting for response data after 1 seconds",
		);
		await vi.advanceTimersByTimeAsync(1001);
		await assertion;
		expect(cancel).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});
	it("preserves cancellation from a Request during streaming", async () => {
		const upstream = new AbortController();
		const delegate = vi.fn(async () => new Response(new ReadableStream()));
		const response = await withInferenceTimeout(
			delegate as typeof fetch,
			1000,
			"Local model",
		)(new Request("https://model.test", { signal: upstream.signal }));
		const assertion = expect(response.text()).rejects.toThrow("user cancelled");
		upstream.abort(new Error("user cancelled"));
		await assertion;
		expect(vi.getTimerCount()).toBe(0);
	});
	it("releases the upstream body and timers when the consumer stops", async () => {
		const cancel = vi.fn();
		const delegate = vi.fn(
			async () => new Response(new ReadableStream({ cancel })),
		);
		const response = await withInferenceTimeout(
			delegate as typeof fetch,
			1000,
			"Local model",
		)("https://model.test");
		if (!response.body) throw new Error("Expected streaming body");
		await response.body.cancel("stop");
		expect(cancel).toHaveBeenCalledWith("stop");
		expect(vi.getTimerCount()).toBe(0);
	});
	it("preserves empty HTTP responses, headers and preconnect", async () => {
		const preconnect = vi.fn();
		const delegate = Object.assign(
			vi.fn(
				async () =>
					new Response(null, { status: 204, headers: { "x-test": "yes" } }),
			),
			{ preconnect },
		);
		const wrapped = withInferenceTimeout(
			delegate as typeof fetch,
			1000,
			"Local model",
		);
		(wrapped as typeof wrapped & { preconnect: typeof preconnect }).preconnect(
			"https://model.test",
		);
		const response = await wrapped("https://model.test");
		expect(response.status).toBe(204);
		expect(response.headers.get("x-test")).toBe("yes");
		expect(preconnect).toHaveBeenCalledWith("https://model.test");
		expect(vi.getTimerCount()).toBe(0);
	});
});
