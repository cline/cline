/**
 * Validates our Noise implementation against the official Cacophony test
 * vectors (the vector set used by snow/noise-c/flynn-noise).
 *
 * This is the load-bearing test for the whole package: it proves the handshake
 * is the *published* Noise_IK / Noise_IKpsk1 / Noise_IKpsk2 construction rather
 * than something we invented, down to the transcript hash and every ciphertext
 * byte including the post-Split transport messages.
 */
import { describe, expect, it } from "vitest";
import { bytesToHex, hexToBytes } from "../bytes.js";
import vectorFile from "./cacophony-vectors.json" with { type: "json" };
import { CipherState } from "./cipher-state.js";
import { HandshakeState } from "./handshake-state.js";
import { PATTERNS } from "./patterns.js";

interface VectorMessage {
	payload: string;
	ciphertext: string;
}

interface Vector {
	protocol_name: string;
	init_prologue: string;
	init_psks?: string[];
	init_static: string;
	init_ephemeral: string;
	init_remote_static?: string;
	resp_prologue: string;
	resp_psks?: string[];
	resp_static: string;
	resp_ephemeral: string;
	resp_remote_static?: string;
	handshake_hash: string;
	messages: VectorMessage[];
}

const vectors = (vectorFile as { vectors: Vector[] }).vectors;
const EMPTY = new Uint8Array(0);

function patternNameOf(protocol: string): string {
	// "Noise_IKpsk1_25519_ChaChaPoly_SHA256" -> "IKpsk1"
	return protocol.split("_")[1] as string;
}

describe("Noise implementation vs official Cacophony vectors", () => {
	it("loaded the expected vector set", () => {
		expect(vectors.map((vector) => vector.protocol_name).sort()).toEqual([
			"Noise_IK_25519_ChaChaPoly_SHA256",
			"Noise_IKpsk1_25519_ChaChaPoly_SHA256",
			"Noise_IKpsk2_25519_ChaChaPoly_SHA256",
		]);
	});

	for (const vector of vectors) {
		it(`reproduces ${vector.protocol_name} exactly`, () => {
			const pattern = PATTERNS[patternNameOf(vector.protocol_name)];
			expect(pattern).toBeDefined();
			if (!pattern) {
				return;
			}

			const initiator = new HandshakeState({
				pattern,
				initiator: true,
				prologue: hexToBytes(vector.init_prologue),
				staticKeyPair: HandshakeState.staticKeyPairFromPrivateKey(
					hexToBytes(vector.init_static),
				),
				remoteStaticPublicKey: vector.init_remote_static
					? hexToBytes(vector.init_remote_static)
					: undefined,
				psk: vector.init_psks?.[0]
					? hexToBytes(vector.init_psks[0])
					: undefined,
				ephemeralKeyPair: HandshakeState.staticKeyPairFromPrivateKey(
					hexToBytes(vector.init_ephemeral),
				),
			});

			const responder = new HandshakeState({
				pattern,
				initiator: false,
				prologue: hexToBytes(vector.resp_prologue),
				staticKeyPair: HandshakeState.staticKeyPairFromPrivateKey(
					hexToBytes(vector.resp_static),
				),
				remoteStaticPublicKey: vector.resp_remote_static
					? hexToBytes(vector.resp_remote_static)
					: undefined,
				psk: vector.resp_psks?.[0]
					? hexToBytes(vector.resp_psks[0])
					: undefined,
				ephemeralKeyPair: HandshakeState.staticKeyPairFromPrivateKey(
					hexToBytes(vector.resp_ephemeral),
				),
			});

			const handshakeCount = pattern.messages.length;
			let initiatorTransport:
				| { send: CipherState; recv: CipherState }
				| undefined;
			let responderTransport:
				| { send: CipherState; recv: CipherState }
				| undefined;

			for (let index = 0; index < vector.messages.length; index += 1) {
				const expected = vector.messages[index] as VectorMessage;
				const payload = hexToBytes(expected.payload);
				const initiatorSends = index % 2 === 0;

				if (index < handshakeCount) {
					const writer = initiatorSends ? initiator : responder;
					const reader = initiatorSends ? responder : initiator;

					const written = writer.writeMessage(payload);
					expect(bytesToHex(written.message)).toBe(expected.ciphertext);

					const read = reader.readMessage(written.message);
					expect(bytesToHex(read.payload)).toBe(expected.payload);

					if (written.result) {
						const writerTransport = {
							send: new CipherState(written.result.sendKey),
							recv: new CipherState(written.result.recvKey),
						};
						if (initiatorSends) {
							initiatorTransport = writerTransport;
						} else {
							responderTransport = writerTransport;
						}
					}
					if (read.result) {
						const readerTransport = {
							send: new CipherState(read.result.sendKey),
							recv: new CipherState(read.result.recvKey),
						};
						if (initiatorSends) {
							responderTransport = readerTransport;
						} else {
							initiatorTransport = readerTransport;
						}
					}
					continue;
				}

				// Post-Split transport messages: EncryptWithAd(zerolen, payload).
				expect(initiatorTransport).toBeDefined();
				expect(responderTransport).toBeDefined();
				if (!initiatorTransport || !responderTransport) {
					return;
				}
				const sender = initiatorSends ? initiatorTransport : responderTransport;
				const receiver = initiatorSends
					? responderTransport
					: initiatorTransport;

				const ciphertext = sender.send.encryptWithAd(EMPTY, payload);
				expect(bytesToHex(ciphertext)).toBe(expected.ciphertext);
				expect(bytesToHex(receiver.recv.decryptWithAd(EMPTY, ciphertext))).toBe(
					expected.payload,
				);
			}

			// Both parties must agree on the transcript hash, and it must equal the
			// published value.
			expect(bytesToHex(initiator.getHandshakeHash())).toBe(
				vector.handshake_hash,
			);
			expect(bytesToHex(responder.getHandshakeHash())).toBe(
				vector.handshake_hash,
			);
		});
	}
});
