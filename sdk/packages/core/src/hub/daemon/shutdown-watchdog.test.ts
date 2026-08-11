import { afterEach, describe, expect, it, vi } from "vitest";
import { armHubDaemonShutdownWatchdog } from "./shutdown-watchdog";

describe("hub daemon shutdown watchdog", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("forces the requested exit when graceful shutdown stalls", () => {
		vi.useFakeTimers();
		const exit = vi.fn();
		const onTimeout = vi.fn();

		armHubDaemonShutdownWatchdog({
			deadlineMs: 2_000,
			exitCode: 0,
			exit,
			onTimeout,
		});
		vi.advanceTimersByTime(1_999);
		expect(exit).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		expect(onTimeout).toHaveBeenCalledOnce();
		expect(exit).toHaveBeenCalledWith(0);
	});
});
