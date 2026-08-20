import { describe, expect, it } from "vitest";
import {
	BrowserGatewayClient,
	initialEventCursor,
	validateRemoteUrl,
} from "./gateway-client";

class PendingSocket extends EventTarget {
	closeCalls = 0;

	close() {
		this.closeCalls += 1;
		this.dispatchEvent(new Event("close"));
	}
}

describe("browser Gateway transport", () => {
	it("encodes the initial replay cursor", () => {
		const encoded = initialEventCursor();
		const decoded = JSON.parse(
			Buffer.from(encoded, "base64url").toString("utf8"),
		);
		expect(decoded).toEqual({ v: 1, lastSequence: -1 });
	});

	it("requires TLS outside loopback", () => {
		expect(() => validateRemoteUrl("ws://gateway.example.com", false)).toThrow(
			"wss://",
		);
		expect(validateRemoteUrl("ws://127.0.0.1:8080", false).origin).toBe(
			"ws://127.0.0.1:8080",
		);
		expect(validateRemoteUrl("wss://gateway.example.com", false).origin).toBe(
			"wss://gateway.example.com",
		);
	});

	it("rejects credentials and query parameters in URLs", () => {
		expect(() =>
			validateRemoteUrl("wss://token@gateway.example.com", false),
		).toThrow("Credentials");
		expect(() =>
			validateRemoteUrl("wss://gateway.example.com?token=no", false),
		).toThrow("query");
	});

	it("cancels and closes a pending WebSocket connection", async () => {
		const socket = new PendingSocket();
		const controller = new AbortController();
		const connection = BrowserGatewayClient.connect(
			{
				url: "wss://gateway.example.com",
				auth: "secret",
				signal: controller.signal,
			},
			() => socket as unknown as WebSocket,
		);

		controller.abort();

		await expect(connection).rejects.toMatchObject({ name: "AbortError" });
		expect(socket.closeCalls).toBe(1);
	});
});
