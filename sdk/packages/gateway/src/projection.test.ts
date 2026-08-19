/**
 * Crash points around disk projection (ADR 0001): the database is
 * authoritative; files are outbox-driven projections. A projector that
 * fails — or a process that crashes between the commit and the file
 * write — loses nothing: pending outbox entries retry until the
 * projection converges with the database.
 */

import { existsSync, readFileSync } from "node:fs";
import type { RunAccepted, SessionId } from "@cline/shared/gateway";
import { afterEach, describe, expect, it } from "vitest";
import { GatewayClient } from "./client";
import { createFileProjector } from "./outbox";
import { GatewayServer } from "./server";
import type { OutboxEntry } from "./stores";
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

async function runOneTurn(server: GatewayServer, engine: ScriptedEnginePort) {
	const discovery = server.discovery;
	if (!discovery) {
		throw new Error("no discovery");
	}
	const client = await GatewayClient.connectToDiscovery(discovery, {
		clientName: "projection-test",
		clientVersion: "0.0.1",
	});
	clients.push(client);
	const botId = server.runtime.defaultBotId;
	if (!botId) {
		throw new Error("no default bot");
	}
	const accepted = (await client.mutate("run.start", {
		botId,
		prompt: "project me",
	})) as RunAccepted;
	await waitFor(() => engine.handles.length >= 1);
	const handle = engine.handles.at(-1);
	handle?.emit({
		type: "message-appended",
		message: {
			id: "msg_projected",
			role: "assistant",
			content: [{ type: "text", text: "projected message" }],
			createdAt: Date.now(),
		},
		index: 0,
	});
	handle?.settle({ outputText: "projection source" });
	await waitFor(
		() => server.stores.runs.get(accepted.runId)?.state === "completed",
	);
	const sessionId = server.stores.runs.get(accepted.runId)
		?.sessionId as SessionId;
	return { accepted, sessionId };
}

describe("outbox-driven projection", () => {
	it("retries failed projections until they converge (DB stays authoritative)", async () => {
		const engine = new ScriptedEnginePort();
		const dataRoot = tempDataRoot();
		let failures = 0;
		let realProjector: ReturnType<typeof createFileProjector> | undefined;
		const flakyProjector = (entry: OutboxEntry) => {
			if (failures < 2) {
				failures += 1;
				throw new Error(`injected projector crash #${failures}`);
			}
			return realProjector?.(entry);
		};
		const server = await GatewayServer.start({
			dataRoot,
			namespace: "default",
			engine,
			projector: flakyProjector,
			outbox: { retryDelayMs: 10 },
		});
		servers.push(server);
		realProjector = createFileProjector(server.paths, server.stores);

		const { sessionId } = await runOneTurn(server, engine);
		const file = server.paths.sessionProjectionFile(sessionId);

		// The failures were recorded, the entries stayed pending, and the
		// retry timer converged the projection.
		await waitFor(() => existsSync(file), { timeoutMs: 5_000 });
		await waitFor(() => server.stores.outbox.countPending() === 0);
		expect(failures).toBe(2);
		const projection = JSON.parse(readFileSync(file, "utf8"));
		expect(projection.session.sessionId).toBe(sessionId);
		expect(projection.runs[0].outputText).toBe("projection source");
		expect(
			projection.messages.map((m: { message: { id: string } }) => m.message.id),
		).toEqual(["msg_projected"]);
	});

	it("a crash before projection is repaired on restart from the outbox", async () => {
		const engine = new ScriptedEnginePort();
		const dataRoot = tempDataRoot();
		// Instance 1 never manages to project: every attempt fails, then the
		// process crashes. The commit (runs, messages, outbox) is durable.
		const server1 = await GatewayServer.start({
			dataRoot,
			namespace: "default",
			engine,
			projector: () => {
				throw new Error("crash point: projector never runs");
			},
			outbox: { retryDelayMs: 60_000 },
		});
		servers.push(server1);
		const { sessionId } = await runOneTurn(server1, engine);
		const file = server1.paths.sessionProjectionFile(sessionId);
		expect(existsSync(file)).toBe(false);
		expect(server1.stores.outbox.countPending()).toBeGreaterThan(0);
		await server1.stop("crash");

		// Instance 2 drains the surviving outbox with the real projector.
		const server2 = await GatewayServer.start({
			dataRoot,
			namespace: "default",
			engine: new ScriptedEnginePort(),
		});
		servers.push(server2);
		await server2.outboxWorker.drain();
		expect(server2.stores.outbox.countPending()).toBe(0);
		expect(existsSync(file)).toBe(true);
		const projection = JSON.parse(readFileSync(file, "utf8"));
		// The projection reflects authoritative post-recovery state.
		expect(projection.session.sessionId).toBe(sessionId);
		expect(projection.runs[0].outputText).toBe("projection source");
	});
});
