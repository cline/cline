import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	spawn,
	clearHubDashboardDiscovery,
	isHubDashboardPidAlive,
	readHubDashboardDiscovery,
} = vi.hoisted(() => ({
	spawn: vi.fn(() => ({ unref: vi.fn() })),
	clearHubDashboardDiscovery: vi.fn(async () => undefined),
	isHubDashboardPidAlive: vi.fn(() => false),
	readHubDashboardDiscovery: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	spawn,
}));

vi.mock("../dashboard-discovery", () => ({
	CLINE_HUB_DASHBOARD_DISCOVERY_PATH_ENV: "CLINE_HUB_DASHBOARD_DISCOVERY_PATH",
	clearHubDashboardDiscovery,
	isHubDashboardPidAlive,
	readHubDashboardDiscovery,
}));

describe("managed hub dashboard process", () => {
	beforeEach(() => {
		spawn.mockReset();
		spawn.mockImplementation(() => ({ unref: vi.fn() }));
		clearHubDashboardDiscovery.mockClear();
		isHubDashboardPidAlive.mockReset();
		isHubDashboardPidAlive.mockReturnValue(false);
		readHubDashboardDiscovery.mockReset();
		readHubDashboardDiscovery.mockResolvedValue(undefined);
	});

	afterEach(() => {
		vi.useRealTimers();
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

	it("preserves the existing dashboard for a hub restart", async () => {
		readHubDashboardDiscovery.mockResolvedValue({
			pid: 4242,
			listenUrl: "http://127.0.0.1:8787/",
			publicUrl: "http://127.0.0.1:8787",
			inviteUrl: "http://127.0.0.1:8787",
			startedAt: "2026-06-22T20:00:00.000Z",
			updatedAt: "2026-06-22T20:00:00.000Z",
		});
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
				CLINE_HUB_PRESERVE_DASHBOARD: "1",
			},
		});

		expect(readHubDashboardDiscovery).not.toHaveBeenCalled();
		expect(spawn).not.toHaveBeenCalled();
	});

	it("keeps discovery and rejects when the dashboard ignores SIGTERM", async () => {
		vi.useFakeTimers();
		vi.spyOn(process, "kill").mockImplementation(() => true);
		isHubDashboardPidAlive.mockReturnValue(true);
		readHubDashboardDiscovery.mockResolvedValue({
			pid: 4242,
			listenUrl: "http://127.0.0.1:8787/",
			publicUrl: "http://127.0.0.1:8787",
			inviteUrl: "http://127.0.0.1:8787",
			startedAt: "2026-06-22T20:00:00.000Z",
			updatedAt: "2026-06-22T20:00:00.000Z",
		});
		const { stopManagedHubDashboardProcess } = await import(
			"./dashboard-process"
		);

		const stopping = stopManagedHubDashboardProcess("/tmp/dashboard.json");
		const expectedRejection = expect(stopping).rejects.toThrow(
			"Timed out waiting for dashboard process 4242 to stop.",
		);
		await vi.advanceTimersByTimeAsync(3_000);

		await expectedRejection;
		expect(clearHubDashboardDiscovery).not.toHaveBeenCalled();
	});

	it("does not clear discovery rewritten by a replacement dashboard", async () => {
		vi.spyOn(process, "kill").mockImplementation(() => true);
		isHubDashboardPidAlive.mockReturnValueOnce(true).mockReturnValueOnce(false);
		readHubDashboardDiscovery
			.mockResolvedValueOnce({
				pid: 4242,
				listenUrl: "http://127.0.0.1:8787/",
				publicUrl: "http://127.0.0.1:8787",
				inviteUrl: "http://127.0.0.1:8787",
				startedAt: "2026-06-22T20:00:00.000Z",
				updatedAt: "2026-06-22T20:00:00.000Z",
			})
			.mockResolvedValueOnce({
				pid: 5252,
				listenUrl: "http://127.0.0.1:8787/",
				publicUrl: "http://127.0.0.1:8787",
				inviteUrl: "http://127.0.0.1:8787",
				startedAt: "2026-06-22T20:00:01.000Z",
				updatedAt: "2026-06-22T20:00:01.000Z",
			});
		const { stopManagedHubDashboardProcess } = await import(
			"./dashboard-process"
		);

		await expect(
			stopManagedHubDashboardProcess("/tmp/dashboard.json"),
		).resolves.toBe(true);
		expect(clearHubDashboardDiscovery).not.toHaveBeenCalled();
	});
});
