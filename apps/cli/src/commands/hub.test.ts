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
	mockEnsureLoginShellPath: vi.fn(async () => ({
		status: "applied" as const,
		pathEntries: 7,
		shell: "/bin/zsh",
	})),
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

	it("prints only the hub URL by default", async () => {
		mockEnsureDetachedHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "token",
		});

		const { cmd, output, exitCode } = createCommand();
		await cmd.parseAsync(["ensure"], { from: "user" });

		expect(exitCode()).toBe(0);
		expect(output[0]).toBe("ws://127.0.0.1:25463/hub");
	});

	it("prints a full connection record with ensure --json", async () => {
		mockEnsureDetachedHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:38211/hub",
			authToken: "token",
		});

		const { cmd, output, exitCode } = createCommand();
		await cmd.parseAsync(["ensure", "--json"], { from: "user" });

		expect(exitCode()).toBe(0);
		// Port and pathname are split out so a caller that tunnels to the hub
		// does not have to re-parse the URL.
		expect(JSON.parse(output[0] || "")).toEqual({
			url: "ws://127.0.0.1:38211/hub",
			authToken: "token",
			port: 38211,
			pathname: "/hub",
		});
	});

	it("isolates an ensured hub behind its own discovery record", async () => {
		const originalDiscoveryPath = process.env.CLINE_HUB_DISCOVERY_PATH;
		mockEnsureDetachedHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:38211/hub",
			authToken: "token",
		});

		try {
			const { cmd, exitCode } = createCommand();
			await cmd.parseAsync(
				[
					"ensure",
					"--json",
					"--discovery-path",
					"/home/dev/.cline/data/remote/session.json",
					"--allow-port-fallback",
					"--no-connectors",
				],
				{ from: "user" },
			);

			expect(exitCode()).toBe(0);
			expect(process.env.CLINE_HUB_DISCOVERY_PATH).toBe(
				"/home/dev/.cline/data/remote/session.json",
			);
			// A session-scoped hub must not adopt the account's connectors, and
			// must be free to take another port rather than retire the hub
			// already on the default one.
			expect(mockEnsureDetachedHubServer).toHaveBeenCalledWith(
				process.cwd(),
				expect.objectContaining({
					allowPortFallback: true,
					manageConnectors: false,
				}),
			);
		} finally {
			if (originalDiscoveryPath === undefined) {
				delete process.env.CLINE_HUB_DISCOVERY_PATH;
			} else {
				process.env.CLINE_HUB_DISCOVERY_PATH = originalDiscoveryPath;
			}
		}
	});

	it("resolves the login shell PATH before starting the hub only when asked", async () => {
		mockEnsureDetachedHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "token",
		});

		const plain = createCommand();
		await plain.cmd.parseAsync(["ensure"], { from: "user" });
		expect(mockEnsureLoginShellPath).not.toHaveBeenCalled();

		// Over SSH the hub would otherwise inherit the minimal PATH of a
		// non-interactive shell, and so would everything a session spawns.
		const withPath = createCommand();
		await withPath.cmd.parseAsync(["ensure", "--login-shell-path"], {
			from: "user",
		});
		expect(mockEnsureLoginShellPath).toHaveBeenCalledOnce();
	});

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
});
