import { EventEmitter } from "node:events";
import type { ConnectorCliLaunchSpec } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	ConnectorSupervisor,
	getActiveConnectorSupervisor,
	RESTART_BASE_DELAY_MS,
	RESTART_GIVE_UP_AFTER,
	RESTART_MAX_DELAY_MS,
	STOP_SIGTERM_TIMEOUT_MS,
	setActiveConnectorSupervisor,
} from "./connector-supervisor";

const mocks = vi.hoisted(() => ({
	disableConnectorAutostart: vi.fn(),
	getPersistedConnectorConnection: vi.fn(),
}));

vi.mock("./connector-autostart", () => ({
	disableConnectorAutostart: mocks.disableConnectorAutostart,
	getPersistedConnectorConnection: mocks.getPersistedConnectorConnection,
}));

const spec: ConnectorCliLaunchSpec = {
	launcher: "/usr/local/bin/bun",
	connectArgsPrefix: ["/repo/apps/cli/src/index.ts", "connect"],
	cwd: "/workspace",
};

class FakeChild extends EventEmitter {
	unref = vi.fn();
	constructor(public pid: number | undefined = 4242) {
		super();
	}
	exit(code: number | null, signal: string | null = null): void {
		this.emit("exit", code, signal);
	}
}

/**
 * Deterministic clock + timer queue: restart backoff is the behaviour under
 * test, so nothing here may depend on real time.
 */
function createHarness(
	overrides: Partial<{
		children: FakeChild[];
		autostartEnabled: boolean;
		launchSpec: ConnectorCliLaunchSpec | undefined;
		active: Array<{ type: string; instanceId: string; pid: number }>;
		killProcess: (
			pid: number,
			signal: NodeJS.Signals,
			alivePids: Set<number>,
		) => void;
	}> = {},
) {
	let now = 1_000_000;
	const timers: Array<{ id: number; at: number; callback: () => void }> = [];
	let nextTimerId = 1;
	const spawned: Array<{
		launcher: string;
		args: string[];
		options: { cwd: string; env: NodeJS.ProcessEnv; detached: boolean };
	}> = [];
	const children = overrides.children ?? [];
	let childIndex = 0;
	const alivePids = new Set<number>();
	const cleanups: string[] = [];
	const logs: string[] = [];
	const kills: string[] = [];

	const spawnProcess = vi.fn(
		(launcher: string, args: string[], options: Record<string, unknown>) => {
			spawned.push(
				options as unknown as (typeof spawned)[number] extends infer T
					? T
					: never,
			);
			spawned[spawned.length - 1] = {
				launcher,
				args,
				options: options as unknown as {
					cwd: string;
					env: NodeJS.ProcessEnv;
					detached: boolean;
				},
			};
			const child = children[childIndex++] ?? new FakeChild(5000 + childIndex);
			if (child.pid !== undefined) {
				alivePids.add(child.pid);
				child.once("exit", () => {
					if (child.pid !== undefined) {
						alivePids.delete(child.pid);
					}
				});
			}
			return child as never;
		},
	);

	const supervisor = new ConnectorSupervisor({
		launchSpec: () => ("launchSpec" in overrides ? overrides.launchSpec : spec),
		spawnProcess: spawnProcess as never,
		isProcessRunning: (pid) => alivePids.has(pid),
		// Injected so tests never signal real pids; the default drops the pid so
		// a stop's wait-for-exit resolves the way a real SIGTERM would.
		killProcess: (pid, signal) => {
			kills.push(`${pid}:${signal}`);
			if (overrides.killProcess) {
				overrides.killProcess(pid, signal, alivePids);
				return;
			}
			alivePids.delete(pid);
		},
		listActive: () => (overrides.active ?? []) as never,
		cleanupInstance: async (channel, instanceId) => {
			cleanups.push(`${channel}:${instanceId}`);
		},
		isAutostartEnabled: () => overrides.autostartEnabled ?? true,
		log: (message) => logs.push(message),
		now: () => now,
		setTimer: (callback, delayMs) => {
			const id = nextTimerId++;
			timers.push({ id, at: now + delayMs, callback });
			return id;
		},
		clearTimer: (handle) => {
			const index = timers.findIndex((timer) => timer.id === handle);
			if (index >= 0) {
				timers.splice(index, 1);
			}
		},
	});

	return {
		supervisor,
		spawned,
		cleanups,
		logs,
		kills,
		alivePids,
		spawnProcess,
		advance(ms: number) {
			now += ms;
			const due = timers.filter((timer) => timer.at <= now);
			for (const timer of due) {
				const index = timers.indexOf(timer);
				if (index >= 0) {
					timers.splice(index, 1);
				}
				timer.callback();
			}
		},
		setNow(value: number) {
			now = value;
		},
		pendingTimers: () => timers.length,
		nextDelay: () => (timers[0] ? timers[0].at - now : undefined),
	};
}

async function flush(): Promise<void> {
	await new Promise((resolve) => setImmediate(resolve));
	await new Promise((resolve) => setImmediate(resolve));
}

describe("ConnectorSupervisor", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getPersistedConnectorConnection.mockReturnValue(undefined);
	});

	it("spawns a connector detached and reports it as running", async () => {
		const harness = createHarness();

		const result = await harness.supervisor.start({
			channel: "slack",
			instanceId: "cline-slack",
			args: ["--bot-token", "xoxb"],
		});

		expect(result.started).toBe(true);
		expect(result.record.state).toBe("running");
		expect(result.record.origin).toBe("spawned");
		expect(harness.spawned[0]?.launcher).toBe("/usr/local/bin/bun");
		expect(harness.spawned[0]?.args).toEqual([
			"/repo/apps/cli/src/index.ts",
			"connect",
			"slack",
			"--bot-token",
			"xoxb",
		]);
		// Detached: a hub restart must not take the connector down with it.
		expect(harness.spawned[0]?.options.detached).toBe(true);
	});

	it("refuses a second instance of a live connector", async () => {
		const harness = createHarness();
		await harness.supervisor.start({
			channel: "slack",
			instanceId: "cline-slack",
			args: ["--bot-token", "xoxb"],
		});

		const second = await harness.supervisor.start({
			channel: "slack",
			instanceId: "cline-slack",
			args: ["--bot-token", "xoxb"],
		});

		expect(second.started).toBe(false);
		expect(second.reason).toBe("already_running");
		// The whole point: one process per instance, so one socket per token.
		expect(harness.spawnProcess).toHaveBeenCalledTimes(1);
	});

	it("replaces a live instance when restart is requested", async () => {
		const harness = createHarness();
		await harness.supervisor.start({
			channel: "slack",
			instanceId: "cline-slack",
			args: ["--bot-token", "old"],
		});

		const restarted = await harness.supervisor.start({
			channel: "slack",
			instanceId: "cline-slack",
			args: ["--bot-token", "new"],
			restart: true,
		});

		expect(restarted.started).toBe(true);
		expect(harness.spawnProcess).toHaveBeenCalledTimes(2);
		expect(harness.spawned[1]?.args).toContain("new");
		// A restart must not disable the autostart record.
		expect(mocks.disableConnectorAutostart).not.toHaveBeenCalled();
	});

	it("strips daemon and connector-child markers from the child environment", async () => {
		process.env.CLINE_RUN_AS_HUB_DAEMON = "1";
		process.env.CLINE_SLACK_CONNECT_CHILD = "1";
		process.env.CLINE_CONNECTOR_DETACHED_CHILD = "1";
		process.env.CLINE_CONNECTOR_STARTING_INSTANCE = '{"channel":"slack"}';
		try {
			const harness = createHarness();
			await harness.supervisor.start({
				channel: "slack",
				instanceId: "cline-slack",
				args: [],
			});

			const env = harness.spawned[0]?.options.env ?? {};
			expect(env.CLINE_RUN_AS_HUB_DAEMON).toBeUndefined();
			expect(env.CLINE_SLACK_CONNECT_CHILD).toBeUndefined();
			expect(env.CLINE_CONNECTOR_DETACHED_CHILD).toBeUndefined();
			expect(env.CLINE_CONNECTOR_STARTING_INSTANCE).toBeUndefined();
			expect(env.PATH).toBe(process.env.PATH);
		} finally {
			delete process.env.CLINE_RUN_AS_HUB_DAEMON;
			delete process.env.CLINE_SLACK_CONNECT_CHILD;
			delete process.env.CLINE_CONNECTOR_DETACHED_CHILD;
			delete process.env.CLINE_CONNECTOR_STARTING_INSTANCE;
		}
	});

	it("reaps a dead connector and restarts it with exponential backoff", async () => {
		const first = new FakeChild(101);
		const second = new FakeChild(102);
		const harness = createHarness({ children: [first, second] });
		await harness.supervisor.start({
			channel: "slack",
			instanceId: "cline-slack",
			args: ["--bot-token", "xoxb"],
		});

		first.exit(1);
		await flush();

		// Reaping is what keeps Slack threads from pointing at dead sessions.
		expect(harness.cleanups).toEqual(["slack:cline-slack"]);
		expect(harness.supervisor.list()[0]?.state).toBe("backoff");
		expect(harness.nextDelay()).toBe(RESTART_BASE_DELAY_MS);

		harness.advance(RESTART_BASE_DELAY_MS);
		await flush();

		expect(harness.spawnProcess).toHaveBeenCalledTimes(2);
		const record = harness.supervisor.list()[0];
		expect(record?.state).toBe("running");
		expect(record?.restarts).toBe(1);
	});

	it("backs off further on each successive crash and caps the delay", async () => {
		const children = Array.from(
			{ length: 4 },
			(_, i) => new FakeChild(200 + i),
		);
		const harness = createHarness({ children });
		await harness.supervisor.start({
			channel: "slack",
			instanceId: "cline-slack",
			args: [],
		});

		const delays: Array<number | undefined> = [];
		for (let attempt = 0; attempt < 3; attempt += 1) {
			children[attempt]?.exit(1);
			await flush();
			delays.push(harness.nextDelay());
			harness.advance(harness.nextDelay() ?? 0);
			await flush();
		}

		expect(delays).toEqual([
			RESTART_BASE_DELAY_MS,
			RESTART_BASE_DELAY_MS * 2,
			RESTART_BASE_DELAY_MS * 4,
		]);
		expect(delays.every((delay) => (delay ?? 0) <= RESTART_MAX_DELAY_MS)).toBe(
			true,
		);
	});

	it("gives up after too many consecutive restarts", async () => {
		const children = Array.from(
			{ length: RESTART_GIVE_UP_AFTER + 2 },
			(_, i) => new FakeChild(300 + i),
		);
		const harness = createHarness({ children });
		await harness.supervisor.start({
			channel: "slack",
			instanceId: "cline-slack",
			args: [],
		});

		for (let attempt = 0; attempt <= RESTART_GIVE_UP_AFTER; attempt += 1) {
			children[attempt]?.exit(1);
			await flush();
			harness.advance(harness.nextDelay() ?? 0);
			await flush();
		}

		const record = harness.supervisor.list()[0];
		expect(record?.state).toBe("failed");
		expect(record?.restarts).toBe(RESTART_GIVE_UP_AFTER);
		// A revoked token must not become an endless spawn loop.
		expect(harness.pendingTimers()).toBe(0);
		expect(harness.logs.some((line) => line.includes("giving up"))).toBe(true);
	});

	it("clears the restart counter after a run that stayed up", async () => {
		const children = Array.from(
			{ length: 3 },
			(_, i) => new FakeChild(400 + i),
		);
		const harness = createHarness({ children });
		await harness.supervisor.start({
			channel: "slack",
			instanceId: "cline-slack",
			args: [],
		});

		children[0]?.exit(1);
		await flush();
		harness.advance(RESTART_BASE_DELAY_MS);
		await flush();
		expect(harness.supervisor.list()[0]?.restarts).toBe(1);

		// Second run stays healthy for well over the reset window before dying.
		harness.advance(10 * 60_000);
		children[1]?.exit(1);
		await flush();

		expect(harness.nextDelay()).toBe(RESTART_BASE_DELAY_MS);
		expect(harness.supervisor.list()[0]?.restarts).toBe(1);
	});

	it("cancels a pending backoff restart when a new start replaces the entry", async () => {
		// A user runs `cline connect` while the instance is waiting out its
		// backoff. The old entry's timer must not survive the replacement: it
		// holds a closure over the old entry, so firing it would spawn a second
		// process for the same instance — untracked by the map, so invisible to
		// list() and unreachable by stop() — two processes on one bot token.
		const children = [
			new FakeChild(1300),
			new FakeChild(1301),
			new FakeChild(1302),
		];
		const harness = createHarness({ children });
		await harness.supervisor.start({
			channel: "slack",
			instanceId: "cline-slack",
			args: ["--bot-token", "xoxb"],
		});

		children[0]?.exit(1);
		await flush();
		expect(harness.supervisor.list()[0]?.state).toBe("backoff");
		expect(harness.pendingTimers()).toBe(1);

		const second = await harness.supervisor.start({
			channel: "slack",
			instanceId: "cline-slack",
			args: ["--bot-token", "xoxb"],
		});

		expect(second.started).toBe(true);
		expect(harness.pendingTimers()).toBe(0);

		// Even well past every possible backoff, nothing else may spawn.
		harness.advance(RESTART_MAX_DELAY_MS);
		await flush();
		expect(harness.spawnProcess).toHaveBeenCalledTimes(2);
		expect(harness.supervisor.list()).toHaveLength(1);
		expect(harness.supervisor.list()[0]?.state).toBe("running");
	});

	it("serialises a boot-time restart with a concurrent user start", async () => {
		// Observed live: a new hub's boot reconnect restarts an adopted survivor
		// — which suspends inside stop() waiting on the CLI cleanup — while a
		// user `cline connect` for the same instance arrives over the hub.
		// Unserialised, both spawned: the map tracked one process while the other
		// lived on untracked, holding the connector's webhook port, and the
		// tracked chain crash-looped on EADDRINUSE until it gave up.
		mocks.getPersistedConnectorConnection.mockReturnValue({
			channel: "slack",
			instanceId: "cline-slack",
			connectArgs: ["--bot-token", "stored"],
			lastSuccessfulArgs: [],
			enabled: true,
			updatedAt: "",
			lastConnectedAt: "",
		});
		const harness = createHarness({
			active: [{ type: "slack", instanceId: "cline-slack", pid: 700 }],
		});
		harness.alivePids.add(700);
		harness.supervisor.adoptRunningConnectors();

		const [restarted, userStart] = await Promise.all([
			harness.supervisor.start({
				channel: "slack",
				instanceId: "cline-slack",
				args: ["--bot-token", "stored"],
				restart: true,
			}),
			harness.supervisor.start({
				channel: "slack",
				instanceId: "cline-slack",
				args: ["--bot-token", "stored"],
			}),
		]);

		expect(restarted.started).toBe(true);
		expect(userStart.started).toBe(false);
		expect(userStart.reason).toBe("already_running");
		// The survivor was actually stopped, exactly one replacement exists, and
		// the supervisor tracks it.
		expect(harness.kills).toContain("700:SIGTERM");
		expect(harness.spawnProcess).toHaveBeenCalledTimes(1);
		expect(harness.supervisor.list()).toHaveLength(1);
		expect(harness.supervisor.list()[0]?.state).toBe("running");
	});

	it("waits for a stopped process to die, escalating to SIGKILL", async () => {
		// A replacement spawned while the old process still holds the
		// connector's listen port fails on EADDRINUSE, so stop must not return
		// until the process is actually gone.
		const child = new FakeChild(800);
		const harness = createHarness({
			children: [child],
			killProcess: (pid, signal, alivePids) => {
				// This process ignores SIGTERM and lingers on its port.
				if (signal === "SIGKILL") {
					alivePids.delete(pid);
				}
			},
		});
		await harness.supervisor.start({
			channel: "slack",
			instanceId: "cline-slack",
			args: [],
		});

		let resolved = false;
		const pending = harness.supervisor
			.stop({ channel: "slack", instanceId: "cline-slack" })
			.then((stopped) => {
				resolved = true;
				return stopped;
			});

		// Drive the exit poll past the SIGTERM window.
		const iterations = STOP_SIGTERM_TIMEOUT_MS / 100 + 5;
		for (let step = 0; step < iterations && !resolved; step += 1) {
			await flush();
			harness.advance(100);
		}
		await flush();

		await expect(pending).resolves.toBe(true);
		expect(harness.kills).toContain("800:SIGTERM");
		expect(harness.kills).toContain("800:SIGKILL");
		expect(harness.alivePids.has(800)).toBe(false);
		expect(harness.supervisor.list()).toEqual([]);
	});

	it("does not schedule a restart for an entry replaced while its cleanup was in flight", async () => {
		// Between a crash and its restart timer there is a window where the
		// exit-cleanup chain is still running and no timer exists yet to cancel.
		// A replacement made in that window must make the chain stand down
		// instead of scheduling a restart for the retired entry.
		const children = [new FakeChild(1400), new FakeChild(1401)];
		const harness = createHarness({ children });
		await harness.supervisor.start({
			channel: "slack",
			instanceId: "cline-slack",
			args: ["--bot-token", "xoxb"],
		});

		children[0]?.exit(1);
		// No flush: the cleanup chain has not completed when the start arrives.
		const second = await harness.supervisor.start({
			channel: "slack",
			instanceId: "cline-slack",
			args: ["--bot-token", "xoxb"],
		});
		await flush();

		expect(second.started).toBe(true);
		expect(harness.pendingTimers()).toBe(0);
		expect(harness.spawnProcess).toHaveBeenCalledTimes(2);
		expect(harness.supervisor.list()).toHaveLength(1);
	});

	it("restarts a connector that was started with no arguments", async () => {
		// A connector configured entirely through the connector store launches with
		// an empty argv. Emptiness must not be mistaken for "argv unknown", or the
		// hub can never bring it back.
		mocks.getPersistedConnectorConnection.mockReturnValue(undefined);
		const children = [new FakeChild(1100), new FakeChild(1101)];
		const harness = createHarness({ children });
		await harness.supervisor.start({
			channel: "slack",
			instanceId: "cline-slack",
			args: [],
		});

		children[0]?.exit(1);
		await flush();
		harness.advance(RESTART_BASE_DELAY_MS);
		await flush();

		expect(harness.spawnProcess).toHaveBeenCalledTimes(2);
		expect(harness.supervisor.list()[0]?.state).toBe("running");
		expect(harness.spawned[1]?.args).toEqual([
			"/repo/apps/cli/src/index.ts",
			"connect",
			"slack",
		]);
	});

	it("does not restart a connector whose autostart is disabled", async () => {
		const child = new FakeChild(500);
		const harness = createHarness({
			children: [child],
			autostartEnabled: false,
		});
		await harness.supervisor.start({
			channel: "slack",
			instanceId: "cline-slack",
			args: [],
		});

		child.exit(0);
		await flush();

		expect(harness.cleanups).toEqual(["slack:cline-slack"]);
		expect(harness.pendingTimers()).toBe(0);
		expect(harness.supervisor.list()).toEqual([]);
	});

	it("stops a connector on request without restarting it", async () => {
		const child = new FakeChild(600);
		const harness = createHarness({ children: [child] });
		await harness.supervisor.start({
			channel: "slack",
			instanceId: "cline-slack",
			args: [],
		});

		const stopped = await harness.supervisor.stop({
			channel: "slack",
			instanceId: "cline-slack",
		});
		child.exit(null, "SIGTERM");
		await flush();

		expect(stopped).toBe(true);
		expect(mocks.disableConnectorAutostart).toHaveBeenCalledWith(
			"slack",
			"cline-slack",
		);
		expect(harness.supervisor.list()).toEqual([]);
		expect(harness.pendingTimers()).toBe(0);
	});

	it("adopts connectors that predate this hub and polls them for death", async () => {
		mocks.getPersistedConnectorConnection.mockReturnValue({
			channel: "slack",
			instanceId: "cline-slack",
			connectArgs: ["--bot-token", "stored"],
			lastSuccessfulArgs: [],
			enabled: true,
			updatedAt: "",
			lastConnectedAt: "",
		});
		const harness = createHarness({
			active: [{ type: "slack", instanceId: "cline-slack", pid: 700 }],
		});
		harness.alivePids.add(700);

		const adopted = harness.supervisor.adoptRunningConnectors();
		expect(adopted).toHaveLength(1);
		expect(adopted[0]?.origin).toBe("adopted");
		expect(adopted[0]?.pid).toBe(700);

		// Adopted processes have no child handle, so death is only visible by poll.
		harness.alivePids.delete(700);
		harness.advance(10_000);
		await flush();

		expect(harness.cleanups).toEqual(["slack:cline-slack"]);
		harness.advance(RESTART_BASE_DELAY_MS);
		await flush();

		// Restart args come from the persisted record: an adopted process's argv
		// is not ours to reconstruct.
		expect(harness.spawned[0]?.args).toEqual([
			"/repo/apps/cli/src/index.ts",
			"connect",
			"slack",
			"--bot-token",
			"stored",
		]);
	});

	it("does not adopt an instance it already supervises", async () => {
		const harness = createHarness({
			active: [{ type: "slack", instanceId: "cline-slack", pid: 800 }],
		});
		await harness.supervisor.start({
			channel: "slack",
			instanceId: "cline-slack",
			args: [],
		});

		expect(harness.supervisor.adoptRunningConnectors()).toEqual([]);
		expect(harness.supervisor.list()).toHaveLength(1);
	});

	it("fails a start when no launch specification is available", async () => {
		const harness = createHarness({ launchSpec: undefined });

		const result = await harness.supervisor.start({
			channel: "slack",
			instanceId: "cline-slack",
			args: [],
		});

		expect(result.started).toBe(false);
		expect(result.record.state).toBe("failed");
		expect(harness.spawnProcess).not.toHaveBeenCalled();
	});

	it("cannot restart an adopted connector with no stored arguments", async () => {
		mocks.getPersistedConnectorConnection.mockReturnValue(undefined);
		const harness = createHarness({
			active: [{ type: "slack", instanceId: "cline-slack", pid: 900 }],
		});
		harness.alivePids.add(900);
		harness.supervisor.adoptRunningConnectors();

		harness.alivePids.delete(900);
		harness.advance(10_000);
		await flush();
		harness.advance(RESTART_BASE_DELAY_MS);
		await flush();

		expect(harness.spawnProcess).not.toHaveBeenCalled();
		expect(harness.supervisor.list()[0]?.state).toBe("failed");
	});

	it("leaves running connectors alone when disposed so the next hub can adopt them", async () => {
		const child = new FakeChild(1000);
		const harness = createHarness({ children: [child] });
		await harness.supervisor.start({
			channel: "slack",
			instanceId: "cline-slack",
			args: [],
		});

		harness.supervisor.dispose();

		expect(harness.alivePids.has(1000)).toBe(true);
		expect(harness.supervisor.list()).toEqual([]);
		// A post-dispose exit must not trigger cleanup or a restart.
		child.exit(1);
		await flush();
		expect(harness.cleanups).toEqual([]);
		expect(harness.pendingTimers()).toBe(0);
	});

	it("exposes the active supervisor to hub command handlers", () => {
		const harness = createHarness();
		expect(getActiveConnectorSupervisor()).toBeUndefined();
		setActiveConnectorSupervisor(harness.supervisor);
		expect(getActiveConnectorSupervisor()).toBe(harness.supervisor);
		setActiveConnectorSupervisor(undefined);
		expect(getActiveConnectorSupervisor()).toBeUndefined();
	});
});
