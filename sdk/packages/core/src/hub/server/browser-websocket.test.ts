import type { HubReplyEnvelope } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserWebSocketHubAdapter } from "./browser-websocket";

function createSocket() {
	const messageListeners = new Set<(event: { data: string }) => void>();
	const closeListeners = new Set<() => void>();
	return {
		sent: [] as string[],
		send(data: string, callback?: (error?: unknown) => void) {
			this.sent.push(data);
			callback?.();
		},
		close() {},
		terminate() {},
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
		async emitMessage(data: string) {
			await Promise.all(
				[...messageListeners].map((listener) => listener({ data })),
			);
		},
		emitClose() {
			for (const listener of closeListeners) {
				listener();
			}
		},
		listenerCounts() {
			return {
				message: messageListeners.size,
				close: closeListeners.size,
			};
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

	it("releases subscriptions and listeners during sustained session churn", async () => {
		const activeSubscriptions = new Set<string>();
		const transport = {
			command: vi.fn(),
			subscribe: vi.fn(
				(
					clientId: string,
					_listener: unknown,
					options?: {
						sessionId?: string;
					},
				) => {
					const key = `${clientId}:${options?.sessionId ?? "*"}`;
					activeSubscriptions.add(key);
					return () => activeSubscriptions.delete(key);
				},
			),
		};
		const adapter = new BrowserWebSocketHubAdapter(transport as never);
		const socketCount = 200;
		const sessionsPerSocket = 20;

		for (let socketIndex = 0; socketIndex < socketCount; socketIndex++) {
			const socket = createSocket();
			const detach = adapter.attach(socket);
			for (
				let sessionIndex = 0;
				sessionIndex < sessionsPerSocket;
				sessionIndex++
			) {
				await socket.emitMessage(
					JSON.stringify({
						kind: "stream.subscribe",
						clientId: `client-${socketIndex}`,
						sessionId: `session-${sessionIndex}`,
					}),
				);
			}

			expect(activeSubscriptions.size).toBe(sessionsPerSocket);
			detach();
			expect(activeSubscriptions.size).toBe(0);
			expect(socket.listenerCounts()).toEqual({ message: 0, close: 0 });
		}

		expect(transport.subscribe).toHaveBeenCalledTimes(
			socketCount * sessionsPerSocket,
		);
	});
});
