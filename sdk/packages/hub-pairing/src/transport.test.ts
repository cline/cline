import { describe, expect, it } from "vitest";
import { bytesToBase64Url } from "./bytes.js";
import {
	decodeDeviceBeginFrame,
	decodeDeviceOkFrame,
	decodePairAttestFrame,
	decodePairOkFrame,
	decodeSecureDataFrame,
	encodeDeviceBeginFrame,
	encodeDeviceOkFrame,
	encodeHandshakeErrorFrame,
	encodePairAttestFrame,
	encodePairOkFrame,
	encodeSecureDataFrame,
	HUB_DEVICE_ERROR_FRAME,
	HUB_DEVICE_SUBPROTOCOL,
	HUB_PAIR_SUBPROTOCOL_PREFIX,
	hasDeviceSubprotocol,
	isValidOfferId,
	readHandshakeErrorFrame,
	readPairSubprotocolOfferId,
} from "./transport.js";

const MESSAGE = new Uint8Array(Array.from({ length: 48 }, (_, i) => i));
const KEY = new Uint8Array(32).fill(7);

describe("pairing subprotocol parsing", () => {
	it("reads the offer id out of a cline-hub-pair subprotocol", () => {
		expect(
			readPairSubprotocolOfferId(`${HUB_PAIR_SUBPROTOCOL_PREFIX}abcDEF-_123`),
		).toBe("abcDEF-_123");
		// Header form: a comma-joined list, possibly alongside other protocols.
		expect(
			readPairSubprotocolOfferId(
				`something-else, ${HUB_PAIR_SUBPROTOCOL_PREFIX}offer1 `,
			),
		).toBe("offer1");
		expect(
			readPairSubprotocolOfferId(["x", `${HUB_PAIR_SUBPROTOCOL_PREFIX}offer2`]),
		).toBe("offer2");
	});

	it("refuses an offer id that could address a path", () => {
		// This value becomes a file name inside the offers directory, so traversal
		// and separators must never survive parsing.
		for (const hostile of [
			"../../../etc/passwd",
			"a/b",
			"a\\b",
			"..",
			".",
			"a.json",
			"a b",
			"",
			"x".repeat(65),
		]) {
			expect(
				readPairSubprotocolOfferId(`${HUB_PAIR_SUBPROTOCOL_PREFIX}${hostile}`),
			).toBeUndefined();
			expect(isValidOfferId(hostile)).toBe(false);
		}
	});

	it("recognises the returning-device subprotocol exactly", () => {
		expect(hasDeviceSubprotocol(HUB_DEVICE_SUBPROTOCOL)).toBe(true);
		expect(hasDeviceSubprotocol(`a, ${HUB_DEVICE_SUBPROTOCOL}`)).toBe(true);
		expect(hasDeviceSubprotocol("cline-hub-device.v1")).toBe(false);
		expect(hasDeviceSubprotocol("cline-hub-device")).toBe(false);
		expect(hasDeviceSubprotocol(undefined)).toBe(false);
	});
});

describe("handshake frames", () => {
	it("round-trips the pairing attestation", () => {
		const decoded = decodePairAttestFrame(
			encodePairAttestFrame({ offerId: "offer1", message: MESSAGE }),
		);
		expect(decoded.offerId).toBe("offer1");
		expect(decoded.message).toEqual(MESSAGE);
		expect(decoded.version).toBe(2);
	});

	it("round-trips the pairing acceptance", () => {
		const decoded = decodePairOkFrame(
			encodePairOkFrame({
				offerId: "offer1",
				message: MESSAGE,
				deviceId: "dev_1",
				hubName: "Examples MacBook Pro",
				hubPublicKey: KEY,
			}),
		);
		expect(decoded.deviceId).toBe("dev_1");
		expect(decoded.hubPublicKey).toEqual(KEY);
		expect(decoded.hubName).toBe("Examples MacBook Pro");
	});

	it("round-trips the device-session frames", () => {
		expect(
			decodeDeviceBeginFrame(encodeDeviceBeginFrame({ message: MESSAGE }))
				.message,
		).toEqual(MESSAGE);
		const ok = decodeDeviceOkFrame(
			encodeDeviceOkFrame({ message: MESSAGE, deviceId: "dev_2" }),
		);
		expect(ok.deviceId).toBe("dev_2");
	});

	it("refuses a frame of the wrong type, version or shape", () => {
		expect(() => decodePairAttestFrame("not json")).toThrow(/not JSON/);
		expect(() => decodePairAttestFrame("[]")).toThrow(/not a JSON object/);
		expect(() =>
			decodePairAttestFrame(
				JSON.stringify({ type: "cline.device.begin", version: 1 }),
			),
		).toThrow(/Expected a cline.pair.attest frame/);
		expect(() =>
			decodePairAttestFrame(
				JSON.stringify({
					type: "cline.pair.attest",
					version: 1,
					offerId: "o",
					message: bytesToBase64Url(MESSAGE),
				}),
			),
		).toThrow(/Unsupported pairing transport version 1/);
		expect(() =>
			decodePairAttestFrame(
				JSON.stringify({
					type: "cline.pair.attest",
					version: 2,
					offerId: "o",
					message: "not base64url!!",
				}),
			),
		).toThrow(/not base64url/);
		expect(() =>
			decodePairAttestFrame(
				JSON.stringify({
					type: "cline.pair.attest",
					version: 2,
					offerId: "../x",
					message: bytesToBase64Url(MESSAGE),
				}),
			),
		).toThrow(/offerId is malformed/);
	});

	it("reads an error frame without throwing on unrelated frames", () => {
		const frame = readHandshakeErrorFrame(
			encodeHandshakeErrorFrame({
				type: HUB_DEVICE_ERROR_FRAME,
				code: "device_revoked",
				message: "This device was revoked.",
			}),
		);
		expect(frame?.code).toBe("device_revoked");
		expect(frame?.message).toBe("This device was revoked.");
		expect(readHandshakeErrorFrame("garbage")).toBeUndefined();
		expect(
			readHandshakeErrorFrame(encodeDeviceBeginFrame({ message: MESSAGE })),
		).toBeUndefined();
	});
});

describe("secure data frames", () => {
	it("round-trips sealed bytes and refuses plaintext hub JSON", () => {
		expect(decodeSecureDataFrame(encodeSecureDataFrame(MESSAGE)).data).toEqual(
			MESSAGE,
		);
		expect(() =>
			decodeSecureDataFrame(
				JSON.stringify({
					kind: "command",
					envelope: { command: "session.list" },
				}),
			),
		).toThrow(/Expected a cline.device.data frame/);
	});
});
