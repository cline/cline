/**
 * The end-to-end encrypted transport that wraps Hub protocol v1 JSON frames.
 *
 * Keys come out of a completed Noise handshake `Split()`, so the two directions
 * already have independent keys — a frame the relay captures from the phone can
 * never be replayed at the laptop as if the laptop had sent it.
 *
 * Wire format (header is authenticated as AEAD associated data):
 *
 *   byte  0        magic 0xC1
 *   byte  1        wire version (0x01)
 *   bytes 2..10    frame counter, u64 big-endian
 *   bytes 10..     ChaCha20-Poly1305 ciphertext || 16-byte tag
 *
 * Because the header is the AD, flipping the version or the counter fails
 * authentication rather than silently changing interpretation. The counter is
 * carried explicitly (Noise keeps it implicit) purely so a receiver can tell a
 * *replay* from a *reorder* and report a typed error; it is still enforced
 * strictly, so a relay that drops, duplicates or reorders frames is detected.
 */
import { bytesEqual, bytesToUtf8, utf8ToBytes } from "./bytes.js";
import {
	ChannelClosedError,
	ChannelKeyError,
	FrameAuthenticationError,
	FrameMalformedError,
	FrameOutOfOrderError,
	FrameReplayError,
	FrameTooLargeError,
} from "./errors.js";
import { CipherState } from "./noise/cipher-state.js";
import { KEYLEN, TAGLEN } from "./noise/primitives.js";

export const FRAME_MAGIC = 0xc1;
export const FRAME_WIRE_VERSION = 0x01;
export const FRAME_HEADER_LENGTH = 10;

/** Noise's ceiling on a single transport message, which we apply to the whole frame. */
export const MAX_FRAME_SIZE = 65535;

/**
 * Noise caps a single transport message at 65535 bytes. We hold the *entire
 * frame* — our 10-byte header, the ciphertext and the 16-byte tag — under that
 * ceiling, so a frame always fits a u16 length prefix and never exceeds what a
 * Noise-conformant transport will carry. Larger hub payloads must be chunked by
 * the caller (left to the transport wave) or the limit raised explicitly via
 * `maxPlaintextSize`.
 */
export const DEFAULT_MAX_PLAINTEXT_SIZE =
	MAX_FRAME_SIZE - FRAME_HEADER_LENGTH - TAGLEN;

export type ChannelRole = "hub" | "device";

export interface SecureChannelInit {
	/** Outbound transport key from the handshake result. */
	readonly sendKey: Uint8Array;
	/** Inbound transport key from the handshake result. */
	readonly recvKey: Uint8Array;
	readonly role: ChannelRole;
	/** Transcript hash of the handshake; doubles as a session binding value. */
	readonly handshakeHash?: Uint8Array;
	/** Authenticated peer static public key. */
	readonly peerPublicKey?: Uint8Array;
	readonly maxPlaintextSize?: number;
}

export interface SecureChannel {
	readonly role: ChannelRole;
	readonly peerPublicKey: Uint8Array | undefined;
	readonly handshakeHash: Uint8Array | undefined;
	readonly closed: boolean;
	/** Counter that will be used by the next `encryptFrame`. */
	readonly sendCounter: bigint;
	/** Counter the next inbound frame must carry. */
	readonly recvCounter: bigint;
	encryptFrame(plaintextJson: unknown): Uint8Array;
	decryptFrame(frame: Uint8Array): unknown;
	/** Encrypt/decrypt raw bytes, for callers not using JSON. */
	encryptBytes(plaintext: Uint8Array): Uint8Array;
	decryptBytes(frame: Uint8Array): Uint8Array;
	/** Irreversibly zeroes key material. Used on disconnect and on revocation. */
	close(): void;
}

function isAllZero(value: Uint8Array): boolean {
	let bits = 0;
	for (const byte of value) {
		bits |= byte;
	}
	return bits === 0;
}

/**
 * A real `Split()` yields two distinct 32-byte keys, so anything else means the
 * caller handed us destroyed or fabricated material. Rejecting it here turns the
 * worst possible failure (encrypting under an all-zero key) into a loud error.
 */
function assertUsableTransportKeys(
	sendKey: Uint8Array,
	recvKey: Uint8Array,
): void {
	for (const [name, key] of [
		["sendKey", sendKey],
		["recvKey", recvKey],
	] as const) {
		if (key.length !== KEYLEN) {
			throw new ChannelKeyError(
				`${name} must be ${KEYLEN} bytes, got ${key.length}`,
			);
		}
		if (isAllZero(key)) {
			throw new ChannelKeyError(
				`${name} is all zeroes; the handshake result was destroyed or never populated`,
			);
		}
	}
	if (bytesEqual(sendKey, recvKey)) {
		throw new ChannelKeyError(
			"sendKey and recvKey are identical; directional key separation is lost",
		);
	}
}

function writeHeader(counter: bigint): Uint8Array {
	const header = new Uint8Array(FRAME_HEADER_LENGTH);
	header[0] = FRAME_MAGIC;
	header[1] = FRAME_WIRE_VERSION;
	let remaining = counter;
	for (let index = FRAME_HEADER_LENGTH - 1; index >= 2; index -= 1) {
		header[index] = Number(remaining & 0xffn);
		remaining >>= 8n;
	}
	return header;
}

function readCounter(header: Uint8Array): bigint {
	let counter = 0n;
	for (let index = 2; index < FRAME_HEADER_LENGTH; index += 1) {
		counter = (counter << 8n) | BigInt(header[index] as number);
	}
	return counter;
}

class NoiseSecureChannel implements SecureChannel {
	readonly role: ChannelRole;
	readonly peerPublicKey: Uint8Array | undefined;
	readonly handshakeHash: Uint8Array | undefined;

	private readonly send: CipherState;
	private readonly recv: CipherState;
	private readonly maxPlaintextSize: number;
	private isClosed = false;

	constructor(init: SecureChannelInit) {
		assertUsableTransportKeys(init.sendKey, init.recvKey);
		this.role = init.role;
		this.peerPublicKey = init.peerPublicKey?.slice();
		this.handshakeHash = init.handshakeHash?.slice();
		// Defensive copies: `close()` zeroizes the channel's OWN key material, and
		// must never reach through into the caller's `HandshakeResult` (or into a
		// sibling channel built from the same result).
		this.send = new CipherState(init.sendKey.slice());
		this.recv = new CipherState(init.recvKey.slice());
		this.maxPlaintextSize = init.maxPlaintextSize ?? DEFAULT_MAX_PLAINTEXT_SIZE;
	}

	get closed(): boolean {
		return this.isClosed;
	}

	get sendCounter(): bigint {
		return this.send.counter;
	}

	get recvCounter(): bigint {
		return this.recv.counter;
	}

	private assertOpen(): void {
		if (this.isClosed) {
			throw new ChannelClosedError();
		}
	}

	encryptBytes(plaintext: Uint8Array): Uint8Array {
		this.assertOpen();
		if (plaintext.length > this.maxPlaintextSize) {
			throw new FrameTooLargeError(
				`Plaintext of ${plaintext.length} bytes exceeds the ${this.maxPlaintextSize}-byte limit`,
			);
		}
		const header = writeHeader(this.send.counter);
		const ciphertext = this.send.encryptWithAd(header, plaintext);
		const frame = new Uint8Array(header.length + ciphertext.length);
		frame.set(header, 0);
		frame.set(ciphertext, header.length);
		return frame;
	}

	decryptBytes(frame: Uint8Array): Uint8Array {
		this.assertOpen();

		const maxFrameSize = FRAME_HEADER_LENGTH + this.maxPlaintextSize + TAGLEN;
		if (frame.length > maxFrameSize) {
			// Checked before any crypto so an oversized frame cannot be used to make
			// us allocate or spend CPU.
			throw new FrameTooLargeError(
				`Frame of ${frame.length} bytes exceeds the ${maxFrameSize}-byte limit`,
			);
		}
		if (frame.length < FRAME_HEADER_LENGTH + TAGLEN) {
			throw new FrameMalformedError(
				`Frame of ${frame.length} bytes is shorter than the minimum ${
					FRAME_HEADER_LENGTH + TAGLEN
				}`,
			);
		}

		const header = frame.subarray(0, FRAME_HEADER_LENGTH);
		if (header[0] !== FRAME_MAGIC) {
			throw new FrameMalformedError("Frame magic mismatch");
		}
		if (header[1] !== FRAME_WIRE_VERSION) {
			throw new FrameMalformedError(
				`Unsupported frame wire version ${header[1]}; expected ${FRAME_WIRE_VERSION}`,
			);
		}

		const counter = readCounter(header);
		const expected = this.recv.counter;
		if (counter < expected) {
			throw new FrameReplayError(
				`Frame counter ${counter} was already consumed (expected ${expected})`,
			);
		}
		if (counter > expected) {
			throw new FrameOutOfOrderError(
				`Frame counter ${counter} arrived before ${expected}`,
			);
		}

		const ciphertext = frame.subarray(FRAME_HEADER_LENGTH);
		// decryptWithAd leaves the counter untouched on failure, so a forged frame
		// cannot desynchronise a healthy channel.
		return this.recv.decryptWithAd(header, ciphertext);
	}

	encryptFrame(plaintextJson: unknown): Uint8Array {
		const serialized = JSON.stringify(plaintextJson);
		if (serialized === undefined) {
			throw new FrameMalformedError("Frame payload is not JSON-serialisable");
		}
		return this.encryptBytes(utf8ToBytes(serialized));
	}

	decryptFrame(frame: Uint8Array): unknown {
		const plaintext = this.decryptBytes(frame);
		const text = bytesToUtf8(plaintext);
		try {
			return JSON.parse(text) as unknown;
		} catch {
			// Authenticated but not valid JSON: the peer is buggy, not hostile.
			throw new FrameMalformedError("Frame payload is not valid JSON");
		}
	}

	close(): void {
		if (this.isClosed) {
			return;
		}
		this.isClosed = true;
		this.send.destroy();
		this.recv.destroy();
	}
}

/**
 * Build a channel from a completed Noise handshake. The pairing and reconnect
 * helpers call this for you; it is exported so the transport wave can rebuild a
 * channel from keys it already holds.
 *
 * `HandshakeResult` reuse semantics: the caller's key arrays are COPIED, so the
 * result stays usable after a channel built from it is closed, and `close()`
 * only ever zeroizes that channel's private copies. A caller that wants the
 * handshake result itself scrubbed must zero it explicitly — after which any
 * further `createSecureChannel` on it throws `ChannelKeyError` rather than
 * quietly encrypting under zeroes.
 *
 * Note that two live channels from one result share transport keys and therefore
 * share a nonce space; that is only safe when exactly one of them is used per
 * direction (e.g. rebuilding a channel after handing the keys across a process
 * boundary). It is never correct to run two channels on the same keys
 * concurrently.
 */
export function createSecureChannel(init: SecureChannelInit): SecureChannel {
	return new NoiseSecureChannel(init);
}

export { FrameAuthenticationError };
