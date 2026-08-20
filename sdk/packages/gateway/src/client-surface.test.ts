/**
 * Typed client surface added for application consumption (Gateway
 * Desktop validation app): `gateway.status` execution mode, typed
 * command wrappers, `session.get` hydration snapshots, `run.retry`
 * (same runId, new attempt), and the `approval.resolved` broadcast
 * that makes first-answer-wins visible to every attached client.
 */

import type { GatewayEvent } from "@cline/shared/gateway";
import { createEventCursor, encodeEventCursor } from "@cline/shared/gateway";
import { afterEach, describe, expect, it } from "vitest";
import { GatewayClient } from "./client";
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

async function startServer(overrides: Partial<GatewayServerOptions> = {}) {
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
		async connect(name = "surface-client") {
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

describe("typed client surface", () => {
	it("reports the unsandboxed development execution mode in gateway.status", async () => {
		const { connect } = await startServer();
		const client = await connect();
		const status = await client.getStatus();
		expect(status.executionMode).toBe("development");
		expect(status.sandboxed).toBe(false);
		expect(status.state).toBe("serving");
	});

	it("lists bots, sessions, and runs through typed wrappers", async () => {
		const { engine, connect, defaultBotId } = await startServer();
		const client = await connect();
		const bots = await client.listBots();
		expect(bots.bots.some((bot) => bot.identity.botId === defaultBotId())).toBe(
			true,
		);
		const accepted = await client.startRun({
			botId: defaultBotId(),
			prompt: "typed surface",
		});
		expect(accepted.runId).toMatch(/^run_/);
		const sessions = await client.listSessions({ botId: defaultBotId() });
		expect(sessions.sessions).toHaveLength(1);
		const runs = await client.listRuns({
			sessionId: sessions.sessions[0].sessionId,
		});
		expect(runs.runs.map((run) => run.runId)).toContain(accepted.runId);
		engine.lastHandle?.settle({});
	});

	it("starts a run in an explicitly created session without leaking session fields", async () => {
		const { engine, connect, defaultBotId } = await startServer();
		const client = await connect();
		const session = await client.createSession({
			botId: defaultBotId(),
			workspaceRoot: "/tmp/gateway-explicit-session",
		});
		const accepted = await client.startRun({
			botId: defaultBotId(),
			sessionId: session.sessionId,
			workspaceRoot: session.workspace.rootPath,
			prompt: "explicit session",
		});
		expect(Object.keys(accepted).sort()).toEqual([
			"acceptedAt",
			"queuePosition",
			"runId",
		]);
		engine.lastHandle?.settle({});
	});
});

describe("session.get hydration snapshot", () => {
	it("returns session, runs with attempts, messages, and a cursor basis", async () => {
		const { server, engine, connect, defaultBotId } = await startServer();
		const client = await connect();
		const accepted = await client.startRun({
			botId: defaultBotId(),
			prompt: "hydrate me",
		});
		await waitFor(() => engine.handles.length === 1);
		engine.handles[0].emit({
			type: "message-appended",
			message: {
				id: "msg_1",
				role: "assistant",
				content: [{ type: "text", text: "canonical message" }],
				createdAt: Date.now(),
			},
		});
		engine.handles[0].settle({ outputText: "hydrated" });
		await waitFor(
			() => server.stores.runs.get(accepted.runId)?.state === "completed",
		);

		const sessions = await client.listSessions();
		const snapshot = await client.getSession({
			sessionId: sessions.sessions[0].sessionId,
		});
		expect(snapshot.session.sessionId).toBe(sessions.sessions[0].sessionId);
		expect(snapshot.runs).toHaveLength(1);
		expect(snapshot.runs[0].runId).toBe(accepted.runId);
		expect(snapshot.runs[0].attempts).toHaveLength(1);
		expect(snapshot.runs[0].attempts[0].state).toBe("completed");
		expect(snapshot.messages).toHaveLength(1);
		expect(snapshot.messages[0].message.id).toBe("msg_1");
		expect(snapshot.lastEventSequence).toBe(
			server.stores.events.lastSequence(),
		);
	});

	it("rejects unknown sessions with not_found", async () => {
		const { connect } = await startServer();
		const client = await connect();
		await expect(
			client.getSession({ sessionId: "ses_does_not_exist" as never }),
		).rejects.toMatchObject({ gatewayError: { code: "not_found" } });
	});
});

describe("run.retry (same runId, new attempt)", () => {
	it("re-admits a failed run under the same runId as a new attempt", async () => {
		const engine = new ScriptedEnginePort();
		engine.autoOutcome = (_invocation, attemptIndex) =>
			attemptIndex === 0
				? {
						status: "failed",
						error: { name: "EngineError", message: "first try exploded" },
					}
				: { status: "completed", outputText: "second try worked" };
		const { server, connect, defaultBotId } = await startServer({ engine });
		const client = await connect();
		const seen = recordEvents(client);
		await client.subscribe({
			cursor: encodeEventCursor(createEventCursor(-1)),
		});

		const accepted = await client.startRun({
			botId: defaultBotId(),
			prompt: "flaky work",
		});
		await waitFor(
			() => server.stores.runs.get(accepted.runId)?.state === "failed",
		);

		const retried = await client.retryRun({ runId: accepted.runId });
		expect(retried.runId).toBe(accepted.runId);
		await waitFor(
			() => server.stores.runs.get(accepted.runId)?.state === "completed",
		);

		const attempts = server.stores.attempts.listByRun(accepted.runId);
		expect(attempts.map((attempt) => attempt.attempt)).toEqual([1, 2]);
		expect(attempts[0].state).toBe("failed");
		expect(attempts[1].state).toBe("completed");

		await waitFor(() => seen.some((event) => event.event === "run.completed"));
		const retriedEvent = seen.find((event) => event.event === "run.retried");
		expect(retriedEvent?.scope.runId).toBe(accepted.runId);
		expect(retriedEvent?.payload?.nextAttempt).toBe(2);
		expect(retriedEvent?.payload?.previousState).toBe("failed");
		// The full lifecycle repeated under the same runId.
		const lifecycle = seen
			.filter((event) => event.scope.runId === accepted.runId)
			.map((event) => event.event);
		expect(
			lifecycle.filter((name) => name === "run.queued").length,
		).toBeGreaterThanOrEqual(2);
		expect(lifecycle).toContain("run.failed");
		expect(lifecycle).toContain("run.completed");
	});

	it("re-admits an interrupted run on manual retry", async () => {
		const { server, engine, connect, defaultBotId } = await startServer();
		const client = await connect();
		const accepted = await client.startRun({
			botId: defaultBotId(),
			prompt: "interruptible",
		});
		await waitFor(() => engine.handles.length === 1);
		await client.interruptRun({ runId: accepted.runId, reason: "user stop" });
		await waitFor(
			() => server.stores.runs.get(accepted.runId)?.state === "interrupted",
		);

		const retried = await client.retryRun({ runId: accepted.runId });
		expect(retried.runId).toBe(accepted.runId);
		await waitFor(() => engine.handles.length === 2);
		engine.handles[1].settle({ outputText: "resumed" });
		await waitFor(
			() => server.stores.runs.get(accepted.runId)?.state === "completed",
		);
		expect(server.stores.attempts.listByRun(accepted.runId)).toHaveLength(2);
	});

	it("rejects retry of completed and aborted runs", async () => {
		const { server, engine, connect, defaultBotId } = await startServer();
		const client = await connect();
		const accepted = await client.startRun({
			botId: defaultBotId(),
			prompt: "finishes fine",
		});
		await waitFor(() => engine.handles.length === 1);
		engine.handles[0].settle({ outputText: "done" });
		await waitFor(
			() => server.stores.runs.get(accepted.runId)?.state === "completed",
		);
		await expect(
			client.retryRun({ runId: accepted.runId }),
		).rejects.toMatchObject({
			gatewayError: { code: "invalid_state_transition", retryable: false },
		});
	});

	it("replays an idempotent retry without admitting a third attempt", async () => {
		const engine = new ScriptedEnginePort();
		engine.autoOutcome = (_invocation, attemptIndex) =>
			attemptIndex === 0
				? { status: "failed", error: { name: "E", message: "boom" } }
				: undefined;
		const { server, connect, defaultBotId } = await startServer({ engine });
		const client = await connect();
		const accepted = await client.startRun({
			botId: defaultBotId(),
			prompt: "retry exactly once",
		});
		await waitFor(
			() => server.stores.runs.get(accepted.runId)?.state === "failed",
		);
		const idempotencyKey = "retry-key-000001";
		const first = await client.retryRun({
			runId: accepted.runId,
			idempotencyKey,
		});
		const replay = await client.retryRun({
			runId: accepted.runId,
			idempotencyKey,
		});
		expect(replay).toEqual(first);
		await waitFor(() => engine.handles.length === 2);
		expect(engine.handlesFor(accepted.runId)).toHaveLength(2);
		engine.handles[1].settle({ outputText: "made it" });
	});
});

describe("Phase 4-6 typed surface", () => {
	it("exposes execution health, plugin summary, and connector health in status", async () => {
		const { connect } = await startServer({
			executionHealth: () => ({
				isolation: "unsandboxed-development",
				development: true,
			}),
		});
		const client = await connect();
		const status = await client.getStatus();
		expect(status.execution?.isolation).toBe("unsandboxed-development");
		expect(status.execution?.development).toBe(true);
		expect(status.plugins?.generation).toBeGreaterThan(0);
		expect(status.plugins?.lastReloadOk).toBe(true);
		expect(status.connectorHealth?.running).toEqual([]);
		expect(status.counts.connectors).toBe(0);
		expect(status.counts.schedules).toBe(0);
	});

	it("registers and lists connectors through the typed surface", async () => {
		const { connect, defaultBotId } = await startServer({
			autoStartConnectors: false,
		});
		const client = await connect();
		const registered = await client.registerConnector({
			botId: defaultBotId(),
			kind: "telegram",
			name: "team-telegram",
			credentialRef: "telegram-token",
		});
		expect(registered.connectorId).toMatch(/^con_/);
		const listed = await client.listConnectors({ botId: defaultBotId() });
		expect(listed.connectors).toHaveLength(1);
		expect(listed.connectors[0].credentialRef).toBe("telegram-token");
	});

	it("creates schedules and reports automation provenance in session.get", async () => {
		const engine = new ScriptedEnginePort();
		engine.autoOutcome = () => ({ outputText: "scheduled work done" });
		const { server, connect, defaultBotId } = await startServer({
			engine,
			schedulerTickMs: 25,
		});
		const client = await connect();
		const schedule = await client.createSchedule({
			botId: defaultBotId(),
			name: "surface-schedule",
			prompt: "run on a timer",
			intervalMs: 30,
		});
		expect(schedule.scheduleId).toMatch(/^sch_/);
		const listed = await client.listSchedules({ botId: defaultBotId() });
		expect(listed.schedules.map((entry) => entry.scheduleId)).toContain(
			schedule.scheduleId,
		);

		await waitFor(
			() =>
				server.stores.scheduleJobs
					.report(schedule.scheduleId)
					.some((job) => job.state === "completed"),
			{ timeoutMs: 10_000 },
		);
		const report = await client.scheduleReport({
			scheduleId: schedule.scheduleId,
		});
		const completed = report.jobs.find((job) => job.state === "completed");
		expect(completed?.runId).toMatch(/^run_/);

		// The automation run's provenance is visible on the snapshot.
		const sessions = await client.listSessions({ botId: defaultBotId() });
		const snapshot = await client.getSession({
			sessionId: sessions.sessions[0].sessionId,
		});
		const automationRun = snapshot.runs.find(
			(run) => run.runId === completed?.runId,
		);
		expect(automationRun?.provenance).toMatchObject({
			mode: "automation",
			scheduleId: schedule.scheduleId,
		});
	});

	it("reports interactive provenance for ordinary client runs", async () => {
		const { server, engine, connect, defaultBotId } = await startServer();
		const client = await connect();
		const accepted = await client.startRun({
			botId: defaultBotId(),
			prompt: "plain interactive run",
		});
		await waitFor(() => engine.handles.length === 1);
		engine.handles[0].settle({ outputText: "done" });
		await waitFor(
			() => server.stores.runs.get(accepted.runId)?.state === "completed",
		);
		const sessions = await client.listSessions();
		const snapshot = await client.getSession({
			sessionId: sessions.sessions[0].sessionId,
		});
		expect(snapshot.runs[0].provenance?.mode).toBe("interactive");
	});
});

describe("approval.resolved broadcast", () => {
	it("first answer wins and every subscriber sees approval.resolved", async () => {
		const { server, engine, connect, defaultBotId } = await startServer();
		const clientA = await connect("approver-a");
		const clientB = await connect("approver-b");
		const seenA = recordEvents(clientA);
		const seenB = recordEvents(clientB);

		const accepted = await clientA.startRun({
			botId: defaultBotId(),
			prompt: "needs approval",
		});
		await waitFor(() => engine.handles.length === 1);
		const invocation = engine.handles[0].invocation;
		await clientA.subscribe({ runId: accepted.runId });
		await clientB.subscribe({ runId: accepted.runId });

		const requestsA: string[] = [];
		const requestsB: string[] = [];
		clientA.onServerRequest((request) => {
			requestsA.push(request.id);
			return { approved: true, reason: "A approves first" };
		});
		clientB.onServerRequest(async (request) => {
			requestsB.push(request.id);
			// B answers late: the broker has already settled on A's answer.
			await new Promise((resolve) => setTimeout(resolve, 50));
			return { approved: false, reason: "B is too late" };
		});

		const answer = (await server.runtime.approvals.request(
			"client.requestToolApproval",
			{
				botId: invocation.botId,
				sessionId: invocation.sessionId,
				runId: invocation.runId,
			},
			{ toolName: "write_file", toolCallId: "call_1" },
		)) as { approved: boolean };
		expect(answer.approved).toBe(true);
		expect(requestsA).toHaveLength(1);
		expect(requestsB).toHaveLength(1);
		expect(server.runtime.approvals.pendingCount).toBe(0);

		// Both clients observe the durable resolution broadcast.
		const resolved = (events: GatewayEvent[]) =>
			events.find((event) => event.event === "approval.resolved");
		await waitFor(() => Boolean(resolved(seenA) && resolved(seenB)));
		expect(resolved(seenA)?.payload?.approved).toBe(true);
		expect(resolved(seenA)?.payload?.requestId).toBe(requestsA[0]);
		expect(resolved(seenB)?.payload?.requestId).toBe(requestsA[0]);

		// B's late answer is dropped without breaking anything.
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(server.runtime.approvals.pendingCount).toBe(0);
		engine.handles[0].settle({});
	});
});
