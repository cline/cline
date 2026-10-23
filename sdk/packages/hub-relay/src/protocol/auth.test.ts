import { describe, expect, it } from "vitest";
import { decodeRelayAuthCredential, encodeRelayAuthCredential } from "./auth";
import { RELAY_AUTH_PROTOCOL_PREFIX } from "./frames";

/** RFC 9110 `tchar`s — everything legal in an HTTP token, hence a subprotocol. */
const TCHAR = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

describe("relay auth subprotocol", () => {
	it("round-trips the Cline account convention `workos:<jwt>`", () => {
		// Deliberately NOT base64/JWT-shaped: the encoding only has to survive the
		// `:` and `.` separators, and a realistic-looking JWT trips secret scanners.
		const token = "workos:FAKE-header.FAKE-payload.FAKE-signature";
		const encoded = encodeRelayAuthCredential(token);
		expect(decodeRelayAuthCredential(encoded)).toBe(token);
	});

	it("produces a subprotocol every websocket runtime will accept", () => {
		// The bug this guards: a raw `workos:<jwt>` contains `:`, which is NOT a
		// tchar, so Node's global WebSocket refuses to send it ("Wrong protocol for
		// WebSocket") and the relay never even sees the connection.
		for (const token of [
			"workos:FAKE-header.payload.sig",
			"dev:some-other-account",
			'weird "token" with spaces, commas and \\slashes/',
			"ünïcödé-token-🚀",
		]) {
			const encoded = encodeRelayAuthCredential(token);
			expect(encoded.startsWith(RELAY_AUTH_PROTOCOL_PREFIX)).toBe(true);
			expect(encoded.slice(RELAY_AUTH_PROTOCOL_PREFIX.length), token).toMatch(
				TCHAR,
			);
			expect(decodeRelayAuthCredential(encoded), token).toBe(token);
		}
	});

	it("ignores subprotocols that are not ours", () => {
		expect(
			decodeRelayAuthCredential("cline-hub-auth.deadbeef"),
		).toBeUndefined();
		expect(
			decodeRelayAuthCredential(RELAY_AUTH_PROTOCOL_PREFIX),
		).toBeUndefined();
		expect(decodeRelayAuthCredential("")).toBeUndefined();
	});
});
