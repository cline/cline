/**
 * @cline/hub-pairing — device pairing and end-to-end encryption for the Cline hub.
 *
 * Security model in one paragraph: the hub token is root-equivalent, so account
 * authentication at a relay must never be sufficient to drive a machine. Every
 * connection is an authenticated Noise session between a laptop identity key and
 * a *paired device* identity key, with both ends pinning the other. The relay
 * only ever sees opaque ChaCha20-Poly1305 frames, and the laptop keeps a
 * revocable allowlist of devices.
 *
 * Handshakes are the published Noise patterns
 * `Noise_IKpsk1_25519_ChaChaPoly_SHA256` (enrollment, QR secret as the PSK) and
 * `Noise_IK_25519_ChaChaPoly_SHA256` (reconnection), verified against the
 * official Cacophony test vectors.
 */

export {
	base64UrlToBytes,
	bytesEqual,
	bytesToBase32,
	bytesToBase64Url,
	bytesToHex,
	bytesToUtf8,
	concatBytes,
	hexToBytes,
	utf8ToBytes,
} from "./bytes.js";
export {
	type ChannelRole,
	createSecureChannel,
	DEFAULT_MAX_PLAINTEXT_SIZE,
	FRAME_HEADER_LENGTH,
	FRAME_MAGIC,
	FRAME_WIRE_VERSION,
	MAX_FRAME_SIZE,
	type SecureChannel,
	type SecureChannelInit,
} from "./channel.js";
export {
	AttestationRejectedError,
	ChannelClosedError,
	ChannelExhaustedError,
	ChannelKeyError,
	DeviceRecordInvalidError,
	DeviceRevokedError,
	DeviceUnknownError,
	FrameAuthenticationError,
	FrameMalformedError,
	FrameOutOfOrderError,
	FrameReplayError,
	FrameTooLargeError,
	HandshakeStateError,
	HubPairingError,
	type HubPairingErrorCode,
	PairingOfferConsumedError,
	PairingOfferExpiredError,
	PairingUriError,
	PeerKeyMismatchError,
	ProtocolVersionError,
	SessionReplayError,
} from "./errors.js";
export {
	type DeviceKeyPair,
	deviceFingerprint,
	deviceIdFromPublicKey,
	encodePublicKey,
	generateDeviceKeyPair,
} from "./keys.js";
export { type KeyPair, publicKeyFromPrivateKey } from "./noise/primitives.js";
export {
	decodeStoredPairingOffer,
	encodeStoredPairingOffer,
	type StoredPairingOffer,
} from "./offer-file.js";
export {
	type AcceptDeviceSessionOptions,
	type AcceptedDeviceSession,
	type AcceptPairingOfferOptions,
	acceptDeviceSession,
	acceptPairingOffer,
	buildPairingPrologue,
	buildSessionPrologue,
	type CompletePairingOptions,
	type CompletePairingResult,
	type CreateHubPairingSessionOptions,
	type CreatePairingOfferInput,
	type CreatePairingOfferResult,
	completePairing,
	createHubPairingSession,
	createPairingOffer,
	DEFAULT_OFFER_TTL_MS,
	type DevicePairingMetadata,
	decodeHandoffUri,
	decodePairingUri,
	type EncodePairingUriOptions,
	encodeHandoffUri,
	encodePairingUri,
	HANDOFF_URI_HOST,
	HANDOFF_URI_SCHEME,
	type HandoffLink,
	type HubPairingMetadata,
	type HubPairingSession,
	PAIRING_PROTOCOL_VERSION,
	PAIRING_URI_SCHEME,
	type PairedDeviceIdentity,
	type PairedHubIdentity,
	type PairingAttestation,
	type PairingOffer,
	type PairingResponse,
	type PairingUriFormat,
	type PendingDeviceSession,
	type PendingPairing,
	type StartDeviceSessionOptions,
	startDeviceSession,
} from "./pairing.js";
export {
	defaultRandomSource,
	type RandomSource,
	randomBytes,
} from "./random.js";
export {
	type ApprovalDecision,
	type ApprovalPolicy,
	type ApprovalTier,
	assertRecordSelfConsistent,
	createInMemoryDeviceStore,
	DEFAULT_APPROVAL_POLICY,
	DEFAULT_SESSION_REPLAY_WINDOW_MS,
	DEVICE_PUBLIC_KEY_LENGTH,
	DeviceRegistry,
	type DeviceRegistryOptions,
	type DeviceStore,
	MAX_REMEMBERED_SESSION_HANDSHAKES,
	normalizeApprovalPolicy,
	type PairedDeviceRecord,
	STRICTEST_APPROVAL_POLICY,
	type TerminableChannel,
} from "./registry.js";
export {
	type DeviceBeginFrame,
	type DeviceOkFrame,
	decodeDeviceBeginFrame,
	decodeDeviceOkFrame,
	decodePairAttestFrame,
	decodePairOkFrame,
	decodeSecureDataFrame,
	encodeDeviceBeginFrame,
	encodeDeviceOkFrame,
	encodeHandshakeErrorFrame,
	encodePairAttestFrame,
	encodePairOkFrame,
	encodeSecureDataFrame,
	type HandshakeErrorFrame,
	HUB_DEVICE_BEGIN_FRAME,
	HUB_DEVICE_ERROR_FRAME,
	HUB_DEVICE_OK_FRAME,
	HUB_DEVICE_SUBPROTOCOL,
	HUB_HANDSHAKE_MAX_WIRE_BYTES,
	HUB_PAIR_ATTEST_FRAME,
	HUB_PAIR_ERROR_FRAME,
	HUB_PAIR_OK_FRAME,
	HUB_PAIR_SUBPROTOCOL_PREFIX,
	HUB_PAIRING_TRANSPORT_VERSION,
	HUB_SECURE_DATA_FRAME,
	hasDeviceSubprotocol,
	isValidOfferId,
	maxEncodedSecureDataFrameBytes,
	type PairAttestFrame,
	type PairOkFrame,
	readHandshakeErrorFrame,
	readPairSubprotocolOfferId,
	type SecureDataFrame,
} from "./transport.js";
