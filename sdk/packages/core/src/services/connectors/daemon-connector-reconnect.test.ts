import { EventEmitter } from "node:events";
import {
	CLINE_RUN_AS_HUB_DAEMON_ENV,
	type ConnectorCliLaunchSpec,
} from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	__test__,
	reconnectDaemonConnectors,
} from "./daemon-connector-reconnect";

const mocks = vi.hoisted(() => ({
	listActiveConnectors: vi.fn(),
	readConnectorCliLaunchSpec: vi.fn(),
	reconnectPersistedConnectors: vi.fn(),
	spawnProcess: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	spawn: mocks.spawnProcess,
}));

vi.mock("@cline/shared", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@cline/shared")>();
	return {
		...actual,
		readConnectorCliLaunchSpec: mocks.readConnectorCliLaunchSpec,
	};
});

vi.mock("./active-connectors", () => ({
	listActiveConnectors: mocks.listActiveConnectors,
}));

vi.mock("./connector-autostart", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./connector-autostart")>();
	return {
		...actual,
		reconnectPersistedConnectors: mocks.reconnectPersistedConnectors,
	};
});

class FakeConnectorCliChild extends EventEmitter {
	stderr = new EventEmitter() as EventEmitter & {
		setEncoding: (encoding: string) => void;
	};

	constructor() {
		super();
		this.stderr.setEncoding = vi.fn();
	}
}

describe("daemon connector CLI launcher", () => {
	const originalDaemonFlag = process.env[CLINE_RUN_AS_HUB_DAEMON_ENV];
	const spec: ConnectorCliLaunchSpec = {
		launcher: "/usr/local/bin/bun",
		connectArgsPrefix: ["/repo/apps/cli/src/index.ts", "connect"],
		cwd: "/workspace",
	};

	afterEach(() => {
		vi.clearAllMocks();
		if (originalDaemonFlag === undefined) {
			delete process.env[CLINE_RUN_AS_HUB_DAEMON_ENV];
		} else {
			process.env[CLINE_RUN_AS_HUB_DAEMON_ENV] = originalDaemonFlag;
		}
	});

	it("launches reconnect through the CLI without the daemon sentinel", async () => {
		process.env[CLINE_RUN_AS_HUB_DAEMON_ENV] = "1";
		const child = new FakeConnectorCliChild();
		const spawnProcess = vi.fn(() => child);
		const log = vi.fn();

		const pending = __test__.runConnectorCli(
			spec,
			"telegram",
			["-k", "token"],
			{ log, spawnProcess },
		);
		child.emit("close", 0);

		await expect(pending).resolves.toBe(true);
		expect(spawnProcess).toHaveBeenCalledWith(
			"/usr/local/bin/bun",
			["/repo/apps/cli/src/index.ts", "connect", "telegram", "-k", "token"],
			expect.objectContaining({
				cwd: "/workspace",
				env: expect.not.objectContaining({
					[CLINE_RUN_AS_HUB_DAEMON_ENV]: "1",
				}),
			}),
		);
		expect(log).not.toHaveBeenCalled();
	});

	it("reports non-zero CLI reconnect exits", async () => {
		const child = new FakeConnectorCliChild();
		const spawnProcess = vi.fn(() => child);
		const log = vi.fn();

		const pending = __test__.runConnectorCli(
			spec,
			"telegram",
			["-k", "token"],
			{ log, spawnProcess },
		);
		child.stderr.emit("data", "invalid token");
		child.emit("close", 1);

		await expect(pending).resolves.toBe(false);
		expect(log).toHaveBeenCalledWith(
			"[connect] telegram reconnect exited with code 1: invalid token",
		);
	});

	it("restarts a surviving connector so it binds to the new hub session", async () => {
		const child = new FakeConnectorCliChild();
		mocks.readConnectorCliLaunchSpec.mockReturnValue(spec);
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
		mocks.spawnProcess.mockImplementation(() => {
			queueMicrotask(() => child.emit("close", 0));
			return child;
		});
		mocks.reconnectPersistedConnectors.mockImplementation(async (options) => {
			const target = {
				channel: "telegram",
				instanceId: "cline_bot",
				args: ["-k", "token"],
			};
			const ok = await options.start(target);
			return [{ channel: "telegram", instanceId: "cline_bot", ok }];
		});
		const log = vi.fn();

		await expect(reconnectDaemonConnectors(log)).resolves.toEqual([
			{ channel: "telegram", instanceId: "cline_bot", ok: true },
		]);

		expect(mocks.spawnProcess).toHaveBeenCalledWith(
			"/usr/local/bin/bun",
			[
				"/repo/apps/cli/src/index.ts",
				"connect",
				"--restart-instance",
				"cline_bot",
				"telegram",
				"-k",
				"token",
			],
			expect.objectContaining({ cwd: "/workspace" }),
		);
		expect(log).toHaveBeenCalledWith(
			"[connect] restarting surviving telegram connector cline_bot for the new hub session",
		);
	});

	it("restarts multiple surviving instances independently", async () => {
		mocks.readConnectorCliLaunchSpec.mockReturnValue(spec);
		mocks.listActiveConnectors.mockReturnValue([
			{
				id: "telegram:first_bot",
				type: "telegram",
				instanceId: "first_bot",
				pid: 123,
				hubUrl: "ws://127.0.0.1:4317",
				botUsername: "first_bot",
			},
			{
				id: "telegram:second_bot",
				type: "telegram",
				instanceId: "second_bot",
				pid: 456,
				hubUrl: "ws://127.0.0.1:4317",
				botUsername: "second_bot",
			},
		]);
		mocks.spawnProcess.mockImplementation(() => {
			const child = new FakeConnectorCliChild();
			queueMicrotask(() => child.emit("close", 0));
			return child;
		});
		mocks.reconnectPersistedConnectors.mockImplementation(async (options) => {
			const targets = [
				{
					channel: "telegram",
					instanceId: "first_bot",
					args: ["-k", "first-token"],
				},
				{
					channel: "telegram",
					instanceId: "second_bot",
					args: ["-k", "second-token"],
				},
			];
			return await Promise.all(
				targets.map(async (target) => ({
					channel: target.channel,
					instanceId: target.instanceId,
					ok: await options.start(target),
				})),
			);
		});
		const log = vi.fn();

		await expect(reconnectDaemonConnectors(log)).resolves.toEqual([
			{ channel: "telegram", instanceId: "first_bot", ok: true },
			{ channel: "telegram", instanceId: "second_bot", ok: true },
		]);

		expect(mocks.spawnProcess).toHaveBeenNthCalledWith(
			1,
			"/usr/local/bin/bun",
			[
				"/repo/apps/cli/src/index.ts",
				"connect",
				"--restart-instance",
				"first_bot",
				"telegram",
				"-k",
				"first-token",
			],
			expect.any(Object),
		);
		expect(mocks.spawnProcess).toHaveBeenNthCalledWith(
			2,
			"/usr/local/bin/bun",
			[
				"/repo/apps/cli/src/index.ts",
				"connect",
				"--restart-instance",
				"second_bot",
				"telegram",
				"-k",
				"second-token",
			],
			expect.any(Object),
		);
	});
});
