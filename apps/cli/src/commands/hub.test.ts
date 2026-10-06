import { afterEach, describe, expect, it, vi } from "vitest";

const {
	mockClearHubDiscovery,
	mockEnsureDetachedHubServer,
	mockEnsureLoginShellPath,
	mockLocalHubHasNoActiveSessions,
	mockProbeHubServer,
	mockReadHubDiscovery,
	mockRequestHubDrain,
	mockResolveProductionHubOwnerContext,
	mockResolveSharedHubOwnerContext,
	mockStopLocalHubServerGracefully,
} = vi.hoisted(() => ({
	mockClearHubDiscovery: vi.fn(),
	mockEnsureDetachedHubServer: vi.fn(),
	mockEnsureLoginShellPath: vi.fn(async () => undefined),
	mockLocalHubHasNoActiveSessions: vi.fn(),
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
}));

vi.mock("@cline/core", () => ({
	clearHubDiscovery: mockClearHubDiscovery,
	ensureDetachedHubServer: mockEnsureDetachedHubServer,
	ensureLoginShellPath: mockEnsureLoginShellPath,
	localHubHasNoActiveSessions: mockLocalHubHasNoActiveSessions,
	probeHubServer: mockProbeHubServer,
	readHubDiscovery: mockReadHubDiscovery,
	requestHubDrain: mockRequestHubDrain,
	resolveProductionHubOwnerContext: mockResolveProductionHubOwnerContext,
	resolveSharedHubOwnerContext: mockResolveSharedHubOwnerContext,
	stopLocalHubServerGracefully: mockStopLocalHubServerGracefully,
}));

import { version as cliVersion } from "../../package.json";
import { createHubCommand } from "./hub";

const originalBuildEnv = process.env.CLINE_BUILD_ENV;

describe("createHubCommand", () => {
	afterEach(() => {
		vi.clearAllMocks();
		vi.restoreAllMocks();
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

	it("replaces an idle hub with upgrade --wait 0 instead of skipping the idle check", async () => {
		mockReadHubDiscovery.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "token",
		});
		mockRequestHubDrain.mockResolvedValue(true);
		mockLocalHubHasNoActiveSessions.mockResolvedValue(true);
		mockStopLocalHubServerGracefully.mockResolvedValue(true);
		mockEnsureDetachedHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "new-token",
		});

		const { cmd, output, errors, exitCode } = createCommand();
		await cmd.parseAsync(["upgrade", "--wait", "0"], { from: "user" });

		expect(errors).toEqual([]);
		expect(exitCode()).toBe(0);
		expect(mockLocalHubHasNoActiveSessions).toHaveBeenCalled();
		expect(mockStopLocalHubServerGracefully).toHaveBeenCalled();
		expect(mockEnsureDetachedHubServer).toHaveBeenCalled();
		// The drain was never lifted manually: the drained hub was replaced.
		expect(mockRequestHubDrain).toHaveBeenCalledTimes(1);
		expect(JSON.parse(output[0] || "")).toEqual({
			upgraded: true,
			url: "ws://127.0.0.1:25463/hub",
		});
	});

	it("un-drains the hub when upgrade aborts because sessions are still active", async () => {
		mockReadHubDiscovery.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "token",
		});
		mockRequestHubDrain.mockResolvedValue(true);
		mockLocalHubHasNoActiveSessions.mockResolvedValue(false);

		const { cmd, errors, exitCode } = createCommand();
		await cmd.parseAsync(["upgrade", "--wait", "0"], { from: "user" });

		expect(exitCode()).toBe(1);
		expect(errors[0]).toContain("still serving sessions");
		expect(mockStopLocalHubServerGracefully).not.toHaveBeenCalled();
		expect(mockEnsureDetachedHubServer).not.toHaveBeenCalled();
		expect(mockRequestHubDrain).toHaveBeenCalledTimes(2);
		expect(mockRequestHubDrain).toHaveBeenLastCalledWith(
			"ws://127.0.0.1:25463/hub",
			"token",
			"cline hub upgrade aborted",
			{ off: true },
		);
	});

	it("un-drains and aborts upgrade when authenticated shutdown fails", async () => {
		mockReadHubDiscovery.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "token",
		});
		mockRequestHubDrain.mockResolvedValue(true);
		mockLocalHubHasNoActiveSessions.mockResolvedValue(true);
		mockStopLocalHubServerGracefully.mockResolvedValue(false);
		const { cmd, errors, exitCode } = createCommand();
		await cmd.parseAsync(["upgrade", "--wait", "0"], { from: "user" });
		expect(exitCode()).toBe(1);
		expect(errors).toEqual(["Hub shutdown failed; upgrade aborted."]);
		expect(mockClearHubDiscovery).not.toHaveBeenCalled();
		expect(mockEnsureDetachedHubServer).not.toHaveBeenCalled();
		expect(mockRequestHubDrain).toHaveBeenLastCalledWith(
			"ws://127.0.0.1:25463/hub",
			"token",
			"cline hub upgrade aborted",
			{ off: true },
		);
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
		expect(mockRequestHubDrain).not.toHaveBeenCalled();
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

	it("does not signal a stale discovery PID when authenticated shutdown fails", async () => {
		mockReadHubDiscovery.mockResolvedValue({
			url: "ws://127.0.0.1:25466/hub",
			pid: 50174,
			authToken: "expired-token",
		});
		mockStopLocalHubServerGracefully.mockResolvedValue(false);
		const kill = vi.spyOn(process, "kill").mockReturnValue(true);
		const { cmd, output, exitCode } = createCommand();
		await cmd.parseAsync(["stop"], { from: "user" });
		expect(kill).toHaveBeenCalledExactlyOnceWith(50174, 0);
		expect(exitCode()).toBe(1);
		expect(mockClearHubDiscovery).not.toHaveBeenCalled();
		expect(JSON.parse(output[0] || "")).toEqual({ stopped: false });
	});

	it("succeeds when the hub has already exited", async () => {
		mockReadHubDiscovery.mockResolvedValue({
			url: "ws://127.0.0.1:25466/hub",
			pid: 50174,
		});
		mockStopLocalHubServerGracefully.mockResolvedValue(false);
		vi.spyOn(process, "kill").mockImplementation(() => {
			throw Object.assign(new Error("no such process"), { code: "ESRCH" });
		});
		const { cmd, output, exitCode } = createCommand();
		await cmd.parseAsync(["stop"], { from: "user" });
		expect(exitCode()).toBe(0);
		expect(JSON.parse(output[0] || "")).toEqual({ stopped: true });
		expect(mockClearHubDiscovery).toHaveBeenCalled();
	});

	it.each([
		Object.assign(new Error("permission denied"), { code: "EACCES" }),
		new Error("Invalid JSON in Hub discovery record"),
		new Error("Invalid Hub discovery record"),
	])("fails stop when discovery cannot be read: %s", async (error) => {
		mockReadHubDiscovery.mockRejectedValue(error);
		const { cmd, output, errors, exitCode } = createCommand();
		await cmd.parseAsync(["stop"], { from: "user" });
		expect(exitCode()).toBe(1);
		expect(output).toEqual([]);
		expect(errors).toEqual([error.message]);
		expect(mockStopLocalHubServerGracefully).not.toHaveBeenCalled();
		expect(mockClearHubDiscovery).not.toHaveBeenCalled();
	});

	it("succeeds when there is no discovery record", async () => {
		mockReadHubDiscovery.mockResolvedValue(undefined);
		const { cmd, output, exitCode } = createCommand();
		await cmd.parseAsync(["stop"], { from: "user" });
		expect(exitCode()).toBe(0);
		expect(JSON.parse(output[0] || "")).toEqual({ stopped: true });
		expect(mockStopLocalHubServerGracefully).not.toHaveBeenCalled();
	});

	it("does not mistake an inaccessible process for an exited hub", async () => {
		mockReadHubDiscovery.mockResolvedValue({
			url: "ws://127.0.0.1:25466/hub",
			pid: 50174,
		});
		mockStopLocalHubServerGracefully.mockResolvedValue(false);
		vi.spyOn(process, "kill").mockImplementation(() => {
			throw Object.assign(new Error("not permitted"), { code: "EPERM" });
		});
		const { cmd, exitCode } = createCommand();
		await cmd.parseAsync(["stop"], { from: "user" });
		expect(exitCode()).toBe(1);
		expect(mockClearHubDiscovery).not.toHaveBeenCalled();
	});

	it("replaces a hub that exits before upgrade can shut it down", async () => {
		mockReadHubDiscovery.mockResolvedValue({
			url: "ws://127.0.0.1:25466/hub",
			pid: 50174,
			authToken: "token",
		});
		mockRequestHubDrain.mockResolvedValue(false);
		mockLocalHubHasNoActiveSessions.mockResolvedValue(true);
		mockStopLocalHubServerGracefully.mockResolvedValue(false);
		mockEnsureDetachedHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25466/hub",
		});
		vi.spyOn(process, "kill").mockImplementation(() => {
			throw Object.assign(new Error("no such process"), { code: "ESRCH" });
		});
		const { cmd, output, errors, exitCode } = createCommand();
		await cmd.parseAsync(["upgrade", "--wait", "0"], { from: "user" });
		expect(exitCode()).toBe(0);
		expect(errors).toEqual([]);
		expect(mockClearHubDiscovery).toHaveBeenCalled();
		expect(mockEnsureDetachedHubServer).toHaveBeenCalled();
		expect(JSON.parse(output[0] || "")).toEqual({
			upgraded: true,
			url: "ws://127.0.0.1:25466/hub",
		});
	});

	it("prints the hub URL by default from ensure", async () => {
		mockEnsureDetachedHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "token",
		});

		const { cmd, output, exitCode } = createCommand();
		await cmd.parseAsync(["ensure"], { from: "user" });

		expect(exitCode()).toBe(0);
		expect(output).toEqual(["ws://127.0.0.1:25463/hub"]);
		expect(mockEnsureLoginShellPath).not.toHaveBeenCalled();
	});

	it("starts a dedicated hub for programmatic clients with ensure --json", async () => {
		const originalDiscoveryPath = process.env.CLINE_HUB_DISCOVERY_PATH;
		mockEnsureDetachedHubServer.mockImplementation(async () => {
			expect(process.env.CLINE_HUB_DISCOVERY_PATH).toBe(
				"/home/dev/.cline/data/remote/owner.json",
			);
			return { url: "ws://127.0.0.1:41000/hub", authToken: "remote-token" };
		});

		try {
			const { cmd, output, errors, exitCode } = createCommand();
			await cmd.parseAsync(
				[
					"ensure",
					"--cwd",
					"/home/dev",
					"--discovery-path",
					"/home/dev/.cline/data/remote/owner.json",
					"--host",
					"127.0.0.1",
					"--port",
					"0",
					"--pathname",
					"/hub",
					"--json",
					"--allow-port-fallback",
					"--no-connectors",
					"--login-shell-path",
				],
				{ from: "user" },
			);

			expect(errors).toEqual([]);
			expect(exitCode()).toBe(0);
			expect(mockEnsureDetachedHubServer).toHaveBeenCalledWith("/home/dev", {
				host: "127.0.0.1",
				port: 0,
				pathname: "/hub",
				allowPortFallback: true,
				manageConnectors: false,
				beforeSpawn: expect.any(Function),
			});
			// PATH resolution is deferred until a new daemon is actually spawned.
			expect(mockEnsureLoginShellPath).not.toHaveBeenCalled();
			await mockEnsureDetachedHubServer.mock.calls[0]?.[1]?.beforeSpawn?.();
			expect(mockEnsureLoginShellPath).toHaveBeenCalledTimes(1);
			expect(JSON.parse(output[0] || "")).toEqual({
				url: "ws://127.0.0.1:41000/hub",
				authToken: "remote-token",
				cwd: "/home/dev",
				platform: process.platform,
				arch: process.arch,
			});
		} finally {
			if (originalDiscoveryPath === undefined) {
				delete process.env.CLINE_HUB_DISCOVERY_PATH;
			} else {
				process.env.CLINE_HUB_DISCOVERY_PATH = originalDiscoveryPath;
			}
		}
	});
});
