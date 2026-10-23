/**
 * The phone-side socket buffers what a caller sends before the relay has paired
 * it with a machine. That queue is memory on a phone, so it is capped, and a
 * relay-supplied close code is never trusted as a close-code lookup key.
 */

import { describe, expect, it } from "vitest";
import {
	bindRelayPayload,
	bytesToBase64,
	RELAY_CLOSE_CODES,
	RELAY_PROTOCOL_VERSION,
	type RelayWebSocketCtor,
	WEBSOCKET_READY_STATE,
} from "../protocol/index";
import { createRelayClientSocket } from "./socket";

type Listener = (event: unknown) => void;

/** A `WebSocketLike` the test drives: nothing is ever dialled. */
class ScriptedSocket {
	static last: ScriptedSocket | undefined;
	readyState: number = WEBSOCKET_READY_STATE.connecting;
	readonly sent: string[] = [];
	closed = 0;
	private readonly listeners = new Map<string, Set<Listener>>();

	constructor() {
		ScriptedSocket.last = this;
	}

	send(data: string): void {
		this.sent.push(data);
	}

	close(): void {
		this.closed += 1;
		this.readyState = WEBSOCKET_READY_STATE.closed;
	}

	addEventListener(type: string, listener: Listener): void {
		const set = this.listeners.get(type) ?? new Set<Listener>();
		set.add(listener);
		this.listeners.set(type, set);
	}

	emit(type: string, event: unknown): void {
		for (const listener of [...(this.listeners.get(type) ?? [])]) {
			listener(event);
		}
	}

	open(): void {
		this.readyState = WEBSOCKET_READY_STATE.open;
		this.emit("open", { type: "open" });
	}

	deliver(frame: unknown): void {
		this.emit("message", { data: JSON.stringify(frame) });
	}
}

function createSocket(
	overrides: Partial<Parameters<typeof createRelayClientSocket>[0]> = {},
): {
	socket: ReturnType<typeof createRelayClientSocket>;
	inner: ScriptedSocket;
	errors: string[];
	closes: { code: number; reason: string }[];
} {
	const errors: string[] = [];
	const closes: { code: number; reason: string }[] = [];
	const socket = createRelayClientSocket({
		relayUrl: "ws://127.0.0.1:1",
		accountToken: "tok",
		machineId: "mach_air",
		WebSocketImpl: ScriptedSocket as unknown as RelayWebSocketCtor,
		...overrides,
	});
	socket.addEventListener("error", (event: unknown) => {
		errors.push(String((event as { message?: string })?.message ?? ""));
	});
	socket.addEventListener("close", (event: unknown) => {
		const close = event as { code: number; reason: string };
		closes.push({ code: close.code, reason: close.reason });
	});
	const inner = ScriptedSocket.last as ScriptedSocket;
	return { socket, inner, errors, closes };
}

describe("relay client socket limits", () => {
	it("closes on a sequence gap instead of accepting a later frame", () => {
		const { socket, inner, errors, closes } = createSocket();
		inner.open();
		inner.deliver({
			t: "client.connected",
			protocolVersion: RELAY_PROTOCOL_VERSION,
			channelId: "chn_1",
			machineId: "mach_air",
			label: "laptop",
		});
		inner.deliver({
			t: "data",
			channelId: "chn_1",
			seq: 2,
			payload: "",
		});
		expect(errors[0]).toContain("did not match expected 1");
		expect(closes[0]?.code).toBe(RELAY_CLOSE_CODES.replayed_frame);
		expect(socket.readyState).toBe(WEBSOCKET_READY_STATE.closed);
	});

	it("closes when authenticated routing metadata disagrees with the envelope", () => {
		const identity = {
			seal: (value: Uint8Array) => value,
			open: (value: Uint8Array) => value,
		};
		const { socket, inner, errors, closes } = createSocket({
			payloadCodec: identity,
		});
		inner.open();
		inner.deliver({
			t: "client.connected",
			protocolVersion: RELAY_PROTOCOL_VERSION,
			channelId: "chn_1",
			machineId: "mach_air",
			label: "laptop",
		});
		inner.deliver({
			t: "data",
			channelId: "chn_1",
			seq: 1,
			payload: bytesToBase64(
				bindRelayPayload({
					channelId: "chn_1",
					seq: 2,
					payload: new TextEncoder().encode("command"),
				}),
			),
		});
		expect(errors[0]).toContain("does not match outer sequence");
		expect(closes[0]?.code).toBe(RELAY_CLOSE_CODES.malformed_frame);
		expect(socket.readyState).toBe(WEBSOCKET_READY_STATE.closed);
	});

	it("caps what it queues before the relay pairs it", () => {
		const { socket, inner, errors, closes } = createSocket({
			maxPendingSendBytes: 8 * 1024,
		});
		inner.open();
		for (let index = 0; index < 200; index += 1) {
			socket.send("x".repeat(1024));
		}
		expect(errors.some((message) => /backpressure/.test(message))).toBe(true);
		expect(closes).toHaveLength(1);
		expect(closes[0]?.code).toBe(RELAY_CLOSE_CODES.backpressure);
		expect(socket.readyState).toBe(WEBSOCKET_READY_STATE.closed);
	});

	it("flushes a queue that stays inside the cap once paired", () => {
		const { socket, inner } = createSocket();
		inner.open();
		socket.send("first");
		socket.send("second");
		inner.deliver({
			t: "client.connected",
			protocolVersion: RELAY_PROTOCOL_VERSION,
			channelId: "chn_1",
			machineId: "mach_air",
			label: "laptop",
		});
		const dataFrames = inner.sent.filter((text) => text.includes('"t":"data"'));
		expect(dataFrames).toHaveLength(2);
	});

	it("tears the socket down on a channel.close whose code is a prototype name", () => {
		const { socket, inner, closes } = createSocket();
		inner.open();
		inner.deliver({
			t: "client.connected",
			protocolVersion: RELAY_PROTOCOL_VERSION,
			channelId: "chn_1",
			machineId: "mach_air",
			label: "laptop",
		});
		inner.deliver({
			t: "channel.close",
			channelId: "chn_1",
			code: "constructor",
			reason: "gotcha",
		});
		// Before the fix `RELAY_CLOSE_CODES["constructor"]` was a function: the
		// close event carried it to `HubClient` and `inner.close()` threw, leaving
		// the real socket OPEN.
		expect(closes).toHaveLength(1);
		expect(typeof closes[0]?.code).toBe("number");
		expect(closes[0]?.code).toBe(RELAY_CLOSE_CODES.internal);
		expect(inner.closed).toBeGreaterThan(0);
		expect(socket.readyState).toBe(WEBSOCKET_READY_STATE.closed);
	});
});
