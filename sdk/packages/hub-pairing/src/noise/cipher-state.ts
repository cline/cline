/**
 * Noise `CipherState` (spec section 5.1).
 *
 * Owns a symmetric key plus its monotonic 64-bit nonce counter. The counter is
 * the *only* source of nonces — it is never randomised and never reset — which
 * is what makes replay/reorder detection in the transport layer sound.
 */
import {
	ChannelExhaustedError,
	FrameAuthenticationError,
	HandshakeStateError,
} from "../errors.js";
import { aeadDecrypt, aeadEncrypt, KEYLEN } from "./primitives.js";

/** Noise `MAXNONCE`: 2^64 - 1 is reserved, so 2^64 - 1 is the refusal point. */
export const MAX_NONCE = (1n << 64n) - 1n;

export class CipherState {
	private key: Uint8Array | undefined;
	private nonce = 0n;

	constructor(key?: Uint8Array) {
		this.initializeKey(key);
	}

	initializeKey(key: Uint8Array | undefined): void {
		if (key !== undefined && key.length !== KEYLEN) {
			throw new HandshakeStateError(
				`CipherState key must be ${KEYLEN} bytes, got ${key.length}`,
			);
		}
		this.key = key;
		this.nonce = 0n;
	}

	hasKey(): boolean {
		return this.key !== undefined;
	}

	/** Current counter value; the transport layer publishes this for diagnostics. */
	get counter(): bigint {
		return this.nonce;
	}

	private assertNonceAvailable(): void {
		if (this.nonce >= MAX_NONCE) {
			throw new ChannelExhaustedError();
		}
	}

	/** Noise `EncryptWithAd`. Returns the plaintext untouched when unkeyed. */
	encryptWithAd(associatedData: Uint8Array, plaintext: Uint8Array): Uint8Array {
		if (this.key === undefined) {
			return plaintext;
		}
		this.assertNonceAvailable();
		const ciphertext = aeadEncrypt(
			this.key,
			this.nonce,
			associatedData,
			plaintext,
		);
		this.nonce += 1n;
		return ciphertext;
	}

	/**
	 * Noise `DecryptWithAd`. On authentication failure the nonce is deliberately
	 * NOT advanced, per spec: the receiver must be able to retry the same counter
	 * with the correct ciphertext, and a forged frame must not desynchronise us.
	 */
	decryptWithAd(
		associatedData: Uint8Array,
		ciphertext: Uint8Array,
	): Uint8Array {
		if (this.key === undefined) {
			return ciphertext;
		}
		this.assertNonceAvailable();
		let plaintext: Uint8Array;
		try {
			plaintext = aeadDecrypt(this.key, this.nonce, associatedData, ciphertext);
		} catch {
			throw new FrameAuthenticationError();
		}
		this.nonce += 1n;
		return plaintext;
	}

	/**
	 * Noise's `SetNonce`, `DecryptWithAd`-at-an-explicit-counter and `Rekey` are
	 * deliberately absent. Nothing in this package needs them, and on a class that
	 * holds live transport keys an externally settable nonce is a nonce-reuse
	 * footgun: the transport layer's replay/reorder classification depends on the
	 * counter being the sole, monotonic source of nonces.
	 */

	/** Zero the key material once a channel is closed or a device is revoked. */
	destroy(): void {
		if (this.key) {
			this.key.fill(0);
		}
		this.key = undefined;
	}
}
