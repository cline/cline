/**
 * Typed errors. Callers switch on `code` rather than message text so the CLI,
 * the hub server and the phone app can react without string matching.
 */
export type HubPairingErrorCode =
	// pairing ceremony
	| "offer_expired"
	| "offer_consumed"
	| "offer_invalid"
	| "uri_invalid"
	| "protocol_version_unsupported"
	| "peer_key_mismatch"
	| "attestation_rejected"
	// device registry
	| "device_unknown"
	| "device_revoked"
	| "device_record_invalid"
	// secure channel / framing
	| "frame_malformed"
	| "frame_too_large"
	| "frame_auth_failed"
	| "frame_replayed"
	| "frame_out_of_order"
	| "channel_closed"
	| "channel_exhausted"
	| "channel_key_invalid"
	| "session_replayed"
	| "handshake_state";

export class HubPairingError extends Error {
	readonly code: HubPairingErrorCode;

	constructor(code: HubPairingErrorCode, message: string) {
		super(message);
		this.name = "HubPairingError";
		this.code = code;
	}
}

export class PairingOfferExpiredError extends HubPairingError {
	constructor(message = "Pairing offer has expired") {
		super("offer_expired", message);
		this.name = "PairingOfferExpiredError";
	}
}

export class PairingOfferConsumedError extends HubPairingError {
	constructor(message = "Pairing offer has already been used") {
		super("offer_consumed", message);
		this.name = "PairingOfferConsumedError";
	}
}

export class PairingUriError extends HubPairingError {
	constructor(message: string) {
		super("uri_invalid", message);
		this.name = "PairingUriError";
	}
}

export class ProtocolVersionError extends HubPairingError {
	constructor(message: string) {
		super("protocol_version_unsupported", message);
		this.name = "ProtocolVersionError";
	}
}

export class PeerKeyMismatchError extends HubPairingError {
	constructor(message = "Peer static key does not match the pinned key") {
		super("peer_key_mismatch", message);
		this.name = "PeerKeyMismatchError";
	}
}

/**
 * Raised whenever a Noise handshake message fails to authenticate. Deliberately
 * indistinguishable between "wrong PSK", "wrong static key" and "tampered
 * ciphertext" so an attacker cannot use the error to classify its failure.
 */
export class AttestationRejectedError extends HubPairingError {
	constructor(message = "Pairing attestation rejected") {
		super("attestation_rejected", message);
		this.name = "AttestationRejectedError";
	}
}

export class DeviceUnknownError extends HubPairingError {
	constructor(deviceId: string) {
		super("device_unknown", `Unknown device: ${deviceId}`);
		this.name = "DeviceUnknownError";
	}
}

export class DeviceRevokedError extends HubPairingError {
	constructor(deviceId: string) {
		super("device_revoked", `Device has been revoked: ${deviceId}`);
		this.name = "DeviceRevokedError";
	}
}

/**
 * A persisted device record that cannot be trusted at face value — most
 * importantly one whose `deviceId` is not derived from its own `publicKey`,
 * which would let a hostile store show one identity and authorise another.
 */
export class DeviceRecordInvalidError extends HubPairingError {
	constructor(message: string) {
		super("device_record_invalid", `Invalid paired-device record: ${message}`);
		this.name = "DeviceRecordInvalidError";
	}
}

export class FrameMalformedError extends HubPairingError {
	constructor(message: string) {
		super("frame_malformed", message);
		this.name = "FrameMalformedError";
	}
}

export class FrameTooLargeError extends HubPairingError {
	constructor(message: string) {
		super("frame_too_large", message);
		this.name = "FrameTooLargeError";
	}
}

export class FrameAuthenticationError extends HubPairingError {
	constructor(message = "Frame failed authentication") {
		super("frame_auth_failed", message);
		this.name = "FrameAuthenticationError";
	}
}

export class FrameReplayError extends HubPairingError {
	constructor(message: string) {
		super("frame_replayed", message);
		this.name = "FrameReplayError";
	}
}

export class FrameOutOfOrderError extends HubPairingError {
	constructor(message: string) {
		super("frame_out_of_order", message);
		this.name = "FrameOutOfOrderError";
	}
}

export class ChannelClosedError extends HubPairingError {
	constructor(message = "Secure channel is closed") {
		super("channel_closed", message);
		this.name = "ChannelClosedError";
	}
}

export class ChannelExhaustedError extends HubPairingError {
	constructor(message = "Nonce space exhausted; rekey required") {
		super("channel_exhausted", message);
		this.name = "ChannelExhaustedError";
	}
}

/**
 * Refuses key material that cannot have come from a real `Split()`: wrong
 * length, all-zero (i.e. already zeroized elsewhere), or identical in both
 * directions. Catching this at construction is what stops a channel from
 * silently encrypting under a destroyed key.
 */
export class ChannelKeyError extends HubPairingError {
	constructor(message: string) {
		super("channel_key_invalid", message);
		this.name = "ChannelKeyError";
	}
}

/**
 * A session handshake message that this hub has already accepted. Replaying one
 * cannot yield usable transport keys (the attacker lacks the device ephemeral
 * private key) but it can mint hub-side sessions, so it is refused outright.
 */
export class SessionReplayError extends HubPairingError {
	constructor(message = "Session handshake message was already used") {
		super("session_replayed", message);
		this.name = "SessionReplayError";
	}
}

export class HandshakeStateError extends HubPairingError {
	constructor(message: string) {
		super("handshake_state", message);
		this.name = "HandshakeStateError";
	}
}
