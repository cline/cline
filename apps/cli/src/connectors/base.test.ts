import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectorBase } from "./base";
import type { ConnectIo } from "./types";

const mocks = vi.hoisted(() => ({
	spawnDetachedConnector: vi.fn(),
}));

vi.mock("./common", async (importOriginal) => ({
	...(await importOriginal<typeof import("./common")>()),
	spawnDetachedConnector: mocks.spawnDetachedConnector,
}));

class TestConnector extends ConnectorBase<Record<string, never>, never> {
	constructor() {
		super("test", "Test connector");
	}

	protected readOptions(): Record<string, never> {
		return {};
	}

	protected async runWithOptions(): Promise<number> {
		return 0;
	}

	runBackground(io: ConnectIo): Promise<number | undefined> {
		return this.maybeRunInBackground({
			rawArgs: ["--token", "secret"],
			io,
			interactive: false,
			childEnvVar: "CLINE_TEST_CONNECT_CHILD",
			statePath: "/tmp/test-connector.json",
			readState: () => undefined,
			isRunning: () => false,
			formatAlreadyRunningMessage: () => "already running",
			formatBackgroundStartMessage: (pid) => `started ${pid}`,
			foregroundHint: "foreground hint",
			launchFailureMessage: "launch failed",
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
	});

	it("returns a failure exit code when the detached process is not created", async () => {
		mocks.spawnDetachedConnector.mockReturnValue(0);

		await expect(new TestConnector().runBackground(io)).resolves.toBe(1);
		expect(io.writeErr).toHaveBeenCalledWith("launch failed");
	});

	it("returns success only after a detached process receives a pid", async () => {
		mocks.spawnDetachedConnector.mockReturnValue(42);

		await expect(new TestConnector().runBackground(io)).resolves.toBe(0);
		expect(io.writeln).toHaveBeenCalledWith("started 42");
	});
});
