/**
 * Wire-level proof of the durable-event upgrade: a client that was never
 * connected while a run streamed can subscribe later with a cursor and
 * receive the whole history over a real WebSocket — the Hub no longer
 * requires a witness for events to survive.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HubEventEnvelope, HubTransportFrame } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

vi.mock("@ai-sdk/provider-utils", () => ({
	createProviderDefinedToolFactory: vi.fn(() => vi.fn()),
}));

import { createLocalHubScheduleRuntimeHandlers } from "./../daemon/runtime-handlers";
import { createInMemoryHubOwnerContext } from "../discovery";
import type { HubWebSocketServer } from "./hub-server-options";
import { startHubWebSocketServer } from "./hub-websocket-server";

const servers = new Set<HubWebSocketServer>();
const sockets = new Set<WebSocket>();

afterEach(async () => {
	for (const socket of sockets) {
		try {
			socket.close();
		} catch {
			// already closed
		}
	}
	sockets.clear();
	for (const server of servers) {
		await server.close().catch(() => undefined);
	}
	servers.clear();
});

function stubSessionHost() {
	const root = mkdtempSync(join(tmpdir(), "cline-hub-replay-wire-"));
	const sessions = new Map<string, Record<string, unknown>>();
	return {
		root,
		host: {
			subscribe: vi.fn(() => () => {}),
			startSession: vi.fn(async (input: { config: { sessionId?: string } }) => {
				const sessionId = input.config.sessionId ?? "wire-session";
				sessions.set(sessionId, {
					sessionId,
					source: "core",
					status: "running",
					startedAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
					interactive: true,
					cwd: root,
					workspaceRoot: root,
				});
				return {
					sessionId,
					manifest: {
						version: 1,
						session_id: sessionId,
						source: "core",
						pid: 1,
						started_at: new Date().toISOString(),
						status: "running",
						interactive: true,
						cwd: root,
						workspace_root: root,
						enable_tools: true,
						enable_spawn: true,
						enable_teams: true,
					},
					manifestPath: "",
					messagesPath: "",
				};
			}),
			runTurn: vi.fn(async () => ({
				text: "done",
				finishReason: "completed" as const,
				toolCalls: [],
			})),
			stopSession: vi.fn(async () => {}),
			abort: vi.fn(async () => {}),
			dispose: vi.fn(async () => {}),
			getSession: vi.fn(async (sessionId: string) => sessions.get(sessionId)),
			getAccumulatedUsage: vi.fn(async () => undefined),
			listSessions: vi.fn(async () => [...sessions.values()]),
			deleteSession: vi.fn(async () => false),
			updateSession: vi.fn(async () => ({ updated: false })),
			updateSessionCompactionState: vi.fn(async () => ({ updated: false })),
			readSessionCompactionState: vi.fn(async () => undefined),
			readSessionMessages: vi.fn(async () => []),
			dispatchHookEvent: vi.fn(async () => {}),
			restoreSession: vi.fn(),
		} as never,
	};
}

async function openSocket(url: string, authToken: string): Promise<WebSocket> {
	const socket = new WebSocket(url, `cline-hub-auth.${authToken}`);
	sockets.add(socket);
	await new Promise<void>((resolve, reject) => {
		socket.once("open", () => resolve());
		socket.once("error", reject);
	});
	return socket;
}

function sendFrame(socket: WebSocket, frame: HubTransportFrame): void {
	socket.send(JSON.stringify(frame));
}

async function commandOverSocket(
	socket: WebSocket,
	events: HubEventEnvelope[],
	envelope: {
		command: string;
		requestId: string;
		clientId?: string;
		sessionId?: string;
		payload?: Record<string, unknown>;
	},
): Promise<Record<string, unknown> | undefined> {
	return await new Promise((resolve, reject) => {
		const onMessage = (raw: Buffer | string) => {
			const frame = JSON.parse(String(raw)) as HubTransportFrame;
			if (frame.kind === "event") {
				events.push(frame.envelope);
				return;
			}
			if (
				frame.kind === "reply" &&
				frame.envelope.requestId === envelope.requestId
			) {
				socket.off("message", onMessage);
				if (frame.envelope.ok) {
					resolve(frame.envelope.payload);
				} else {
					reject(new Error(frame.envelope.error?.message ?? "command failed"));
				}
			}
		};
		socket.on("message", onMessage);
		sendFrame(socket, {
			kind: "command",
			envelope: { version: "v1", ...envelope },
		} as HubTransportFrame);
	});
}

describe("hub event replay over the wire", () => {
	it("replays a full run to a client that connected after the fact", async () => {
		const { root, host } = stubSessionHost();
		const server = await startHubWebSocketServer({
			owner: createInMemoryHubOwnerContext("hub-replay-wire"),
			host: "127.0.0.1",
			port: 0,
			pathname: "/hub",
			workspaceRoot: root,
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			scheduleOptions: { dbPath: ":memory:" },
			taskOptions: {
				dbPath: join(root, "tasks.db"),
				globalSpecsDir: join(root, "specs"),
				watchFiles: false,
			},
			eventLog: { dbPath: ":memory:" },
			runQueue: { dbPath: ":memory:" },
			sessionHost: host,
		});
		servers.add(server);

		// Writer connection: create a session and run a turn with NO event
		// subscription anywhere — the pre-upgrade Hub dropped these events.
		const writer = await openSocket(server.url, server.authToken);
		const writerEvents: HubEventEnvelope[] = [];
		await commandOverSocket(writer, writerEvents, {
			command: "session.create",
			requestId: "req-create",
			clientId: "writer",
			payload: { sessionConfig: { sessionId: "wire-session" } },
		});
		await commandOverSocket(writer, writerEvents, {
			command: "run.start",
			requestId: "req-run",
			clientId: "writer",
			sessionId: "wire-session",
			payload: { prompt: "do the thing" },
		});
		writer.close();

		// Late reader: was never connected during the run; a cursor subscribe
		// replays the entire durable history in order.
		const reader = await openSocket(server.url, server.authToken);
		const replayed: HubEventEnvelope[] = [];
		reader.on("message", (raw) => {
			const frame = JSON.parse(String(raw)) as HubTransportFrame;
			if (frame.kind === "event") {
				replayed.push(frame.envelope);
			}
		});
		sendFrame(reader, {
			kind: "stream.subscribe",
			clientId: "late-reader",
			sessionId: "wire-session",
			sinceSequence: 0,
		} as HubTransportFrame);

		const deadline = Date.now() + 5_000;
		while (
			!replayed.some((event) => event.event === "run.completed") &&
			Date.now() < deadline
		) {
			await new Promise((resolve) => setTimeout(resolve, 25));
		}

		const names = replayed.map((event) => event.event);
		expect(names).toContain("session.created");
		expect(names).toContain("run.started");
		expect(names).toContain("run.completed");
		const sequences = replayed.map((event) => event.sequence ?? 0);
		expect([...sequences].sort((a, b) => a - b)).toEqual(sequences);
		expect(new Set(sequences).size).toBe(sequences.length);

		// A live-only subscriber (legacy frame, no cursor) gets nothing from
		// history — the legacy contract is untouched.
		const legacy = await openSocket(server.url, server.authToken);
		const legacyEvents: HubEventEnvelope[] = [];
		legacy.on("message", (raw) => {
			const frame = JSON.parse(String(raw)) as HubTransportFrame;
			if (frame.kind === "event") {
				legacyEvents.push(frame.envelope);
			}
		});
		sendFrame(legacy, {
			kind: "stream.subscribe",
			clientId: "legacy-reader",
			sessionId: "wire-session",
		} as HubTransportFrame);
		await new Promise((resolve) => setTimeout(resolve, 250));
		expect(legacyEvents).toEqual([]);
	}, 15_000);
});
