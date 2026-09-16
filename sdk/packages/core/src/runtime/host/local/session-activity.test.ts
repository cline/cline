import type { AgentEvent } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionActivity } from "./session-activity";

describe("SessionActivity", () => {
	afterEach(() => vi.useRealTimers());

	it("records progress without per-event writes and persists the trailing observation time", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000);
		const persist = vi.fn().mockResolvedValue(undefined);
		const activity = new SessionActivity(null, persist, vi.fn());
		activity.observe({ type: "iteration_start", iteration: 1 });
		await vi.advanceTimersByTimeAsync(30_000);
		activity.observe({
			type: "content_update",
			contentType: "tool",
			update: "progress",
		});
		expect(activity.lastObservedAt).toBe(31_000);
		expect(persist).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(30_000);
		expect(persist.mock.calls).toEqual([[31_000]]);
		await activity.flush();
		expect(persist).toHaveBeenCalledTimes(1);
	});

	it("does not treat status notices or usage accounting as fresh progress", async () => {
		const persist = vi.fn();
		const activity = new SessionActivity(null, persist, vi.fn());
		for (const type of ["notice", "usage", "iteration_end", "done", "error"]) {
			activity.observe({ type } as AgentEvent);
		}
		await activity.flush();
		expect(activity.lastObservedAt).toBeNull();
		expect(persist).not.toHaveBeenCalled();
	});

	it.each([
		"done",
		"error",
	] as const)("flushes on %s, stays monotonic, and retries a failed write", async (type) => {
		vi.useFakeTimers();
		vi.setSystemTime(2_000);
		const error = new Error("storage unavailable");
		const persist = vi
			.fn()
			.mockRejectedValueOnce(error)
			.mockResolvedValue(undefined);
		const onError = vi.fn();
		const activity = new SessionActivity(1_000, persist, onError);
		activity.observe({
			type: "content_end",
			contentType: "text",
			text: "done",
		});
		activity.observe({ type } as AgentEvent);
		await vi.advanceTimersByTimeAsync(0);
		expect(onError).toHaveBeenCalledWith(error);
		vi.setSystemTime(500);
		activity.observe({ type: "content_start", contentType: "reasoning" });
		await activity.flush();
		expect(activity.lastObservedAt).toBe(2_000);
		expect(persist.mock.calls).toEqual([[2_000], [2_000]]);
		expect(vi.getTimerCount()).toBe(0);
	});
});
