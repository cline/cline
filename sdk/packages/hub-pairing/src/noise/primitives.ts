/**
 * Noise crypto primitives for the `25519_ChaChaPoly_SHA256` suite.
 *
 * Backed entirely by @noble (audited, pure JS, no native modules and no WASM) so
 * the same code runs on Hermes and Node. Nothing here is Cline-specific; it is a
 * direct realisation of the DH/CIPHER/HASH functions in the Noise spec (rev 34).
 */
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes } from "../bytes.js";
import { type RandomSource, randomBytes } from "../random.js";

/** Noise `DHLEN` for 25519. */
export const DHLEN = 32;
/** Noise `HASHLEN` for SHA256. */
export const HASHLEN = 32;
/** ChaCha20-Poly1305 authentication tag length. */
export const TAGLEN = 16;
/** Noise symmetric key length. */
export const KEYLEN = 32;

export interface KeyPair {
	readonly privateKey: Uint8Array;
	readonly publicKey: Uint8Array;
}

export function generateKeyPair(random?: RandomSource): KeyPair {
	// Deliberately seeded from our injectable source rather than noble's internal
	// RNG so a caller can supply a vetted CSPRNG (and tests can be deterministic).
	const privateKey = randomBytes(DHLEN, random);
	return { privateKey, publicKey: x25519.getPublicKey(privateKey) };
}

export function publicKeyFromPrivateKey(privateKey: Uint8Array): Uint8Array {
	return x25519.getPublicKey(privateKey);
}

/** Noise `DH(keypair, public_key)`. */
export function dh(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
	return x25519.getSharedSecret(privateKey, publicKey);
}

/** Noise `HASH(data)`. */
export function hash(data: Uint8Array): Uint8Array {
	return sha256(data);
}

export function hmacHash(key: Uint8Array, data: Uint8Array): Uint8Array {
	return hmac(sha256, key, data);
}

/**
 * Noise `HKDF(chaining_key, input_key_material, num_outputs)` (spec section 4.3).
 * This is *not* RFC 5869 HKDF-Expand with an info string; Noise fixes the info
 * to the single bytes 0x01/0x02/0x03, so it is spelled out here rather than
 * borrowed from @noble/hashes' generic `hkdf`.
 */
export function noiseHkdf(
	chainingKey: Uint8Array,
	inputKeyMaterial: Uint8Array,
	numOutputs: 2 | 3,
): Uint8Array[] {
	const tempKey = hmacHash(chainingKey, inputKeyMaterial);
	const output1 = hmacHash(tempKey, new Uint8Array([0x01]));
	const output2 = hmacHash(
		tempKey,
		concatBytes(output1, new Uint8Array([0x02])),
	);
	if (numOutputs === 2) {
		return [output1, output2];
	}
	const output3 = hmacHash(
		tempKey,
		concatBytes(output2, new Uint8Array([0x03])),
	);
	return [output1, output2, output3];
}

/**
 * Noise nonce encoding for ChaChaPoly (spec section 12.3): 12 bytes, made of
 * four zero bytes followed by the 64-bit counter in little-endian order.
 */
export function chachaNonce(counter: bigint): Uint8Array {
	const nonce = new Uint8Array(12);
	let remaining = counter;
	for (let index = 4; index < 12; index += 1) {
		nonce[index] = Number(remaining & 0xffn);
		remaining >>= 8n;
	}
	return nonce;
}

export function aeadEncrypt(
	key: Uint8Array,
	counter: bigint,
	associatedData: Uint8Array,
	plaintext: Uint8Array,
): Uint8Array {
	return chacha20poly1305(key, chachaNonce(counter), associatedData).encrypt(
		plaintext,
	);
}

/** Throws (from @noble) when the Poly1305 tag does not verify. */
export function aeadDecrypt(
	key: Uint8Array,
	counter: bigint,
	associatedData: Uint8Array,
	ciphertext: Uint8Array,
): Uint8Array {
	return chacha20poly1305(key, chachaNonce(counter), associatedData).decrypt(
		ciphertext,
	);
}
