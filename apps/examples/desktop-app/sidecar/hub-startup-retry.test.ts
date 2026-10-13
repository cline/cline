import { afterEach, describe, expect, it, vi } from "vitest";
import {
	isHubUnavailableError,
	retryUntilHubAvailable,
} from "./hub-startup-retry";

const hubUnavailable = () =>
	new Error(
		"No compatible hub runtime is available: Timed out after 15000ms waiting for detached hub startup.",
	);

describe("retryUntilHubAvailable", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("recognizes only hub-availability failures", () => {
		expect(isHubUnavailableError(hubUnavailable())).toBe(true);
		expect(
			isHubUnavailableError(
				new Error("No compatible hub runtime is available."),
			),
		).toBe(true);
		expect(isHubUnavailableError(new Error("ENOENT: settings.json"))).toBe(
			false,
		);
		expect(
			isHubUnavailableError("No compatible hub runtime is available"),
		).toBe(false);
	});

	it("retries while the hub is unavailable and returns the first success", async () => {
		vi.useFakeTimers();
		const attempt = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(hubUnavailable())
			.mockRejectedValueOnce(hubUnavailable())
			.mockResolvedValue("ready");
		const onRetry = vi.fn();

		const pending = retryUntilHubAvailable(attempt, { onRetry });
		await vi.advanceTimersByTimeAsync(2_000);

		await expect(pending).resolves.toBe("ready");
		expect(attempt).toHaveBeenCalledTimes(3);
		expect(onRetry).toHaveBeenCalledTimes(2);
		expect(onRetry).toHaveBeenNthCalledWith(1, {
			error: expect.any(Error),
			attempt: 1,
			elapsedMs: expect.any(Number),
		});
	});

	it("fails fast on errors that are not about hub availability", async () => {
		const attempt = vi
			.fn<() => Promise<string>>()
			.mockRejectedValue(new Error("EACCES: settings.json"));
		const onRetry = vi.fn();

		await expect(retryUntilHubAvailable(attempt, { onRetry })).rejects.toThrow(
			"EACCES: settings.json",
		);
		expect(attempt).toHaveBeenCalledTimes(1);
		expect(onRetry).not.toHaveBeenCalled();
	});

	it("gives up with the last hub error once the window is spent", async () => {
		vi.useFakeTimers();
		const attempt = vi
			.fn<() => Promise<string>>()
			.mockRejectedValue(hubUnavailable());

		let clock = 0;
		const pending = retryUntilHubAvailable(attempt, {
			windowMs: 5_000,
			delayMs: 1_000,
			now: () => clock,
			sleep: async (ms) => {
				clock += ms;
			},
		});

		await expect(pending).rejects.toThrow(
			"No compatible hub runtime is available",
		);
		// t=0,1s,2s,3s fail and wait; the failure at t=4s would need to wait
		// until 5s, which is the window, so it is the last attempt.
		expect(attempt).toHaveBeenCalledTimes(5);
	});
});
