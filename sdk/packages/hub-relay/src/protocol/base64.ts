/**
 * Base64 for relay payloads, implemented without `Buffer`/`atob` so the same
 * code runs on Node, in a browser and under Hermes (React Native).
 *
 * Relay payloads are opaque bytes. They are carried base64-encoded inside a JSON
 * envelope so the relay can route a frame while treating its contents as a blob
 * it copies verbatim — see `frames.ts`.
 */

const ALPHABET =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Char code -> sextet, `0xff` for "not in the alphabet". A typed array rather
 * than an object so no inherited property name (`constructor`, `__proto__`) can
 * ever resolve to a value.
 */
const DECODE_TABLE = new Uint8Array(128).fill(0xff);
for (let index = 0; index < ALPHABET.length; index += 1) {
	DECODE_TABLE[(ALPHABET as string).charCodeAt(index)] = index;
}

export function bytesToBase64(bytes: Uint8Array): string {
	let out = "";
	for (let index = 0; index < bytes.length; index += 3) {
		const byte0 = bytes[index] as number;
		const byte1 = bytes[index + 1];
		const byte2 = bytes[index + 2];
		out += ALPHABET[byte0 >> 2];
		if (byte1 === undefined) {
			out += ALPHABET[(byte0 & 0b11) << 4];
			out += "==";
			break;
		}
		out += ALPHABET[((byte0 & 0b11) << 4) | (byte1 >> 4)];
		if (byte2 === undefined) {
			out += ALPHABET[(byte1 & 0b1111) << 2];
			out += "=";
			break;
		}
		out += ALPHABET[((byte1 & 0b1111) << 2) | (byte2 >> 6)];
		out += ALPHABET[byte2 & 0b111111];
	}
	return out;
}

/**
 * Decodes standard base64, STRICTLY: padding must be well formed and the bits
 * left over in the final character must be zero. Returns `undefined` otherwise.
 *
 * Strictness is a correctness property, not pedantry. A lenient decoder maps
 * several distinct strings onto the same bytes (`QQ==` and `QR==` both give
 * `0x41`), which silently defeats any "the payload arrived verbatim" comparison
 * and hands a re-encoder a different string than it received. Padding may be
 * omitted entirely, because {@link textToBase64Url} strips it.
 */
export function base64ToBytes(text: string): Uint8Array | undefined {
	let padding = 0;
	while (padding < 2 && text.charCodeAt(text.length - 1 - padding) === 0x3d) {
		padding += 1;
	}
	if (padding > 0 && text.length % 4 !== 0) {
		return undefined;
	}
	const trimmed = padding > 0 ? text.slice(0, -padding) : text;
	const remainder = trimmed.length % 4;
	if (remainder === 1) {
		return undefined;
	}
	if (padding > 0 && remainder !== 4 - padding) {
		// `A===`, `AAA==` and friends: more pad characters than the length allows.
		return undefined;
	}
	const outLength = Math.floor((trimmed.length * 6) / 8);
	const bytes = new Uint8Array(outLength);
	let bits = 0;
	let accumulator = 0;
	let cursor = 0;
	for (let index = 0; index < trimmed.length; index += 1) {
		const charCode = trimmed.charCodeAt(index);
		const value = charCode < 128 ? (DECODE_TABLE[charCode] as number) : 0xff;
		if (value === 0xff) {
			return undefined;
		}
		accumulator = (accumulator << 6) | value;
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			bytes[cursor] = (accumulator >> bits) & 0xff;
			cursor += 1;
		}
	}
	// Whatever is left over is not part of any byte, so a canonical encoding has
	// it zeroed. Non-zero means two different strings would decode alike.
	if (bits > 0 && (accumulator & ((1 << bits) - 1)) !== 0) {
		return undefined;
	}
	return bytes;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Number of bytes a base64 string decodes to, without decoding it. Used for the
 * relay's payload-size cap, which must not require materialising the payload.
 */
export function base64DecodedByteLength(text: string): number {
	if (text.length === 0) {
		return 0;
	}
	const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
	return Math.max(0, Math.floor((text.length * 3) / 4) - padding);
}

export function textToBase64(text: string): string {
	return bytesToBase64(encoder.encode(text));
}

export function base64ToText(text: string): string | undefined {
	const bytes = base64ToBytes(text);
	return bytes ? decoder.decode(bytes) : undefined;
}

/**
 * Unpadded base64url. Its alphabet (`A-Za-z0-9-_`) is entirely made of HTTP
 * `tchar`s, which is what makes it safe to put inside a websocket subprotocol —
 * see `encodeRelayAuthCredential`.
 */
export function textToBase64Url(text: string): string {
	return textToBase64(text)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

export function base64UrlToText(text: string): string | undefined {
	return base64ToText(text.replace(/-/g, "+").replace(/_/g, "/"));
}
