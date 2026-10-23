import { base64UrlToText, textToBase64Url } from "./base64";
import { RELAY_AUTH_PROTOCOL_PREFIX } from "./frames";

/**
 * Wrap an account credential into the relay's auth subprotocol.
 *
 * A websocket subprotocol name is an HTTP `token`, so it may not contain `:`,
 * and the Cline account convention is literally `workos:<jwt>`.
 * Sending it raw makes the *client*
 * runtime reject the connection before the relay ever sees it — Node's global
 * `WebSocket` fails with "Wrong protocol for WebSocket". So the credential is
 * base64url-encoded, whose alphabet is entirely `tchar`s.
 *
 * The hub's own `cline-hub-auth.<token>` gets away with a raw token only because
 * hub tokens are hex.
 */
export function encodeRelayAuthCredential(token: string): string {
	return `${RELAY_AUTH_PROTOCOL_PREFIX}${textToBase64Url(token)}`;
}

/** Inverse of {@link encodeRelayAuthCredential}; `undefined` if not ours. */
export function decodeRelayAuthCredential(
	subprotocol: string,
): string | undefined {
	const trimmed = subprotocol.trim();
	if (!trimmed.startsWith(RELAY_AUTH_PROTOCOL_PREFIX)) {
		return undefined;
	}
	const encoded = trimmed.slice(RELAY_AUTH_PROTOCOL_PREFIX.length);
	if (!encoded) {
		return undefined;
	}
	return base64UrlToText(encoded) || undefined;
}
