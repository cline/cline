/**
 * Device identity: an X25519 static key pair plus stable, human-comparable
 * names derived from the public key.
 *
 * Both ends keep their private key forever (laptop: 0600 file; phone: Keychain /
 * SecureStore) and pin the peer's public key at pairing time. The fingerprint
 * exists so a user can eyeball that the laptop and the phone agree.
 */
import {
	bytesToBase32,
	bytesToBase64Url,
	concatBytes,
	utf8ToBytes,
} from "./bytes.js";
import { generateKeyPair, hash, type KeyPair } from "./noise/primitives.js";
import type { RandomSource } from "./random.js";

export type DeviceKeyPair = KeyPair;

const DEVICE_ID_DOMAIN = utf8ToBytes("cline-hub-device-id/v1");
const FINGERPRINT_DOMAIN = utf8ToBytes("cline-hub-fingerprint/v1");

/** Bytes of digest used for the device id: 10 bytes -> 16 base32 chars. */
const DEVICE_ID_BYTES = 10;
/** Bytes of digest shown as a fingerprint: 10 bytes -> 80 bits, 5 groups of 4. */
const FINGERPRINT_BYTES = 10;

export function generateDeviceKeyPair(random?: RandomSource): DeviceKeyPair {
	return generateKeyPair(random);
}

/**
 * Stable registry key for a public key. Domain-separated from the fingerprint so
 * knowing one never reveals the other's preimage structure.
 */
export function deviceIdFromPublicKey(publicKey: Uint8Array): string {
	const digest = hash(concatBytes(DEVICE_ID_DOMAIN, publicKey));
	return bytesToBase32(digest.subarray(0, DEVICE_ID_BYTES));
}

/**
 * Short human-comparable identity, e.g. `K7QM-3X9P-R2VT-8HW4-N5DB`.
 * 80 bits of a SHA-256 digest: far beyond what an attacker can grind to collide
 * for a display-only check, and short enough to read aloud.
 */
export function deviceFingerprint(publicKey: Uint8Array): string {
	const digest = hash(concatBytes(FINGERPRINT_DOMAIN, publicKey));
	const encoded = bytesToBase32(digest.subarray(0, FINGERPRINT_BYTES));
	return (encoded.match(/.{1,4}/g) ?? [encoded]).join("-");
}

/** Canonical wire/storage form of a public key. */
export function encodePublicKey(publicKey: Uint8Array): string {
	return bytesToBase64Url(publicKey);
}
