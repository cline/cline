import type { HubReplyEnvelope } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserWebSocketHubAdapter } from "./browser-websocket";

function createSocket() {
	const messageListeners = new Set<(event: { data: string }) => void>();
	const closeListeners = new Set<() => void>();
	return {
		sent: [] as string[],
		send(data: string) {
			this.sent.push(data);
		},
		addEventListener(
			type: "message" | "close",
			listener: ((event: { data: string }) => void) | (() => void),
		) {
			if (type === "message") {
				messageListeners.add(listener as (event: { data: string }) => void);
				return;
			}
			closeListeners.add(listener as () => void);
		},
		removeEventListener(
			type: "message" | "close",
			listener: ((event: { data: string }) => void) | (() => void),
		) {
			if (type === "message") {
				messageListeners.delete(listener as (event: { data: string }) => void);
				return;
			}
			closeListeners.delete(listener as () => void);
		},
		emitMessage(data: string) {
			for (const listener of messageListeners) {
				void listener({ data });
			}
		},
		emitClose() {
			for (const listener of closeListeners) {
				listener();
			}
		},
	};
}

describe("BrowserWebSocketHubAdapter", () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("ignores malformed websocket frames instead of throwing", async () => {
		const transport = {
			command: vi.fn(),
			subscribe: vi.fn(),
		};
		const socket = createSocket();
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		try {
			const adapter = new BrowserWebSocketHubAdapter(transport);
			adapter.attach(socket);

			await expect(async () => {
				socket.emitMessage("{bad json");
				await Promise.resolve();
			}).not.toThrow();

			expect(transport.command).not.toHaveBeenCalled();
			expect(socket.sent).toHaveLength(0);
			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining(
					'"message":"rejected malformed websocket frame"',
				),
			);
		} finally {
			errorSpy.mockRestore();
		}
	});

	it("keeps run.start open past the default command timeout", async () => {
		vi.useFakeTimers();
		vi.spyOn(console, "error").mockImplementation(() => {});
		let resolveCommand: ((reply: HubReplyEnvelope) => void) | undefined;
		const transport = {
			command: vi.fn(
				() =>
					new Promise<HubReplyEnvelope>((resolve) => {
						resolveCommand = resolve;
					}),
			),
			subscribe: vi.fn(),
		};
		const socket = createSocket();
		const adapter = new BrowserWebSocketHubAdapter(transport);
		adapter.attach(socket);

		socket.emitMessage(
			JSON.stringify({
				kind: "command",
				envelope: {
					version: "v1",
					command: "run.start",
					requestId: "req-run",
					clientId: "client-1",
					sessionId: "session-1",
					payload: { input: "hello" },
				},
			}),
		);

		await vi.advanceTimersByTimeAsync(30_001);
		expect(socket.sent).toHaveLength(0);

		resolveCommand?.({
			version: "v1",
			requestId: "req-run",
			ok: true,
			payload: { result: { finishReason: "completed" } },
		});
		await Promise.resolve();

		expect(socket.sent.map((entry) => JSON.parse(entry))).toContainEqual({
			kind: "reply",
			envelope: {
				version: "v1",
				requestId: "req-run",
				ok: true,
				payload: { result: { finishReason: "completed" } },
			},
		});
	});

	it("applies the default command timeout to fast commands", async () => {
		vi.useFakeTimers();
		vi.spyOn(console, "error").mockImplementation(() => {});
		const transport = {
			command: vi.fn(() => new Promise<HubReplyEnvelope>(() => {})),
			subscribe: vi.fn(),
		};
		const socket = createSocket();
		const adapter = new BrowserWebSocketHubAdapter(transport);
		adapter.attach(socket);

		socket.emitMessage(
			JSON.stringify({
				kind: "command",
				envelope: {
					version: "v1",
					command: "client.list",
					requestId: "req-list",
					clientId: "client-1",
				},
			}),
		);

		await vi.advanceTimersByTimeAsync(30_001);

		expect(socket.sent.map((entry) => JSON.parse(entry))).toContainEqual({
			kind: "reply",
			envelope: {
				version: "v1",
				requestId: "req-list",
				ok: false,
				error: {
					code: "hub_command_timeout",
					message:
						"Hub command client.list did not complete within 30000ms. Check hub-daemon.log for command.start/command.slow logs with requestId req-list.",
				},
			},
		});
	});

	// Regression: a client that reconnects (hub swap, transport recovery)
	// re-registers its clientId from a NEW connection while the old one may
	// linger half-open. Without supersede semantics the hub accumulates one
	// delivery path per connection and fans every event out N times —
	// observed in the field as word-by-word duplicated assistant text in the
	// CLI and desktop app (multiple client.register entries, zero
	// client.unregister, doubling starting mid-stream on re-register).
	describe("clientId re-registration supersedes older connections", () => {
		function createTransport() {
			return {
				command: vi.fn((_envelope: { command?: string }) =>
					Promise.resolve({
						version: "v1",
						requestId: "req",
						ok: true,
						payload: {},
					} as HubReplyEnvelope),
				),
				subscribe: vi.fn(
					(
						_clientId: string | undefined,
						_onEvent: (envelope: unknown) => void,
						_options?: { sessionId?: string },
					) => vi.fn(),
				),
			};
		}

		function registerFrame(clientId: string, requestId: string) {
			return JSON.stringify({
				kind: "command",
				envelope: {
					version: "v1",
					command: "client.register",
					requestId,
					clientId,
					payload: { clientId, clientType: "test" },
				},
			});
		}

		function subscribeFrame(clientId: string, sessionId?: string) {
			return JSON.stringify({
				kind: "stream.subscribe",
				clientId,
				...(sessionId ? { sessionId } : {}),
			});
		}

		async function settle() {
			await new Promise((resolve) => setTimeout(resolve, 0));
			await new Promise((resolve) => setTimeout(resolve, 0));
		}

		it("evicts the old connection's subscriptions when the clientId re-registers", async () => {
			const transport = createTransport();
			const adapter = new BrowserWebSocketHubAdapter(transport);
			const oldSocket = createSocket();
			const newSocket = createSocket();
			adapter.attach(oldSocket);
			adapter.attach(newSocket);

			oldSocket.emitMessage(registerFrame("client-a", "req-1"));
			await settle();
			oldSocket.emitMessage(subscribeFrame("client-a", "session-1"));
			await settle();
			expect(transport.subscribe).toHaveBeenCalledTimes(1);
			const oldUnsubscribe = transport.subscribe.mock.results[0]
				?.value as ReturnType<typeof vi.fn>;

			// Same clientId re-registers on a new connection (reconnect).
			newSocket.emitMessage(registerFrame("client-a", "req-2"));
			await settle();
			expect(oldUnsubscribe).toHaveBeenCalledTimes(1);

			// A late subscribe from the superseded connection must not
			// re-create a second delivery path.
			oldSocket.emitMessage(subscribeFrame("client-a", "session-1"));
			await settle();
			expect(transport.subscribe).toHaveBeenCalledTimes(1);

			// The new connection subscribes normally.
			newSocket.emitMessage(subscribeFrame("client-a", "session-1"));
			await settle();
			expect(transport.subscribe).toHaveBeenCalledTimes(2);
		});

		it("does not let a superseded connection's close unregister the live registration", async () => {
			const transport = createTransport();
			const adapter = new BrowserWebSocketHubAdapter(transport);
			const oldSocket = createSocket();
			const newSocket = createSocket();
			adapter.attach(oldSocket);
			adapter.attach(newSocket);

			oldSocket.emitMessage(registerFrame("client-a", "req-1"));
			await settle();
			newSocket.emitMessage(registerFrame("client-a", "req-2"));
			await settle();

			const unregisterCalls = () =>
				transport.command.mock.calls.filter(
					([envelope]) => envelope?.command === "client.unregister",
				);

			// The superseded connection closes late: it no longer owns the
			// clientId, so it must not clobber the live registration.
			oldSocket.emitClose();
			await settle();
			expect(unregisterCalls()).toHaveLength(0);

			// The owning connection's close performs the real unregister.
			newSocket.emitClose();
			await settle();
			expect(unregisterCalls()).toHaveLength(1);
		});

		it("tears down delivery when the socket is dead but close never fired", async () => {
			const transport = createTransport();
			const adapter = new BrowserWebSocketHubAdapter(transport);
			const socket = Object.assign(createSocket(), { readyState: 1 });
			adapter.attach(socket);

			socket.emitMessage(subscribeFrame("client-a"));
			await settle();
			expect(transport.subscribe).toHaveBeenCalledTimes(1);
			const onEvent = transport.subscribe.mock.calls[0]?.[1];
			if (!onEvent) throw new Error("subscribe listener was not captured");
			const unsubscribe = transport.subscribe.mock.results[0]
				?.value as ReturnType<typeof vi.fn>;

			// While the socket is open, events flow.
			onEvent({ version: "v1", event: "session.updated", payload: {} });
			expect(
				socket.sent.map((entry) => JSON.parse(entry) as { kind?: string }),
			).toContainEqual(expect.objectContaining({ kind: "event" }));

			// Socket dies without a close event (crashed peer, half-open
			// connection): the next delivery detects it and tears down.
			socket.readyState = 3;
			const sentBefore = socket.sent.length;
			onEvent({ version: "v1", event: "session.updated", payload: {} });
			expect(socket.sent).toHaveLength(sentBefore);
			expect(unsubscribe).toHaveBeenCalledTimes(1);
		});
	});
});
