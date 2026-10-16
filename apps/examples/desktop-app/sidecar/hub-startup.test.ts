import { afterEach, describe, expect, it, vi } from "vitest";
import { HubStartup, type HubStartupStatus } from "./hub-startup";

function deferred() {
	let resolve!: () => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<void>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

afterEach(() => {
	vi.useRealTimers();
});

describe("HubStartup", () => {
	it("reports ready when setup succeeds and releases waiting commands", async () => {
		const setup = deferred();
		const statuses: HubStartupStatus[] = [];
		const startup = new HubStartup(
			() => setup.promise,
			(status) => statuses.push(status),
			vi.fn(),
		);
		startup.start();
		const waiting = startup.waitUntilSettled();
		setup.resolve();
		await waiting;
		expect(statuses.map((status) => status.state)).toEqual([
			"starting",
			"ready",
		]);
	});

	it("reports a fixed message and hands the raw error to the failure hook", async () => {
		const error = new Error(
			"hub exploded at ws://127.0.0.1:25463?token=secret",
		);
		const onFailure = vi.fn();
		const startup = new HubStartup(
			() => Promise.reject(error),
			vi.fn(),
			onFailure,
		);
		startup.start();
		await startup.waitUntilSettled();
		expect(onFailure).toHaveBeenCalledWith(error);
		expect(startup.status.state).toBe("failed");
		expect(startup.status.error).not.toContain("secret");
	});

	it("fails after the timeout but still becomes ready if the slow setup finishes", async () => {
		vi.useFakeTimers();
		const setup = deferred();
		const onFailure = vi.fn();
		const startup = new HubStartup(
			() => setup.promise,
			vi.fn(),
			onFailure,
			1_000,
		);
		startup.start();
		await vi.advanceTimersByTimeAsync(1_000);
		expect(startup.status).toEqual({
			state: "failed",
			error: "Cline Hub did not respond within 30 seconds.",
		});
		expect(onFailure).toHaveBeenCalledWith(
			expect.objectContaining({ message: expect.stringContaining("1000ms") }),
		);
		setup.resolve();
		await vi.runAllTimersAsync();
		expect(startup.status.state).toBe("ready");
	});

	it("reuses a pending attempt on retry and starts a new one after it fails", async () => {
		vi.useFakeTimers();
		const first = deferred();
		const run = vi
			.fn<() => Promise<void>>()
			.mockReturnValueOnce(first.promise)
			.mockResolvedValueOnce(undefined);
		const startup = new HubStartup(run, vi.fn(), vi.fn(), 1_000);
		startup.start();
		await vi.advanceTimersByTimeAsync(1_000);
		startup.start();
		expect(startup.status.state).toBe("starting");
		expect(run).toHaveBeenCalledTimes(1);

		first.reject(new Error("still broken"));
		await vi.runAllTimersAsync();
		expect(startup.status.state).toBe("failed");
		startup.start();
		await vi.runAllTimersAsync();
		expect(run).toHaveBeenCalledTimes(2);
		expect(startup.status.state).toBe("ready");
	});
});
