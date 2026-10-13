import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import { NodeHubClient } from ".";

const servers: WebSocketServer[] = [];

type CommandContext = {
	command: string;
	requestId: string;
	reply: (
		result?:
			| { ok?: true; payload?: unknown }
			| { ok: false; error: { code: string; message: string } },
	) => void;
};

async function startHubServer(options?: {
	onConnection?: (request: IncomingMessage) => void;
	onCommand?: (context: CommandContext) => void;
}): Promise<{ server: WebSocketServer; url: string }> {
	const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
	servers.push(server);
	await new Promise<void>((resolve) => server.once("listening", resolve));
	server.on("connection", (socket, request) => {
		options?.onConnection?.(request);
		socket.on("message", (data) => {
			const frame = JSON.parse(data.toString()) as {
				kind?: string;
				envelope?: { command?: string; requestId?: string };
			};
			if (
				frame.kind !== "command" ||
				!frame.envelope?.command ||
				!frame.envelope.requestId
			) {
				return;
			}
			const { command, requestId } = frame.envelope;
			const context: CommandContext = {
				command,
				requestId,
				reply: (result = {}) => {
					socket.send(
						JSON.stringify({
							kind: "reply",
							envelope: {
								version: "v1",
								command,
								requestId,
								clientId: "hub",
								ok: result.ok ?? true,
								...(result.ok === false
									? { error: result.error }
									: { payload: result.payload ?? {} }),
							},
						}),
					);
				},
			};
			if (options?.onCommand) {
				options.onCommand(context);
			} else {
				context.reply();
			}
		});
	});
	const { port } = server.address() as AddressInfo;
	return { server, url: `ws://127.0.0.1:${port}/hub` };
}

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
		let acknowledgeRegistration: (() => void) | undefined;
		let registrationReceived: (() => void) | undefined;
		const receivedRegistration = new Promise<void>((resolve) => {
			registrationReceived = resolve;
		});
		const { url } = await startHubServer({
			onCommand: ({ command, reply }) => {
				if (command === "client.register") {
					acknowledgeRegistration = reply;
					registrationReceived?.();
				}
			},
		});

		const client = new NodeHubClient({
			url,
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
		const upgrades: Array<{
			authorization: string | undefined;
			protocol: string | undefined;
		}> = [];
		let resolveReconnect: (() => void) | undefined;
		const reconnected = new Promise<void>((resolve) => {
			resolveReconnect = resolve;
		});
		const { server, url } = await startHubServer({
			onConnection: (request) => {
				upgrades.push({
					authorization: request.headers.authorization,
					protocol: request.headers["sec-websocket-protocol"],
				});
				if (upgrades.length === 2) {
					resolveReconnect?.();
				}
			},
		});

		let tokenVersion = 0;
		const client = new NodeHubClient({
			url,
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

	it("surfaces resolver failures and reruns the resolver on the next connect", async () => {
		const { url } = await startHubServer();
		let attempts = 0;
		const client = new NodeHubClient({
			url,
			resolveConnectionHeaders: async () => {
				attempts += 1;
				if (attempts === 1) {
					throw new Error("token refresh failed: signed out");
				}
				return { Authorization: "Bearer account-token" };
			},
		});

		try {
			await expect(client.connect()).rejects.toMatchObject({
				code: "hub_connect_failed",
				message: expect.stringContaining("signed out"),
			});
			expect(client.getConnectionError()).toMatchObject({
				code: "hub_connect_failed",
				message: expect.stringContaining("signed out"),
			});
			await client.connect();
			expect(client.isConnected()).toBe(true);
			expect(attempts).toBe(2);
		} finally {
			client.close();
		}
	});

	it("lets a fresh connect supersede an attempt stuck in header resolution after close()", async () => {
		const { url } = await startHubServer();
		let releaseFirstResolver:
			| ((headers: Readonly<Record<string, string>>) => void)
			| undefined;
		let attempts = 0;
		const client = new NodeHubClient({
			url,
			resolveConnectionHeaders: () => {
				attempts += 1;
				if (attempts === 1) {
					return new Promise<Readonly<Record<string, string>>>((resolve) => {
						releaseFirstResolver = resolve;
					});
				}
				return Promise.resolve({ Authorization: "Bearer account-token" });
			},
		});

		try {
			const doomed = client.connect();
			client.close();
			await client.connect();
			expect(client.isConnected()).toBe(true);
			releaseFirstResolver?.({ Authorization: "Bearer stale-token" });
			await expect(doomed).rejects.toMatchObject({
				code: "hub_connection_closed",
			});
			expect(client.isConnected()).toBe(true);
		} finally {
			client.close();
		}
	});

	it("times out a hung header resolver instead of pinning connect() forever", async () => {
		vi.useFakeTimers();
		const client = new NodeHubClient({
			url: "ws://127.0.0.1:25463/hub",
			resolveConnectionHeaders: () => new Promise(() => {}),
		});

		try {
			const connecting = client.connect();
			const expectation = expect(connecting).rejects.toMatchObject({
				code: "hub_connect_timeout",
			});
			await vi.advanceTimersByTimeAsync(8_100);
			await expectation;
			expect(client.getConnectionError()).toMatchObject({
				code: "hub_connect_timeout",
			});
		} finally {
			vi.useRealTimers();
			client.close();
		}
	});

	it("closes the socket when registration fails so reconnect re-registers", async () => {
		let registrationAttempts = 0;
		const { url } = await startHubServer({
			onCommand: ({ command, reply }) => {
				const isRegister = command === "client.register";
				if (isRegister) {
					registrationAttempts += 1;
				}
				const rejectRegistration = isRegister && registrationAttempts === 1;
				reply(
					rejectRegistration
						? {
								ok: false,
								error: { code: "not_authorized", message: "denied" },
							}
						: {},
				);
			},
		});

		const client = new NodeHubClient({
			url,
			resolveConnectionHeaders: async () => ({
				Authorization: "Bearer account-token",
			}),
		});

		try {
			await expect(client.connect()).rejects.toThrow();
			expect(client.getConnectionError()?.message).toBe("denied");
			expect(
				(client as unknown as { socket?: unknown }).socket,
			).toBeUndefined();
			await client.connect();
			expect(client.isConnected()).toBe(true);
			expect(registrationAttempts).toBe(2);
		} finally {
			client.close();
		}
	});

	it("aborts a registration whose reply raced close(), and never leaves a zombie socket", async () => {
		let registrationMode: "silent" | "reject" | "ack" = "silent";
		let connectionCount = 0;
		let announceRegister: ((requestId: string) => void) | undefined;
		const { url } = await startHubServer({
			onConnection: () => {
				connectionCount += 1;
			},
			onCommand: ({ command, requestId, reply }) => {
				if (command !== "client.register") {
					return;
				}
				if (registrationMode !== "silent") {
					const rejected = registrationMode === "reject";
					reply(
						rejected
							? {
									ok: false,
									error: { code: "not_authorized", message: "expired" },
								}
							: {},
					);
				}
				announceRegister?.(requestId);
			},
		});

		const client = new NodeHubClient({
			url,
			resolveConnectionHeaders: () => ({
				Authorization: "Bearer account-token",
			}),
		});

		try {
			const registerRequestId = new Promise<string>((resolve) => {
				announceRegister = resolve;
			});
			const raced = client.connect();
			const requestId = await registerRequestId;
			(
				client as unknown as { handleFrame: (frame: unknown) => void }
			).handleFrame({
				kind: "reply",
				envelope: {
					version: "v1",
					command: "client.register",
					requestId,
					ok: true,
					clientId: "hub",
					payload: {},
				},
			});
			client.close();
			await expect(raced).rejects.toMatchObject({
				code: "hub_connection_closed",
			});
			expect(client.isConnected()).toBe(false);

			registrationMode = "reject";
			await expect(client.connect()).rejects.toMatchObject({
				code: "not_authorized",
			});
			expect(client.isConnected()).toBe(false);

			registrationMode = "ack";
			await client.connect();
			expect(client.isConnected()).toBe(true);
			expect(connectionCount).toBe(3);
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
		expect(client.getConnectionError()?.message).toBe(
			"Hub connection headers cannot set Sec-WebSocket-Protocol.",
		);
	});
});
