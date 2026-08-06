import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import { NodeHubClient } from ".";

const servers: WebSocketServer[] = [];

afterEach(async () => {
	for (const server of servers.splice(0)) {
		for (const socket of server.clients) {
			socket.terminate();
		}
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
	vi.restoreAllMocks();
});

describe("NodeHubClient connection headers", () => {
	it("keeps concurrent connects pending until registration finishes", async () => {
		const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
		servers.push(server);
		await new Promise<void>((resolve) => server.once("listening", resolve));

		let acknowledgeRegistration: (() => void) | undefined;
		let registrationReceived: (() => void) | undefined;
		const receivedRegistration = new Promise<void>((resolve) => {
			registrationReceived = resolve;
		});
		server.on("connection", (socket) => {
			socket.on("message", (data) => {
				const frame = JSON.parse(data.toString()) as {
					kind?: string;
					envelope?: { command?: string; requestId?: string };
				};
				if (
					frame.kind !== "command" ||
					frame.envelope?.command !== "client.register" ||
					!frame.envelope.requestId
				) {
					return;
				}
				acknowledgeRegistration = () => {
					socket.send(
						JSON.stringify({
							kind: "reply",
							envelope: {
								version: "v1",
								command: frame.envelope?.command,
								requestId: frame.envelope?.requestId,
								ok: true,
								clientId: "hub",
								payload: {},
							},
						}),
					);
				};
				registrationReceived?.();
			});
		});

		const { port } = server.address() as AddressInfo;
		const client = new NodeHubClient({
			url: `ws://127.0.0.1:${port}/hub`,
			resolveConnectionHeaders: async () => ({
				Authorization: "Bearer account-token",
			}),
		});
		let firstSettled = false;
		let secondSettled = false;

		try {
			const first = client.connect().finally(() => {
				firstSettled = true;
			});
			const second = client.connect().finally(() => {
				secondSettled = true;
			});
			await receivedRegistration;
			await Promise.resolve();

			expect(firstSettled).toBe(false);
			expect(secondSettled).toBe(false);
			acknowledgeRegistration?.();
			await Promise.all([first, second]);
			expect(client.isConnected()).toBe(true);
		} finally {
			client.close();
		}
	});

	it("refreshes upgrade headers on reconnect without sending a subprotocol", async () => {
		const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
		servers.push(server);
		await new Promise<void>((resolve) => server.once("listening", resolve));

		const upgrades: Array<{
			authorization: string | undefined;
			protocol: string | undefined;
		}> = [];
		let resolveReconnect: (() => void) | undefined;
		const reconnected = new Promise<void>((resolve) => {
			resolveReconnect = resolve;
		});
		server.on("connection", (socket, request) => {
			upgrades.push({
				authorization: request.headers.authorization,
				protocol: request.headers["sec-websocket-protocol"],
			});
			if (upgrades.length === 2) {
				resolveReconnect?.();
			}
			socket.on("message", (data) => {
				const frame = JSON.parse(data.toString()) as {
					kind?: string;
					envelope?: {
						command?: string;
						requestId?: string;
					};
				};
				if (frame.kind !== "command" || !frame.envelope?.requestId) {
					return;
				}
				socket.send(
					JSON.stringify({
						kind: "reply",
						envelope: {
							version: "v1",
							command: frame.envelope.command,
							requestId: frame.envelope.requestId,
							ok: true,
							clientId: "hub",
							payload: {},
						},
					}),
				);
			});
		});

		let tokenVersion = 0;
		const { port } = server.address() as AddressInfo;
		const client = new NodeHubClient({
			url: `ws://127.0.0.1:${port}/hub`,
			resolveConnectionHeaders: async () => ({
				Authorization: `Bearer token-${++tokenVersion}`,
			}),
		});
		client.subscribe(() => {});

		try {
			await client.connect();
			server.clients.values().next().value?.terminate();
			await Promise.race([
				reconnected,
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error("reconnect timed out")), 3_000),
				),
			]);

			expect(upgrades).toEqual([
				{ authorization: "Bearer token-1", protocol: undefined },
				{ authorization: "Bearer token-2", protocol: undefined },
			]);
		} finally {
			client.close();
		}
	});

	it("rejects connection headers combined with an explicit auth token", () => {
		expect(
			() =>
				new NodeHubClient({
					url: "ws://127.0.0.1:25463/hub",
					authToken: "hub-token",
					resolveConnectionHeaders: () => ({
						Authorization: "Bearer account-token",
					}),
				}),
		).toThrow(
			"Hub connection headers cannot be combined with authToken authentication.",
		);
	});

	it("does not open a socket after closing while headers are resolving", async () => {
		let finishResolving:
			| ((headers: Readonly<Record<string, string>>) => void)
			| undefined;
		const headers = new Promise<Readonly<Record<string, string>>>((resolve) => {
			finishResolving = resolve;
		});
		const client = new NodeHubClient({
			url: "ws://127.0.0.1:25463/hub",
			resolveConnectionHeaders: () => headers,
		});

		const connecting = client.connect();
		client.close();
		finishResolving?.({ Authorization: "Bearer account-token" });

		await expect(connecting).rejects.toMatchObject({
			code: "hub_connection_closed",
		});
		expect(client.isConnected()).toBe(false);
	});

	it("closes the socket when registration fails so reconnect re-registers", async () => {
		const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
		servers.push(server);
		await new Promise<void>((resolve) => server.once("listening", resolve));

		let registrationAttempts = 0;
		server.on("connection", (socket) => {
			socket.on("message", (data) => {
				const frame = JSON.parse(data.toString()) as {
					kind?: string;
					envelope?: { command?: string; requestId?: string };
				};
				if (frame.kind !== "command" || !frame.envelope?.requestId) {
					return;
				}
				const isRegister = frame.envelope.command === "client.register";
				if (isRegister) {
					registrationAttempts += 1;
				}
				const rejectRegistration = isRegister && registrationAttempts === 1;
				socket.send(
					JSON.stringify({
						kind: "reply",
						envelope: {
							version: "v1",
							command: frame.envelope.command,
							requestId: frame.envelope.requestId,
							ok: !rejectRegistration,
							clientId: "hub",
							...(rejectRegistration
								? { error: { code: "not_authorized", message: "denied" } }
								: { payload: {} }),
						},
					}),
				);
			});
		});

		const { port } = server.address() as AddressInfo;
		const client = new NodeHubClient({
			url: `ws://127.0.0.1:${port}/hub`,
			resolveConnectionHeaders: async () => ({
				Authorization: "Bearer account-token",
			}),
		});

		try {
			await expect(client.connect()).rejects.toThrow();
			// The unregistered socket must not satisfy the next connect().
			await client.connect();
			expect(client.isConnected()).toBe(true);
			expect(registrationAttempts).toBe(2);
		} finally {
			client.close();
		}
	});

	it("rejects connection headers combined with an auth token in the URL", async () => {
		const resolveConnectionHeaders = vi.fn(() => ({
			Authorization: "Bearer account-token",
		}));
		const client = new NodeHubClient({
			url: "ws://127.0.0.1:25463/hub?authToken=hub-token",
			resolveConnectionHeaders,
		});

		await expect(client.connect()).rejects.toThrow(
			"Hub connection headers cannot be combined with authToken authentication.",
		);
		expect(resolveConnectionHeaders).not.toHaveBeenCalled();
	});

	it("does not allow connection headers to set a subprotocol", async () => {
		const client = new NodeHubClient({
			url: "ws://127.0.0.1:25463/hub",
			resolveConnectionHeaders: () => ({
				"Sec-WebSocket-Protocol": "unexpected",
			}),
		});

		await expect(client.connect()).rejects.toThrow(
			"Hub connection headers cannot set Sec-WebSocket-Protocol.",
		);
	});
});
