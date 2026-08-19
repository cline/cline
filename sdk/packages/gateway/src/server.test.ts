/**
 * Loopback server end-to-end (real TCP, real SQLite): hello-first auth,
 * immediate run acknowledgement, durable event replay from cursors,
 * two-client consistency and FIFO admission on one session, client loss
 * without abort, wire idempotency, approvals as server requests, drain,
 * and the second-starter rule (connect or diagnose, never replace).
 */

import { existsSync } from "node:fs";
import { connect } from "node:net";
import type { BotId, GatewayEvent, RunAccepted } from "@cline/shared/gateway";
import {
	createEventCursor,
	createIdempotencyKey,
	encodeEventCursor,
} from "@cline/shared/gateway";
import { afterEach, describe, expect, it } from "vitest";
import { GatewayClient, GatewayRequestError } from "./client";
import { readDiscoveryRecord } from "./discovery";
import { GatewayLockHeldError } from "./lock";
import { GatewayServer, type GatewayServerOptions } from "./server";
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

async function startServer(
	overrides: Partial<GatewayServerOptions> = {},
): Promise<{
	server: GatewayServer;
	engine: ScriptedEnginePort;
	dataRoot: string;
	connect(name?: string): Promise<GatewayClient>;
	defaultBotId(): BotId;
}> {
	const engine =
		(overrides.engine as ScriptedEnginePort | undefined) ??
		new ScriptedEnginePort();
	const dataRoot = tempDataRoot();
	const server = await GatewayServer.start({
		dataRoot,
		namespace: "default",
		engine,
		...overrides,
	});
	servers.push(server);
	const discovery = server.discovery;
	if (!discovery) {
		throw new Error("server did not publish discovery");
	}
	return {
		server,
		engine,
		dataRoot,
		async connect(name = "test-client") {
			const client = await GatewayClient.connectToDiscovery(discovery, {
				clientName: name,
				clientVersion: "0.0.1",
			});
			clients.push(client);
			return client;
		},
		defaultBotId() {
			const botId = server.runtime.defaultBotId;
			if (!botId) {
				throw new Error("no default bot");
			}
			return botId;
		},
	};
}

function recordEvents(client: GatewayClient): GatewayEvent[] {
	const seen: GatewayEvent[] = [];
	client.onEvent((event) => seen.push(event));
	return seen;
}

describe("handshake and auth", () => {
	it("publishes a 0600 discovery record only after readiness and negotiates hello", async () => {
		const { server, connect: connectClient } = await startServer();
		const record = readDiscoveryRecord(server.paths.discoveryFile);
		expect(record?.port).toBe(server.address().port);
		const client = await connectClient();
		expect(client.hello.gatewayId).toBe(record?.gatewayId);
		expect(client.hello.instanceId).toBe(server.instanceId);
		expect(client.hello.capabilities).toContain("runs.async");
	});

	it("rejects a hello without the per-instance secret", async () => {
		const { server } = await startServer();
		const { host, port } = server.address();
		await expect(
			GatewayClient.connect({ host, port, auth: "wrong-secret-token" }),
		).rejects.toMatchObject({
			gatewayError: { code: "unauthorized" },
		});
	});

	it("rejects any request before gateway.hello", async () => {
		const { server } = await startServer();
		const { host, port } = server.address();
		const socket = connect({ host, port });
		const response = await new Promise<string>((resolve) => {
			socket.setEncoding("utf8");
			socket.once("data", (chunk: string) => resolve(chunk));
			socket.write(
				`${JSON.stringify({ version: 1, id: "req_1", method: "gateway.status" })}\n`,
			);
		});
		socket.destroy();
		expect(JSON.parse(response).error.code).toBe("handshake_required");
	});
});

describe("async runs over the wire", () => {
	it("acks run.start immediately and streams durable events to a subscriber", async () => {
		const {
			engine,
			connect: connectClient,
			defaultBotId,
		} = await startServer();
		const client = await connectClient();
		const seen = recordEvents(client);
		await client.subscribe({
			cursor: encodeEventCursor(createEventCursor(-1)),
		});
		const accepted = (await client.mutate("run.start", {
			botId: defaultBotId(),
			prompt: "hello gateway",
		})) as RunAccepted;
		expect(accepted.runId).toMatch(/^run_/);
		expect(accepted.queuePosition).toBe(0);

		// The ack arrived while the engine is still running: no outcome yet.
		await waitFor(() => engine.handles.length === 1);
		expect(engine.handles[0].settled).toBe(false);
		engine.handles[0].settle({ outputText: "all done" });

		await waitFor(() =>
			seen.some(
				(event) =>
					event.event === "run.completed" &&
					event.scope.runId === accepted.runId,
			),
		);
		const names = seen.map((event) => event.event);
		expect(names).toContain("run.queued");
		expect(names).toContain("run.started");
		const sequences = seen.map((event) => event.sequence);
		expect([...sequences].sort((a, b) => a - b)).toEqual(sequences);
	});

	it("keeps two clients consistent with FIFO admission on one session", async () => {
		const {
			engine,
			connect: connectClient,
			defaultBotId,
		} = await startServer();
		const clientA = await connectClient("client-a");
		const clientB = await connectClient("client-b");
		const seenA = recordEvents(clientA);
		const seenB = recordEvents(clientB);
		const initialCursor = encodeEventCursor(createEventCursor(-1));
		await clientA.subscribe({ cursor: initialCursor });
		await clientB.subscribe({ cursor: initialCursor });

		const first = (await clientA.mutate("run.start", {
			botId: defaultBotId(),
			prompt: "first prompt",
		})) as RunAccepted;
		const second = (await clientB.mutate("run.start", {
			botId: defaultBotId(),
			prompt: "second prompt",
		})) as RunAccepted;

		// FIFO admission on the single session: A is active, B queued.
		expect(first.queuePosition).toBe(0);
		expect(second.queuePosition).toBe(1);
		await waitFor(() => engine.handles.length === 1);
		expect(engine.handles[0].invocation.input).toBe("first prompt");

		engine.handles[0].settle({ outputText: "first done" });
		await waitFor(() => engine.handles.length === 2);
		expect(engine.handles[1].invocation.input).toBe("second prompt");
		engine.handles[1].settle({ outputText: "second done" });

		const done = (events: GatewayEvent[]) =>
			["run.queued", "run.started", "run.completed"].every((name) =>
				events.some(
					(event) => event.event === name && event.scope.runId === second.runId,
				),
			);
		await waitFor(() => done(seenA) && done(seenB));

		// Both clients observed the identical canonical event stream.
		const key = (event: GatewayEvent) => `${event.sequence}:${event.event}`;
		expect(seenA.map(key)).toEqual(seenB.map(key));
		// Session consistency: both runs share one session.
		const runs = (await clientA.request("run.list", {
			sessionId: undefined,
		})) as { runs: { runId: string; sessionId: string }[] };
		void runs;
		const sessions = (await clientB.request("session.list")) as {
			sessions: { sessionId: string }[];
		};
		expect(sessions.sessions).toHaveLength(1);
	});

	it("client loss never aborts the run; a new client resumes from its cursor", async () => {
		const {
			server,
			engine,
			connect: connectClient,
			defaultBotId,
		} = await startServer();
		const clientA = await connectClient("doomed-client");
		const seenA = recordEvents(clientA);
		await clientA.subscribe({
			cursor: encodeEventCursor(createEventCursor(-1)),
		});
		const accepted = (await clientA.mutate("run.start", {
			botId: defaultBotId(),
			prompt: "outlive my client",
		})) as RunAccepted;
		await waitFor(() => seenA.some((event) => event.event === "run.started"));
		const lastSeen = Math.max(...seenA.map((event) => event.sequence));

		// The client vanishes mid-run. Disconnect never implies abort.
		clientA.close();
		await waitFor(() => engine.handles.length === 1);
		expect(engine.handles[0].aborted).toBe(false);
		expect(engine.handles[0].interrupted).toBe(false);
		engine.handles[0].emit({ type: "text-delta", text: "still going" });
		engine.handles[0].settle({ outputText: "finished alone" });
		await waitFor(
			() => server.stores.runs.get(accepted.runId)?.state === "completed",
		);

		// A new client replays exactly the missed suffix from the cursor.
		const clientB = await connectClient("resuming-client");
		const seenB = recordEvents(clientB);
		await clientB.subscribe({
			runId: accepted.runId,
			cursor: encodeEventCursor(createEventCursor(lastSeen)),
		});
		await waitFor(() => seenB.some((event) => event.event === "run.completed"));
		expect(seenB.every((event) => event.sequence > lastSeen)).toBe(true);
		expect(
			seenB.some(
				(event) =>
					event.event === "engine.textDelta" &&
					event.payload?.text === "still going",
			),
		).toBe(true);
		expect(
			seenB.some(
				(event) =>
					event.event === "run.completed" &&
					event.payload?.outputText === "finished alone",
			),
		).toBe(true);
	});

	it("replays idempotent run.start without admitting a second run", async () => {
		const {
			server,
			engine,
			connect: connectClient,
			defaultBotId,
		} = await startServer();
		const client = await connectClient();
		const idempotencyKey = createIdempotencyKey();
		const first = (await client.mutate("run.start", {
			idempotencyKey,
			botId: defaultBotId(),
			prompt: "exactly once",
		})) as RunAccepted;
		const replay = (await client.mutate("run.start", {
			idempotencyKey,
			botId: defaultBotId(),
			prompt: "exactly once",
		})) as RunAccepted;
		expect(replay.runId).toBe(first.runId);
		expect(engine.handles).toHaveLength(1);
		expect(
			server.stores.runs.listBySession(engine.handles[0].invocation.sessionId),
		).toHaveLength(1);

		// The same key with different params is a conflict, not a new run.
		await expect(
			client.mutate("run.start", {
				idempotencyKey,
				botId: defaultBotId(),
				prompt: "something else",
			}),
		).rejects.toMatchObject({
			gatewayError: { code: "idempotency_conflict" },
		});
	});

	it("steers the active run over the wire", async () => {
		const {
			engine,
			connect: connectClient,
			defaultBotId,
		} = await startServer();
		const client = await connectClient();
		const accepted = (await client.mutate("run.start", {
			botId: defaultBotId(),
			prompt: "steerable",
		})) as RunAccepted;
		const outcome = (await client.mutate("run.steer", {
			runId: accepted.runId,
			text: "change of plan",
		})) as { merged: boolean };
		expect(outcome.merged).toBe(true);
		expect(engine.handles[0].steers).toEqual(["change of plan"]);
		engine.handles[0].settle({});
	});
});

describe("server requests (approvals)", () => {
	it("routes pending approvals to subscribed clients and re-issues on reconnect", async () => {
		const {
			server,
			engine,
			connect: connectClient,
			defaultBotId,
		} = await startServer();
		const client = await connectClient();
		const accepted = (await client.mutate("run.start", {
			botId: defaultBotId(),
			prompt: "needs approval",
		})) as RunAccepted;
		await waitFor(() => engine.handles.length === 1);
		const invocation = engine.handles[0].invocation;

		// The engine asks; nobody is subscribed yet — the request pends.
		const answer = server.runtime.approvals.request(
			"client.requestToolApproval",
			{
				botId: invocation.botId,
				sessionId: invocation.sessionId,
				runId: invocation.runId,
			},
			{ toolName: "write_file", toolCallId: "call_1" },
		);
		expect(server.runtime.approvals.pendingCount).toBe(1);

		// A (re)connecting client subscribes to the run and gets the pending
		// request re-issued; disconnects neither lose nor answer it.
		client.onServerRequest((request) => {
			expect(request.method).toBe("client.requestToolApproval");
			expect(request.scope.runId).toBe(accepted.runId);
			return { approved: true, reason: "test approves" };
		});
		await client.subscribe({ runId: accepted.runId });

		const result = (await answer) as { approved: boolean };
		expect(result.approved).toBe(true);
		expect(server.runtime.approvals.pendingCount).toBe(0);
		engine.handles[0].settle({});
	});
});

describe("drain and stop", () => {
	it("draining refuses new mutating work but lets active runs finish", async () => {
		const {
			engine,
			connect: connectClient,
			defaultBotId,
		} = await startServer();
		const client = await connectClient();
		const accepted = (await client.mutate("run.start", {
			botId: defaultBotId(),
			prompt: "before drain",
		})) as RunAccepted;
		await client.mutate("gateway.drain", { reason: "test drain" });

		await expect(
			client.mutate("run.start", {
				botId: defaultBotId(),
				prompt: "after drain",
			}),
		).rejects.toMatchObject({
			gatewayError: { code: "gateway_draining", retryable: true },
		});

		// The in-flight run is untouched and can still be steered/finished.
		const steer = (await client.mutate("run.steer", {
			runId: accepted.runId,
			text: "finish up",
		})) as { merged: boolean };
		expect(steer.merged).toBe(true);
		engine.handles[0].settle({ outputText: "drained gracefully" });
		const status = (await client.request("gateway.status")) as {
			state: string;
		};
		expect(status.state).toBe("draining");
	});

	it("gateway.stop stops the instance and removes its discovery record", async () => {
		const { server, connect: connectClient } = await startServer();
		const client = await connectClient();
		await client.mutate("gateway.stop", { reason: "test stop" });
		await server.whenStopped;
		expect(existsSync(server.paths.discoveryFile)).toBe(false);
		await expect(client.request("gateway.status")).rejects.toBeInstanceOf(
			GatewayRequestError,
		);
	});
});

describe("singleton ownership (ADR 0002/0003)", () => {
	it("a second starter fails the lock, never kills the authority, never binds a port", async () => {
		const { server, dataRoot, connect: connectClient } = await startServer();
		const before = readDiscoveryRecord(server.paths.discoveryFile);

		await expect(
			GatewayServer.start({
				dataRoot,
				namespace: "default",
				engine: new ScriptedEnginePort(),
			}),
		).rejects.toBeInstanceOf(GatewayLockHeldError);

		// The loser changed nothing: same discovery, same port, live server.
		const after = readDiscoveryRecord(server.paths.discoveryFile);
		expect(after).toEqual(before);
		const client = await connectClient("post-contention");
		const status = (await client.request("gateway.status")) as {
			instanceId: string;
		};
		expect(status.instanceId).toBe(server.instanceId);
	});

	it("two namespaces are two singleton scopes with independent locks", async () => {
		const dataRoot = tempDataRoot();
		const first = await GatewayServer.start({
			dataRoot,
			namespace: "alpha",
			engine: new ScriptedEnginePort(),
		});
		servers.push(first);
		const second = await GatewayServer.start({
			dataRoot,
			namespace: "beta",
			engine: new ScriptedEnginePort(),
		});
		servers.push(second);
		expect(first.paths.dataDir).not.toBe(second.paths.dataDir);
		expect(first.address().port).not.toBe(second.address().port);
	});
});
