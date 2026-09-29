import { afterEach, describe, expect, it, vi } from "vitest";
import {
	abortActiveRuntime,
	cleanupActiveRuntime,
	dispatchActiveRuntimeSignal,
	setActiveRuntimeAbort,
	setActiveRuntimeCleanup,
	setActiveRuntimeSignalHandler,
} from "./active-runtime";

describe("active runtime hooks", () => {
	afterEach(() => {
		setActiveRuntimeAbort(undefined);
		setActiveRuntimeCleanup(undefined);
		setActiveRuntimeSignalHandler(undefined);
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
	it("routes OS signals to exactly one interactive owner without implicit abort", () => {
		const abort = vi.fn();
		const signal = vi.fn();
		setActiveRuntimeAbort(abort);
		expect(dispatchActiveRuntimeSignal("SIGINT")).toBe(false);
		setActiveRuntimeSignalHandler(signal);
		for (const name of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
			expect(dispatchActiveRuntimeSignal(name)).toBe(true);
		expect(signal.mock.calls).toEqual([["SIGINT"], ["SIGTERM"], ["SIGHUP"]]);
		expect(abort).not.toHaveBeenCalled();
	});
});
