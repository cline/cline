import { CLINE_CONNECTOR_STARTING_INSTANCE_ENV } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectorSupervisor } from "./connector-supervisor";
import { reconnectDaemonConnectors } from "./daemon-connector-reconnect";

const mocks = vi.hoisted(() => ({
	reconnectPersistedConnectors: vi.fn(),
	getActiveConnectorSupervisor: vi.fn(),
}));

vi.mock("./connector-autostart", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./connector-autostart")>();
	return {
		...actual,
		reconnectPersistedConnectors: mocks.reconnectPersistedConnectors,
	};
});

vi.mock("./connector-supervisor", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("./connector-supervisor")>();
	return {
		...actual,
		getActiveConnectorSupervisor: mocks.getActiveConnectorSupervisor,
	};
});

type StartArgs = {
	channel: string;
	instanceId: string;
	args: string[];
	restart?: boolean;
};

function createSupervisor(
	options: {
		supervised?: Array<{ channel: string; instanceId: string }>;
		started?: boolean;
		reason?: "already_running";
	} = {},
) {
	const starts: StartArgs[] = [];
	const supervisor = {
		list: () =>
			(options.supervised ?? []).map((entry) => ({
				...entry,
				state: "running" as const,
				origin: "adopted" as const,
				restarts: 0,
			})),
		start: vi.fn(async (request: StartArgs) => {
			starts.push(request);
			return {
				started: options.started ?? true,
				...(options.reason ? { reason: options.reason } : {}),
				record: {
					channel: request.channel,
					instanceId: request.instanceId,
					state: "running" as const,
					origin: "spawned" as const,
					restarts: 0,
				},
			};
		}),
	} as unknown as ConnectorSupervisor;
	return { supervisor, starts };
}

describe("reconnectDaemonConnectors", () => {
	const originalStartingInstance =
		process.env[CLINE_CONNECTOR_STARTING_INSTANCE_ENV];

	afterEach(() => {
		vi.clearAllMocks();
		if (originalStartingInstance === undefined) {
			delete process.env[CLINE_CONNECTOR_STARTING_INSTANCE_ENV];
		} else {
			process.env[CLINE_CONNECTOR_STARTING_INSTANCE_ENV] =
				originalStartingInstance;
		}
	});

	it("starts a persisted connector through the supervisor", async () => {
		delete process.env[CLINE_CONNECTOR_STARTING_INSTANCE_ENV];
		const { supervisor, starts } = createSupervisor();
		mocks.reconnectPersistedConnectors.mockImplementation(async (options) => {
			const ok = await options.start({
				channel: "telegram",
				instanceId: "cline_bot",
				args: ["-k", "token"],
			});
			return [{ channel: "telegram", instanceId: "cline_bot", ok }];
		});

		await expect(
			reconnectDaemonConnectors(vi.fn(), supervisor),
		).resolves.toEqual([
			{ channel: "telegram", instanceId: "cline_bot", ok: true },
		]);
		expect(starts).toEqual([
			{
				channel: "telegram",
				instanceId: "cline_bot",
				args: ["-k", "token"],
				restart: false,
			},
		]);
	});

	it("restarts a connector that survived the previous hub", async () => {
		delete process.env[CLINE_CONNECTOR_STARTING_INSTANCE_ENV];
		const { supervisor, starts } = createSupervisor({
			supervised: [{ channel: "telegram", instanceId: "cline_bot" }],
		});
		const log = vi.fn();
		mocks.reconnectPersistedConnectors.mockImplementation(async (options) => {
			await options.start({
				channel: "telegram",
				instanceId: "cline_bot",
				args: ["-k", "token"],
			});
			return [];
		});

		await reconnectDaemonConnectors(log, supervisor);

		// A survivor authenticated against the dead hub's token, so it has to come
		// back rather than keep running.
		expect(starts[0]?.restart).toBe(true);
		expect(log).toHaveBeenCalledWith(
			"[connect] restarting surviving telegram connector cline_bot for the new hub session",
		);
	});

	it("does not reconnect the connector instance that is starting this daemon", async () => {
		process.env[CLINE_CONNECTOR_STARTING_INSTANCE_ENV] = JSON.stringify({
			channel: "telegram",
			instanceId: "cline_bot",
		});
		const { supervisor } = createSupervisor();
		let isHealthy:
			| ((target: { channel: string; instanceId: string }) => boolean)
			| undefined;
		mocks.reconnectPersistedConnectors.mockImplementation(async (options) => {
			isHealthy = options.isHealthy;
			return [];
		});

		await reconnectDaemonConnectors(vi.fn(), supervisor);

		expect(isHealthy?.({ channel: "telegram", instanceId: "cline_bot" })).toBe(
			true,
		);
		// A different instance of the same channel still needs reconnecting.
		expect(isHealthy?.({ channel: "telegram", instanceId: "other_bot" })).toBe(
			false,
		);
		expect(isHealthy?.({ channel: "slack", instanceId: "cline_bot" })).toBe(
			false,
		);
	});

	it("reconnects every persisted instance when no connector is starting", async () => {
		delete process.env[CLINE_CONNECTOR_STARTING_INSTANCE_ENV];
		const { supervisor } = createSupervisor();
		let isHealthy:
			| ((target: { channel: string; instanceId: string }) => boolean)
			| undefined;
		mocks.reconnectPersistedConnectors.mockImplementation(async (options) => {
			isHealthy = options.isHealthy;
			return [];
		});

		await reconnectDaemonConnectors(vi.fn(), supervisor);

		expect(isHealthy?.({ channel: "telegram", instanceId: "cline_bot" })).toBe(
			false,
		);
	});

	it("reports an already-running instance without treating it as started", async () => {
		delete process.env[CLINE_CONNECTOR_STARTING_INSTANCE_ENV];
		const { supervisor } = createSupervisor({
			started: false,
			reason: "already_running",
		});
		const log = vi.fn();
		mocks.reconnectPersistedConnectors.mockImplementation(async (options) => {
			const ok = await options.start({
				channel: "slack",
				instanceId: "cline-slack",
				args: [],
			});
			return [{ channel: "slack", instanceId: "cline-slack", ok }];
		});

		await expect(reconnectDaemonConnectors(log, supervisor)).resolves.toEqual([
			{ channel: "slack", instanceId: "cline-slack", ok: false },
		]);
		expect(log).toHaveBeenCalledWith(
			"[connect] slack connector cline-slack is already running under this hub",
		);
	});

	it("does nothing when no supervisor is active", async () => {
		const log = vi.fn();
		mocks.getActiveConnectorSupervisor.mockReturnValue(undefined);

		await expect(reconnectDaemonConnectors(log)).resolves.toEqual([]);
		expect(mocks.reconnectPersistedConnectors).not.toHaveBeenCalled();
		expect(log).toHaveBeenCalledWith(
			"[connect] cannot reconnect connectors: no connector supervisor is active",
		);
	});
});
