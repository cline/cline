/**
 * Phone-side relay connector.
 *
 * `createRelayClientSocket` returns an object that satisfies `WebSocketLike`
 * from `@cline/hub-client`, so it can be handed straight to `HubClient` as its
 * `WebSocketImpl`. From `HubClient`'s point of view this IS the hub socket: it
 * opens, carries hub protocol v1 text frames, and closes. Underneath, every
 * frame is wrapped in a relay envelope and routed to the laptop hub.
 *
 * That is the whole seam. `SessionConnection` and the rest of the mobile session
 * stack need zero changes to run relayed.
 *
 * This module is RN-safe: no node builtins, no external packages.
 */

import {
	base64ToBytes,
	bindRelayPayload,
	bytesToBase64,
	decodeRelayFrame,
	decodeRelaySecureHostReply,
	encodeRelayAuthCredential,
	encodeRelayFrame,
	encodeRelaySecureClientHello,
	openBoundRelayPayload,
	RELAY_CLOSE_CODES,
	RELAY_MAX_PAYLOAD_BYTES,
	RELAY_NEWEST_MACHINE,
	RELAY_PROTOCOL_VERSION,
	RELAY_SECURE_HANDSHAKE_VERSION,
	type RelayAuthMode,
	type RelayErrorCode,
	type RelayWebSocketCtor,
	type RelayWebSocketLike,
	relayClientUrl,
	relayCloseCode,
	resolveRelayWebSocketCtor,
	WEBSOCKET_READY_STATE,
} from "../protocol/index";

/**
 * Seam for the pairing layer's end-to-end encryption.
 *
 * The relay only ever sees `seal`'s output. Leaving this unset means payloads
 * cross the relay as plaintext hub frames, which is fine for a dev relay and
 * NOT acceptable in production.
 */
export interface RelayPayloadCodec {
	seal(plaintext: Uint8Array): Uint8Array;
	open(sealed: Uint8Array): Uint8Array;
}

/** Client half of the Noise handshake carried inside the blind relay channel. */
export interface RelaySecureClientHandshake {
	kind: "pairing" | "session";
	offerId?: string;
	message: Uint8Array;
	/** Completes Noise and returns the codec used for every subsequent hub frame. */
	complete(response: Uint8Array): RelayPayloadCodec;
}

export interface CreateRelayClientSocketOptions {
	/** Relay base url, e.g. `ws://127.0.0.1:4610` or `wss://relay.cline.bot`. */
	relayUrl: string;
	/** Cline account token. Sent as `Bearer <token>` or in the auth subprotocol. */
	accountToken: string;
	/** Machine to reach, or `"newest"` for this account's most recent hub. */
	machineId?: string;
	/**
	 * Default `relay-subprotocol`: the only mode a browser can use and the only
	 * one Node's global `WebSocket` honours. Production RN should use
	 * `bearer-header` to match the cloud session proxy's `Bearer workos:<jwt>`.
	 */
	authMode?: RelayAuthMode;
	/** Extra upgrade headers (ignored by browsers). */
	headers?: Record<string, string>;
	WebSocketImpl?: RelayWebSocketCtor;
	maxPayloadBytes?: number;
	/**
	 * Bytes a caller may queue before the relay has paired this socket with a
	 * machine. The queue only exists to cover that handshake, so an overflow means
	 * the pairing is not happening — on a phone, an unbounded queue is the app's
	 * own memory.
	 */
	maxPendingSendBytes?: number;
	/** Plugged in by the pairing layer; identity when omitted. */
	payloadCodec?: RelayPayloadCodec;
	/** Establish E2E before exposing this socket as open to HubClient. */
	secureHandshake?: RelaySecureClientHandshake;
	/** Metadata-only diagnostics. Never receives payload contents. */
	onDiagnostic?: (diagnostic: RelayClientDiagnostic) => void;
}

export type RelayClientDiagnostic =
	| { type: "connecting"; url: string; machineId: string }
	| {
			type: "channel-open";
			channelId: string;
			machineId: string;
			label: string;
	  }
	| {
			type: "frame";
			channelId: string;
			direction: "up" | "down";
			bytes: number;
	  }
	| { type: "error"; code: RelayErrorCode; message: string }
	| { type: "closed"; code: number; reason: string };

export interface RelayClientSocket extends RelayWebSocketLike {
	/** Relay channel this socket is bound to; `undefined` until paired. */
	readonly channelId: string | undefined;
	readonly machineId: string | undefined;
	close(code?: number, reason?: string): void;
}

type Listener = (...args: unknown[]) => void;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** One hub frame's worth of slack, no more: the queue covers a handshake. */
const DEFAULT_MAX_PENDING_SEND_BYTES = 1024 * 1024;

export function createRelayClientSocket(
	options: CreateRelayClientSocketOptions,
): RelayClientSocket {
	if (options.payloadCodec && options.secureHandshake) {
		throw new Error("payloadCodec and secureHandshake are mutually exclusive");
	}
	const requestedMachineId = options.machineId ?? RELAY_NEWEST_MACHINE;
	const authMode: RelayAuthMode = options.authMode ?? "relay-subprotocol";
	const maxPayloadBytes = options.maxPayloadBytes ?? RELAY_MAX_PAYLOAD_BYTES;
	const maxPendingSendBytes =
		options.maxPendingSendBytes ?? DEFAULT_MAX_PENDING_SEND_BYTES;
	const url = relayClientUrl(options.relayUrl);
	const listeners = new Map<string, Set<Listener>>();

	let readyState: number = WEBSOCKET_READY_STATE.connecting;
	let channelId: string | undefined;
	let machineId: string | undefined;
	let machineLabel = requestedMachineId;
	let outboundSeq = 0;
	let lastInboundSeq = 0;
	let payloadCodec = options.payloadCodec;
	let closeEmitted = false;
	const pendingSends: string[] = [];
	let pendingSendBytes = 0;

	const diagnose = (diagnostic: RelayClientDiagnostic): void => {
		options.onDiagnostic?.(diagnostic);
	};

	const emit = (type: string, event: unknown): void => {
		for (const listener of [...(listeners.get(type) ?? [])]) {
			try {
				listener(event);
			} catch {
				// A consumer's handler must not break the socket.
			}
		}
	};

	const emitClose = (code: number, reason: string): void => {
		if (closeEmitted) {
			return;
		}
		closeEmitted = true;
		readyState = WEBSOCKET_READY_STATE.closed;
		diagnose({ type: "closed", code, reason });
		emit("close", { type: "close", code, reason, wasClean: code === 1000 });
	};

	const emitRelayError = (code: RelayErrorCode, message: string): void => {
		diagnose({ type: "error", code, message });
		const error = new Error(`relay ${code}: ${message}`);
		emit("error", { type: "error", message: error.message, error });
	};

	const Ctor = resolveRelayWebSocketCtor(options.WebSocketImpl);
	const protocols =
		authMode === "relay-subprotocol"
			? [encodeRelayAuthCredential(options.accountToken)]
			: undefined;
	const headers: Record<string, string> = { ...options.headers };
	if (authMode === "bearer-header") {
		headers.Authorization = `Bearer ${options.accountToken}`;
	}
	const requestOptions =
		Object.keys(headers).length > 0 ? { headers } : undefined;

	diagnose({ type: "connecting", url, machineId: requestedMachineId });

	let inner: RelayWebSocketLike;
	try {
		inner = requestOptions
			? new Ctor(url, protocols, requestOptions)
			: protocols
				? new Ctor(url, protocols)
				: new Ctor(url);
	} catch (error) {
		// Surface a synchronous construction failure asynchronously, so callers can
		// always attach listeners first (matching WebSocket semantics).
		const message = error instanceof Error ? error.message : String(error);
		queueMicrotask(() => {
			emit("error", { type: "error", message, error });
			emitClose(RELAY_CLOSE_CODES.internal, message);
		});
		return buildFacade();
	}

	const sendRaw = (text: string): void => {
		try {
			inner.send(text);
		} catch {
			// The socket is closing; the close handler reports it.
		}
	};

	const failChannel = (code: RelayErrorCode, message: string): void => {
		emitRelayError(code, message);
		readyState = WEBSOCKET_READY_STATE.closing;
		try {
			inner.close();
		} catch {
			// best-effort
		}
		emitClose(RELAY_CLOSE_CODES[code], message);
	};

	const sendData = (text: string): void => {
		if (readyState === WEBSOCKET_READY_STATE.closed) {
			return;
		}
		if (
			!channelId ||
			(options.secureHandshake && readyState !== WEBSOCKET_READY_STATE.open)
		) {
			if (pendingSendBytes + text.length > maxPendingSendBytes) {
				emitRelayError(
					"backpressure",
					`queued ${pendingSendBytes} bytes before the relay paired this socket`,
				);
				readyState = WEBSOCKET_READY_STATE.closing;
				pendingSends.length = 0;
				pendingSendBytes = 0;
				try {
					inner.close();
				} catch {
					// best-effort
				}
				emitClose(RELAY_CLOSE_CODES.backpressure, "backpressure");
				return;
			}
			pendingSends.push(text);
			pendingSendBytes += text.length;
			return;
		}
		outboundSeq += 1;
		const plaintext = encoder.encode(text);
		const sealed = payloadCodec
			? payloadCodec.seal(
					bindRelayPayload({
						channelId,
						seq: outboundSeq,
						payload: plaintext,
					}),
				)
			: plaintext;
		const payload = bytesToBase64(sealed);
		diagnose({
			type: "frame",
			channelId,
			direction: "up",
			bytes: sealed.byteLength,
		});
		sendRaw(
			encodeRelayFrame({
				t: "data",
				channelId,
				seq: outboundSeq,
				payload,
			}),
		);
	};

	inner.addEventListener("open", () => {
		sendRaw(
			encodeRelayFrame({
				t: "client.connect",
				protocolVersion: RELAY_PROTOCOL_VERSION,
				machineId: requestedMachineId,
			}),
		);
	});

	const exposeOpen = (label: string): void => {
		if (!channelId || !machineId) {
			failChannel(
				"unknown_channel",
				"relay channel opened without an identity",
			);
			return;
		}
		readyState = WEBSOCKET_READY_STATE.open;
		diagnose({ type: "channel-open", channelId, machineId, label });
		emit("open", { type: "open" });
		const queued = pendingSends.splice(0, pendingSends.length);
		pendingSendBytes = 0;
		for (const queuedText of queued) {
			sendData(queuedText);
		}
	};

	inner.addEventListener("message", (event: unknown) => {
		const text = readSocketText(event);
		if (text === undefined) {
			return;
		}
		const decoded = decodeRelayFrame(text, { maxPayloadBytes });
		if (!decoded.ok) {
			emitRelayError(decoded.code, decoded.message);
			return;
		}
		const frame = decoded.frame;
		switch (frame.t) {
			case "client.connected": {
				channelId = frame.channelId;
				machineId = frame.machineId;
				machineLabel = frame.label;
				if (options.secureHandshake) {
					outboundSeq = 1;
					const hello = encodeRelaySecureClientHello({
						version: RELAY_SECURE_HANDSHAKE_VERSION,
						kind: options.secureHandshake.kind,
						...(options.secureHandshake.offerId
							? { offerId: options.secureHandshake.offerId }
							: {}),
						message: options.secureHandshake.message,
					});
					sendRaw(
						encodeRelayFrame({
							t: "data",
							channelId,
							seq: outboundSeq,
							payload: bytesToBase64(hello),
						}),
					);
					return;
				}
				exposeOpen(frame.label);
				return;
			}
			case "data": {
				if (frame.channelId !== channelId) {
					failChannel(
						"unknown_channel",
						`frame for channel ${frame.channelId} on a socket bound to ${channelId ?? "none"}`,
					);
					return;
				}
				const expectedSeq = lastInboundSeq + 1;
				if (frame.seq !== expectedSeq) {
					failChannel(
						"replayed_frame",
						`seq ${frame.seq} did not match expected ${expectedSeq}`,
					);
					return;
				}
				const sealed = base64ToBytes(frame.payload);
				if (!sealed) {
					failChannel("malformed_frame", "payload was not valid base64");
					return;
				}
				if (
					options.secureHandshake &&
					readyState !== WEBSOCKET_READY_STATE.open
				) {
					try {
						const reply = decodeRelaySecureHostReply(sealed);
						payloadCodec = options.secureHandshake.complete(reply.message);
						lastInboundSeq = frame.seq;
						exposeOpen(machineLabel);
					} catch (error) {
						failChannel(
							"malformed_frame",
							`secure handshake failed: ${error instanceof Error ? error.message : String(error)}`,
						);
					}
					return;
				}
				let plaintext: Uint8Array;
				try {
					plaintext = payloadCodec
						? openBoundRelayPayload(payloadCodec.open(sealed), {
								channelId: frame.channelId,
								seq: frame.seq,
							})
						: sealed;
				} catch (error) {
					failChannel(
						"malformed_frame",
						`payload failed to open: ${error instanceof Error ? error.message : String(error)}`,
					);
					return;
				}
				lastInboundSeq = frame.seq;
				diagnose({
					type: "frame",
					channelId: frame.channelId,
					direction: "down",
					bytes: sealed.byteLength,
				});
				emit("message", { type: "message", data: decoder.decode(plaintext) });
				return;
			}
			case "ping": {
				sendRaw(encodeRelayFrame({ t: "pong", ts: frame.ts }));
				return;
			}
			case "channel.close": {
				// A relay-supplied code is data, not a key: `RELAY_CLOSE_CODES[code]`
				// resolves inherited names, and a close event carrying a FUNCTION as its
				// code both reaches `HubClient` and makes `inner.close()` throw.
				const code = relayCloseCode(frame.code);
				readyState = WEBSOCKET_READY_STATE.closing;
				emitClose(code, frame.reason ?? frame.code);
				try {
					inner.close();
				} catch {
					// best-effort
				}
				return;
			}
			case "error": {
				emitRelayError(frame.code, frame.message);
				return;
			}
			default:
				return;
		}
	});

	inner.addEventListener("error", (event: unknown) => {
		const message = errorMessage(event) ?? `relay socket error at ${url}`;
		emit("error", { type: "error", message, error: new Error(message) });
	});

	inner.addEventListener("close", (event: unknown) => {
		const closeEvent = event as { code?: number; reason?: unknown } | undefined;
		const code = closeEvent?.code ?? 1006;
		const reason =
			typeof closeEvent?.reason === "string" ? closeEvent.reason : "";
		emitClose(code, reason);
	});

	function buildFacade(): RelayClientSocket {
		return {
			get readyState() {
				return readyState;
			},
			get channelId() {
				return channelId;
			},
			get machineId() {
				return machineId;
			},
			send(data: string) {
				sendData(data);
			},
			close(code?: number, reason?: string) {
				if (readyState === WEBSOCKET_READY_STATE.closed) {
					return;
				}
				readyState = WEBSOCKET_READY_STATE.closing;
				try {
					inner?.close();
				} catch {
					// best-effort
				}
				emitClose(code ?? 1000, reason ?? "");
			},
			addEventListener(type: string, listener: Listener) {
				const set = listeners.get(type) ?? new Set<Listener>();
				set.add(listener);
				listeners.set(type, set);
			},
		};
	}

	return buildFacade();
}

/**
 * `HubClient`'s `WebSocketImpl` is a constructor, so wrap the factory in one.
 * The `url`/`protocols`/`options` arguments `HubClient` passes describe the
 * *hub*, not the relay, and are deliberately ignored — the relay url, account
 * token and target machine come from this closure.
 */
export function createRelayWebSocketImpl(
	options: CreateRelayClientSocketOptions,
): RelayWebSocketCtor {
	class RelayWebSocket implements RelayWebSocketLike {
		private readonly socket: RelayClientSocket =
			createRelayClientSocket(options);

		get readyState(): number {
			return this.socket.readyState;
		}

		send(data: string): void {
			this.socket.send(data);
		}

		close(code?: number, reason?: string): void {
			this.socket.close(code, reason);
		}

		addEventListener(type: string, listener: Listener): void {
			this.socket.addEventListener(type, listener);
		}
	}
	return RelayWebSocket as unknown as RelayWebSocketCtor;
}

function errorMessage(event: unknown): string | undefined {
	if (event instanceof Error) {
		return event.message;
	}
	if (event && typeof event === "object") {
		const candidate = event as { message?: unknown; error?: unknown };
		if (typeof candidate.message === "string" && candidate.message) {
			return candidate.message;
		}
		if (candidate.error instanceof Error) {
			return candidate.error.message;
		}
	}
	return undefined;
}

/** Websocket `message` payload -> text, without `Buffer`. */
function readSocketText(event: unknown): string | undefined {
	const data = (event as { data?: unknown } | undefined)?.data ?? event;
	if (typeof data === "string") {
		return data;
	}
	if (data instanceof ArrayBuffer) {
		return decoder.decode(new Uint8Array(data));
	}
	if (ArrayBuffer.isView(data)) {
		return decoder.decode(
			new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
		);
	}
	return undefined;
}
