export {
	decodeRelayAuthCredential,
	encodeRelayAuthCredential,
} from "./auth";
export {
	base64DecodedByteLength,
	base64ToBytes,
	base64ToText,
	base64UrlToText,
	bytesToBase64,
	textToBase64,
	textToBase64Url,
} from "./base64";
export {
	isRelayError,
	RelayError,
	relayErrorCodeForCloseCode,
} from "./errors";
export {
	decodeRelayFrame,
	encodeRelayFrame,
	isRelayErrorCode,
	isRelayProtocolCompatible,
	isValidMachineId,
	RELAY_AUTH_PROTOCOL_PREFIX,
	RELAY_CLIENT_PATH,
	RELAY_CLOSE_CODES,
	RELAY_HANDSHAKE_TIMEOUT_MS,
	RELAY_HEARTBEAT_INTERVAL_MS,
	RELAY_HEARTBEAT_TIMEOUT_MS,
	RELAY_HOST_PATH,
	RELAY_MAX_CLOSE_REASON_LENGTH,
	RELAY_MAX_FRAME_BYTES,
	RELAY_MAX_LABEL_LENGTH,
	RELAY_MAX_MACHINE_ID_LENGTH,
	RELAY_MAX_PAYLOAD_BYTES,
	RELAY_NEWEST_MACHINE,
	RELAY_PROTOCOL_VERSION,
	RELAY_SEND_HIGH_WATER_MARK_BYTES,
	type RelayChannelCloseFrame,
	type RelayChannelOpenFrame,
	type RelayChannelReadyFrame,
	type RelayClientConnectedFrame,
	type RelayClientConnectFrame,
	type RelayDataFrame,
	type RelayDecodeFailure,
	type RelayDecodeResult,
	type RelayErrorCode,
	type RelayErrorFrame,
	type RelayFrame,
	type RelayHostRegisteredFrame,
	type RelayHostRegisterFrame,
	type RelayPingFrame,
	type RelayPongFrame,
	type RelayRole,
	relayCloseCode,
	relayFrameCapBytes,
	sanitizeRelayText,
} from "./frames";
export { createChannelId, createMachineId, createRelayId } from "./ids";
export {
	bindRelayPayload,
	openBoundRelayPayload,
	RelayPayloadBindingError,
} from "./sealed-payload";
export {
	decodeRelaySecureClientHello,
	decodeRelaySecureHostReply,
	encodeRelaySecureClientHello,
	encodeRelaySecureHostReply,
	RELAY_SECURE_HANDSHAKE_VERSION,
	type RelaySecureClientHello,
	type RelaySecureHandshakeKind,
	type RelaySecureHostReply,
} from "./secure-handshake";
export {
	relayClientUrl,
	relayEndpointUrl,
	relayHostUrl,
} from "./urls";
export {
	MISSING_WEBSOCKET_ERROR_MESSAGE,
	type RelayAuthMode,
	type RelayWebSocketCtor,
	type RelayWebSocketLike,
	type RelayWebSocketRequestOptions,
	resolveRelayWebSocketCtor,
	WEBSOCKET_READY_STATE,
} from "./websocket";
