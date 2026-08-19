import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	spawn,
	closeSync,
	mkdirSync,
	openSync,
	rememberRecoverableLocalHubUrl,
	verifyHubConnection,
	localHubHasNoActiveSessions,
	resolveProductionHubOwnerContext,
	resolveSharedHubOwnerContext,
	createHubServerUrl,
	clearHubDiscovery,
	getManagedHubCompatibility,
	isManagedHubReusable,
	probeHubServer,
	requestHubShutdown,
	readHubDiscovery,
	resolveClineDataDir,
	resolveHubBuildId,
	withHubStartupLock,
	writeHubDiscovery,
	CLINE_RUN_AS_HUB_DAEMON_ENV,
} = vi.hoisted(() => ({
	spawn: vi.fn(() => ({ unref: vi.fn() })),
	closeSync: vi.fn(),
	mkdirSync: vi.fn(),
	openSync: vi.fn(() => 17),
	rememberRecoverableLocalHubUrl: vi.fn((url: string) => url),
	verifyHubConnection: vi.fn(),
	// Idle by default, so existing replacement cases are unaffected.
	localHubHasNoActiveSessions: vi.fn(async () => true),
	resolveProductionHubOwnerContext: vi.fn(() => ({
		discoveryPath: "/tmp/hub-discovery.json",
	})),
	resolveSharedHubOwnerContext: vi.fn(() => ({
		discoveryPath: "/tmp/hub-discovery.json",
	})),
	createHubServerUrl: vi.fn(
		(host: string, port: number, pathname: string) =>
			`ws://${host}:${port}${pathname}`,
	),
	clearHubDiscovery: vi.fn(async () => undefined),
	getManagedHubCompatibility: vi.fn(
		(record: { protocolVersion?: string; buildId?: string }) => ({
			compatible:
				record.protocolVersion === "v1" && record.buildId === "current-build",
		}),
	),
	// Mirrors the real semantics: same build, or a strictly newer build epoch.
	isManagedHubReusable: vi.fn(
		(record: {
			protocolVersion?: string;
			buildId?: string;
			buildEpochMs?: number;
		}) =>
			record.protocolVersion === "v1" &&
			(record.buildId === "current-build" ||
				(record.buildEpochMs ?? 0) > 1_000_000),
	),
	probeHubServer: vi.fn(),
	requestHubShutdown: vi.fn(async () => true),
	readHubDiscovery: vi.fn(),
	resolveClineDataDir: vi.fn(() => "/tmp/cline-data"),
	resolveHubBuildId: vi.fn(() => "current-build"),
	withHubStartupLock: vi.fn(
		async (_discoveryPath: string, callback: () => Promise<unknown>) =>
			await callback(),
	),
	writeHubDiscovery: vi.fn(),
	CLINE_RUN_AS_HUB_DAEMON_ENV: "CLINE_RUN_AS_HUB_DAEMON",
}));

const originalRunAsHubDaemon = process.env[CLINE_RUN_AS_HUB_DAEMON_ENV];
const originalConnectorCliLaunch = process.env.CLINE_CONNECTOR_CLI_LAUNCH;

vi.mock("node:child_process", () => ({
	spawn,
}));

vi.mock("node:fs", () => ({
	closeSync,
	mkdirSync,
	openSync,
}));

vi.mock("@cline/shared", () => ({
	CLINE_RUN_AS_HUB_DAEMON_ENV,
	CLINE_HUB_PORT: 25463,
	CLINE_HUB_DEV_PORT: 25466,
	isHubProtocolCompatible: (record: { protocolVersion?: string }) => ({
		compatible: record.protocolVersion === "v1",
	}),
	isHubDaemonProcess: (env: NodeJS.ProcessEnv = process.env) =>
		env[CLINE_RUN_AS_HUB_DAEMON_ENV] === "1",
	resolveClineBuildEnv: () => "production",
	withResolvedClineBuildEnv: (env: NodeJS.ProcessEnv) => env,
}));

vi.mock("../client", () => ({
	localHubHasNoActiveSessions,
	rememberRecoverableLocalHubUrl,
	requestHubShutdown,
	verifyHubConnection,
}));

vi.mock("../discovery/workspace", () => ({
	resolveProductionHubOwnerContext,
	resolveSharedHubOwnerContext,
}));

vi.mock("../discovery", () => ({
	clearHubDiscovery,
	createHubServerUrl,
	getManagedHubCompatibility,
	isManagedHubReusable,
	probeHubServer,
	readHubDiscovery,
	resolveClineDataDir,
	resolveHubBuildId,
	withHubStartupLock,
	writeHubDiscovery,
}));

describe("ensureDetachedHubServer", () => {
	const fetchMock = vi.fn(async () => ({ ok: true }));

	beforeEach(async () => {
		// The retire circuit breaker is module state keyed by Hub URL, and these
		// cases all retire the same URL.
		const { __test__ } = await import(".");
		__test__.resetRetireAttempts();
		delete process.env[CLINE_RUN_AS_HUB_DAEMON_ENV];
		spawn.mockReset();
		spawn.mockImplementation(() => ({ unref: vi.fn() }));
		closeSync.mockReset();
		mkdirSync.mockReset();
		openSync.mockReset();
		openSync.mockImplementation(() => 17);
		rememberRecoverableLocalHubUrl.mockReset();
		rememberRecoverableLocalHubUrl.mockImplementation((url: string) => url);
		verifyHubConnection.mockReset();
		localHubHasNoActiveSessions.mockReset();
		localHubHasNoActiveSessions.mockResolvedValue(true);
		clearHubDiscovery.mockReset();
		clearHubDiscovery.mockResolvedValue(undefined);
		probeHubServer.mockReset();
		requestHubShutdown.mockReset();
		requestHubShutdown.mockResolvedValue(true);
		readHubDiscovery.mockReset();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.clearAllMocks();
		vi.unstubAllGlobals();
		if (originalRunAsHubDaemon === undefined) {
			delete process.env[CLINE_RUN_AS_HUB_DAEMON_ENV];
		} else {
			process.env[CLINE_RUN_AS_HUB_DAEMON_ENV] = originalRunAsHubDaemon;
		}
		if (originalConnectorCliLaunch === undefined) {
			delete process.env.CLINE_CONNECTOR_CLI_LAUNCH;
		} else {
			process.env.CLINE_CONNECTOR_CLI_LAUNCH = originalConnectorCliLaunch;
		}
	});

	it("does not use port 0 for default production startup", async () => {
		process.env.CLINE_CONNECTOR_CLI_LAUNCH = JSON.stringify({
			launcher: "bun",
			connectArgsPrefix: ["/workspace/apps/cli/src/index.ts", "connect"],
			cwd: "/workspace",
		});
		readHubDiscovery.mockResolvedValue(undefined);
		probeHubServer.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
			url: "ws://127.0.0.1:25463/hub",
			protocolVersion: "v1",
			buildId: "current-build",
		});
		verifyHubConnection.mockResolvedValueOnce(true);
		readHubDiscovery.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
			url: "ws://127.0.0.1:25463/hub",
			buildId: "current-build",
			authToken: "new-token",
		});

		const { ensureDetachedHubServer } = await import(".");
		const result = await ensureDetachedHubServer("/workspace");
		const spawnCalls = (spawn as unknown as { mock: { calls: unknown[][] } })
			.mock.calls;
		const spawnArgs = spawnCalls[0]?.[1] as string[] | undefined;
		const spawnOptions = spawnCalls[0]?.[2] as
			| { env?: NodeJS.ProcessEnv }
			| undefined;

		expect(result).toEqual({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "new-token",
		});
		expect(withHubStartupLock).toHaveBeenCalledWith(
			"/tmp/hub-discovery.json",
			expect.any(Function),
		);
		expect(spawn).toHaveBeenCalledOnce();
		expect(spawnArgs).toContain("--port");
		expect(spawnArgs).toContain("25463");
		expect(spawnArgs).not.toContain("0");
		expect(spawnOptions?.env?.[CLINE_RUN_AS_HUB_DAEMON_ENV]).toBe("1");
		expect(spawnOptions?.env?.CLINE_CONNECTOR_CLI_LAUNCH).toBe(
			process.env.CLINE_CONNECTOR_CLI_LAUNCH,
		);
	});

	it("retries a transient ETXTBSY spawn failure while starting the detached daemon", async () => {
		vi.useFakeTimers();
		try {
			const textFileBusy = Object.assign(
				new Error(
					"ETXTBSY: text file is busy, posix_spawn '/usr/local/bin/cline'",
				),
				{ code: "ETXTBSY" },
			);
			spawn
				.mockImplementationOnce(() => {
					throw textFileBusy;
				})
				.mockImplementationOnce(() => ({ unref: vi.fn() }));
			readHubDiscovery.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
				url: "ws://127.0.0.1:25463/hub",
				authToken: "new-token",
			});
			probeHubServer.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
				url: "ws://127.0.0.1:25463/hub",
				protocolVersion: "v1",
				buildId: "current-build",
			});
			verifyHubConnection.mockResolvedValueOnce(true);

			const { ensureDetachedHubServer } = await import(".");
			const pending = ensureDetachedHubServer("/workspace");
			await vi.runAllTimersAsync();
			const result = await pending;

			expect(result).toEqual({
				url: "ws://127.0.0.1:25463/hub",
				authToken: "new-token",
			});
			expect(spawn).toHaveBeenCalledTimes(2);
			expect(closeSync).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not spawn another detached daemon from inside the hub daemon process", async () => {
		process.env[CLINE_RUN_AS_HUB_DAEMON_ENV] = "1";

		const { spawnDetachedHubServer } = await import(".");
		spawnDetachedHubServer("/workspace");

		expect(spawn).not.toHaveBeenCalled();
		expect(openSync).not.toHaveBeenCalled();
	});

	it("does not prewarm another detached daemon from inside the hub daemon process", async () => {
		process.env[CLINE_RUN_AS_HUB_DAEMON_ENV] = "1";

		const { prewarmDetachedHubServer } = await import(".");
		prewarmDetachedHubServer("/workspace");

		expect(readHubDiscovery).not.toHaveBeenCalled();
		expect(spawn).not.toHaveBeenCalled();
	});

	it("clears stale discovery when prewarm finds an unreachable discovered hub", async () => {
		readHubDiscovery.mockResolvedValueOnce({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "old-token",
		});
		probeHubServer
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce(undefined);

		const { prewarmDetachedHubServer } = await import(".");
		prewarmDetachedHubServer("/workspace");
		await vi.waitFor(() => {
			expect(clearHubDiscovery).toHaveBeenCalledWith("/tmp/hub-discovery.json");
		});

		expect(withHubStartupLock).toHaveBeenCalledWith(
			"/tmp/hub-discovery.json",
			expect.any(Function),
		);
		expect(clearHubDiscovery.mock.invocationCallOrder[0]).toBeGreaterThan(
			probeHubServer.mock.invocationCallOrder[0],
		);
		expect(spawn).toHaveBeenCalledOnce();
	});

	it("retries a transient ETXTBSY spawn failure while prewarming the detached daemon", async () => {
		vi.useFakeTimers();
		try {
			const textFileBusy = Object.assign(
				new Error(
					"ETXTBSY: text file is busy, posix_spawn '/usr/local/bin/cline'",
				),
				{ code: "ETXTBSY" },
			);
			spawn
				.mockImplementationOnce(() => {
					throw textFileBusy;
				})
				.mockImplementationOnce(() => ({ unref: vi.fn() }));
			readHubDiscovery.mockResolvedValueOnce(undefined);
			probeHubServer.mockResolvedValueOnce(undefined);

			const { prewarmDetachedHubServer } = await import(".");
			prewarmDetachedHubServer("/workspace");
			await vi.runAllTimersAsync();

			expect(spawn).toHaveBeenCalledTimes(2);
			expect(closeSync).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it("prewarms on a fallback port when an empty-token hub cannot be retired", async () => {
		vi.useFakeTimers();
		const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
		try {
			readHubDiscovery.mockResolvedValueOnce({
				url: "ws://127.0.0.1:25463/hub",
				authToken: "",
				pid: 12345,
			});
			probeHubServer.mockResolvedValue({
				url: "ws://127.0.0.1:25463/hub",
				protocolVersion: "v1",
				buildId: "old-build",
			});

			const { prewarmDetachedHubServer } = await import(".");
			prewarmDetachedHubServer("/workspace", { allowPortFallback: true });
			await vi.runAllTimersAsync();

			const spawnArgs = ((spawn as unknown as { mock: { calls: unknown[][] } })
				.mock.calls[0]?.[1] ?? []) as string[];
			expect(requestHubShutdown).toHaveBeenCalledWith(
				"ws://127.0.0.1:25463/hub",
				"",
			);
			expect(kill).toHaveBeenCalledWith(12345, "SIGTERM");
			expect(spawn).toHaveBeenCalledOnce();
			expect(spawnArgs).toContain("--port");
			expect(spawnArgs).toContain("0");
		} finally {
			kill.mockRestore();
			vi.useRealTimers();
		}
	});

	it("retires a healthy hub from a different build and starts a replacement", async () => {
		const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
		try {
			readHubDiscovery
				.mockResolvedValueOnce({
					url: "ws://127.0.0.1:25463/hub",
					authToken: "old-token",
				})
				.mockResolvedValueOnce({
					url: "ws://127.0.0.1:25463/hub",
					authToken: "new-token",
				});
			probeHubServer
				.mockResolvedValueOnce({
					url: "ws://127.0.0.1:25463/hub",
					protocolVersion: "v1",
					buildId: "old-build",
					pid: 12345,
				})
				.mockResolvedValueOnce(undefined)
				.mockResolvedValueOnce(undefined)
				.mockResolvedValueOnce({
					url: "ws://127.0.0.1:25463/hub",
					protocolVersion: "v1",
					buildId: "current-build",
				});
			verifyHubConnection.mockResolvedValueOnce(true);

			const { ensureDetachedHubServer } = await import(".");
			const result = await ensureDetachedHubServer("/workspace");

			expect(result).toEqual({
				url: "ws://127.0.0.1:25463/hub",
				authToken: "new-token",
			});
			expect(requestHubShutdown).toHaveBeenCalledWith(
				"ws://127.0.0.1:25463/hub",
				"old-token",
			);
			expect(kill).toHaveBeenCalledWith(12345, "SIGTERM");
			expect(clearHubDiscovery).toHaveBeenCalledWith("/tmp/hub-discovery.json");
			expect(spawn).toHaveBeenCalledOnce();
			expect(verifyHubConnection).toHaveBeenCalledOnce();
		} finally {
			kill.mockRestore();
		}
	});

	it("attaches to an older hub that is still serving sessions instead of retiring it", async () => {
		const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
		try {
			localHubHasNoActiveSessions.mockResolvedValue(false);
			readHubDiscovery.mockResolvedValueOnce({
				url: "ws://127.0.0.1:25463/hub",
				authToken: "busy-token",
			});
			probeHubServer.mockResolvedValueOnce({
				url: "ws://127.0.0.1:25463/hub",
				protocolVersion: "v1",
				buildId: "old-build",
				pid: 12345,
			});
			// Reuse is rejected by build id before any connection check, so the
			// only verify call is the one guarding the deferred attach.
			verifyHubConnection.mockResolvedValue(true);

			const { ensureDetachedHubServer } = await import(".");

			await expect(ensureDetachedHubServer("/workspace")).resolves.toEqual({
				url: "ws://127.0.0.1:25463/hub",
				authToken: "busy-token",
			});
			expect(requestHubShutdown).not.toHaveBeenCalled();
			expect(kill).not.toHaveBeenCalled();
			expect(clearHubDiscovery).not.toHaveBeenCalled();
			expect(spawn).not.toHaveBeenCalled();
		} finally {
			kill.mockRestore();
		}
	});

	it("reuses a healthy hub from a newer build without retiring it", async () => {
		const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
		try {
			readHubDiscovery.mockResolvedValueOnce({
				url: "ws://127.0.0.1:25463/hub",
				authToken: "newer-hub-token",
			});
			probeHubServer.mockResolvedValueOnce({
				url: "ws://127.0.0.1:25463/hub",
				protocolVersion: "v1",
				buildId: "newer-build",
				buildEpochMs: 2_000_000,
				pid: 12345,
			});
			verifyHubConnection.mockResolvedValueOnce(true);

			const { ensureDetachedHubServer } = await import(".");
			const result = await ensureDetachedHubServer("/workspace");

			expect(result).toEqual({
				url: "ws://127.0.0.1:25463/hub",
				authToken: "newer-hub-token",
			});
			expect(requestHubShutdown).not.toHaveBeenCalled();
			expect(kill).not.toHaveBeenCalled();
			expect(clearHubDiscovery).not.toHaveBeenCalled();
			expect(spawn).not.toHaveBeenCalled();
		} finally {
			kill.mockRestore();
		}
	});

	it("retires an existing hub with an empty discovery auth token before starting a replacement", async () => {
		const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
		try {
			readHubDiscovery
				.mockResolvedValueOnce({
					url: "ws://127.0.0.1:25463/hub",
					authToken: "",
					pid: 12345,
				})
				.mockResolvedValueOnce({
					url: "ws://127.0.0.1:25463/hub",
					authToken: "new-token",
				});
			probeHubServer
				.mockResolvedValueOnce(undefined)
				.mockResolvedValueOnce(undefined)
				.mockResolvedValueOnce({
					url: "ws://127.0.0.1:25463/hub",
					protocolVersion: "v1",
					buildId: "current-build",
				});
			verifyHubConnection.mockResolvedValueOnce(true);

			const { ensureDetachedHubServer } = await import(".");
			const result = await ensureDetachedHubServer("/workspace");

			expect(result).toEqual({
				url: "ws://127.0.0.1:25463/hub",
				authToken: "new-token",
			});
			expect(requestHubShutdown).toHaveBeenCalledWith(
				"ws://127.0.0.1:25463/hub",
				"",
			);
			expect(kill).toHaveBeenCalledWith(12345, "SIGTERM");
			expect(clearHubDiscovery).toHaveBeenCalledWith("/tmp/hub-discovery.json");
			expect(spawn).toHaveBeenCalledOnce();
		} finally {
			kill.mockRestore();
		}
	});

	it("throws a targeted error when an incompatible hub cannot be retired", async () => {
		vi.useFakeTimers();
		try {
			readHubDiscovery.mockResolvedValue(undefined);
			probeHubServer.mockResolvedValue({
				url: "ws://127.0.0.1:25463/hub",
				protocolVersion: "v2",
				buildId: "future-build",
			});

			const { ensureDetachedHubServer } = await import(".");
			const pending = expect(
				ensureDetachedHubServer("/workspace"),
			).rejects.toThrow(
				"An incompatible Cline Hub is already running at ws://127.0.0.1:25463/hub and could not be retired automatically.",
			);
			await vi.runAllTimersAsync();

			await pending;
			expect(spawn).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it("retires a legacy shared production hub before resolving the production hub", async () => {
		const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
		try {
			resolveSharedHubOwnerContext.mockReturnValueOnce({
				discoveryPath: "/tmp/legacy-hub-discovery.json",
			});
			readHubDiscovery
				.mockResolvedValueOnce({
					url: "ws://127.0.0.1:39121/hub",
					authToken: "legacy-token",
					pid: 222,
				})
				.mockResolvedValueOnce(undefined)
				.mockResolvedValueOnce({
					url: "ws://127.0.0.1:25463/hub",
					authToken: "new-token",
				});
			probeHubServer
				.mockResolvedValueOnce(undefined)
				.mockResolvedValueOnce(undefined)
				.mockResolvedValueOnce({
					url: "ws://127.0.0.1:25463/hub",
					protocolVersion: "v1",
					buildId: "current-build",
				});
			verifyHubConnection.mockResolvedValueOnce(true);

			const { ensureDetachedHubServer } = await import(".");
			const result = await ensureDetachedHubServer("/workspace");

			expect(result).toEqual({
				url: "ws://127.0.0.1:25463/hub",
				authToken: "new-token",
			});
			expect(requestHubShutdown).toHaveBeenCalledWith(
				"ws://127.0.0.1:39121/hub",
				"legacy-token",
			);
			expect(kill).toHaveBeenCalledWith(222, "SIGTERM");
			expect(clearHubDiscovery).toHaveBeenCalledWith(
				"/tmp/legacy-hub-discovery.json",
			);
			expect(spawn).toHaveBeenCalledOnce();
		} finally {
			kill.mockRestore();
		}
	});

	it("throws when a compatible expected hub has no discovery record", async () => {
		readHubDiscovery.mockResolvedValue(undefined);
		probeHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			protocolVersion: "v1",
			buildId: "current-build",
		});

		const { ensureDetachedHubServer } = await import(".");
		await expect(ensureDetachedHubServer("/workspace")).rejects.toThrow(
			"A compatible Cline Hub is already running at ws://127.0.0.1:25463/hub, but its discovery record is missing or unreadable and no usable auth token is available.",
		);
		expect(spawn).not.toHaveBeenCalled();
	});

	it("repairs discovery and attaches when a live hub can be authenticated", async () => {
		readHubDiscovery.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "known-token",
			pid: 4242,
		});
		// First probe (discovered with token) fails verification path by returning
		// unreachable/undefined; expected-url health probe succeeds without token.
		probeHubServer
			.mockResolvedValueOnce(undefined) // discovered probe fails
			.mockResolvedValueOnce({
				url: "ws://127.0.0.1:25463/hub",
				protocolVersion: "v1",
				buildId: "current-build",
				host: "127.0.0.1",
				port: 25463,
			});
		verifyHubConnection.mockResolvedValue(true);

		const { ensureDetachedHubServer } = await import(".");
		await expect(ensureDetachedHubServer("/workspace")).resolves.toEqual({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "known-token",
		});
		expect(writeHubDiscovery).toHaveBeenCalled();
		expect(spawn).not.toHaveBeenCalled();
	});

	it("uses matching discovery pid and token when retiring an incompatible expected-url hub", async () => {
		const kill = vi
			.spyOn(process, "kill")
			.mockImplementation((_pid, signal) => {
				if (signal === 0) {
					throw Object.assign(new Error("missing"), { code: "ESRCH" });
				}
				return true;
			});
		try {
			readHubDiscovery
				.mockResolvedValueOnce({
					url: "ws://127.0.0.1:25463/hub",
					authToken: "old-token",
					pid: 12345,
				})
				.mockResolvedValueOnce({
					url: "ws://127.0.0.1:25463/hub",
					authToken: "new-token",
				});
			probeHubServer
				.mockResolvedValueOnce(undefined)
				.mockResolvedValueOnce({
					url: "ws://127.0.0.1:25463/hub",
					protocolVersion: "v2",
					buildId: "future-build",
				})
				.mockResolvedValueOnce(undefined)
				.mockResolvedValueOnce({
					url: "ws://127.0.0.1:25463/hub",
					protocolVersion: "v1",
					buildId: "current-build",
				});
			verifyHubConnection.mockResolvedValueOnce(true);

			const { ensureDetachedHubServer } = await import(".");
			const result = await ensureDetachedHubServer("/workspace");

			expect(result).toEqual({
				url: "ws://127.0.0.1:25463/hub",
				authToken: "new-token",
			});
			expect(requestHubShutdown).toHaveBeenCalledWith(
				"ws://127.0.0.1:25463/hub",
				"old-token",
			);
			expect(kill).toHaveBeenCalledWith(12345, "SIGTERM");
		} finally {
			kill.mockRestore();
		}
	});

	it("does not reuse a healthy hub without protocol metadata", async () => {
		vi.useFakeTimers();
		const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
		try {
			readHubDiscovery
				.mockResolvedValueOnce({
					url: "ws://127.0.0.1:25463/hub",
					authToken: "old-token",
				})
				.mockResolvedValueOnce({
					url: "ws://127.0.0.1:25463/hub",
					protocolVersion: "v1",
					buildId: "current-build",
					authToken: "new-token",
				});
			probeHubServer
				.mockResolvedValueOnce({
					url: "ws://127.0.0.1:25463/hub",
					pid: 12345,
				})
				.mockResolvedValueOnce({
					url: "ws://127.0.0.1:25463/hub",
					pid: 12345,
				})
				.mockResolvedValueOnce(undefined)
				.mockResolvedValueOnce(undefined)
				.mockResolvedValueOnce({
					url: "ws://127.0.0.1:25463/hub",
					protocolVersion: "v1",
					buildId: "current-build",
				})
				.mockResolvedValue({
					url: "ws://127.0.0.1:25463/hub",
					protocolVersion: "v1",
					buildId: "current-build",
				});
			verifyHubConnection.mockResolvedValueOnce(true);

			const { ensureDetachedHubServer } = await import(".");
			const pending = ensureDetachedHubServer("/workspace");
			await vi.runAllTimersAsync();
			const result = await pending;

			expect(result).toEqual({
				url: "ws://127.0.0.1:25463/hub",
				authToken: "new-token",
			});
			expect(requestHubShutdown).toHaveBeenCalledWith(
				"ws://127.0.0.1:25463/hub",
				"old-token",
			);
			expect(clearHubDiscovery).toHaveBeenCalledWith("/tmp/hub-discovery.json");
			expect(clearHubDiscovery.mock.invocationCallOrder[0]).toBeGreaterThan(
				probeHubServer.mock.invocationCallOrder[2],
			);
			expect(kill).toHaveBeenCalledWith(12345, "SIGTERM");
			expect(spawn).toHaveBeenCalledOnce();
			expect(verifyHubConnection).toHaveBeenCalledOnce();
		} finally {
			kill.mockRestore();
			vi.useRealTimers();
		}
	});
});
