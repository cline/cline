/**
 * React-Native-safe entry point.
 *
 * Everything reachable from here is free of node builtins and external packages,
 * enforced by `no-node-builtins.test.ts`. This is what the phone imports; the
 * server and host entries are Node-only and must never be pulled in here.
 */

export {
	base64ToBytes,
	base64ToText,
	bytesToBase64,
	decodeRelayFrame,
	encodeRelayFrame,
	isRelayError,
	isRelayProtocolCompatible,
	RELAY_AUTH_PROTOCOL_PREFIX,
	RELAY_CLIENT_PATH,
	RELAY_CLOSE_CODES,
	RELAY_HEARTBEAT_INTERVAL_MS,
	RELAY_HEARTBEAT_TIMEOUT_MS,
	RELAY_HOST_PATH,
	RELAY_MAX_FRAME_BYTES,
	RELAY_MAX_PAYLOAD_BYTES,
	RELAY_NEWEST_MACHINE,
	RELAY_PROTOCOL_VERSION,
	type RelayAuthMode,
	type RelayChannelCloseFrame,
	type RelayChannelOpenFrame,
	type RelayClientConnectedFrame,
	type RelayClientConnectFrame,
	type RelayDataFrame,
	RelayError,
	type RelayErrorCode,
	type RelayErrorFrame,
	type RelayFrame,
	type RelayHostRegisteredFrame,
	type RelayHostRegisterFrame,
	type RelayRole,
	type RelayWebSocketCtor,
	type RelayWebSocketLike,
	relayClientUrl,
	relayErrorCodeForCloseCode,
	relayHostUrl,
	textToBase64,
} from "../protocol/index";
export {
	type CreateRelayClientSocketOptions,
	createRelayClientSocket,
	createRelayWebSocketImpl,
	type RelayClientDiagnostic,
	type RelayClientSocket,
	type RelayPayloadCodec,
	type RelaySecureClientHandshake,
} from "./socket";
