/**
 * Adversarial tests for the QR pairing ceremony.
 *
 * Every test here names the attacker and what it is assumed to know. The
 * baseline attacker is "the relay / anyone holding a valid Cline account token":
 * it sees the URL and every byte on the wire, but it never saw the QR.
 */
import { describe, expect, it } from "vitest";
import {
	deterministicRandom,
	FIXED_NOW,
	pairFixture,
	registryWith,
} from "./__tests__/support.js";
import { bytesEqual, bytesToBase64Url, utf8ToBytes } from "./bytes.js";
import {
	AttestationRejectedError,
	PairingOfferConsumedError,
	PairingOfferExpiredError,
	PairingUriError,
	ProtocolVersionError,
	SessionReplayError,
} from "./errors.js";
import {
	deviceFingerprint,
	deviceIdFromPublicKey,
	generateDeviceKeyPair,
} from "./keys.js";
import {
	acceptDeviceSession,
	acceptPairingOffer,
	completePairing,
	createHubPairingSession,
	createPairingOffer,
	decodeHandoffUri,
	decodePairingUri,
	encodeHandoffUri,
	encodePairingUri,
	HANDOFF_URI_HOST,
	HANDOFF_URI_SCHEME,
	PAIRING_PROTOCOL_VERSION,
	startDeviceSession,
} from "./pairing.js";
import { createInMemoryDeviceStore, DeviceRegistry } from "./registry.js";

const HUB_NAME = "test-laptop";
const HUB_URL = "wss://relay.cline.bot/hub/abc";
// Shaped like a real hub token: `randomBytes(32).toString("hex")`.
const HUB_TOKEN = "63baaf16".repeat(8);

function freshOffer(overrides: { now?: number; ttlMs?: number } = {}) {
	const hubKeyPair = generateDeviceKeyPair(deterministicRandom("hub-static"));
	const created = createPairingOffer({
		hubPublicKey: hubKeyPair.publicKey,
		hubName: HUB_NAME,
		url: HUB_URL,
		ttlMs: overrides.ttlMs,
		now: () => overrides.now ?? FIXED_NOW,
		random: deterministicRandom("offer"),
	});
	return { hubKeyPair, ...created };
}

describe("pairing offer + QR URI", () => {
	it("rejects invalid offer TTLs before they reach a URI", () => {
		const hubKeyPair = generateDeviceKeyPair(deterministicRandom("ttl-hub"));
		for (const ttlMs of [Number.NaN, 0, -1, 1.5]) {
			expect(() =>
				createPairingOffer({
					hubPublicKey: hubKeyPair.publicKey,
					hubName: HUB_NAME,
					url: HUB_URL,
					ttlMs,
				}),
			).toThrow(PairingUriError);
		}
	});
	it("round-trips an offer through the QR URI unchanged", () => {
		const { offer, uri } = freshOffer();
		const decoded = decodePairingUri(uri);
		expect(decoded.version).toBe(PAIRING_PROTOCOL_VERSION);
		expect(decoded.offerId).toBe(offer.offerId);
		expect(decoded.hubName).toBe(HUB_NAME);
		expect(decoded.url).toBe(HUB_URL);
		expect(decoded.expiresAt).toBe(offer.expiresAt);
		expect(bytesEqual(decoded.hubPublicKey, offer.hubPublicKey)).toBe(true);
		expect(bytesEqual(decoded.oneTimeSecret, offer.oneTimeSecret)).toBe(true);
	});

	it("uses a 256-bit one-time secret and defaults to a 60s expiry", () => {
		const { offer, oneTimeSecret, expiresAt } = freshOffer();
		expect(oneTimeSecret.length).toBe(32);
		expect(offer.oneTimeSecret.length).toBe(32);
		expect(expiresAt - FIXED_NOW).toBe(60_000);
	});

	it("gives every offer a distinct secret and id", () => {
		const hubKeyPair = generateDeviceKeyPair(deterministicRandom("hub-static"));
		const make = (seed: string) =>
			createPairingOffer({
				hubPublicKey: hubKeyPair.publicKey,
				hubName: HUB_NAME,
				url: HUB_URL,
				now: () => FIXED_NOW,
				random: deterministicRandom(seed),
			});
		const first = make("offer-a");
		const second = make("offer-b");
		expect(first.offer.offerId).not.toBe(second.offer.offerId);
		expect(
			bytesEqual(first.offer.oneTimeSecret, second.offer.oneTimeSecret),
		).toBe(false);
	});

	it("rejects a URI that is not a Cline pairing URI", () => {
		expect(() => decodePairingUri("https://evil.example/pair")).toThrow(
			PairingUriError,
		);
		expect(() => decodePairingUri("cline-pairing://v1?i=x")).toThrow(
			PairingUriError,
		);
	});

	it("ATTACK: version downgrade in the URI is refused, not best-effort parsed", () => {
		const { uri } = freshOffer();
		const downgraded = uri.replace("://v1?", "://v0?");
		const upgraded = uri.replace("://v1?", "://v2?");
		expect(() => decodePairingUri(downgraded)).toThrow(ProtocolVersionError);
		expect(() => decodePairingUri(upgraded)).toThrow(ProtocolVersionError);
	});

	it("ATTACK: a truncated hub key or secret in the URI is refused", () => {
		const { offer } = freshOffer();
		const shortKey = encodePairingUri({
			...offer,
			hubPublicKey: offer.hubPublicKey.subarray(0, 16),
		});
		expect(() => decodePairingUri(shortKey)).toThrow(PairingUriError);

		const shortSecret = encodePairingUri({
			...offer,
			oneTimeSecret: offer.oneTimeSecret.subarray(0, 8),
		});
		expect(() => decodePairingUri(shortSecret)).toThrow(PairingUriError);
	});

	it("rejects a URI missing required fields", () => {
		expect(() => decodePairingUri("cline-pair://v1?i=abc&k=abc")).toThrow(
			PairingUriError,
		);
	});
});

/**
 * The handoff URI is the shared contract with the mobile app: the laptop mints it
 * when the user walks away from the keyboard, so it must decode with the same
 * function the phone already uses for `cline-pair://`.
 */
describe("handoff URI (clinecode:// scheme)", () => {
	it("encodes the exact contract shape the mobile app parses", () => {
		const { offer } = freshOffer();
		const uri = encodeHandoffUri({
			version: 1,
			hubPublicKey: offer.hubPublicKey,
			hubName: HUB_NAME,
			url: HUB_URL,
			credential: HUB_TOKEN,
			expiresAt: offer.expiresAt,
			sessionId: "sess_123",
		});
		expect(uri.startsWith(`${HANDOFF_URI_SCHEME}://${HANDOFF_URI_HOST}?`)).toBe(
			true,
		);
		const params = new URLSearchParams(uri.slice(uri.indexOf("?") + 1));
		expect(params.get("v")).toBe("1");
		expect(params.get("k")).toBe(bytesToBase64Url(offer.hubPublicKey));
		// `s` is the hub's own auth token, verbatim: the phone presents it as
		// `cline-hub-auth.<token>`, so re-encoding it would break authentication.
		expect(params.get("s")).toBe(HUB_TOKEN);
		// The url travels base64url so a QR scanner cannot mangle it and so the
		// payload has no nested percent-encoding.
		expect(params.get("u")).toBe(bytesToBase64Url(utf8ToBytes(HUB_URL)));
		expect(params.get("n")).toBe(HUB_NAME);
		expect(params.get("e")).toBe(String(offer.expiresAt));
		expect(params.get("sid")).toBe("sess_123");
		// A v1 link has no pairing offer behind it, so it carries no offer id.
		expect(params.get("i")).toBeNull();
		// Deep-link routers read `+` as a space, so we never emit one.
		expect(uri).not.toContain("+");
	});

	it("round-trips a v1 token link", () => {
		const { offer } = freshOffer();
		const link = {
			version: 1,
			hubPublicKey: offer.hubPublicKey,
			hubName: "Example's MacBook Pro",
			url: HUB_URL,
			credential: HUB_TOKEN,
			expiresAt: offer.expiresAt,
			sessionId: "session_1700000000000_fixture",
		};
		expect(decodeHandoffUri(encodeHandoffUri(link))).toEqual(link);
	});

	it("encodes spaces as %20, never as +", () => {
		const { offer } = freshOffer();
		const uri = encodeHandoffUri({
			version: 1,
			hubPublicKey: offer.hubPublicKey,
			hubName: "Example's MacBook Pro",
			url: HUB_URL,
			credential: HUB_TOKEN,
			expiresAt: offer.expiresAt,
		});
		expect(uri).toContain("n=Example%27s%20MacBook%20Pro");
		expect(decodeHandoffUri(uri).hubName).toBe("Example's MacBook Pro");
	});

	it("refuses to read a token link as a pairing offer", () => {
		const { offer } = freshOffer();
		const uri = encodeHandoffUri({
			version: 1,
			hubPublicKey: offer.hubPublicKey,
			hubName: HUB_NAME,
			url: HUB_URL,
			credential: HUB_TOKEN,
			expiresAt: offer.expiresAt,
		});
		expect(() => decodePairingUri(uri)).toThrow(/decodeHandoffUri/);
	});

	it("rejects a handoff link that is missing fields or has a bad key", () => {
		expect(() => decodeHandoffUri("clinecode://handoff?v=1&s=abc")).toThrow(
			PairingUriError,
		);
		expect(() => decodeHandoffUri("cline-pair://v1?i=a&k=b")).toThrow(
			PairingUriError,
		);
		const { offer } = freshOffer();
		const shortKey = encodeHandoffUri({
			version: 1,
			hubPublicKey: offer.hubPublicKey.subarray(0, 16),
			hubName: HUB_NAME,
			url: HUB_URL,
			credential: HUB_TOKEN,
			expiresAt: offer.expiresAt,
		});
		expect(() => decodeHandoffUri(shortKey)).toThrow(PairingUriError);
	});

	it("refuses a downgraded or upgraded handoff version", () => {
		const { offer } = freshOffer();
		const uri = encodeHandoffUri({
			version: 1,
			hubPublicKey: offer.hubPublicKey,
			hubName: HUB_NAME,
			url: HUB_URL,
			credential: HUB_TOKEN,
			expiresAt: offer.expiresAt,
		});
		expect(() => decodeHandoffUri(uri.replace("v=1", "v=2"))).toThrow(
			ProtocolVersionError,
		);
		expect(() => decodeHandoffUri(uri.replace("v=1", "v=0"))).toThrow(
			ProtocolVersionError,
		);
		expect(() => decodeHandoffUri(uri.replace("v=1", "v=1junk"))).toThrow(
			PairingUriError,
		);
		expect(() => decodeHandoffUri(uri.replace(/e=\d+/, "e=123junk"))).toThrow(
			PairingUriError,
		);
	});

	it("round-trips the session id so the phone lands in this session", () => {
		const { offer } = freshOffer();
		const uri = encodePairingUri(
			{ ...offer, sessionId: "sess_abc-123" },
			{ format: "handoff" },
		);
		const decoded = decodePairingUri(uri);
		expect(decoded.sessionId).toBe("sess_abc-123");
		expect(decoded.url).toBe(HUB_URL);
		expect(decoded.hubName).toBe(HUB_NAME);
		expect(decoded.offerId).toBe(offer.offerId);
		expect(decoded.expiresAt).toBe(offer.expiresAt);
		expect(bytesEqual(decoded.hubPublicKey, offer.hubPublicKey)).toBe(true);
		expect(bytesEqual(decoded.oneTimeSecret, offer.oneTimeSecret)).toBe(true);
	});

	it("omits sid when there is no session to hand off", () => {
		const { offer } = freshOffer();
		const uri = encodePairingUri(offer, { format: "handoff" });
		expect(uri).not.toContain("sid=");
		expect(decodePairingUri(uri).sessionId).toBeUndefined();
	});

	it("decodes both accepted schemes to the same offer", () => {
		const { offer } = freshOffer();
		const withSession = { ...offer, sessionId: "sess_shared" };
		const fromPair = decodePairingUri(encodePairingUri(withSession));
		const fromHandoff = decodePairingUri(
			encodePairingUri(withSession, { format: "handoff" }),
		);
		expect(fromHandoff).toEqual(fromPair);
	});

	it("survives a machine name with spaces and punctuation", () => {
		const hubKeyPair = generateDeviceKeyPair(deterministicRandom("hub-static"));
		const { offer } = createPairingOffer({
			hubPublicKey: hubKeyPair.publicKey,
			hubName: "Example's MacBook Pro (16\")",
			url: "ws://127.0.0.1:8765/hub?token=abc&x=1",
			now: () => FIXED_NOW,
			random: deterministicRandom("offer"),
		});
		const decoded = decodePairingUri(
			encodePairingUri(offer, { format: "handoff" }),
		);
		expect(decoded.hubName).toBe("Example's MacBook Pro (16\")");
		expect(decoded.url).toBe("ws://127.0.0.1:8765/hub?token=abc&x=1");
	});

	it("ATTACK: version downgrade in the handoff URI is refused", () => {
		const { offer } = freshOffer();
		const uri = encodePairingUri(offer, { format: "handoff" });
		expect(() => decodePairingUri(uri.replace("v=1", "v=0"))).toThrow(
			ProtocolVersionError,
		);
		expect(() => decodePairingUri(uri.replace("v=1", "v=2"))).toThrow(
			ProtocolVersionError,
		);
	});

	it("ATTACK: a truncated secret in the handoff URI is refused", () => {
		const { offer } = freshOffer();
		const shortSecret = encodePairingUri(
			{ ...offer, oneTimeSecret: offer.oneTimeSecret.subarray(0, 8) },
			{ format: "handoff" },
		);
		expect(() => decodePairingUri(shortSecret)).toThrow(PairingUriError);
	});

	it("rejects a short or tampered handoff payload", () => {
		expect(() => decodePairingUri("clinecode://handoff?v=1")).toThrow(
			PairingUriError,
		);
		// Right scheme, wrong host: not a handoff.
		expect(() => decodePairingUri("clinecode://pair?v=1&k=a&s=b")).toThrow(
			PairingUriError,
		);
		const { offer } = freshOffer();
		const uri = encodePairingUri(offer, { format: "handoff" });
		expect(() => decodePairingUri(uri.replace("&u=", "&u=%%"))).toThrow(
			PairingUriError,
		);
	});

	it("hands the expired-offer decision to the existing expiry logic", () => {
		const { offer } = freshOffer({ ttlMs: 120_000 });
		const uri = encodePairingUri(
			{ ...offer, sessionId: "sess_late" },
			{ format: "handoff" },
		);
		const deviceKeyPair = generateDeviceKeyPair(deterministicRandom("dev"));
		expect(() =>
			acceptPairingOffer(uri, deviceKeyPair.privateKey, {
				now: () => FIXED_NOW + 120_001,
			}),
		).toThrow(PairingOfferExpiredError);
		// Still inside the window it is accepted.
		expect(
			acceptPairingOffer(uri, deviceKeyPair.privateKey, {
				now: () => FIXED_NOW + 119_000,
			}).attestation.offerId,
		).toBe(offer.offerId);
	});

	it("keeps the legacy cline-pair format byte-for-byte", () => {
		const { offer } = freshOffer();
		const legacy = encodePairingUri(offer);
		expect(legacy).toBe(
			`cline-pair://v1?i=${encodeURIComponent(offer.offerId)}` +
				`&k=${encodeURIComponent(bytesToBase64Url(offer.hubPublicKey))}` +
				`&s=${encodeURIComponent(bytesToBase64Url(offer.oneTimeSecret))}` +
				`&u=${encodeURIComponent(HUB_URL)}` +
				`&n=${encodeURIComponent(HUB_NAME)}` +
				`&e=${offer.expiresAt}`,
		);
		// An offer minted without a session id is unchanged by the new field.
		expect(legacy).toBe(freshOffer().uri);
	});

	it("carries the session id through the legacy format too", () => {
		const { offer } = freshOffer();
		const uri = encodePairingUri({ ...offer, sessionId: "sess_legacy" });
		expect(uri.startsWith("cline-pair://v1?")).toBe(true);
		expect(decodePairingUri(uri).sessionId).toBe("sess_legacy");
	});

	it("threads a session id from createPairingOffer to the handoff URI", () => {
		const hubKeyPair = generateDeviceKeyPair(deterministicRandom("hub-static"));
		const created = createPairingOffer({
			hubPublicKey: hubKeyPair.publicKey,
			hubName: HUB_NAME,
			url: HUB_URL,
			sessionId: "sess_from_input",
			now: () => FIXED_NOW,
			random: deterministicRandom("offer"),
		});
		expect(created.offer.sessionId).toBe("sess_from_input");
		expect(
			decodePairingUri(encodePairingUri(created.offer, { format: "handoff" }))
				.sessionId,
		).toBe("sess_from_input");
	});
});

describe("pairing ceremony happy path", () => {
	it("establishes a channel and both sides pin the other's key", () => {
		const fixture = pairFixture();
		// The hub learned the device's real static key.
		expect(fixture.deviceFingerprint).toBe(
			deviceFingerprint(fixture.deviceKeyPair.publicKey),
		);
		// The phone pinned the hub's real static key.
		expect(fixture.hubFingerprint).toBe(
			deviceFingerprint(fixture.hubKeyPair.publicKey),
		);
		expect(
			bytesEqual(
				fixture.hubChannel.peerPublicKey as Uint8Array,
				fixture.deviceKeyPair.publicKey,
			),
		).toBe(true);
		expect(
			bytesEqual(
				fixture.deviceChannel.peerPublicKey as Uint8Array,
				fixture.hubKeyPair.publicKey,
			),
		).toBe(true);
	});

	it("agrees on the handshake transcript hash on both sides", () => {
		const fixture = pairFixture();
		expect(
			bytesEqual(
				fixture.hubChannel.handshakeHash as Uint8Array,
				fixture.deviceChannel.handshakeHash as Uint8Array,
			),
		).toBe(true);
	});

	it("carries the device label and platform to the hub", () => {
		const hubKeyPair = generateDeviceKeyPair(deterministicRandom("hub-static"));
		const deviceKeyPair = generateDeviceKeyPair(deterministicRandom("dev"));
		const { offer } = createPairingOffer({
			hubPublicKey: hubKeyPair.publicKey,
			hubName: HUB_NAME,
			url: HUB_URL,
			now: () => FIXED_NOW,
			random: deterministicRandom("offer"),
		});
		const session = createHubPairingSession(offer, hubKeyPair.privateKey);
		const pending = acceptPairingOffer(offer, deviceKeyPair.privateKey, {
			metadata: { label: "Pixel 9", platform: "android" },
			now: () => FIXED_NOW,
		});
		const completed = completePairing(session, pending.attestation, {
			now: () => FIXED_NOW,
		});
		expect(completed.device.label).toBe("Pixel 9");
		expect(completed.device.platform).toBe("android");
	});
});

describe("pairing ceremony under attack", () => {
	it("ATTACK: expired offer is rejected by the phone", () => {
		const { offer } = freshOffer({ ttlMs: 60_000 });
		const deviceKeyPair = generateDeviceKeyPair(deterministicRandom("dev"));
		expect(() =>
			acceptPairingOffer(offer, deviceKeyPair.privateKey, {
				now: () => FIXED_NOW + 60_001,
			}),
		).toThrow(PairingOfferExpiredError);
	});

	it("ATTACK: expired offer is rejected by the hub even with a valid attestation", () => {
		const { hubKeyPair, offer } = freshOffer({ ttlMs: 60_000 });
		const deviceKeyPair = generateDeviceKeyPair(deterministicRandom("dev"));
		const session = createHubPairingSession(offer, hubKeyPair.privateKey);
		// Attestation minted while the offer was still live.
		const pending = acceptPairingOffer(offer, deviceKeyPair.privateKey, {
			now: () => FIXED_NOW,
		});
		expect(() =>
			session.complete(pending.attestation, { now: () => FIXED_NOW + 60_001 }),
		).toThrow(PairingOfferExpiredError);
	});

	it("ATTACK: stepping the laptop clock backwards does not extend the offer TTL", () => {
		const { hubKeyPair, offer } = freshOffer({ ttlMs: 60_000 });
		const deviceKeyPair = generateDeviceKeyPair(deterministicRandom("dev"));
		const pending = acceptPairingOffer(offer, deviceKeyPair.privateKey, {
			now: () => FIXED_NOW,
		});
		let monotonic = 0;
		const wall = () => FIXED_NOW;
		const session = createHubPairingSession(offer, hubKeyPair.privateKey, {
			now: wall,
			monotonic: () => monotonic,
		});
		// An hour of real time passes while the wall clock is held/stepped back so it
		// still reads inside the window.
		monotonic = 3_600_000;
		expect(() => session.complete(pending.attestation, { now: wall })).toThrow(
			PairingOfferExpiredError,
		);

		// Without a monotonic source that is exactly the hole: the wall clock alone
		// happily accepts it.
		const wallOnly = createHubPairingSession(offer, hubKeyPair.privateKey, {
			now: wall,
			monotonic: null,
		});
		expect(
			wallOnly.complete(pending.attestation, { now: wall }).device.deviceId,
		).toBeTruthy();
	});

	it("ATTACK: the one-time secret is single use — a replayed attestation is refused", () => {
		const { hubKeyPair, offer } = freshOffer();
		const deviceKeyPair = generateDeviceKeyPair(deterministicRandom("dev"));
		const session = createHubPairingSession(offer, hubKeyPair.privateKey);
		const pending = acceptPairingOffer(offer, deviceKeyPair.privateKey, {
			now: () => FIXED_NOW,
		});
		// First use succeeds.
		expect(
			session.complete(pending.attestation, { now: () => FIXED_NOW }).device
				.deviceId,
		).toBeTruthy();
		expect(session.consumed).toBe(true);
		// Byte-identical replay of the captured message 1 must not enroll again.
		expect(() =>
			session.complete(pending.attestation, { now: () => FIXED_NOW }),
		).toThrow(PairingOfferConsumedError);
	});

	it("ATTACK: a second, different device cannot reuse a consumed offer", () => {
		const { hubKeyPair, offer } = freshOffer();
		const session = createHubPairingSession(offer, hubKeyPair.privateKey);
		const first = acceptPairingOffer(
			offer,
			generateDeviceKeyPair(deterministicRandom("dev-1")).privateKey,
			{ now: () => FIXED_NOW },
		);
		session.complete(first.attestation, { now: () => FIXED_NOW });

		const second = acceptPairingOffer(
			offer,
			generateDeviceKeyPair(deterministicRandom("dev-2")).privateKey,
			{ now: () => FIXED_NOW },
		);
		expect(() =>
			session.complete(second.attestation, { now: () => FIXED_NOW }),
		).toThrow(PairingOfferConsumedError);
	});

	it("ATTACK: forged attestation from an attacker who never saw the QR is rejected", () => {
		const { hubKeyPair, offer } = freshOffer();
		const session = createHubPairingSession(offer, hubKeyPair.privateKey);

		// The attacker knows everything except the one-time secret: the hub's static
		// public key, the URL, the hub name, the offer id and the expiry. That is
		// exactly what a relay operator or account-token holder can see.
		const attackerOffer = {
			...offer,
			oneTimeSecret: new Uint8Array(32).fill(0xab),
		};
		const attacker = acceptPairingOffer(
			attackerOffer,
			generateDeviceKeyPair(deterministicRandom("attacker")).privateKey,
			{ now: () => FIXED_NOW },
		);

		expect(() =>
			session.complete(attacker.attestation, { now: () => FIXED_NOW }),
		).toThrow(AttestationRejectedError);
		// A rejected forgery must not burn the user's offer.
		expect(session.consumed).toBe(false);
	});

	it("ATTACK: MITM substituting its own hub public key cannot complete pairing", () => {
		const { hubKeyPair, offer } = freshOffer();
		const mitmKeyPair = generateDeviceKeyPair(deterministicRandom("mitm"));

		// The relay rewrites the QR payload so the phone talks to the attacker's key.
		const tamperedOffer = { ...offer, hubPublicKey: mitmKeyPair.publicKey };
		const deviceKeyPair = generateDeviceKeyPair(deterministicRandom("dev"));
		const pending = acceptPairingOffer(
			tamperedOffer,
			deviceKeyPair.privateKey,
			{
				now: () => FIXED_NOW,
			},
		);

		// The real hub cannot read a handshake aimed at someone else's static key.
		const session = createHubPairingSession(offer, hubKeyPair.privateKey);
		expect(() =>
			session.complete(pending.attestation, { now: () => FIXED_NOW }),
		).toThrow(AttestationRejectedError);
	});

	it("ATTACK: MITM cannot re-encrypt the phone's message to the real hub", () => {
		// The MITM here is the relay: it sees every byte of message 1 but never saw
		// the QR, so it holds neither the one-time secret nor the hub private key.
		const { hubKeyPair, offer } = freshOffer();
		const mitmKeyPair = generateDeviceKeyPair(deterministicRandom("mitm"));
		const deviceKeyPair = generateDeviceKeyPair(deterministicRandom("dev"));
		const now = () => FIXED_NOW;

		// The phone scans the GENUINE code: it pins the real hub key.
		const pending = acceptPairingOffer(offer, deviceKeyPair.privateKey, {
			now,
		});

		// 1. The MITM cannot open message 1 to re-encrypt it: doing so needs the hub
		//    static private key, and the transcript is bound to the QR secret.
		const asItself = createHubPairingSession(
			{ ...offer, hubPublicKey: mitmKeyPair.publicKey },
			mitmKeyPair.privateKey,
			{ now },
		);
		expect(() => asItself.complete(pending.attestation, { now })).toThrow(
			AttestationRejectedError,
		);

		// 2. Nor can it splice its own static key into the message and pass that on:
		//    the encrypted static field is authenticated by the transcript.
		const forged = pending.attestation.message.slice();
		forged.set(mitmKeyPair.publicKey, 32);
		const spliced = createHubPairingSession(offer, hubKeyPair.privateKey, {
			now,
		});
		expect(() =>
			spliced.complete({ ...pending.attestation, message: forged }, { now }),
		).toThrow(AttestationRejectedError);

		// 3. Passing the bytes through untouched is all it can do — and that enrolls
		//    the PHONE's key, on a channel whose keys the MITM cannot derive.
		const realSession = createHubPairingSession(offer, hubKeyPair.privateKey, {
			now,
		});
		const completed = realSession.complete(pending.attestation, { now });
		expect(completed.device.deviceId).toBe(
			deviceIdFromPublicKey(deviceKeyPair.publicKey),
		);
		expect(completed.device.deviceId).not.toBe(
			deviceIdFromPublicKey(mitmKeyPair.publicKey),
		);
		expect(
			bytesEqual(
				completed.channel.peerPublicKey as Uint8Array,
				mitmKeyPair.publicKey,
			),
		).toBe(false);
		// And the MITM cannot complete the device half either: that needs the QR
		// secret to have been in its transcript.
		const mitmDevice = acceptPairingOffer(offer, mitmKeyPair.privateKey, {
			now,
			// A relay that guesses the secret wrong gets nowhere.
			metadata: { label: "relay" },
		});
		expect(() => mitmDevice.complete(completed.response)).toThrow();
	});

	it("ATTACK: rewriting the relay URL in the QR breaks the transcript binding", () => {
		const { hubKeyPair, offer } = freshOffer();
		const deviceKeyPair = generateDeviceKeyPair(deterministicRandom("dev"));

		// Same key, same secret, but the phone was pointed at an attacker-chosen URL.
		const rerouted = { ...offer, url: "wss://evil.example/hub/abc" };
		const pending = acceptPairingOffer(rerouted, deviceKeyPair.privateKey, {
			now: () => FIXED_NOW,
		});

		const session = createHubPairingSession(offer, hubKeyPair.privateKey);
		expect(() =>
			session.complete(pending.attestation, { now: () => FIXED_NOW }),
		).toThrow(AttestationRejectedError);
	});

	it("ATTACK: rewriting the hub name in the QR breaks the transcript binding", () => {
		const { hubKeyPair, offer } = freshOffer();
		const deviceKeyPair = generateDeviceKeyPair(deterministicRandom("dev"));
		const pending = acceptPairingOffer(
			{ ...offer, hubName: "not-test-laptop" },
			deviceKeyPair.privateKey,
			{ now: () => FIXED_NOW },
		);
		const session = createHubPairingSession(offer, hubKeyPair.privateKey);
		expect(() =>
			session.complete(pending.attestation, { now: () => FIXED_NOW }),
		).toThrow(AttestationRejectedError);
	});

	it("ATTACK: every single-byte tamper of the attestation is rejected", () => {
		const { hubKeyPair, offer } = freshOffer();
		const deviceKeyPair = generateDeviceKeyPair(deterministicRandom("dev"));
		const pending = acceptPairingOffer(offer, deviceKeyPair.privateKey, {
			now: () => FIXED_NOW,
		});

		for (
			let index = 0;
			index < pending.attestation.message.length;
			index += 1
		) {
			const tampered = pending.attestation.message.slice();
			tampered[index] = (tampered[index] as number) ^ 0x01;
			const session = createHubPairingSession(offer, hubKeyPair.privateKey);
			expect(() =>
				session.complete(
					{ ...pending.attestation, message: tampered },
					{ now: () => FIXED_NOW },
				),
			).toThrow(AttestationRejectedError);
		}
	});

	it("ATTACK: a truncated attestation is rejected", () => {
		const { hubKeyPair, offer } = freshOffer();
		const deviceKeyPair = generateDeviceKeyPair(deterministicRandom("dev"));
		const pending = acceptPairingOffer(offer, deviceKeyPair.privateKey, {
			now: () => FIXED_NOW,
		});
		const session = createHubPairingSession(offer, hubKeyPair.privateKey);
		expect(() =>
			session.complete(
				{
					...pending.attestation,
					message: pending.attestation.message.subarray(0, 16),
				},
				{ now: () => FIXED_NOW },
			),
		).toThrow(AttestationRejectedError);
	});

	it("ATTACK: an attestation minted for a different offer id is rejected", () => {
		const { hubKeyPair, offer } = freshOffer();
		const deviceKeyPair = generateDeviceKeyPair(deterministicRandom("dev"));
		const pending = acceptPairingOffer(offer, deviceKeyPair.privateKey, {
			now: () => FIXED_NOW,
		});
		const session = createHubPairingSession(offer, hubKeyPair.privateKey);
		expect(() =>
			session.complete(
				{ ...pending.attestation, offerId: "someone-elses-offer" },
				{ now: () => FIXED_NOW },
			),
		).toThrow(AttestationRejectedError);
	});

	it("ATTACK: a downgraded protocol version on the attestation is refused", () => {
		const { hubKeyPair, offer } = freshOffer();
		const deviceKeyPair = generateDeviceKeyPair(deterministicRandom("dev"));
		const pending = acceptPairingOffer(offer, deviceKeyPair.privateKey, {
			now: () => FIXED_NOW,
		});
		const session = createHubPairingSession(offer, hubKeyPair.privateKey);
		expect(() =>
			session.complete(
				{ ...pending.attestation, version: 0 },
				{ now: () => FIXED_NOW },
			),
		).toThrow(ProtocolVersionError);
	});

	it("ATTACK: a forged hub response cannot make the phone pin an attacker key", () => {
		const { hubKeyPair, offer } = freshOffer();
		const deviceKeyPair = generateDeviceKeyPair(deterministicRandom("dev"));
		const pending = acceptPairingOffer(offer, deviceKeyPair.privateKey, {
			now: () => FIXED_NOW,
		});
		// The relay answers with its own handshake instead of forwarding the hub's.
		const mitmKeyPair = generateDeviceKeyPair(deterministicRandom("mitm"));
		const mitmSession = createHubPairingSession(
			{ ...offer, hubPublicKey: mitmKeyPair.publicKey },
			mitmKeyPair.privateKey,
		);
		const forged = mitmSession.complete(
			acceptPairingOffer(
				{ ...offer, hubPublicKey: mitmKeyPair.publicKey },
				generateDeviceKeyPair(deterministicRandom("other")).privateKey,
				{ now: () => FIXED_NOW },
			).attestation,
			{ now: () => FIXED_NOW },
		);
		expect(() => pending.complete(forged.response)).toThrow(
			AttestationRejectedError,
		);
		void hubKeyPair;
	});
});

describe("reconnection sessions", () => {
	it("authenticates a paired device against the registry", async () => {
		const fixture = pairFixture();
		const registry = await registryWith();
		await registry.add({
			publicKey: fixture.deviceKeyPair.publicKey,
			label: "Example's iPhone",
		});

		const pending = startDeviceSession({
			devicePrivateKey: fixture.deviceKeyPair.privateKey,
			hubPublicKey: fixture.hubKeyPair.publicKey,
		});
		const accepted = acceptDeviceSession({
			hubPrivateKey: fixture.hubKeyPair.privateKey,
			registry,
			message: pending.message,
		});
		expect(accepted.device.deviceId).toBe(fixture.deviceId);

		const finished = pending.complete(accepted.message);
		// Fresh session keys work end to end in both directions.
		expect(
			finished.channel.decryptFrame(accepted.channel.encryptFrame({ ping: 1 })),
		).toEqual({ ping: 1 });
		expect(
			accepted.channel.decryptFrame(finished.channel.encryptFrame({ pong: 2 })),
		).toEqual({ pong: 2 });
	});

	it("derives different session keys on every reconnection", async () => {
		const fixture = pairFixture();
		const registry = await registryWith();
		await registry.add({
			publicKey: fixture.deviceKeyPair.publicKey,
			label: "phone",
		});
		const hashes = new Set<string>();
		for (let attempt = 0; attempt < 3; attempt += 1) {
			const pending = startDeviceSession({
				devicePrivateKey: fixture.deviceKeyPair.privateKey,
				hubPublicKey: fixture.hubKeyPair.publicKey,
			});
			const accepted = acceptDeviceSession({
				hubPrivateKey: fixture.hubKeyPair.privateKey,
				registry,
				message: pending.message,
			});
			hashes.add(bytesToBase64Url(accepted.handshakeHash));
		}
		// Ephemerals make each session unique, so transport keys are never reused.
		expect(hashes.size).toBe(3);
	});

	it("ATTACK: an unpaired device key is rejected even with a valid handshake", async () => {
		const fixture = pairFixture();
		const registry = await registryWith();
		const stranger = generateDeviceKeyPair(deterministicRandom("stranger"));
		const pending = startDeviceSession({
			devicePrivateKey: stranger.privateKey,
			hubPublicKey: fixture.hubKeyPair.publicKey,
		});
		// The handshake itself is cryptographically fine; authorisation is what fails.
		expect(() =>
			acceptDeviceSession({
				hubPrivateKey: fixture.hubKeyPair.privateKey,
				registry,
				message: pending.message,
			}),
		).toThrow(/Unknown device/);
	});

	it("ATTACK: a phone pinning the wrong hub key cannot connect", async () => {
		const fixture = pairFixture();
		const registry = await registryWith();
		await registry.add({
			publicKey: fixture.deviceKeyPair.publicKey,
			label: "phone",
		});
		const impostor = generateDeviceKeyPair(deterministicRandom("impostor"));
		const pending = startDeviceSession({
			devicePrivateKey: fixture.deviceKeyPair.privateKey,
			hubPublicKey: impostor.publicKey,
		});
		expect(() =>
			acceptDeviceSession({
				hubPrivateKey: fixture.hubKeyPair.privateKey,
				registry,
				message: pending.message,
			}),
		).toThrow(AttestationRejectedError);
	});

	it("ATTACK: a replayed reconnection message 1 does not yield a usable channel", async () => {
		const fixture = pairFixture();
		const registry = await registryWith();
		await registry.add({
			publicKey: fixture.deviceKeyPair.publicKey,
			label: "phone",
		});
		const pending = startDeviceSession({
			devicePrivateKey: fixture.deviceKeyPair.privateKey,
			hubPublicKey: fixture.hubKeyPair.publicKey,
		});
		const first = acceptDeviceSession({
			hubPrivateKey: fixture.hubKeyPair.privateKey,
			registry,
			message: pending.message,
		});
		// The relay resends the exact bytes it captured. No channel comes back at
		// all: unlimited hub-side sessions are a resource and eviction problem even
		// though the attacker can never derive the transport keys.
		expect(() =>
			acceptDeviceSession({
				hubPrivateKey: fixture.hubKeyPair.privateKey,
				registry,
				message: pending.message,
			}),
		).toThrow(SessionReplayError);
		// The genuine session it captured is untouched by the attempt.
		expect(first.channel.closed).toBe(false);
		const genuine = first.channel.encryptFrame({ secret: "payload" });
		expect(genuine.length).toBeGreaterThan(0);
	});

	it("dedup is bounded: a replay outside the window is accepted again", async () => {
		// Documented limitation of the dedup window: a Noise IK message 1 carries no
		// timestamp, so remembering every one forever would be unbounded memory.
		const fixture = pairFixture();
		let clock = FIXED_NOW;
		const registry = await DeviceRegistry.open(createInMemoryDeviceStore(), {
			now: () => clock,
			sessionReplayWindowMs: 1_000,
		});
		await registry.add({
			publicKey: fixture.deviceKeyPair.publicKey,
			label: "phone",
		});
		const pending = startDeviceSession({
			devicePrivateKey: fixture.deviceKeyPair.privateKey,
			hubPublicKey: fixture.hubKeyPair.publicKey,
		});
		const accept = () =>
			acceptDeviceSession({
				hubPrivateKey: fixture.hubKeyPair.privateKey,
				registry,
				message: pending.message,
			});
		accept();
		expect(accept).toThrow(SessionReplayError);
		clock += 1_001;
		expect(accept).not.toThrow();
	});
});
