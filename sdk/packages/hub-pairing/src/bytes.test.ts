/**
 * Encoding tests. base64url is the wire form of every key and secret in this
 * package, so decoding must be injective: two different texts must never decode
 * to the same key, or a hub key / QR secret gains aliases that pinning and
 * fingerprint comparisons cannot see.
 */
import { describe, expect, it } from "vitest";
import { base64UrlToBytes, bytesToBase64Url } from "./bytes.js";

describe("base64url", () => {
	it("round-trips every length up to 4 bytes", () => {
		for (let length = 0; length <= 4; length += 1) {
			const bytes = new Uint8Array(length).map((_, index) => index * 37 + 1);
			expect(Array.from(base64UrlToBytes(bytesToBase64Url(bytes)))).toEqual(
				Array.from(bytes),
			);
		}
	});

	it("ATTACK: rejects standard-base64 aliases of a key", () => {
		// `+` and `/` are not base64url. Accepting them means one key has several
		// distinct textual forms.
		expect(() => base64UrlToBytes("a+b/cd")).toThrow(/base64url/);
	});

	it("ATTACK: rejects non-canonical encodings that decode to the same bytes", () => {
		const canonical = bytesToBase64Url(new Uint8Array([0xff, 0xff]));
		expect(canonical).toBe("__8");
		// "__9" .. "__/" set trailing bits that the decoder used to silently drop, so
		// four different texts all decoded to [0xff, 0xff].
		for (const alias of ["__9", "__-", "___"]) {
			expect(() => base64UrlToBytes(alias)).toThrow(/canonical|padding bits/i);
		}
	});

	it("ATTACK: rejects a length that cannot come from any byte string", () => {
		// A 4n+1 group carries 6 bits: not a whole byte, so it is never valid.
		expect(() => base64UrlToBytes("AAAAA")).toThrow(/length/i);
	});

	it("ATTACK: rejects padding and whitespace rather than stripping it", () => {
		expect(() => base64UrlToBytes("AAA=")).toThrow();
		expect(() => base64UrlToBytes(" AA")).toThrow();
		expect(() => base64UrlToBytes("AA\n")).toThrow();
	});
});
