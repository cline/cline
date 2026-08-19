/**
 * Gateway restart recovery: committed state and the durable queue
 * survive a crash. Abandoned attempts are interrupted (never
 * auto-resumed), committed queued runs re-admit FIFO, identity
 * (`gatewayId`) is durable while `instanceId` is not, idempotent
 * acknowledgements replay across instances, and stale discovery records
 * are diagnosed rather than trusted.
 */

import type { RunAccepted } from "@cline/shared/gateway";
import { createIdempotencyKey } from "@cline/shared/gateway";
import { afterEach, describe, expect, it } from "vitest";
import { GatewayClient } from "./client";
import { readDiscoveryRecord } from "./discovery";
import { GatewayServer } from "./server";
import { ScriptedEnginePort, tempDataRoot, waitFor } from "./test-support";

const servers: GatewayServer[] = [];
const clients: GatewayClient[] = [];

afterEach(async () => {
	for (const client of clients.splice(0)) {
		client.close();
	}
	for (const server of servers.splice(0)) {
		await server.stop("graceful").catch(() => {});
	}
});

async function connectTo(server: GatewayServer): Promise<GatewayClient> {
	const discovery = server.discovery;
	if (!discovery) {
		throw new Error("no discovery record");
	}
	const client = await GatewayClient.connectToDiscovery(discovery, {
		clientName: "recovery-test",
		clientVersion: "0.0.1",
	});
	clients.push(client);
	return client;
}

describe("gateway restart recovery", () => {
	it("recovers committed state and queue across a crash", async () => {
		const dataRoot = tempDataRoot();

		// ---- Instance 1: a finished run, a mid-flight run, a queued run.
		const engine1 = new ScriptedEnginePort();
		const server1 = await GatewayServer.start({
			dataRoot,
			namespace: "default",
			engine: engine1,
		});
		servers.push(server1);
		const client1 = await connectTo(server1);
		const botId = server1.runtime.defaultBotId;
		if (!botId) {
			throw new Error("no default bot");
		}

		const finished = (await client1.mutate("run.start", {
			botId,
			prompt: "finished before crash",
		})) as RunAccepted;
		await waitFor(() => engine1.handles.length === 1);
		engine1.handles[0].settle({ outputText: "committed output" });
		await waitFor(
			() => server1.stores.runs.get(finished.runId)?.state === "completed",
		);

		const abandonedKey = createIdempotencyKey();
		const abandoned = (await client1.mutate("run.start", {
			idempotencyKey: abandonedKey,
			botId,
			prompt: "mid-flight at crash",
		})) as RunAccepted;
		await waitFor(() => engine1.handles.length === 2);
		engine1.handles[1].settleOnStop = false; // simulate a hung attempt

		const queued = (await client1.mutate("run.start", {
			botId,
			prompt: "queued at crash",
		})) as RunAccepted;
		expect(queued.queuePosition).toBe(1);

		const gatewayId1 = server1.stores.meta.ensureGatewayId();
		const staleDiscovery = readDiscoveryRecord(server1.paths.discoveryFile);

		// ---- Crash: no graceful transitions, no discovery cleanup.
		await server1.stop("crash");
		expect(readDiscoveryRecord(server1.paths.discoveryFile)).toEqual(
			staleDiscovery,
		);

		// The stale record now points at a dead endpoint: diagnose, don't trust.
		if (!staleDiscovery) {
			throw new Error("expected a stale discovery record");
		}
		await expect(
			GatewayClient.connectToDiscovery(staleDiscovery, {
				connectTimeoutMs: 500,
			}),
		).rejects.toMatchObject({
			gatewayError: { code: "gateway_unreachable" },
		});

		// ---- Instance 2: same data directory, new process.
		const engine2 = new ScriptedEnginePort();
		engine2.autoOutcome = () => ({
			status: "completed",
			outputText: "recovered and executed",
		});
		const server2 = await GatewayServer.start({
			dataRoot,
			namespace: "default",
			engine: engine2,
		});
		servers.push(server2);

		// Durable identity is stable; the process identity is not.
		expect(server2.stores.meta.ensureGatewayId()).toBe(gatewayId1);
		expect(server2.instanceId).not.toBe(server1.instanceId);
		const freshDiscovery = readDiscoveryRecord(server2.paths.discoveryFile);
		expect(freshDiscovery?.instanceId).toBe(server2.instanceId);
		expect(freshDiscovery?.auth).not.toBe(staleDiscovery.auth);

		// Committed state survived.
		expect(server2.stores.runs.get(finished.runId)?.state).toBe("completed");
		expect(server2.stores.runs.get(finished.runId)?.outputText).toBe(
			"committed output",
		);

		// The abandoned attempt was interrupted — not auto-resumed.
		const interrupted = server2.stores.runs.get(abandoned.runId);
		expect(interrupted?.state).toBe("interrupted");
		expect(engine2.handlesFor(abandoned.runId)).toHaveLength(0);
		expect(
			server2.stores.attempts
				.listByRun(abandoned.runId)
				.map((attempt) => attempt.state),
		).toEqual(["interrupted"]);

		// The committed queued run was re-admitted and executed.
		await waitFor(
			() => server2.stores.runs.get(queued.runId)?.state === "completed",
		);
		expect(server2.stores.runs.get(queued.runId)?.outputText).toBe(
			"recovered and executed",
		);

		// The idempotent acknowledgement replays across the restart: the
		// same key returns the original runId instead of admitting again.
		const client2 = await connectTo(server2);
		const replay = (await client2.mutate("run.start", {
			idempotencyKey: abandonedKey,
			botId,
			prompt: "mid-flight at crash",
		})) as RunAccepted;
		expect(replay.runId).toBe(abandoned.runId);
		expect(engine2.handlesFor(abandoned.runId)).toHaveLength(0);

		// Event history is one continuous, durable stream: a client can
		// replay everything from the beginning across both instances.
		const events = server2.stores.events.listAfter(-1, {}, 1000);
		const names = events.map((event) => event.event);
		expect(names).toContain("gateway.recoveryCompleted");
		expect(
			events.filter(
				(event) =>
					event.event === "run.completed" &&
					event.scope.runId === finished.runId,
			),
		).toHaveLength(1);
	});
});
