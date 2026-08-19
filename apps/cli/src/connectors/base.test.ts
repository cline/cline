import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectorBase } from "./base";
import { CONNECT_ALREADY_RUNNING_EXIT_CODE } from "./common";
import type { ConnectIo } from "./types";

const mocks = vi.hoisted(() => ({
	isProcessRunning: vi.fn(),
	spawnDetachedConnector: vi.fn(),
	terminateProcess: vi.fn(),
}));

vi.mock("./common", async (importOriginal) => ({
	...(await importOriginal<typeof import("./common")>()),
	isProcessRunning: mocks.isProcessRunning,
	spawnDetachedConnector: mocks.spawnDetachedConnector,
	terminateProcess: mocks.terminateProcess,
}));

class TestConnector extends ConnectorBase<
	Record<string, never>,
	{ pid: number }
> {
	constructor() {
		super("test", "Test connector");
	}

	protected readOptions(): Record<string, never> {
		return {};
	}

	protected async runWithOptions(): Promise<number> {
		return 0;
	}

	runBackground(
		io: ConnectIo,
		options?: {
			readState?: () => { pid: number } | undefined;
			isRunning?: (state: { pid: number }) => boolean;
			startupTimeoutMs?: number;
		},
	): Promise<number | undefined> {
		return this.maybeRunInBackground({
			rawArgs: ["--token", "secret"],
			io,
			interactive: false,
			childEnvVar: "CLINE_TEST_CONNECT_CHILD",
			statePath: "/tmp/test-connector.json",
			readState: options?.readState ?? (() => undefined),
			isRunning: options?.isRunning ?? (() => false),
			formatAlreadyRunningMessage: () => "already running",
			formatBackgroundStartMessage: (pid) => `started ${pid}`,
			foregroundHint: "foreground hint",
			launchFailureMessage: "launch failed",
			startupTimeoutMs: options?.startupTimeoutMs,
		});
	}

	stopProcess(
		io: ConnectIo,
		options: {
			statePath: string;
			readState: (path: string) => { pid: number } | undefined;
			stopSessions?: (state: { pid: number }) => Promise<number>;
			clearBindings?: (state: { pid: number }) => void;
		},
	) {
		return this.stopManagedProcess({
			io,
			statePath: options.statePath,
			readState: options.readState,
			describeStoppedProcess: (state) => `stopped pid=${state.pid}`,
			getPid: (state) => state.pid,
			stopSessions: options.stopSessions ?? (async () => 0),
			clearBindings: options.clearBindings,
		});
	}
}

describe("ConnectorBase background launch", () => {
	const io: ConnectIo = {
		writeln: vi.fn(),
		writeErr: vi.fn(),
	};

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.isProcessRunning.mockReturnValue(true);
		mocks.terminateProcess.mockResolvedValue(true);
	});

	it("returns a failure exit code when the detached process is not created", async () => {
		mocks.spawnDetachedConnector.mockReturnValue(0);

		await expect(new TestConnector().runBackground(io)).resolves.toBe(1);
		expect(io.writeErr).toHaveBeenCalledWith("launch failed");
	});

	it("returns success only after a detached process receives a pid", async () => {
		mocks.spawnDetachedConnector.mockReturnValue(42);
		let reads = 0;

		await expect(
			new TestConnector().runBackground(io, {
				readState: () => (++reads > 1 ? { pid: 42 } : undefined),
				isRunning: () => true,
			}),
		).resolves.toBe(0);
		expect(io.writeln).toHaveBeenCalledWith("started 42");
	});

	it("fails when the detached child exits before becoming ready", async () => {
		mocks.spawnDetachedConnector.mockReturnValue(42);
		mocks.isProcessRunning.mockReturnValue(false);

		await expect(new TestConnector().runBackground(io)).resolves.toBe(1);

		expect(io.writeErr).toHaveBeenCalledWith(
			expect.stringContaining(
				"launch failed: child exited before becoming ready",
			),
		);
	});

	it("points at the child log so a startup failure is diagnosable", async () => {
		mocks.spawnDetachedConnector.mockReturnValue(42);
		mocks.isProcessRunning.mockReturnValue(false);

		await new TestConnector().runBackground(io);

		const [message] = vi.mocked(io.writeErr).mock.calls[0] ?? [];
		expect(message).toContain("logs/connectors/test/test-connector.log");
		expect(mocks.spawnDetachedConnector).toHaveBeenCalledWith(
			["connect", "test"],
			["--token", "secret"],
			"CLINE_TEST_CONNECT_CHILD",
			expect.objectContaining({
				logPath: expect.stringContaining(
					"logs/connectors/test/test-connector.log",
				),
			}),
		);
	});

	it("terminates a detached child that never becomes ready", async () => {
		mocks.spawnDetachedConnector.mockReturnValue(42);

		await expect(
			new TestConnector().runBackground(io, { startupTimeoutMs: 0 }),
		).resolves.toBe(1);

		expect(mocks.terminateProcess).toHaveBeenCalledWith(42);
		expect(io.writeErr).toHaveBeenCalledWith(
			expect.stringContaining("launch failed: timed out after 0ms"),
		);
	});

	it("returns a distinct result when a connector is already running", async () => {
		await expect(
			new TestConnector().runBackground(io, {
				readState: () => ({ pid: 99 }),
				isRunning: () => true,
			}),
		).resolves.toBe(CONNECT_ALREADY_RUNNING_EXIT_CODE);

		expect(io.writeln).toHaveBeenCalledWith("already running");
		expect(mocks.spawnDetachedConnector).not.toHaveBeenCalled();
	});

	it("keeps state and reports failure when the process survives termination", async () => {
		const connector = new TestConnector();
		const removeStateFile = vi.spyOn(
			connector as unknown as { removeStateFile: (path: string) => void },
			"removeStateFile",
		);
		const stopSessions = vi.fn(async () => 1);
		const clearBindings = vi.fn();
		mocks.terminateProcess.mockResolvedValue(false);
		mocks.isProcessRunning.mockReturnValue(true);

		await expect(
			connector.stopProcess(io, {
				statePath: "/tmp/test-connector.json",
				readState: () => ({ pid: 42 }),
				stopSessions,
				clearBindings,
			}),
		).resolves.toEqual({
			stoppedProcesses: 0,
			failedProcesses: 1,
			stoppedSessions: 0,
		});

		expect(removeStateFile).not.toHaveBeenCalled();
		expect(stopSessions).not.toHaveBeenCalled();
		expect(clearBindings).not.toHaveBeenCalled();
		expect(io.writeErr).toHaveBeenCalledWith(
			"[connect] failed to stop connector process pid=42",
		);
	});

	it("cleans stale state after confirming the process is already gone", async () => {
		const connector = new TestConnector();
		const removeStateFile = vi.spyOn(
			connector as unknown as { removeStateFile: (path: string) => void },
			"removeStateFile",
		);
		const stopSessions = vi.fn(async () => 1);
		const clearBindings = vi.fn();
		mocks.terminateProcess.mockResolvedValue(false);
		mocks.isProcessRunning.mockReturnValue(false);

		await expect(
			connector.stopProcess(io, {
				statePath: "/tmp/test-connector.json",
				readState: () => ({ pid: 42 }),
				stopSessions,
				clearBindings,
			}),
		).resolves.toEqual({
			stoppedProcesses: 0,
			failedProcesses: 0,
			stoppedSessions: 1,
		});

		expect(removeStateFile).toHaveBeenCalledWith("/tmp/test-connector.json");
		expect(stopSessions).toHaveBeenCalledWith({ pid: 42 });
		expect(clearBindings).toHaveBeenCalledWith({ pid: 42 });
	});
});
