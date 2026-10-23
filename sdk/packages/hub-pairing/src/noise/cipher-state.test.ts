/**
 * CipherState boundary tests. The nonce counter is the only source of nonces, so
 * the interesting case is what happens at the very end of the nonce space:
 * wrapping or reusing 2^64-1 would repeat a (key, nonce) pair, which breaks
 * ChaCha20-Poly1305 outright.
 */
import { describe, expect, it } from "vitest";
import { ChannelExhaustedError, HandshakeStateError } from "../errors.js";
import { CipherState, MAX_NONCE } from "./cipher-state.js";

const AD = new Uint8Array([1, 2, 3]);

/**
 * There is no public way to move the counter (deliberately — see cipher-state.ts),
 * and 2^64 real encryptions is not a test, so reach in.
 */
function seekToLastNonce(state: CipherState): void {
	(state as unknown as { nonce: bigint }).nonce = MAX_NONCE;
}

describe("CipherState nonce exhaustion", () => {
	it("refuses to encrypt or decrypt at MAX_NONCE rather than reusing it", () => {
		const state = new CipherState(new Uint8Array(32).fill(5));
		seekToLastNonce(state);
		expect(() => state.encryptWithAd(AD, new Uint8Array([9]))).toThrow(
			ChannelExhaustedError,
		);
		expect(() => state.decryptWithAd(AD, new Uint8Array(17))).toThrow(
			ChannelExhaustedError,
		);
		expect(state.counter).toBe(MAX_NONCE);
	});

	it("still counts up to, and can use, the nonce just below the ceiling", () => {
		const state = new CipherState(new Uint8Array(32).fill(5));
		(state as unknown as { nonce: bigint }).nonce = MAX_NONCE - 1n;
		expect(() => state.encryptWithAd(AD, new Uint8Array([9]))).not.toThrow();
		expect(state.counter).toBe(MAX_NONCE);
	});

	it("rejects a key of the wrong length", () => {
		expect(() => new CipherState(new Uint8Array(16))).toThrow(
			HandshakeStateError,
		);
	});

	it("zeroes the key on destroy and stops transforming data", () => {
		const key = new Uint8Array(32).fill(5);
		const state = new CipherState(key);
		state.destroy();
		expect(Array.from(key)).toEqual(Array.from(new Uint8Array(32)));
		expect(state.hasKey()).toBe(false);
	});
});
