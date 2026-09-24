import { afterEach, describe, expect, it, vi } from "vitest";
import { BackendInitialization } from "./backend-readiness";

afterEach(() => vi.useRealTimers());

describe("session service initialization", () => {
	it("serializes retries, aborts a hang, and recovers after backoff", async () => {
		vi.useFakeTimers();
		const initialize = vi
			.fn()
			.mockImplementationOnce(
				(signal: AbortSignal) =>
					new Promise<void>((_, reject) => {
						signal.addEventListener("abort", () => reject(signal.reason), {
							once: true,
						});
					}),
			)
			.mockResolvedValue(undefined);
		const publish = vi.fn();
		const lifecycle = new BackendInitialization(initialize, publish, 100);
		const first = lifecycle.start();
		expect(lifecycle.start()).toBe(first);
		await vi.advanceTimersByTimeAsync(100);
		await first;
		expect(lifecycle.state.state).toBe("failed");
		const retry = lifecycle.start();
		expect(lifecycle.start()).toBe(retry);
		expect(initialize).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1_000);
		await retry;
		expect(lifecycle.state).toEqual({ state: "ready", attempt: 2 });
		expect(initialize).toHaveBeenCalledTimes(2);
	});

	it("never publishes ready or restarts after shutdown", async () => {
		let complete!: () => void;
		const initialize = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					complete = resolve;
				}),
		);
		const publish = vi.fn();
		const lifecycle = new BackendInitialization(initialize, publish);
		const pending = lifecycle.start();
		lifecycle.stop();
		complete();
		await pending;
		await lifecycle.start();
		expect(initialize).toHaveBeenCalledTimes(1);
		expect(publish).not.toHaveBeenCalledWith(
			expect.objectContaining({ state: "ready" }),
		);
	});

	it("does not disclose credentials in bootstrap failures", async () => {
		const lifecycle = new BackendInitialization(async () => {
			throw new Error("ws://host/?approval_token=secret password=hunter2");
		}, vi.fn());
		await lifecycle.start();
		expect(lifecycle.state.state).toBe("failed");
		expect(JSON.stringify(lifecycle.state)).not.toMatch(/secret|hunter2/);
	});
});
