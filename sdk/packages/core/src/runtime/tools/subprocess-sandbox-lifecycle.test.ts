import { afterEach, describe, expect, it, vi } from "vitest";
import {
	IdleExitController,
	installParentDisconnectGuard,
	parseIdleTimeoutMs,
} from "./subprocess-sandbox-lifecycle";

afterEach(() => {
	vi.useRealTimers();
});

describe("subprocess sandbox lifecycle", () => {
	it("exits when the parent IPC channel disconnects", () => {
		let onDisconnect: (() => void) | undefined;
		const exit = vi.fn();
		installParentDisconnectGuard({
			once: (event, listener) => {
				expect(event).toBe("disconnect");
				onDisconnect = listener;
			},
			exit,
		});

		onDisconnect?.();

		expect(exit).toHaveBeenCalledOnce();
		expect(exit).toHaveBeenCalledWith(0);
	});

	it("parses only positive idle timeouts supported by Node timers", () => {
		expect(parseIdleTimeoutMs("1000")).toBe(1000);
		expect(parseIdleTimeoutMs(undefined)).toBeUndefined();
		expect(parseIdleTimeoutMs("0")).toBeUndefined();
		expect(parseIdleTimeoutMs("1000ms")).toBeUndefined();
		expect(parseIdleTimeoutMs("2147483648")).toBeUndefined();
	});

	it("waits for all overlapping calls to finish before starting idle time", async () => {
		vi.useFakeTimers();
		const onIdle = vi.fn();
		const controller = new IdleExitController(onIdle);
		controller.configure(1000);
		controller.beginCall();
		controller.beginCall();

		await vi.advanceTimersByTimeAsync(5000);
		expect(onIdle).not.toHaveBeenCalled();

		controller.endCall();
		await vi.advanceTimersByTimeAsync(5000);
		expect(onIdle).not.toHaveBeenCalled();

		controller.endCall();
		await vi.advanceTimersByTimeAsync(999);
		expect(onIdle).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);
		expect(onIdle).toHaveBeenCalledOnce();
	});
});
