import { afterEach, describe, expect, it, vi } from "vitest";

const {
	mockClearHubDiscovery,
	mockEnsureDetachedHubServer,
	mockProbeHubServer,
	mockReadHubDiscovery,
	mockRequestHubDrain,
	mockResolveProductionHubOwnerContext,
	mockResolveSharedHubOwnerContext,
	mockStopLocalHubServerGracefully,
	mockUpgradeManagedHub,
} = vi.hoisted(() => ({
	mockClearHubDiscovery: vi.fn(),
	mockEnsureDetachedHubServer: vi.fn(),
	mockProbeHubServer: vi.fn(),
	mockReadHubDiscovery: vi.fn(),
	mockRequestHubDrain: vi.fn(),
	mockResolveProductionHubOwnerContext: vi.fn(() => ({
		ownerId: "hub-production",
		discoveryPath: "/tmp/cline-data/locks/hub/production.json",
	})),
	mockResolveSharedHubOwnerContext: vi.fn(() => ({
		ownerId: "hub-owner",
		discoveryPath: "/tmp/cline-data/locks/hub/owners/hub-owner.json",
	})),
	mockStopLocalHubServerGracefully: vi.fn(),
	mockUpgradeManagedHub: vi.fn(),
}));

vi.mock("@cline/core", () => ({
	clearHubDiscovery: mockClearHubDiscovery,
	ensureDetachedHubServer: mockEnsureDetachedHubServer,
	probeHubServer: mockProbeHubServer,
	readHubDiscovery: mockReadHubDiscovery,
	requestHubDrain: mockRequestHubDrain,
	resolveProductionHubOwnerContext: mockResolveProductionHubOwnerContext,
	resolveSharedHubOwnerContext: mockResolveSharedHubOwnerContext,
	stopLocalHubServerGracefully: mockStopLocalHubServerGracefully,
	upgradeManagedHub: mockUpgradeManagedHub,
}));

import { version as cliVersion } from "../../package.json";
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
			coreVersion: "0.0.62",
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
			cliVersion,
			coreVersion: "0.0.62",
		});
	});

	function createCommand() {
		const output: string[] = [];
		const errors: string[] = [];
		let exitCode = 0;
		const cmd = createHubCommand(
			{
				writeln: (text) => {
					output.push(text ?? "");
				},
				writeErr: (text) => {
					errors.push(text);
				},
			},
			(code) => {
				exitCode = code;
			},
		);
		return {
			cmd,
			output,
			errors,
			exitCode: () => exitCode,
		};
	}

	it("sends an un-drain request with drain --off", async () => {
		mockReadHubDiscovery.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "token",
		});
		mockRequestHubDrain.mockResolvedValue(true);

		const { cmd, output, exitCode } = createCommand();
		await cmd.parseAsync(["drain", "--off"], { from: "user" });

		expect(exitCode()).toBe(0);
		expect(mockRequestHubDrain).toHaveBeenCalledWith(
			"ws://127.0.0.1:25463/hub",
			"token",
			"cline hub drain --off",
			{ off: true },
		);
		expect(JSON.parse(output[0] || "")).toEqual({
			draining: false,
			url: "ws://127.0.0.1:25463/hub",
		});
	});

	it("drains without the off flag by default", async () => {
		mockReadHubDiscovery.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "token",
		});
		mockRequestHubDrain.mockResolvedValue(true);

		const { cmd, output, exitCode } = createCommand();
		await cmd.parseAsync(["drain"], { from: "user" });

		expect(exitCode()).toBe(0);
		expect(mockRequestHubDrain).toHaveBeenCalledWith(
			"ws://127.0.0.1:25463/hub",
			"token",
			"cline hub drain",
			{ off: false },
		);
		expect(JSON.parse(output[0] || "")).toEqual({
			draining: true,
			url: "ws://127.0.0.1:25463/hub",
		});
	});

	it("delegates upgrade to the shared replacement policy with the wait window and endpoint flags", async () => {
		mockUpgradeManagedHub.mockResolvedValue({
			outcome: "replaced",
			url: "ws://127.0.0.1:26000/hub",
			authToken: "new-token",
			activeSessionCount: 0,
		});

		const { cmd, output, errors, exitCode } = createCommand();
		await cmd.parseAsync(["--port", "26000", "upgrade", "--wait", "7"], {
			from: "user",
		});

		expect(errors).toEqual([]);
		expect(exitCode()).toBe(0);
		expect(mockUpgradeManagedHub).toHaveBeenCalledWith(
			expect.objectContaining({
				waitForIdleMs: 7_000,
				reason: "cline hub upgrade",
				endpoint: expect.objectContaining({ port: 26000 }),
			}),
		);
		expect(JSON.parse(output[0] || "")).toEqual({
			upgraded: true,
			url: "ws://127.0.0.1:26000/hub",
		});
	});

	it("reports failure without replacing when the hub stays busy through the wait window", async () => {
		mockUpgradeManagedHub.mockResolvedValue({
			outcome: "still_busy",
			url: "ws://127.0.0.1:25463/hub",
			activeSessionCount: 2,
		});

		const { cmd, errors, exitCode } = createCommand();
		await cmd.parseAsync(["upgrade", "--wait", "0"], { from: "user" });

		expect(exitCode()).toBe(1);
		expect(errors[0]).toContain("still serving sessions");
	});

	it("refuses to downgrade a hub newer than this CLI", async () => {
		mockUpgradeManagedHub.mockResolvedValue({
			outcome: "hub_not_older",
			url: "ws://127.0.0.1:25463/hub",
		});

		const { cmd, errors, exitCode } = createCommand();
		await cmd.parseAsync(["upgrade"], { from: "user" });

		expect(exitCode()).toBe(1);
		expect(errors[0]).toContain("newer than this CLI");
	});

	it("surfaces upgrade errors (refused drain, unstoppable hub) with a non-zero exit", async () => {
		mockUpgradeManagedHub.mockRejectedValue(
			new Error(
				"The running Cline Hub at ws://127.0.0.1:25463/hub did not accept a drain request, so it was not replaced.",
			),
		);

		const { cmd, errors, exitCode } = createCommand();
		await cmd.parseAsync(["upgrade"], { from: "user" });

		expect(exitCode()).toBe(1);
		expect(errors[0]).toContain("did not accept a drain request");
	});

	it("rejects a non-numeric upgrade --wait instead of treating it as an expired deadline", async () => {
		mockReadHubDiscovery.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "token",
		});

		const { cmd } = createCommand();
		cmd.configureOutput({ writeErr: () => {} });
		for (const sub of cmd.commands) {
			sub.configureOutput({ writeErr: () => {} });
		}
		await expect(
			cmd.parseAsync(["upgrade", "--wait", "soon"], { from: "user" }),
		).rejects.toThrow("--wait requires a non-negative number of seconds.");
		expect(mockUpgradeManagedHub).not.toHaveBeenCalled();
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
		expect(JSON.parse(output[0] || "")).toEqual({ stopped: true });
	});
});
