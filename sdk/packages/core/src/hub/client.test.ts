import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NodeHubClient } from "./client";

type MessageListener = (event: { data: string }) => void;
type GenericListener = (...args: unknown[]) => void;

class FakeWebSocket {
	static instances: FakeWebSocket[] = [];

	public readyState = 0;
	private readonly listeners = new Map<string, Set<GenericListener>>();

	constructor(_url: string) {
		FakeWebSocket.instances.push(this);
	}

	addEventListener(type: string, listener: GenericListener): void {
		const current = this.listeners.get(type) ?? new Set<GenericListener>();
		current.add(listener);
		this.listeners.set(type, current);
	}

	send(data: string): void {
		const frame = JSON.parse(data) as {
			kind?: string;
			envelope?: { requestId?: string; command?: string };
		};
		if (
			frame.kind === "command" &&
			frame.envelope?.command === "client.register" &&
			frame.envelope.requestId
		) {
			queueMicrotask(() => {
				this.emit("message", {
					data: JSON.stringify({
						kind: "reply",
						envelope: {
							version: "v1",
							requestId: frame.envelope?.requestId,
							ok: true,
							payload: {},
						},
					}),
				});
			});
		}
	}

	close(): void {
		this.readyState = 3;
		this.emit("close", { code: 1000, reason: "" });
	}

	open(): void {
		this.readyState = 1;
		this.emit("open");
	}

	private emit(type: string, payload?: unknown): void {
		for (const listener of this.listeners.get(type) ?? []) {
			if (type === "message") {
				(listener as MessageListener)(payload as { data: string });
				continue;
			}
			listener(payload);
		}
	}
}

describe("NodeHubClient", () => {
	const originalWebSocket = globalThis.WebSocket;

	beforeEach(() => {
		vi.useFakeTimers();
		FakeWebSocket.instances = [];
		(globalThis as unknown as { WebSocket?: typeof FakeWebSocket }).WebSocket =
			FakeWebSocket;
	});

	afterEach(() => {
		vi.useRealTimers();
		if (originalWebSocket) {
			globalThis.WebSocket = originalWebSocket;
		} else {
			delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket;
		}
	});

	it("times out when the hub connection never opens", async () => {
		const client = new NodeHubClient({ url: "ws://127.0.0.1:4319/hub" });
		const connectPromise = client.connect();
		const expectation = expect(connectPromise).rejects.toThrow(
			"Timed out connecting to hub after 8000ms",
		);

		await vi.advanceTimersByTimeAsync(8_001);
		await expectation;
	});

	it("times out when a hub command never replies", async () => {
		const client = new NodeHubClient({ url: "ws://127.0.0.1:4319/hub" });
		const connectPromise = client.connect();
		const socket = FakeWebSocket.instances[0];
		if (!socket) {
			throw new Error("expected fake websocket instance");
		}
		socket.open();
		await connectPromise;

		const commandPromise = client.command("client.list");
		const expectation = expect(commandPromise).rejects.toThrow(
			"Hub command client.list timed out after 30000ms",
		);
		await vi.advanceTimersByTimeAsync(30_001);
		await expectation;
	});
});
