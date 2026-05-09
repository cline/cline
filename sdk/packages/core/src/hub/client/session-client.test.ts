import { afterEach, describe, expect, it, vi } from "vitest";
import { HubSessionClient } from "./session-client";

type SocketListener = (...args: unknown[]) => void;

class MockWebSocket {
	static instances: MockWebSocket[] = [];

	readyState = 0;
	private readonly listeners = new Map<string, SocketListener[]>();

	constructor(_url: string) {
		MockWebSocket.instances.push(this);
		queueMicrotask(() => {
			this.readyState = 1;
			this.emit("open");
		});
	}

	static reset(): void {
		MockWebSocket.instances = [];
	}

	send(data: string): void {
		const frame = JSON.parse(data) as {
			kind?: string;
			envelope?: { requestId?: string; command?: string };
		};
		if (frame.kind !== "command" || !frame.envelope?.requestId) {
			return;
		}
		queueMicrotask(() => {
			this.emitFrame({
				kind: "reply",
				envelope: {
					version: "v1",
					requestId: frame.envelope?.requestId,
					command: frame.envelope?.command,
					ok: true,
					payload: {},
				},
			});
		});
	}

	close(): void {
		this.readyState = 3;
		this.emit("close", { code: 1000, reason: "" });
	}

	addEventListener(type: string, listener: SocketListener): void {
		const listeners = this.listeners.get(type) ?? [];
		listeners.push(listener);
		this.listeners.set(type, listeners);
	}

	emitFrame(frame: unknown): void {
		this.emit("message", { data: JSON.stringify(frame) });
	}

	private emit(type: string, ...args: unknown[]): void {
		for (const listener of this.listeners.get(type) ?? []) {
			listener(...args);
		}
	}
}

describe("HubSessionClient", () => {
	afterEach(() => {
		MockWebSocket.reset();
		vi.unstubAllGlobals();
	});

	it("normalizes run.failed events to include a top-level error", async () => {
		vi.stubGlobal("WebSocket", MockWebSocket);
		const client = new HubSessionClient({
			address: "ws://127.0.0.1:25463/hub",
			clientId: "client-1",
		});
		await client.connect();
		const socket = MockWebSocket.instances[0];
		if (!socket) {
			throw new Error("expected websocket");
		}
		const received: Array<{
			sessionId: string;
			eventType: string;
			payload: Record<string, unknown>;
		}> = [];
		const unsubscribe = client.streamEvents(
			{ sessionIds: ["session-1"] },
			{
				onEvent: (event) => {
					received.push(event);
				},
			},
		);

		socket.emitFrame({
			kind: "event",
			envelope: {
				version: "v1",
				eventId: "evt-1",
				event: "run.failed",
				timestamp: Date.now(),
				sessionId: "session-1",
				payload: {
					reason: "error",
					result: {
						text: "Provider rejected the request",
						finishReason: "error",
					},
				},
			},
		});

		expect(received).toEqual([
			{
				sessionId: "session-1",
				eventType: "runtime.chat.failed",
				payload: {
					reason: "error",
					error: "Provider rejected the request",
					result: {
						text: "Provider rejected the request",
						finishReason: "error",
					},
				},
			},
		]);

		unsubscribe();
		client.close();
	});
});
