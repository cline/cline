/**
 * The two Noise handshake patterns this package supports, transcribed from the
 * Noise spec (rev 34, section 7.5 for IK and section 9 for the psk modifier).
 *
 * We support exactly two, both with the responder's static key known in advance
 * — which is precisely the "QR shows the laptop's key" situation:
 *
 *   Noise_IKpsk1_25519_ChaChaPoly_SHA256  — device enrollment. The one-time QR
 *     secret is the PSK. `psk1` places the token at the end of message 1, so the
 *     hub verifies QR possession the moment it reads the first message.
 *
 *   Noise_IK_25519_ChaChaPoly_SHA256      — every later reconnection. Both static
 *     keys are already pinned, so this is mutual authentication against the
 *     device registry with no shared secret involved.
 *
 * IK:
 *     <- s
 *     ...
 *     -> e, es, s, ss
 *     <- e, ee, se
 *
 * IKpsk1:
 *     <- s
 *     ...
 *     -> e, es, s, ss, psk
 *     <- e, ee, se
 */
export type Token = "e" | "s" | "ee" | "es" | "se" | "ss" | "psk";

export interface HandshakePattern {
	readonly name: string;
	/** Public keys the initiator sends ahead of time (none for IK). */
	readonly initiatorPreMessages: readonly ("s" | "e")[];
	/** Public keys the responder sends ahead of time (its static, for IK). */
	readonly responderPreMessages: readonly ("s" | "e")[];
	readonly messages: readonly (readonly Token[])[];
	/** True when the pattern uses a pre-shared key, which changes `e` handling. */
	readonly usesPsk: boolean;
}

export const IK: HandshakePattern = {
	name: "IK",
	initiatorPreMessages: [],
	responderPreMessages: ["s"],
	messages: [
		["e", "es", "s", "ss"],
		["e", "ee", "se"],
	],
	usesPsk: false,
};

export const IKpsk1: HandshakePattern = {
	name: "IKpsk1",
	initiatorPreMessages: [],
	responderPreMessages: ["s"],
	messages: [
		["e", "es", "s", "ss", "psk"],
		["e", "ee", "se"],
	],
	usesPsk: true,
};

export const IKpsk2: HandshakePattern = {
	name: "IKpsk2",
	initiatorPreMessages: [],
	responderPreMessages: ["s"],
	messages: [
		["e", "es", "s", "ss"],
		["e", "ee", "se", "psk"],
	],
	usesPsk: true,
};

export const PATTERNS: Record<string, HandshakePattern> = {
	IK,
	IKpsk1,
	IKpsk2,
};

export function protocolName(pattern: HandshakePattern): string {
	return `Noise_${pattern.name}_25519_ChaChaPoly_SHA256`;
}
