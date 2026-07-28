import type { HubEventEnvelope } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatusService, setStatusService } from "../../status";
import { SqliteStatusStore } from "../../status/store/sqlite-status-store";
import { createLocalHubScheduleRuntimeHandlers } from "../daemon/runtime-handlers";
import { HubServerTransport } from "../server";

/**
 * The transport subscribes to the process-wide StatusService so agent tool
 * publishes reach the wire. That subscription has to come back off on stop() --
 * the service outlives any single transport, so a leaked listener keeps
 * publishing into a dead context forever.
 */

const services: StatusService[] = [];

function createService(): StatusService {
	const service = new StatusService({
		store: new SqliteStatusStore(":memory:"),
	});
	services.push(service);
	setStatusService(service);
	return service;
}

function createTransport() {
	return new HubServerTransport({
		runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
		scheduleOptions: { dbPath: ":memory:" },
		sessionHost: {
			subscribe: vi.fn(),
			startSession: vi.fn(),
			stopSession: vi.fn(),
			runTurn: vi.fn(),
			abort: vi.fn(),
			dispose: vi.fn(),
			getSession: vi.fn(),
			getAccumulatedUsage: vi.fn(),
			listSessions: vi.fn(),
			deleteSession: vi.fn(),
			updateSession: vi.fn(),
			dispatchHookEvent: vi.fn(),
			readSessionMessages: vi.fn(),
		} as never,
	});
}

const publishInput = {
	subject: "migration/auth",
	state: "running" as const,
	headline: "Rewriting the token exchange",
	source: "agent" as const,
};

afterEach(() => {
	for (const service of services.splice(0)) service.close();
	setStatusService(undefined);
});

describe("status broadcast lifecycle", () => {
	it("broadcasts service publishes while the transport is running", async () => {
		const service = createService();
		const transport = createTransport();
		const events: HubEventEnvelope[] = [];
		transport.subscribe("ui", (event) => events.push(event));

		service.publish(publishInput);
		expect(events.map((e) => e.event)).toEqual(["status.updated"]);

		await transport.stop();
	});

	it("stops broadcasting once the transport is stopped", async () => {
		const service = createService();
		const transport = createTransport();
		const events: HubEventEnvelope[] = [];
		transport.subscribe("ui", (event) => events.push(event));

		await transport.stop();
		service.publish(publishInput);

		expect(events).toHaveLength(0);
	});

	it("does not fan one publish out to stopped transports", async () => {
		const service = createService();
		const stopped = createTransport();
		await stopped.stop();

		const live = createTransport();
		const events: HubEventEnvelope[] = [];
		live.subscribe("ui", (event) => events.push(event));

		service.publish(publishInput);
		expect(events).toHaveLength(1);

		// stop() is reachable more than once through shutdown paths; the second
		// call must not throw.
		await live.stop();
		await expect(live.stop()).resolves.toBeUndefined();
	});
});
