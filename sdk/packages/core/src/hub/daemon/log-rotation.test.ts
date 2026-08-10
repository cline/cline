import { beforeEach, describe, expect, it, vi } from "vitest";

const { copyFile, stat, truncate } = vi.hoisted(() => ({
	copyFile: vi.fn(),
	stat: vi.fn(),
	truncate: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({ copyFile, stat, truncate }));

import { startHubLogRotation } from "./log-rotation";

describe("startHubLogRotation", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		copyFile.mockResolvedValue(undefined);
		truncate.mockResolvedValue(undefined);
	});

	it("retains one backup and truncates a log at the size limit", async () => {
		stat.mockResolvedValue({ size: 100 });

		const stop = startHubLogRotation("/logs/hub-daemon.log", {
			maxBytes: 100,
			intervalMs: 1_000,
		});
		await vi.waitFor(() => expect(truncate).toHaveBeenCalledOnce());

		expect(copyFile).toHaveBeenCalledWith(
			"/logs/hub-daemon.log",
			"/logs/hub-daemon.log.1",
		);
		expect(copyFile.mock.invocationCallOrder[0]).toBeLessThan(
			truncate.mock.invocationCallOrder[0],
		);
		stop();
	});

	it("leaves logs below the size limit unchanged", async () => {
		stat.mockResolvedValue({ size: 99 });

		const stop = startHubLogRotation("/logs/hub-daemon.log", {
			maxBytes: 100,
		});
		await vi.waitFor(() => expect(stat).toHaveBeenCalledOnce());

		expect(copyFile).not.toHaveBeenCalled();
		expect(truncate).not.toHaveBeenCalled();
		stop();
	});

	it("keeps checking after a filesystem error", async () => {
		stat
			.mockRejectedValueOnce(new Error("busy"))
			.mockResolvedValueOnce({ size: 100 });

		const stop = startHubLogRotation("/logs/hub-daemon.log", {
			maxBytes: 100,
			intervalMs: 1_000,
		});
		await vi.waitFor(() => expect(stat).toHaveBeenCalledOnce());
		await vi.advanceTimersByTimeAsync(1_000);
		await vi.waitFor(() => expect(truncate).toHaveBeenCalledOnce());

		stop();
	});
});
