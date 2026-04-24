import { createServer as createHttpServer } from "node:http";
import { createConnection, createServer as createNetServer } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import {
	clearHubDiscovery,
	createInMemoryHubOwnerContext,
	readHubDiscovery,
	toHubHealthUrl,
	writeHubDiscovery,
} from "./discovery";
import { createLocalHubScheduleRuntimeHandlers } from "./runtime-handlers";
import {
	ensureHubWebSocketServer,
	type HubWebSocketServer,
	startHubWebSocketServer,
} from "./server";

async function reservePort(): Promise<number> {
	return await new Promise((resolve, reject) => {
		const server = createNetServer();
		server.once("error", reject);
		server.listen({ host: "127.0.0.1", port: 0 }, () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				server.close(() => reject(new Error("Failed to reserve test port")));
				return;
			}
			const { port } = address;
			server.close((error) => {
				if (error) {
					reject(error);
					return;
				}
				resolve(port);
			});
		});
	});
}

async function sendRawHttpRequest(
	port: number,
	request: string,
): Promise<string> {
	return await new Promise((resolve, reject) => {
		let response = "";
		const socket = createConnection({ host: "127.0.0.1", port }, () => {
			socket.write(request);
		});
		socket.setEncoding("utf8");
		socket.on("data", (chunk) => {
			response += chunk;
		});
		socket.on("end", () => {
			resolve(response);
		});
		socket.on("error", (error) => {
			reject(error);
		});
	});
}

describe("hub server startup", () => {
	const servers = new Set<HubWebSocketServer>();

	afterEach(async () => {
		for (const server of servers) {
			await server.close();
		}
		servers.clear();
	});

	it("starts on the requested port instead of drifting to a random port", async () => {
		const owner = createInMemoryHubOwnerContext("hub-server-test-fixed-port");
		const port = await reservePort();
		await writeHubDiscovery(owner.discoveryPath, {
			hubId: "stale-hub",
			protocolVersion: "v1",
			host: "127.0.0.1",
			port: port + 1,
			url: `ws://127.0.0.1:${port + 1}/hub`,
			startedAt: new Date(0).toISOString(),
			updatedAt: new Date(0).toISOString(),
		});

		const result = await ensureHubWebSocketServer({
			owner,
			host: "127.0.0.1",
			port,
			pathname: "/hub",
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
		});
		expect(result.url).toBe(`ws://127.0.0.1:${port}/hub`);
		expect(result.action).toBe("started");
		expect(result.server).toBeDefined();
		servers.add(result.server!);

		await expect(readHubDiscovery(owner.discoveryPath)).resolves.toMatchObject({
			port,
			url: `ws://127.0.0.1:${port}/hub`,
		});
	});

	it("fails when the requested port is already occupied", async () => {
		const owner = createInMemoryHubOwnerContext("hub-server-test-port-busy");
		const port = await reservePort();
		const blocker = createNetServer();
		await new Promise<void>((resolve, reject) => {
			blocker.once("error", reject);
			blocker.listen({ host: "127.0.0.1", port }, () => resolve());
		});

		try {
			await expect(
				startHubWebSocketServer({
					owner,
					host: "127.0.0.1",
					port,
					pathname: "/hub",
					runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
				}),
			).rejects.toMatchObject({ code: "EADDRINUSE" });
			await expect(
				readHubDiscovery(owner.discoveryPath),
			).resolves.toBeUndefined();
		} finally {
			await new Promise<void>((resolve, reject) => {
				blocker.close((error) => {
					if (error) {
						reject(error);
						return;
					}
					resolve();
				});
			});
			await clearHubDiscovery(owner.discoveryPath);
		}
	});

	it("falls back to an ephemeral port when fallback is allowed", async () => {
		const owner = createInMemoryHubOwnerContext(
			"hub-server-test-port-fallback",
		);
		const port = await reservePort();
		const blocker = createHttpServer((_req, res) => {
			res.statusCode = 404;
			res.end("not a hub");
		});
		await new Promise<void>((resolve, reject) => {
			blocker.once("error", reject);
			blocker.listen({ host: "127.0.0.1", port }, () => resolve());
		});

		try {
			const result = await ensureHubWebSocketServer({
				owner,
				host: "127.0.0.1",
				port,
				pathname: "/hub",
				allowPortFallback: true,
				runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			});

			expect(result.action).toBe("started");
			expect(result.server).toBeDefined();
			expect(result.server?.port).not.toBe(port);
			servers.add(result.server!);
		} finally {
			await new Promise<void>((resolve, reject) => {
				blocker.close((error) => {
					if (error) {
						reject(error);
						return;
					}
					resolve();
				});
			});
			await clearHubDiscovery(owner.discoveryPath);
		}
	});

	it("shuts down active server through the shutdown endpoint", async () => {
		const owner = createInMemoryHubOwnerContext("hub-server-test-shutdown");
		const result = await ensureHubWebSocketServer({
			owner,
			host: "127.0.0.1",
			port: 0,
			pathname: "/hub",
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
		});
		expect(result.server).toBeDefined();
		servers.add(result.server!);

		const shutdownUrl = new URL(toHubHealthUrl(result.url));
		shutdownUrl.pathname = "/shutdown";
		const response = await fetch(shutdownUrl, { method: "POST" });
		expect(response.status).toBe(202);

		for (let index = 0; index < 50; index += 1) {
			if ((await readHubDiscovery(owner.discoveryPath)) === undefined) {
				servers.delete(result.server!);
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, 20));
		}

		throw new Error("Timed out waiting for hub shutdown");
	});

	it("survives websocket upgrade handler failures", async () => {
		const owner = createInMemoryHubOwnerContext(
			"hub-server-test-upgrade-guard",
		);
		const handleUpgrade = vi
			.spyOn(WebSocketServer.prototype, "handleUpgrade")
			.mockImplementation(() => {
				throw new Error("boom");
			});
		try {
			const result = await ensureHubWebSocketServer({
				owner,
				host: "127.0.0.1",
				port: 0,
				pathname: "/hub",
				runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			});
			expect(result.server).toBeDefined();
			servers.add(result.server!);

			const hubUrl = new URL(result.url);
			const response = await sendRawHttpRequest(
				Number(hubUrl.port),
				[
					"GET /hub HTTP/1.1",
					"Host: 127.0.0.1",
					"Connection: Upgrade",
					"Upgrade: websocket",
					"Sec-WebSocket-Version: 13",
					"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
					"",
					"",
				].join("\r\n"),
			);

			expect(response).toContain("400 Bad Request");

			const health = await fetch(
				new URL("/health", `http://127.0.0.1:${hubUrl.port}`),
			);
			expect(health.status).toBe(200);
		} finally {
			handleUpgrade.mockRestore();
		}
	});
});
