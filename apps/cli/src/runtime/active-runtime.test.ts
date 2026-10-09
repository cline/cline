import { afterEach, describe, expect, it, vi } from "vitest";
import {
	abortActiveRuntime,
	cleanupActiveRuntime,
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
});
