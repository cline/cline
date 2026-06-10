import { afterEach, describe, expect, it, vi } from "vitest";

const {
	mockClearHubDiscovery,
	mockEnsureDetachedHubServer,
	mockProbeHubServer,
	mockReadHubDiscovery,
	mockResolveProductionHubOwnerContext,
	mockResolveSharedHubOwnerContext,
	mockRestartQueuedConnectorsForHub,
	mockStopLocalHubServerGracefully,
	mockStopConnectorsForHubs,
} = vi.hoisted(() => ({
	mockClearHubDiscovery: vi.fn(),
	mockEnsureDetachedHubServer: vi.fn(),
	mockProbeHubServer: vi.fn(),
	mockReadHubDiscovery: vi.fn(),
	mockResolveProductionHubOwnerContext: vi.fn(() => ({
		ownerId: "hub-production",
		discoveryPath: "/tmp/cline-data/locks/hub/production.json",
	})),
	mockResolveSharedHubOwnerContext: vi.fn(() => ({
		ownerId: "hub-owner",
		discoveryPath: "/tmp/cline-data/locks/hub/owners/hub-owner.json",
	})),
	mockRestartQueuedConnectorsForHub: vi.fn(async () => ({
		restarted: 0,
		remaining: 0,
	})),
	mockStopLocalHubServerGracefully: vi.fn(),
	mockStopConnectorsForHubs: vi.fn(async () => ({
		stoppedProcesses: 0,
		queuedRestarts: 0,
	})),
}));

vi.mock("@cline/core", () => ({
	clearHubDiscovery: mockClearHubDiscovery,
	ensureDetachedHubServer: mockEnsureDetachedHubServer,
	probeHubServer: mockProbeHubServer,
	readHubDiscovery: mockReadHubDiscovery,
	resolveProductionHubOwnerContext: mockResolveProductionHubOwnerContext,
	resolveSharedHubOwnerContext: mockResolveSharedHubOwnerContext,
	stopLocalHubServerGracefully: mockStopLocalHubServerGracefully,
}));

vi.mock("../connectors/restart", () => ({
	restartQueuedConnectorsForHub: mockRestartQueuedConnectorsForHub,
	stopConnectorsForHubs: mockStopConnectorsForHubs,
}));

import { createHubCommand } from "./hub";

const originalBuildEnv = process.env.CLINE_BUILD_ENV;

describe("createHubCommand", () => {
	afterEach(() => {
		vi.clearAllMocks();
		if (originalBuildEnv === undefined) {
			delete process.env.CLINE_BUILD_ENV;
		} else {
			process.env.CLINE_BUILD_ENV = originalBuildEnv;
		}
	});

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

	it("queues associated connectors on stop", async () => {
		mockReadHubDiscovery.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			port: 25463,
			pid: 50174,
		});
		mockStopLocalHubServerGracefully.mockResolvedValue(true);
		mockStopConnectorsForHubs.mockResolvedValue({
			stoppedProcesses: 2,
			queuedRestarts: 2,
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

		await cmd.parseAsync(["stop"], { from: "user" });

		expect(exitCode).toBe(0);
		expect(mockStopConnectorsForHubs).toHaveBeenCalledWith(
			["ws://127.0.0.1:25463/hub"],
			expect.any(Object),
		);
		expect(JSON.parse(output.at(-1) || "")).toMatchObject({
			stopped: true,
			stoppedConnectorProcesses: 2,
			queuedConnectorRestarts: 2,
		});
	});

	it("restarts queued connectors on start", async () => {
		mockEnsureDetachedHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "token",
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

		await cmd.parseAsync(["start"], { from: "user" });

		expect(exitCode).toBe(0);
		expect(mockRestartQueuedConnectorsForHub).toHaveBeenCalledWith(
			"ws://127.0.0.1:25463/hub",
			expect.any(Object),
		);
		expect(output.at(-1)).toBe("ws://127.0.0.1:25463/hub");
	});

	it("passes the selected owner to graceful stop", async () => {
		process.env.CLINE_BUILD_ENV = "development";
		mockReadHubDiscovery.mockResolvedValue({
			url: "ws://127.0.0.1:25466/hub",
			port: 25466,
			pid: 50174,
		});
		mockStopLocalHubServerGracefully.mockResolvedValue(true);

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

		await cmd.parseAsync(["stop"], { from: "user" });

		expect(exitCode).toBe(0);
		expect(mockStopLocalHubServerGracefully).toHaveBeenCalledWith({
			ownerId: "hub-owner",
			discoveryPath: "/tmp/cline-data/locks/hub/owners/hub-owner.json",
		});
		expect(JSON.parse(output[0] || "")).toMatchObject({ stopped: true });
	});
});
