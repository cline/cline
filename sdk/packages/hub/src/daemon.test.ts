import { afterEach, describe, expect, it, vi } from "vitest";

const {
	spawn,
	closeSync,
	mkdirSync,
	openSync,
	probeHubConnection,
	resolveSharedHubOwnerContext,
	createHubServerUrl,
	probeHubServer,
	readHubDiscovery,
	resolveClineDataDir,
	writeHubDiscovery,
} = vi.hoisted(() => ({
	spawn: vi.fn(() => ({ unref: vi.fn() })),
	closeSync: vi.fn(),
	mkdirSync: vi.fn(),
	openSync: vi.fn(() => 17),
	probeHubConnection: vi.fn(),
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
}));

vi.mock("node:child_process", () => ({
	spawn,
}));

vi.mock("node:fs", () => ({
	closeSync,
	mkdirSync,
	openSync,
}));

vi.mock("@clinebot/core/hub", () => ({
	resolveSharedHubOwnerContext,
}));

vi.mock("@clinebot/shared", () => ({
	withResolvedClineBuildEnv: (env: NodeJS.ProcessEnv) => env,
}));

vi.mock("./client", () => ({
	probeHubConnection,
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
		probeHubConnection.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
		readHubDiscovery.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
			url: "ws://127.0.0.1:5555/hub",
		});

		const { ensureDetachedHubServer } = await import("./daemon");
		const url = await ensureDetachedHubServer("/workspace");
		const spawnCalls = (spawn as unknown as { mock: { calls: unknown[][] } })
			.mock.calls;
		const spawnArgs = spawnCalls[0]?.[1] as string[] | undefined;

		expect(url).toBe("ws://127.0.0.1:5555/hub");
		expect(spawn).toHaveBeenCalledOnce();
		expect(spawnArgs).toContain("--port");
		expect(spawnArgs).toContain("0");
	});
});
