import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLINE_CONNECTOR_DETACHED_CHILD_ENV } from "../connectors/common";
import type { ConnectIo } from "../connectors/types";
import { runConnectAdapter } from "./connect";

const mocks = vi.hoisted(() => ({
	disableConnectorAutostart: vi.fn(),
	getConnector: vi.fn(),
	persistConnectorConnection: vi.fn(),
	run: vi.fn(),
}));

vi.mock("@cline/core", () => ({
	disableConnectorAutostart: mocks.disableConnectorAutostart,
	persistConnectorConnection: mocks.persistConnectorConnection,
}));

vi.mock("../connectors/registry", () => ({
	getConnector: mocks.getConnector,
	listConnectors: vi.fn(() => []),
}));

describe("runConnectAdapter", () => {
	const previousDetachedChild = process.env[CLINE_CONNECTOR_DETACHED_CHILD_ENV];
	const io: ConnectIo = {
		writeln: vi.fn(),
		writeErr: vi.fn(),
	};

	beforeEach(() => {
		vi.clearAllMocks();
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
});
