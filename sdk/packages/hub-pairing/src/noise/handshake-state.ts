/**
 * Noise `HandshakeState` (spec section 5.3), restricted to the IK family.
 *
 * Nothing in here is Cline-specific. It is validated byte-for-byte against the
 * official Cacophony test vectors in `vectors.test.ts`, which is the whole point
 * of implementing a *named published pattern* rather than an ad-hoc handshake.
 */

import { bytesEqual } from "../bytes.js";
import {
	AttestationRejectedError,
	HandshakeStateError,
	PeerKeyMismatchError,
} from "../errors.js";
import type { RandomSource } from "../random.js";
import type { CipherState } from "./cipher-state.js";
import type { HandshakePattern, Token } from "./patterns.js";
import { protocolName } from "./patterns.js";
import {
	DHLEN,
	dh,
	generateKeyPair,
	type KeyPair,
	publicKeyFromPrivateKey,
	TAGLEN,
} from "./primitives.js";
import { SymmetricState } from "./symmetric-state.js";

const EMPTY = new Uint8Array(0);

export interface HandshakeInit {
	readonly pattern: HandshakePattern;
	readonly initiator: boolean;
	readonly prologue: Uint8Array;
	/** Local static key pair. Required by every pattern in the IK family. */
	readonly staticKeyPair: KeyPair;
	/** Remote static public key: mandatory for the IK initiator, absent for the responder. */
	readonly remoteStaticPublicKey?: Uint8Array;
	/** Pre-shared key; mandatory when `pattern.usesPsk`. */
	readonly psk?: Uint8Array;
	/** Test-only ephemeral override, so published vectors can be reproduced exactly. */
	readonly ephemeralKeyPair?: KeyPair;
	readonly random?: RandomSource;
}

export interface HandshakeResult {
	/** Transport cipher for outbound frames. */
	readonly sendKey: Uint8Array;
	/** Transport cipher for inbound frames. */
	readonly recvKey: Uint8Array;
	/** Final transcript hash; safe to use as a channel binding / session id. */
	readonly handshakeHash: Uint8Array;
	/** The peer's authenticated static public key. */
	readonly remoteStaticPublicKey: Uint8Array;
}

export class HandshakeState {
	private readonly symmetric: SymmetricState;
	private readonly pattern: HandshakePattern;
	private readonly initiator: boolean;
	private readonly staticKeyPair: KeyPair;
	private readonly psk: Uint8Array | undefined;
	private readonly random: RandomSource | undefined;
	private readonly presetEphemeral: KeyPair | undefined;

	private ephemeral: KeyPair | undefined;
	private remoteStatic: Uint8Array | undefined;
	private remoteEphemeral: Uint8Array | undefined;
	private messageIndex = 0;
	private finished = false;
	/** Set on any error; a failed handshake is never resumable. */
	private failed = false;

	constructor(init: HandshakeInit) {
		this.pattern = init.pattern;
		this.initiator = init.initiator;
		this.staticKeyPair = init.staticKeyPair;
		this.random = init.random;
		this.presetEphemeral = init.ephemeralKeyPair;
		this.remoteStatic = init.remoteStaticPublicKey?.slice();

		if (this.pattern.usesPsk) {
			if (!init.psk || init.psk.length !== 32) {
				throw new HandshakeStateError(
					`Pattern ${this.pattern.name} requires a 32-byte pre-shared key`,
				);
			}
			this.psk = init.psk;
		} else if (init.psk) {
			throw new HandshakeStateError(
				`Pattern ${this.pattern.name} does not take a pre-shared key`,
			);
		}

		// The IK family sends the responder's static key as a pre-message, so the
		// initiator must already know it. Refusing here (rather than later) is what
		// stops a relay from steering us into an unauthenticated pattern.
		if (this.initiator && !this.remoteStatic) {
			throw new HandshakeStateError(
				`Pattern ${this.pattern.name} requires the responder's static public key`,
			);
		}

		this.symmetric = new SymmetricState(protocolName(this.pattern));
		this.symmetric.mixHash(init.prologue);

		// Pre-messages: initiator's keys first, then responder's (spec 7.1).
		for (const token of this.pattern.initiatorPreMessages) {
			this.symmetric.mixHash(this.preMessageKey(token, true));
		}
		for (const token of this.pattern.responderPreMessages) {
			this.symmetric.mixHash(this.preMessageKey(token, false));
		}
	}

	private preMessageKey(token: "s" | "e", forInitiator: boolean): Uint8Array {
		const isLocal = forInitiator === this.initiator;
		if (token === "s") {
			if (isLocal) {
				return this.staticKeyPair.publicKey;
			}
			if (!this.remoteStatic) {
				throw new HandshakeStateError(
					"Missing remote static key for pre-message",
				);
			}
			return this.remoteStatic;
		}
		if (isLocal) {
			if (!this.ephemeral) {
				throw new HandshakeStateError(
					"Missing local ephemeral for pre-message",
				);
			}
			return this.ephemeral.publicKey;
		}
		if (!this.remoteEphemeral) {
			throw new HandshakeStateError("Missing remote ephemeral for pre-message");
		}
		return this.remoteEphemeral;
	}

	/** True when it is this party's turn to call `writeMessage`. */
	get isMyTurn(): boolean {
		if (this.finished) {
			return false;
		}
		// Initiator writes even-indexed messages, responder writes odd ones.
		return this.initiator === (this.messageIndex % 2 === 0);
	}

	get handshakeFinished(): boolean {
		return this.finished;
	}

	/** The peer static key, available to the responder only after reading message 1. */
	get peerStaticPublicKey(): Uint8Array | undefined {
		return this.remoteStatic?.slice();
	}

	private currentPattern(): readonly Token[] {
		const message = this.pattern.messages[this.messageIndex];
		if (!message) {
			throw new HandshakeStateError("Handshake already complete");
		}
		return message;
	}

	private mixDh(local: Uint8Array, remote: Uint8Array): void {
		this.symmetric.mixKey(dh(local, remote));
	}

	/**
	 * Applies a DH token. `es`/`se` are asymmetric: which local key is used
	 * depends on whether we are the initiator (spec 5.3).
	 */
	private applyDhToken(token: Token): void {
		const localStatic = this.staticKeyPair.privateKey;
		const localEphemeral = this.ephemeral?.privateKey;

		const requireLocalEphemeral = (): Uint8Array => {
			if (!localEphemeral) {
				throw new HandshakeStateError("Local ephemeral key missing");
			}
			return localEphemeral;
		};
		const requireRemoteStatic = (): Uint8Array => {
			if (!this.remoteStatic) {
				throw new HandshakeStateError("Remote static key missing");
			}
			return this.remoteStatic;
		};
		const requireRemoteEphemeral = (): Uint8Array => {
			if (!this.remoteEphemeral) {
				throw new HandshakeStateError("Remote ephemeral key missing");
			}
			return this.remoteEphemeral;
		};

		switch (token) {
			case "ee":
				this.mixDh(requireLocalEphemeral(), requireRemoteEphemeral());
				return;
			case "ss":
				this.mixDh(localStatic, requireRemoteStatic());
				return;
			case "es":
				if (this.initiator) {
					this.mixDh(requireLocalEphemeral(), requireRemoteStatic());
				} else {
					this.mixDh(localStatic, requireRemoteEphemeral());
				}
				return;
			case "se":
				if (this.initiator) {
					this.mixDh(localStatic, requireRemoteEphemeral());
				} else {
					this.mixDh(requireLocalEphemeral(), requireRemoteStatic());
				}
				return;
			default:
				throw new HandshakeStateError(`Not a DH token: ${token}`);
		}
	}

	/**
	 * In a PSK handshake the ephemeral public key is mixed into the chaining key
	 * as well as the transcript hash (spec section 9). Getting this wrong is
	 * exactly the kind of bug the Cacophony vectors catch.
	 */
	private processEphemeralPublicKey(publicKey: Uint8Array): void {
		this.symmetric.mixHash(publicKey);
		if (this.pattern.usesPsk) {
			this.symmetric.mixKey(publicKey);
		}
	}

	writeMessage(payload: Uint8Array = EMPTY): {
		message: Uint8Array;
		result?: HandshakeResult;
	} {
		this.assertUsable();
		try {
			return this.writeMessageUnguarded(payload);
		} catch (error) {
			this.failed = true;
			throw error;
		}
	}

	private writeMessageUnguarded(payload: Uint8Array): {
		message: Uint8Array;
		result?: HandshakeResult;
	} {
		if (!this.isMyTurn) {
			throw new HandshakeStateError("Not this party's turn to write");
		}
		const tokens = this.currentPattern();
		const parts: Uint8Array[] = [];

		for (const token of tokens) {
			switch (token) {
				case "e": {
					this.ephemeral = this.presetEphemeral ?? generateKeyPair(this.random);
					parts.push(this.ephemeral.publicKey);
					this.processEphemeralPublicKey(this.ephemeral.publicKey);
					break;
				}
				case "s": {
					parts.push(
						this.symmetric.encryptAndHash(this.staticKeyPair.publicKey),
					);
					break;
				}
				case "psk": {
					if (!this.psk) {
						throw new HandshakeStateError("Missing pre-shared key");
					}
					this.symmetric.mixKeyAndHash(this.psk);
					break;
				}
				default:
					this.applyDhToken(token);
			}
		}

		parts.push(this.symmetric.encryptAndHash(payload));
		this.messageIndex += 1;

		let total = 0;
		for (const part of parts) {
			total += part.length;
		}
		const message = new Uint8Array(total);
		let offset = 0;
		for (const part of parts) {
			message.set(part, offset);
			offset += part.length;
		}

		return { message, result: this.maybeFinish() };
	}

	/**
	 * Reads one handshake message. Any failure marks the whole handshake dead: the
	 * transcript hash, chaining key and remote ephemeral have already absorbed
	 * whatever the peer sent, so continuing — even with a genuine retry of the same
	 * message — would run against attacker-influenced state. A poisoned handshake
	 * fails fast on every later call instead.
	 */
	readMessage(message: Uint8Array): {
		payload: Uint8Array;
		result?: HandshakeResult;
	} {
		this.assertUsable();
		try {
			return this.readMessageUnguarded(message);
		} catch (error) {
			this.failed = true;
			throw error;
		}
	}

	private assertUsable(): void {
		if (this.failed) {
			throw new HandshakeStateError(
				"Handshake failed earlier and cannot be reused; start a new one",
			);
		}
		if (this.finished) {
			throw new HandshakeStateError("Handshake already complete");
		}
	}

	private readMessageUnguarded(message: Uint8Array): {
		payload: Uint8Array;
		result?: HandshakeResult;
	} {
		if (this.isMyTurn) {
			throw new HandshakeStateError("Not this party's turn to read");
		}
		const tokens = this.currentPattern();
		let cursor = message;

		const take = (length: number): Uint8Array => {
			if (cursor.length < length) {
				// A truncated handshake message is an authentication failure as far as
				// callers are concerned; do not leak which field ran short.
				throw new AttestationRejectedError();
			}
			const head = cursor.subarray(0, length);
			cursor = cursor.subarray(length);
			return head;
		};

		for (const token of tokens) {
			switch (token) {
				case "e": {
					const publicKey = take(DHLEN).slice();
					this.remoteEphemeral = publicKey;
					this.processEphemeralPublicKey(publicKey);
					break;
				}
				case "s": {
					const hasKey = this.symmetric.cipherState.hasKey();
					const encrypted = take(hasKey ? DHLEN + TAGLEN : DHLEN);
					const decrypted = this.symmetric.decryptAndHash(encrypted);
					if (decrypted.length !== DHLEN) {
						throw new AttestationRejectedError();
					}
					// If the caller pinned a peer static key, the transmitted key must
					// match it. This is the reconnection check: a relay that swaps in its
					// own key is rejected before any transport frame is accepted.
					if (this.remoteStatic && !bytesEqual(this.remoteStatic, decrypted)) {
						throw new PeerKeyMismatchError();
					}
					this.remoteStatic = decrypted.slice();
					break;
				}
				case "psk": {
					if (!this.psk) {
						throw new HandshakeStateError("Missing pre-shared key");
					}
					this.symmetric.mixKeyAndHash(this.psk);
					break;
				}
				default:
					this.applyDhToken(token);
			}
		}

		const payload = this.symmetric.decryptAndHash(cursor);
		this.messageIndex += 1;
		return { payload, result: this.maybeFinish() };
	}

	private maybeFinish(): HandshakeResult | undefined {
		if (this.messageIndex < this.pattern.messages.length) {
			return undefined;
		}
		// Authenticate the peer BEFORE marking the handshake finished or deriving
		// transport keys, so an unauthenticated peer can never yield a completed
		// state that a caller might mistake for a usable session.
		if (!this.remoteStatic) {
			throw new HandshakeStateError(
				"Handshake completed without an authenticated peer static key",
			);
		}
		this.finished = true;
		const { sendKey, recvKey } = this.symmetric.split();
		// Split() returns (initiator->responder, responder->initiator); the
		// responder therefore swaps them. This is what keeps the two directions on
		// distinct keys so a captured frame cannot be replayed back the other way.
		return {
			sendKey: this.initiator ? sendKey : recvKey,
			recvKey: this.initiator ? recvKey : sendKey,
			handshakeHash: this.symmetric.getHandshakeHash(),
			remoteStaticPublicKey: this.remoteStatic.slice(),
		};
	}

	/** Exposed for the vector tests, which assert the transcript hash. */
	getHandshakeHash(): Uint8Array {
		return this.symmetric.getHandshakeHash();
	}

	/** Exposed for the vector tests, which continue encrypting after Split(). */
	get handshakeCipherState(): CipherState {
		return this.symmetric.cipherState;
	}

	static staticKeyPairFromPrivateKey(privateKey: Uint8Array): KeyPair {
		return { privateKey, publicKey: publicKeyFromPrivateKey(privateKey) };
	}
}
