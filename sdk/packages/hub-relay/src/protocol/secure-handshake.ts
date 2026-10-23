import { base64ToBytes, bytesToBase64 } from "./base64";

export const RELAY_SECURE_HANDSHAKE_VERSION = 1;

export type RelaySecureHandshakeKind = "pairing" | "session";

export interface RelaySecureClientHello {
	version: typeof RELAY_SECURE_HANDSHAKE_VERSION;
	kind: RelaySecureHandshakeKind;
	offerId?: string;
	message: Uint8Array;
}

export interface RelaySecureHostReply {
	version: typeof RELAY_SECURE_HANDSHAKE_VERSION;
	message: Uint8Array;
}

type WireHello = {
	t: "secure.hello";
	v: number;
	kind: RelaySecureHandshakeKind;
	offerId?: string;
	message: string;
};

type WireReply = {
	t: "secure.reply";
	v: number;
	message: string;
};

export function encodeRelaySecureClientHello(
	hello: RelaySecureClientHello,
): Uint8Array {
	return new TextEncoder().encode(
		JSON.stringify({
			t: "secure.hello",
			v: hello.version,
			kind: hello.kind,
			...(hello.offerId ? { offerId: hello.offerId } : {}),
			message: bytesToBase64(hello.message),
		} satisfies WireHello),
	);
}

export function decodeRelaySecureClientHello(
	payload: Uint8Array,
): RelaySecureClientHello {
	const parsed = parseObject(payload) as Partial<WireHello>;
	if (
		parsed.t !== "secure.hello" ||
		parsed.v !== RELAY_SECURE_HANDSHAKE_VERSION ||
		(parsed.kind !== "pairing" && parsed.kind !== "session") ||
		typeof parsed.message !== "string" ||
		(parsed.offerId !== undefined && typeof parsed.offerId !== "string")
	) {
		throw new Error("malformed secure relay client hello");
	}
	const message = base64ToBytes(parsed.message);
	if (!message) {
		throw new Error("secure relay client hello has invalid base64");
	}
	return {
		version: RELAY_SECURE_HANDSHAKE_VERSION,
		kind: parsed.kind,
		...(parsed.offerId ? { offerId: parsed.offerId } : {}),
		message,
	};
}

export function encodeRelaySecureHostReply(
	reply: RelaySecureHostReply,
): Uint8Array {
	return new TextEncoder().encode(
		JSON.stringify({
			t: "secure.reply",
			v: reply.version,
			message: bytesToBase64(reply.message),
		} satisfies WireReply),
	);
}

export function decodeRelaySecureHostReply(
	payload: Uint8Array,
): RelaySecureHostReply {
	const parsed = parseObject(payload) as Partial<WireReply>;
	if (
		parsed.t !== "secure.reply" ||
		parsed.v !== RELAY_SECURE_HANDSHAKE_VERSION ||
		typeof parsed.message !== "string"
	) {
		throw new Error("malformed secure relay host reply");
	}
	const message = base64ToBytes(parsed.message);
	if (!message) {
		throw new Error("secure relay host reply has invalid base64");
	}
	return { version: RELAY_SECURE_HANDSHAKE_VERSION, message };
}

function parseObject(payload: Uint8Array): Record<string, unknown> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(new TextDecoder().decode(payload));
	} catch {
		throw new Error("secure relay handshake is not valid JSON");
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("secure relay handshake must be an object");
	}
	return parsed as Record<string, unknown>;
}
