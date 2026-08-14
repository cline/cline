import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import {
	createConnection,
	createServer as createNetServer,
	type Socket,
} from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import { createLocalHubScheduleRuntimeHandlers } from "../daemon/runtime-handlers";
import {
	clearHubDiscovery,
	createInMemoryHubOwnerContext,
	readHubDiscovery,
	resolveHubBuildId,
	toHubHealthUrl,
	writeHubDiscovery,
} from "../discovery";
import {
	ensureHubWebSocketServer,
	type HubWebSocketServer,
	startHubWebSocketServer,
} from "../server";

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

function requireServer(
	server: HubWebSocketServer | undefined,
): HubWebSocketServer {
	expect(server).toBeDefined();
	if (!server) {
		throw new Error("Expected hub server to be defined");
	}
	return server;
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
			authToken: "stale-token",
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
		const server = requireServer(result.server);
		servers.add(server);

		await expect(readHubDiscovery(owner.discoveryPath)).resolves.toMatchObject({
			port,
			url: `ws://127.0.0.1:${port}/hub`,
		});
	});

	it("reuses the same owner when port zero selected the bound port", async () => {
		const owner = createInMemoryHubOwnerContext("hub-server-test-port-zero");
		const runtimeHandlers = createLocalHubScheduleRuntimeHandlers();
		const first = await ensureHubWebSocketServer({
			owner,
			host: "127.0.0.1",
			port: 0,
			pathname: "/hub",
			runtimeHandlers,
		});
		const firstServer = requireServer(first.server);
		servers.add(firstServer);

		const second = await ensureHubWebSocketServer({
			owner,
			host: "127.0.0.1",
			port: 0,
			pathname: "/hub",
			runtimeHandlers,
		});

		expect(second.action).toBe("reuse");
		expect(second.server).toBe(firstServer);
		expect(second.url).toBe(firstServer.url);
	});

	it("rejects a second live endpoint for the same owner", async () => {
		const owner = createInMemoryHubOwnerContext(
			"hub-server-test-endpoint-conflict",
		);
		const firstPort = await reservePort();
		const runtimeHandlers = createLocalHubScheduleRuntimeHandlers();
		const first = await ensureHubWebSocketServer({
			owner,
			host: "127.0.0.1",
			port: firstPort,
			pathname: "/hub",
			runtimeHandlers,
		});
		const firstServer = requireServer(first.server);
		servers.add(firstServer);
		const secondPort = await reservePort();

		await expect(
			ensureHubWebSocketServer({
				owner,
				host: "127.0.0.1",
				port: secondPort,
				pathname: "/hub",
				runtimeHandlers,
			}),
		).rejects.toThrow("refusing a second endpoint");
		const health = await fetch(toHubHealthUrl(first.url));
		expect(health.status).toBe(200);
		expect((await readHubDiscovery(owner.discoveryPath))?.url).toBe(first.url);
	});

	it("does not reuse a closed shared server", async () => {
		const owner = createInMemoryHubOwnerContext("hub-server-test-closed-cache");
		const port = await reservePort();
		const first = await ensureHubWebSocketServer({
			owner,
			host: "127.0.0.1",
			port,
			pathname: "/hub",
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
		});
		const firstServer = requireServer(first.server);
		await firstServer.close();

		const second = await ensureHubWebSocketServer({
			owner,
			host: "127.0.0.1",
			port,
			pathname: "/hub",
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
		});
		const secondServer = requireServer(second.server);
		servers.add(secondServer);

		expect(second.action).toBe("started");
		expect(secondServer).not.toBe(firstServer);
	});

	it("waits for complete close but tolerates cleanup errors during replacement", async () => {
		const owner = createInMemoryHubOwnerContext(
			"hub-server-test-closing-cache",
		);
		const port = await reservePort();
		let releaseDispose!: () => void;
		const dispose = vi.fn(
			async () =>
				await new Promise<void>((resolve) => {
					releaseDispose = resolve;
				}),
		);
		const first = await ensureHubWebSocketServer({
			owner,
			host: "127.0.0.1",
			port,
			pathname: "/hub",
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			sessionHost: {
				subscribe: () => () => undefined,
				dispose,
			} as never,
		});
		const firstServer = requireServer(first.server);
		const closing = firstServer.beginClose();
		let releaseCompleteClose!: () => void;
		const completeCloseGate = new Promise<void>((resolve) => {
			releaseCompleteClose = resolve;
		});
		const completeClose = Promise.all([closing.closed, completeCloseGate]).then(
			() => {
				throw new Error("cleanup failed after endpoint release");
			},
		);
		vi.spyOn(firstServer, "beginClose").mockReturnValue({
			transportStopped: closing.transportStopped,
			closed: completeClose,
		});
		await vi.waitFor(() => {
			expect(dispose).toHaveBeenCalledOnce();
		});

		const secondSubscribe = vi.fn(() => () => undefined);
		const secondPromise = ensureHubWebSocketServer({
			owner,
			host: "127.0.0.1",
			port,
			pathname: "/hub",
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			sessionHost: {
				subscribe: secondSubscribe,
				dispose: async () => undefined,
			} as never,
		});
		await Promise.resolve();
		expect(secondSubscribe).not.toHaveBeenCalled();

		releaseDispose();
		await closing.closed;
		await Promise.resolve();
		expect(secondSubscribe).not.toHaveBeenCalled();

		releaseCompleteClose();
		const second = await secondPromise;
		const secondServer = requireServer(second.server);
		servers.add(secondServer);

		expect(second.action).toBe("started");
		expect(secondServer).not.toBe(firstServer);
		expect(secondSubscribe).toHaveBeenCalledOnce();
	});

	it("does not clear a replacement generation's discovery record", async () => {
		const owner = createInMemoryHubOwnerContext(
			"hub-server-test-generation-cleanup",
		);
		const result = await ensureHubWebSocketServer({
			owner,
			host: "127.0.0.1",
			port: 0,
			pathname: "/hub",
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
		});
		const server = requireServer(result.server);
		const firstGeneration = await readHubDiscovery(owner.discoveryPath);
		if (!firstGeneration) {
			throw new Error("Expected first-generation discovery");
		}
		await writeHubDiscovery(owner.discoveryPath, {
			...firstGeneration,
			hubId: "replacement-generation",
			authToken: "replacement-token",
			updatedAt: new Date().toISOString(),
		});

		await server.close();

		const replacement = await readHubDiscovery(owner.discoveryPath);
		expect(replacement?.hubId).toBe("replacement-generation");
		expect(replacement?.authToken).toBe("replacement-token");
		await clearHubDiscovery(owner.discoveryPath);
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

	it("releases the listener when discovery publication fails", async () => {
		const root = await mkdtemp(join(tmpdir(), "cline-hub-publish-test-"));
		const discoveryPath = join(root, "discovery.json");
		// A directory at the destination makes atomic file replacement fail.
		await mkdir(discoveryPath);
		const port = await reservePort();
		try {
			await expect(
				startHubWebSocketServer({
					owner: { ownerId: "publish-failure", discoveryPath },
					host: "127.0.0.1",
					port,
					pathname: "/hub",
					runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
				}),
			).rejects.toBeDefined();

			const replacement = createNetServer();
			await new Promise<void>((resolve, reject) => {
				replacement.once("error", reject);
				replacement.listen({ host: "127.0.0.1", port }, () => resolve());
			});
			await new Promise<void>((resolve, reject) => {
				replacement.close((error) => {
					if (error) {
						reject(error);
						return;
					}
					resolve();
				});
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("falls back to an ephemeral port when fallback is allowed", async () => {
		const owner = createInMemoryHubOwnerContext(
			"hub-server-test-port-fallback",
		);
		const port = await reservePort();
		const blockerSockets = new Set<Socket>();
		const blocker = createHttpServer((_req, res) => {
			res.statusCode = 404;
			res.setHeader("connection", "close");
			res.end("not a hub");
		});
		blocker.on("connection", (socket) => {
			blockerSockets.add(socket);
			socket.once("close", () => {
				blockerSockets.delete(socket);
			});
		});
		await new Promise<void>((resolve, reject) => {
			blocker.once("error", reject);
			blocker.listen({ host: "127.0.0.1", port }, () => resolve());
		});

		try {
			const ensureOptions = {
				owner,
				host: "127.0.0.1",
				port,
				pathname: "/hub",
				allowPortFallback: true,
				runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			};
			const result = await ensureHubWebSocketServer(ensureOptions);

			expect(result.action).toBe("started");
			const server = requireServer(result.server);
			expect(server.port).not.toBe(port);
			servers.add(server);

			const reused = await ensureHubWebSocketServer(ensureOptions);
			expect(reused.action).toBe("reuse");
			expect(reused.server).toBe(server);
			expect(reused.url).toBe(result.url);
		} finally {
			for (const socket of blockerSockets) {
				socket.destroy();
			}
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

	it("reports its build identity on the unauthenticated health endpoint", async () => {
		const owner = createInMemoryHubOwnerContext("hub-server-test-health-build");
		const result = await ensureHubWebSocketServer({
			owner,
			host: "127.0.0.1",
			port: 0,
			pathname: "/hub",
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
		});
		servers.add(requireServer(result.server));

		const health = await fetch(new URL("/health", toHubHealthUrl(result.url)));
		expect(health.status).toBe(200);
		const payload = (await health.json()) as { buildId?: string };
		expect(payload.buildId).toBe(resolveHubBuildId());
	});

	it("does not reuse managed discovery from an older build", async () => {
		const owner = createInMemoryHubOwnerContext("hub-server-test-stale-build");
		vi.stubEnv("CLINE_HUB_BUILD_ID", "old-build");
		vi.stubEnv("CLINE_HUB_BUILD_EPOCH_MS", "1000");
		try {
			const stale = await startHubWebSocketServer({
				owner,
				host: "127.0.0.1",
				port: 0,
				pathname: "/hub",
				runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			});
			servers.add(stale);

			vi.stubEnv("CLINE_HUB_BUILD_ID", "new-build");
			vi.stubEnv("CLINE_HUB_BUILD_EPOCH_MS", "2000");
			const result = await ensureHubWebSocketServer({
				owner,
				host: "127.0.0.1",
				port: 0,
				pathname: "/hub",
				allowPortFallback: true,
				runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			});

			expect(result.action).toBe("started");
			expect(result.url).not.toBe(stale.url);
			servers.add(requireServer(result.server));
		} finally {
			vi.unstubAllEnvs();
			await clearHubDiscovery(owner.discoveryPath);
		}
	});

	/**
	 * Two builds that differ only by an opaque id carry nothing that says which
	 * came first. Retiring on that basis is what let two installations shut each
	 * other's Hub down in a loop, so an unorderable peer is attached to and the
	 * build-mismatch watcher raises it with the user instead.
	 */
	it("reuses managed discovery from a build it cannot order itself against", async () => {
		const owner = createInMemoryHubOwnerContext("hub-server-test-unordered");
		vi.stubEnv("CLINE_HUB_BUILD_ID", "other-build");
		try {
			const other = await startHubWebSocketServer({
				owner,
				host: "127.0.0.1",
				port: 0,
				pathname: "/hub",
				runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			});
			servers.add(other);

			vi.stubEnv("CLINE_HUB_BUILD_ID", "current-build");
			const result = await ensureHubWebSocketServer({
				owner,
				host: "127.0.0.1",
				port: 0,
				pathname: "/hub",
				allowPortFallback: true,
				runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			});

			expect(result.action).toBe("reuse");
			expect(result.url).toBe(other.url);
		} finally {
			vi.unstubAllEnvs();
			await clearHubDiscovery(owner.discoveryPath);
		}
	});

	it("reuses managed discovery from a newer build instead of starting a rival", async () => {
		const owner = createInMemoryHubOwnerContext("hub-server-test-newer-build");
		vi.stubEnv("CLINE_HUB_BUILD_ID", "newer-build");
		vi.stubEnv("CLINE_HUB_BUILD_EPOCH_MS", "2000");
		try {
			const newer = await startHubWebSocketServer({
				owner,
				host: "127.0.0.1",
				port: 0,
				pathname: "/hub",
				runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			});
			servers.add(newer);

			vi.stubEnv("CLINE_HUB_BUILD_ID", "current-build");
			vi.stubEnv("CLINE_HUB_BUILD_EPOCH_MS", "1000");
			const result = await ensureHubWebSocketServer({
				owner,
				host: "127.0.0.1",
				port: 0,
				pathname: "/hub",
				allowPortFallback: true,
				runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			});

			expect(result.action).toBe("reuse");
			expect(result.url).toBe(newer.url);
		} finally {
			vi.unstubAllEnvs();
			await clearHubDiscovery(owner.discoveryPath);
		}
	});

	it("shuts down active server through the shutdown endpoint", async () => {
		const owner = createInMemoryHubOwnerContext("hub-server-test-shutdown");
		const onShutdownRequested = vi.fn();
		const result = await ensureHubWebSocketServer({
			owner,
			host: "127.0.0.1",
			port: 0,
			pathname: "/hub",
			onShutdownRequested,
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
		});
		const server = requireServer(result.server);
		servers.add(server);

		const shutdownUrl = new URL(toHubHealthUrl(result.url));
		shutdownUrl.pathname = "/shutdown";
		const discovery = await readHubDiscovery(owner.discoveryPath);
		if (!discovery) {
			throw new Error("Expected hub discovery to be written");
		}
		expect(discovery.authToken).toMatch(/^[a-f0-9]{64}$/);
		const authToken = discovery.authToken;
		const response = await fetch(shutdownUrl, {
			method: "POST",
			headers: { authorization: `Bearer ${authToken}` },
		});
		expect(response.status).toBe(202);
		await vi.waitFor(() => {
			expect(onShutdownRequested).toHaveBeenCalledOnce();
		});

		for (let index = 0; index < 50; index += 1) {
			if ((await readHubDiscovery(owner.discoveryPath)) === undefined) {
				servers.delete(server);
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, 20));
		}

		throw new Error("Timed out waiting for hub shutdown");
	});

	it("notifies the owner and tears down after authenticated shutdown", async () => {
		const owner = createInMemoryHubOwnerContext(
			"hub-server-test-delegated-shutdown",
		);
		const onShutdownRequested = vi.fn(async () => {
			throw new Error("owner notification failed after starting shutdown");
		});
		const result = await ensureHubWebSocketServer({
			owner,
			host: "127.0.0.1",
			port: 0,
			pathname: "/hub",
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			onShutdownRequested,
		});
		const server = requireServer(result.server);
		servers.add(server);

		const shutdownUrl = new URL(toHubHealthUrl(result.url));
		shutdownUrl.pathname = "/shutdown";
		const discovery = await readHubDiscovery(owner.discoveryPath);
		if (!discovery) {
			throw new Error("Expected hub discovery to be written");
		}
		const response = await fetch(shutdownUrl, {
			method: "POST",
			headers: { authorization: `Bearer ${discovery.authToken}` },
		});

		expect(response.status).toBe(202);
		await vi.waitFor(() => {
			expect(onShutdownRequested).toHaveBeenCalledOnce();
		});
		await vi.waitFor(async () => {
			expect(await readHubDiscovery(owner.discoveryPath)).toBeUndefined();
		});
		servers.delete(server);
	});

	it("rejects shutdown request with 401 when no auth token is provided", async () => {
		const owner = createInMemoryHubOwnerContext(
			"hub-server-test-shutdown-unauth",
		);
		const onShutdownRequested = vi.fn();
		const result = await ensureHubWebSocketServer({
			owner,
			host: "127.0.0.1",
			port: 0,
			pathname: "/hub",
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			onShutdownRequested,
		});
		servers.add(requireServer(result.server));

		const shutdownUrl = new URL(toHubHealthUrl(result.url));
		shutdownUrl.pathname = "/shutdown";

		// No Authorization header
		const noTokenResponse = await fetch(shutdownUrl, { method: "POST" });
		expect(noTokenResponse.status).toBe(401);

		// Wrong token
		const wrongTokenResponse = await fetch(shutdownUrl, {
			method: "POST",
			headers: { authorization: "Bearer wrong-token" },
		});
		expect(wrongTokenResponse.status).toBe(401);

		// Server should still be alive
		const health = await fetch(new URL("/health", toHubHealthUrl(result.url)));
		expect(health.status).toBe(200);
		expect(onShutdownRequested).not.toHaveBeenCalled();
	});

	it("rejects WebSocket upgrade with 401 when no auth token is provided", async () => {
		const owner = createInMemoryHubOwnerContext("hub-server-test-ws-unauth");
		const result = await ensureHubWebSocketServer({
			owner,
			host: "127.0.0.1",
			port: 0,
			pathname: "/hub",
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
		});
		servers.add(requireServer(result.server));

		const hubUrl = new URL(result.url);

		// WebSocket upgrade with no Sec-WebSocket-Protocol token
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

		expect(response).toContain("401 Unauthorized");
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
			servers.add(requireServer(result.server));

			const hubUrl = new URL(result.url);
			const discovery = await readHubDiscovery(owner.discoveryPath);
			if (!discovery) {
				throw new Error("Expected hub discovery to be written");
			}
			const authToken = discovery.authToken;
			const response = await sendRawHttpRequest(
				Number(hubUrl.port),
				[
					"GET /hub HTTP/1.1",
					"Host: 127.0.0.1",
					"Connection: Upgrade",
					"Upgrade: websocket",
					`Sec-WebSocket-Protocol: cline-hub-auth.${authToken}`,
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
