/**
 * Relay wire protocol v1 — the ONLY thing the relay understands.
 *
 * The relay is a blind pipe: it brokers bytes between a laptop hub ("host") and
 * a phone ("client") that both authenticate with the same Cline account. It
 * parses the outer envelope (routing metadata) and never the `payload`, which is
 * an opaque base64 blob the relay copies verbatim. Hub protocol v1 lives inside
 * that blob, end-to-end encrypted by the pairing layer; the relay neither needs
 * nor is able to interpret it.
 *
 * This module is RN-safe: no node builtins, no external packages.
 */

import { base64DecodedByteLength } from "./base64";

export const RELAY_PROTOCOL_VERSION = "relay-v1";

/** Websocket path a laptop hub dials out to and registers a machine on. */
export const RELAY_HOST_PATH = "/v1/host";
/** Websocket path a phone connects to in order to reach one of its machines. */
export const RELAY_CLIENT_PATH = "/v1/client";

/**
 * Subprotocol carrying the account token, for runtimes that cannot set request
 * headers (browsers) or that ignore them (Node's global `WebSocket`). Mirrors
 * `HUB_AUTH_PROTOCOL_PREFIX` in `@cline/hub-client`.
 *
 * Unlike the hub's version, the credential is base64url-encoded — see
 * {@link encodeRelayAuthCredential}.
 */
export const RELAY_AUTH_PROTOCOL_PREFIX = "cline-relay-auth.";

/** Largest opaque payload the relay will forward, matching `HUB_MAX_FRAME_BYTES`. */
export const RELAY_MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;
/**
 * Hard websocket-level cap. Larger than the payload cap so the in-band
 * `frame_too_large` error wins over `ws`'s protocol-level 1009 close, which
 * cannot carry a typed code.
 */
export const RELAY_MAX_FRAME_BYTES = 12 * 1024 * 1024;

/**
 * Bytes a peer may have sitting in the relay's outbound socket buffer before the
 * relay stops reading from the peer feeding it. See `sendHighWaterMarkBytes`.
 */
export const RELAY_SEND_HIGH_WATER_MARK_BYTES = 8 * 1024 * 1024;

/** Longest `machineId` the relay will accept, store or log. */
export const RELAY_MAX_MACHINE_ID_LENGTH = 128;
/** Longest `label`; anything longer is truncated rather than refused. */
export const RELAY_MAX_LABEL_LENGTH = 256;
/** Longest `channel.close` `reason`; anything longer is truncated. */
export const RELAY_MAX_CLOSE_REASON_LENGTH = 256;

export const RELAY_HEARTBEAT_INTERVAL_MS = 30_000;
export const RELAY_HEARTBEAT_TIMEOUT_MS = 75_000;
/** How long a socket may stay unidentified before the relay drops it. */
export const RELAY_HANDSHAKE_TIMEOUT_MS = 10_000;

/** `machineId` a phone can ask for when it just wants this account's latest hub. */
export const RELAY_NEWEST_MACHINE = "newest";

export type RelayRole = "host" | "client";

/**
 * Typed relay failures. Everything the relay refuses is one of these — callers
 * branch on the code, never on the message.
 */
export type RelayErrorCode =
	/** Missing/invalid account token on the upgrade. */
	| "unauthorized"
	/** The machine exists but belongs to a different account. */
	| "forbidden_account"
	/** No machine with that id has ever registered here. */
	| "machine_not_found"
	/** Known machine, right account, but its hub is not currently connected. */
	| "machine_offline"
	/** Peer speaks a relay protocol version this relay does not support. */
	| "protocol_version_unsupported"
	/** Frame was not a valid relay envelope. */
	| "malformed_frame"
	/** Envelope named a channel this socket does not own. */
	| "unknown_channel"
	/** Payload exceeded {@link RELAY_MAX_PAYLOAD_BYTES}. */
	| "frame_too_large"
	/** `seq` was not exactly the next value — a duplicate, replay, or gap. */
	| "replayed_frame"
	/** Per-account connection limit reached. */
	| "connection_limit"
	/** Per-machine channel limit reached. */
	| "channel_limit"
	/** Account or channel exceeded its configured byte-rate budget. */
	| "rate_limited"
	/** Registration/connect frame never arrived. */
	| "handshake_timeout"
	/**
	 * The peer stopped draining and the relay refuses to buffer for it any longer,
	 * or a queue that exists only to cover a startup race overflowed.
	 */
	| "backpressure"
	/**
	 * The machine's hub socket is up but its LOCAL hub could not be reached, so no
	 * end-to-end path exists. Distinct from `machine_offline`, which is about the
	 * laptop, not the hub process on it.
	 */
	| "hub_unreachable"
	/** No traffic within the heartbeat window. */
	| "heartbeat_timeout"
	/** The paired host went away while the channel was open. */
	| "machine_gone"
	/** The paired client went away while the channel was open. */
	| "client_gone"
	/** Relay-side bug or shutdown. */
	| "internal";

/**
 * Websocket close codes per error. All in the 4000-4999 private range and
 * deliberately mnemonic of the HTTP status the cloud session proxy returns for
 * the same condition (401/403/404/410/413/429/502).
 */
export const RELAY_CLOSE_CODES: Record<RelayErrorCode, number> = {
	unauthorized: 4401,
	forbidden_account: 4403,
	machine_not_found: 4404,
	machine_offline: 4410,
	protocol_version_unsupported: 4426,
	malformed_frame: 4400,
	unknown_channel: 4402,
	frame_too_large: 4413,
	replayed_frame: 4409,
	connection_limit: 4429,
	channel_limit: 4429,
	rate_limited: 4429,
	handshake_timeout: 4408,
	heartbeat_timeout: 4408,
	backpressure: 4507,
	hub_unreachable: 4504,
	machine_gone: 4502,
	client_gone: 4503,
	internal: 4500,
};

const RELAY_ERROR_CODES = new Set<string>(Object.keys(RELAY_CLOSE_CODES));

/** Whether an untrusted string is one of the codes this protocol defines. */
export function isRelayErrorCode(value: unknown): value is RelayErrorCode {
	return typeof value === "string" && RELAY_ERROR_CODES.has(value);
}

/**
 * Close code for a peer-supplied close code, safely.
 *
 * `RELAY_CLOSE_CODES[code]` on an unvalidated string resolves inherited names —
 * `code: "constructor"` yields a *function*, and `socket.close(fn)` throws,
 * leaving the socket open. Everything unrecognised collapses to `internal`.
 */
export function relayCloseCode(code: RelayErrorCode | "normal"): number {
	if (code === "normal") {
		return 1000;
	}
	const mapped = Object.hasOwn(RELAY_CLOSE_CODES, code)
		? RELAY_CLOSE_CODES[code as RelayErrorCode]
		: undefined;
	return typeof mapped === "number" ? mapped : RELAY_CLOSE_CODES.internal;
}

/**
 * Websocket-level `maxPayload` for a given payload cap: enough room for base64
 * expansion plus the JSON envelope, so the typed in-band `frame_too_large` wins
 * over `ws`'s untyped 1009. Derived rather than fixed, because a relay that
 * raises `maxPayloadBytes` and keeps a fixed websocket cap silently degrades to
 * 1009 for every frame in between.
 */
export function relayFrameCapBytes(
	maxPayloadBytes: number = RELAY_MAX_PAYLOAD_BYTES,
): number {
	return Math.ceil(maxPayloadBytes * (4 / 3)) + 1024 * 1024;
}

/**
 * `machineId` charset and length. Ids are routing keys that end up in maps, in
 * logs and (in production) in a presence store, so they are restricted to
 * something safely printable and bounded rather than "any non-empty string".
 */
const MACHINE_ID_PATTERN = /^[A-Za-z0-9_.:-]+$/;

export function isValidMachineId(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= RELAY_MAX_MACHINE_ID_LENGTH &&
		MACHINE_ID_PATTERN.test(value)
	);
}

/**
 * Strips control characters and truncates. Applied to every peer-supplied string
 * the relay keeps or forwards, so a `reason` cannot inject a line into an
 * operator's log and a `label` cannot be a megabyte.
 */
export function sanitizeRelayText(value: string, maxLength: number): string {
	let out = "";
	for (const char of value) {
		const code = char.codePointAt(0) ?? 0;
		out +=
			code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)
				? " "
				: char;
		if (out.length >= maxLength) {
			break;
		}
	}
	return out.slice(0, maxLength);
}

export interface RelayHostRegisterFrame {
	t: "host.register";
	protocolVersion: string;
	machineId: string;
	label?: string;
}

export interface RelayHostRegisteredFrame {
	t: "host.registered";
	protocolVersion: string;
	machineId: string;
	accountId: string;
	label: string;
	connectedAt: number;
}

export interface RelayClientConnectFrame {
	t: "client.connect";
	protocolVersion: string;
	/** A machine id, or {@link RELAY_NEWEST_MACHINE}. */
	machineId: string;
}

export interface RelayClientConnectedFrame {
	t: "client.connected";
	protocolVersion: string;
	channelId: string;
	machineId: string;
	label: string;
}

/** Relay -> host: a phone wants a tunnel; open a local hub socket for it. */
export interface RelayChannelOpenFrame {
	t: "channel.open";
	channelId: string;
	openedAt: number;
}

/**
 * Host -> relay: the local hub socket for this channel is OPEN, so an end-to-end
 * path now exists. The relay withholds `client.connected` until this arrives, so
 * a phone's `connect()` never resolves against a laptop whose hub is down.
 */
export interface RelayChannelReadyFrame {
	t: "channel.ready";
	channelId: string;
}

export interface RelayChannelCloseFrame {
	t: "channel.close";
	channelId: string;
	code: RelayErrorCode | "normal";
	reason?: string;
}

/**
 * The one frame that carries user bytes.
 *
 * - `channelId` — which paired socket this belongs to.
 * - `seq` — consecutive from 1 per channel per direction. A duplicate, replay,
 *   or gap closes the channel.
 * - `payload` — base64 of opaque bytes. NEVER decoded by the relay.
 */
export interface RelayDataFrame {
	t: "data";
	channelId: string;
	seq: number;
	payload: string;
}

export interface RelayPingFrame {
	t: "ping";
	ts: number;
}

export interface RelayPongFrame {
	t: "pong";
	ts: number;
}

export interface RelayErrorFrame {
	t: "error";
	code: RelayErrorCode;
	message: string;
	channelId?: string;
}

export type RelayFrame =
	| RelayHostRegisterFrame
	| RelayHostRegisteredFrame
	| RelayClientConnectFrame
	| RelayClientConnectedFrame
	| RelayChannelOpenFrame
	| RelayChannelReadyFrame
	| RelayChannelCloseFrame
	| RelayDataFrame
	| RelayPingFrame
	| RelayPongFrame
	| RelayErrorFrame;

export function encodeRelayFrame(frame: RelayFrame): string {
	return JSON.stringify(frame);
}

export type RelayDecodeResult =
	| { ok: true; frame: RelayFrame }
	| RelayDecodeFailure;

export interface RelayDecodeFailure {
	ok: false;
	code: RelayErrorCode;
	message: string;
	/**
	 * The channel the bad frame named, when it could be recovered. Lets a peer
	 * close ONE channel instead of the whole multiplexed tunnel.
	 */
	channelId?: string;
}

function fail(
	code: RelayErrorCode,
	message: string,
	channelId?: string,
): RelayDecodeFailure {
	return { ok: false, code, message, ...(channelId ? { channelId } : {}) };
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

/**
 * Parse and shape-check one relay frame. Validation stops at the envelope: a
 * `data` frame's `payload` is only checked for being a string of a permitted
 * length, never for structure.
 */
export function decodeRelayFrame(
	text: string,
	options: { maxPayloadBytes?: number; maxFrameBytes?: number } = {},
): RelayDecodeResult {
	const maxPayloadBytes = options.maxPayloadBytes ?? RELAY_MAX_PAYLOAD_BYTES;
	const maxFrameBytes =
		options.maxFrameBytes ?? relayFrameCapBytes(maxPayloadBytes);
	// Measured BEFORE parsing. `JSON.parse` of an oversized frame materialises the
	// payload a second time, which is exactly the cost the cap exists to avoid.
	if (text.length > maxFrameBytes) {
		return fail(
			"frame_too_large",
			`frame of ${text.length} bytes exceeds the ${maxFrameBytes} byte cap`,
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return fail("malformed_frame", "frame was not valid JSON");
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return fail("malformed_frame", "frame was not a JSON object");
	}
	const frame = parsed as Record<string, unknown>;
	switch (frame.t) {
		case "host.register": {
			if (!isValidMachineId(frame.machineId)) {
				return fail(
					"malformed_frame",
					`host.register requires a machineId of at most ${RELAY_MAX_MACHINE_ID_LENGTH} characters from [A-Za-z0-9_.:-]`,
				);
			}
			if (frame.machineId === RELAY_NEWEST_MACHINE) {
				// Otherwise the first host to claim it permanently shadows the alias for
				// its whole account, and the claim needs no privilege at all.
				return fail(
					"malformed_frame",
					`${RELAY_NEWEST_MACHINE} is a reserved machine id`,
				);
			}
			if (!isNonEmptyString(frame.protocolVersion)) {
				return fail(
					"malformed_frame",
					"host.register requires a protocolVersion",
				);
			}
			return {
				ok: true,
				frame: {
					t: "host.register",
					protocolVersion: frame.protocolVersion,
					machineId: frame.machineId,
					...(isNonEmptyString(frame.label)
						? {
								label: sanitizeRelayText(frame.label, RELAY_MAX_LABEL_LENGTH),
							}
						: {}),
				},
			};
		}
		case "client.connect": {
			if (!isValidMachineId(frame.machineId)) {
				return fail(
					"malformed_frame",
					`client.connect requires a machineId of at most ${RELAY_MAX_MACHINE_ID_LENGTH} characters from [A-Za-z0-9_.:-]`,
				);
			}
			if (!isNonEmptyString(frame.protocolVersion)) {
				return fail(
					"malformed_frame",
					"client.connect requires a protocolVersion",
				);
			}
			return {
				ok: true,
				frame: {
					t: "client.connect",
					protocolVersion: frame.protocolVersion,
					machineId: frame.machineId,
				},
			};
		}
		case "data": {
			if (!isNonEmptyString(frame.channelId)) {
				return fail("malformed_frame", "data requires a channelId");
			}
			if (
				typeof frame.seq !== "number" ||
				!Number.isSafeInteger(frame.seq) ||
				frame.seq < 1
			) {
				return fail(
					"malformed_frame",
					"data requires a positive safe-integer seq",
					frame.channelId,
				);
			}
			if (typeof frame.payload !== "string") {
				return fail(
					"malformed_frame",
					"data requires a base64 payload string",
					frame.channelId,
				);
			}
			// The relay checks the SIZE of the opaque payload, never its content —
			// and the exact decoded size, so stats and quotas are not 33% high and
			// nothing legal is refused at the boundary.
			if (frame.payload.length > 0) {
				const bytes = base64DecodedByteLength(frame.payload);
				if (bytes > maxPayloadBytes) {
					return fail(
						"frame_too_large",
						`payload of ${bytes} bytes exceeds the ${maxPayloadBytes} byte cap`,
						frame.channelId,
					);
				}
			}
			return {
				ok: true,
				frame: {
					t: "data",
					channelId: frame.channelId,
					seq: frame.seq,
					payload: frame.payload,
				},
			};
		}
		case "channel.close": {
			if (!isNonEmptyString(frame.channelId)) {
				return fail("malformed_frame", "channel.close requires a channelId");
			}
			// `code` is used as a lookup key and logged, so it is constrained to the
			// enum here: everything else collapses to `internal` rather than reaching
			// `RELAY_CLOSE_CODES[code]` as an arbitrary string.
			const code: RelayChannelCloseFrame["code"] =
				frame.code === "normal"
					? "normal"
					: isRelayErrorCode(frame.code)
						? frame.code
						: "internal";
			return {
				ok: true,
				frame: {
					t: "channel.close",
					channelId: frame.channelId,
					code,
					...(isNonEmptyString(frame.reason)
						? {
								reason: sanitizeRelayText(
									frame.reason,
									RELAY_MAX_CLOSE_REASON_LENGTH,
								),
							}
						: {}),
				},
			};
		}
		case "channel.open": {
			if (!isNonEmptyString(frame.channelId)) {
				return fail("malformed_frame", "channel.open requires a channelId");
			}
			return {
				ok: true,
				frame: {
					t: "channel.open",
					channelId: frame.channelId,
					openedAt:
						typeof frame.openedAt === "number" ? frame.openedAt : Date.now(),
				},
			};
		}
		case "channel.ready": {
			if (!isNonEmptyString(frame.channelId)) {
				return fail("malformed_frame", "channel.ready requires a channelId");
			}
			return {
				ok: true,
				frame: { t: "channel.ready", channelId: frame.channelId },
			};
		}
		case "host.registered":
		case "client.connected":
		case "ping":
		case "pong":
		case "error":
			// Relay -> peer frames. Peers trust the relay's own framing; hand them
			// back as-is so a client can branch on `t` without re-validating.
			return { ok: true, frame: frame as unknown as RelayFrame };
		default:
			return fail(
				"malformed_frame",
				`unknown frame type ${JSON.stringify(frame.t)}`,
			);
	}
}

/** Whether a peer's advertised relay protocol version is acceptable. */
export function isRelayProtocolCompatible(version: string): boolean {
	return version === RELAY_PROTOCOL_VERSION;
}
