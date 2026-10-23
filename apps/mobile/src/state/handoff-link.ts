/**
 * The machine-initiated handoff link: `clinecode://handoff?...`.
 *
 * A user running Cline on their computer types `/handoff`; Cline prints (or shows
 * as a QR) a link carrying everything the phone needs to talk to that machine.
 * Opening it on the phone is the ONLY first-run path the product asks for — no
 * "where does your agent run?" question, no typed `ws://` url, no pasted token.
 *
 * Wire contract (shared with the CLI — every field except `sid` is required):
 *
 * ```
 * clinecode://handoff
 *   ?v=1                     protocol version, exactly 1
 *   &i=<offer id>            single-use offer held by the laptop
 *   &k=<b64url>              hub static public key, 32 bytes
 *   &s=<b64url>              one-time Noise PSK, 32 bytes
 *   &u=<b64url>              relay url, utf-8 then base64url
 *   &n=<display name>        machine display name, plain text ("MacBook Pro")
 *   &e=<epoch ms>            expiry, epoch milliseconds
 *   &sid=<hub session id>    optional: the session to open on arrival
 * ```
 *
 * This route adapter retains actionable mobile error messages, while its strict
 * integer/base64url rules are pinned against `@cline/hub-pairing` contract tests.
 *
 * Everything here is pure: no React, no navigation, no storage. Failures throw
 * {@link HandoffLinkError}, whose `message` is a sentence a person can act on —
 * the UI shows exactly that, never a stack trace.
 */

export const HANDOFF_SCHEME = "clinecode";
export const HANDOFF_HOST = "handoff";
export const HANDOFF_VERSION = 1;
/** Curve25519 public key (`DHLEN` in hub-pairing's Noise implementation). */
export const HANDOFF_KEY_BYTES = 32;
/** `ONE_TIME_SECRET_LENGTH` in hub-pairing. */
export const HANDOFF_SECRET_BYTES = 32;
/** Defensive cap on the machine name, which is rendered as a label. */
export const HANDOFF_NAME_MAX_LENGTH = 64;

/**
 * Why a link was refused. The UI keys off `reason` for its recovery affordance;
 * the `message` is what the user reads.
 */
export type HandoffLinkErrorReason =
	| "not_handoff"
	| "unsupported_version"
	| "missing_fields"
	| "malformed_key"
	| "malformed_secret"
	| "malformed_url"
	| "malformed_name"
	| "malformed_expiry"
	| "expired";

export class HandoffLinkError extends Error {
	constructor(
		message: string,
		readonly reason: HandoffLinkErrorReason,
	) {
		super(message);
		this.name = "HandoffLinkError";
	}
}

/** A validated handoff link. */
export interface HandoffLink {
	version: typeof HANDOFF_VERSION;
	/** Hub static public key. Validated here and pinned by the pairing handshake. */
	hubPublicKey: Uint8Array;
	/**
	 * Canonical text of the one-time PSK. It is never saved as a hub credential.
	 */
	oneTimeSecretText: string;
	offerId: string;
	oneTimeSecret: Uint8Array;
	/** `ws(s)://` (or `http(s)://`) relay endpoint, decoded from `u`. */
	url: string;
	/** Machine display name, e.g. "MacBook Pro". */
	machineName: string;
	/** Epoch ms after which the link is refused. */
	expiresAt: number;
	/** Hub session to open on arrival, when the machine named one. */
	hubSessionId?: string;
}

const BASE64URL_ALPHABET =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const BASE64URL_LOOKUP: Record<string, number> = (() => {
	const lookup: Record<string, number> = {};
	for (let index = 0; index < BASE64URL_ALPHABET.length; index += 1) {
		lookup[BASE64URL_ALPHABET[index] as string] = index;
	}
	return lookup;
})();

/**
 * Strict, canonical base64url decode — the same rules as
 * `@cline/hub-pairing`'s `base64UrlToBytes`: unpadded, base64url alphabet only
 * (no `+`, `/` or `=`), no whitespace, and the leftover bits of a partial group
 * must be zero. Anything looser would give one key several spellings.
 */
export function base64UrlToBytes(value: string): Uint8Array {
	if (value.length % 4 === 1) {
		// A 4n+1 group carries 6 bits: not a whole byte, so no input produces it.
		throw new Error(`Invalid base64url length: ${value.length}`);
	}
	const out = new Uint8Array(Math.floor((value.length * 6) / 8));
	let accumulator = 0;
	let bits = 0;
	let written = 0;
	for (const character of value) {
		const digit = BASE64URL_LOOKUP[character];
		if (digit === undefined) {
			throw new Error(`Invalid base64url character: ${character}`);
		}
		accumulator = (accumulator << 6) | digit;
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			out[written] = (accumulator >> bits) & 0xff;
			written += 1;
		}
	}
	if (bits > 0 && (accumulator & ((1 << bits) - 1)) !== 0) {
		throw new Error(
			"Non-canonical base64url: trailing padding bits are not zero",
		);
	}
	return out.subarray(0, written);
}

/**
 * UTF-8 decode, hand-rolled because `TextDecoder` is not guaranteed on Hermes.
 * Malformed sequences throw rather than silently becoming U+FFFD: a url that
 * does not round-trip is a damaged link, not a link with odd characters.
 */
export function utf8ToString(bytes: Uint8Array): string {
	let out = "";
	let index = 0;
	while (index < bytes.length) {
		const byte = bytes[index] as number;
		let codePoint: number;
		let width: number;
		if (byte < 0x80) {
			codePoint = byte;
			width = 1;
		} else if (byte >= 0xc2 && byte <= 0xdf) {
			codePoint = byte & 0x1f;
			width = 2;
		} else if (byte >= 0xe0 && byte <= 0xef) {
			codePoint = byte & 0x0f;
			width = 3;
		} else if (byte >= 0xf0 && byte <= 0xf4) {
			codePoint = byte & 0x07;
			width = 4;
		} else {
			throw new Error(`Invalid UTF-8 lead byte 0x${byte.toString(16)}`);
		}
		if (index + width > bytes.length) {
			throw new Error("Truncated UTF-8 sequence");
		}
		for (let offset = 1; offset < width; offset += 1) {
			const continuation = bytes[index + offset] as number;
			if ((continuation & 0xc0) !== 0x80) {
				throw new Error("Invalid UTF-8 continuation byte");
			}
			codePoint = (codePoint << 6) | (continuation & 0x3f);
		}
		out += String.fromCodePoint(codePoint);
		index += width;
	}
	return out;
}

/** The url schemes a hub can be reached on. `http(s)` is rewritten downstream. */
const HUB_URL_SCHEMES = new Set(["ws:", "wss:", "http:", "https:"]);

type ParamValue = string | string[] | undefined;

/** Query params as they arrive from expo-router (repeats become arrays). */
export type HandoffParams = Record<string, ParamValue>;

/** First value of a param, trimmed; `undefined` when absent or empty. */
function readParam(params: HandoffParams, name: string): string | undefined {
	const raw = params[name];
	const value = Array.isArray(raw) ? raw[0] : raw;
	const trimmed = typeof value === "string" ? value.trim() : undefined;
	return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

const RERUN = "Run /handoff in Cline on your computer to get a fresh link.";

/**
 * Validate handoff query params into a {@link HandoffLink}.
 *
 * Order matters for the error the user sees: version first (so an old app says
 * "update me" rather than "damaged link"), then presence, then shape, then
 * expiry — an expired-but-well-formed link gets the one message that tells the
 * user exactly what to do.
 */
export function decodeHandoffParams(
	params: HandoffParams,
	options: { now?: number } = {},
): HandoffLink {
	const versionText = readParam(params, "v");
	if (versionText === undefined) {
		throw new HandoffLinkError(
			`This handoff link is missing its version. ${RERUN}`,
			"missing_fields",
		);
	}
	if (!/^\d+$/.test(versionText) || Number(versionText) !== HANDOFF_VERSION) {
		// Explicit refusal, never best-effort parsing: a newer or older ceremony
		// must not be guessed at.
		throw new HandoffLinkError(
			`This handoff link uses version ${versionText}, which this version of Cline does not support. Update Cline on your phone and computer, then try again.`,
			"unsupported_version",
		);
	}

	const keyText = readParam(params, "k");
	const offerId = readParam(params, "i");
	const secretText = readParam(params, "s");
	const urlText = readParam(params, "u");
	const nameText = readParam(params, "n");
	const expiryText = readParam(params, "e");
	if (
		!keyText ||
		!offerId ||
		!secretText ||
		!urlText ||
		!nameText ||
		!expiryText
	) {
		throw new HandoffLinkError(
			`This handoff link is incomplete. ${RERUN}`,
			"missing_fields",
		);
	}

	let hubPublicKey: Uint8Array;
	try {
		hubPublicKey = base64UrlToBytes(keyText);
	} catch {
		throw new HandoffLinkError(
			`This handoff link is damaged — its machine key could not be read. ${RERUN}`,
			"malformed_key",
		);
	}
	if (hubPublicKey.length !== HANDOFF_KEY_BYTES) {
		throw new HandoffLinkError(
			`This handoff link is damaged — its machine key is the wrong size. ${RERUN}`,
			"malformed_key",
		);
	}

	let oneTimeSecret: Uint8Array;
	try {
		oneTimeSecret = base64UrlToBytes(secretText);
	} catch {
		throw new HandoffLinkError(
			`This handoff link is damaged — its one-time code could not be read. ${RERUN}`,
			"malformed_secret",
		);
	}
	if (oneTimeSecret.length !== HANDOFF_SECRET_BYTES) {
		throw new HandoffLinkError(
			`This handoff link is damaged — its one-time code is the wrong size. ${RERUN}`,
			"malformed_secret",
		);
	}

	const url = decodeHubUrl(urlText);

	// A name reaches the UI as a label, so it is bounded and stripped of control
	// characters (including the newlines a terminal copy can smuggle in).
	const machineName = nameText
		// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point.
		.replace(/[\x00-\x1f\x7f]/g, "")
		.trim();
	if (machineName.length === 0) {
		throw new HandoffLinkError(
			`This handoff link is damaged — it does not name the computer it came from. ${RERUN}`,
			"malformed_name",
		);
	}

	if (!/^\d+$/.test(expiryText)) {
		throw new HandoffLinkError(
			`This handoff link is damaged — its expiry could not be read. ${RERUN}`,
			"malformed_expiry",
		);
	}
	const expiresAt = Number(expiryText);
	if (!Number.isSafeInteger(expiresAt)) {
		throw new HandoffLinkError(
			`This handoff link is damaged — its expiry could not be read. ${RERUN}`,
			"malformed_expiry",
		);
	}
	const now = options.now ?? Date.now();
	if (expiresAt <= now) {
		throw new HandoffLinkError(
			`This handoff link has expired. ${RERUN}`,
			"expired",
		);
	}

	const hubSessionId = readParam(params, "sid");

	return {
		version: HANDOFF_VERSION,
		hubPublicKey,
		oneTimeSecretText: secretText,
		offerId,
		oneTimeSecret,
		url,
		machineName:
			machineName.length > HANDOFF_NAME_MAX_LENGTH
				? machineName.slice(0, HANDOFF_NAME_MAX_LENGTH)
				: machineName,
		expiresAt,
		...(hubSessionId ? { hubSessionId } : {}),
	};
}

/** `u` (base64url of a utf-8 hub url) -> a usable ws/http url. */
function decodeHubUrl(urlText: string): string {
	let decoded: string;
	try {
		decoded = utf8ToString(base64UrlToBytes(urlText)).trim();
	} catch {
		throw new HandoffLinkError(
			`This handoff link is damaged — its address could not be read. ${RERUN}`,
			"malformed_url",
		);
	}
	let parsed: URL;
	try {
		parsed = new URL(decoded);
	} catch {
		throw new HandoffLinkError(
			`This handoff link points at an address Cline cannot use. ${RERUN}`,
			"malformed_url",
		);
	}
	if (!HUB_URL_SCHEMES.has(parsed.protocol) || parsed.hostname.length === 0) {
		throw new HandoffLinkError(
			`This handoff link points at an address Cline cannot use. ${RERUN}`,
			"malformed_url",
		);
	}
	return decoded;
}

/**
 * Decode a whole `clinecode://handoff?...` url.
 *
 * Also accepts the shapes the link takes on the way through a router:
 * `clinecode:///handoff?...`, `/handoff?...` and `handoff?...`. Anything else is
 * refused as "not a handoff link" — this is a claim about the *scheme*, so it is
 * checked before any field is trusted.
 */
export function decodeHandoffUrl(
	url: string,
	options: { now?: number } = {},
): HandoffLink {
	const trimmed = url.trim();
	const withoutScheme = stripHandoffScheme(trimmed);
	if (withoutScheme === undefined) {
		throw new HandoffLinkError(
			"This is not a Cline handoff link.",
			"not_handoff",
		);
	}
	const [path = "", query = ""] = splitOnce(withoutScheme, "?");
	if (path.replace(/^\/+/, "").replace(/\/+$/, "") !== HANDOFF_HOST) {
		throw new HandoffLinkError(
			"This is not a Cline handoff link.",
			"not_handoff",
		);
	}
	const params: HandoffParams = {};
	for (const [key, value] of new URLSearchParams(query).entries()) {
		if (params[key] === undefined) {
			params[key] = value;
		}
	}
	return decodeHandoffParams(params, options);
}

/** True when `url` is at least *addressed* to the handoff route. */
export function isHandoffUrl(url: string): boolean {
	const withoutScheme = stripHandoffScheme(url.trim());
	if (withoutScheme === undefined) {
		return false;
	}
	const [path = ""] = splitOnce(withoutScheme, "?");
	return path.replace(/^\/+/, "").replace(/\/+$/, "") === HANDOFF_HOST;
}

function stripHandoffScheme(url: string): string | undefined {
	const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(url);
	if (schemeMatch) {
		return schemeMatch[1]?.toLowerCase() === HANDOFF_SCHEME
			? url.slice(schemeMatch[0].length)
			: undefined;
	}
	// Router-relative forms, which have already lost the scheme.
	return url.startsWith("/") || url.startsWith(HANDOFF_HOST) ? url : undefined;
}

function splitOnce(value: string, separator: string): [string, string?] {
	const index = value.indexOf(separator);
	return index === -1
		? [value]
		: [value.slice(0, index), value.slice(index + separator.length)];
}
