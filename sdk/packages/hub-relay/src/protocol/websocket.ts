/**
 * Structural websocket types, duplicated from `@cline/hub-client` on purpose.
 *
 * The RN-facing entry of this package must have ZERO external packages in its
 * import graph (see `no-node-builtins.test.ts`), so these are declared locally
 * and pinned to `hub-client`'s definitions by a type-assignability test rather
 * than by an import.
 */

export type RelayWebSocketLike = {
	readyState: number;
	send(data: string): void;
	close(): void;
	addEventListener(type: string, listener: (...args: unknown[]) => void): void;
};

/** Third constructor argument honoured by `ws` (Node) and React Native. */
export type RelayWebSocketRequestOptions = {
	headers?: Record<string, string>;
};

export type RelayWebSocketCtor = new (
	url: string,
	protocols?: string | string[],
	options?: RelayWebSocketRequestOptions,
) => RelayWebSocketLike;

export const WEBSOCKET_READY_STATE = {
	connecting: 0,
	open: 1,
	closing: 2,
	closed: 3,
} as const;

export const MISSING_WEBSOCKET_ERROR_MESSAGE =
	"Global WebSocket is not available in this runtime. Pass WebSocketImpl explicitly.";

export function resolveRelayWebSocketCtor(
	impl?: RelayWebSocketCtor,
): RelayWebSocketCtor {
	const ctor =
		impl ??
		(globalThis as { WebSocket?: RelayWebSocketCtor }).WebSocket ??
		undefined;
	if (!ctor) {
		throw new Error(MISSING_WEBSOCKET_ERROR_MESSAGE);
	}
	return ctor;
}

/**
 * How a peer proves its Cline account to the relay.
 *
 * - `bearer-header`: `Authorization: Bearer <token>` upgrade header. What the
 *   existing cloud session proxy expects (`Bearer workos:<jwt>`) and what RN and
 *   `ws` can both send. Preferred in production.
 * - `relay-subprotocol`: `cline-relay-auth.<token>` websocket subprotocol. The
 *   only mode available to a browser, and the only mode Node's global
 *   `WebSocket` supports (undici ignores custom upgrade headers).
 */
export type RelayAuthMode = "bearer-header" | "relay-subprotocol";
