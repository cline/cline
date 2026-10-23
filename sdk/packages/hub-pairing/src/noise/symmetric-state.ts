/**
 * Noise `SymmetricState` (spec section 5.2).
 *
 * `h` is the running transcript hash: every public key, every ciphertext and the
 * prologue are folded into it, and it is used as the AEAD associated data. That
 * is what binds the handshake to its context (our prologue carries the protocol
 * version and hub URL) and makes downgrade/substitution attacks fail.
 */
import { concatBytes, utf8ToBytes } from "../bytes.js";
import { CipherState } from "./cipher-state.js";
import { HASHLEN, hash, KEYLEN, noiseHkdf } from "./primitives.js";

const EMPTY = new Uint8Array(0);

export class SymmetricState {
	readonly cipherState: CipherState;
	private chainingKey: Uint8Array;
	private handshakeHash: Uint8Array;

	constructor(protocolName: string) {
		const nameBytes = utf8ToBytes(protocolName);
		if (nameBytes.length <= HASHLEN) {
			const padded = new Uint8Array(HASHLEN);
			padded.set(nameBytes);
			this.handshakeHash = padded;
		} else {
			this.handshakeHash = hash(nameBytes);
		}
		this.chainingKey = this.handshakeHash.slice();
		this.cipherState = new CipherState(undefined);
	}

	/** Noise `MixKey`. */
	mixKey(inputKeyMaterial: Uint8Array): void {
		const [nextChainingKey, tempKey] = noiseHkdf(
			this.chainingKey,
			inputKeyMaterial,
			2,
		);
		this.chainingKey = nextChainingKey as Uint8Array;
		this.cipherState.initializeKey((tempKey as Uint8Array).subarray(0, KEYLEN));
	}

	/** Noise `MixHash`. */
	mixHash(data: Uint8Array): void {
		this.handshakeHash = hash(concatBytes(this.handshakeHash, data));
	}

	/** Noise `MixKeyAndHash`, used only by the `psk` token. */
	mixKeyAndHash(inputKeyMaterial: Uint8Array): void {
		const [nextChainingKey, tempHash, tempKey] = noiseHkdf(
			this.chainingKey,
			inputKeyMaterial,
			3,
		);
		this.chainingKey = nextChainingKey as Uint8Array;
		this.mixHash(tempHash as Uint8Array);
		this.cipherState.initializeKey((tempKey as Uint8Array).subarray(0, KEYLEN));
	}

	/** Noise `GetHandshakeHash`. */
	getHandshakeHash(): Uint8Array {
		return this.handshakeHash.slice();
	}

	/** Noise `EncryptAndHash`. */
	encryptAndHash(plaintext: Uint8Array): Uint8Array {
		const ciphertext = this.cipherState.encryptWithAd(
			this.handshakeHash,
			plaintext,
		);
		this.mixHash(ciphertext);
		return ciphertext;
	}

	/** Noise `DecryptAndHash`. */
	decryptAndHash(ciphertext: Uint8Array): Uint8Array {
		const plaintext = this.cipherState.decryptWithAd(
			this.handshakeHash,
			ciphertext,
		);
		this.mixHash(ciphertext);
		return plaintext;
	}

	/** Noise `Split`: the two directional transport keys. */
	split(): { sendKey: Uint8Array; recvKey: Uint8Array } {
		const [tempKey1, tempKey2] = noiseHkdf(this.chainingKey, EMPTY, 2);
		return {
			sendKey: (tempKey1 as Uint8Array).subarray(0, KEYLEN),
			recvKey: (tempKey2 as Uint8Array).subarray(0, KEYLEN),
		};
	}
}
