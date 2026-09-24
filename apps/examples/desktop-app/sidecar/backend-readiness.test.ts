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

	it("queues one retry while the timed-out attempt is still cleaning up", async () => {
		vi.useFakeTimers();
		let finishCleanup!: () => void;
		const initialize = vi
			.fn()
			.mockImplementationOnce(
				(signal: AbortSignal) =>
					new Promise<void>((_, reject) => {
						signal.addEventListener(
							"abort",
							() => {
								finishCleanup = () => reject(signal.reason);
							},
							{ once: true },
						);
					}),
			)
			.mockResolvedValue(undefined);
		const lifecycle = new BackendInitialization(initialize, vi.fn(), 100);
		const first = lifecycle.start();
		await vi.advanceTimersByTimeAsync(100);
		expect(lifecycle.state.state).toBe("failed");
		const retry = lifecycle.start();
		expect(lifecycle.start()).toBe(retry);
		await vi.advanceTimersByTimeAsync(500);
		expect(initialize).toHaveBeenCalledTimes(1);
		finishCleanup();
		await first;
		await vi.advanceTimersByTimeAsync(999);
		expect(initialize).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		await retry;
		expect(initialize).toHaveBeenCalledTimes(2);
		expect(lifecycle.state).toEqual({ state: "ready", attempt: 2 });
	});

	it("discards a queued retry when shutdown starts during cleanup", async () => {
		vi.useFakeTimers();
		let finishCleanup!: () => void;
		const initialize = vi.fn(
			(signal: AbortSignal) =>
				new Promise<void>((_, reject) => {
					signal.addEventListener(
						"abort",
						() => {
							finishCleanup = () => reject(signal.reason);
						},
						{ once: true },
					);
				}),
		);
		const publish = vi.fn();
		const lifecycle = new BackendInitialization(initialize, publish, 100);
		const first = lifecycle.start();
		await vi.advanceTimersByTimeAsync(100);
		const retry = lifecycle.start();
		lifecycle.stop();
		const eventsBeforeCleanup = publish.mock.calls.length;
		finishCleanup();
		await Promise.all([first, retry]);
		await vi.advanceTimersByTimeAsync(30_000);
		expect(initialize).toHaveBeenCalledTimes(1);
		expect(publish).toHaveBeenCalledTimes(eventsBeforeCleanup);
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
