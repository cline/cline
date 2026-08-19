import { describe, expect, it } from "vitest";
import { initialEventCursor, validateRemoteUrl } from "./gateway-client";

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
});
