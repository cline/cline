/**
 * The RN entry declares its own structural websocket types so its import graph
 * stays external-free (see `no-node-builtins.test.ts`). This test is what keeps
 * those local declarations pinned to `@cline/hub-client`'s real ones: it lives in
 * a test file, so the import never reaches the shipped graph.
 */

import type {
	CreateHubSocketOptions,
	WebSocketCtor,
	WebSocketLike,
} from "@cline/hub-client";
import { createHubSocket } from "@cline/hub-client";
import { describe, expect, it } from "vitest";
import type {
	RelayWebSocketCtor,
	RelayWebSocketLike,
} from "../protocol/websocket";
import {
	createRelayClientSocket,
	createRelayWebSocketImpl,
	type RelayClientSocket,
} from "./socket";

describe("WebSocketLike conformance", () => {
	it("matches @cline/hub-client's structural types in both directions", () => {
		// Compile-time assertions; a drift in either package fails `bun typecheck`.
		const forward: WebSocketLike = {} as RelayWebSocketLike;
		const backward: RelayWebSocketLike = {} as WebSocketLike;
		const ctorForward: WebSocketCtor = {} as RelayWebSocketCtor;
		const ctorBackward: RelayWebSocketCtor = {} as WebSocketCtor;
		const socketIsLike: WebSocketLike = {} as RelayClientSocket;
		void forward;
		void backward;
		void ctorForward;
		void ctorBackward;
		void socketIsLike;
		expect(true).toBe(true);
	});

	it("createRelayWebSocketImpl is accepted as HubClient's WebSocketImpl", () => {
		const WebSocketImpl: WebSocketCtor = createRelayWebSocketImpl({
			relayUrl: "ws://127.0.0.1:1",
			accountToken: "tok",
			machineId: "mach_x",
			// A stub so nothing dials out during a type/shape test.
			WebSocketImpl: StubSocket as unknown as RelayWebSocketCtor,
		});
		const options: CreateHubSocketOptions = {
			url: "ws://hub.invalid/hub",
			authMode: "none",
			WebSocketImpl,
		};
		const socket = createHubSocket(options);
		expect(typeof socket.send).toBe("function");
		expect(typeof socket.close).toBe("function");
		expect(typeof socket.addEventListener).toBe("function");
		expect(socket.readyState).toBe(0);
		socket.close();
	});

	it("exposes exactly the WebSocketLike surface plus relay metadata", () => {
		const socket = createRelayClientSocket({
			relayUrl: "ws://127.0.0.1:1",
			accountToken: "tok",
			WebSocketImpl: StubSocket as unknown as RelayWebSocketCtor,
		});
		expect(socket.readyState).toBe(0);
		expect(socket.channelId).toBeUndefined();
		expect(socket.machineId).toBeUndefined();
		socket.close();
		expect(socket.readyState).toBe(3);
	});
});

class StubSocket {
	readyState = 0;
	sent: string[] = [];
	send(data: string): void {
		this.sent.push(data);
	}
	close(): void {
		this.readyState = 3;
	}
	addEventListener(): void {}
}
