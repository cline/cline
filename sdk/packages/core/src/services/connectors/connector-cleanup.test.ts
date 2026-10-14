import { EventEmitter } from "node:events";
import type { ConnectorCliLaunchSpec } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupConnectorInstanceViaCli } from "./connector-cleanup";

const spec: ConnectorCliLaunchSpec = {
	launcher: "/usr/local/bin/bun",
	connectArgsPrefix: ["/repo/apps/cli/src/index.ts", "connect"],
	cwd: "/workspace",
};

class FakeChild extends EventEmitter {
	stderr = new EventEmitter() as EventEmitter & {
		setEncoding: (encoding: string) => void;
	};
	kill = vi.fn();

	constructor() {
		super();
		this.stderr.setEncoding = vi.fn();
	}
}

describe("cleanupConnectorInstanceViaCli", () => {
	afterEach(() => {
		vi.clearAllMocks();
		delete process.env.CLINE_SLACK_CONNECT_CHILD;
		delete process.env.CLINE_RUN_AS_HUB_DAEMON;
	});

	it("invokes the CLI cleanup path with flags before the channel", async () => {
		const child = new FakeChild();
		const spawnProcess = vi.fn(() => child);

		const pending = cleanupConnectorInstanceViaCli("slack", "cline-slack", {
			launchSpec: spec,
			spawnProcess: spawnProcess as never,
		});
		child.emit("close", 0);
		await expect(pending).resolves.toBeUndefined();

		expect(spawnProcess).toHaveBeenCalledWith(
			"/usr/local/bin/bun",
			[
				"/repo/apps/cli/src/index.ts",
				"connect",
				// `connect` uses passThroughOptions, so a flag after the channel would
				// be handed to the adapter instead of the connect command.
				"--cleanup-instance",
				"cline-slack",
				"slack",
			],
			expect.objectContaining({ cwd: "/workspace" }),
		);
	});

	it("strips inherited daemon and connector-child markers", async () => {
		process.env.CLINE_RUN_AS_HUB_DAEMON = "1";
		process.env.CLINE_SLACK_CONNECT_CHILD = "1";
		const child = new FakeChild();
		let env: NodeJS.ProcessEnv = {};
		const spawnProcess = vi.fn(
			(
				_launcher: string,
				_args: string[],
				options: { env: NodeJS.ProcessEnv },
			) => {
				env = options.env;
				return child;
			},
		);

		const pending = cleanupConnectorInstanceViaCli("slack", "cline-slack", {
			launchSpec: spec,
			spawnProcess: spawnProcess as never,
		});
		child.emit("close", 0);
		await pending;

		expect(env.CLINE_RUN_AS_HUB_DAEMON).toBeUndefined();
		expect(env.CLINE_SLACK_CONNECT_CHILD).toBeUndefined();
	});

	it("reports a failing cleanup with the CLI's stderr", async () => {
		const child = new FakeChild();
		const spawnProcess = vi.fn(() => child);

		const pending = cleanupConnectorInstanceViaCli("slack", "cline-slack", {
			launchSpec: spec,
			spawnProcess: spawnProcess as never,
		});
		child.stderr.emit("data", "unknown instance");
		child.emit("close", 1);

		await expect(pending).rejects.toThrow(
			"cleanup exited with code 1: unknown instance",
		);
	});

	it("fails fast when no launch specification is available", async () => {
		await expect(
			cleanupConnectorInstanceViaCli("slack", "cline-slack", {
				launchSpec: undefined,
			}),
		).rejects.toThrow("connector CLI launch information is unavailable");
	});

	it("kills and reports a cleanup that hangs", async () => {
		vi.useFakeTimers();
		try {
			const child = new FakeChild();
			const pending = cleanupConnectorInstanceViaCli("slack", "cline-slack", {
				launchSpec: spec,
				spawnProcess: (() => child) as never,
				timeoutMs: 50,
			});
			const assertion = expect(pending).rejects.toThrow(
				"cleanup timed out after 50ms",
			);
			await vi.advanceTimersByTimeAsync(60);
			await assertion;
			// A wedged cleanup must not block the supervisor's restart path forever.
			expect(child.kill).toHaveBeenCalledWith("SIGKILL");
		} finally {
			vi.useRealTimers();
		}
	});
});
