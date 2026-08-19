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
	mockReconnectDaemonConnectors,
	mockStartHubWebSocketServer,
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
	mockReconnectDaemonConnectors: vi.fn(async () => []),
	mockStartHubWebSocketServer: vi.fn(
		async (
			_options: unknown,
		): Promise<{
			beginClose: () => {
				transportStopped: Promise<void>;
				closed: Promise<void>;
			};
			close: () => Promise<void>;
		}> => {
			const transportStopped = Promise.resolve();
			const closed = Promise.resolve();
			return {
				beginClose: vi.fn(() => ({ transportStopped, closed })),
				close: vi.fn(() => closed),
			};
		},
	),
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

vi.mock("@cline/shared", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@cline/shared")>();
	return {
		...actual,
		initVcr: mockInitVcr,
		resolveClineBuildEnv: () => "production",
	};
});

vi.mock("@cline/agents", () => ({
	AgentRuntimeAbortError: class AgentRuntimeAbortError extends Error {},
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
	startHubWebSocketServer: mockStartHubWebSocketServer,
}));

vi.mock("../../services/connectors/daemon-connector-reconnect", () => ({
	reconnectDaemonConnectors: mockReconnectDaemonConnectors,
}));

vi.mock("./telemetry", () => ({
	createHubDaemonTelemetry: mockCreateHubDaemonTelemetry,
}));

const originalArgv = [...process.argv];
const originalCwd = process.cwd();

function createMockServerClose(
	options: { transportStopped?: Promise<void>; closed?: Promise<void> } = {},
) {
	const transportStopped = options.transportStopped ?? Promise.resolve();
	const closed = options.closed ?? Promise.resolve();
	return {
		beginClose: vi.fn(() => ({ transportStopped, closed })),
		close: vi.fn(() => closed),
	};
}

describe("hub daemon entry", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		process.argv = [...originalArgv];
		process.chdir(originalCwd);
		vi.restoreAllMocks();
		vi.resetModules();
		mockCreateLocalHubScheduleRuntimeHandlers.mockClear();
		mockInitVcr.mockClear();
		mockResolveHubEndpointOptions.mockClear();
		mockResolveProductionHubOwnerContext.mockClear();
		mockResolveSharedHubOwnerContext.mockClear();
		mockReconnectDaemonConnectors.mockClear();
		mockStartHubWebSocketServer.mockClear();
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

		const { hubDaemonReady } = await import("./entry");
		await hubDaemonReady;

		expect(mockStartHubWebSocketServer).toHaveBeenCalledWith(
			expect.objectContaining({
				host: "127.0.0.1",
				port: 30000,
				pathname: "/hub",
				owner: expect.objectContaining({ ownerId: "production" }),
				telemetry: mockDaemonTelemetryService,
				cronOptions: { workspaceRoot: cwd },
			}),
		);
		expect(mockCreateLocalHubScheduleRuntimeHandlers).toHaveBeenCalledOnce();
		expect(mockCreateLocalHubScheduleRuntimeHandlers).toHaveBeenCalledWith({
			telemetry: mockDaemonTelemetryService,
		});
		expect(mockReconnectDaemonConnectors).toHaveBeenCalledOnce();
	});

	it("does not signal readiness before the WebSocket server is listening", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "cline-hub-entry-test-"));
		tempDirs.push(cwd);
		process.argv = ["node", "entry.js", "--cwd", cwd];
		vi.spyOn(process, "on").mockImplementation(() => process);

		let releaseServer!: () => void;
		mockStartHubWebSocketServer.mockImplementationOnce(async () => {
			await new Promise<void>((resolve) => {
				releaseServer = resolve;
			});
			return createMockServerClose();
		});

		const { hubDaemonReady } = await import("./entry");
		let ready = false;
		void hubDaemonReady.then(() => {
			ready = true;
		});
		await Promise.resolve();
		expect(ready).toBe(false);

		releaseServer();
		await hubDaemonReady;
		expect(ready).toBe(true);
		await vi.waitFor(() => {
			expect(mockReconnectDaemonConnectors).toHaveBeenCalledOnce();
		});
	});

	it("does not become ready or reconnect connectors after an early HTTP shutdown", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "cline-hub-entry-test-"));
		tempDirs.push(cwd);
		process.argv = ["node", "entry.js", "--cwd", cwd];
		vi.spyOn(process, "on").mockImplementation(() => process);
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation(() => undefined as never);
		const server = createMockServerClose();
		mockStartHubWebSocketServer.mockImplementationOnce(async (options) => {
			(options as { onShutdownRequested?: () => void }).onShutdownRequested?.();
			return server;
		});

		const { hubDaemonReady } = await import("./entry");
		await expect(hubDaemonReady).rejects.toThrow(
			"shutdown was requested before readiness",
		);
		await vi.waitFor(() => {
			expect(exitSpy).toHaveBeenCalledWith(0);
		});

		expect(server.beginClose).toHaveBeenCalledOnce();
		expect(mockReconnectDaemonConnectors).not.toHaveBeenCalled();
	});

	it("forces exit when startup hangs after an early shutdown request", async () => {
		vi.useFakeTimers();
		try {
			const cwd = mkdtempSync(join(tmpdir(), "cline-hub-entry-test-"));
			tempDirs.push(cwd);
			process.argv = ["node", "entry.js", "--cwd", cwd];
			const handlers = new Map<string, (value?: unknown) => void>();
			vi.spyOn(process, "on").mockImplementation(((
				event: string,
				handler: (value?: unknown) => void,
			) => {
				handlers.set(event, handler);
				return process;
			}) as never);
			vi.spyOn(process.stderr, "write").mockImplementation(() => true);
			const exitSpy = vi
				.spyOn(process, "exit")
				.mockImplementation(() => undefined as never);
			mockStartHubWebSocketServer.mockImplementationOnce(
				async () => await new Promise<never>(() => undefined),
			);

			await import("./entry");
			handlers.get("SIGTERM")?.();
			handlers.get("uncaughtException")?.(new Error("fatal while starting"));
			await vi.advanceTimersByTimeAsync(2_000);

			expect(exitSpy).toHaveBeenCalledOnce();
			expect(exitSpy).toHaveBeenCalledWith(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("ignores abort-family unhandled rejections instead of shutting down", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "cline-hub-entry-test-"));
		tempDirs.push(cwd);
		process.argv = ["node", "entry.js", "--cwd", cwd];
		const handlers = new Map<string, (reason: unknown) => void>();
		vi.spyOn(process, "on").mockImplementation(((
			event: string,
			handler: (reason: unknown) => void,
		) => {
			handlers.set(event, handler);
			return process;
		}) as never);
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation(() => undefined as never);

		const { hubDaemonReady } = await import("./entry");
		await hubDaemonReady;
		const onUnhandledRejection = handlers.get("unhandledRejection");
		expect(onUnhandledRejection).toBeDefined();

		// Cancelling a turn can leave provider fetches rejecting on floating
		// promises after the run settled. None of these may kill the daemon —
		// it hosts every resident session.
		const { AgentRuntimeAbortError } = await import("@cline/agents");
		onUnhandledRejection?.(new AgentRuntimeAbortError("run aborted"));
		const domAbort = new Error("This operation was aborted");
		domAbort.name = "AbortError";
		onUnhandledRejection?.(domAbort);
		const nodeAbort = Object.assign(new Error("The operation was aborted"), {
			code: "ABORT_ERR",
		});
		onUnhandledRejection?.(nodeAbort);
		expect(exitSpy).not.toHaveBeenCalled();

		// Anything else is still fatal.
		onUnhandledRejection?.(new Error("boom"));
		await vi.waitFor(() => {
			expect(exitSpy).toHaveBeenCalledWith(1);
		});
	});

	it("routes HTTP and signal shutdown through one cleanup", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "cline-hub-entry-test-"));
		tempDirs.push(cwd);
		process.argv = ["node", "entry.js", "--cwd", cwd];
		const handlers = new Map<string, (value?: unknown) => void>();
		vi.spyOn(process, "on").mockImplementation(((
			event: string,
			handler: (value?: unknown) => void,
		) => {
			handlers.set(event, handler);
			return process;
		}) as never);
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation(() => undefined as never);
		const server = createMockServerClose();
		mockStartHubWebSocketServer.mockResolvedValueOnce(server);

		const { hubDaemonReady } = await import("./entry");
		await hubDaemonReady;
		const startOptions = mockStartHubWebSocketServer.mock.calls[0]?.[0] as
			| { onShutdownRequested?: () => void }
			| undefined;
		expect(startOptions?.onShutdownRequested).toBeTypeOf("function");

		startOptions?.onShutdownRequested?.();
		handlers.get("SIGTERM")?.();

		await vi.waitFor(() => {
			expect(exitSpy).toHaveBeenCalledWith(0);
		});
		expect(server.beginClose).toHaveBeenCalledOnce();
		expect(mockDaemonTelemetryDispose).toHaveBeenCalledOnce();
		expect(exitSpy).toHaveBeenCalledOnce();
	});

	it("lets a fatal error upgrade an in-progress graceful shutdown", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "cline-hub-entry-test-"));
		tempDirs.push(cwd);
		process.argv = ["node", "entry.js", "--cwd", cwd];
		const handlers = new Map<string, (value?: unknown) => void>();
		vi.spyOn(process, "on").mockImplementation(((
			event: string,
			handler: (value?: unknown) => void,
		) => {
			handlers.set(event, handler);
			return process;
		}) as never);
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation(() => undefined as never);
		let releaseClose!: () => void;
		const closed = new Promise<void>((resolve) => {
			releaseClose = resolve;
		});
		const server = createMockServerClose({ closed });
		mockStartHubWebSocketServer.mockResolvedValueOnce(server);

		const { hubDaemonReady } = await import("./entry");
		await hubDaemonReady;
		const startOptions = mockStartHubWebSocketServer.mock.calls[0]?.[0] as
			| { onShutdownRequested?: () => void }
			| undefined;
		startOptions?.onShutdownRequested?.();
		handlers.get("uncaughtException")?.(new Error("fatal during shutdown"));
		await vi.waitFor(() => {
			expect(server.beginClose).toHaveBeenCalledOnce();
		});
		releaseClose();

		await vi.waitFor(() => {
			expect(exitSpy).toHaveBeenCalledWith(1);
		});
		expect(server.beginClose).toHaveBeenCalledOnce();
		expect(mockDaemonTelemetryDispose).toHaveBeenCalledOnce();
		expect(exitSpy).toHaveBeenCalledOnce();
	});

	it("keeps telemetry active until runtime teardown settles", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "cline-hub-entry-test-"));
		tempDirs.push(cwd);
		process.argv = ["node", "entry.js", "--cwd", cwd];
		vi.spyOn(process, "on").mockImplementation(() => process);
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation(() => undefined as never);
		let releaseTransport!: () => void;
		const transportStopped = new Promise<void>((resolve) => {
			releaseTransport = resolve;
		});
		const server = createMockServerClose({
			transportStopped,
			closed: transportStopped,
		});
		mockStartHubWebSocketServer.mockResolvedValueOnce(server);

		const { hubDaemonReady } = await import("./entry");
		await hubDaemonReady;
		const startOptions = mockStartHubWebSocketServer.mock.calls[0]?.[0] as
			| { onShutdownRequested?: () => void }
			| undefined;
		startOptions?.onShutdownRequested?.();
		await vi.waitFor(() => {
			expect(server.beginClose).toHaveBeenCalledOnce();
		});
		expect(mockDaemonTelemetryDispose).not.toHaveBeenCalled();

		releaseTransport();
		await vi.waitFor(() => {
			expect(exitSpy).toHaveBeenCalledWith(0);
		});
		expect(mockDaemonTelemetryDispose).toHaveBeenCalledOnce();
	});

	it("forces process exit when daemon cleanup stalls", async () => {
		vi.useFakeTimers();
		try {
			const cwd = mkdtempSync(join(tmpdir(), "cline-hub-entry-test-"));
			tempDirs.push(cwd);
			process.argv = ["node", "entry.js", "--cwd", cwd];
			vi.spyOn(process, "on").mockImplementation(() => process);
			vi.spyOn(process.stderr, "write").mockImplementation(() => true);
			const exitSpy = vi
				.spyOn(process, "exit")
				.mockImplementation(() => undefined as never);
			const server = createMockServerClose({
				closed: new Promise<void>(() => undefined),
			});
			mockStartHubWebSocketServer.mockResolvedValueOnce(server);

			const { hubDaemonReady } = await import("./entry");
			await hubDaemonReady;
			const startOptions = mockStartHubWebSocketServer.mock.calls[0]?.[0] as
				| { onShutdownRequested?: () => void }
				| undefined;
			startOptions?.onShutdownRequested?.();

			await vi.advanceTimersByTimeAsync(1_999);
			expect(exitSpy).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(1);
			expect(exitSpy).toHaveBeenCalledOnce();
			expect(exitSpy).toHaveBeenCalledWith(0);
			expect(server.beginClose).toHaveBeenCalledOnce();
			expect(mockDaemonTelemetryDispose).toHaveBeenCalledOnce();
		} finally {
			vi.useRealTimers();
		}
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
});
