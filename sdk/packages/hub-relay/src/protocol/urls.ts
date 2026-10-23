import { RELAY_CLIENT_PATH, RELAY_HOST_PATH } from "./frames";

/**
 * Join a relay base url (`ws://host:port`, optionally with a path prefix) and a
 * role path. Uses `URL`, which exists on every target this package supports.
 */
export function relayEndpointUrl(relayUrl: string, path: string): string {
	const parsed = new URL(relayUrl);
	if (parsed.protocol === "http:") {
		parsed.protocol = "ws:";
	} else if (parsed.protocol === "https:") {
		parsed.protocol = "wss:";
	}
	const prefix = parsed.pathname.replace(/\/+$/, "");
	parsed.pathname = `${prefix}${path}`;
	return parsed.toString();
}

export function relayHostUrl(relayUrl: string): string {
	return relayEndpointUrl(relayUrl, RELAY_HOST_PATH);
}

export function relayClientUrl(relayUrl: string): string {
	return relayEndpointUrl(relayUrl, RELAY_CLIENT_PATH);
}
