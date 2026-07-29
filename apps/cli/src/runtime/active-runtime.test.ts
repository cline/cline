import { afterEach, describe, expect, it, vi } from "vitest";
import {
	abortActiveRuntime,
	acquireAbortRejectionShield,
	cleanupActiveRuntime,
	clearAbortInProgress,
	isAbortInProgress,
	markAbortInProgress,
	setActiveRuntimeAbort,
	setActiveRuntimeCleanup,
} from "./active-runtime";

describe("active runtime hooks", () => {
	afterEach(() => {
		setActiveRuntimeAbort(undefined);
		setActiveRuntimeCleanup(undefined);
	});

	it("keeps abort and cleanup hooks independent", () => {
		const abort = vi.fn();
		const cleanup = vi.fn();

		setActiveRuntimeAbort(abort);
		setActiveRuntimeCleanup(cleanup);

		abortActiveRuntime();

		expect(abort).toHaveBeenCalledTimes(1);
		expect(cleanup).not.toHaveBeenCalled();

		cleanupActiveRuntime();

		expect(cleanup).toHaveBeenCalledTimes(1);
	});

	it("swallows cleanup hook failures", () => {
		setActiveRuntimeCleanup(() => {
			throw new Error("cleanup failed");
		});

		expect(() => cleanupActiveRuntime()).not.toThrow();
	});

	it("keeps abort rejection shielding active until overlapping aborts clear", async () => {
		vi.useFakeTimers();
		try {
			markAbortInProgress();
			const releaseHelperAbort = acquireAbortRejectionShield();
			expect(isAbortInProgress()).toBe(true);

			clearAbortInProgress();
			await vi.advanceTimersByTimeAsync(2_000);
			expect(isAbortInProgress()).toBe(true);

			releaseHelperAbort();
			expect(isAbortInProgress()).toBe(true);
			await vi.advanceTimersByTimeAsync(2_000);
			expect(isAbortInProgress()).toBe(false);
		} finally {
			clearAbortInProgress();
			await vi.runAllTimersAsync();
			vi.useRealTimers();
		}
	});
});
