import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	armHubDaemonShutdownWatchdog,
	HUB_DAEMON_SHUTDOWN_DEADLINE_MS,
} from "./shutdown-watchdog";

describe("armHubDaemonShutdownWatchdog", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("forces exit with the given code once the deadline lapses", () => {
		const exit = vi.fn();
		const onTimeout = vi.fn();
		armHubDaemonShutdownWatchdog({
			deadlineMs: 2_000,
			exitCode: 0,
			onTimeout,
			exit,
		});

		vi.advanceTimersByTime(1_999);
		expect(exit).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		expect(onTimeout).toHaveBeenCalledTimes(1);
		expect(exit).toHaveBeenCalledWith(0);
	});

	it("does not fire before the deadline, so a fast graceful exit wins", () => {
		const exit = vi.fn();
		armHubDaemonShutdownWatchdog({
			deadlineMs: 2_000,
			exitCode: 0,
			exit,
		});

		// A graceful shutdown that completes calls process.exit itself; the
		// watchdog must stay quiet until then.
		vi.advanceTimersByTime(500);
		expect(exit).not.toHaveBeenCalled();
	});

	it("keeps the daemon deadline below the retiring caller's 3s wait", () => {
		// retireDiscoveredHub waits HUB_RETIRE_TIMEOUT_MS (3s) after SIGTERM
		// before escalating to SIGKILL. The watchdog must beat that wait so
		// routine retirement never needs to force-kill.
		expect(HUB_DAEMON_SHUTDOWN_DEADLINE_MS).toBeLessThan(3_000);
	});
});
