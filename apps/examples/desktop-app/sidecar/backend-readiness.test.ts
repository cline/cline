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

	it("publishes real startup progress and ignores updates after shutdown", async () => {
		let complete!: () => void;
		const publish = vi.fn();
		const lifecycle = new BackendInitialization(
			() =>
				new Promise<void>((resolve) => {
					complete = resolve;
				}),
			publish,
		);
		const pending = lifecycle.start();
		lifecycle.reportStep("discovery");
		expect(lifecycle.state.step).toBe("discovery");
		lifecycle.reportStep("connecting");
		expect(lifecycle.state.step).toBe("connecting");
		lifecycle.stop();
		const calls = publish.mock.calls.length;
		lifecycle.reportStep("sessions");
		complete();
		await pending;
		expect(publish).toHaveBeenCalledTimes(calls);
	});

	it("recovers automatically without a retry click", async () => {
		vi.useFakeTimers();
		const initialize = vi
			.fn()
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValue(undefined);
		const lifecycle = new BackendInitialization(initialize, vi.fn());
		await lifecycle.start();
		expect(lifecycle.state.message).toContain("Retrying automatically");
		expect(lifecycle.state.automaticRetry).toBe(true);
		await vi.advanceTimersByTimeAsync(999);
		expect(initialize).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(initialize).toHaveBeenCalledTimes(2);
		expect(lifecycle.state.state).toBe("ready");
		await vi.advanceTimersByTimeAsync(30_000);
		expect(initialize).toHaveBeenCalledTimes(2);
	});

	it("bounds automatic retries with exponential backoff", async () => {
		vi.useFakeTimers();
		const initialize = vi.fn().mockRejectedValue(new Error("offline"));
		const lifecycle = new BackendInitialization(initialize, vi.fn());
		await lifecycle.start();
		for (const [delay, calls] of [
			[1000, 2],
			[2000, 3],
			[4000, 4],
		]) {
			await vi.advanceTimersByTimeAsync(delay - 1);
			expect(initialize).toHaveBeenCalledTimes(calls - 1);
			await vi.advanceTimersByTimeAsync(1);
			expect(initialize).toHaveBeenCalledTimes(calls);
		}
		await vi.advanceTimersByTimeAsync(60_000);
		expect(initialize).toHaveBeenCalledTimes(4);
		expect(lifecycle.state.message).not.toContain("Retrying automatically");
		expect(lifecycle.state.automaticRetry).toBe(false);
	});

	it("cancels scheduled automatic recovery on shutdown", async () => {
		vi.useFakeTimers();
		const initialize = vi.fn().mockRejectedValue(new Error("offline"));
		const lifecycle = new BackendInitialization(initialize, vi.fn());
		await lifecycle.start();
		lifecycle.stop();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(initialize).toHaveBeenCalledTimes(1);
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
		lifecycle.stop();
	});
});
