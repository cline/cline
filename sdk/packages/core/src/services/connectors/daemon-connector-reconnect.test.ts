import { EventEmitter } from "node:events";
import {
	CLINE_RUN_AS_HUB_DAEMON_ENV,
	type ConnectorCliLaunchSpec,
} from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { __test__ } from "./daemon-connector-reconnect";

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
			log,
			spawnProcess,
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
			log,
			spawnProcess,
		);
		child.stderr.emit("data", "invalid token");
		child.emit("close", 1);

		await expect(pending).resolves.toBe(false);
		expect(log).toHaveBeenCalledWith(
			"[connect] telegram reconnect exited with code 1: invalid token",
		);
	});
});
