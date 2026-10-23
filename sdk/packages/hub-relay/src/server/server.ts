/**
 * The relay server — a blind pipe between a laptop hub and a phone.
 *
 * Shape of the thing:
 * - A laptop hub dials OUT to `/v1/host`, authenticates with its Cline account
 *   token, and registers a machine record. Its socket stays open as the outbound
 *   tunnel. No inbound port is ever opened on the laptop.
 * - A phone connects to `/v1/client` with the SAME account, names a machine (or
 *   `"newest"`), and the relay pairs the two sockets into a channel.
 * - Frames are piped verbatim in both directions. The relay validates the outer
 *   envelope only; `payload` is an opaque base64 blob it never decodes.
 *
 * Account scoping is the security boundary the relay owns: a client can only ever
 * be paired with a machine whose `accountId` equals its own. Confidentiality of
 * the bytes is NOT the relay's job — that belongs to the pairing layer's
 * end-to-end encryption, which is why this file contains no hub-protocol
 * knowledge whatsoever.
 */

import { createServer, type Server } from "node:http";
import type { Duplex } from "node:stream";
import { type WebSocket, WebSocketServer } from "ws";
import { base64DecodedByteLength } from "../protocol/base64";
import { createChannelId } from "../protocol/ids";
import {
	decodeRelayAuthCredential,
	decodeRelayFrame,
	encodeRelayFrame,
	isRelayProtocolCompatible,
	RELAY_CLIENT_PATH,
	RELAY_HANDSHAKE_TIMEOUT_MS,
	RELAY_HEARTBEAT_INTERVAL_MS,
	RELAY_HEARTBEAT_TIMEOUT_MS,
	RELAY_HOST_PATH,
	RELAY_MAX_CLOSE_REASON_LENGTH,
	RELAY_MAX_LABEL_LENGTH,
	RELAY_MAX_PAYLOAD_BYTES,
	RELAY_NEWEST_MACHINE,
	RELAY_PROTOCOL_VERSION,
	RELAY_SEND_HIGH_WATER_MARK_BYTES,
	type RelayErrorCode,
	type RelayFrame,
	relayCloseCode,
	relayFrameCapBytes,
	sanitizeRelayText,
} from "../protocol/index";

/** What `verifyAccount` resolves to for an accepted token. */
export interface RelayAccount {
	accountId: string;
	/** Optional display info; only ever logged, never used for routing. */
	displayName?: string;
	/**
	 * Optional machine capability carried by production relay tickets. When set,
	 * the first protocol frame must name this exact machine. Development account
	 * tokens omit it and retain their existing account-wide behavior.
	 */
	machineId?: string;
}

export interface VerifyAccountContext {
	role: "host" | "client";
	/** Raw credential, from `Authorization: Bearer <token>` or the auth subprotocol. */
	token: string | undefined;
	/** Lower-cased upgrade headers, for verifiers that need more than the token. */
	headers: Record<string, string | undefined>;
}

/**
 * Injectable account verification. A dev relay accepts a shared token; production
 * verifies a WorkOS/Cline JWT (`Bearer workos:<jwt>`) exactly as the cloud
 * session proxy's `AuthMiddleware` does, and returns the Cline user/org id.
 *
 * Returning `undefined` rejects the upgrade with HTTP 401.
 */
export type VerifyAccount = (
	context: VerifyAccountContext,
) => Promise<RelayAccount | undefined> | RelayAccount | undefined;

export interface RelayServerLimits {
	/** Registered hubs per account. */
	maxHostsPerAccount?: number;
	/** Simultaneous phone sockets per account. */
	maxClientsPerAccount?: number;
	/** Simultaneous channels against one machine. */
	maxChannelsPerMachine?: number;
	/**
	 * Remembered (including offline) machines per account. The registry is what
	 * separates `machine_offline` from `machine_not_found`; without a cap a host
	 * can grow it one entry per registration, for free, forever.
	 */
	maxKnownMachinesPerAccount?: number;
	/** Remembered machines across all accounts. */
	maxKnownMachines?: number;
	/**
	 * Undecodable frames a host tunnel may send before it is dropped. A frame the
	 * relay CAN attribute to a channel costs only that channel (see
	 * `handleHostSocket`); this bounds the rest.
	 */
	maxMalformedFramesPerHost?: number;
	/** Sustained opaque payload bytes per second across one account. */
	maxBytesPerSecondPerAccount?: number;
	/** Sustained opaque payload bytes per second on one channel. */
	maxBytesPerSecondPerChannel?: number;
	/** Token-bucket burst capacity shared by an account. */
	accountBurstBytes?: number;
	/** Token-bucket burst capacity for one channel. */
	channelBurstBytes?: number;
}

export type RelayServerEvent =
	| { type: "listening"; url: string; port: number }
	| { type: "auth.rejected"; role: "host" | "client"; reason: string }
	| {
			type: "host.registered";
			machineId: string;
			accountId: string;
			label: string;
	  }
	| {
			type: "host.disconnected";
			machineId: string;
			accountId: string;
			channelsTornDown: number;
	  }
	| {
			type: "channel.opened";
			channelId: string;
			machineId: string;
			accountId: string;
	  }
	| {
			type: "channel.closed";
			channelId: string;
			machineId: string;
			code: RelayErrorCode | "normal";
			framesFromClient: number;
			framesFromHost: number;
			bytes: number;
	  }
	/** Metadata only. `bytes` is a length; contents are never surfaced. */
	| {
			type: "frame";
			channelId: string;
			direction: "client->host" | "host->client";
			bytes: number;
	  }
	| {
			type: "rejected";
			role: "host" | "client";
			code: RelayErrorCode;
			message: string;
	  }
	/**
	 * `verifyAccount` THREW: the relay could not decide, which is an outage on the
	 * relay's side (answered `503`), not a rejected credential. Alerting must be
	 * able to tell a JWKS outage from someone probing with bad tokens.
	 */
	| { type: "auth.error"; role: "host" | "client"; message: string };

export interface CreateRelayServerOptions {
	verifyAccount: VerifyAccount;
	/** `0` (the default) binds an ephemeral port. */
	port?: number;
	host?: string;
	hostPath?: string;
	clientPath?: string;
	maxPayloadBytes?: number;
	/**
	 * Websocket-level `maxPayload`. Derived from {@link maxPayloadBytes} by default
	 * so raising the payload cap cannot silently degrade to `ws`'s untyped 1009.
	 */
	maxFrameBytes?: number;
	/**
	 * Bytes allowed to sit in one socket's outbound buffer before the relay stops
	 * feeding it. See "backpressure" in the module docs.
	 */
	sendHighWaterMarkBytes?: number;
	/** How long a peer may stay over the watermark before its channel is closed. */
	backpressureStallMs?: number;
	/** How long a host has to confirm its local hub before the phone gives up. */
	channelReadyTimeoutMs?: number;
	/** How long an offline machine is remembered. */
	machineTtlMs?: number;
	/** Grace between a typed close frame and `terminate()`, so the close flushes. */
	closeGraceMs?: number;
	heartbeatIntervalMs?: number;
	heartbeatTimeoutMs?: number;
	handshakeTimeoutMs?: number;
	limits?: RelayServerLimits;
	onEvent?: (event: RelayServerEvent) => void;
	now?: () => number;
}

export interface RelayMachineRecord {
	machineId: string;
	accountId: string;
	label: string;
	connectedAt: number;
	/** Open channels against this machine right now. */
	channels: number;
}

export interface RelayServerStats {
	hosts: number;
	clients: number;
	channels: number;
	framesRelayed: number;
	/** Decoded payload bytes, not base64 characters. */
	bytesRelayed: number;
	/** Bytes queued in socket send buffers right now — the backpressure gauge. */
	bytesBuffered: number;
	/** Machine records held, online and offline. Must stay bounded. */
	knownMachines: number;
}

export interface RelayServer {
	/** `ws://host:port` — append `/v1/host` or `/v1/client`, or pass as `relayUrl`. */
	readonly url: string;
	readonly port: number;
	/** Every machine whose hub is connected right now. */
	machines(): RelayMachineRecord[];
	machinesForAccount(accountId: string): RelayMachineRecord[];
	stats(): RelayServerStats;
	close(): Promise<void>;
}

interface HostConnection {
	socket: WebSocket;
	accountId: string;
	machineId?: string;
	/** `(accountId, machineId)` routing key; set at registration. */
	machineKey?: string;
	label: string;
	connectedAt: number;
	lastSeenAt: number;
	channels: Set<RelayChannel>;
	/** Frames the relay could not attribute to any channel. */
	malformedFrames: number;
}

interface ClientConnection {
	socket: WebSocket;
	accountId: string;
	lastSeenAt: number;
	channel?: RelayChannel;
}

interface RelayChannel {
	channelId: string;
	host: HostConnection;
	client: ClientConnection;
	machineId: string;
	openedAt: number;
	lastClientSeq: number;
	lastHostSeq: number;
	framesFromClient: number;
	framesFromHost: number;
	bytes: number;
	bandwidth: TokenBucket;
	closed: boolean;
	/** The host has confirmed its local hub socket is open (`channel.ready`). */
	ready: boolean;
	readyTimer?: ReturnType<typeof setTimeout>;
	/** The client socket is paused because the host is not draining. */
	paused: boolean;
	pausedSince: number;
	drainTimer?: ReturnType<typeof setInterval>;
}

interface KnownMachine {
	accountId: string;
	machineId: string;
	label: string;
	lastSeenAt: number;
}

interface TokenBucket {
	tokens: number;
	lastRefillAt: number;
}

const DEFAULT_LIMITS: Required<RelayServerLimits> = {
	maxHostsPerAccount: 8,
	maxClientsPerAccount: 16,
	maxChannelsPerMachine: 8,
	maxKnownMachinesPerAccount: 64,
	maxKnownMachines: 10_000,
	maxMalformedFramesPerHost: 8,
	maxBytesPerSecondPerAccount: 64 * 1024 * 1024,
	maxBytesPerSecondPerChannel: 16 * 1024 * 1024,
	accountBurstBytes: 64 * 1024 * 1024,
	channelBurstBytes: 16 * 1024 * 1024,
};

/** Offline machines are forgotten after a day. */
const DEFAULT_MACHINE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BACKPRESSURE_STALL_MS = 30_000;
const DEFAULT_CLOSE_GRACE_MS = 1_000;
const DRAIN_POLL_MS = 25;

/**
 * Routing key. Machine ids are scoped PER ACCOUNT, which is what makes
 * cross-account squatting impossible by construction rather than by check: two
 * accounts naming the same machine are two different machines, and no
 * unauthenticated party can affect an id it does not authenticate for. `\u0000`
 * cannot appear in an id (see `isValidMachineId`), so the join is unambiguous.
 */
function machineKey(accountId: string, machineId: string): string {
	return `${accountId}\u0000${machineId}`;
}

function readAuthToken(
	headers: Record<string, string | undefined>,
): string | undefined {
	const authorization = headers.authorization;
	if (authorization?.toLowerCase().startsWith("bearer ")) {
		const token = authorization.slice(7).trim();
		if (token) {
			return token;
		}
	}
	const offered = headers["sec-websocket-protocol"];
	if (!offered) {
		return undefined;
	}
	for (const entry of offered.split(",")) {
		const token = decodeRelayAuthCredential(entry);
		if (token) {
			return token;
		}
	}
	return undefined;
}

function rejectUpgrade(socket: Duplex, status: number, text: string): void {
	try {
		socket.write(
			`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
		);
		socket.end();
	} catch {
		socket.destroy();
	}
}

export async function createRelayServer(
	options: CreateRelayServerOptions,
): Promise<RelayServer> {
	const host = options.host ?? "127.0.0.1";
	const hostPath = options.hostPath ?? RELAY_HOST_PATH;
	const clientPath = options.clientPath ?? RELAY_CLIENT_PATH;
	const maxPayloadBytes = options.maxPayloadBytes ?? RELAY_MAX_PAYLOAD_BYTES;
	const maxFrameBytes =
		options.maxFrameBytes ?? relayFrameCapBytes(maxPayloadBytes);
	// Never below two whole frames, or one legal maximum-size frame would look like
	// a peer that stopped draining.
	const sendHighWaterMarkBytes =
		options.sendHighWaterMarkBytes ??
		Math.max(RELAY_SEND_HIGH_WATER_MARK_BYTES, maxFrameBytes * 2);
	const resumeMarkBytes = Math.floor(sendHighWaterMarkBytes / 2);
	const backpressureStallMs =
		options.backpressureStallMs ?? DEFAULT_BACKPRESSURE_STALL_MS;
	const machineTtlMs = options.machineTtlMs ?? DEFAULT_MACHINE_TTL_MS;
	const closeGraceMs = options.closeGraceMs ?? DEFAULT_CLOSE_GRACE_MS;
	const heartbeatIntervalMs =
		options.heartbeatIntervalMs ?? RELAY_HEARTBEAT_INTERVAL_MS;
	const heartbeatTimeoutMs =
		options.heartbeatTimeoutMs ?? RELAY_HEARTBEAT_TIMEOUT_MS;
	const handshakeTimeoutMs =
		options.handshakeTimeoutMs ?? RELAY_HANDSHAKE_TIMEOUT_MS;
	const channelReadyTimeoutMs =
		options.channelReadyTimeoutMs ?? handshakeTimeoutMs;
	const limits = { ...DEFAULT_LIMITS, ...options.limits };
	for (const name of [
		"maxBytesPerSecondPerAccount",
		"maxBytesPerSecondPerChannel",
		"accountBurstBytes",
		"channelBurstBytes",
	] as const) {
		const value = limits[name];
		if (!Number.isFinite(value) || value <= 0) {
			throw new Error(`relay limit ${name} must be a positive finite number`);
		}
	}
	// With default burst settings, one legal request and one legal response must
	// fit back-to-back. Explicit capacities remain authoritative so deployments
	// can intentionally choose a stricter policy.
	const minimumRoundTripBurst = maxPayloadBytes * 2;
	if (options.limits?.channelBurstBytes === undefined) {
		limits.channelBurstBytes = Math.max(
			limits.channelBurstBytes,
			minimumRoundTripBurst,
		);
	}
	if (options.limits?.accountBurstBytes === undefined) {
		limits.accountBurstBytes = Math.max(
			limits.accountBurstBytes,
			minimumRoundTripBurst,
		);
	}
	const now = options.now ?? (() => Date.now());
	const emit = (event: RelayServerEvent): void => {
		options.onEvent?.(event);
	};

	/** `(accountId, machineId)` -> record, online or not. */
	const knownMachines = new Map<string, KnownMachine>();
	const knownByAccount = new Map<string, Set<string>>();
	/** `(accountId, machineId)` -> the host socket serving it right now. */
	const liveHosts = new Map<string, HostConnection>();
	const hostsByAccount = new Map<string, Set<HostConnection>>();
	const clientsByAccount = new Map<string, Set<ClientConnection>>();
	const channels = new Map<string, RelayChannel>();
	const accountBandwidth = new Map<string, TokenBucket>();
	let framesRelayed = 0;
	let bytesRelayed = 0;

	const createBucket = (capacity: number): TokenBucket => ({
		tokens: capacity,
		lastRefillAt: now(),
	});

	const refillBucket = (
		bucket: TokenBucket,
		rate: number,
		capacity: number,
		at: number,
	): void => {
		const elapsedMs = Math.max(0, at - bucket.lastRefillAt);
		bucket.tokens = Math.min(
			capacity,
			bucket.tokens + (elapsedMs / 1000) * rate,
		);
		bucket.lastRefillAt = Math.max(bucket.lastRefillAt, at);
	};

	const consumeBandwidth = (channel: RelayChannel, bytes: number): boolean => {
		const at = now();
		const account =
			accountBandwidth.get(channel.host.accountId) ??
			createBucket(limits.accountBurstBytes);
		accountBandwidth.set(channel.host.accountId, account);
		refillBucket(
			account,
			limits.maxBytesPerSecondPerAccount,
			limits.accountBurstBytes,
			at,
		);
		refillBucket(
			channel.bandwidth,
			limits.maxBytesPerSecondPerChannel,
			limits.channelBurstBytes,
			at,
		);
		if (account.tokens < bytes || channel.bandwidth.tokens < bytes) {
			return false;
		}
		account.tokens -= bytes;
		channel.bandwidth.tokens -= bytes;
		return true;
	};

	const send = (socket: WebSocket, frame: RelayFrame): void => {
		if (socket.readyState !== socket.OPEN) {
			return;
		}
		try {
			socket.send(encodeRelayFrame(frame));
		} catch {
			// The socket is going away; its close handler cleans up.
		}
	};

	/**
	 * Typed close: the error frame first (it carries the code and a message), then
	 * the mapped close code, then a `terminate()` only if the peer never completes
	 * the closing handshake. Terminating in the same tick discards the close frame,
	 * which is how a typed code turns into an untyped 1006 in a peer's logs.
	 */
	const closeSocket = (
		socket: WebSocket,
		code: RelayErrorCode | "normal",
		reason: string,
	): void => {
		try {
			socket.close(relayCloseCode(code), reason);
		} catch {
			// best-effort
		}
		const grace = setTimeout(() => {
			try {
				if (socket.readyState !== socket.CLOSED) {
					socket.terminate();
				}
			} catch {
				// best-effort
			}
		}, closeGraceMs);
		grace.unref?.();
	};

	const fail = (
		socket: WebSocket,
		role: "host" | "client",
		code: RelayErrorCode,
		message: string,
		channelId?: string,
	): void => {
		emit({ type: "rejected", role, code, message });
		send(socket, {
			t: "error",
			code,
			message,
			...(channelId ? { channelId } : {}),
		});
		closeSocket(socket, code, code);
	};

	const rememberMachine = (
		accountId: string,
		machineId: string,
		label: string,
	): string => {
		const key = machineKey(accountId, machineId);
		knownMachines.set(key, {
			accountId,
			machineId,
			label,
			lastSeenAt: now(),
		});
		const keys = knownByAccount.get(accountId) ?? new Set<string>();
		keys.add(key);
		knownByAccount.set(accountId, keys);
		pruneKnownMachines(accountId);
		return key;
	};

	const forgetMachine = (key: string): void => {
		const known = knownMachines.get(key);
		knownMachines.delete(key);
		if (!known) {
			return;
		}
		const keys = knownByAccount.get(known.accountId);
		keys?.delete(key);
		if (keys && keys.size === 0) {
			knownByAccount.delete(known.accountId);
		}
	};

	/**
	 * Drops expired offline records and, if an account is still over its cap, the
	 * oldest offline ones. Nothing live is ever evicted, so eviction cannot be used
	 * to knock a connected machine out of the registry.
	 */
	function pruneKnownMachines(accountId?: string): void {
		const accounts = accountId ? [accountId] : [...knownByAccount.keys()];
		const expiry = now() - machineTtlMs;
		for (const account of accounts) {
			const keys = knownByAccount.get(account);
			if (!keys) {
				continue;
			}
			for (const key of [...keys]) {
				const known = knownMachines.get(key);
				if (!known) {
					keys.delete(key);
					continue;
				}
				if (!liveHosts.has(key) && known.lastSeenAt <= expiry) {
					forgetMachine(key);
				}
			}
			const overflow = keys.size - limits.maxKnownMachinesPerAccount;
			if (overflow > 0) {
				const offline = [...keys]
					.filter((key) => !liveHosts.has(key))
					.map((key) => knownMachines.get(key))
					.filter((known): known is KnownMachine => known !== undefined)
					.sort((left, right) => left.lastSeenAt - right.lastSeenAt);
				for (const known of offline.slice(0, overflow)) {
					forgetMachine(machineKey(known.accountId, known.machineId));
				}
			}
			if (keys.size === 0) {
				knownByAccount.delete(account);
			}
		}
		// A global backstop, so many accounts cannot do what one account cannot.
		if (knownMachines.size > limits.maxKnownMachines) {
			const offline = [...knownMachines.entries()]
				.filter(([key]) => !liveHosts.has(key))
				.sort(([, left], [, right]) => left.lastSeenAt - right.lastSeenAt);
			for (const [key] of offline.slice(
				0,
				knownMachines.size - limits.maxKnownMachines,
			)) {
				forgetMachine(key);
			}
		}
	}

	/** `ws` exposes `pause()`/`resume()`; some shims (Bun's) do not. */
	const canPause = (socket: WebSocket): boolean =>
		typeof socket.pause === "function" && typeof socket.resume === "function";

	const resumeChannel = (channel: RelayChannel): void => {
		if (channel.drainTimer) {
			clearInterval(channel.drainTimer);
			channel.drainTimer = undefined;
		}
		if (!channel.paused) {
			return;
		}
		channel.paused = false;
		try {
			channel.client.socket.resume();
		} catch {
			// best-effort
		}
	};

	const closeChannel = (
		channel: RelayChannel,
		code: RelayErrorCode | "normal",
		rawReason: string,
		notify: { host: boolean; client: boolean },
	): void => {
		if (channel.closed) {
			return;
		}
		const reason = sanitizeRelayText(rawReason, RELAY_MAX_CLOSE_REASON_LENGTH);
		channel.closed = true;
		if (channel.readyTimer) {
			clearTimeout(channel.readyTimer);
			channel.readyTimer = undefined;
		}
		resumeChannel(channel);
		channels.delete(channel.channelId);
		channel.host.channels.delete(channel);
		if (channel.client.channel === channel) {
			channel.client.channel = undefined;
		}
		if (notify.host) {
			send(channel.host.socket, {
				t: "channel.close",
				channelId: channel.channelId,
				code,
				reason,
			});
		}
		if (notify.client) {
			send(channel.client.socket, {
				t: "channel.close",
				channelId: channel.channelId,
				code,
				reason,
			});
			closeSocket(channel.client.socket, code, code);
		}
		emit({
			type: "channel.closed",
			channelId: channel.channelId,
			machineId: channel.machineId,
			code,
			framesFromClient: channel.framesFromClient,
			framesFromHost: channel.framesFromHost,
			bytes: channel.bytes,
		});
	};

	/**
	 * Stop reading from the phone until the host tunnel drains.
	 *
	 * Only ever the CLIENT socket: it carries exactly one channel, so pausing it
	 * costs nobody else. The host tunnel is shared by every phone on that machine,
	 * so it is never paused — a client that will not drain has its own channel
	 * closed instead (see `pipeFrame`).
	 */
	const pauseUntilDrained = (channel: RelayChannel): void => {
		if (channel.paused || channel.closed) {
			return;
		}
		if (!canPause(channel.client.socket)) {
			// Not every `ws` implementation has `pause()` — Bun's shim does not. With
			// no way to stop reading, the only bounded option left is to end the
			// channel, which is what the other direction does anyway.
			closeChannel(
				channel,
				"backpressure",
				`machine ${channel.machineId} is not draining and this runtime cannot pause a socket`,
				{ host: true, client: true },
			);
			return;
		}
		channel.paused = true;
		channel.pausedSince = now();
		try {
			channel.client.socket.pause();
		} catch {
			// best-effort
		}
		const timer = setInterval(() => {
			if (channel.closed) {
				resumeChannel(channel);
				return;
			}
			if (channel.host.socket.bufferedAmount <= resumeMarkBytes) {
				resumeChannel(channel);
				return;
			}
			if (now() - channel.pausedSince >= backpressureStallMs) {
				closeChannel(
					channel,
					"backpressure",
					`machine ${channel.machineId} stopped draining`,
					{ host: true, client: true },
				);
			}
		}, DRAIN_POLL_MS);
		timer.unref?.();
		channel.drainTimer = timer;
	};

	/** Forward one opaque data frame. The `payload` string is copied, never read. */
	const pipeFrame = (
		channel: RelayChannel,
		direction: "client->host" | "host->client",
		frame: { channelId: string; seq: number; payload: string },
	): void => {
		// Decoded bytes, not base64 characters: stats feed metering and quotas, and
		// base64 is 33% larger than what the user actually sent.
		const bytes = base64DecodedByteLength(frame.payload);
		const target =
			direction === "client->host"
				? channel.host.socket
				: channel.client.socket;
		if (!consumeBandwidth(channel, bytes)) {
			closeChannel(
				channel,
				"rate_limited",
				`channel or account exceeded its byte-rate budget`,
				{ host: true, client: true },
			);
			return;
		}
		if (
			direction === "host->client" &&
			target.bufferedAmount > sendHighWaterMarkBytes
		) {
			// The phone is not draining. The relay cannot pause the host without
			// stalling every other phone on that laptop, so this one channel goes.
			closeChannel(
				channel,
				"backpressure",
				`client is not draining (${target.bufferedAmount} bytes queued)`,
				{ host: true, client: true },
			);
			return;
		}
		framesRelayed += 1;
		bytesRelayed += bytes;
		channel.bytes += bytes;
		if (direction === "client->host") {
			channel.framesFromClient += 1;
		} else {
			channel.framesFromHost += 1;
		}
		send(target, {
			t: "data",
			channelId: frame.channelId,
			seq: frame.seq,
			payload: frame.payload,
		});
		if (
			direction === "client->host" &&
			target.bufferedAmount > sendHighWaterMarkBytes
		) {
			pauseUntilDrained(channel);
		}
		emit({ type: "frame", channelId: channel.channelId, direction, bytes });
	};

	const trackAccount = <T>(
		map: Map<string, Set<T>>,
		accountId: string,
		value: T,
	): void => {
		const set = map.get(accountId) ?? new Set<T>();
		set.add(value);
		map.set(accountId, set);
	};

	const untrackAccount = <T>(
		map: Map<string, Set<T>>,
		accountId: string,
		value: T,
	): void => {
		const set = map.get(accountId);
		if (!set) {
			return;
		}
		set.delete(value);
		if (set.size === 0) {
			map.delete(accountId);
		}
	};

	/**
	 * Ends a channel that never became ready, as a CONNECT failure on the client
	 * side: an `error` frame with a typed code, not a `channel.close` for a channel
	 * the phone was never told about.
	 */
	const failPendingChannel = (
		channel: RelayChannel,
		code: RelayErrorCode,
		reason: string,
	): void => {
		const client = channel.client.socket;
		closeChannel(channel, code, reason, { host: false, client: false });
		fail(
			client,
			"client",
			code,
			sanitizeRelayText(reason, RELAY_MAX_CLOSE_REASON_LENGTH),
		);
	};

	const handleHostSocket = (socket: WebSocket, account: RelayAccount): void => {
		const connection: HostConnection = {
			socket,
			accountId: account.accountId,
			label: sanitizeRelayText(
				account.displayName ?? "unnamed machine",
				RELAY_MAX_LABEL_LENGTH,
			),
			connectedAt: now(),
			lastSeenAt: now(),
			channels: new Set(),
			malformedFrames: 0,
		};
		trackAccount(hostsByAccount, account.accountId, connection);

		const handshakeTimer = setTimeout(() => {
			if (!connection.machineId) {
				fail(
					socket,
					"host",
					"handshake_timeout",
					"host.register never arrived",
				);
			}
		}, handshakeTimeoutMs);

		socket.on("pong", () => {
			connection.lastSeenAt = now();
		});

		socket.on("message", (raw: unknown) => {
			connection.lastSeenAt = now();
			const decoded = decodeRelayFrame(toText(raw), {
				maxPayloadBytes,
				maxFrameBytes,
			});
			if (!decoded.ok) {
				// A host socket is a MULTIPLEXED tunnel: one bad frame must cost the
				// channel it named, not every phone connected to that laptop.
				const offending = decoded.channelId
					? channels.get(decoded.channelId)
					: undefined;
				if (offending && offending.host === connection) {
					emit({
						type: "rejected",
						role: "host",
						code: decoded.code,
						message: decoded.message,
					});
					send(socket, {
						t: "error",
						code: decoded.code,
						message: decoded.message,
						channelId: offending.channelId,
					});
					closeChannel(offending, decoded.code, decoded.message, {
						host: false,
						client: true,
					});
					return;
				}
				connection.malformedFrames += 1;
				emit({
					type: "rejected",
					role: "host",
					code: decoded.code,
					message: decoded.message,
				});
				send(socket, {
					t: "error",
					code: decoded.code,
					message: decoded.message,
				});
				if (connection.malformedFrames >= limits.maxMalformedFramesPerHost) {
					fail(
						socket,
						"host",
						"malformed_frame",
						`${connection.malformedFrames} undecodable frames`,
					);
				}
				return;
			}
			const frame = decoded.frame;
			if (!connection.machineId) {
				if (frame.t !== "host.register") {
					fail(
						socket,
						"host",
						"malformed_frame",
						`expected host.register, got ${frame.t}`,
					);
					return;
				}
				if (!isRelayProtocolCompatible(frame.protocolVersion)) {
					fail(
						socket,
						"host",
						"protocol_version_unsupported",
						`relay speaks ${RELAY_PROTOCOL_VERSION}, host offered ${frame.protocolVersion}`,
					);
					return;
				}
				if (account.machineId && frame.machineId !== account.machineId) {
					fail(
						socket,
						"host",
						"unauthorized",
						"relay ticket is not valid for this machine",
					);
					return;
				}
				// No ownership CHECK is needed: ids are scoped to the authenticated
				// account, so `mach_x` under account A and `mach_x` under account B are
				// two different machines and neither account can affect the other's.
				const key = machineKey(account.accountId, frame.machineId);
				const previous = liveHosts.get(key);
				if (previous && previous !== connection) {
					// A reconnect after a half-open socket: the newest registration wins.
					for (const channel of [...previous.channels]) {
						closeChannel(channel, "machine_gone", "host re-registered", {
							host: false,
							client: true,
						});
					}
					closeSocket(
						previous.socket,
						"internal",
						"superseded by a newer registration",
					);
				}
				clearTimeout(handshakeTimer);
				connection.machineId = frame.machineId;
				connection.machineKey = key;
				connection.label = frame.label ?? connection.label;
				connection.connectedAt = now();
				liveHosts.set(key, connection);
				rememberMachine(account.accountId, frame.machineId, connection.label);
				send(socket, {
					t: "host.registered",
					protocolVersion: RELAY_PROTOCOL_VERSION,
					machineId: frame.machineId,
					accountId: account.accountId,
					label: connection.label,
					connectedAt: connection.connectedAt,
				});
				emit({
					type: "host.registered",
					machineId: frame.machineId,
					accountId: account.accountId,
					label: connection.label,
				});
				return;
			}

			switch (frame.t) {
				case "data": {
					const channel = channels.get(frame.channelId);
					if (!channel || channel.host !== connection) {
						fail(
							socket,
							"host",
							"unknown_channel",
							`no open channel ${frame.channelId} on this machine`,
							frame.channelId,
						);
						return;
					}
					const expectedSeq = channel.lastHostSeq + 1;
					if (frame.seq !== expectedSeq) {
						closeChannel(
							channel,
							"replayed_frame",
							`seq ${frame.seq} did not match expected ${expectedSeq}`,
							{ host: true, client: true },
						);
						return;
					}
					if (!channel.ready) {
						// The phone has not been told this channel exists yet, so it has
						// nowhere to put the frame.
						closeChannel(
							channel,
							"malformed_frame",
							"data arrived before channel.ready",
							{ host: true, client: false },
						);
						failPendingChannel(channel, "internal", "host framing error");
						return;
					}
					channel.lastHostSeq = frame.seq;
					pipeFrame(channel, "host->client", frame);
					return;
				}
				case "channel.ready": {
					const channel = channels.get(frame.channelId);
					if (!channel || channel.host !== connection || channel.ready) {
						return;
					}
					// Only NOW does an end-to-end path exist, so only now is the phone
					// told it is connected.
					channel.ready = true;
					if (channel.readyTimer) {
						clearTimeout(channel.readyTimer);
						channel.readyTimer = undefined;
					}
					send(channel.client.socket, {
						t: "client.connected",
						protocolVersion: RELAY_PROTOCOL_VERSION,
						channelId: channel.channelId,
						machineId: channel.machineId,
						label: connection.label,
					});
					emit({
						type: "channel.opened",
						channelId: channel.channelId,
						machineId: channel.machineId,
						accountId: account.accountId,
					});
					return;
				}
				case "channel.close": {
					const channel = channels.get(frame.channelId);
					if (!channel || channel.host !== connection) {
						return;
					}
					if (!channel.ready) {
						// Closed before it was ever usable: the phone is mid-`connect()`, so
						// this has to surface as a connect FAILURE, not a connect that
						// succeeds and immediately ends.
						failPendingChannel(
							channel,
							"hub_unreachable",
							frame.reason ?? "the machine could not reach its local hub",
						);
						return;
					}
					closeChannel(channel, frame.code, frame.reason ?? "host closed", {
						host: false,
						client: true,
					});
					return;
				}
				case "pong":
					return;
				case "ping":
					send(socket, { t: "pong", ts: frame.ts });
					return;
				case "host.register":
					fail(socket, "host", "malformed_frame", "already registered");
					return;
				default:
					fail(
						socket,
						"host",
						"malformed_frame",
						`unexpected frame ${frame.t} from a host`,
					);
					return;
			}
		});

		socket.on("close", () => {
			clearTimeout(handshakeTimer);
			untrackAccount(hostsByAccount, account.accountId, connection);
			const machineId = connection.machineId;
			const tornDown = connection.channels.size;
			for (const channel of [...connection.channels]) {
				closeChannel(channel, "machine_gone", "host disconnected", {
					host: false,
					client: true,
				});
			}
			const key = connection.machineKey;
			if (key && liveHosts.get(key) === connection) {
				liveHosts.delete(key);
				const known = knownMachines.get(key);
				if (known) {
					// Starts the TTL: an offline machine is remembered only long enough
					// for the phone to be told `machine_offline` rather than
					// `machine_not_found`.
					known.lastSeenAt = now();
				}
			}
			if (machineId) {
				emit({
					type: "host.disconnected",
					machineId,
					accountId: account.accountId,
					channelsTornDown: tornDown,
				});
			}
			if (
				!hostsByAccount.has(account.accountId) &&
				!clientsByAccount.has(account.accountId)
			) {
				accountBandwidth.delete(account.accountId);
			}
		});
	};

	const resolveMachine = (
		accountId: string,
		requested: string,
	):
		| { ok: true; host: HostConnection }
		| { ok: false; code: RelayErrorCode; message: string } => {
		// Expired records first, so an id whose record has aged out reads as unknown
		// rather than as offline.
		pruneKnownMachines(accountId);
		if (requested === RELAY_NEWEST_MACHINE) {
			let newest: HostConnection | undefined;
			for (const candidate of hostsByAccount.get(accountId) ?? []) {
				if (!candidate.machineId) {
					continue;
				}
				if (!newest || candidate.connectedAt >= newest.connectedAt) {
					newest = candidate;
				}
			}
			if (newest) {
				return { ok: true, host: newest };
			}
			return (knownByAccount.get(accountId)?.size ?? 0) > 0
				? {
						ok: false,
						code: "machine_offline",
						message: "no machine for this account is currently connected",
					}
				: {
						ok: false,
						code: "machine_not_found",
						message: "this account has never registered a machine",
					};
		}
		// Scoped to the caller's account, so an id registered by SOMEONE ELSE is
		// indistinguishable from an id that never existed: no existence oracle, and
		// no code path on which one account can name another's machine.
		const key = machineKey(accountId, requested);
		if (!knownMachines.has(key)) {
			return {
				ok: false,
				code: "machine_not_found",
				message: `unknown machine ${requested}`,
			};
		}
		const host = liveHosts.get(key);
		if (!host) {
			return {
				ok: false,
				code: "machine_offline",
				message: `machine ${requested} is not connected`,
			};
		}
		return { ok: true, host };
	};

	const handleClientSocket = (
		socket: WebSocket,
		account: RelayAccount,
	): void => {
		const connection: ClientConnection = {
			socket,
			accountId: account.accountId,
			lastSeenAt: now(),
		};
		trackAccount(clientsByAccount, account.accountId, connection);

		const handshakeTimer = setTimeout(() => {
			if (!connection.channel) {
				fail(
					socket,
					"client",
					"handshake_timeout",
					"client.connect never arrived",
				);
			}
		}, handshakeTimeoutMs);

		socket.on("pong", () => {
			connection.lastSeenAt = now();
		});

		socket.on("message", (raw: unknown) => {
			connection.lastSeenAt = now();
			const decoded = decodeRelayFrame(toText(raw), {
				maxPayloadBytes,
				maxFrameBytes,
			});
			if (!decoded.ok) {
				// A client socket carries exactly one channel, so failing the socket IS
				// scoped to the offending channel.
				fail(socket, "client", decoded.code, decoded.message);
				return;
			}
			const frame = decoded.frame;
			if (!connection.channel) {
				if (frame.t !== "client.connect") {
					fail(
						socket,
						"client",
						"malformed_frame",
						`expected client.connect, got ${frame.t}`,
					);
					return;
				}
				if (!isRelayProtocolCompatible(frame.protocolVersion)) {
					fail(
						socket,
						"client",
						"protocol_version_unsupported",
						`relay speaks ${RELAY_PROTOCOL_VERSION}, client offered ${frame.protocolVersion}`,
					);
					return;
				}
				if (account.machineId && frame.machineId !== account.machineId) {
					fail(
						socket,
						"client",
						"unauthorized",
						"relay ticket is not valid for this machine",
					);
					return;
				}
				const resolved = resolveMachine(account.accountId, frame.machineId);
				if (!resolved.ok) {
					fail(socket, "client", resolved.code, resolved.message);
					return;
				}
				const hostConnection = resolved.host;
				if (hostConnection.channels.size >= limits.maxChannelsPerMachine) {
					fail(
						socket,
						"client",
						"channel_limit",
						`machine already has ${hostConnection.channels.size} open channels`,
					);
					return;
				}
				clearTimeout(handshakeTimer);
				const channel: RelayChannel = {
					channelId: createChannelId(),
					host: hostConnection,
					client: connection,
					machineId: hostConnection.machineId as string,
					openedAt: now(),
					lastClientSeq: 0,
					lastHostSeq: 0,
					framesFromClient: 0,
					framesFromHost: 0,
					bytes: 0,
					bandwidth: createBucket(limits.channelBurstBytes),
					closed: false,
					ready: false,
					paused: false,
					pausedSince: 0,
				};
				connection.channel = channel;
				channels.set(channel.channelId, channel);
				hostConnection.channels.add(channel);
				// Ask the host to dial its LOCAL hub. The phone is told nothing until
				// the host answers `channel.ready`, so `connect()` cannot resolve
				// against a laptop whose hub is down: that is a connect error, never a
				// connect that succeeds and closes a moment later.
				send(hostConnection.socket, {
					t: "channel.open",
					channelId: channel.channelId,
					openedAt: channel.openedAt,
				});
				const readyTimer = setTimeout(() => {
					if (channel.ready || channel.closed) {
						return;
					}
					failPendingChannel(
						channel,
						"hub_unreachable",
						`machine ${channel.machineId} did not confirm its local hub within ${channelReadyTimeoutMs}ms`,
					);
				}, channelReadyTimeoutMs);
				readyTimer.unref?.();
				channel.readyTimer = readyTimer;
				return;
			}

			const channel = connection.channel;
			switch (frame.t) {
				case "data": {
					if (frame.channelId !== channel.channelId) {
						fail(
							socket,
							"client",
							"unknown_channel",
							`socket is bound to ${channel.channelId}`,
							frame.channelId,
						);
						return;
					}
					const expectedSeq = channel.lastClientSeq + 1;
					if (frame.seq !== expectedSeq) {
						closeChannel(
							channel,
							"replayed_frame",
							`seq ${frame.seq} did not match expected ${expectedSeq}`,
							{ host: true, client: true },
						);
						return;
					}
					channel.lastClientSeq = frame.seq;
					pipeFrame(channel, "client->host", frame);
					return;
				}
				case "channel.close": {
					closeChannel(channel, frame.code, frame.reason ?? "client closed", {
						host: true,
						client: false,
					});
					try {
						socket.close(1000, "client closed");
					} catch {
						// best-effort
					}
					return;
				}
				case "pong":
					return;
				case "ping":
					send(socket, { t: "pong", ts: frame.ts });
					return;
				default:
					fail(
						socket,
						"client",
						"malformed_frame",
						`unexpected frame ${frame.t} from a client`,
					);
					return;
			}
		});

		socket.on("close", () => {
			clearTimeout(handshakeTimer);
			untrackAccount(clientsByAccount, account.accountId, connection);
			const channel = connection.channel;
			if (channel) {
				closeChannel(channel, "client_gone", "client disconnected", {
					host: true,
					client: false,
				});
			}
			if (
				!hostsByAccount.has(account.accountId) &&
				!clientsByAccount.has(account.accountId)
			) {
				accountBandwidth.delete(account.accountId);
			}
		});
	};

	const wss = new WebSocketServer({
		noServer: true,
		// Tied to the payload cap, so a relay configured with a larger
		// `maxPayloadBytes` does not silently answer every frame in between with
		// `ws`'s untyped 1009 instead of the in-band `frame_too_large`.
		maxPayload: maxFrameBytes,
	});

	const httpServer: Server = createServer((_request, response) => {
		response.statusCode = 404;
		response.end("relay: websocket only");
	});

	httpServer.on("upgrade", (request, socket, head) => {
		const requestUrl = new URL(request.url ?? "/", `http://${host}`);
		const role: "host" | "client" | undefined =
			requestUrl.pathname === hostPath
				? "host"
				: requestUrl.pathname === clientPath
					? "client"
					: undefined;
		if (!role) {
			rejectUpgrade(socket, 404, "Not Found");
			return;
		}
		const headers = request.headers as Record<string, string | undefined>;
		const token = readAuthToken(headers);
		void (async () => {
			let account: RelayAccount | undefined;
			try {
				account = await options.verifyAccount({ role, token, headers });
			} catch (error) {
				// The verifier could not DECIDE — a JWKS outage, a timeout. Answering
				// 401 here makes an outage look exactly like an attack, which is how a
				// relay-wide auth failure gets triaged as "someone is probing us".
				emit({
					type: "auth.error",
					role,
					message: sanitizeRelayText(
						error instanceof Error ? error.message : String(error),
						RELAY_MAX_CLOSE_REASON_LENGTH,
					),
				});
				rejectUpgrade(socket, 503, "Service Unavailable");
				return;
			}
			if (!account) {
				emit({ type: "auth.rejected", role, reason: "verifyAccount rejected" });
				rejectUpgrade(socket, 401, "Unauthorized");
				return;
			}
			const openHosts = hostsByAccount.get(account.accountId)?.size ?? 0;
			const openClients = clientsByAccount.get(account.accountId)?.size ?? 0;
			if (role === "host" && openHosts >= limits.maxHostsPerAccount) {
				emit({
					type: "rejected",
					role,
					code: "connection_limit",
					message: `account already has ${openHosts} hosts`,
				});
				rejectUpgrade(socket, 429, "Too Many Requests");
				return;
			}
			if (role === "client" && openClients >= limits.maxClientsPerAccount) {
				emit({
					type: "rejected",
					role,
					code: "connection_limit",
					message: `account already has ${openClients} clients`,
				});
				rejectUpgrade(socket, 429, "Too Many Requests");
				return;
			}
			try {
				wss.handleUpgrade(request, socket, head, (websocket) => {
					if (role === "host") {
						handleHostSocket(websocket, account as RelayAccount);
					} else {
						handleClientSocket(websocket, account as RelayAccount);
					}
				});
			} catch {
				rejectUpgrade(socket, 400, "Bad Request");
			}
		})();
	});

	const heartbeat = setInterval(() => {
		const deadline = now() - heartbeatTimeoutMs;
		const sweep = (
			connection: HostConnection | ClientConnection,
			role: "host" | "client",
		): void => {
			if (connection.lastSeenAt < deadline) {
				emit({
					type: "rejected",
					role,
					code: "heartbeat_timeout",
					message: "no traffic within the heartbeat window",
				});
				// `close()` then `terminate()` in the same tick discards the close frame,
				// so the peer sees 1006 and never learns WHY. `closeSocket` gives the
				// frame a grace period first.
				closeSocket(
					connection.socket,
					"heartbeat_timeout",
					"heartbeat_timeout",
				);
				return;
			}
			// Both a websocket ping (Node/`ws` peers) and an in-band one (React
			// Native, which cannot send control frames) so either transport can prove
			// liveness.
			try {
				connection.socket.ping();
			} catch {
				// best-effort
			}
			send(connection.socket, { t: "ping", ts: now() });
		};
		for (const set of hostsByAccount.values()) {
			for (const connection of set) {
				sweep(connection, "host");
			}
		}
		for (const set of clientsByAccount.values()) {
			for (const connection of set) {
				sweep(connection, "client");
			}
		}
		// Offline machine records expire on the same timer, so a relay nobody is
		// talking to still lets go of what it remembers.
		pruneKnownMachines();
	}, heartbeatIntervalMs);
	heartbeat.unref?.();

	await new Promise<void>((resolve, reject) => {
		httpServer.once("error", reject);
		httpServer.listen(options.port ?? 0, host, () => {
			httpServer.removeListener("error", reject);
			resolve();
		});
	});

	const address = httpServer.address();
	const port =
		typeof address === "object" && address ? address.port : (options.port ?? 0);
	const url = `ws://${host}:${port}`;
	emit({ type: "listening", url, port });

	const machineRecord = (connection: HostConnection): RelayMachineRecord => ({
		machineId: connection.machineId as string,
		accountId: connection.accountId,
		label: connection.label,
		connectedAt: connection.connectedAt,
		channels: connection.channels.size,
	});

	return {
		url,
		port,
		machines: () => [...liveHosts.values()].map(machineRecord),
		machinesForAccount: (accountId) =>
			[...liveHosts.values()]
				.filter((connection) => connection.accountId === accountId)
				.map(machineRecord),
		stats: () => {
			let bytesBuffered = 0;
			for (const set of hostsByAccount.values()) {
				for (const connection of set) {
					bytesBuffered += connection.socket.bufferedAmount;
				}
			}
			for (const set of clientsByAccount.values()) {
				for (const connection of set) {
					bytesBuffered += connection.socket.bufferedAmount;
				}
			}
			return {
				hosts: liveHosts.size,
				clients: [...clientsByAccount.values()].reduce(
					(total, set) => total + set.size,
					0,
				),
				channels: channels.size,
				framesRelayed,
				bytesRelayed,
				bytesBuffered,
				knownMachines: knownMachines.size,
			};
		},
		close: async () => {
			clearInterval(heartbeat);
			for (const channel of [...channels.values()]) {
				closeChannel(channel, "internal", "relay shutting down", {
					host: true,
					client: true,
				});
			}
			for (const set of [...hostsByAccount.values()]) {
				for (const connection of set) {
					try {
						connection.socket.terminate();
					} catch {
						// best-effort
					}
				}
			}
			for (const set of [...clientsByAccount.values()]) {
				for (const connection of set) {
					try {
						connection.socket.terminate();
					} catch {
						// best-effort
					}
				}
			}
			await new Promise<void>((resolve) => {
				wss.close(() => resolve());
			});
			await new Promise<void>((resolve) => {
				httpServer.close(() => resolve());
			});
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
