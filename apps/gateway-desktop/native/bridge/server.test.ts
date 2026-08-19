/**
 * Bridge server tests over a real loopback WebSocket: secret-first
 * authentication, projection replace/patch delivery, command routing,
 * frame limits, and rejection of unknown or malformed frames.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
	BRIDGE_PROTOCOL_VERSION,
	MAX_BRIDGE_FRAME_BYTES,
} from "../../shared/bridge";
import { DesktopBroker } from "../gateway/broker";
import type { GatewayPort } from "../gateway/port";
import { DesktopStateStore } from "../gateway/state-store";
import { createNullLogger } from "../logging";
import {
	FakeGatewayAuthority,
	FakeGatewayPort,
} from "../testing/fake-gateway-port";
import { type BridgeServer, startBridgeServer } from "./server";

const SECRET = "test-bridge-secret-000001";

interface Harness {
	authority: FakeGatewayAuthority;
	broker: DesktopBroker;
	server: BridgeServer;
}

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

async function startHarness(): Promise<Harness> {
	const authority = new FakeGatewayAuthority();
	const broker = new DesktopBroker({
		connectPort: async ({ clientId }) =>
			new FakeGatewayPort(authority, clientId) as GatewayPort,
		stateStore: new DesktopStateStore(
			join(mkdtempSync(join(tmpdir(), "gwd-bridge-")), "state.json"),
		),
		logger: createNullLogger(),
		jitterRatio: 0,
	});
	await broker.start();
	const server = await startBridgeServer({
		broker,
		logger: createNullLogger(),
		secrets: [SECRET],
	});
	cleanups.push(async () => {
		await server.close();
		broker.stop();
	});
	return { authority, broker, server };
}

interface TestClient {
	socket: WebSocket;
	frames: Record<string, unknown>[];
	send(frame: unknown): void;
	waitFor<T>(predicate: (frame: Record<string, unknown>) => T | undefined): Promise<T>;
	closed: Promise<{ code: number }>;
}

function connectClient(port: number): Promise<TestClient> {
	const socket = new WebSocket(`ws://127.0.0.1:${port}/`);
	const frames: Record<string, unknown>[] = [];
	const waiters: {
		predicate: (frame: Record<string, unknown>) => unknown;
		resolve: (value: unknown) => void;
	}[] = [];
	let closeResolve!: (value: { code: number }) => void;
	const closed = new Promise<{ code: number }>((resolve) => {
		closeResolve = resolve;
	});
	socket.on("message", (raw) => {
		const frame = JSON.parse(String(raw)) as Record<string, unknown>;
		frames.push(frame);
		for (const waiter of [...waiters]) {
			const result = waiter.predicate(frame);
			if (result !== undefined) {
				waiters.splice(waiters.indexOf(waiter), 1);
				waiter.resolve(result);
			}
		}
	});
	socket.on("close", (code) => closeResolve({ code }));
	const client: TestClient = {
		socket,
		frames,
		send: (frame) => socket.send(JSON.stringify(frame)),
		waitFor: <T>(
			predicate: (frame: Record<string, unknown>) => T | undefined,
		): Promise<T> => {
			for (const frame of frames) {
				const result = predicate(frame);
				if (result !== undefined) {
					return Promise.resolve(result);
				}
			}
			return new Promise((resolve) => {
				waiters.push({
					predicate,
					resolve: resolve as (value: unknown) => void,
				});
				setTimeout(() => resolve(undefined as never), 5_000);
			});
		},
		closed,
	};
	return new Promise((resolve, reject) => {
		socket.once("open", () => resolve(client));
		socket.once("error", reject);
	});
}

function authFrame(secret = SECRET) {
	return { v: BRIDGE_PROTOCOL_VERSION, type: "authenticate", secret };
}

describe("bridge authentication", () => {
	it("closes the connection on a wrong secret", async () => {
		const { server } = await startHarness();
		const client = await connectClient(server.port());
		client.send(authFrame("wrong-secret-000000"));
		const { code } = await client.closed;
		expect(code).toBe(4401);
	});

	it("closes when a command arrives before authentication", async () => {
		const { server } = await startHarness();
		const client = await connectClient(server.port());
		client.send({
			v: BRIDGE_PROTOCOL_VERSION,
			type: "command",
			id: "1",
			payload: { command: "app.initialize" },
		});
		const { code } = await client.closed;
		expect(code).toBe(4401);
	});

	it("authenticates and immediately receives a full projection replace", async () => {
		const { server } = await startHarness();
		const client = await connectClient(server.port());
		client.send(authFrame());
		const projection = await client.waitFor((frame) =>
			frame.type === "projection.replace"
				? (frame.projection as Record<string, unknown>)
				: undefined,
		);
		expect(
			(projection.connection as Record<string, unknown>).state,
		).toBe("connected");
	});
});

describe("bridge commands", () => {
	it("routes commands and correlates results by frame id", async () => {
		const { server, authority } = await startHarness();
		const client = await connectClient(server.port());
		client.send(authFrame());
		await client.waitFor((frame) =>
			frame.type === "authenticated" ? true : undefined,
		);
		client.send({
			v: BRIDGE_PROTOCOL_VERSION,
			type: "command",
			id: "cmd-42",
			payload: {
				command: "run.start",
				clientRequestId: "req_bridge_0001",
				botId: authority.defaultBotId,
				prompt: "over the bridge",
			},
		});
		const result = await client.waitFor((frame) =>
			frame.type === "command.result" && frame.id === "cmd-42"
				? frame
				: undefined,
		);
		expect(result.ok).toBe(true);
		expect((result.result as { runId: string }).runId).toMatch(/^run_/);
	});

	it("streams projection patches when the gateway emits events", async () => {
		const { server, authority } = await startHarness();
		const client = await connectClient(server.port());
		client.send(authFrame());
		await client.waitFor((frame) =>
			frame.type === "projection.replace" ? true : undefined,
		);
		authority.startRun({
			botId: authority.defaultBotId,
			prompt: "emit events",
		});
		const patch = await client.waitFor((frame) =>
			frame.type === "projection.patch" ? frame : undefined,
		);
		expect(typeof patch.revision).toBe("number");
		expect(typeof patch.baseRevision).toBe("number");
	});

	it("rejects unknown commands with a typed error", async () => {
		const { server } = await startHarness();
		const client = await connectClient(server.port());
		client.send(authFrame());
		await client.waitFor((frame) =>
			frame.type === "authenticated" ? true : undefined,
		);
		client.send({
			v: BRIDGE_PROTOCOL_VERSION,
			type: "command",
			id: "bad-1",
			payload: { command: "shell.exec", argv: ["rm", "-rf"] },
		});
		const result = await client.waitFor((frame) =>
			frame.type === "command.result" && frame.ok === false
				? frame
				: undefined,
		);
		expect(
			(result.error as { code: string }).code,
		).toBe("invalid_command");
	});

	it("returns command errors as PublicDesktopError", async () => {
		const { server } = await startHarness();
		const client = await connectClient(server.port());
		client.send(authFrame());
		await client.waitFor((frame) =>
			frame.type === "authenticated" ? true : undefined,
		);
		client.send({
			v: BRIDGE_PROTOCOL_VERSION,
			type: "command",
			id: "err-1",
			payload: { command: "bot.select", botId: "bot_does_not_exist" },
		});
		const result = await client.waitFor((frame) =>
			frame.type === "command.result" && frame.id === "err-1"
				? frame
				: undefined,
		);
		expect(result.ok).toBe(false);
		const error = result.error as Record<string, unknown>;
		expect(error.code).toBe("not_found");
		expect(typeof error.message).toBe("string");
		expect(typeof error.retryable).toBe("boolean");
	});

	it("drops connections that send oversized frames", async () => {
		const { server } = await startHarness();
		const client = await connectClient(server.port());
		client.send(authFrame());
		await client.waitFor((frame) =>
			frame.type === "authenticated" ? true : undefined,
		);
		client.socket.send(
			JSON.stringify({
				v: BRIDGE_PROTOCOL_VERSION,
				type: "command",
				id: "big",
				payload: {
					command: "run.start",
					clientRequestId: "req_bridge_0002",
					botId: "bot_x",
					prompt: "y".repeat(MAX_BRIDGE_FRAME_BYTES + 64),
				},
			}),
		);
		const { code } = await client.closed;
		// ws enforces maxPayload with 1009 (message too big).
		expect(code).toBe(1009);
	});
});
