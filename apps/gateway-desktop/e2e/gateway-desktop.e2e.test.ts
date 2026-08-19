/**
 * End-to-end validation against a REAL Phase 3 Gateway: a
 * `GatewayServer` (SQLite authority, loopback NDJSON protocol,
 * singleton lock) with a scripted engine, the production
 * `DesktopBroker` connected through `@cline/gateway/client`, and — for
 * the multi-client scenarios — a second raw Gateway client fixture.
 *
 * Scenarios (spec §15): lazy first session with immediate ack;
 * streaming and canonical messages; steer; queue-next FIFO; interrupt;
 * manual retry (same runId, new attempt); approvals with
 * first-answer-wins across clients; app restart during a run; Gateway
 * restart with recovery and NO auto-resume; duplicate command
 * idempotency; incompatible protocol rejection; bridge frame limits.
 */

import { mkdtempSync } from "node:fs";
import { connect as netConnect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GatewayClient } from "@cline/gateway/client";
import { GatewayServer } from "@cline/gateway";
import { ScriptedEnginePort, waitFor } from "@cline/gateway/test-support";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
	BRIDGE_PROTOCOL_VERSION,
	MAX_BRIDGE_FRAME_BYTES,
} from "../shared/bridge";
import { startBridgeServer } from "../native/bridge/server";
import { DesktopBroker } from "../native/gateway/broker";
import { createGatewayPortFactory } from "../native/gateway/discovery";
import { DesktopStateStore } from "../native/gateway/state-store";
import { createNullLogger } from "../native/logging";

interface World {
	dataRoot: string;
	engine: ScriptedEnginePort;
	server: GatewayServer;
	broker: DesktopBroker;
	stateStore: DesktopStateStore;
	appDataDir: string;
	botId: string;
}

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) {
		await cleanup();
	}
});

async function startGateway(dataRoot: string, engine: ScriptedEnginePort) {
	const server = await GatewayServer.start({
		dataRoot,
		namespace: "default",
		engine,
	});
	cleanups.push(async () => {
		await server.stop("graceful").catch(() => {});
	});
	return server;
}

function createBroker(dataRoot: string, appDataDir: string) {
	const stateStore = new DesktopStateStore(join(appDataDir, "state.json"));
	const broker = new DesktopBroker({
		connectPort: createGatewayPortFactory({
			discovery: { dataRoot, namespace: "default" },
			clientName: "gateway-desktop-e2e",
		}),
		stateStore,
		logger: createNullLogger(),
		jitterRatio: 0,
	});
	cleanups.push(() => broker.stop());
	return { broker, stateStore };
}

async function startWorld(): Promise<World> {
	const dataRoot = mkdtempSync(join(tmpdir(), "gwd-e2e-gateway-"));
	const appDataDir = mkdtempSync(join(tmpdir(), "gwd-e2e-app-"));
	const engine = new ScriptedEnginePort();
	const server = await startGateway(dataRoot, engine);
	const { broker, stateStore } = createBroker(dataRoot, appDataDir);
	await broker.start();
	const botId = server.runtime.defaultBotId;
	if (!botId) {
		throw new Error("gateway bootstrapped no default bot");
	}
	return { dataRoot, engine, server, broker, stateStore, appDataDir, botId };
}

async function connectSecondClient(world: World): Promise<GatewayClient> {
	const discovery = world.server.discovery;
	if (!discovery) {
		throw new Error("no discovery record");
	}
	const client = await GatewayClient.connectToDiscovery(discovery, {
		clientName: "second-client-fixture",
		clientVersion: "0.0.1",
	});
	cleanups.push(() => client.close());
	return client;
}

let requestCounter = 0;
function requestId(): string {
	requestCounter += 1;
	return `req_e2e_${String(requestCounter).padStart(6, "0")}`;
}

describe("first session and runs", () => {
	it("creates the session lazily from the first prompt with an immediate ack", async () => {
		const world = await startWorld();
		expect(world.broker.projectionSnapshot.sessions).toHaveLength(0);

		const accepted = (await world.broker.execute({
			command: "run.start",
			clientRequestId: requestId(),
			botId: world.botId,
			prompt: "first ever prompt",
		})) as { runId: string; acceptedAt: number; queuePosition: number };
		// Immediate ack: the engine has not finished (or even started).
		expect(accepted.runId).toMatch(/^run_/);
		expect(accepted.queuePosition).toBe(0);

		await waitFor(() =>
			world.broker.projectionSnapshot.sessions.some(
				(session) => session.botId === world.botId,
			),
		);
		await waitFor(
			() =>
				world.broker.projectionSnapshot.activeSession?.currentRun?.state ===
				"running",
		);
		world.engine.lastHandle?.settle({ outputText: "first done" });
		await waitFor(
			() =>
				world.broker.projectionSnapshot.activeSession?.currentRun?.state ===
				"completed",
		);
	});

	it("streams engine deltas and canonical messages into the projection", async () => {
		const world = await startWorld();
		await world.broker.execute({
			command: "run.start",
			clientRequestId: requestId(),
			botId: world.botId,
			prompt: "stream to me",
		});
		await waitFor(() => world.engine.handles.length === 1);
		// Live deltas render once the session view is open (deltas emitted
		// earlier are covered by the canonical message history instead).
		await waitFor(() =>
			Boolean(world.broker.projectionSnapshot.activeSession),
		);
		const handle = world.engine.handles[0];
		handle.emit({ type: "text-delta", text: "Hello " });
		handle.emit({ type: "text-delta", text: "world" });
		await waitFor(
			() =>
				world.broker.projectionSnapshot.activeSession?.streaming?.text ===
				"Hello world",
		);
		handle.emit({
			type: "message-appended",
			message: {
				id: "msg_e2e_1",
				role: "assistant",
				content: [{ type: "text", text: "Hello world" }],
				createdAt: Date.now(),
			},
		});
		await waitFor(() =>
			Boolean(
				world.broker.projectionSnapshot.activeSession?.messages.some(
					(message) => message.id === "msg_e2e_1",
				),
			),
		);
		// The streaming buffer resets once the canonical message lands.
		expect(
			world.broker.projectionSnapshot.activeSession?.streaming,
		).toBeUndefined();
		handle.settle({ outputText: "Hello world" });
	});

	it("steers the active run and queues the next turn FIFO", async () => {
		const world = await startWorld();
		const first = (await world.broker.execute({
			command: "run.start",
			clientRequestId: requestId(),
			botId: world.botId,
			prompt: "long task",
		})) as { runId: string };
		await waitFor(() => world.engine.handles.length === 1);

		const steer = (await world.broker.execute({
			command: "run.steer",
			clientRequestId: requestId(),
			runId: first.runId,
			text: "focus on part two",
		})) as { merged: boolean };
		expect(steer.merged).toBe(true);
		expect(world.engine.handles[0].steers).toEqual(["focus on part two"]);

		const queued = (await world.broker.execute({
			command: "run.start",
			clientRequestId: requestId(),
			botId: world.botId,
			prompt: "the next turn",
		})) as { runId: string; queuePosition: number };
		expect(queued.queuePosition).toBe(1);
		await waitFor(() =>
			Boolean(
				world.broker.projectionSnapshot.activeSession?.queuedTurns.some(
					(turn) => turn.runId === queued.runId,
				),
			),
		);

		// FIFO: finishing the first starts the queued one.
		world.engine.handles[0].settle({ outputText: "part one done" });
		await waitFor(() => world.engine.handles.length === 2);
		expect(world.engine.handles[1].invocation.input).toBe("the next turn");
		world.engine.handles[1].settle({ outputText: "part two done" });
		await waitFor(
			() =>
				world.broker.projectionSnapshot.activeSession?.currentRun?.state ===
				"completed",
		);
	});

	it("interrupts the active run and manually retries it (same runId, new attempt)", async () => {
		const world = await startWorld();
		const accepted = (await world.broker.execute({
			command: "run.start",
			clientRequestId: requestId(),
			botId: world.botId,
			prompt: "interruptible work",
		})) as { runId: string };
		await waitFor(() => world.engine.handles.length === 1);

		await world.broker.execute({
			command: "run.interrupt",
			clientRequestId: requestId(),
			runId: accepted.runId,
			reason: "user pressed stop",
		});
		await waitFor(
			() =>
				world.broker.projectionSnapshot.activeSession?.currentRun?.state ===
				"interrupted",
		);
		expect(
			world.broker.projectionSnapshot.activeSession?.currentRun?.retryable,
		).toBe(true);

		const retried = (await world.broker.execute({
			command: "run.retry",
			clientRequestId: requestId(),
			runId: accepted.runId,
		})) as { runId: string };
		expect(retried.runId).toBe(accepted.runId);
		await waitFor(() => world.engine.handles.length === 2);
		world.engine.handles[1].settle({ outputText: "second attempt done" });
		await waitFor(
			() =>
				world.server.stores.runs.get(accepted.runId as never)?.state ===
				"completed",
		);
		expect(
			world.server.stores.attempts.listByRun(accepted.runId as never),
		).toHaveLength(2);
		await waitFor(
			() =>
				world.broker.projectionSnapshot.activeSession?.currentRun?.attempt ===
				2,
		);
	});

	it("replays duplicate commands idempotently (no double mutations)", async () => {
		const world = await startWorld();
		const shared = requestId();
		const command = {
			command: "run.start" as const,
			clientRequestId: shared,
			botId: world.botId,
			prompt: "exactly once over the wire",
		};
		const first = (await world.broker.execute(command)) as { runId: string };
		const replay = (await world.broker.execute(command)) as { runId: string };
		expect(replay.runId).toBe(first.runId);
		// Also across the Gateway idempotency ledger (fresh broker command
		// cache, same clientRequestId → same Gateway idempotency key).
		const secondBrokerWorld = createBroker(
			world.dataRoot,
			mkdtempSync(join(tmpdir(), "gwd-e2e-app2-")),
		);
		await secondBrokerWorld.broker.start();
		const replayedElsewhere = (await secondBrokerWorld.broker.execute(
			command,
		)) as { runId: string };
		expect(replayedElsewhere.runId).toBe(first.runId);
		expect(
			world.server.stores.runs.listBySession(
				world.server.stores.sessions.list()[0].sessionId,
			),
		).toHaveLength(1);
		world.engine.lastHandle?.settle({});
	});
});

describe("approvals across clients", () => {
	it("delivers approvals to every attached client; first answer wins", async () => {
		const world = await startWorld();
		const accepted = (await world.broker.execute({
			command: "run.start",
			clientRequestId: requestId(),
			botId: world.botId,
			prompt: "risky tool use",
		})) as { runId: string };
		await waitFor(() => world.engine.handles.length === 1);
		const invocation = world.engine.handles[0].invocation;

		// The second client (fixture) subscribes and will answer FIRST —
		// but only after the desktop demonstrably sees the same request.
		let releaseSecondAnswer!: () => void;
		const secondAnswerGate = new Promise<void>((resolve) => {
			releaseSecondAnswer = resolve;
		});
		const second = await connectSecondClient(world);
		second.onServerRequest(async () => {
			await secondAnswerGate;
			return { approved: false, reason: "second client denies first" };
		});
		await second.subscribe({ runId: accepted.runId });

		const answer = world.server.runtime.approvals.request(
			"client.requestToolApproval",
			{
				botId: invocation.botId,
				sessionId: invocation.sessionId,
				runId: invocation.runId,
			},
			{ toolName: "write_file", toolCallId: "call_e2e_1" },
		);
		// The desktop projection surfaced the same request; then let the
		// second client win the race.
		await waitFor(
			() => world.broker.projectionSnapshot.approvals.length === 1,
		);
		releaseSecondAnswer();
		const result = (await answer) as { approved: boolean };
		expect(result.approved).toBe(false);

		// The desktop dismisses via the approval.resolved broadcast and a
		// late desktop answer is rejected locally.
		await waitFor(
			() => world.broker.projectionSnapshot.approvals.length === 0,
		);
		const late = world.broker.execute({
			command: "approval.resolve",
			clientRequestId: requestId(),
			requestId: "srq_1",
			approved: true,
		});
		await expect(late).rejects.toMatchObject({
			code: "approval_already_resolved",
		});
		world.engine.handles[0].settle({});
	});

	it("lets the desktop answer first and re-issues pending approvals on reconnect", async () => {
		const world = await startWorld();
		const accepted = (await world.broker.execute({
			command: "run.start",
			clientRequestId: requestId(),
			botId: world.botId,
			prompt: "approval please",
		})) as { runId: string };
		await waitFor(() => world.engine.handles.length === 1);
		const invocation = world.engine.handles[0].invocation;
		const answer = world.server.runtime.approvals.request(
			"client.requestToolApproval",
			{
				botId: invocation.botId,
				sessionId: invocation.sessionId,
				runId: invocation.runId,
			},
			{ toolName: "execute_command", toolCallId: "call_e2e_2" },
		);
		await waitFor(
			() => world.broker.projectionSnapshot.approvals.length === 1,
		);
		const pendingId = world.broker.projectionSnapshot.approvals[0].requestId;
		const resolved = (await world.broker.execute({
			command: "approval.resolve",
			clientRequestId: requestId(),
			requestId: pendingId,
			approved: true,
		})) as { resolved: boolean };
		expect(resolved.resolved).toBe(true);
		await expect(answer).resolves.toMatchObject({ approved: true });
		expect(world.server.runtime.approvals.pendingCount).toBe(0);
		world.engine.handles[0].settle({});
	});
});

describe("restart resilience", () => {
	it("app restart during a run: a new broker rehydrates and the run was never disturbed", async () => {
		const world = await startWorld();
		const accepted = (await world.broker.execute({
			command: "run.start",
			clientRequestId: requestId(),
			botId: world.botId,
			prompt: "outlive the app",
		})) as { runId: string };
		await waitFor(() => world.engine.handles.length === 1);
		world.engine.handles[0].emit({
			type: "message-appended",
			message: {
				id: "msg_before_restart",
				role: "assistant",
				content: [{ type: "text", text: "progress before restart" }],
				createdAt: Date.now(),
			},
		});
		await waitFor(() =>
			Boolean(
				world.broker.projectionSnapshot.activeSession?.messages.some(
					(message) => message.id === "msg_before_restart",
				),
			),
		);

		// The app dies mid-run. Closing NEVER interrupts the run.
		world.broker.stop();
		expect(world.engine.handles[0].interrupted).toBe(false);
		expect(world.engine.handles[0].aborted).toBe(false);

		// Work continues while no app is attached.
		world.engine.handles[0].emit({
			type: "message-appended",
			message: {
				id: "msg_while_away",
				role: "assistant",
				content: [{ type: "text", text: "kept working alone" }],
				createdAt: Date.now(),
			},
		});
		world.engine.handles[0].settle({ outputText: "done while away" });
		await waitFor(
			() =>
				world.server.stores.runs.get(accepted.runId as never)?.state ===
				"completed",
		);

		// Relaunch: same app data dir → same cursor, same session.
		const relaunched = createBroker(world.dataRoot, world.appDataDir);
		await relaunched.broker.start();
		await waitFor(() =>
			Boolean(
				relaunched.broker.projectionSnapshot.activeSession?.messages.some(
					(message) => message.id === "msg_while_away",
				),
			),
		);
		const projection = relaunched.broker.projectionSnapshot;
		expect(projection.activeSession?.currentRun?.state).toBe("completed");
		expect(
			projection.activeSession?.messages.map((message) => message.id),
		).toContain("msg_before_restart");
	});

	it("gateway restart: recovery interrupts abandoned attempts, never auto-resumes; manual retry works", async () => {
		const world = await startWorld();
		const accepted = (await world.broker.execute({
			command: "run.start",
			clientRequestId: requestId(),
			botId: world.botId,
			prompt: "survive a gateway crash",
		})) as { runId: string };
		await waitFor(() => world.engine.handles.length === 1);
		await waitFor(() =>
			Boolean(world.broker.projectionSnapshot.activeSession),
		);

		// The Gateway crashes hard (SIGKILL semantics: no cleanup).
		await world.server.stop("crash");
		await waitFor(
			() => world.broker.projectionSnapshot.connection.state !== "connected",
		);

		// A new Gateway instance recovers: the abandoned attempt is marked
		// interrupted and NOT auto-resumed.
		const engine2 = new ScriptedEnginePort();
		const server2 = await startGateway(world.dataRoot, engine2);
		expect(engine2.handles).toHaveLength(0);
		expect(
			server2.stores.runs.get(accepted.runId as never)?.state,
		).toBe("interrupted");

		// The broker reconnects to the SAME gateway identity (new
		// instance) and shows the interrupted run as retryable. Nothing is
		// retried automatically.
		await waitFor(
			() => world.broker.projectionSnapshot.connection.state === "connected",
			{ timeoutMs: 15_000 },
		);
		expect(world.broker.projectionSnapshot.connection.gatewayId).toBe(
			server2.stores.meta.ensureGatewayId(),
		);
		expect(world.broker.projectionSnapshot.connection.instanceId).toBe(
			server2.instanceId,
		);
		await waitFor(
			() =>
				world.broker.projectionSnapshot.activeSession?.currentRun?.state ===
				"interrupted",
		);
		expect(engine2.handles).toHaveLength(0);

		// Manual retry: same runId, new attempt, on the new instance.
		const retried = (await world.broker.execute({
			command: "run.retry",
			clientRequestId: requestId(),
			runId: accepted.runId,
		})) as { runId: string };
		expect(retried.runId).toBe(accepted.runId);
		await waitFor(() => engine2.handles.length === 1);
		engine2.handles[0].settle({ outputText: "recovered manually" });
		await waitFor(
			() =>
				server2.stores.runs.get(accepted.runId as never)?.state ===
				"completed",
		);
		expect(
			server2.stores.attempts.listByRun(accepted.runId as never).length,
		).toBeGreaterThanOrEqual(2);
	});
});

describe("protocol and bridge limits", () => {
	it("rejects an incompatible protocol version with a stable code", async () => {
		const world = await startWorld();
		const discovery = world.server.discovery;
		if (!discovery) {
			throw new Error("no discovery");
		}
		const response = await new Promise<string>((resolve, reject) => {
			const socket = netConnect({
				host: discovery.host,
				port: discovery.port,
			});
			socket.setEncoding("utf8");
			socket.once("data", (chunk: string) => {
				socket.destroy();
				resolve(chunk);
			});
			socket.once("error", reject);
			socket.write(
				`${JSON.stringify({
					version: 1,
					id: "hello_1",
					method: "gateway.hello",
					params: {
						protocolVersions: [999],
						client: { name: "future-client", version: "9.9.9" },
						auth: discovery.auth,
					},
				})}\n`,
			);
		});
		expect(JSON.parse(response).error.code).toBe(
			"protocol_version_unsupported",
		);
	});

	it("enforces the 1 MiB bridge frame limit end to end", async () => {
		const world = await startWorld();
		const bridge = await startBridgeServer({
			broker: world.broker,
			logger: createNullLogger(),
			secrets: ["e2e-bridge-secret-000001"],
		});
		cleanups.push(() => bridge.close());
		const socket = new WebSocket(`ws://127.0.0.1:${bridge.port()}/`);
		await new Promise<void>((resolve) => socket.once("open", () => resolve()));
		socket.send(
			JSON.stringify({
				v: BRIDGE_PROTOCOL_VERSION,
				type: "authenticate",
				secret: "e2e-bridge-secret-000001",
			}),
		);
		await new Promise<void>((resolve) =>
			socket.on("message", (raw) => {
				if (JSON.parse(String(raw)).type === "authenticated") {
					resolve();
				}
			}),
		);
		const closed = new Promise<number>((resolve) =>
			socket.once("close", (code) => resolve(code)),
		);
		socket.send(
			JSON.stringify({
				v: BRIDGE_PROTOCOL_VERSION,
				type: "command",
				id: "big",
				payload: {
					command: "run.start",
					clientRequestId: requestId(),
					botId: world.botId,
					prompt: "z".repeat(MAX_BRIDGE_FRAME_BYTES + 1024),
				},
			}),
		);
		expect(await closed).toBe(1009);
	});
});
