/**
 * Failure-path tests for the Noise handshake driver.
 *
 * The happy path is covered byte-for-byte by the Cacophony vectors; what matters
 * here is what a *hostile relay* can do by feeding us a message that does not
 * authenticate. A failed read must never leave a half-advanced state that a
 * later, genuine retry can be run against.
 */
import { describe, expect, it } from "vitest";
import { HandshakeStateError, HubPairingError } from "../errors.js";
import { generateDeviceKeyPair } from "../keys.js";
import { HandshakeState } from "./handshake-state.js";
import { type HandshakePattern, IK } from "./patterns.js";

const PROLOGUE = new Uint8Array([1, 2, 3]);

function ikPair() {
	const hub = generateDeviceKeyPair();
	const device = generateDeviceKeyPair();
	const initiator = new HandshakeState({
		pattern: IK,
		initiator: true,
		prologue: PROLOGUE,
		staticKeyPair: HandshakeState.staticKeyPairFromPrivateKey(
			device.privateKey,
		),
		remoteStaticPublicKey: hub.publicKey,
	});
	const responder = new HandshakeState({
		pattern: IK,
		initiator: false,
		prologue: PROLOGUE,
		staticKeyPair: HandshakeState.staticKeyPairFromPrivateKey(hub.privateKey),
	});
	return { initiator, responder };
}

describe("handshake failure handling", () => {
	it("ATTACK: a garbage message 2 poisons the handshake instead of wedging it", () => {
		const { initiator, responder } = ikPair();
		const message1 = initiator.writeMessage();
		responder.readMessage(message1.message);
		const message2 = responder.writeMessage();

		// The relay injects a message 2 of the right shape but wrong contents. This
		// advances h/ck/remoteEphemeral with attacker-chosen data.
		const garbage = new Uint8Array(message2.message.length).fill(0xab);
		expect(() => initiator.readMessage(garbage)).toThrow(HubPairingError);

		// The genuine message 2 must now fail loudly rather than being processed
		// against attacker-polluted state.
		expect(() => initiator.readMessage(message2.message)).toThrow(
			HandshakeStateError,
		);
		expect(() => initiator.readMessage(message2.message)).toThrow(/failed/i);
		expect(() => initiator.writeMessage()).toThrow(/failed/i);
		expect(initiator.handshakeFinished).toBe(false);
	});

	it("a completed handshake without an authenticated peer static key yields nothing", () => {
		// No pattern we ship can reach this (both send `s` in message 1), so this
		// pins the defensive ordering: `split()` must not run, and the state must not
		// report itself finished, before the peer is authenticated.
		const unauthenticated: HandshakePattern = {
			name: "IK",
			initiatorPreMessages: [],
			responderPreMessages: ["s"],
			messages: [["e"]],
			usesPsk: false,
		};
		const hub = generateDeviceKeyPair();
		const device = generateDeviceKeyPair();
		const initiator = new HandshakeState({
			pattern: unauthenticated,
			initiator: true,
			prologue: PROLOGUE,
			staticKeyPair: HandshakeState.staticKeyPairFromPrivateKey(
				device.privateKey,
			),
			remoteStaticPublicKey: hub.publicKey,
		});
		const responder = new HandshakeState({
			pattern: unauthenticated,
			initiator: false,
			prologue: PROLOGUE,
			staticKeyPair: HandshakeState.staticKeyPairFromPrivateKey(hub.privateKey),
		});
		const written = initiator.writeMessage();

		expect(() => responder.readMessage(written.message)).toThrow(
			/authenticated peer static key/,
		);
		expect(responder.handshakeFinished).toBe(false);
	});
});
