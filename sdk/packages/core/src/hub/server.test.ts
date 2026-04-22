import { createServer as createNetServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
	clearHubDiscovery,
	createInMemoryHubOwnerContext,
	readHubDiscovery,
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
});
