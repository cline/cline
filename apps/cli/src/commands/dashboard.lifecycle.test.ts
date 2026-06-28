import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawn, coreMocks, buildCliSubcommandCommand } = vi.hoisted(() => ({
	spawn: vi.fn(() => ({ unref: vi.fn() })),
	coreMocks: {
		clearHubDashboardDiscovery: vi.fn(async () => undefined),
		ensureDetachedHubServer: vi.fn(async () => ({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "hub-token",
		})),
		isHubDashboardPidAlive: vi.fn(
			(pid: number | undefined) => !!pid && pid > 0,
		),
		readHubDashboardDiscovery: vi.fn(),
		readHubDiscovery: vi.fn(),
		resolveDefaultHubOwnerContext: vi.fn(() => ({
			ownerId: "hub-shared",
			discoveryPath: "/tmp/hub.json",
		})),
		resolveHubDashboardDiscoveryPath: vi.fn(() => "/tmp/dashboard.json"),
		resolveProductionHubOwnerContext: vi.fn(() => ({
			ownerId: "hub-production",
			discoveryPath: "/tmp/hub.json",
		})),
		resolveSharedHubOwnerContext: vi.fn(() => ({
			ownerId: "hub-shared",
			discoveryPath: "/tmp/hub.json",
		})),
		writeHubDashboardDiscovery: vi.fn(async () => undefined),
	},
	buildCliSubcommandCommand: vi.fn(() => ({
		launcher: "bun",
		childArgs: ["cline", "dashboard", "serve"],
	})),
}));

vi.mock("node:child_process", () => ({ spawn }));
vi.mock("@cline/core", () => coreMocks);
vi.mock("@cline/shared", () => ({
	resolveClineBuildEnv: () => "development",
}));
vi.mock("../utils/internal-launch", () => ({ buildCliSubcommandCommand }));

const originalEnv = {
	CLINE_HUB_DASHBOARD_LAUNCHER: process.env.CLINE_HUB_DASHBOARD_LAUNCHER,
	CLINE_HUB_DASHBOARD_ARGS: process.env.CLINE_HUB_DASHBOARD_ARGS,
};

function dashboardRecord(pid: number) {
	return {
		pid,
		listenUrl: "http://127.0.0.1:8787/",
		publicUrl: "http://127.0.0.1:8787",
		inviteUrl: "http://127.0.0.1:8787",
		hubUrl: "ws://127.0.0.1:25463/hub",
		startedAt: "2026-06-22T20:00:00.000Z",
		updatedAt: "2026-06-22T20:00:00.000Z",
	};
}

describe("dashboard command lifecycle", () => {
	beforeEach(() => {
		vi.resetModules();
		spawn.mockClear();
		buildCliSubcommandCommand.mockClear();
		coreMocks.clearHubDashboardDiscovery.mockClear();
		coreMocks.ensureDetachedHubServer.mockClear();
		coreMocks.isHubDashboardPidAlive.mockClear();
		coreMocks.isHubDashboardPidAlive.mockImplementation(
			(pid: number | undefined) => !!pid && pid > 0,
		);
		coreMocks.readHubDashboardDiscovery.mockReset();
		coreMocks.readHubDiscovery.mockReset();
		coreMocks.writeHubDashboardDiscovery.mockClear();
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({ ok: true })),
		);
		process.env.CLINE_HUB_DASHBOARD_LAUNCHER = "bun";
		process.env.CLINE_HUB_DASHBOARD_ARGS = JSON.stringify([
			"cline",
			"dashboard",
			"serve",
		]);
	});

	afterEach(() => {
		if (originalEnv.CLINE_HUB_DASHBOARD_LAUNCHER === undefined) {
			delete process.env.CLINE_HUB_DASHBOARD_LAUNCHER;
		} else {
			process.env.CLINE_HUB_DASHBOARD_LAUNCHER =
				originalEnv.CLINE_HUB_DASHBOARD_LAUNCHER;
		}
		if (originalEnv.CLINE_HUB_DASHBOARD_ARGS === undefined) {
			delete process.env.CLINE_HUB_DASHBOARD_ARGS;
		} else {
			process.env.CLINE_HUB_DASHBOARD_ARGS =
				originalEnv.CLINE_HUB_DASHBOARD_ARGS;
		}
		vi.unstubAllGlobals();
	});

	it("waits for a newly started hub-owned dashboard instead of spawning a competing fallback", async () => {
		const opened: string[] = [];
		coreMocks.readHubDiscovery
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce({
				url: "ws://127.0.0.1:25463/hub",
				pid: 777,
				startedAt: "2026-06-22T20:00:00.000Z",
			});
		coreMocks.readHubDashboardDiscovery
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce(dashboardRecord(888));
		const { runDashboardCommand } = await import("./dashboard");

		const exitCode = await runDashboardCommand({
			io: {
				writeln: () => {},
				writeErr: () => {},
			},
			openUrl: async (url) => {
				opened.push(url);
			},
		});

		expect(exitCode).toBe(0);
		expect(spawn).not.toHaveBeenCalled();
		expect(opened).toEqual(["http://127.0.0.1:8787"]);
	});

	it("allows CLI fallback only when the hub was already running", async () => {
		const existingHub = {
			url: "ws://127.0.0.1:25463/hub",
			pid: 777,
			startedAt: "2026-06-22T20:00:00.000Z",
		};
		coreMocks.readHubDiscovery
			.mockResolvedValueOnce(existingHub)
			.mockResolvedValueOnce(existingHub);
		coreMocks.readHubDashboardDiscovery
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce(dashboardRecord(999));
		const { runDashboardCommand } = await import("./dashboard");

		const exitCode = await runDashboardCommand({
			io: {
				writeln: () => {},
				writeErr: () => {},
			},
			openUrl: async () => {},
		});

		expect(exitCode).toBe(0);
		expect(spawn).toHaveBeenCalledTimes(1);
		expect(buildCliSubcommandCommand).toHaveBeenCalledWith(
			"dashboard",
			["serve"],
			expect.any(Object),
		);
	});
});
