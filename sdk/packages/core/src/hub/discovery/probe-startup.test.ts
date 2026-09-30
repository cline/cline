import { afterEach, describe, expect, it, vi } from "vitest";

const { probeHubServer } = vi.hoisted(() => ({ probeHubServer: vi.fn() }));
vi.mock(".", () => ({ probeHubServer }));

import { probeHubForStartup } from "./probe-startup";

afterEach(() => {
	vi.useRealTimers();
	vi.resetAllMocks();
});

describe("startup probe policy", () => {
	it.each([
		"timeout",
		"starting",
	])("retries a %s Hub and reuses it when it answers", async (status) => {
		const hub = { url: "ws://127.0.0.1:25463/hub" };
		probeHubServer
			.mockResolvedValueOnce({ status })
			.mockResolvedValue({ status: "healthy", hub });
		await expect(probeHubForStartup(hub.url)).resolves.toEqual(hub);
		expect(probeHubServer).toHaveBeenCalledTimes(2);
	});

	it("bounds retries without declaring the Hub absent", async () => {
		probeHubServer.mockResolvedValue({ status: "timeout" });
		await expect(
			probeHubForStartup("ws://127.0.0.1:25463/hub", {
				deadline: Date.now() + 20,
			}),
		).rejects.toThrow("left unchanged");
	});

	it("cancels while waiting to retry", async () => {
		const controller = new AbortController();
		probeHubServer.mockImplementation(async () => {
			controller.abort();
			return { status: "timeout" };
		});
		await expect(
			probeHubForStartup("ws://127.0.0.1:25463/hub", {
				signal: controller.signal,
			}),
		).rejects.toThrow();
		expect(probeHubServer).toHaveBeenCalledTimes(1);
	});

	it("does not treat an invalid response as an absent Hub", async () => {
		probeHubServer.mockResolvedValue({ status: "invalid-response" });
		await expect(
			probeHubForStartup("ws://127.0.0.1:25463/hub"),
		).rejects.toThrow("invalid health response");
	});
});
