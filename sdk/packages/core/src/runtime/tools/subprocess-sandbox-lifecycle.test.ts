import { describe, expect, it, vi } from "vitest";
import {
	installParentDisconnectGuard,
	normalizeIdleTimeoutMs,
} from "./subprocess-sandbox-lifecycle";

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

	it("accepts only positive idle timeouts supported by Node timers", () => {
		expect(normalizeIdleTimeoutMs(1000)).toBe(1000);
		expect(normalizeIdleTimeoutMs(undefined)).toBeUndefined();
		expect(normalizeIdleTimeoutMs(0)).toBeUndefined();
		expect(normalizeIdleTimeoutMs(1.5)).toBeUndefined();
		expect(normalizeIdleTimeoutMs(2_147_483_648)).toBeUndefined();
	});
});
