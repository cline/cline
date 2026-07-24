import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	CLINE_CONNECTOR_DETACHED_CHILD_ENV,
	CONNECT_ALREADY_RUNNING_EXIT_CODE,
} from "../connectors/common";
import type { ConnectIo, ConnectRunContext } from "../connectors/types";
import {
	runConnectAdapter,
	runStopAllConnectors,
	stopAllConnectors,
} from "./connect";

const mocks = vi.hoisted(() => ({
	disableConnectorAutostart: vi.fn(),
	getConnector: vi.fn(),
	listConnectors: vi.fn((): Array<{ name: string; description: string }> => []),
	persistConnectorConnection: vi.fn(),
	run: vi.fn(),
}));

vi.mock("@cline/core", () => ({
	disableConnectorAutostart: mocks.disableConnectorAutostart,
	persistConnectorConnection: mocks.persistConnectorConnection,
}));

vi.mock("../connectors/registry", () => ({
	getConnector: mocks.getConnector,
	listConnectors: mocks.listConnectors,
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
		mocks.run.mockResolvedValue(0);
		mocks.getConnector.mockResolvedValue({
			name: "telegram",
			description: "Telegram",
			run: mocks.run,
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

		expect(mocks.persistConnectorConnection).toHaveBeenCalledWith("telegram", [
			"-k",
			"token",
		]);
		expect(mocks.disableConnectorAutostart).not.toHaveBeenCalled();
	});

	it("persists a successful env-only connector start", async () => {
		await expect(runConnectAdapter("telegram", [], io)).resolves.toBe(0);

		expect(mocks.persistConnectorConnection).toHaveBeenCalledWith(
			"telegram",
			[],
		);
		expect(mocks.disableConnectorAutostart).not.toHaveBeenCalled();
	});

	it("persists connector-resolved launch arguments", async () => {
		mocks.run.mockImplementation(
			async (_args: string[], _io: ConnectIo, context: ConnectRunContext) => {
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

		expect(mocks.persistConnectorConnection).toHaveBeenCalledWith("telegram", [
			"--bot-token",
			"token",
			"--bot-username",
			"resolved_bot",
		]);
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
		expect(mocks.disableConnectorAutostart).toHaveBeenCalledWith("telegram");
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
			stoppedSessions: 2,
			executed: 1,
		});

		expect(stopAll).toHaveBeenCalledWith(io);
		expect(mocks.disableConnectorAutostart).not.toHaveBeenCalled();
	});

	it("disables autostart for an explicit stop-all command", async () => {
		const stopAll = vi.fn().mockResolvedValue({
			stoppedProcesses: 1,
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
});
