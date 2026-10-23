import { describe, expect, it } from "vitest";
import { bytesToBase64Url } from "./bytes.js";
import { generateDeviceKeyPair } from "./keys.js";
import {
	decodeStoredPairingOffer,
	encodeStoredPairingOffer,
} from "./offer-file.js";
import { createPairingOffer } from "./pairing.js";

const identity = generateDeviceKeyPair();

function offer(overrides: Record<string, unknown> = {}) {
	const created = createPairingOffer({
		hubPublicKey: identity.publicKey,
		hubName: "Examples MacBook Pro",
		url: "ws://127.0.0.1:25463/hub",
		ttlMs: 120_000,
		now: () => 1_800_000_000_000,
		sessionId: "sess_1",
	});
	return { ...created.offer, ...overrides };
}

describe("stored pairing offer", () => {
	it("round-trips every field the hub needs to complete the handshake", () => {
		const original = offer();
		const decoded = decodeStoredPairingOffer(
			encodeStoredPairingOffer(original),
		);
		expect(decoded).toEqual(original);
	});

	it("omits sessionId when the offer pinned none", () => {
		const { sessionId: _dropped, ...withoutSession } = offer();
		const text = encodeStoredPairingOffer(withoutSession);
		expect(text).not.toContain("sessionId");
		expect(decodeStoredPairingOffer(text).sessionId).toBeUndefined();
	});

	it("refuses a damaged or hostile file rather than half-trusting it", () => {
		expect(() => decodeStoredPairingOffer("{")).toThrow(/not JSON/);
		expect(() => decodeStoredPairingOffer("[]")).toThrow(/not a JSON object/);
		const good = JSON.parse(encodeStoredPairingOffer(offer())) as Record<
			string,
			unknown
		>;
		expect(() =>
			decodeStoredPairingOffer(JSON.stringify({ ...good, version: 2 })),
		).toThrow(/unsupported version 2/);
		expect(() =>
			decodeStoredPairingOffer(JSON.stringify({ ...good, offerId: "" })),
		).toThrow(/has no offerId/);
		expect(() =>
			decodeStoredPairingOffer(
				JSON.stringify({
					...good,
					// A short key would otherwise surface as an opaque handshake failure.
					hubPublicKey: bytesToBase64Url(new Uint8Array(16)),
				}),
			),
		).toThrow(/hubPublicKey is 16 bytes, expected 32/);
		expect(() =>
			decodeStoredPairingOffer(
				JSON.stringify({
					...good,
					oneTimeSecret: bytesToBase64Url(new Uint8Array(8)),
				}),
			),
		).toThrow(/oneTimeSecret is 8 bytes, expected 32/);
		// A NaN/absent expiry must not read as "never expires".
		expect(() =>
			decodeStoredPairingOffer(JSON.stringify({ ...good, expiresAt: "soon" })),
		).toThrow(/no usable expiry/);
		expect(() =>
			decodeStoredPairingOffer(JSON.stringify({ ...good, expiresAt: 1.5 })),
		).toThrow(/no usable expiry/);
		expect(() =>
			decodeStoredPairingOffer(JSON.stringify({ ...good, sessionId: 7 })),
		).toThrow(/malformed sessionId/);
	});

	it("never persists anything a reader could mistake for the hub private key", () => {
		expect(encodeStoredPairingOffer(offer())).not.toContain("privateKey");
	});
});
