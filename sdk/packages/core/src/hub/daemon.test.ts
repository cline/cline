import { afterEach, describe, expect, it, vi } from "vitest";

const {
	spawn,
	closeSync,
	mkdirSync,
	openSync,
	verifyHubConnection,
	resolveSharedHubOwnerContext,
	createHubServerUrl,
	probeHubServer,
	readHubDiscovery,
	resolveClineDataDir,
	writeHubDiscovery,
	CLINE_RUN_AS_HUB_DAEMON_ENV,
} = vi.hoisted(() => ({
	spawn: vi.fn(() => ({ unref: vi.fn() })),
	closeSync: vi.fn(),
	mkdirSync: vi.fn(),
	openSync: vi.fn(() => 17),
	verifyHubConnection: vi.fn(),
	resolveSharedHubOwnerContext: vi.fn(() => ({
		discoveryPath: "/tmp/hub-discovery.json",
	})),
	createHubServerUrl: vi.fn(
		(host: string, port: number, pathname: string) =>
			`ws://${host}:${port}${pathname}`,
	),
	probeHubServer: vi.fn(),
	readHubDiscovery: vi.fn(),
	resolveClineDataDir: vi.fn(() => "/tmp/cline-data"),
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

vi.mock("./client", () => ({
	verifyHubConnection,
}));

vi.mock("./workspace", () => ({
	resolveSharedHubOwnerContext,
}));

vi.mock("./discovery", () => ({
	createHubServerUrl,
	probeHubServer,
	readHubDiscovery,
	resolveClineDataDir,
	writeHubDiscovery,
}));

describe("ensureDetachedHubServer", () => {
	afterEach(() => {
		vi.clearAllMocks();
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
			})
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce({
				url: "ws://127.0.0.1:5555/hub",
			});
		verifyHubConnection
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(true);
		readHubDiscovery.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
			url: "ws://127.0.0.1:5555/hub",
		});

		const { ensureDetachedHubServer } = await import("./daemon");
		const url = await ensureDetachedHubServer("/workspace");
		const spawnCalls = (spawn as unknown as { mock: { calls: unknown[][] } })
			.mock.calls;
		const spawnArgs = spawnCalls[0]?.[1] as string[] | undefined;
		const spawnOptions = spawnCalls[0]?.[2] as
			| { env?: NodeJS.ProcessEnv }
			| undefined;

		expect(url).toBe("ws://127.0.0.1:5555/hub");
		expect(spawn).toHaveBeenCalledOnce();
		expect(spawnArgs).toContain("--port");
		expect(spawnArgs).toContain("0");
		expect(spawnOptions?.env?.[CLINE_RUN_AS_HUB_DAEMON_ENV]).toBe("1");
	});

	it("does not spawn another detached daemon from inside the hub daemon process", async () => {
		process.env[CLINE_RUN_AS_HUB_DAEMON_ENV] = "1";

		const { spawnDetachedHubServer } = await import("./daemon");
		spawnDetachedHubServer("/workspace");

		expect(spawn).not.toHaveBeenCalled();
		expect(openSync).not.toHaveBeenCalled();
	});

	it("does not prewarm another detached daemon from inside the hub daemon process", async () => {
		process.env[CLINE_RUN_AS_HUB_DAEMON_ENV] = "1";

		const { prewarmDetachedHubServer } = await import("./daemon");
		prewarmDetachedHubServer("/workspace");

		expect(readHubDiscovery).not.toHaveBeenCalled();
		expect(spawn).not.toHaveBeenCalled();
	});
});
