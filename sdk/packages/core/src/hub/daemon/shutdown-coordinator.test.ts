import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createHubDaemonShutdownCoordinator,
	HUB_DAEMON_SHUTDOWN_DEADLINE_MS,
} from "./shutdown-coordinator";

describe("createHubDaemonShutdownCoordinator", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("runs cleanup and exits once for repeated graceful requests", async () => {
		const cleanup = vi.fn(async () => undefined);
		const exit = vi.fn();
		const coordinator = createHubDaemonShutdownCoordinator({
			deadlineMs: 2_000,
			cleanup,
			exit,
		});

		const first = coordinator.request({ reason: "http", exitCode: 0 });
		const second = coordinator.request({ reason: "SIGTERM", exitCode: 0 });

		expect(second).toBe(first);
		await first;
		expect(cleanup).toHaveBeenCalledOnce();
		expect(exit).toHaveBeenCalledOnce();
		expect(exit).toHaveBeenCalledWith(0);
		expect(coordinator.getState()).toBe("finished");
	});

	it("does not re-enter cleanup when cleanup requests shutdown", async () => {
		let coordinator!: ReturnType<typeof createHubDaemonShutdownCoordinator>;
		const cleanup = vi.fn(async () => {
			void coordinator.request({ reason: "cleanup re-entry", exitCode: 0 });
		});
		const exit = vi.fn();
		coordinator = createHubDaemonShutdownCoordinator({
			deadlineMs: 2_000,
			cleanup,
			exit,
		});

		await coordinator.request({ reason: "http", exitCode: 0 });

		expect(cleanup).toHaveBeenCalledOnce();
		expect(exit).toHaveBeenCalledOnce();
	});

	it("upgrades the exit code when a fatal request arrives during cleanup", async () => {
		let releaseCleanup!: () => void;
		const cleanup = vi.fn(
			async () =>
				await new Promise<void>((resolve) => {
					releaseCleanup = resolve;
				}),
		);
		const exit = vi.fn();
		const coordinator = createHubDaemonShutdownCoordinator({
			deadlineMs: 2_000,
			cleanup,
			exit,
		});

		const shutdown = coordinator.request({ reason: "SIGTERM", exitCode: 0 });
		coordinator.request({ reason: "uncaughtException", exitCode: 1 });
		await Promise.resolve();
		releaseCleanup();
		await shutdown;

		expect(cleanup).toHaveBeenCalledOnce();
		expect(exit).toHaveBeenCalledOnce();
		expect(exit).toHaveBeenCalledWith(1);
	});

	it("forces one exit when graceful cleanup misses its deadline", async () => {
		const cleanup = vi.fn(async () => await new Promise<void>(() => undefined));
		const exit = vi.fn();
		const onForcedExit = vi.fn();
		const coordinator = createHubDaemonShutdownCoordinator({
			deadlineMs: 2_000,
			cleanup,
			exit,
			onForcedExit,
		});

		void coordinator.request({ reason: "SIGTERM", exitCode: 0 });
		await vi.advanceTimersByTimeAsync(1_999);
		expect(exit).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);
		expect(onForcedExit).toHaveBeenCalledWith({
			reason: "shutdown deadline exceeded after SIGTERM",
			exitCode: 0,
		});
		expect(exit).toHaveBeenCalledOnce();
		expect(exit).toHaveBeenCalledWith(0);
		expect(coordinator.getState()).toBe("forced");
	});

	it("lets a second termination signal force the active shutdown", () => {
		const cleanup = vi.fn(async () => await new Promise<void>(() => undefined));
		const exit = vi.fn();
		const coordinator = createHubDaemonShutdownCoordinator({
			deadlineMs: 2_000,
			cleanup,
			exit,
		});

		void coordinator.request({ reason: "SIGINT", exitCode: 0 });
		coordinator.force({ reason: "second SIGINT", exitCode: 0 });
		coordinator.force({ reason: "third SIGINT", exitCode: 0 });

		expect(exit).toHaveBeenCalledOnce();
		expect(coordinator.getState()).toBe("forced");
	});

	it("still exits when the forced-exit observer throws", async () => {
		const exit = vi.fn();
		const coordinator = createHubDaemonShutdownCoordinator({
			deadlineMs: 2_000,
			cleanup: async () => await new Promise<void>(() => undefined),
			exit,
			onForcedExit: () => {
				throw new Error("logging failed");
			},
		});

		void coordinator.request({ reason: "SIGTERM", exitCode: 0 });
		await expect(vi.advanceTimersByTimeAsync(2_000)).rejects.toThrow(
			"logging failed",
		);
		expect(exit).toHaveBeenCalledOnce();
		expect(exit).toHaveBeenCalledWith(0);
	});

	it("reports cleanup errors and exits unsuccessfully", async () => {
		const failure = new Error("close failed");
		const exit = vi.fn();
		const onCleanupError = vi.fn();
		const coordinator = createHubDaemonShutdownCoordinator({
			deadlineMs: 2_000,
			cleanup: async () => {
				throw failure;
			},
			exit,
			onCleanupError,
		});

		await coordinator.request({ reason: "SIGTERM", exitCode: 0 });

		expect(onCleanupError).toHaveBeenCalledWith(failure);
		expect(exit).toHaveBeenCalledWith(1);
	});

	it("keeps the daemon deadline below the caller-side retirement wait", () => {
		expect(HUB_DAEMON_SHUTDOWN_DEADLINE_MS).toBeLessThan(3_000);
	});
});
