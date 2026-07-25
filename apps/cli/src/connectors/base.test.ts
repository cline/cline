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
			"launch failed: child exited before becoming ready",
		);
	});

	it("terminates a detached child that never becomes ready", async () => {
		mocks.spawnDetachedConnector.mockReturnValue(42);

		await expect(
			new TestConnector().runBackground(io, { startupTimeoutMs: 0 }),
		).resolves.toBe(1);

		expect(mocks.terminateProcess).toHaveBeenCalledWith(42);
		expect(io.writeErr).toHaveBeenCalledWith(
			"launch failed: timed out after 0ms",
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
});
