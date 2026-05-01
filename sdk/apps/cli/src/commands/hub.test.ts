import { describe, expect, it, vi } from "vitest";

const {
	mockClearHubDiscovery,
	mockEnsureDetachedHubServer,
	mockProbeHubServer,
	mockReadHubDiscovery,
	mockResolveSharedHubOwnerContext,
	mockStopLocalHubServerGracefully,
} = vi.hoisted(() => ({
	mockClearHubDiscovery: vi.fn(),
	mockEnsureDetachedHubServer: vi.fn(),
	mockProbeHubServer: vi.fn(),
	mockReadHubDiscovery: vi.fn(),
	mockResolveSharedHubOwnerContext: vi.fn(() => ({
		ownerId: "hub-owner",
		discoveryPath: "/tmp/cline-data/locks/hub/owners/hub-owner.json",
	})),
	mockStopLocalHubServerGracefully: vi.fn(),
}));

vi.mock("@clinebot/core", () => ({
	clearHubDiscovery: mockClearHubDiscovery,
	ensureDetachedHubServer: mockEnsureDetachedHubServer,
	probeHubServer: mockProbeHubServer,
	readHubDiscovery: mockReadHubDiscovery,
	resolveSharedHubOwnerContext: mockResolveSharedHubOwnerContext,
	stopLocalHubServerGracefully: mockStopLocalHubServerGracefully,
}));

import { createHubCommand } from "./hub";

describe("createHubCommand", () => {
	it("includes uptime in hub status output", async () => {
		vi.spyOn(Date, "now").mockReturnValue(
			new Date("2026-01-01T00:01:05.000Z").getTime(),
		);
		mockReadHubDiscovery.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			port: 25463,
			pid: 50174,
			startedAt: "2026-01-01T00:00:00.000Z",
		});
		mockProbeHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			port: 25463,
			pid: 50174,
			startedAt: "2026-01-01T00:00:00.000Z",
		});

		const output: string[] = [];
		let exitCode = 0;
		const cmd = createHubCommand(
			{
				writeln: (text) => {
					output.push(text ?? "");
				},
				writeErr: () => {},
			},
			(code) => {
				exitCode = code;
			},
		);

		await cmd.parseAsync(["status"], { from: "user" });

		expect(exitCode).toBe(0);
		expect(JSON.parse(output[0] || "")).toMatchObject({
			running: true,
			url: "ws://127.0.0.1:25463/hub",
			pid: 50174,
			startedAt: "2026-01-01T00:00:00.000Z",
			uptime: "1m 5s",
		});
	});
});
