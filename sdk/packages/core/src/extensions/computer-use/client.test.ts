import {
	type AddressInfo,
	createServer,
	type Server,
	type Socket,
} from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { ComputerUseClient, type ComputerUseClientEvent } from "./client";
import type { ComputerUseResponse } from "./protocol";

/**
 * Minimal fake computer-use backend for tests: a real TCP server that reads
 * newline-delimited JSON requests and replies according to `respond`.
 */
function startFakeBackend(
	respond: (request: Record<string, unknown>) => ComputerUseResponse,
): Promise<{ server: Server; port: number }> {
	return new Promise((resolve) => {
		const server = createServer((socket: Socket) => {
			let buffer = "";
			socket.setEncoding("utf8");
			socket.on("data", (chunk: string) => {
				buffer += chunk;
				let newlineIndex = buffer.indexOf("\n");
				while (newlineIndex >= 0) {
					const line = buffer.slice(0, newlineIndex);
					buffer = buffer.slice(newlineIndex + 1);
					if (line.trim().length > 0) {
						const request = JSON.parse(line) as Record<string, unknown>;
						const response = respond(request);
						socket.write(`${JSON.stringify(response)}\n`);
					}
					newlineIndex = buffer.indexOf("\n");
				}
			});
		});
		server.listen(0, "127.0.0.1", () => {
			const address = server.address() as AddressInfo;
			resolve({ server, port: address.port });
		});
	});
}

describe("ComputerUseClient", () => {
	let server: Server | undefined;

	afterEach(async () => {
		if (!server) {
			return;
		}
		await new Promise<void>((resolve) => server?.close(() => resolve()));
	});

	it("sends a request and resolves with the matching response", async () => {
		const started = await startFakeBackend((request) => ({
			id: request.id as number,
			ok: true,
			text: `handled ${request.action as string}`,
		}));
		server = started.server;

		const client = new ComputerUseClient({ port: started.port });
		const response = await client.send({ action: "screenshot" });

		expect(response.ok).toBe(true);
		expect(response.text).toBe("handled screenshot");
		client.close();
	});

	it("matches responses to requests by id across multiple in-flight calls", async () => {
		const started = await startFakeBackend((request) => ({
			id: request.id as number,
			ok: true,
			text: `id=${request.id}`,
		}));
		server = started.server;

		const client = new ComputerUseClient({ port: started.port });
		const [first, second] = await Promise.all([
			client.send({ action: "cursor_position" }),
			client.send({ action: "screenshot" }),
		]);

		expect(first.text).toBe("id=1");
		expect(second.text).toBe("id=2");
		client.close();
	});

	it("closing during connection rejects the old action but allows a new connection", async () => {
		const seen: string[] = [];
		const started = await startFakeBackend((request) => {
			seen.push(request.action as string);
			return { id: request.id as number, ok: true };
		});
		server = started.server;
		const client = new ComputerUseClient({ port: started.port });
		try {
			const old = client.send({ action: "left_click", coordinate: [1, 2] });
			client.close();
			const next = client.send({ action: "screenshot" });
			await expect(old).rejects.toThrow("client closed");
			await expect(next).resolves.toMatchObject({ ok: true });
			expect(seen).toEqual(["screenshot"]);
			expect(client.isConnected).toBe(true);
		} finally {
			client.close();
		}
	});

	it("does not reconnect when an observer closes the requested action", async () => {
		const seen: string[] = [];
		const started = await startFakeBackend((request) => {
			seen.push(request.action as string);
			return { id: request.id as number, ok: true };
		});
		server = started.server;
		const client = new ComputerUseClient({
			port: started.port,
			observer: (event) => {
				if (event.type === "action_requested") client.close();
			},
		});
		await expect(client.send({ action: "screenshot" })).rejects.toThrow(
			"client closed",
		);
		expect(client.isConnected).toBe(false);
		expect(seen).toEqual([]);
	});

	it("observer mutations cannot change the wire request or caller input", async () => {
		const seen: Record<string, unknown>[] = [];
		const started = await startFakeBackend((request) => {
			seen.push(request);
			return { id: request.id as number, ok: true };
		});
		server = started.server;
		const client = new ComputerUseClient({
			port: started.port,
			observer: (event) => {
				if (event.type !== "action_requested") return;
				event.request.id = 999;
				event.request.action = "screenshot";
				if (event.request.actions?.[0])
					event.request.actions[0].text = "modified";
			},
		});
		const request = {
			action: "run_sequence" as const,
			actions: [{ action: "type" as const, text: "original" }],
		};
		try {
			await expect(client.send(request)).resolves.toMatchObject({ ok: true });
			expect(seen).toEqual([{ ...request, id: 1 }]);
			expect(request.actions[0].text).toBe("original");
		} finally {
			client.close();
		}
	});

	it.each([
		{ display: {} },
		{ display: { widthPx: 0, heightPx: 768 } },
		{ display: { widthPx: -1, heightPx: 768 } },
		{ display: { widthPx: 1024.5, heightPx: 768 } },
		{ image: {} },
		{ text: 1 },
		{ aborted: "true" },
	])("rejects a malformed matching response %j", async (fields) => {
		const started = await startFakeBackend(
			(request) =>
				({
					id: request.id as number,
					ok: true,
					...fields,
				}) as unknown as ComputerUseResponse,
		);
		server = started.server;
		const client = new ComputerUseClient({ port: started.port });
		try {
			await expect(client.send({ action: "screenshot" })).rejects.toThrow(
				"Invalid computer-use backend response",
			);
		} finally {
			client.close();
		}
	});

	it("pairs requested and cancelled events for a pre-aborted action", async () => {
		const events: ComputerUseClientEvent[] = [];
		const client = new ComputerUseClient({
			port: 1,
			observer: (event) => events.push(event),
		});
		const controller = new AbortController();
		controller.abort("cancelled");
		await expect(
			client.send({ action: "screenshot" }, { signal: controller.signal }),
		).rejects.toThrow("cancelled");
		expect(events.map(({ type }) => type)).toEqual([
			"action_requested",
			"action_cancelled",
		]);
		expect(new Set(events.map(({ actionId }) => actionId)).size).toBe(1);
		expect(client.isConnected).toBe(false);
	});

	it("pairs requested and failed events when request serialization fails", async () => {
		const events: ComputerUseClientEvent[] = [];
		const started = await startFakeBackend((request) => ({
			id: request.id as number,
			ok: true,
		}));
		server = started.server;
		const client = new ComputerUseClient({
			port: started.port,
			observer: (event) => events.push(event),
		});
		const payload: Record<string, unknown> = {};
		payload.self = payload;
		try {
			await expect(
				client.send({ action: "publish_event", kind: "test", payload }),
			).rejects.toThrow();
			expect(events.map(({ type }) => type)).toEqual([
				"action_requested",
				"action_failed",
			]);
		} finally {
			client.close();
		}
	});

	it("does not send an action cancelled while connecting", async () => {
		const seen: string[] = [];
		const started = await startFakeBackend((request) => {
			seen.push(request.action as string);
			return { id: request.id as number, ok: true };
		});
		server = started.server;
		const controller = new AbortController();
		const client = new ComputerUseClient({ port: started.port });
		try {
			expect(client.isConnected).toBe(false);
			const pending = client.send(
				{ action: "key", text: "Return" },
				{ signal: controller.signal },
			);
			controller.abort(new Error("cancel during connection"));
			await expect(pending).rejects.toThrow("cancel during connection");
			expect(client.isConnected).toBe(true);
			await client.send({ action: "cursor_position" });
			expect(seen).toEqual(["cursor_position"]);
		} finally {
			client.close();
		}
		expect(client.isConnected).toBe(false);
	});

	it("surfaces backend error responses", async () => {
		const started = await startFakeBackend((request) => ({
			id: request.id as number,
			ok: false,
			error: "backend exploded",
		}));
		server = started.server;

		const client = new ComputerUseClient({ port: started.port });
		const response = await client.send({
			action: "left_click",
			coordinate: [1, 2],
		});

		expect(response.ok).toBe(false);
		expect(response.error).toBe("backend exploded");
		client.close();
	});

	it("getDisplayInfo resolves with the backend-reported dimensions", async () => {
		const started = await startFakeBackend((request) => ({
			id: request.id as number,
			ok: true,
			display: { widthPx: 1920, heightPx: 1080 },
		}));
		server = started.server;

		const client = new ComputerUseClient({ port: started.port });
		const info = await client.getDisplayInfo();

		expect(info).toEqual({ widthPx: 1920, heightPx: 1080 });
		client.close();
	});

	it("getDisplayInfo rejects when the backend omits display info", async () => {
		const started = await startFakeBackend((request) => ({
			id: request.id as number,
			ok: true,
		}));
		server = started.server;

		const client = new ComputerUseClient({ port: started.port });
		await expect(client.getDisplayInfo()).rejects.toThrow();
		client.close();
	});

	it("rejects when connecting to a closed port", async () => {
		const started = await startFakeBackend((request) => ({
			id: request.id as number,
			ok: true,
		}));
		server = started.server;
		const { port } = started;
		const startedServer = started.server;
		await new Promise<void>((resolve) => startedServer.close(() => resolve()));

		const client = new ComputerUseClient({
			port,
			connectTimeoutMs: 500,
		});
		await expect(client.send({ action: "screenshot" })).rejects.toThrow();
	});

	it("notifies the observer with a matched requested/completed pair", async () => {
		const started = await startFakeBackend((request) => ({
			id: request.id as number,
			ok: true,
			text: "done",
		}));
		server = started.server;

		const events: ComputerUseClientEvent[] = [];
		const client = new ComputerUseClient({
			port: started.port,
			observer: (event) => events.push(event),
		});
		await client.send({ action: "screenshot" }, { actionId: "act_test" });

		expect(events.map((event) => event.type)).toEqual([
			"action_requested",
			"action_completed",
		]);
		expect(events.every((event) => event.actionId === "act_test")).toBe(true);
		client.close();
	});

	it("cancels a pending request via AbortSignal with one terminal event", async () => {
		const started = await startFakeBackend(() => {
			throw new Error("never called: server intentionally does not respond");
		});
		server = started.server;
		server.removeAllListeners("connection");
		server.on("connection", (socket) => {
			socket.on("data", () => {
				/* intentionally never respond */
			});
		});

		const events: ComputerUseClientEvent[] = [];
		const client = new ComputerUseClient({
			port: started.port,
			// Longer than the test's abort so the timeout must NOT also fire.
			requestTimeoutMs: 5_000,
			observer: (event) => events.push(event),
		});
		const controller = new AbortController();
		const sendPromise = client.send(
			{ action: "left_click", coordinate: [1, 2] },
			{ signal: controller.signal },
		);
		controller.abort(new Error("driver interrupted"));

		await expect(sendPromise).rejects.toThrow("driver interrupted");
		expect(events.map((event) => event.type)).toEqual([
			"action_requested",
			"action_cancelled",
		]);
		client.close();
	});

	it("rejects immediately when the signal is already aborted", async () => {
		const started = await startFakeBackend((request) => ({
			id: request.id as number,
			ok: true,
		}));
		server = started.server;

		const client = new ComputerUseClient({ port: started.port });
		const controller = new AbortController();
		controller.abort("stale run");
		await expect(
			client.send({ action: "screenshot" }, { signal: controller.signal }),
		).rejects.toThrow("stale run");
		client.close();
	});

	it("swallows observer errors without breaking the action path", async () => {
		const started = await startFakeBackend((request) => ({
			id: request.id as number,
			ok: true,
			text: "ok",
		}));
		server = started.server;

		const client = new ComputerUseClient({
			port: started.port,
			observer: () => {
				throw new Error("observer boom");
			},
		});
		const response = await client.send({ action: "screenshot" });
		expect(response.ok).toBe(true);
		client.close();
	});

	it("emits exactly one terminal event when a timeout races the response", async () => {
		let respondLate: (() => void) | undefined;
		const started = await startFakeBackend(() => {
			throw new Error("never called: connection handler replaced below");
		});
		server = started.server;
		server.removeAllListeners("connection");
		server.on("connection", (socket) => {
			socket.setEncoding("utf8");
			socket.on("data", (chunk: string) => {
				const request = JSON.parse(chunk.trim()) as { id: number };
				respondLate = () => {
					socket.write(`${JSON.stringify({ id: request.id, ok: true })}\n`);
				};
			});
		});

		const events: ComputerUseClientEvent[] = [];
		const client = new ComputerUseClient({
			port: started.port,
			requestTimeoutMs: 100,
			observer: (event) => events.push(event),
		});
		await expect(client.send({ action: "screenshot" })).rejects.toThrow(
			/timed out/,
		);
		// Deliver the response after the timeout already settled the request.
		respondLate?.();
		await new Promise((resolve) => setTimeout(resolve, 50));

		const terminal = events.filter(
			(event) => event.type !== "action_requested",
		);
		expect(terminal).toHaveLength(1);
		expect(terminal[0]?.type).toBe("action_failed");
		client.close();
	});

	it("times out a request the backend never answers", async () => {
		const started = await startFakeBackend(() => {
			throw new Error("never called: server intentionally does not respond");
		});
		server = started.server;
		// Override respond to swallow requests without answering.
		server.removeAllListeners("connection");
		server.on("connection", (socket) => {
			socket.on("data", () => {
				/* intentionally never respond */
			});
		});

		const client = new ComputerUseClient({
			port: started.port,
			requestTimeoutMs: 200,
		});
		await expect(
			client.send({ action: "wait", durationSeconds: 1 }),
		).rejects.toThrow(/timed out/);
		client.close();
	});
});
