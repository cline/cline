import { type AddressInfo, createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { ComputerUseClient } from "./client";
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
		const response = await client.send({ action: "left_click", coordinate: [1, 2] });

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
		await expect(client.send({ action: "wait", durationSeconds: 1 })).rejects.toThrow(
			/timed out/,
		);
		client.close();
	});
});
