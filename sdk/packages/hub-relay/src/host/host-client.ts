/**
 * Host side of the relay — what the laptop runs next to its local hub.
 *
 * It dials OUT to the relay (so the laptop never opens an inbound port, needs no
 * NAT/firewall changes and no VPN), registers a machine under the user's Cline
 * account, and keeps that one socket as the tunnel. For every channel the relay
 * opens it dials a LOCAL hub websocket and pipes frames between the two.
 *
 * The local hub's auth token stays on the laptop: the host injects it into the
 * local connection as the `cline-hub-auth.<token>` subprotocol. This is exactly
 * how the existing cloud session proxy supplies the sandbox hub token — the phone
 * never sees it.
 */

import { WebSocket } from "ws";
import type { RelayPayloadCodec } from "../client/socket";
import {
	base64ToBytes,
	bindRelayPayload,
	bytesToBase64,
	createMachineId,
	decodeRelayFrame,
	decodeRelaySecureClientHello,
	encodeRelayAuthCredential,
	encodeRelayFrame,
	encodeRelaySecureHostReply,
	openBoundRelayPayload,
	RELAY_MAX_PAYLOAD_BYTES,
	RELAY_PROTOCOL_VERSION,
	RELAY_SECURE_HANDSHAKE_VERSION,
	type RelayAuthMode,
	RelayError,
	type RelayErrorCode,
	relayFrameCapBytes,
	relayHostUrl,
} from "../protocol/index";

/** Subprotocol prefix the local Cline hub authenticates with. */
export const HUB_AUTH_PROTOCOL_PREFIX = "cline-hub-auth.";

export interface RelayHostReconnectOptions {
	initialDelayMs?: number;
	maxDelayMs?: number;
	jitterRatio?: number;
	/** `undefined` retries forever, which is what a long-lived hub wants. */
	maxAttempts?: number;
	/**
	 * How long a registration must SURVIVE before the backoff resets. Resetting on
	 * `host.registered` alone means a relay that accepts and immediately drops is
	 * hammered at the initial delay forever, because every attempt "succeeds".
	 */
	stablePeriodMs?: number;
}

export type RelayHostEvent =
	| { type: "connecting"; relayUrl: string; attempt: number }
	| { type: "registered"; machineId: string; accountId: string; label: string }
	| { type: "channel-open"; channelId: string }
	| { type: "channel-closed"; channelId: string; reason: string }
	| {
			type: "frame";
			channelId: string;
			direction: "up" | "down";
			bytes: number;
	  }
	| {
			type: "error";
			code: RelayErrorCode | "hub_connect_failed";
			message: string;
	  }
	| { type: "disconnected"; willRetryInMs: number | undefined }
	| { type: "closed" };

export interface CreateRelayHostClientOptions {
	/** Relay base url, e.g. `ws://127.0.0.1:4610`. */
	relayUrl: string;
	/** Cline account token this machine registers under. */
	accountToken?: string;
	/**
	 * Fresh credential resolver for short-lived relay tickets. Called before every
	 * socket attempt, including reconnects after the previous ticket expires.
	 */
	getAccountToken?: () => Promise<string>;
	/** Local hub websocket url, e.g. `ws://127.0.0.1:4599/hub`. */
	hubUrl: string;
	/** Local hub auth token. Injected host-side; never crosses the relay. */
	hubAuthToken?: string;
	/** Stable id for this machine. Generated (unstable across restarts) if omitted. */
	machineId?: string;
	label?: string;
	/** Defaults to `bearer-header`, matching the cloud session proxy. */
	authMode?: RelayAuthMode;
	headers?: Record<string, string>;
	maxPayloadBytes?: number;
	/**
	 * Channels this host will serve at once. The relay's own per-machine cap is not
	 * a constraint a hostile or buggy relay obeys, and every channel is a real
	 * socket into the local hub.
	 */
	maxChannels?: number;
	/**
	 * Bytes queued for one channel while its local hub socket is still opening.
	 * The queue covers a startup race measured in milliseconds; anything larger is
	 * a relay pushing frames at a hub that is not answering.
	 */
	maxPendingBytesPerChannel?: number;
	/** Plugged in by the pairing layer; identity when omitted. */
	payloadCodec?: RelayPayloadCodec;
	/** Accepts a per-device Noise handshake before any bytes reach the hub. */
	secureHandshake?: RelaySecureHostHandshakeAcceptor;
	reconnect?: RelayHostReconnectOptions;
	onEvent?: (event: RelayHostEvent) => void;
}

export interface RelaySecureHostHandshakeResult {
	response: Uint8Array;
	payloadCodec: RelayPayloadCodec;
	/** Releases registry/channel bindings when this relay channel closes. */
	release?: () => void;
}

export interface RelaySecureHostHandshakeAcceptor {
	accept(input: {
		channelId: string;
		kind: "pairing" | "session";
		offerId?: string;
		message: Uint8Array;
		/** Lets device revocation close the complete tunnel immediately. */
		close(): void;
	}): Promise<RelaySecureHostHandshakeResult>;
}

export type RelayHostState =
	| "idle"
	| "connecting"
	| "registered"
	| "reconnecting"
	| "closed";

export interface RelayHostClient {
	readonly machineId: string;
	/** Connects and resolves once the relay has accepted the registration. */
	start(): Promise<void>;
	state(): RelayHostState;
	channelCount(): number;
	/** Resolves the next time registration succeeds (or rejects if closed first). */
	waitUntilRegistered(): Promise<void>;
	close(): Promise<void>;
}

interface Channel {
	channelId: string;
	hubSocket: WebSocket;
	outboundSeq: number;
	lastInboundSeq: number;
	/** Relay frames that arrived before the local hub socket finished opening. */
	pending: string[];
	pendingBytes: number;
	hubOpen: boolean;
	closed: boolean;
	secureReady: boolean;
	securePending: boolean;
	payloadCodec?: RelayPayloadCodec;
	releaseSecureBinding?: () => void;
	pendingFromHub: string[];
	pendingFromHubBytes: number;
	acceptSecureHandshake?: (
		frame: { channelId: string; seq: number; payload: string },
		sealed: Uint8Array,
	) => Promise<void>;
}

const DEFAULT_RECONNECT: Required<
	Omit<RelayHostReconnectOptions, "maxAttempts">
> = {
	initialDelayMs: 250,
	maxDelayMs: 5_000,
	jitterRatio: 0.5,
	stablePeriodMs: 60_000,
};

/** Mirrors the relay's own default per-machine channel cap. */
const DEFAULT_MAX_CHANNELS = 8;
const DEFAULT_MAX_PENDING_BYTES = 1024 * 1024;

/** Terminal: retrying cannot fix these, so `start()` settles instead of spinning. */
const TERMINAL_ERROR_CODES = new Set<RelayErrorCode>([
	"unauthorized",
	"forbidden_account",
	"protocol_version_unsupported",
]);

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function isLoopbackHostname(hostname: string): boolean {
	const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
	if (normalized === "localhost" || normalized === "::1") {
		return true;
	}
	const octets = normalized.split(".");
	return (
		octets.length === 4 &&
		octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255) &&
		Number(octets[0]) === 127
	);
}

function assertLocalHubUrl(value: string): void {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(
			`hubUrl must be a valid loopback WebSocket URL, got ${value}`,
		);
	}
	if (
		(url.protocol !== "ws:" && url.protocol !== "wss:") ||
		!isLoopbackHostname(url.hostname)
	) {
		throw new Error(
			`hubUrl must use ws:// or wss:// on loopback; refusing ${value}`,
		);
	}
}

export function createRelayHostClient(
	options: CreateRelayHostClientOptions,
): RelayHostClient {
	if (!options.accountToken && !options.getAccountToken) {
		throw new Error("accountToken or getAccountToken is required");
	}
	if (options.payloadCodec && options.secureHandshake) {
		throw new Error("payloadCodec and secureHandshake are mutually exclusive");
	}
	// The relay host is a local bridge, not a generic SSRF-capable WebSocket
	// proxy. Remote access terminates at the relay socket; the privileged hub leg
	// must remain on this machine.
	assertLocalHubUrl(options.hubUrl);
	const machineId = options.machineId ?? createMachineId();
	const label = options.label ?? "Cline machine";
	const authMode: RelayAuthMode = options.authMode ?? "bearer-header";
	const maxPayloadBytes = options.maxPayloadBytes ?? RELAY_MAX_PAYLOAD_BYTES;
	const maxFrameBytes = relayFrameCapBytes(maxPayloadBytes);
	const maxChannels = options.maxChannels ?? DEFAULT_MAX_CHANNELS;
	const maxPendingBytesPerChannel =
		options.maxPendingBytesPerChannel ?? DEFAULT_MAX_PENDING_BYTES;
	const reconnect = { ...DEFAULT_RECONNECT, ...options.reconnect };
	const url = relayHostUrl(options.relayUrl);

	let state: RelayHostState = "idle";
	let socket: WebSocket | undefined;
	let attempt = 0;
	let retryTimer: ReturnType<typeof setTimeout> | undefined;
	let stableTimer: ReturnType<typeof setTimeout> | undefined;
	let closedByCaller = false;
	/** Set when the relay refused us for a reason retrying cannot change. */
	let terminalError: RelayError | undefined;
	const channels = new Map<string, Channel>();
	const registrationWaiters = new Set<{
		resolve: () => void;
		reject: (error: Error) => void;
	}>();

	const emit = (event: RelayHostEvent): void => {
		options.onEvent?.(event);
	};

	const settleRegistration = (error?: Error): void => {
		const waiters = [...registrationWaiters];
		registrationWaiters.clear();
		for (const waiter of waiters) {
			if (error) {
				waiter.reject(error);
			} else {
				waiter.resolve();
			}
		}
	};

	const sendToRelay = (frame: Parameters<typeof encodeRelayFrame>[0]): void => {
		if (socket?.readyState !== WebSocket.OPEN) {
			return;
		}
		try {
			socket.send(encodeRelayFrame(frame));
		} catch {
			// The relay socket is going away; its close handler reconnects.
		}
	};

	const teardownChannel = (channel: Channel, reason: string): void => {
		if (channel.closed) {
			return;
		}
		channel.closed = true;
		channel.releaseSecureBinding?.();
		channels.delete(channel.channelId);
		try {
			channel.hubSocket.close();
		} catch {
			// best-effort
		}
		emit({ type: "channel-closed", channelId: channel.channelId, reason });
	};

	/** Refuses a channel without dialling the hub, telling the relay why. */
	const refuseChannel = (
		channelId: string,
		code: RelayErrorCode,
		reason: string,
	): void => {
		emit({ type: "error", code, message: `channel ${channelId}: ${reason}` });
		sendToRelay({ t: "channel.close", channelId, code, reason });
	};

	const openChannel = (channelId: string): void => {
		if (channels.has(channelId)) {
			// A repeated id used to overwrite the map entry, leaking the previous
			// authenticated hub socket: created, untracked, never closed.
			refuseChannel(
				channelId,
				"unknown_channel",
				"channel id is already open on this machine",
			);
			return;
		}
		if (channels.size >= maxChannels) {
			refuseChannel(
				channelId,
				"channel_limit",
				`this machine already serves ${channels.size} channels`,
			);
			return;
		}
		const protocols = options.hubAuthToken
			? [`${HUB_AUTH_PROTOCOL_PREFIX}${options.hubAuthToken}`]
			: undefined;
		let hubSocket: WebSocket;
		try {
			// The local hub speaks plaintext hub frames, so its cap is the payload cap
			// rather than the relay's base64-expanded frame cap.
			hubSocket = new WebSocket(options.hubUrl, protocols, {
				maxPayload: maxPayloadBytes,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			emit({ type: "error", code: "hub_connect_failed", message });
			sendToRelay({
				t: "channel.close",
				channelId,
				code: "internal",
				reason: `local hub unreachable: ${message}`,
			});
			return;
		}
		const channel: Channel = {
			channelId,
			hubSocket,
			outboundSeq: 0,
			lastInboundSeq: 0,
			pending: [],
			pendingBytes: 0,
			hubOpen: false,
			closed: false,
			secureReady: !options.secureHandshake,
			securePending: false,
			payloadCodec: options.payloadCodec,
			pendingFromHub: [],
			pendingFromHubBytes: 0,
		};
		channels.set(channelId, channel);
		emit({ type: "channel-open", channelId });

		hubSocket.on("open", () => {
			channel.hubOpen = true;
			// Only now does an end-to-end path exist. The relay withholds
			// `client.connected` until it hears this, so the phone's `connect()`
			// fails rather than resolving against a hub that is not there.
			sendToRelay({ t: "channel.ready", channelId });
			const queued = channel.pending.splice(0, channel.pending.length);
			channel.pendingBytes = 0;
			for (const text of queued) {
				try {
					hubSocket.send(text);
				} catch {
					// best-effort
				}
			}
		});

		const sendHubText = (text: string): void => {
			channel.outboundSeq += 1;
			const plaintext = encoder.encode(text);
			const sealed = channel.payloadCodec
				? channel.payloadCodec.seal(
						bindRelayPayload({
							channelId,
							seq: channel.outboundSeq,
							payload: plaintext,
						}),
					)
				: plaintext;
			emit({
				type: "frame",
				channelId,
				direction: "up",
				bytes: sealed.byteLength,
			});
			sendToRelay({
				t: "data",
				channelId,
				seq: channel.outboundSeq,
				payload: bytesToBase64(sealed),
			});
		};

		hubSocket.on("message", (raw: unknown) => {
			const text = toText(raw);
			if (!channel.secureReady) {
				if (
					channel.pendingFromHubBytes + text.length >
					maxPendingBytesPerChannel
				) {
					refuseChannel(
						channelId,
						"backpressure",
						"local hub sent data before the secure handshake completed",
					);
					teardownChannel(channel, "backpressure");
					return;
				}
				channel.pendingFromHub.push(text);
				channel.pendingFromHubBytes += text.length;
				return;
			}
			sendHubText(text);
		});

		channel.acceptSecureHandshake = async (
			frame: { channelId: string; seq: number; payload: string },
			sealed: Uint8Array,
		): Promise<void> => {
			if (
				!options.secureHandshake ||
				channel.secureReady ||
				channel.securePending
			) {
				return;
			}
			channel.securePending = true;
			try {
				const hello = decodeRelaySecureClientHello(sealed);
				const accepted = await options.secureHandshake.accept({
					channelId,
					kind: hello.kind,
					...(hello.offerId ? { offerId: hello.offerId } : {}),
					message: hello.message,
					close: () => {
						sendToRelay({
							t: "channel.close",
							channelId,
							code: "forbidden_account",
							reason: "device access revoked",
						});
						teardownChannel(channel, "device access revoked");
					},
				});
				if (channel.closed) {
					accepted.release?.();
					return;
				}
				channel.payloadCodec = accepted.payloadCodec;
				channel.releaseSecureBinding = accepted.release;
				channel.lastInboundSeq = frame.seq;
				channel.outboundSeq = 1;
				channel.secureReady = true;
				sendToRelay({
					t: "data",
					channelId,
					seq: 1,
					payload: bytesToBase64(
						encodeRelaySecureHostReply({
							version: RELAY_SECURE_HANDSHAKE_VERSION,
							message: accepted.response,
						}),
					),
				});
				const queued = channel.pendingFromHub.splice(
					0,
					channel.pendingFromHub.length,
				);
				channel.pendingFromHubBytes = 0;
				for (const text of queued) {
					sendHubText(text);
				}
			} catch (error) {
				refuseChannel(
					channelId,
					"malformed_frame",
					`secure handshake rejected: ${error instanceof Error ? error.message : String(error)}`,
				);
				teardownChannel(channel, "secure handshake rejected");
			} finally {
				channel.securePending = false;
			}
		};

		hubSocket.on("error", (error: Error) => {
			emit({
				type: "error",
				code: "hub_connect_failed",
				message: error.message,
			});
		});

		hubSocket.on("close", () => {
			if (channel.closed) {
				return;
			}
			channel.closed = true;
			channels.delete(channelId);
			// A socket that never opened means the local hub is down or refused the
			// token. That is a failure, not a clean end-of-session, and the phone has
			// to be able to tell the two apart.
			const failed = !channel.hubOpen;
			sendToRelay({
				t: "channel.close",
				channelId,
				code: failed ? "internal" : "normal",
				reason: failed
					? "could not connect to the local hub"
					: "local hub socket closed",
			});
			emit({
				type: "channel-closed",
				channelId,
				reason: failed ? "hub connect failed" : "hub socket closed",
			});
		});
	};

	const handleRelayFrame = (text: string): void => {
		const decoded = decodeRelayFrame(text, { maxPayloadBytes });
		if (!decoded.ok) {
			emit({ type: "error", code: decoded.code, message: decoded.message });
			return;
		}
		const frame = decoded.frame;
		switch (frame.t) {
			case "host.registered": {
				state = "registered";
				// The backoff resets only once a registration has SURVIVED
				// `stablePeriodMs`; a relay that accepts then drops must still back off.
				if (stableTimer) {
					clearTimeout(stableTimer);
				}
				stableTimer = setTimeout(() => {
					stableTimer = undefined;
					attempt = 0;
				}, reconnect.stablePeriodMs);
				stableTimer.unref?.();
				emit({
					type: "registered",
					machineId: frame.machineId,
					accountId: frame.accountId,
					label: frame.label,
				});
				settleRegistration();
				return;
			}
			case "channel.open":
				openChannel(frame.channelId);
				return;
			case "channel.close": {
				const channel = channels.get(frame.channelId);
				if (channel) {
					teardownChannel(channel, frame.reason ?? frame.code);
				}
				return;
			}
			case "data": {
				const channel = channels.get(frame.channelId);
				if (!channel) {
					// The relay closed this channel already; nothing to pipe into.
					return;
				}
				const expectedSeq = channel.lastInboundSeq + 1;
				if (frame.seq !== expectedSeq) {
					emit({
						type: "error",
						code: "replayed_frame",
						message: `channel ${frame.channelId} seq ${frame.seq} did not match expected ${expectedSeq}`,
					});
					sendToRelay({
						t: "channel.close",
						channelId: frame.channelId,
						code: "replayed_frame",
						reason: "non-monotonic seq",
					});
					teardownChannel(channel, "replayed_frame");
					return;
				}
				const sealed = base64ToBytes(frame.payload);
				if (!sealed) {
					emit({
						type: "error",
						code: "malformed_frame",
						message: "payload was not valid base64",
					});
					sendToRelay({
						t: "channel.close",
						channelId: frame.channelId,
						code: "malformed_frame",
						reason: "payload was not valid base64",
					});
					teardownChannel(channel, "malformed_frame");
					return;
				}
				if (options.secureHandshake && !channel.secureReady) {
					if (channel.securePending) {
						refuseChannel(
							frame.channelId,
							"replayed_frame",
							"received data while the secure handshake was pending",
						);
						teardownChannel(channel, "replayed_frame");
						return;
					}
					void channel.acceptSecureHandshake?.(frame, sealed);
					return;
				}
				let plaintext: Uint8Array;
				try {
					plaintext = channel.payloadCodec
						? openBoundRelayPayload(channel.payloadCodec.open(sealed), {
								channelId: frame.channelId,
								seq: frame.seq,
							})
						: sealed;
				} catch (error) {
					emit({
						type: "error",
						code: "malformed_frame",
						message: `payload failed to open: ${error instanceof Error ? error.message : String(error)}`,
					});
					sendToRelay({
						t: "channel.close",
						channelId: frame.channelId,
						code: "malformed_frame",
						reason: "sealed payload authentication failed",
					});
					teardownChannel(channel, "malformed_frame");
					return;
				}
				channel.lastInboundSeq = frame.seq;
				emit({
					type: "frame",
					channelId: frame.channelId,
					direction: "down",
					bytes: sealed.byteLength,
				});
				const hubText = decoder.decode(plaintext);
				if (!channel.hubOpen) {
					if (
						channel.pendingBytes + hubText.length >
						maxPendingBytesPerChannel
					) {
						// The queue exists to cover a socket that is opening, not to absorb
						// a stream aimed at a hub that never answers.
						emit({
							type: "error",
							code: "backpressure",
							message: `channel ${frame.channelId} queued ${channel.pendingBytes} bytes for a hub socket that has not opened`,
						});
						sendToRelay({
							t: "channel.close",
							channelId: frame.channelId,
							code: "backpressure",
							reason: "local hub socket did not open before the queue filled",
						});
						teardownChannel(channel, "backpressure");
						return;
					}
					channel.pending.push(hubText);
					channel.pendingBytes += hubText.length;
					return;
				}
				try {
					channel.hubSocket.send(hubText);
				} catch {
					// best-effort
				}
				return;
			}
			case "ping":
				sendToRelay({ t: "pong", ts: frame.ts });
				return;
			case "error": {
				emit({ type: "error", code: frame.code, message: frame.message });
				if (TERMINAL_ERROR_CODES.has(frame.code)) {
					giveUp(new RelayError(frame.code, frame.message));
					return;
				}
				if (state !== "registered") {
					settleRegistration(new RelayError(frame.code, frame.message));
				}
				return;
			}
			default:
				return;
		}
	};

	/**
	 * Stops for good. An account credential the relay refuses is not a transient
	 * network fault: retrying it forever both never succeeds and keeps hammering
	 * the relay's verifier, so `start()` settles with the reason instead.
	 */
	const giveUp = (error: RelayError): void => {
		if (terminalError) {
			return;
		}
		terminalError = error;
		if (retryTimer) {
			clearTimeout(retryTimer);
			retryTimer = undefined;
		}
		if (stableTimer) {
			clearTimeout(stableTimer);
			stableTimer = undefined;
		}
		for (const channel of [...channels.values()]) {
			teardownChannel(channel, error.code);
		}
		const current = socket;
		socket = undefined;
		if (current) {
			try {
				current.close();
			} catch {
				// best-effort
			}
		}
		state = "closed";
		emit({ type: "disconnected", willRetryInMs: undefined });
		settleRegistration(error);
	};

	const scheduleReconnect = (): void => {
		if (closedByCaller || terminalError) {
			return;
		}
		if (
			reconnect.maxAttempts !== undefined &&
			attempt >= reconnect.maxAttempts
		) {
			state = "closed";
			emit({ type: "disconnected", willRetryInMs: undefined });
			settleRegistration(
				new RelayError(
					"internal",
					`gave up reconnecting to the relay after ${attempt} attempts`,
				),
			);
			return;
		}
		const base = Math.min(
			reconnect.initialDelayMs * 2 ** attempt,
			reconnect.maxDelayMs,
		);
		const delay = Math.round(
			base * (1 - reconnect.jitterRatio) +
				Math.random() * base * reconnect.jitterRatio,
		);
		state = "reconnecting";
		emit({ type: "disconnected", willRetryInMs: delay });
		retryTimer = setTimeout(() => {
			retryTimer = undefined;
			void connect();
		}, delay);
		retryTimer.unref?.();
	};

	async function connect(): Promise<void> {
		if (closedByCaller || terminalError) {
			return;
		}
		attempt += 1;
		state = state === "registered" ? "reconnecting" : "connecting";
		emit({ type: "connecting", relayUrl: url, attempt });
		let accountToken: string;
		try {
			accountToken = options.getAccountToken
				? await options.getAccountToken()
				: (options.accountToken as string);
			if (!accountToken.trim()) {
				throw new Error("relay credential resolver returned an empty token");
			}
		} catch (error) {
			if (closedByCaller || terminalError) return;
			emit({
				type: "error",
				code: "unauthorized",
				message: error instanceof Error ? error.message : String(error),
			});
			scheduleReconnect();
			return;
		}
		if (closedByCaller || terminalError) return;
		const protocols =
			authMode === "relay-subprotocol"
				? [encodeRelayAuthCredential(accountToken)]
				: undefined;
		const headers: Record<string, string> = { ...options.headers };
		if (authMode === "bearer-header") {
			headers.Authorization = `Bearer ${accountToken}`;
		}
		let next: WebSocket;
		try {
			next = new WebSocket(url, protocols, {
				headers,
				// Without this the laptop inherits ws's 100 MiB default and a hostile relay
				// can force a 100 MiB `JSON.parse` before any relay-level cap applies.
				maxPayload: maxFrameBytes,
			});
		} catch (error) {
			if (closedByCaller || terminalError) return;
			emit({
				type: "error",
				code: "internal",
				message: error instanceof Error ? error.message : String(error),
			});
			scheduleReconnect();
			return;
		}
		socket = next;

		next.on("open", () => {
			sendToRelay({
				t: "host.register",
				protocolVersion: RELAY_PROTOCOL_VERSION,
				machineId,
				label,
			});
		});
		next.on("message", (raw: unknown) => {
			handleRelayFrame(toText(raw));
		});
		next.on("error", (error: Error) => {
			// A rejected UPGRADE never produces an `error` frame — the relay answers
			// 401/403 and `ws` surfaces it here. Without this, a revoked token is
			// indistinguishable from a network blip and `start()` never settles.
			const status = /Unexpected server response: (\d{3})/.exec(error.message);
			const code: RelayErrorCode | undefined =
				status?.[1] === "401"
					? "unauthorized"
					: status?.[1] === "403"
						? "forbidden_account"
						: undefined;
			emit({ type: "error", code: code ?? "internal", message: error.message });
			if (code) {
				giveUp(new RelayError(code, `${code}: ${error.message}`));
			}
		});
		next.on("close", () => {
			if (socket !== next) {
				return;
			}
			socket = undefined;
			if (stableTimer) {
				clearTimeout(stableTimer);
				stableTimer = undefined;
			}
			// The relay is the only path to the phone, so a dropped relay socket makes
			// every channel dead: close the local hub sockets rather than leak them.
			for (const channel of [...channels.values()]) {
				teardownChannel(channel, "relay socket closed");
			}
			if (closedByCaller) {
				state = "closed";
				return;
			}
			scheduleReconnect();
		});
	}

	return {
		machineId,
		start: async () => {
			if (terminalError) {
				throw terminalError;
			}
			if (state === "closed") {
				throw new RelayError("internal", "this host client was already closed");
			}
			const registered = new Promise<void>((resolve, reject) => {
				registrationWaiters.add({ resolve, reject });
			});
			void connect();
			await registered;
		},
		state: () => state,
		channelCount: () => channels.size,
		waitUntilRegistered: () =>
			state === "registered"
				? Promise.resolve()
				: new Promise<void>((resolve, reject) => {
						registrationWaiters.add({ resolve, reject });
					}),
		close: async () => {
			closedByCaller = true;
			if (retryTimer) {
				clearTimeout(retryTimer);
				retryTimer = undefined;
			}
			if (stableTimer) {
				clearTimeout(stableTimer);
				stableTimer = undefined;
			}
			for (const channel of [...channels.values()]) {
				teardownChannel(channel, "host client closed");
			}
			const current = socket;
			socket = undefined;
			if (current) {
				await new Promise<void>((resolve) => {
					current.once("close", () => resolve());
					try {
						current.close();
					} catch {
						resolve();
					}
					setTimeout(() => {
						try {
							current.terminate();
						} catch {
							// best-effort
						}
						resolve();
					}, 500).unref?.();
				});
			}
			state = "closed";
			settleRegistration(
				new RelayError("internal", "host client closed before registering"),
			);
			emit({ type: "closed" });
		},
	};
}

/** `ws` message payload -> text. Node-side, so `Buffer` is fine here. */
function toText(raw: unknown): string {
	if (typeof raw === "string") {
		return raw;
	}
	if (raw instanceof ArrayBuffer) {
		return Buffer.from(raw).toString("utf8");
	}
	if (Array.isArray(raw)) {
		return Buffer.concat(raw.map((chunk) => Buffer.from(chunk))).toString(
			"utf8",
		);
	}
	if (ArrayBuffer.isView(raw)) {
		return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString(
			"utf8",
		);
	}
	return String(raw);
}
