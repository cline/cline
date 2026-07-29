import { afterEach, describe, expect, it, vi } from "vitest";
import { ResourceMonitor } from "./monitor";
import { resolveResourcePolicy } from "./policy";

function createPolicy(enabled = true) {
	return resolveResourcePolicy({
		env: {},
		hardware: {
			availableParallelism: 4,
			totalMemoryBytes: 8 * 1024 ** 3,
			heapSizeLimitBytes: 2 * 1024 ** 3,
		},
		overrides: {
			diagnostics: {
				enabled,
				sampleIntervalMs: 100,
				eventLoopResolutionMs: 1,
			},
		},
	});
}

afterEach(() => {
	vi.useRealTimers();
});

describe("ResourceMonitor", () => {
	it("samples process memory and event-loop metrics for observers", () => {
		vi.useFakeTimers();
		const monitor = new ResourceMonitor(createPolicy());
		const listener = vi.fn();
		monitor.subscribe(listener);

		vi.advanceTimersByTime(100);

		expect(listener).toHaveBeenCalledTimes(1);
		const snapshot = listener.mock.calls[0]?.[0];
		expect(snapshot.memory.rss).toBeGreaterThan(0);
		expect(snapshot.memory.heapUsed).toBeGreaterThan(0);
		expect(snapshot.eventLoop.utilization).toBeGreaterThanOrEqual(0);
		expect(snapshot.eventLoop.delayP99Milliseconds).toBeGreaterThanOrEqual(0);
		expect(monitor.getSnapshot()).toBe(snapshot);
		monitor.dispose();
	});

	it("owns its timer lifecycle and remains observe-only when disabled", () => {
		vi.useFakeTimers();
		const monitor = new ResourceMonitor(createPolicy(false));
		const listener = vi.fn();
		monitor.subscribe(listener);

		expect(vi.getTimerCount()).toBe(0);
		const snapshot = monitor.sample();
		expect(listener).toHaveBeenCalledWith(snapshot);
		expect(snapshot.memory.external).toBeGreaterThanOrEqual(0);

		monitor.dispose();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("stops periodic sampling on disposal", () => {
		vi.useFakeTimers();
		const monitor = new ResourceMonitor(createPolicy());
		const listener = vi.fn();
		monitor.subscribe(listener);
		monitor.dispose();

		vi.advanceTimersByTime(500);

		expect(listener).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});
});
