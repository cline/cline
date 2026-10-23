/**
 * Byte helpers shared by the pairing ceremony and the secure channel.
 *
 * Everything here is platform-neutral on purpose: no `Buffer`, no `node:*`.
 * React Native (Hermes) and Node 22 both provide `TextEncoder`/`TextDecoder`
 * and `atob`/`btoa` is deliberately avoided in favour of explicit base64url
 * tables so the QR payload encoding cannot drift between platforms.
 */

const BASE64URL_ALPHABET =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * Strictly base64url: `+` and `/` are deliberately NOT accepted. Every key,
 * secret and device id in this package travels as base64url, and decoding has to
 * be injective — if one key had several textual forms, two different URIs or
 * device records could carry the same key while comparing as different, or vice
 * versa.
 */
const BASE64URL_LOOKUP: Record<string, number> = (() => {
	const table: Record<string, number> = {};
	for (let index = 0; index < BASE64URL_ALPHABET.length; index += 1) {
		table[BASE64URL_ALPHABET[index] as string] = index;
	}
	return table;
})();

/** Crockford-flavoured base32 (no padding, no I/L/O/U) for human-read fingerprints. */
const BASE32_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: false });

export function utf8ToBytes(value: string): Uint8Array {
	return textEncoder.encode(value);
}

export function bytesToUtf8(value: Uint8Array): string {
	return textDecoder.decode(value);
}

export function concatBytes(...chunks: Uint8Array[]): Uint8Array {
	let total = 0;
	for (const chunk of chunks) {
		total += chunk.length;
	}
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}

export function bytesToBase64Url(value: Uint8Array): string {
	let out = "";
	for (let index = 0; index < value.length; index += 3) {
		const b0 = value[index] as number;
		const b1 = value[index + 1];
		const b2 = value[index + 2];
		out += BASE64URL_ALPHABET[b0 >> 2];
		if (b1 === undefined) {
			out += BASE64URL_ALPHABET[(b0 & 0x03) << 4];
			break;
		}
		out += BASE64URL_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
		if (b2 === undefined) {
			out += BASE64URL_ALPHABET[(b1 & 0x0f) << 2];
			break;
		}
		out += BASE64URL_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)];
		out += BASE64URL_ALPHABET[b2 & 0x3f];
	}
	return out;
}

/**
 * Strict, canonical base64url decode: unpadded, base64url alphabet only, no
 * whitespace, and the leftover bits of a partial group must be zero. Anything
 * looser gives a key multiple spellings (see `BASE64URL_LOOKUP`).
 */
export function base64UrlToBytes(value: string): Uint8Array {
	if (value.length % 4 === 1) {
		// A 4n+1 group is 6 bits: not a whole byte, so no input produces it.
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

export function bytesToBase32(value: Uint8Array): string {
	let out = "";
	let accumulator = 0;
	let bits = 0;
	for (const byte of value) {
		accumulator = (accumulator << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			bits -= 5;
			out += BASE32_ALPHABET[(accumulator >> bits) & 0x1f];
		}
	}
	if (bits > 0) {
		out += BASE32_ALPHABET[(accumulator << (5 - bits)) & 0x1f];
	}
	return out;
}

export function hexToBytes(value: string): Uint8Array {
	if (value.length % 2 !== 0) {
		throw new Error("Hex string must have an even length");
	}
	const out = new Uint8Array(value.length / 2);
	for (let index = 0; index < out.length; index += 1) {
		const byte = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
		if (Number.isNaN(byte)) {
			throw new Error(`Invalid hex string: ${value}`);
		}
		out[index] = byte;
	}
	return out;
}

export function bytesToHex(value: Uint8Array): string {
	let out = "";
	for (const byte of value) {
		out += byte.toString(16).padStart(2, "0");
	}
	return out;
}

/**
 * Length-independent, value-constant-time comparison. Used for the pairing
 * fingerprint checks so a mismatch cannot be probed byte-by-byte via timing.
 */
export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
	if (left.length !== right.length) {
		return false;
	}
	let difference = 0;
	for (let index = 0; index < left.length; index += 1) {
		difference |= (left[index] as number) ^ (right[index] as number);
	}
	return difference === 0;
}

/** Big-endian u32 length prefix, used to bind variable-length transcript fields. */
export function lengthPrefixed(value: Uint8Array): Uint8Array {
	const prefix = new Uint8Array(4);
	prefix[0] = (value.length >>> 24) & 0xff;
	prefix[1] = (value.length >>> 16) & 0xff;
	prefix[2] = (value.length >>> 8) & 0xff;
	prefix[3] = value.length & 0xff;
	return concatBytes(prefix, value);
}
