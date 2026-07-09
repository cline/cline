import { type AddressInfo, createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createComputerUseToolFromEnv } from "./env";
import type { ComputerUseResponse } from "./protocol";

/**
 * Like the fake backend in client.test.ts/tool.test.ts, but also tracks
 * accepted sockets so the test can force-close them. Unlike those files,
 * `createComputerUseToolFromEnv` builds its own internal `ComputerUseClient`
 * with no handle exposed back to the test, so there's no `client.close()` to
 * call — `server.close()` alone would otherwise hang forever waiting for the
 * (unref'd but still open) client connection to end.
 */
function startFakeBackend(
	respond: (request: Record<string, unknown>) => ComputerUseResponse,
): Promise<{ server: Server; port: number; destroyConnections: () => void }> {
	const sockets = new Set<Socket>();
	return new Promise((resolve) => {
		const server = createServer((socket: Socket) => {
			sockets.add(socket);
			socket.on("close", () => sockets.delete(socket));
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
						socket.write(`${JSON.stringify(respond(request))}\n`);
					}
					newlineIndex = buffer.indexOf("\n");
				}
			});
		});
		server.listen(0, "127.0.0.1", () => {
			const address = server.address() as AddressInfo;
			resolve({
				server,
				port: address.port,
				destroyConnections: () => {
					for (const socket of sockets) {
						socket.destroy();
					}
				},
			});
		});
	});
}

function fakeDisplayInfoBackend(
	widthPx: number,
	heightPx: number,
): (request: Record<string, unknown>) => ComputerUseResponse {
	return (request) => ({
		id: request.id as number,
		ok: true,
		display: { widthPx, heightPx },
	});
}

describe("createComputerUseToolFromEnv", () => {
	let server: Server | undefined;
	let destroyConnections: (() => void) | undefined;

	afterEach(async () => {
		destroyConnections?.();
		destroyConnections = undefined;
		if (!server) {
			return;
		}
		await new Promise<void>((resolve) => server?.close(() => resolve()));
		server = undefined;
	});

	it("returns undefined when the port variable is unset", async () => {
		await expect(createComputerUseToolFromEnv({})).resolves.toBeUndefined();
	});

	it("returns undefined when the port variable is not a positive integer", async () => {
		await expect(
			createComputerUseToolFromEnv({ CLINE_COMPUTER_USE_PORT: "not-a-port" }),
		).resolves.toBeUndefined();
		await expect(
			createComputerUseToolFromEnv({ CLINE_COMPUTER_USE_PORT: "0" }),
		).resolves.toBeUndefined();
		await expect(
			createComputerUseToolFromEnv({ CLINE_COMPUTER_USE_PORT: "-1" }),
		).resolves.toBeUndefined();
	});

	it("queries the backend for display size when no override is set", async () => {
		const started = await startFakeBackend(fakeDisplayInfoBackend(1920, 1080));
		server = started.server;
		destroyConnections = started.destroyConnections;

		const tool = await createComputerUseToolFromEnv({
			CLINE_COMPUTER_USE_PORT: String(started.port),
		});

		expect(tool).toBeDefined();
		expect(tool?.name).toBe("computer");
		expect(tool?.description).toContain("1920x1080");
	});

	it("honors display size overrides without querying the backend", async () => {
		const started = await startFakeBackend(() => {
			throw new Error("backend should not be queried when overrides are set");
		});
		server = started.server;

		const tool = await createComputerUseToolFromEnv({
			CLINE_COMPUTER_USE_PORT: String(started.port),
			CLINE_COMPUTER_USE_DISPLAY_WIDTH: "1024",
			CLINE_COMPUTER_USE_DISPLAY_HEIGHT: "768",
		});

		expect(tool?.description).toContain("1024x768");
	});
});
