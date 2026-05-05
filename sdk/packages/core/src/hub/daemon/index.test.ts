import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	spawn,
	closeSync,
	mkdirSync,
	openSync,
	rememberRecoverableLocalHubUrl,
	verifyHubConnection,
	resolveSharedHubOwnerContext,
	createHubServerUrl,
	clearHubDiscovery,
	probeHubServer,
	requestHubShutdown,
	readHubDiscovery,
	resolveClineDataDir,
	resolveHubBuildId,
	writeHubDiscovery,
	CLINE_RUN_AS_HUB_DAEMON_ENV,
} = vi.hoisted(() => ({
	spawn: vi.fn(() => ({ unref: vi.fn() })),
	closeSync: vi.fn(),
	mkdirSync: vi.fn(),
	openSync: vi.fn(() => 17),
	rememberRecoverableLocalHubUrl: vi.fn((url: string) => url),
	verifyHubConnection: vi.fn(),
	resolveSharedHubOwnerContext: vi.fn(() => ({
		discoveryPath: "/tmp/hub-discovery.json",
	})),
	createHubServerUrl: vi.fn(
		(host: string, port: number, pathname: string) =>
			`ws://${host}:${port}${pathname}`,
	),
	clearHubDiscovery: vi.fn(async () => undefined),
	probeHubServer: vi.fn(),
	requestHubShutdown: vi.fn(async () => true),
	readHubDiscovery: vi.fn(),
	resolveClineDataDir: vi.fn(() => "/tmp/cline-data"),
	resolveHubBuildId: vi.fn(() => "current-build"),
	writeHubDiscovery: vi.fn(),
	CLINE_RUN_AS_HUB_DAEMON_ENV: "CLINE_RUN_AS_HUB_DAEMON",
}));

const originalRunAsHubDaemon = process.env[CLINE_RUN_AS_HUB_DAEMON_ENV];

vi.mock("node:child_process", () => ({
	spawn,
}));

vi.mock("node:fs", () => ({
	closeSync,
	mkdirSync,
	openSync,
}));

vi.mock("@clinebot/shared", () => ({
	CLINE_RUN_AS_HUB_DAEMON_ENV,
	CLINE_HUB_PORT: 25463,
	CLINE_HUB_DEV_PORT: 25466,
	isHubDaemonProcess: (env: NodeJS.ProcessEnv = process.env) =>
		env[CLINE_RUN_AS_HUB_DAEMON_ENV] === "1",
	resolveClineBuildEnv: () => "production",
	withResolvedClineBuildEnv: (env: NodeJS.ProcessEnv) => env,
}));

vi.mock("../client", () => ({
	rememberRecoverableLocalHubUrl,
	requestHubShutdown,
	verifyHubConnection,
}));

vi.mock("../discovery/workspace", () => ({
	resolveSharedHubOwnerContext,
}));

vi.mock("../discovery", () => ({
	clearHubDiscovery,
	createHubServerUrl,
	probeHubServer,
	readHubDiscovery,
	resolveClineDataDir,
	resolveHubBuildId,
	writeHubDiscovery,
}));

describe("ensureDetachedHubServer", () => {
	const fetchMock = vi.fn(async () => ({ ok: true }));

	beforeEach(() => {
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
	});

	it("lets the daemon bind port 0 when the configured endpoint is occupied", async () => {
		readHubDiscovery.mockResolvedValue(undefined);
		probeHubServer
			.mockResolvedValueOnce({
				url: "ws://127.0.0.1:25463/hub",
				buildId: "current-build",
			})
			.mockResolvedValueOnce({
				url: "ws://127.0.0.1:5555/hub",
				buildId: "current-build",
			});
		verifyHubConnection.mockResolvedValueOnce(true);
		readHubDiscovery.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
			url: "ws://127.0.0.1:5555/hub",
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
			url: "ws://127.0.0.1:5555/hub",
			authToken: "new-token",
		});
		expect(spawn).toHaveBeenCalledOnce();
		expect(spawnArgs).toContain("--port");
		expect(spawnArgs).toContain("0");
		expect(spawnOptions?.env?.[CLINE_RUN_AS_HUB_DAEMON_ENV]).toBe("1");
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

		expect(clearHubDiscovery.mock.invocationCallOrder[0]).toBeGreaterThan(
			probeHubServer.mock.invocationCallOrder[0],
		);
		expect(spawn).toHaveBeenCalledOnce();
	});

	it("does not reuse a healthy hub from a different build", async () => {
		const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
		try {
			readHubDiscovery
				.mockResolvedValueOnce({
					url: "ws://127.0.0.1:25463/hub",
					authToken: "old-token",
				})
				.mockResolvedValueOnce({
					url: "ws://127.0.0.1:5555/hub",
					buildId: "current-build",
					authToken: "new-token",
				});
			probeHubServer
				.mockResolvedValueOnce({
					url: "ws://127.0.0.1:25463/hub",
					buildId: "old-build",
					pid: 12345,
				})
				.mockResolvedValueOnce({
					url: "ws://127.0.0.1:25463/hub",
					buildId: "old-build",
					pid: 12345,
				})
				.mockResolvedValueOnce(undefined)
				.mockResolvedValueOnce(undefined)
				.mockResolvedValueOnce({
					url: "ws://127.0.0.1:5555/hub",
					buildId: "current-build",
				});
			verifyHubConnection.mockResolvedValueOnce(true);

			const { ensureDetachedHubServer } = await import(".");
			const result = await ensureDetachedHubServer("/workspace");

			expect(result).toEqual({
				url: "ws://127.0.0.1:5555/hub",
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
		}
	});

	it("does not reuse a healthy hub without build metadata", async () => {
		const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
		try {
			readHubDiscovery
				.mockResolvedValueOnce({
					url: "ws://127.0.0.1:25463/hub",
					authToken: "old-token",
				})
				.mockResolvedValueOnce({
					url: "ws://127.0.0.1:5555/hub",
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
					url: "ws://127.0.0.1:5555/hub",
					buildId: "current-build",
				});
			verifyHubConnection.mockResolvedValueOnce(true);

			const { ensureDetachedHubServer } = await import(".");
			const result = await ensureDetachedHubServer("/workspace");

			expect(result).toEqual({
				url: "ws://127.0.0.1:5555/hub",
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
		}
	});
});
