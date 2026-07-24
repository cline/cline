import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
	mockCreateLocalHubScheduleRuntimeHandlers,
	mockInitVcr,
	mockResolveHubEndpointOptions,
	mockResolveProductionHubOwnerContext,
	mockResolveSharedHubOwnerContext,
	mockEnsureHubWebSocketServer,
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
	mockResolveProductionHubOwnerContext: vi.fn(() => ({
		ownerId: "production",
		discoveryPath: "/tmp/cline-data/locks/hub/production.json",
	})),
	mockResolveSharedHubOwnerContext: vi.fn(() => ({
		ownerId: "shared",
		discoveryPath: "/tmp/cline-data/locks/hub/owners/shared.json",
	})),
	mockEnsureHubWebSocketServer: vi.fn(async () => ({
		server: { close: vi.fn(async () => undefined) },
		url: "ws://127.0.0.1:25463/hub",
		authToken: "token",
		action: "started" as const,
	})),
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

vi.mock("../discovery/defaults", () => ({
	resolveHubEndpointOptions: mockResolveHubEndpointOptions,
}));

vi.mock("../discovery/workspace", () => ({
	resolveProductionHubOwnerContext: mockResolveProductionHubOwnerContext,
	resolveSharedHubOwnerContext: mockResolveSharedHubOwnerContext,
}));

vi.mock("../server", () => ({
	ensureHubWebSocketServer: mockEnsureHubWebSocketServer,
}));

vi.mock("./telemetry", () => ({
	createHubDaemonTelemetry: mockCreateHubDaemonTelemetry,
}));

const originalArgv = [...process.argv];
const originalCwd = process.cwd();
const originalHubPortEnv = process.env.CLINE_HUB_PORT;

describe("hub daemon entry", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		process.argv = [...originalArgv];
		process.chdir(originalCwd);
		if (originalHubPortEnv === undefined) {
			delete process.env.CLINE_HUB_PORT;
		} else {
			process.env.CLINE_HUB_PORT = originalHubPortEnv;
		}
		vi.restoreAllMocks();
		vi.resetModules();
		mockCreateLocalHubScheduleRuntimeHandlers.mockClear();
		mockInitVcr.mockClear();
		mockResolveHubEndpointOptions.mockClear();
		mockResolveProductionHubOwnerContext.mockClear();
		mockResolveSharedHubOwnerContext.mockClear();
		mockEnsureHubWebSocketServer.mockClear();
		mockCreateHubDaemonTelemetry.mockClear();
		mockDaemonTelemetryDispose.mockClear();
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("starts the daemon with a pinned endpoint and no port fallback", async () => {
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
			expect(mockEnsureHubWebSocketServer).toHaveBeenCalled();
		});

		expect(mockEnsureHubWebSocketServer).toHaveBeenCalledWith(
			expect.objectContaining({
				host: "127.0.0.1",
				port: 30000,
				pathname: "/hub",
				owner: expect.objectContaining({ ownerId: "production" }),
				telemetry: mockDaemonTelemetryService,
				cronOptions: { workspaceRoot: cwd },
				allowPortFallback: false,
			}),
		);
		expect(mockCreateLocalHubScheduleRuntimeHandlers).toHaveBeenCalledOnce();
		expect(mockCreateLocalHubScheduleRuntimeHandlers).toHaveBeenCalledWith({
			telemetry: mockDaemonTelemetryService,
		});
	});

	it("allows port fallback when the endpoint is not pinned", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "cline-hub-entry-test-"));
		tempDirs.push(cwd);
		delete process.env.CLINE_HUB_PORT;
		process.argv = ["node", "entry.js", "--cwd", cwd];
		vi.spyOn(process, "on").mockImplementation(() => process);

		await import("./entry");
		await vi.waitFor(() => {
			expect(mockEnsureHubWebSocketServer).toHaveBeenCalled();
		});

		expect(mockEnsureHubWebSocketServer).toHaveBeenCalledWith(
			expect.objectContaining({
				port: 25463,
				allowPortFallback: true,
			}),
		);
	});

	it("exits cleanly when a compatible hub already owns discovery", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "cline-hub-entry-test-"));
		tempDirs.push(cwd);
		process.argv = ["node", "entry.js", "--cwd", cwd];
		vi.spyOn(process, "on").mockImplementation(() => process);
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation(() => undefined as never);
		mockEnsureHubWebSocketServer.mockResolvedValueOnce({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "token",
			action: "reuse" as const,
		} as never);

		await import("./entry");
		await vi.waitFor(() => {
			expect(exitSpy).toHaveBeenCalledWith(0);
		});
		expect(mockDaemonTelemetryDispose).toHaveBeenCalled();
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
		mockEnsureHubWebSocketServer.mockRejectedValueOnce(
			new Error("port already in use"),
		);

		await import("./entry");
		await vi.waitFor(() => {
			expect(exitSpy).toHaveBeenCalledWith(1);
		});
		expect(mockDaemonTelemetryDispose).toHaveBeenCalled();
	});
});
