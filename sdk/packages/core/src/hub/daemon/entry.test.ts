import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLINE_HUB_DASHBOARD_DISCOVERY_PATH_ENV } from "../dashboard-discovery";

const {
	mockCreateLocalHubScheduleRuntimeHandlers,
	mockInitVcr,
	mockResolveDefaultHubOwnerContext,
	mockResolveHubEndpointOptions,
	mockResolveProductionHubOwnerContext,
	mockResolveSharedHubOwnerContext,
	mockRestartManagedHubDashboardProcess,
	mockStartHubWebSocketServer,
	mockStopManagedHubDashboardProcess,
} = vi.hoisted(() => ({
	mockCreateLocalHubScheduleRuntimeHandlers: vi.fn(() => ({
		startSession: vi.fn(),
		sendSession: vi.fn(),
		stopSession: vi.fn(),
		abortSession: vi.fn(),
	})),
	mockInitVcr: vi.fn(),
	mockResolveHubEndpointOptions: vi.fn(
		(options: { host?: string; port?: number; pathname?: string }) => ({
			host: options.host ?? "127.0.0.1",
			port: options.port ?? 25463,
			pathname: options.pathname ?? "/hub",
		}),
	),
	mockResolveDefaultHubOwnerContext: vi.fn(() => ({
		ownerId: "production",
		discoveryPath: "/tmp/cline-data/locks/hub/production.json",
	})),
	mockResolveProductionHubOwnerContext: vi.fn(() => ({
		ownerId: "production",
		discoveryPath: "/tmp/cline-data/locks/hub/production.json",
	})),
	mockResolveSharedHubOwnerContext: vi.fn(() => ({
		ownerId: "shared",
		discoveryPath: "/tmp/cline-data/locks/hub/owners/shared.json",
	})),
	mockRestartManagedHubDashboardProcess: vi.fn(async () => undefined),
	mockStartHubWebSocketServer: vi.fn(async () => ({
		close: vi.fn(async () => undefined),
		shutdownRequested: new Promise<{ preserveDashboard: boolean }>(
			() => undefined,
		),
	})),
	mockStopManagedHubDashboardProcess: vi.fn(async () => true),
}));

const {
	mockDaemonTelemetryService,
	mockDaemonTelemetryDispose,
	mockCreateHubDaemonTelemetry,
} = vi.hoisted(() => {
	const telemetry = { capture: vi.fn() };
	const dispose = vi.fn(async () => undefined);
	return {
		mockDaemonTelemetryService: telemetry,
		mockDaemonTelemetryDispose: dispose,
		mockCreateHubDaemonTelemetry: vi.fn(() => ({
			telemetry,
			dispose,
		})),
	};
});

vi.mock("@cline/shared", () => ({
	initVcr: mockInitVcr,
	resolveClineBuildEnv: () => "production",
}));

vi.mock("../daemon/runtime-handlers", () => ({
	createLocalHubScheduleRuntimeHandlers:
		mockCreateLocalHubScheduleRuntimeHandlers,
}));

vi.mock("../daemon/dashboard-process", () => ({
	CLINE_HUB_PRESERVE_DASHBOARD_ENV: "CLINE_HUB_PRESERVE_DASHBOARD",
	restartManagedHubDashboardProcess: mockRestartManagedHubDashboardProcess,
	stopManagedHubDashboardProcess: mockStopManagedHubDashboardProcess,
}));

vi.mock("../discovery/defaults", () => ({
	resolveHubEndpointOptions: mockResolveHubEndpointOptions,
}));

vi.mock("../discovery/workspace", () => ({
	resolveDefaultHubOwnerContext: mockResolveDefaultHubOwnerContext,
	resolveProductionHubOwnerContext: mockResolveProductionHubOwnerContext,
	resolveSharedHubOwnerContext: mockResolveSharedHubOwnerContext,
}));

vi.mock("../server", () => ({
	startHubWebSocketServer: mockStartHubWebSocketServer,
}));

vi.mock("./telemetry", () => ({
	createHubDaemonTelemetry: mockCreateHubDaemonTelemetry,
}));

const originalArgv = [...process.argv];
const originalCwd = process.cwd();
const originalDashboardDiscoveryPath =
	process.env[CLINE_HUB_DASHBOARD_DISCOVERY_PATH_ENV];

describe("hub daemon entry", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		process.argv = [...originalArgv];
		process.chdir(originalCwd);
		if (originalDashboardDiscoveryPath === undefined) {
			delete process.env[CLINE_HUB_DASHBOARD_DISCOVERY_PATH_ENV];
		} else {
			process.env[CLINE_HUB_DASHBOARD_DISCOVERY_PATH_ENV] =
				originalDashboardDiscoveryPath;
		}
		vi.restoreAllMocks();
		vi.resetModules();
		mockCreateLocalHubScheduleRuntimeHandlers.mockClear();
		mockInitVcr.mockClear();
		mockResolveDefaultHubOwnerContext.mockClear();
		mockResolveHubEndpointOptions.mockClear();
		mockResolveProductionHubOwnerContext.mockClear();
		mockResolveSharedHubOwnerContext.mockClear();
		mockRestartManagedHubDashboardProcess.mockClear();
		mockStartHubWebSocketServer.mockClear();
		mockStopManagedHubDashboardProcess.mockClear();
		mockCreateHubDaemonTelemetry.mockClear();
		mockDaemonTelemetryDispose.mockClear();
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("starts the daemon with cron options for the daemon workspace root", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "cline-hub-entry-test-"));
		tempDirs.push(cwd);
		process.argv = [
			"node",
			"entry.js",
			"--cwd",
			cwd,
			"--host",
			"127.0.0.1",
			"--port",
			"30000",
			"--pathname",
			"/hub",
		];
		vi.spyOn(process, "on").mockImplementation(() => process);

		await import("./entry");
		await vi.waitFor(() => {
			expect(mockStartHubWebSocketServer).toHaveBeenCalled();
		});

		expect(mockStartHubWebSocketServer).toHaveBeenCalledWith(
			expect.objectContaining({
				host: "127.0.0.1",
				port: 30000,
				pathname: "/hub",
				owner: expect.objectContaining({ ownerId: "production" }),
				telemetry: mockDaemonTelemetryService,
				cronOptions: { workspaceRoot: cwd },
				prepareShutdown: expect.any(Function),
			}),
		);
		expect(mockCreateLocalHubScheduleRuntimeHandlers).toHaveBeenCalledOnce();
		expect(mockCreateLocalHubScheduleRuntimeHandlers).toHaveBeenCalledWith({
			telemetry: mockDaemonTelemetryService,
		});
	});

	it("uses the dashboard discovery path override for managed lifecycle", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "cline-hub-entry-test-"));
		tempDirs.push(cwd);
		process.argv = ["node", "entry.js", "--cwd", cwd];
		process.env[CLINE_HUB_DASHBOARD_DISCOVERY_PATH_ENV] =
			"/tmp/overridden-dashboard.json";
		vi.spyOn(process, "on").mockImplementation(() => process);

		await import("./entry");
		await vi.waitFor(() => {
			expect(mockRestartManagedHubDashboardProcess).toHaveBeenCalledWith({
				discoveryPath: "/tmp/overridden-dashboard.json",
				cwd,
			});
		});
	});

	it("registers shutdown handlers before restarting the managed dashboard", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "cline-hub-entry-test-"));
		tempDirs.push(cwd);
		process.argv = ["node", "entry.js", "--cwd", cwd];
		let finishDashboardRestart: (() => void) | undefined;
		mockRestartManagedHubDashboardProcess.mockReturnValueOnce(
			new Promise<undefined>((resolve) => {
				finishDashboardRestart = () => resolve(undefined);
			}),
		);
		const processOn = vi.spyOn(process, "on").mockImplementation(() => process);

		await import("./entry");
		await vi.waitFor(() => {
			expect(mockRestartManagedHubDashboardProcess).toHaveBeenCalledOnce();
		});

		for (const signal of [
			"SIGINT",
			"SIGTERM",
			"uncaughtException",
			"unhandledRejection",
		]) {
			expect(processOn).toHaveBeenCalledWith(signal, expect.any(Function));
		}
		const firstHandlerRegistration = processOn.mock.invocationCallOrder[0];
		const dashboardRestart =
			mockRestartManagedHubDashboardProcess.mock.invocationCallOrder[0];
		expect(firstHandlerRegistration).toBeLessThan(dashboardRestart);
		finishDashboardRestart?.();
	});

	it("disposes telemetry and exits when server startup fails", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "cline-hub-entry-test-"));
		tempDirs.push(cwd);
		process.argv = ["node", "entry.js", "--cwd", cwd];
		vi.spyOn(process, "on").mockImplementation(() => process);
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation(() => undefined as never);
		mockStartHubWebSocketServer.mockRejectedValueOnce(
			new Error("port already in use"),
		);

		await import("./entry");
		await vi.waitFor(() => {
			expect(exitSpy).toHaveBeenCalledWith(1);
		});
		expect(mockDaemonTelemetryDispose).toHaveBeenCalled();
	});

	it("stops the managed dashboard after an HTTP shutdown request", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "cline-hub-entry-test-"));
		tempDirs.push(cwd);
		process.argv = ["node", "entry.js", "--cwd", cwd];
		vi.spyOn(process, "on").mockImplementation(() => process);
		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation(() => undefined as never);
		const close = vi.fn(async () => undefined);
		mockStartHubWebSocketServer.mockResolvedValueOnce({
			close,
			shutdownRequested: Promise.resolve({ preserveDashboard: false }),
		} as never);

		await import("./entry");
		await vi.waitFor(() => {
			expect(exitSpy).toHaveBeenCalledWith(0);
		});

		expect(mockStopManagedHubDashboardProcess).toHaveBeenCalledWith(
			join("/tmp/cline-data/locks/hub", "dashboard.json"),
		);
		expect(close).toHaveBeenCalledOnce();
		expect(mockDaemonTelemetryDispose).toHaveBeenCalled();
	});

	it("preserves the managed dashboard for a dashboard-initiated hub restart", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "cline-hub-entry-test-"));
		tempDirs.push(cwd);
		process.argv = ["node", "entry.js", "--cwd", cwd];
		vi.spyOn(process, "on").mockImplementation(() => process);
		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation(() => undefined as never);
		const close = vi.fn(async () => undefined);
		mockStartHubWebSocketServer.mockResolvedValueOnce({
			close,
			shutdownRequested: Promise.resolve({ preserveDashboard: true }),
		} as never);

		await import("./entry");
		await vi.waitFor(() => {
			expect(exitSpy).toHaveBeenCalledWith(0);
		});

		expect(mockStopManagedHubDashboardProcess).not.toHaveBeenCalled();
		expect(close).toHaveBeenCalledOnce();
		expect(mockDaemonTelemetryDispose).toHaveBeenCalled();
	});

	it("preserves the dashboard if fatal shutdown starts during a preserved shutdown", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "cline-hub-entry-test-"));
		tempDirs.push(cwd);
		process.argv = ["node", "entry.js", "--cwd", cwd];
		const handlers = new Map<string, (...args: unknown[]) => void>();
		vi.spyOn(process, "on").mockImplementation((event, listener) => {
			handlers.set(String(event), listener as (...args: unknown[]) => void);
			return process;
		});
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation(() => undefined as never);
		let requestShutdown:
			| ((request: { preserveDashboard: boolean }) => void)
			| undefined;
		const shutdownRequested = new Promise<{ preserveDashboard: boolean }>(
			(resolve) => {
				requestShutdown = resolve;
			},
		);
		const normalClosePending = new Promise<void>(() => undefined);
		const close = vi
			.fn()
			.mockReturnValueOnce(normalClosePending)
			.mockResolvedValueOnce(undefined);
		mockStartHubWebSocketServer.mockResolvedValueOnce({
			close,
			shutdownRequested,
		} as never);

		await import("./entry");
		await vi.waitFor(() => {
			expect(handlers.has("unhandledRejection")).toBe(true);
		});
		requestShutdown?.({ preserveDashboard: true });
		await vi.waitFor(() => {
			expect(close).toHaveBeenCalledOnce();
		});

		handlers.get("unhandledRejection")?.(new Error("teardown failed"));
		await vi.waitFor(() => {
			expect(exitSpy).toHaveBeenCalledWith(1);
		});

		expect(close).toHaveBeenCalledTimes(2);
		expect(mockStopManagedHubDashboardProcess).not.toHaveBeenCalled();
	});
});
