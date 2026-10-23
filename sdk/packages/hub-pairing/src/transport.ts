/**
 * The wire contract for running the pairing and device-session handshakes over a
 * plain hub WebSocket.
 *
 * This file exists because the same three-way contract — CLI (mints the offer),
 * hub server (completes it), phone (drives it) — has already drifted twice when
 * each side spelled the subprotocol names and frame shapes for itself. Every
 * participant imports the constants and codecs from here; nothing re-declares
 * them.
 *
 * ## Sequence
 *
 * Enrollment (once per device, immediately after a QR/deep link):
 *
 * ```
 * device -> hub   WS upgrade, Sec-WebSocket-Protocol: cline-hub-pair.v2.<offerId>
 * device -> hub   {"type":"cline.pair.attest","version":2,"offerId":…,"message":<b64url Noise msg 1>}
 * hub    -> device{"type":"cline.pair.ok","version":2,"offerId":…,"message":<b64url Noise msg 2>,
 *                  "deviceId":…,"hubName":…,"hubPublicKey":…}
 * …socket is now authenticated; encrypted `cline.device.data` frames follow…
 * ```
 *
 * Returning connection (every connect after enrollment — no token, no QR):
 *
 * ```
 * device -> hub   WS upgrade, Sec-WebSocket-Protocol: cline-hub-device.v2
 * device -> hub   {"type":"cline.device.begin","version":2,"message":<b64url Noise msg 1>}
 * hub    -> device{"type":"cline.device.ok","version":2,"message":<b64url Noise msg 2>,"deviceId":…}
 * …socket is now authenticated; encrypted `cline.device.data` frames follow…
 * ```
 *
 * Either handshake can instead be answered with `cline.pair.error` /
 * `cline.device.error`, after which the hub closes the socket.
 *
 * Post-handshake hub frames are always sealed with the Noise transport keys.
 * This keeps transcripts and tool input private from other devices on the LAN;
 * the same channel also detects replay, reordering and tampering.
 */

import { base64UrlToBytes, bytesToBase64Url } from "./bytes.js";
import { PairingUriError } from "./errors.js";

/**
 * Subprotocol prefix for an enrollment socket. The offer id rides in the header
 * because the hub has to find the offer on disk before it can read any frame.
 */
export const HUB_PAIR_SUBPROTOCOL_PREFIX = "cline-hub-pair.v2.";

/**
 * Subprotocol for a returning paired device. No device id: Noise_IK message 1
 * already carries the device's static key (encrypted), so the hub identifies the
 * caller from the handshake instead of from a header an eavesdropper can read.
 */
export const HUB_DEVICE_SUBPROTOCOL = "cline-hub-device.v2";

export const HUB_PAIR_ATTEST_FRAME = "cline.pair.attest";
export const HUB_PAIR_OK_FRAME = "cline.pair.ok";
export const HUB_PAIR_ERROR_FRAME = "cline.pair.error";
export const HUB_DEVICE_BEGIN_FRAME = "cline.device.begin";
export const HUB_DEVICE_OK_FRAME = "cline.device.ok";
export const HUB_DEVICE_ERROR_FRAME = "cline.device.error";
export const HUB_SECURE_DATA_FRAME = "cline.device.data";

export const HUB_PAIRING_TRANSPORT_VERSION = 2;

/**
 * Maximum wire size of any unauthenticated pairing/device handshake frame.
 * Noise handshake messages are tiny; this generous ceiling exists to keep an
 * untrusted peer from making either endpoint parse application-sized input
 * before the peer has proved its identity.
 */
export const HUB_HANDSHAKE_MAX_WIRE_BYTES = 64 * 1024;

export interface SecureDataFrame {
	readonly type: typeof HUB_SECURE_DATA_FRAME;
	readonly version: number;
	readonly data: Uint8Array;
}

/** Encode one already-sealed SecureChannel frame for a text WebSocket. */
export function encodeSecureDataFrame(data: Uint8Array): string {
	return JSON.stringify({
		type: HUB_SECURE_DATA_FRAME,
		version: HUB_PAIRING_TRANSPORT_VERSION,
		data: bytesToBase64Url(data),
	});
}

/** Maximum UTF-8 bytes occupied by an encoded sealed frame. */
export function maxEncodedSecureDataFrameBytes(maxSealedBytes: number): number {
	const emptyEnvelopeBytes = encodeSecureDataFrame(new Uint8Array()).length;
	return emptyEnvelopeBytes + Math.ceil((maxSealedBytes * 4) / 3);
}

/**
 * Offer ids are minted as base64url of 16 random bytes, and the hub turns one
 * into a *file name*. Anything outside this alphabet is refused before it ever
 * reaches `join()`, so a subprotocol like `cline-hub-pair.v2.../../../etc/passwd`
 * cannot address a path.
 */
const OFFER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidOfferId(value: string): boolean {
	return OFFER_ID_PATTERN.test(value);
}

/** The offer id in a `cline-hub-pair.v2.<offerId>` subprotocol, if well-formed. */
export function readPairSubprotocolOfferId(
	subprotocols: string | readonly string[] | undefined,
): string | undefined {
	for (const candidate of iterateSubprotocols(subprotocols)) {
		if (!candidate.startsWith(HUB_PAIR_SUBPROTOCOL_PREFIX)) {
			continue;
		}
		const offerId = candidate.slice(HUB_PAIR_SUBPROTOCOL_PREFIX.length).trim();
		return isValidOfferId(offerId) ? offerId : undefined;
	}
	return undefined;
}

/** True when the client asked for the returning-device handshake. */
export function hasDeviceSubprotocol(
	subprotocols: string | readonly string[] | undefined,
): boolean {
	for (const candidate of iterateSubprotocols(subprotocols)) {
		if (candidate === HUB_DEVICE_SUBPROTOCOL) {
			return true;
		}
	}
	return false;
}

function* iterateSubprotocols(
	subprotocols: string | readonly string[] | undefined,
): Generator<string> {
	if (subprotocols === undefined) {
		return;
	}
	const parts = Array.isArray(subprotocols)
		? subprotocols
		: String(subprotocols).split(",");
	for (const part of parts) {
		const trimmed = String(part).trim();
		if (trimmed.length > 0) {
			yield trimmed;
		}
	}
}

export interface PairAttestFrame {
	readonly type: typeof HUB_PAIR_ATTEST_FRAME;
	readonly version: number;
	readonly offerId: string;
	readonly message: Uint8Array;
}

export interface PairOkFrame {
	readonly type: typeof HUB_PAIR_OK_FRAME;
	readonly version: number;
	readonly offerId: string;
	readonly message: Uint8Array;
	readonly deviceId: string;
	readonly hubName: string;
	/** The hub's static public key, so the device can confirm what it pinned. */
	readonly hubPublicKey: Uint8Array;
}

export interface DeviceBeginFrame {
	readonly type: typeof HUB_DEVICE_BEGIN_FRAME;
	readonly version: number;
	readonly message: Uint8Array;
}

export interface DeviceOkFrame {
	readonly type: typeof HUB_DEVICE_OK_FRAME;
	readonly version: number;
	readonly message: Uint8Array;
	readonly deviceId: string;
}

export interface HandshakeErrorFrame {
	readonly type: typeof HUB_PAIR_ERROR_FRAME | typeof HUB_DEVICE_ERROR_FRAME;
	readonly code: string;
	readonly message: string;
}

export function encodePairAttestFrame(
	frame: Omit<PairAttestFrame, "type" | "version">,
): string {
	return JSON.stringify({
		type: HUB_PAIR_ATTEST_FRAME,
		version: HUB_PAIRING_TRANSPORT_VERSION,
		offerId: frame.offerId,
		message: bytesToBase64Url(frame.message),
	});
}

export function encodePairOkFrame(
	frame: Omit<PairOkFrame, "type" | "version">,
): string {
	return JSON.stringify({
		type: HUB_PAIR_OK_FRAME,
		version: HUB_PAIRING_TRANSPORT_VERSION,
		offerId: frame.offerId,
		message: bytesToBase64Url(frame.message),
		deviceId: frame.deviceId,
		hubName: frame.hubName,
		hubPublicKey: bytesToBase64Url(frame.hubPublicKey),
	});
}

export function encodeDeviceBeginFrame(
	frame: Omit<DeviceBeginFrame, "type" | "version">,
): string {
	return JSON.stringify({
		type: HUB_DEVICE_BEGIN_FRAME,
		version: HUB_PAIRING_TRANSPORT_VERSION,
		message: bytesToBase64Url(frame.message),
	});
}

export function encodeDeviceOkFrame(
	frame: Omit<DeviceOkFrame, "type" | "version">,
): string {
	return JSON.stringify({
		type: HUB_DEVICE_OK_FRAME,
		version: HUB_PAIRING_TRANSPORT_VERSION,
		message: bytesToBase64Url(frame.message),
		deviceId: frame.deviceId,
	});
}

export function encodeHandshakeErrorFrame(frame: HandshakeErrorFrame): string {
	return JSON.stringify({
		type: frame.type,
		code: frame.code,
		message: frame.message,
	});
}

function parseObject(text: string): Record<string, unknown> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new PairingUriError("Handshake frame is not JSON");
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new PairingUriError("Handshake frame is not a JSON object");
	}
	return parsed as Record<string, unknown>;
}

function requireString(raw: Record<string, unknown>, field: string): string {
	const value = raw[field];
	if (typeof value !== "string" || value.length === 0) {
		throw new PairingUriError(`Handshake frame has no ${field}`);
	}
	return value;
}

function requireBytes(raw: Record<string, unknown>, field: string): Uint8Array {
	const text = requireString(raw, field);
	try {
		return base64UrlToBytes(text);
	} catch {
		throw new PairingUriError(`Handshake frame ${field} is not base64url`);
	}
}

function requireVersion(raw: Record<string, unknown>): number {
	const value = raw.version;
	if (value !== HUB_PAIRING_TRANSPORT_VERSION) {
		throw new PairingUriError(
			`Unsupported pairing transport version ${String(value)}`,
		);
	}
	return HUB_PAIRING_TRANSPORT_VERSION;
}

function requireType(raw: Record<string, unknown>, expected: string): void {
	if (raw.type !== expected) {
		throw new PairingUriError(
			`Expected a ${expected} frame, got ${String(raw.type)}`,
		);
	}
}

export function decodePairAttestFrame(text: string): PairAttestFrame {
	const raw = parseObject(text);
	requireType(raw, HUB_PAIR_ATTEST_FRAME);
	const version = requireVersion(raw);
	const offerId = requireString(raw, "offerId");
	if (!isValidOfferId(offerId)) {
		throw new PairingUriError("Handshake frame offerId is malformed");
	}
	return {
		type: HUB_PAIR_ATTEST_FRAME,
		version,
		offerId,
		message: requireBytes(raw, "message"),
	};
}

export function decodePairOkFrame(text: string): PairOkFrame {
	const raw = parseObject(text);
	requireType(raw, HUB_PAIR_OK_FRAME);
	const version = requireVersion(raw);
	return {
		type: HUB_PAIR_OK_FRAME,
		version,
		offerId: requireString(raw, "offerId"),
		message: requireBytes(raw, "message"),
		deviceId: requireString(raw, "deviceId"),
		hubName: requireString(raw, "hubName"),
		hubPublicKey: requireBytes(raw, "hubPublicKey"),
	};
}

export function decodeDeviceBeginFrame(text: string): DeviceBeginFrame {
	const raw = parseObject(text);
	requireType(raw, HUB_DEVICE_BEGIN_FRAME);
	return {
		type: HUB_DEVICE_BEGIN_FRAME,
		version: requireVersion(raw),
		message: requireBytes(raw, "message"),
	};
}

export function decodeDeviceOkFrame(text: string): DeviceOkFrame {
	const raw = parseObject(text);
	requireType(raw, HUB_DEVICE_OK_FRAME);
	return {
		type: HUB_DEVICE_OK_FRAME,
		version: requireVersion(raw),
		message: requireBytes(raw, "message"),
		deviceId: requireString(raw, "deviceId"),
	};
}

export function decodeSecureDataFrame(text: string): SecureDataFrame {
	const raw = parseObject(text);
	requireType(raw, HUB_SECURE_DATA_FRAME);
	return {
		type: HUB_SECURE_DATA_FRAME,
		version: requireVersion(raw),
		data: requireBytes(raw, "data"),
	};
}

/**
 * A handshake error frame, or `undefined` when `text` is not one. Callers use
 * this to turn the hub's refusal into a sentence instead of a generic socket
 * failure, so it must never throw on an unrelated frame.
 */
export function readHandshakeErrorFrame(
	text: string,
): HandshakeErrorFrame | undefined {
	let raw: Record<string, unknown>;
	try {
		raw = parseObject(text);
	} catch {
		return undefined;
	}
	if (
		raw.type !== HUB_PAIR_ERROR_FRAME &&
		raw.type !== HUB_DEVICE_ERROR_FRAME
	) {
		return undefined;
	}
	return {
		type: raw.type as HandshakeErrorFrame["type"],
		code: typeof raw.code === "string" ? raw.code : "handshake_failed",
		message:
			typeof raw.message === "string" && raw.message.length > 0
				? raw.message
				: "The hub refused the handshake.",
	};
}
