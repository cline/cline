import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	CLINE_CONNECTOR_DETACHED_CHILD_ENV,
	CONNECT_ALREADY_RUNNING_EXIT_CODE,
} from "../connectors/common";
import type { ConnectIo, ConnectRunContext } from "../connectors/types";
import {
	runCleanupConnectorInstance,
	runConnectAdapter,
	runRestartConnector,
	runStopAllConnectors,
	stopAllConnectors,
} from "./connect";

const mocks = vi.hoisted(() => ({
	startConnectorViaHub: vi.fn(),
	stopConnectorsViaHub: vi.fn(async () => undefined as number | undefined),
	disableConnectorAutostart: vi.fn(),
	getPersistedConnectorConnection: vi.fn(),
	getProcessStartToken: vi.fn(() => undefined),
	getConnector: vi.fn(),
	listActiveConnectors: vi.fn(),
	listConnectors: vi.fn((): Array<{ name: string; description: string }> => []),
	persistConnectorConnection: vi.fn(),
	removePersistedConnectorConnection: vi.fn(),
	run: vi.fn(),
	validate: vi.fn(),
}));

vi.mock("@cline/core", () => ({
	disableConnectorAutostart: mocks.disableConnectorAutostart,
	getPersistedConnectorConnection: mocks.getPersistedConnectorConnection,
	getProcessStartToken: mocks.getProcessStartToken,
	listActiveConnectors: mocks.listActiveConnectors,
	persistConnectorConnection: mocks.persistConnectorConnection,
	removePersistedConnectorConnection: mocks.removePersistedConnectorConnection,
}));

vi.mock("../connectors/registry", () => ({
	getConnector: mocks.getConnector,
	listConnectors: mocks.listConnectors,
}));

vi.mock("./connect-via-hub", () => ({
	startConnectorViaHub: mocks.startConnectorViaHub,
	stopConnectorsViaHub: mocks.stopConnectorsViaHub,
}));

describe("runConnectAdapter", () => {
	const previousDetachedChild = process.env[CLINE_CONNECTOR_DETACHED_CHILD_ENV];
	const io: ConnectIo = {
		writeln: vi.fn(),
		writeErr: vi.fn(),
	};

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.listConnectors.mockReturnValue([]);
		mocks.listActiveConnectors.mockReturnValue([]);
		mocks.run.mockImplementation(
			async (_args: string[], _io: ConnectIo, context: ConnectRunContext) => {
				context.setPersistenceInstanceId("cline_bot");
				return 0;
			},
		);
		mocks.validate.mockResolvedValue(0);
		mocks.getConnector.mockResolvedValue({
			name: "telegram",
			description: "Telegram",
			run: mocks.run,
			validate: mocks.validate,
			showHelp: vi.fn(),
		});
	});

	afterEach(() => {
		if (previousDetachedChild === undefined) {
			delete process.env[CLINE_CONNECTOR_DETACHED_CHILD_ENV];
		} else {
			process.env[CLINE_CONNECTOR_DETACHED_CHILD_ENV] = previousDetachedChild;
		}
	});

	it("persists a successful detached connector start", async () => {
		await expect(
			runConnectAdapter("telegram", ["-k", "token"], io),
		).resolves.toBe(0);

		expect(mocks.persistConnectorConnection).toHaveBeenCalledWith(
			"telegram",
			"cline_bot",
			["-k", "token"],
		);
		expect(mocks.disableConnectorAutostart).not.toHaveBeenCalled();
	});

	it("persists a successful env-only connector start", async () => {
		await expect(runConnectAdapter("telegram", [], io)).resolves.toBe(0);

		expect(mocks.persistConnectorConnection).toHaveBeenCalledWith(
			"telegram",
			"cline_bot",
			[],
		);
		expect(mocks.disableConnectorAutostart).not.toHaveBeenCalled();
	});

	it("persists connector-resolved launch arguments", async () => {
		mocks.run.mockImplementation(
			async (_args: string[], _io: ConnectIo, context: ConnectRunContext) => {
				context.setPersistenceInstanceId("resolved_bot");
				context.setPersistenceArgs([
					"--bot-token",
					"token",
					"--bot-username",
					"resolved_bot",
				]);
				return 0;
			},
		);

		await expect(
			runConnectAdapter("telegram", ["--bot-token", "token"], io),
		).resolves.toBe(0);

		expect(mocks.persistConnectorConnection).toHaveBeenCalledWith(
			"telegram",
			"resolved_bot",
			["--bot-token", "token", "--bot-username", "resolved_bot"],
		);
	});

	it("does not rewrite persistence when a connector is already running", async () => {
		mocks.run.mockResolvedValue(CONNECT_ALREADY_RUNNING_EXIT_CODE);

		await expect(
			runConnectAdapter("telegram", ["-k", "token"], io),
		).resolves.toBe(0);

		expect(mocks.persistConnectorConnection).not.toHaveBeenCalled();
		expect(mocks.disableConnectorAutostart).not.toHaveBeenCalled();
	});

	it.each([
		"-i",
		"--interactive",
	])("disables autostart after a successful %s foreground run exits", async (interactiveFlag) => {
		await expect(
			runConnectAdapter("telegram", ["-k", "token", interactiveFlag], io),
		).resolves.toBe(0);

		expect(mocks.persistConnectorConnection).not.toHaveBeenCalled();
		expect(mocks.disableConnectorAutostart).toHaveBeenCalledWith(
			"telegram",
			"cline_bot",
		);
	});

	it("does not change persistence after a failed foreground run", async () => {
		mocks.run.mockResolvedValue(1);

		await expect(
			runConnectAdapter("telegram", ["-k", "token", "-i"], io),
		).resolves.toBe(1);

		expect(mocks.persistConnectorConnection).not.toHaveBeenCalled();
		expect(mocks.disableConnectorAutostart).not.toHaveBeenCalled();
	});

	it("does not persist a failed detached launch", async () => {
		mocks.run.mockResolvedValue(1);

		await expect(
			runConnectAdapter("telegram", ["-k", "token"], io),
		).resolves.toBe(1);

		expect(mocks.persistConnectorConnection).not.toHaveBeenCalled();
		expect(mocks.disableConnectorAutostart).not.toHaveBeenCalled();
	});

	it("leaves persistence unchanged when an internal detached child exits", async () => {
		process.env[CLINE_CONNECTOR_DETACHED_CHILD_ENV] = "1";

		await expect(
			runConnectAdapter("telegram", ["-k", "token", "-i"], io),
		).resolves.toBe(0);

		expect(mocks.persistConnectorConnection).not.toHaveBeenCalled();
		expect(mocks.disableConnectorAutostart).not.toHaveBeenCalled();
	});

	it("does not persist help invocations", async () => {
		await expect(runConnectAdapter("telegram", ["--help"], io)).resolves.toBe(
			0,
		);

		expect(mocks.persistConnectorConnection).not.toHaveBeenCalled();
		expect(mocks.disableConnectorAutostart).not.toHaveBeenCalled();
	});

	it("leaves autostart unchanged during shared process cleanup", async () => {
		const stopAll = vi.fn().mockResolvedValue({
			stoppedProcesses: 1,
			failedProcesses: 0,
			stoppedSessions: 2,
		});
		mocks.listConnectors.mockReturnValue([
			{ name: "telegram", description: "Telegram" },
		]);
		mocks.getConnector.mockResolvedValue({
			name: "telegram",
			description: "Telegram",
			run: mocks.run,
			showHelp: vi.fn(),
			stopAll,
		});

		await expect(stopAllConnectors(io)).resolves.toEqual({
			stoppedProcesses: 1,
			failedProcesses: 0,
			stoppedSessions: 2,
			executed: 1,
		});

		expect(stopAll).toHaveBeenCalledWith(io);
		expect(mocks.disableConnectorAutostart).not.toHaveBeenCalled();
	});

	it("disables autostart for an explicit stop-all command", async () => {
		const stopAll = vi.fn().mockResolvedValue({
			stoppedProcesses: 1,
			failedProcesses: 0,
			stoppedSessions: 2,
		});
		mocks.listConnectors.mockReturnValue([
			{ name: "telegram", description: "Telegram" },
		]);
		mocks.getConnector.mockResolvedValue({
			name: "telegram",
			description: "Telegram",
			run: mocks.run,
			showHelp: vi.fn(),
			stopAll,
		});

		await expect(runStopAllConnectors(io)).resolves.toBe(0);

		expect(stopAll).toHaveBeenCalledWith(io);
		expect(mocks.disableConnectorAutostart).toHaveBeenCalledWith();
	});

	it("validates a replacement before stopping the active instance", async () => {
		const stopInstance = vi.fn().mockResolvedValue({
			stoppedProcesses: 1,
			failedProcesses: 0,
			stoppedSessions: 0,
		});
		mocks.validate.mockResolvedValue(1);
		mocks.listActiveConnectors.mockReturnValue([
			{
				id: "telegram:cline_bot",
				type: "telegram",
				instanceId: "cline_bot",
				pid: 123,
				hubUrl: "ws://127.0.0.1:4317",
				botUsername: "cline_bot",
			},
		]);
		mocks.getConnector.mockResolvedValue({
			name: "telegram",
			description: "Telegram",
			run: mocks.run,
			validate: mocks.validate,
			showHelp: vi.fn(),
			stopInstance,
		});

		await expect(
			runRestartConnector("telegram", ["-k", "bad-token"], io),
		).resolves.toBe(1);

		expect(mocks.validate).toHaveBeenCalledWith(["-k", "bad-token"], io);
		expect(stopInstance).not.toHaveBeenCalled();
		expect(mocks.run).not.toHaveBeenCalled();
	});

	it("shows restart help without stopping an active instance", async () => {
		const stopInstance = vi.fn().mockResolvedValue({
			stoppedProcesses: 1,
			failedProcesses: 0,
			stoppedSessions: 0,
		});
		mocks.listActiveConnectors.mockReturnValue([
			{
				id: "telegram:cline_bot",
				type: "telegram",
				instanceId: "cline_bot",
				pid: 123,
				hubUrl: "ws://127.0.0.1:4317",
				botUsername: "cline_bot",
			},
		]);
		mocks.getConnector.mockResolvedValue({
			name: "telegram",
			description: "Telegram",
			run: mocks.run,
			validate: mocks.validate,
			showHelp: vi.fn(),
			stopInstance,
		});

		await expect(runRestartConnector("telegram", ["--help"], io)).resolves.toBe(
			0,
		);

		expect(mocks.run).toHaveBeenCalledWith(["--help"], io, expect.any(Object));
		expect(mocks.validate).not.toHaveBeenCalled();
		expect(stopInstance).not.toHaveBeenCalled();
	});

	it("restores the last successful launch when a replacement fails", async () => {
		const stopInstance = vi.fn().mockResolvedValue({
			stoppedProcesses: 1,
			failedProcesses: 0,
			stoppedSessions: 0,
		});
		mocks.listActiveConnectors.mockReturnValue([
			{
				id: "telegram:cline_bot",
				type: "telegram",
				instanceId: "cline_bot",
				pid: 123,
				hubUrl: "ws://127.0.0.1:4317",
				botUsername: "cline_bot",
			},
		]);
		mocks.getPersistedConnectorConnection.mockReturnValue({
			channel: "telegram",
			instanceId: "cline_bot",
			connectArgs: ["-k", "new-token"],
			lastSuccessfulArgs: ["-k", "old-token"],
			enabled: true,
			updatedAt: "2026-07-25T00:00:00.000Z",
			lastConnectedAt: "2026-07-25T00:00:00.000Z",
		});
		mocks.run
			.mockResolvedValueOnce(1)
			.mockImplementationOnce(
				async (_args: string[], _io: ConnectIo, context: ConnectRunContext) => {
					context.setPersistenceInstanceId("cline_bot");
					return 0;
				},
			);
		mocks.getConnector.mockResolvedValue({
			name: "telegram",
			description: "Telegram",
			run: mocks.run,
			validate: mocks.validate,
			showHelp: vi.fn(),
			stopInstance,
		});

		await expect(
			runRestartConnector("telegram", ["-k", "new-token"], io),
		).resolves.toBe(1);

		expect(stopInstance).toHaveBeenCalledWith("cline_bot", io);
		expect(mocks.run).toHaveBeenNthCalledWith(
			1,
			["-k", "new-token"],
			io,
			expect.any(Object),
		);
		expect(mocks.run).toHaveBeenNthCalledWith(
			2,
			["-k", "old-token"],
			io,
			expect.any(Object),
		);
		expect(mocks.disableConnectorAutostart).not.toHaveBeenCalled();
		expect(mocks.persistConnectorConnection).toHaveBeenCalledWith(
			"telegram",
			"cline_bot",
			["-k", "old-token"],
		);
	});

	it("restarts an active instance without persisted rollback arguments", async () => {
		const stopInstance = vi.fn().mockResolvedValue({
			stoppedProcesses: 1,
			failedProcesses: 0,
			stoppedSessions: 0,
		});
		mocks.listActiveConnectors.mockReturnValue([
			{
				id: "telegram:cline_bot",
				type: "telegram",
				instanceId: "cline_bot",
				pid: 123,
				hubUrl: "ws://127.0.0.1:4317",
				botUsername: "cline_bot",
			},
		]);
		mocks.getPersistedConnectorConnection.mockReturnValue(undefined);
		mocks.getConnector.mockResolvedValue({
			name: "telegram",
			description: "Telegram",
			run: mocks.run,
			validate: mocks.validate,
			showHelp: vi.fn(),
			stopInstance,
		});

		await expect(
			runRestartConnector("telegram", ["-k", "new-token"], io),
		).resolves.toBe(0);

		expect(stopInstance).toHaveBeenCalledWith("cline_bot", io);
		expect(mocks.run).toHaveBeenCalledWith(
			["-k", "new-token"],
			io,
			expect.any(Object),
		);
	});

	it("does not start a replacement when the active process cannot be stopped", async () => {
		const stopInstance = vi.fn().mockResolvedValue({
			stoppedProcesses: 0,
			failedProcesses: 1,
			stoppedSessions: 0,
		});
		mocks.listActiveConnectors.mockReturnValue([
			{
				id: "telegram:cline_bot",
				type: "telegram",
				instanceId: "cline_bot",
				pid: 123,
				hubUrl: "ws://127.0.0.1:4317",
				botUsername: "cline_bot",
			},
		]);
		mocks.getConnector.mockResolvedValue({
			name: "telegram",
			description: "Telegram",
			run: mocks.run,
			validate: mocks.validate,
			showHelp: vi.fn(),
			stopInstance,
		});

		await expect(
			runRestartConnector("telegram", ["-k", "new-token"], io),
		).resolves.toBe(1);

		expect(stopInstance).toHaveBeenCalledWith("cline_bot", io);
		expect(mocks.run).not.toHaveBeenCalled();
	});

	it("does not count an already-running instance as a successful replacement", async () => {
		const stopInstance = vi.fn().mockResolvedValue({
			stoppedProcesses: 1,
			failedProcesses: 0,
			stoppedSessions: 0,
		});
		mocks.listActiveConnectors.mockReturnValue([
			{
				id: "telegram:cline_bot",
				type: "telegram",
				instanceId: "cline_bot",
				pid: 123,
				hubUrl: "ws://127.0.0.1:4317",
				botUsername: "cline_bot",
			},
		]);
		mocks.getPersistedConnectorConnection.mockReturnValue({
			channel: "telegram",
			instanceId: "cline_bot",
			connectArgs: ["-k", "new-token"],
			lastSuccessfulArgs: ["-k", "old-token"],
			enabled: true,
			updatedAt: "2026-07-25T00:00:00.000Z",
			lastConnectedAt: "2026-07-25T00:00:00.000Z",
		});
		mocks.run.mockResolvedValue(CONNECT_ALREADY_RUNNING_EXIT_CODE);
		mocks.getConnector.mockResolvedValue({
			name: "telegram",
			description: "Telegram",
			run: mocks.run,
			validate: mocks.validate,
			showHelp: vi.fn(),
			stopInstance,
		});

		await expect(
			runRestartConnector("telegram", ["-k", "new-token"], io),
		).resolves.toBe(1);

		expect(mocks.run).toHaveBeenCalledTimes(1);
		expect(io.writeErr).toHaveBeenCalledWith(
			"[connect] replacement was not started because telegram instance cline_bot is still running",
		);
		expect(mocks.persistConnectorConnection).not.toHaveBeenCalled();
	});
});

describe("runCleanupConnectorInstance", () => {
	const io: ConnectIo = {
		writeln: vi.fn(),
		writeErr: vi.fn(),
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("reaps one instance without disabling its autostart", async () => {
		const stopInstance = vi.fn().mockResolvedValue({
			stoppedProcesses: 0,
			failedProcesses: 0,
			stoppedSessions: 2,
		});
		mocks.getConnector.mockResolvedValue({
			name: "slack",
			description: "Slack",
			run: mocks.run,
			validate: mocks.validate,
			showHelp: vi.fn(),
			stopInstance,
		});

		await expect(
			runCleanupConnectorInstance("slack", "cline-slack", io),
		).resolves.toBe(0);

		expect(stopInstance).toHaveBeenCalledWith("cline-slack", io);
		// The instance crashed; it was not retired. Disabling autostart here would
		// make every crash silently opt the connector out of supervision.
		expect(mocks.disableConnectorAutostart).not.toHaveBeenCalled();
	});

	it("reports a failed reap", async () => {
		mocks.getConnector.mockResolvedValue({
			name: "slack",
			description: "Slack",
			run: mocks.run,
			validate: mocks.validate,
			showHelp: vi.fn(),
			stopInstance: vi.fn().mockResolvedValue({
				stoppedProcesses: 0,
				failedProcesses: 1,
				stoppedSessions: 0,
			}),
		});

		await expect(
			runCleanupConnectorInstance("slack", "cline-slack", io),
		).resolves.toBe(1);
	});

	it("rejects an adapter without per-instance stop", async () => {
		mocks.getConnector.mockResolvedValue({
			name: "slack",
			description: "Slack",
			run: mocks.run,
			validate: mocks.validate,
			showHelp: vi.fn(),
		});

		await expect(
			runCleanupConnectorInstance("slack", "cline-slack", io),
		).resolves.toBe(1);
		expect(io.writeErr).toHaveBeenCalledWith(
			'connect adapter "slack" does not support per-instance stop',
		);
	});

	it("rejects an unknown adapter", async () => {
		mocks.getConnector.mockResolvedValue(undefined);

		await expect(
			runCleanupConnectorInstance("nope", "instance", io),
		).resolves.toBe(1);
		expect(io.writeErr).toHaveBeenCalledWith('unknown connect adapter "nope"');
	});
});

describe("hub-delegated connector starts", () => {
	const io: ConnectIo = { writeln: vi.fn(), writeErr: vi.fn() };

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.listConnectors.mockReturnValue([]);
		mocks.listActiveConnectors.mockReturnValue([]);
		mocks.validate.mockResolvedValue(0);
		mocks.run.mockResolvedValue(0);
		mocks.getConnector.mockResolvedValue({
			name: "slack",
			description: "Slack",
			run: mocks.run,
			validate: mocks.validate,
			showHelp: vi.fn(),
			resolveInstanceId: () => "cline-slack",
		});
		mocks.startConnectorViaHub.mockResolvedValue({
			delegated: true,
			exitCode: 0,
		});
	});

	afterEach(() => {
		delete process.env.CLINE_CONNECTOR_SUPERVISED;
	});

	it("asks the hub to own a background connector and records the intent", async () => {
		await expect(
			runConnectAdapter("slack", ["--bot-token", "xoxb"], io),
		).resolves.toBe(0);

		expect(mocks.startConnectorViaHub).toHaveBeenCalledWith(
			expect.objectContaining({
				channel: "slack",
				instanceId: "cline-slack",
				args: ["--bot-token", "xoxb"],
			}),
		);
		// The adapter must not also run here: the hub owns the process now.
		expect(mocks.run).not.toHaveBeenCalled();
		expect(mocks.persistConnectorConnection).toHaveBeenCalledWith(
			"slack",
			"cline-slack",
			["--bot-token", "xoxb"],
		);
	});

	it("runs locally for a foreground connector", async () => {
		await runConnectAdapter("slack", ["--bot-token", "xoxb", "-i"], io);

		expect(mocks.startConnectorViaHub).not.toHaveBeenCalled();
		expect(mocks.run).toHaveBeenCalled();
	});

	it("runs locally inside a supervised process instead of asking the hub again", async () => {
		process.env.CLINE_CONNECTOR_SUPERVISED = "1";

		await runConnectAdapter("slack", ["--bot-token", "xoxb"], io);

		// Delegating here would send the hub straight back to spawning this same
		// process.
		expect(mocks.startConnectorViaHub).not.toHaveBeenCalled();
		expect(mocks.run).toHaveBeenCalled();
	});

	it("runs locally when the instance id cannot be known up front", async () => {
		mocks.getConnector.mockResolvedValue({
			name: "telegram",
			description: "Telegram",
			run: mocks.run,
			validate: mocks.validate,
			showHelp: vi.fn(),
			resolveInstanceId: () => undefined,
		});

		await runConnectAdapter("telegram", ["-k", "token"], io);

		expect(mocks.startConnectorViaHub).not.toHaveBeenCalled();
		expect(mocks.run).toHaveBeenCalled();
	});

	it("falls back to a local start when the hub declines", async () => {
		mocks.startConnectorViaHub.mockResolvedValue({
			delegated: false,
			reason: "hub does not support connector supervision",
		});

		await runConnectAdapter("slack", ["--bot-token", "xoxb"], io);

		expect(mocks.run).toHaveBeenCalled();
	});

	it("does not validate or delegate a help invocation", async () => {
		await runConnectAdapter("slack", ["--help"], io);

		expect(mocks.startConnectorViaHub).not.toHaveBeenCalled();
		expect(mocks.validate).not.toHaveBeenCalled();
	});

	it("reports a validation failure without contacting the hub", async () => {
		mocks.validate.mockResolvedValue(2);

		await expect(
			runConnectAdapter("slack", ["--bot-token", "bad"], io),
		).resolves.toBe(2);
		expect(mocks.startConnectorViaHub).not.toHaveBeenCalled();
		expect(mocks.run).not.toHaveBeenCalled();
	});
});
