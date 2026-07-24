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
