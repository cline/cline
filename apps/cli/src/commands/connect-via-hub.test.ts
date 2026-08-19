import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectIo } from "../connectors/types";

const mocks = vi.hoisted(() => ({
	ensureDetachedHubServer: vi.fn(),
	readHubDiscovery: vi.fn(),
	connect: vi.fn(),
	command: vi.fn(),
	close: vi.fn(),
	clientOptions: vi.fn(),
}));

vi.mock("@cline/core", () => ({
	ensureDetachedHubServer: mocks.ensureDetachedHubServer,
	readHubDiscovery: mocks.readHubDiscovery,
	resolveProductionHubOwnerContext: () => ({
		ownerId: "hub-production",
		discoveryPath: "/tmp/production.json",
	}),
	resolveSharedHubOwnerContext: () => ({
		ownerId: "hub-owner",
		discoveryPath: "/tmp/owner.json",
	}),
	NodeHubClient: class {
		constructor(options: unknown) {
			mocks.clientOptions(options);
		}
		connect = mocks.connect;
		command = mocks.command;
		close = mocks.close;
	},
}));

import { startConnectorViaHub, stopConnectorsViaHub } from "./connect-via-hub";

describe("startConnectorViaHub", () => {
	const io: ConnectIo = { writeln: vi.fn(), writeErr: vi.fn() };

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.ensureDetachedHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "token",
		});
		mocks.readHubDiscovery.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			capabilities: ["session.create", "connector.start"],
		});
		mocks.connect.mockResolvedValue(undefined);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	function startRequest(overrides: Record<string, unknown> = {}) {
		return {
			channel: "slack",
			instanceId: "cline-slack",
			args: ["--bot-token", "xoxb"],
			io,
			cwd: "/workspace",
			...overrides,
		};
	}

	it("hands the start to the hub and reports supervision", async () => {
		mocks.command.mockResolvedValue({
			version: "v1",
			ok: true,
			payload: {
				started: true,
				record: { pid: 4242, state: "running" },
			},
		});

		await expect(startConnectorViaHub(startRequest())).resolves.toEqual({
			delegated: true,
			exitCode: 0,
		});
		expect(mocks.command).toHaveBeenCalledWith("connector.start", {
			channel: "slack",
			instanceId: "cline-slack",
			args: ["--bot-token", "xoxb"],
			restart: false,
		});
		expect(io.writeln).toHaveBeenCalledWith(
			expect.stringContaining("started under hub supervision pid=4242"),
		);
		expect(mocks.close).toHaveBeenCalled();
	});

	it("passes a restart through", async () => {
		mocks.command.mockResolvedValue({
			version: "v1",
			ok: true,
			payload: { started: true, record: { state: "running" } },
		});

		await startConnectorViaHub(startRequest({ restart: true }));

		expect(mocks.command).toHaveBeenCalledWith(
			"connector.start",
			expect.objectContaining({ restart: true }),
		);
	});

	it("treats an already-running instance as success", async () => {
		mocks.command.mockResolvedValue({
			version: "v1",
			ok: true,
			payload: {
				started: false,
				reason: "already_running",
				record: { pid: 99, state: "running" },
			},
		});

		await expect(startConnectorViaHub(startRequest())).resolves.toEqual({
			delegated: true,
			exitCode: 0,
		});
		expect(io.writeln).toHaveBeenCalledWith(
			expect.stringContaining("already running under the hub"),
		);
	});

	it("falls back when the hub cannot be reached", async () => {
		mocks.ensureDetachedHubServer.mockRejectedValue(new Error("EADDRINUSE"));

		const outcome = await startConnectorViaHub(startRequest());

		expect(outcome.delegated).toBe(false);
		expect(mocks.command).not.toHaveBeenCalled();
	});

	it("falls back when a running hub predates connector supervision", async () => {
		// The normal state of a long-lived host mid-upgrade: a new CLI, an old hub.
		mocks.readHubDiscovery.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			capabilities: ["session.create"],
		});

		const outcome = await startConnectorViaHub(startRequest());

		expect(outcome).toEqual({
			delegated: false,
			reason: "hub does not support connector supervision",
		});
		expect(mocks.command).not.toHaveBeenCalled();
	});

	it("falls back when the hub reports supervision unavailable", async () => {
		mocks.command.mockResolvedValue({
			version: "v1",
			ok: false,
			error: {
				code: "connector_command_failed",
				message: "connector supervision is unavailable in this hub",
			},
		});

		const outcome = await startConnectorViaHub(startRequest());

		expect(outcome.delegated).toBe(false);
	});

	it("falls back when the hub command throws", async () => {
		mocks.command.mockRejectedValue(new Error("socket closed"));

		const outcome = await startConnectorViaHub(startRequest());

		expect(outcome.delegated).toBe(false);
		expect(mocks.close).toHaveBeenCalled();
	});

	it("surfaces a genuine start refusal instead of starting locally", async () => {
		mocks.command.mockResolvedValue({
			version: "v1",
			ok: false,
			error: {
				code: "connector_command_failed",
				message: "instanceId is required",
			},
		});

		await expect(startConnectorViaHub(startRequest())).resolves.toEqual({
			delegated: true,
			exitCode: 1,
		});
		expect(io.writeErr).toHaveBeenCalledWith(
			expect.stringContaining("hub refused to start slack"),
		);
	});

	it("reports a hub that accepted the command but did not start anything", async () => {
		mocks.command.mockResolvedValue({
			version: "v1",
			ok: true,
			payload: {
				started: false,
				record: { state: "failed", lastError: "bad token" },
			},
		});

		await expect(startConnectorViaHub(startRequest())).resolves.toEqual({
			delegated: true,
			exitCode: 1,
		});
		expect(io.writeErr).toHaveBeenCalledWith(
			expect.stringContaining("bad token"),
		);
	});
});

describe("stopConnectorsViaHub", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.readHubDiscovery.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			capabilities: [
				"connector.start",
				"connector.stop",
				"connector.supervised",
			],
		});
		mocks.connect.mockResolvedValue(undefined);
	});

	it("retires every supervised instance of a channel", async () => {
		mocks.command.mockImplementation(async (command: string) => {
			if (command === "connector.supervised") {
				return {
					ok: true,
					payload: {
						supervised: [
							{ channel: "slack", instanceId: "a" },
							{ channel: "slack", instanceId: "b" },
							{ channel: "telegram", instanceId: "c" },
						],
					},
				};
			}
			return { ok: true, payload: { stopped: true } };
		});

		await expect(stopConnectorsViaHub({ channel: "slack" })).resolves.toBe(2);
		expect(mocks.command).toHaveBeenCalledWith("connector.stop", {
			channel: "slack",
			instanceId: "a",
		});
		expect(mocks.command).toHaveBeenCalledWith("connector.stop", {
			channel: "slack",
			instanceId: "b",
		});
		// A different channel is left alone.
		expect(mocks.command).not.toHaveBeenCalledWith("connector.stop", {
			channel: "telegram",
			instanceId: "c",
		});
	});

	it("retires only the requested instance", async () => {
		mocks.command.mockImplementation(async (command: string) => {
			if (command === "connector.supervised") {
				return {
					ok: true,
					payload: {
						supervised: [
							{ channel: "slack", instanceId: "a" },
							{ channel: "slack", instanceId: "b" },
						],
					},
				};
			}
			return { ok: true, payload: { stopped: true } };
		});

		await expect(
			stopConnectorsViaHub({ channel: "slack", instanceId: "b" }),
		).resolves.toBe(1);
		expect(mocks.command).toHaveBeenCalledWith("connector.stop", {
			channel: "slack",
			instanceId: "b",
		});
	});

	it("reports nothing to stop when the hub supervises none of them", async () => {
		mocks.command.mockResolvedValue({ ok: true, payload: { supervised: [] } });

		await expect(stopConnectorsViaHub({ channel: "slack" })).resolves.toBe(0);
	});

	it("returns undefined when the hub cannot supervise", async () => {
		mocks.readHubDiscovery.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			capabilities: ["session.create"],
		});

		await expect(
			stopConnectorsViaHub({ channel: "slack" }),
		).resolves.toBeUndefined();
	});
});
