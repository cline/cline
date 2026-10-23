import {
	CURRENT_HUB_PROTOCOL_VERSION,
	createSessionId,
	HUB_INCOMPATIBLE_PROTOCOL_ERROR_CODE,
	HUB_MAX_FRAME_BYTES,
	type HubApprovalListPendingResult,
	type HubClientRegisterResult,
	type HubClientRegistration,
	type HubCommandEnvelope,
	type HubEventEnvelope,
	type HubProtocolMetadata,
	type HubReplyEnvelope,
	type HubTransportFrame,
	type PendingApprovalInfo,
	resolveHubCommandTimeoutMs,
	SESSION_NOT_FOUND_ERROR_CODE,
	SessionNotFoundError,
} from "@cline/shared";
import { decodeSocketText } from "./decode";
import {
	createHubCloseError,
	DEFAULT_HUB_CLOSED_MESSAGE,
	HubCommandError,
	HubMalformedReplyError,
	HubTransportError,
	IncompatibleProtocolError,
	isHubReconnectableTransportError,
	normalizeWebSocketConnectError,
} from "./errors";
import {
	createHubSocket,
	type HubAuthMode,
	type WebSocketCtor,
	type WebSocketLike,
} from "./socket";

export const HUB_CONNECT_TIMEOUT_MS = 8_000;
export const HUB_RECONNECT_INITIAL_DELAY_MS = 250;
export const HUB_RECONNECT_MAX_DELAY_MS = 5_000;
export const HUB_RECONNECT_JITTER_RATIO = 0.5;

/**
 * Default ceiling for a single inbound frame. Hub frames carry transcripts and
 * tool output, so the limit is generous; it exists so a hostile or wedged peer
 * cannot make a mobile client parse an unbounded string.
 *
 * Re-exported from `@cline/shared` so the client cap and the hub server's `ws`
 * `maxPayload` cannot drift apart.
 */
export { HUB_MAX_FRAME_BYTES };

const GLOBAL_SUBSCRIPTION_KEY = "*";

/**
 * UTF-8 byte length of `text`, without allocating a copy of it.
 *
 * `maxFrameBytes` is a byte budget, so comparing it against `text.length`
 * (UTF-16 code units) under-counts every non-ASCII frame — a 391-byte frame
 * slips past a 200-byte cap when its content is CJK or emoji. UTF-8 never
 * encodes a UTF-16 unit in fewer than one byte, so a string longer than the
 * limit is already over budget and the scan is skipped: the walk below only ever
 * runs on input the cap already bounds.
 */
function utf8ByteLength(text: string, limit: number): number {
	if (text.length > limit) {
		return text.length;
	}
	let bytes = 0;
	for (let index = 0; index < text.length; index += 1) {
		const code = text.charCodeAt(index);
		if (code < 0x80) {
			bytes += 1;
			continue;
		}
		if (code < 0x800) {
			bytes += 2;
			continue;
		}
		if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
			const low = text.charCodeAt(index + 1);
			if (low >= 0xdc00 && low <= 0xdfff) {
				// Surrogate pair: one 4-byte code point across two UTF-16 units.
				bytes += 4;
				index += 1;
				continue;
			}
		}
		bytes += 3;
	}
	return bytes;
}

type PendingReply = {
	resolve: (reply: HubReplyEnvelope) => void;
	reject: (error: unknown) => void;
};

type SubscriptionEntry = {
	listener: (event: HubEventEnvelope) => void;
	sessionId?: string;
};

export type HubClientDiagnostic =
	| {
			type: "malformed_frame";
			reason: "invalid_json" | "invalid_shape" | "undecodable_data";
			detail?: string;
	  }
	| {
			type: "oversized_frame";
			reason: "oversized_frame";
			detail?: string;
			/** Length of the decoded frame text that tripped the guard. */
			size: number;
			/** Effective `maxFrameBytes` limit. */
			limit: number;
	  }
	| {
			type: "listener_error";
			reason: "listener_threw";
			detail?: string;
	  };

export type HubClientDiagnosticListener = (
	diagnostic: HubClientDiagnostic,
) => void;

/**
 * Transport lifecycle states reported through {@link HubClientOptions.onConnectionState}.
 *
 * - `connecting`: a socket attempt started (first connect or a reconnect).
 * - `connected`: the socket opened, `client.register` succeeded and
 *   subscriptions were replayed. Carries a fresh `connectionEpoch`.
 * - `reconnecting`: the transport dropped and an automatic retry is scheduled.
 * - `closed`: the transport is down with no retry pending (client `close()`,
 *   `dispose()`, or a drop with no active subscriptions to keep alive).
 */
export type HubConnectionState =
	| "connecting"
	| "connected"
	| "reconnecting"
	| "closed";

export interface HubConnectionStateChange {
	state: HubConnectionState;
	/**
	 * Monotonically increasing counter, bumped once per successful (re)connect
	 * and stable otherwise. `0` before the first successful connect.
	 *
	 * Consumers only ever need to compare this value against the last one they
	 * acted on: every reconnect increments it, so a rehydrate-on-change check is
	 * correct even if intermediate states were coalesced or missed.
	 */
	connectionEpoch: number;
	/** Transport error that caused a `reconnecting`/`closed` transition. */
	error?: HubTransportError;
	/** Human-readable context for the transition. */
	detail?: string;
}

export type HubConnectionStateListener = (
	change: HubConnectionStateChange,
) => void;

export interface HubClientOptions {
	/** ws:// or wss:// hub endpoint. */
	url: string;
	clientId?: string;
	clientType?: string;
	displayName?: string;
	workspaceRoot?: string;
	cwd?: string;
	/** Defaults to `hub-subprotocol` so local hubs keep working unchanged. */
	authMode?: HubAuthMode;
	/** Token/JWT to present using `authMode`. */
	credential?: string;
	/** Extra request headers (Node/React Native only; browsers ignore them). */
	headers?: Record<string, string>;
	/** Defaults to `globalThis.WebSocket`. */
	WebSocketImpl?: WebSocketCtor;
	connectTimeoutMs?: number;
	/**
	 * Largest inbound frame this client will parse, compared against the decoded
	 * frame text length before `JSON.parse`. Defaults to
	 * {@link HUB_MAX_FRAME_BYTES}. Oversized frames are dropped with an
	 * `oversized_frame` diagnostic.
	 */
	maxFrameBytes?: number;
	/** Called for dropped frames and listener faults. Never throws into the socket. */
	onDiagnostic?: HubClientDiagnosticListener;
	/**
	 * Called on every transport lifecycle transition. Never throws into the
	 * socket. Stops firing after {@link HubClient.dispose}.
	 */
	onConnectionState?: HubConnectionStateListener;
}

/**
 * Platform-agnostic Cline hub websocket client.
 *
 * Depends only on `WebSocket`, `TextDecoder` and timers, so it runs unchanged on
 * Node, browsers and React Native. Node-specific concerns (daemon spawning,
 * on-disk discovery) live in subclasses via the protected recovery hooks.
 */
export class HubClient {
	private socket: WebSocketLike | undefined;
	private connectPromise: Promise<void> | undefined;
	private readonly clientId: string;
	protected currentUrl: string;
	private recoveryPromise: Promise<boolean> | undefined;
	private readonly pendingReplies = new Map<string, PendingReply>();
	private readonly listeners = new Set<SubscriptionEntry>();
	private readonly subscriptionCounts = new Map<string, number>();
	/** Highest durable event sequence observed for each active subscription. */
	private readonly lastEventSequenceByKey = new Map<string, number>();
	private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	private reconnectAttempt = 0;
	private closedByClient = false;
	private lastCloseError = new HubTransportError(
		"hub_connection_closed",
		DEFAULT_HUB_CLOSED_MESSAGE,
	);
	private sawSocketClose = false;
	private registered = false;
	private droppedFrames = 0;
	private connectionEpoch = 0;
	private lastConnectionState: HubConnectionState | undefined;
	/** True while the reconnect loop owns the attempt, so a failure is not terminal. */
	private inReconnectLoop = false;
	/** Latched by `dispose()`: the observer never fires again afterwards. */
	private connectionObserverDetached = false;
	private serverProtocol: HubProtocolMetadata | undefined;
	private serverCapabilities = new Set<string>();
	/** Set once the hub rejected our protocol version; every retry stops here. */
	private incompatibleProtocolError: IncompatibleProtocolError | undefined;
	/**
	 * In-flight open+register handshake, shared by concurrent `connect()` callers
	 * (and therefore by every command that waits on one).
	 */
	private handshakePromise: Promise<void> | undefined;

	constructor(protected readonly options: HubClientOptions) {
		this.clientId =
			options.clientId ??
			`hub-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
		this.currentUrl = options.url;
	}

	getClientId(): string {
		return this.clientId;
	}

	getUrl(): string {
		return this.currentUrl;
	}

	isConnected(): boolean {
		return this.socket?.readyState === 1 && this.registered;
	}

	getConnectionError(): HubTransportError | null {
		return this.isConnected() ? null : this.lastCloseError;
	}

	/** Frames dropped because they could not be decoded, parsed or dispatched. */
	getDroppedFrameCount(): number {
		return this.droppedFrames;
	}

	/**
	 * Counter bumped once per successful (re)connect. Compare it against a stored
	 * value to detect a reconnect without observing every intermediate state.
	 */
	getConnectionEpoch(): number {
		return this.connectionEpoch;
	}

	/**
	 * Protocol metadata the hub returned from `client.register`, or undefined
	 * against a hub that predates the handshake (or before connecting).
	 */
	getServerProtocol(): HubProtocolMetadata | undefined {
		return this.serverProtocol;
	}

	/** Whether the connected hub advertised support for `name`. */
	hasCapability(name: string): boolean {
		return this.serverCapabilities.has(name);
	}

	/**
	 * Open a connection and complete the handshake.
	 *
	 * A connection only counts as usable once `client.register` succeeded: the hub
	 * refuses every identity-bound command on an unregistered socket, so riding an
	 * open-but-unregistered socket turns every later command into a `not_registered`
	 * failure with no way out. An open socket is therefore *not* enough to
	 * short-circuit — a previous attempt whose register failed (error reply or
	 * timeout) is discarded and retried instead of reused.
	 *
	 * Concurrent callers share one handshake, which is also what keeps command
	 * ordering right: `command()` awaits this, so a command issued while the first
	 * connect is still in flight is transmitted after `client.register` rather than
	 * ahead of it.
	 */
	async connect(): Promise<void> {
		if (this.incompatibleProtocolError) {
			throw this.incompatibleProtocolError;
		}
		if (this.socket?.readyState === 1 && this.registered) {
			return;
		}
		if (this.handshakePromise) {
			return await this.handshakePromise;
		}
		this.handshakePromise = this.performHandshake().finally(() => {
			this.handshakePromise = undefined;
		});
		return await this.handshakePromise;
	}

	private async performHandshake(): Promise<void> {
		// Anything left over from a failed attempt is unusable; drop it rather than
		// letting a second socket race it.
		this.discardUnregisteredSocket();
		this.closedByClient = false;
		this.clearReconnectTimer();
		this.emitConnectionState("connecting");

		const url = new URL(this.currentUrl);
		const auth = this.resolveAuth(url);
		url.hash = "";

		const connectTimeoutMs =
			this.options.connectTimeoutMs ?? HUB_CONNECT_TIMEOUT_MS;
		const socket = createHubSocket({
			url: url.toString(),
			authMode: auth.authMode,
			credential: auth.credential,
			headers: this.options.headers,
			WebSocketImpl: this.options.WebSocketImpl,
		});
		this.socket = socket;
		let suppressCloseMessage = false;
		this.connectPromise = new Promise<void>((resolve, reject) => {
			let settled = false;
			const timeout = setTimeout(() => {
				if (settled) {
					return;
				}
				settled = true;
				suppressCloseMessage = true;
				this.lastCloseError = new HubTransportError(
					"hub_connect_timeout",
					`Timed out connecting to hub after ${connectTimeoutMs}ms`,
				);
				this.sawSocketClose = false;
				this.connectPromise = undefined;
				this.socket = undefined;
				try {
					socket.close();
				} catch {
					// best-effort close
				}
				reject(this.lastCloseError);
			}, connectTimeoutMs);
			socket.addEventListener("open", () => {
				if (settled) {
					return;
				}
				settled = true;
				clearTimeout(timeout);
				resolve();
			});
			socket.addEventListener("error", (error) => {
				if (settled) {
					return;
				}
				settled = true;
				clearTimeout(timeout);
				this.lastCloseError = normalizeWebSocketConnectError(error, url);
				this.sawSocketClose = false;
				this.connectPromise = undefined;
				this.socket = undefined;
				reject(this.lastCloseError);
			});
			socket.addEventListener("close", (event: unknown) => {
				if (settled) {
					return;
				}
				settled = true;
				clearTimeout(timeout);
				if (!suppressCloseMessage) {
					this.lastCloseError = createHubCloseError(event);
					this.sawSocketClose = true;
				}
				this.connectPromise = undefined;
				this.socket = undefined;
				reject(this.lastCloseError);
			});
		});

		socket.addEventListener("message", (data: unknown) => {
			this.handleSocketMessage(data);
		});
		socket.addEventListener("close", (event: unknown) => {
			if (this.socket !== socket) {
				return;
			}
			if (!suppressCloseMessage) {
				this.lastCloseError = createHubCloseError(event);
				this.sawSocketClose = true;
			}
			this.registered = false;
			for (const pending of this.pendingReplies.values()) {
				pending.reject(this.lastCloseError);
			}
			this.pendingReplies.clear();
			this.connectPromise = undefined;
			this.socket = undefined;
			if (!this.closedByClient && this.hasActiveSubscriptions()) {
				// scheduleReconnect() reports the `reconnecting` transition.
				this.scheduleReconnect();
				return;
			}
			this.emitConnectionState("closed", {
				error: this.lastCloseError,
				detail: this.lastCloseError.message,
			});
		});

		try {
			await this.connectPromise;
			await this.register();
		} catch (error) {
			// The socket close listener only reports drops on a live socket, so a
			// failed attempt (timeout, refused, protocol refusal) reports here —
			// unless a retry is already pending or the reconnect loop owns the
			// attempt, in which case the transition stays `reconnecting`.
			if (!this.reconnectTimer && !this.inReconnectLoop) {
				this.emitConnectionState("closed", {
					error: error instanceof HubTransportError ? error : undefined,
					detail: error instanceof Error ? error.message : String(error),
				});
			}
			throw error;
		}
		this.registered = true;
		for (const key of this.subscriptionCounts.keys()) {
			this.sendSubscriptionFrame(
				"stream.subscribe",
				this.subscriptionSessionIdFromKey(key),
			);
		}
		this.reconnectAttempt = 0;
		this.connectionEpoch += 1;
		this.emitConnectionState("connected");
	}

	/**
	 * Drop a socket left behind by an attempt that never finished registering.
	 * Deliberately not `close()`: that latches `closedByClient` and would stop the
	 * reconnect loop, while this is the start of a fresh attempt.
	 */
	private discardUnregisteredSocket(): void {
		const socket = this.socket;
		if (!socket) {
			return;
		}
		this.socket = undefined;
		this.connectPromise = undefined;
		this.registered = false;
		for (const pending of this.pendingReplies.values()) {
			pending.reject(this.lastCloseError);
		}
		this.pendingReplies.clear();
		try {
			socket.close();
		} catch {
			// best-effort close
		}
	}

	subscribe(
		listener: (event: HubEventEnvelope) => void,
		options?: { sessionId?: string },
	): () => void {
		const sessionId = options?.sessionId?.trim() || undefined;
		const entry = { listener, sessionId };
		this.listeners.add(entry);
		this.adjustSubscriptionCount(sessionId, 1);
		return () => {
			if (!this.listeners.delete(entry)) {
				return;
			}
			this.adjustSubscriptionCount(sessionId, -1);
		};
	}

	async command(
		command: HubCommandEnvelope["command"],
		payload?: Record<string, unknown>,
		sessionId?: string,
		options?: { timeoutMs?: number | null },
	): Promise<HubReplyEnvelope> {
		let attempt = 0;
		const canRecoverTransport =
			command !== "client.register" && command !== "client.unregister";
		while (true) {
			try {
				return await this.commandOnce(command, payload, sessionId, options);
			} catch (error) {
				if (
					!canRecoverTransport ||
					attempt >= 1 ||
					!(await this.recoverTransport(error))
				) {
					throw error;
				}
				attempt += 1;
			}
		}
	}

	/**
	 * Typed wrapper over `approval.list_pending`. Omit `sessionId` to list every
	 * pending approval. Returns an empty array after a hub restart, since pending
	 * approvals are in-memory only.
	 */
	async listPendingApprovals(
		sessionId?: string,
		options?: { timeoutMs?: number | null },
	): Promise<PendingApprovalInfo[]> {
		const reply = await this.command(
			"approval.list_pending",
			sessionId ? { sessionId } : {},
			sessionId,
			options,
		);
		const payload = reply.payload as
			| Partial<HubApprovalListPendingResult>
			| undefined;
		// A well-formed hub always sends `approvals` as an array (empty when
		// nothing is pending). A missing key or wrong type is protocol
		// corruption, not "nothing here" — surface it so callers that treat
		// the result as an authoritative snapshot can't silently drop live
		// approvals against a bogus empty answer.
		if (payload === null || typeof payload !== "object") {
			throw new HubMalformedReplyError(
				"approval.list_pending",
				"approval.list_pending reply had no payload object",
			);
		}
		const approvals = (payload as { approvals?: unknown }).approvals;
		if (!Array.isArray(approvals)) {
			throw new HubMalformedReplyError(
				"approval.list_pending",
				"approval.list_pending reply is missing an approvals array",
			);
		}
		for (const entry of approvals) {
			if (
				entry === null ||
				typeof entry !== "object" ||
				typeof (entry as { approvalId?: unknown }).approvalId !== "string"
			) {
				throw new HubMalformedReplyError(
					"approval.list_pending",
					"approval.list_pending reply contained a malformed approval entry",
				);
			}
		}
		return approvals as PendingApprovalInfo[];
	}

	close(): void {
		const socket = this.socket;
		this.closedByClient = true;
		this.clearReconnectTimer();
		this.registered = false;
		if (!socket) {
			return;
		}
		this.lastCloseError = new HubTransportError(
			"hub_connection_closed",
			DEFAULT_HUB_CLOSED_MESSAGE,
		);
		this.sawSocketClose = false;
		for (const pending of this.pendingReplies.values()) {
			pending.reject(this.lastCloseError);
		}
		this.pendingReplies.clear();
		this.connectPromise = undefined;
		this.socket = undefined;
		this.emitConnectionState("closed", { detail: DEFAULT_HUB_CLOSED_MESSAGE });
		try {
			socket.close();
		} catch {
			// best-effort close
		}
	}

	async dispose(): Promise<void> {
		const socket = this.socket;
		if (socket?.readyState === 1 && this.registered) {
			try {
				await this.command("client.unregister", undefined, undefined, {
					timeoutMs: 2_000,
				});
			} catch {
				// Best-effort unregister during shutdown. The websocket adapter also
				// unregisters clients on close, so failure here should not block teardown.
			}
		}
		this.close();
		// Terminal for the observer: a disposed client never reports state again.
		this.connectionObserverDetached = true;
	}

	/**
	 * Auth material for the next connection attempt. Subclasses can override to
	 * pull credentials from platform-specific storage.
	 */
	protected resolveAuth(_url: URL): {
		authMode: HubAuthMode;
		credential?: string;
	} {
		return {
			authMode: this.options.authMode ?? "hub-subprotocol",
			credential: this.options.credential?.trim() || undefined,
		};
	}

	/** Whether the current endpoint can be re-resolved after a transport fault. */
	protected isTransportRecoverable(): boolean {
		return false;
	}

	/** Resolve a replacement hub URL. Only called when recovery is possible. */
	protected async resolveRecoveredUrl(): Promise<string | undefined> {
		return undefined;
	}

	protected emitDiagnostic(diagnostic: HubClientDiagnostic): void {
		try {
			this.options.onDiagnostic?.(diagnostic);
		} catch {
			// Diagnostics must never destabilise the socket handler.
		}
	}

	/**
	 * Report a lifecycle transition. Repeats of the same non-`connected` state are
	 * coalesced (a double `close()` is one `closed`), while `connected` always
	 * fires because it carries a new epoch.
	 */
	private emitConnectionState(
		state: HubConnectionState,
		extra?: { error?: HubTransportError; detail?: string },
	): void {
		if (this.connectionObserverDetached) {
			return;
		}
		if (state !== "connected" && state === this.lastConnectionState) {
			return;
		}
		this.lastConnectionState = state;
		const listener = this.options.onConnectionState;
		if (!listener) {
			return;
		}
		try {
			listener({
				state,
				connectionEpoch: this.connectionEpoch,
				...(extra?.error ? { error: extra.error } : {}),
				...(extra?.detail ? { detail: extra.detail } : {}),
			});
		} catch {
			// Observers must never destabilise the socket handler.
		}
	}

	/**
	 * Announce ourselves and complete the protocol handshake. A protocol refusal
	 * is terminal: we close the socket and latch the error so neither `connect()`
	 * nor the reconnect loop keeps hammering a hub that will never accept us.
	 */
	private async register(): Promise<void> {
		try {
			// `commandOnce` directly, not `command`: the public path waits for the
			// handshake, and this *is* the handshake. `client.register` is never
			// transport-retried anyway.
			const reply = await this.commandOnce(
				"client.register",
				{
					clientId: this.clientId,
					clientType: this.options.clientType ?? "hub-client",
					displayName: this.options.displayName ?? "hub-client",
					transport: "native",
					actorKind: "client",
					workspaceContext: {
						workspaceRoot: this.options.workspaceRoot,
						cwd: this.options.cwd,
					},
					protocolVersion: CURRENT_HUB_PROTOCOL_VERSION,
				} satisfies HubClientRegistration,
				undefined,
				{ skipHandshake: true },
			);
			this.applyRegisterReply(reply.payload);
		} catch (error) {
			if (error instanceof IncompatibleProtocolError) {
				this.incompatibleProtocolError = error;
				this.close();
			}
			throw error;
		}
	}

	/** Absent `protocol`/`capabilities` means a hub older than the handshake. */
	private applyRegisterReply(payload: HubReplyEnvelope["payload"]): void {
		const result = payload as Partial<HubClientRegisterResult> | undefined;
		const protocol = result?.protocol;
		this.serverProtocol =
			typeof protocol?.protocolVersion === "string" ? protocol : undefined;
		const capabilities =
			result?.capabilities ?? this.serverProtocol?.capabilities;
		this.serverCapabilities = new Set(
			(Array.isArray(capabilities) ? capabilities : []).filter(
				(name): name is string => typeof name === "string",
			),
		);
	}

	private async commandOnce(
		command: HubCommandEnvelope["command"],
		payload?: Record<string, unknown>,
		sessionId?: string,
		options?: { timeoutMs?: number | null; skipHandshake?: boolean },
	): Promise<HubReplyEnvelope> {
		// The handshake itself must not wait for the handshake.
		if (!options?.skipHandshake) {
			await this.connect();
		}
		const requestId = createSessionId("hubreq_");
		const effectiveTimeoutMs = resolveHubCommandTimeoutMs(
			command,
			options?.timeoutMs,
		);
		const reply = new Promise<HubReplyEnvelope>((resolve, reject) => {
			const timeout =
				effectiveTimeoutMs === null
					? undefined
					: setTimeout(() => {
							if (!this.pendingReplies.delete(requestId)) {
								return;
							}
							reject(
								new HubCommandError(
									command,
									"hub_command_timeout",
									this.formatCommandTimeoutMessage(
										command,
										effectiveTimeoutMs,
										requestId,
									),
								),
							);
						}, effectiveTimeoutMs);
			this.pendingReplies.set(requestId, {
				resolve: (value) => {
					if (timeout) {
						clearTimeout(timeout);
					}
					resolve(value);
				},
				reject: (error) => {
					if (timeout) {
						clearTimeout(timeout);
					}
					reject(error);
				},
			});
		});
		try {
			this.sendFrame({
				kind: "command",
				envelope: {
					version: "v1",
					command,
					requestId,
					clientId: this.clientId,
					sessionId,
					timeoutMs: effectiveTimeoutMs,
					payload,
				},
			});
		} catch (error) {
			this.pendingReplies.delete(requestId);
			throw error;
		}
		const resolved = await reply;
		if (!resolved.ok) {
			if (resolved.error?.code === HUB_INCOMPATIBLE_PROTOCOL_ERROR_CODE) {
				throw new IncompatibleProtocolError(
					command,
					resolved.error.message,
					resolved.error.details,
				);
			}
			if (resolved.error?.code === SESSION_NOT_FOUND_ERROR_CODE) {
				const targetSessionId =
					sessionId ??
					(typeof payload?.sessionId === "string"
						? payload.sessionId
						: undefined);
				throw new SessionNotFoundError(targetSessionId, resolved.error.message);
			}
			throw new HubCommandError(
				command,
				resolved.error?.code,
				resolved.error?.message ?? `Hub command ${command} failed`,
			);
		}
		return resolved;
	}

	/** Overridable so Node builds can append daemon-log troubleshooting hints. */
	protected formatCommandTimeoutMessage(
		command: HubCommandEnvelope["command"],
		timeoutMs: number,
		requestId: string,
	): string {
		return `Hub command ${command} timed out after ${timeoutMs}ms (hub=${this.currentUrl}, requestId=${requestId}, clientId=${this.clientId}).`;
	}

	private async recoverTransport(error: unknown): Promise<boolean> {
		if (
			!this.isTransportRecoverable() ||
			!isHubReconnectableTransportError(error)
		) {
			return false;
		}
		if (this.recoveryPromise) {
			return await this.recoveryPromise;
		}
		this.recoveryPromise = (async () => {
			const recoveredUrl = await this.resolveRecoveredUrl().catch(
				() => undefined,
			);
			if (!recoveredUrl) {
				return false;
			}
			this.currentUrl = recoveredUrl;
			this.close();
			return true;
		})().finally(() => {
			this.recoveryPromise = undefined;
		});
		return await this.recoveryPromise;
	}

	private hasActiveSubscriptions(): boolean {
		return this.subscriptionCounts.size > 0;
	}

	private clearReconnectTimer(): void {
		if (!this.reconnectTimer) {
			return;
		}
		clearTimeout(this.reconnectTimer);
		this.reconnectTimer = undefined;
	}

	private scheduleReconnect(): void {
		if (
			this.reconnectTimer ||
			this.closedByClient ||
			this.incompatibleProtocolError ||
			!this.hasActiveSubscriptions()
		) {
			return;
		}
		const delayMs = Math.min(
			HUB_RECONNECT_INITIAL_DELAY_MS * 2 ** this.reconnectAttempt,
			HUB_RECONNECT_MAX_DELAY_MS,
		);
		const jitteredDelayMs = Math.round(
			delayMs * (1 - HUB_RECONNECT_JITTER_RATIO) +
				Math.random() * delayMs * HUB_RECONNECT_JITTER_RATIO,
		);
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = undefined;
			void this.reconnectSubscribedTransport();
		}, jitteredDelayMs);
		this.emitConnectionState("reconnecting", {
			error: this.lastCloseError,
			detail: this.lastCloseError.message,
		});
	}

	private async reconnectSubscribedTransport(): Promise<void> {
		if (this.closedByClient || !this.hasActiveSubscriptions()) {
			return;
		}
		this.inReconnectLoop = true;
		try {
			await this.attemptSubscribedReconnect();
		} finally {
			this.inReconnectLoop = false;
		}
	}

	private async attemptSubscribedReconnect(): Promise<void> {
		try {
			await this.connect();
			this.reconnectAttempt = 0;
		} catch {
			if (!this.isTransportRecoverable()) {
				this.reconnectAttempt += 1;
				this.scheduleReconnect();
				return;
			}
			try {
				const recoveredUrl = await this.resolveRecoveredUrl();
				if (recoveredUrl) {
					this.currentUrl = recoveredUrl;
					await this.connect();
					this.reconnectAttempt = 0;
					return;
				}
			} catch {
				// fall through to retry below
			}
			this.reconnectAttempt += 1;
			this.scheduleReconnect();
		}
	}

	private sendFrame(frame: HubTransportFrame): void {
		if (!this.socket || this.socket.readyState !== 1) {
			if (
				this.lastCloseError.code === "hub_connection_closed" &&
				!this.sawSocketClose
			) {
				throw new HubTransportError(
					"hub_connection_not_open",
					"Hub connection is not open.",
				);
			}
			throw this.lastCloseError;
		}
		this.socket.send(JSON.stringify(frame));
	}

	private sendSubscriptionFrame(
		kind: "stream.subscribe" | "stream.unsubscribe",
		sessionId?: string,
	): void {
		const sinceSequence =
			kind === "stream.subscribe"
				? this.lastEventSequenceByKey.get(
						this.subscriptionKeyForSessionId(sessionId),
					)
				: undefined;
		this.sendFrame({
			kind,
			clientId: this.clientId,
			...(sessionId ? { sessionId } : {}),
			...(sinceSequence !== undefined ? { sinceSequence } : {}),
		});
	}

	private adjustSubscriptionCount(
		sessionId: string | undefined,
		delta: 1 | -1,
	): void {
		const key = this.subscriptionKeyForSessionId(sessionId);
		const next = (this.subscriptionCounts.get(key) ?? 0) + delta;
		if (next <= 0) {
			this.subscriptionCounts.delete(key);
			if (!this.hasActiveSubscriptions()) {
				this.clearReconnectTimer();
			}
			if (delta < 0 && this.socket?.readyState === 1) {
				this.sendSubscriptionFrame("stream.unsubscribe", sessionId);
			}
			return;
		}
		this.subscriptionCounts.set(key, next);
		if (delta > 0 && next === 1 && this.socket?.readyState === 1) {
			this.sendSubscriptionFrame("stream.subscribe", sessionId);
		}
	}

	private subscriptionKeyForSessionId(sessionId: string | undefined): string {
		return sessionId ?? GLOBAL_SUBSCRIPTION_KEY;
	}

	private subscriptionSessionIdFromKey(key: string): string | undefined {
		return key === GLOBAL_SUBSCRIPTION_KEY ? undefined : key;
	}

	/**
	 * Decode + parse a socket payload. Malformed frames are dropped with a
	 * diagnostic; nothing is ever thrown back into the socket event handler.
	 */
	private handleSocketMessage(data: unknown): void {
		const text = decodeSocketText(data);
		if (text === undefined) {
			this.dropFrame("undecodable_data", "socket payload was not decodable");
			return;
		}
		const limit = this.resolveMaxFrameBytes();
		const size = utf8ByteLength(text, limit);
		if (size > limit) {
			this.dropOversizedFrame(size, limit);
			return;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch (error) {
			this.dropFrame(
				"invalid_json",
				error instanceof Error ? error.message : String(error),
			);
			return;
		}
		const invalidShape = this.frameShapeError(parsed);
		if (invalidShape) {
			this.dropFrame("invalid_shape", invalidShape);
			return;
		}
		this.handleFrame(parsed as HubTransportFrame);
	}

	private resolveMaxFrameBytes(): number {
		const configured = this.options.maxFrameBytes;
		return typeof configured === "number" &&
			Number.isFinite(configured) &&
			configured > 0
			? configured
			: HUB_MAX_FRAME_BYTES;
	}

	/**
	 * Validate a decoded frame against what {@link handleFrame} dereferences.
	 * Returns a reason string when the frame must be dropped, `undefined` when it
	 * is safe to dispatch — a recognized `kind` alone is not enough, because the
	 * dispatcher reads `envelope.requestId`/`envelope.sessionId` unguarded.
	 */
	private frameShapeError(value: unknown): string | undefined {
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			return "frame is not an object";
		}
		const frame = value as { kind?: unknown; envelope?: unknown };
		switch (frame.kind) {
			case "stream.subscribe":
			case "stream.unsubscribe":
				return undefined;
			case "command":
			case "reply":
			case "event":
				break;
			default:
				return "frame is missing a known `kind`";
		}
		const envelope = frame.envelope;
		if (
			typeof envelope !== "object" ||
			envelope === null ||
			Array.isArray(envelope)
		) {
			return `${frame.kind} frame has no object \`envelope\``;
		}
		const fields = envelope as { requestId?: unknown; sessionId?: unknown };
		if (frame.kind === "reply" && typeof fields.requestId !== "string") {
			return "reply envelope has no string `requestId`";
		}
		if (
			fields.sessionId !== undefined &&
			fields.sessionId !== null &&
			typeof fields.sessionId !== "string"
		) {
			return `${frame.kind} envelope has a non-string \`sessionId\``;
		}
		return undefined;
	}

	private dropFrame(
		reason: "invalid_json" | "invalid_shape" | "undecodable_data",
		detail?: string,
	): void {
		this.droppedFrames += 1;
		this.emitDiagnostic({ type: "malformed_frame", reason, detail });
	}

	private dropOversizedFrame(size: number, limit: number): void {
		this.droppedFrames += 1;
		this.emitDiagnostic({
			type: "oversized_frame",
			reason: "oversized_frame",
			size,
			limit,
			detail: `frame of ${size} bytes exceeds maxFrameBytes=${limit}`,
		});
	}

	private handleFrame(frame: HubTransportFrame): void {
		switch (frame.kind) {
			case "reply": {
				const requestId = frame.envelope.requestId;
				if (!requestId) {
					return;
				}
				const pending = this.pendingReplies.get(requestId);
				if (!pending) {
					return;
				}
				this.pendingReplies.delete(requestId);
				pending.resolve(frame.envelope);
				return;
			}
			case "event": {
				const sequence = frame.envelope.sequence;
				if (typeof sequence === "number") {
					const eventSessionKey = frame.envelope.sessionId?.trim();
					for (const key of [GLOBAL_SUBSCRIPTION_KEY, eventSessionKey]) {
						if (!key || !this.subscriptionCounts.has(key)) continue;
						const previous = this.lastEventSequenceByKey.get(key) ?? 0;
						if (sequence > previous) {
							this.lastEventSequenceByKey.set(key, sequence);
						}
					}
				}
				for (const entry of this.listeners) {
					if (
						entry.sessionId &&
						entry.sessionId !== frame.envelope.sessionId?.trim()
					) {
						continue;
					}
					try {
						entry.listener(frame.envelope);
					} catch (error) {
						this.emitDiagnostic({
							type: "listener_error",
							reason: "listener_threw",
							detail: error instanceof Error ? error.message : String(error),
						});
					}
				}
				return;
			}
			case "command":
			case "stream.subscribe":
			case "stream.unsubscribe":
				return;
		}
	}
}
