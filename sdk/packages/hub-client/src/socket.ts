/** Subprotocol prefix accepted by the local (loopback) Cline hub. */
export const HUB_AUTH_PROTOCOL_PREFIX = "cline-hub-auth.";

export const MISSING_WEBSOCKET_ERROR_MESSAGE =
	"Global WebSocket is not available in this runtime. Node 22+ is required for hub mode.";

/**
 * How the client proves its identity to the hub.
 *
 * - `hub-subprotocol`: sends `cline-hub-auth.<credential>` as a websocket
 *   subprotocol. This is what the local hub daemon expects and is the only mode
 *   that works from a browser, which cannot set request headers.
 * - `bearer-header`: sends `Authorization: Bearer <credential>` as a request
 *   header. Supported by Node (`ws`) and React Native; browsers silently ignore
 *   the third `WebSocket` constructor argument, so do not rely on it there.
 * - `none`: no credential is attached.
 */
export type HubAuthMode = "bearer-header" | "hub-subprotocol" | "none";

export type WebSocketLike = {
	readyState: number;
	send(data: string): void;
	close(): void;
	addEventListener(type: string, listener: (...args: unknown[]) => void): void;
};

/**
 * Third constructor argument understood by Node's `ws` package and React
 * Native's websocket implementation. Ignored by browser `WebSocket`.
 */
export type HubSocketRequestOptions = {
	headers?: Record<string, string>;
};

export type WebSocketCtor = new (
	url: string,
	protocols?: string | string[],
	options?: HubSocketRequestOptions,
) => WebSocketLike;

/**
 * Auth-relevant subset of {@link CreateHubSocketOptions}. `url`/`WebSocketImpl`
 * are accepted (and ignored) so a full options object can be passed straight
 * through to the resolvers.
 */
export interface HubSocketAuthOptions {
	authMode: HubAuthMode;
	credential?: string;
	headers?: Record<string, string>;
	url?: string;
	WebSocketImpl?: WebSocketCtor;
}

export interface CreateHubSocketOptions extends HubSocketAuthOptions {
	url: string;
}

function normalizedCredential(
	options: Pick<HubSocketAuthOptions, "credential">,
): string | undefined {
	return options.credential?.trim() || undefined;
}

export function resolveWebSocketCtor(impl?: WebSocketCtor): WebSocketCtor {
	const ctor =
		impl ??
		(globalThis as { WebSocket?: WebSocketCtor }).WebSocket ??
		undefined;
	if (!ctor) {
		throw new Error(MISSING_WEBSOCKET_ERROR_MESSAGE);
	}
	return ctor;
}

/** Websocket subprotocols for the requested auth mode, or `undefined`. */
export function resolveHubSocketProtocols(
	options: HubSocketAuthOptions,
): string[] | undefined {
	if (options.authMode !== "hub-subprotocol") {
		return undefined;
	}
	const credential = normalizedCredential(options);
	return credential ? [`${HUB_AUTH_PROTOCOL_PREFIX}${credential}`] : undefined;
}

/** Request options (headers) for the requested auth mode, or `undefined`. */
export function resolveHubSocketRequestOptions(
	options: HubSocketAuthOptions,
): HubSocketRequestOptions | undefined {
	const headers: Record<string, string> = { ...options.headers };
	if (options.authMode === "bearer-header") {
		const credential = normalizedCredential(options);
		if (credential) {
			headers.Authorization = `Bearer ${credential}`;
		}
	}
	return Object.keys(headers).length > 0 ? { headers } : undefined;
}

/**
 * Create a hub websocket for the given auth mode. Credentials are only ever
 * attached through the channel the mode names, so a bearer token can never leak
 * into a subprotocol (or vice versa).
 */
export function createHubSocket(
	options: CreateHubSocketOptions,
): WebSocketLike {
	const Ctor = resolveWebSocketCtor(options.WebSocketImpl);
	const protocols = resolveHubSocketProtocols(options);
	const requestOptions = resolveHubSocketRequestOptions(options);
	if (requestOptions) {
		return new Ctor(options.url, protocols, requestOptions);
	}
	if (protocols) {
		return new Ctor(options.url, protocols);
	}
	return new Ctor(options.url);
}
