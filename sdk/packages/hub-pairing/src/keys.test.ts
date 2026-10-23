import { describe, expect, it, vi } from "vitest";
import { deterministicRandom } from "./__tests__/support.js";
import { bytesEqual } from "./bytes.js";
import {
	deviceFingerprint,
	deviceIdFromPublicKey,
	encodePublicKey,
	generateDeviceKeyPair,
} from "./keys.js";
import { publicKeyFromPrivateKey } from "./noise/primitives.js";
import { defaultRandomSource, randomBytes } from "./random.js";

describe("device keys", () => {
	it("generates a 32-byte X25519 pair whose public key derives from the private", () => {
		const keyPair = generateDeviceKeyPair();
		expect(keyPair.privateKey.length).toBe(32);
		expect(keyPair.publicKey.length).toBe(32);
		expect(
			bytesEqual(
				publicKeyFromPrivateKey(keyPair.privateKey),
				keyPair.publicKey,
			),
		).toBe(true);
	});

	it("generates distinct keys on each call", () => {
		const seen = new Set<string>();
		for (let index = 0; index < 20; index += 1) {
			seen.add(encodePublicKey(generateDeviceKeyPair().publicKey));
		}
		expect(seen.size).toBe(20);
	});

	it("is deterministic when given a deterministic random source", () => {
		const first = generateDeviceKeyPair(deterministicRandom("seed"));
		const second = generateDeviceKeyPair(deterministicRandom("seed"));
		expect(bytesEqual(first.publicKey, second.publicKey)).toBe(true);
	});
});

describe("device identity", () => {
	it("derives a stable device id from a public key", () => {
		const keyPair = generateDeviceKeyPair(deterministicRandom("d1"));
		const first = deviceIdFromPublicKey(keyPair.publicKey);
		expect(deviceIdFromPublicKey(keyPair.publicKey)).toBe(first);
		expect(first).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/);
	});

	it("gives different keys different ids", () => {
		const ids = new Set<string>();
		for (let index = 0; index < 20; index += 1) {
			ids.add(deviceIdFromPublicKey(generateDeviceKeyPair().publicKey));
		}
		expect(ids.size).toBe(20);
	});

	it("formats a human-comparable fingerprint", () => {
		const keyPair = generateDeviceKeyPair(deterministicRandom("d1"));
		const fingerprint = deviceFingerprint(keyPair.publicKey);
		expect(fingerprint).toMatch(
			/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/,
		);
		// Excludes I, L, O and U so it cannot be misread aloud.
		expect(fingerprint).not.toMatch(/[ILOU]/);
	});

	it("domain-separates the id from the fingerprint", () => {
		const keyPair = generateDeviceKeyPair(deterministicRandom("d1"));
		const id = deviceIdFromPublicKey(keyPair.publicKey);
		const fingerprint = deviceFingerprint(keyPair.publicKey).replace(/-/g, "");
		expect(id).not.toBe(fingerprint);
	});

	it("changes the fingerprint if any key bit changes", () => {
		const keyPair = generateDeviceKeyPair(deterministicRandom("d1"));
		const original = deviceFingerprint(keyPair.publicKey);
		const flipped = keyPair.publicKey.slice();
		flipped[0] = (flipped[0] as number) ^ 0x01;
		expect(deviceFingerprint(flipped)).not.toBe(original);
	});
});

describe("random source", () => {
	it("uses globalThis.crypto.getRandomValues by default", () => {
		// Asserting the length only would pass on a source that returned zeroes, so
		// assert the CSPRNG was actually the thing that filled the buffer.
		const real = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
		const spy = vi
			.spyOn(globalThis.crypto, "getRandomValues")
			.mockImplementation((array) => real(array));
		try {
			expect(defaultRandomSource(16).length).toBe(16);
			expect(spy).toHaveBeenCalledTimes(1);
			expect((spy.mock.calls[0]?.[0] as Uint8Array).length).toBe(16);
			expect(randomBytes(8).length).toBe(8);
			expect(spy).toHaveBeenCalledTimes(2);
		} finally {
			spy.mockRestore();
		}
	});

	it("rejects a random source that short-reads", () => {
		expect(() => randomBytes(32, () => new Uint8Array(16))).toThrow(
			/expected 32/,
		);
	});

	it("never falls back to a weak source when crypto is missing", () => {
		const original = globalThis.crypto;
		try {
			Object.defineProperty(globalThis, "crypto", {
				value: undefined,
				configurable: true,
			});
			// Failing loudly is the only safe behaviour: silently degrading to
			// Math.random would make every pairing secret guessable.
			expect(() => defaultRandomSource(32)).toThrow(/No CSPRNG available/);
		} finally {
			Object.defineProperty(globalThis, "crypto", {
				value: original,
				configurable: true,
			});
		}
	});
});
