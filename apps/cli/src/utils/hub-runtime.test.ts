import { afterEach, describe, expect, it, vi } from "vitest";

const { mockEnsureDetachedHubServer, mockRestartQueuedConnectorsForHub } =
	vi.hoisted(() => ({
		mockEnsureDetachedHubServer: vi.fn(),
		mockRestartQueuedConnectorsForHub: vi.fn(async () => ({
			restarted: 0,
			remaining: 0,
		})),
	}));

vi.mock("@cline/core", () => ({
	createHubServerUrl: (host: string, port: number, pathname: string) =>
		`ws://${host}:${port}${pathname}`,
	ensureDetachedHubServer: mockEnsureDetachedHubServer,
	resolveDefaultHubHost: () => "127.0.0.1",
	resolveDefaultHubPort: () => 25463,
	resolveHubEndpointOptions: () => ({
		host: "127.0.0.1",
		port: 25463,
		pathname: "/hub",
	}),
}));

vi.mock("../connectors/restart", () => ({
	restartQueuedConnectorsForHub: mockRestartQueuedConnectorsForHub,
}));

import { ensureCliHubServer } from "./hub-runtime";

describe("ensureCliHubServer", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("drains the connector restart queue after ensuring the hub", async () => {
		mockEnsureDetachedHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "token",
		});

		const resolution = await ensureCliHubServer("/workspace");

		expect(resolution.url).toBe("ws://127.0.0.1:25463/hub");
		expect(mockRestartQueuedConnectorsForHub).toHaveBeenCalledWith(
			"ws://127.0.0.1:25463/hub",
			expect.any(Object),
		);
	});

	it("returns the hub resolution even when draining the queue fails", async () => {
		mockEnsureDetachedHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "token",
		});
		mockRestartQueuedConnectorsForHub.mockRejectedValueOnce(
			new Error("queue unreadable"),
		);

		const resolution = await ensureCliHubServer("/workspace");

		expect(resolution.url).toBe("ws://127.0.0.1:25463/hub");
	});
});
