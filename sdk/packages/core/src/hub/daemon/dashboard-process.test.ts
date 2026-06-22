import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawn, clearHubDashboardDiscovery, readHubDashboardDiscovery } =
	vi.hoisted(() => ({
		spawn: vi.fn(() => ({ unref: vi.fn() })),
		clearHubDashboardDiscovery: vi.fn(async () => undefined),
		readHubDashboardDiscovery: vi.fn(),
	}));

vi.mock("node:child_process", () => ({
	spawn,
}));

vi.mock("../dashboard-discovery", () => ({
	clearHubDashboardDiscovery,
	readHubDashboardDiscovery,
}));

describe("managed hub dashboard process", () => {
	beforeEach(() => {
		spawn.mockReset();
		spawn.mockImplementation(() => ({ unref: vi.fn() }));
		clearHubDashboardDiscovery.mockClear();
		readHubDashboardDiscovery.mockReset();
		readHubDashboardDiscovery.mockResolvedValue(undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("spawns the configured dashboard command without the hub daemon marker", async () => {
		const { restartManagedHubDashboardProcess } = await import(
			"./dashboard-process"
		);

		await restartManagedHubDashboardProcess({
			discoveryPath: "/tmp/dashboard.json",
			cwd: "/workspace",
			env: {
				CLINE_HUB_DASHBOARD_LAUNCHER: "bun",
				CLINE_HUB_DASHBOARD_ARGS: JSON.stringify([
					"cline",
					"dashboard",
					"serve",
				]),
				CLINE_RUN_AS_HUB_DAEMON: "1",
			},
		});

		expect(spawn).toHaveBeenCalledWith(
			"bun",
			["cline", "dashboard", "serve"],
			expect.objectContaining({
				cwd: "/workspace",
				detached: true,
				stdio: "ignore",
				windowsHide: true,
				env: expect.objectContaining({
					CLINE_HUB_DASHBOARD_DISCOVERY_PATH: "/tmp/dashboard.json",
					CLINE_NO_INTERACTIVE: "1",
				}),
			}),
		);
		const call = spawn.mock.calls[0] as unknown as
			| [string, string[], { env?: NodeJS.ProcessEnv }]
			| undefined;
		const env = call?.[2].env;
		expect(env?.CLINE_RUN_AS_HUB_DAEMON).toBeUndefined();
	});

	it("does nothing without a configured dashboard command", async () => {
		const { restartManagedHubDashboardProcess } = await import(
			"./dashboard-process"
		);

		await restartManagedHubDashboardProcess({
			discoveryPath: "/tmp/dashboard.json",
			cwd: "/workspace",
			env: {},
		});

		expect(spawn).not.toHaveBeenCalled();
	});
});
