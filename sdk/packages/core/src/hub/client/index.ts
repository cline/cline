import {
	createSessionId,
	type HubClientRegistration,
	type HubCommandEnvelope,
	type HubEventEnvelope,
	type HubReplyEnvelope,
	type HubTransportFrame,
	resolveHubCommandTimeoutMs,
} from "@clinebot/shared";
import { spawnDetachedHubServer } from "../daemon";
import {
	clearHubDiscovery,
	type HubOwnerContext,
	probeHubServer,
	readHubDiscovery,
	resolveHubBuildId,
} from "../discovery";
import { resolveSharedHubOwnerContext } from "../discovery/workspace";

type PendingReply = {
	resolve: (reply: HubReplyEnvelope) => void;
	reject: (error: unknown) => void;
};

type SubscriptionEntry = {
	listener: (event: HubEventEnvelope) => void;
	sessionId?: string;
};

type WebSocketLike = {
	readyState: number;
	send(data: string): void;
	close(): void;
	addEventListener(type: string, listener: (...args: unknown[]) => void): void;
};

type WebSocketCtor = new (
	url: string,
	protocols?: string | string[],
) => WebSocketLike;

function getWebSocketCtor(): WebSocketCtor {
	const ctor = (globalThis as { WebSocket?: WebSocketCtor }).WebSocket;
	if (!ctor) {
		throw new Error(
			"Global WebSocket is not available in this runtime. Node 22+ is required for hub mode.",
		);
	}
	return ctor;
}

function decodeSocketData(data: unknown): string {
	if (typeof data === "string") {
		return data;
	}
	if (data instanceof Uint8Array) {
		return Buffer.from(data).toString();
	}
	if (data instanceof ArrayBuffer) {
		return Buffer.from(data).toString();
	}
	if (Array.isArray(data)) {
		return Buffer.concat(data.map((chunk) => Buffer.from(chunk))).toString();
	}
	if (
		data &&
		typeof data === "object" &&
		"data" in data &&
		typeof (data as { data?: unknown }).data !== "undefined"
	) {
		return decodeSocketData((data as { data?: unknown }).data);
	}
	return String(data);
}

function decodeCloseReason(reason: unknown): string {
	if (typeof reason === "string") {
		return reason;
	}
	if (reason instanceof Uint8Array) {
		return Buffer.from(reason).toString("utf8");
	}
	if (reason instanceof ArrayBuffer) {
		return Buffer.from(reason).toString("utf8");
	}
	return "";
}

function createHubCloseError(event: unknown): HubTransportError {
	const closeEvent = event as { code?: number; reason?: unknown };
	const reasonText = decodeCloseReason(closeEvent.reason);
	return new HubTransportError(
		"hub_connection_closed",
		closeEvent.code || reasonText
			? `Hub connection closed (code=${closeEvent.code ?? 0}${reasonText ? `, reason=${reasonText}` : ""})`
			: DEFAULT_HUB_CLOSED_MESSAGE,
		{
			closeCode: closeEvent.code,
			closeReason: reasonText || undefined,
		},
	);
}

function normalizeWebSocketConnectError(
	error: unknown,
	url: URL,
): HubTransportError {
	if (error instanceof HubTransportError) {
		return error;
	}
	if (error instanceof Error) {
		return new HubTransportError("hub_connect_failed", error.message);
	}
	if (
		error &&
		typeof error === "object" &&
		"error" in error &&
		(error as { error?: unknown }).error instanceof Error
	) {
		return new HubTransportError(
			"hub_connect_failed",
			(error as { error: Error }).error.message,
		);
	}
	const message =
		error &&
		typeof error === "object" &&
		"message" in error &&
		typeof (error as { message?: unknown }).message === "string"
			? (error as { message: string }).message.trim()
			: "";
	if (message) {
		return new HubTransportError("hub_connect_failed", message);
	}
	const eventType =
		error &&
		typeof error === "object" &&
		"type" in error &&
		typeof (error as { type?: unknown }).type === "string"
			? (error as { type: string }).type.trim()
			: "";
	return new HubTransportError(
		"hub_connect_failed",
		eventType
			? `Failed to connect to hub at ${url.toString()} (${eventType} event before socket open).`
			: `Failed to connect to hub at ${url.toString()}.`,
	);
}

export interface HubClientOptions {
	url: string;
	clientId?: string;
	clientType?: string;
	displayName?: string;
	workspaceRoot?: string;
	cwd?: string;
	authToken?: string;
}

export interface LocalHubResolutionOptions {
	endpoint?: string;
	strategy?: "prefer-hub" | "require-hub";
	workspaceRoot?: string;
	cwd?: string;
}

const HUB_STARTUP_TIMEOUT_MS = 8_000;
const HUB_STARTUP_POLL_MS = 200;
const GLOBAL_SUBSCRIPTION_KEY = "*";
const HUB_CONNECT_TIMEOUT_MS = 8_000;
const HUB_AUTH_PROTOCOL_PREFIX = "cline-hub-auth.";
const LOCAL_HUB_AUTH_TOKENS = new Map<string, string>();
const RECOVERABLE_LOCAL_HUB_URLS = new Set<string>();
const HUB_RECOVERY_SESSION_LIST_TIMEOUT_MS = 3_000;
const HUB_RECOVERY_RETIRE_TIMEOUT_MS = 3_000;
const HUB_RECOVERY_RETIRE_POLL_MS = 100;
const DEFAULT_HUB_CLOSED_MESSAGE = "Hub connection closed";
const HUB_RECONNECT_INITIAL_DELAY_MS = 250;
const HUB_RECONNECT_MAX_DELAY_MS = 5_000;
const HUB_RECONNECT_JITTER_RATIO = 0.5;

export type HubTransportErrorCode =
	| "hub_connect_timeout"
	| "hub_connect_failed"
	| "hub_connection_closed"
	| "hub_connection_not_open";

export class HubTransportError extends Error {
	constructor(
		readonly code: HubTransportErrorCode,
		message: string,
		readonly details?: { closeCode?: number; closeReason?: string },
	) {
		super(message);
		this.name = "HubTransportError";
	}
}

export function isHubReconnectableTransportError(
	error: unknown,
): error is HubTransportError {
	return error instanceof HubTransportError;
}

export class HubCommandError extends Error {
	constructor(
		readonly command: HubCommandEnvelope["command"],
		readonly code: string | undefined,
		message: string,
	) {
		super(message);
		this.name = "HubCommandError";
	}
}

export function isHubCommandTimeoutError(
	error: unknown,
	command?: HubCommandEnvelope["command"],
): boolean {
	return (
		error instanceof HubCommandError &&
		error.code === "hub_command_timeout" &&
		(command === undefined || error.command === command)
	);
}

function resolveLocalHubAuthToken(url: URL): string | undefined {
	const queryToken = url.searchParams.get("authToken")?.trim();
	url.searchParams.delete("authToken");
	if (queryToken) {
		return queryToken;
	}
	const key = localHubUrlKey(url.toString());
	return key ? LOCAL_HUB_AUTH_TOKENS.get(key) : undefined;
}

function isLocalHubUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
		return (
			hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
		);
	} catch {
		return false;
	}
}

function localHubUrlKey(url: string): string | undefined {
	if (!isLocalHubUrl(url)) {
		return undefined;
	}
	const parsed = new URL(normalizeHubWebSocketUrl(url));
	parsed.search = "";
	parsed.hash = "";
	return parsed.toString();
}

function isRecoverableLocalHubUrl(url: string): boolean {
	const key = localHubUrlKey(url);
	return !!key && RECOVERABLE_LOCAL_HUB_URLS.has(key);
}

export function rememberRecoverableLocalHubUrl(
	url: string,
	authToken?: string,
): string {
	const key = localHubUrlKey(url);
	if (key) {
		RECOVERABLE_LOCAL_HUB_URLS.add(key);
		if (authToken?.trim()) {
			LOCAL_HUB_AUTH_TOKENS.set(key, authToken);
		}
	}
	return url;
}

export class NodeHubClient {
	private socket: WebSocketLike | undefined;
	private connectPromise: Promise<void> | undefined;
	private readonly clientId: string;
	private currentUrl: string;
	private recoveryPromise: Promise<boolean> | undefined;
	private readonly pendingReplies = new Map<string, PendingReply>();
	private readonly listeners = new Set<SubscriptionEntry>();
	private readonly subscriptionCounts = new Map<string, number>();
	private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	private reconnectAttempt = 0;
	private closedByClient = false;
	private lastCloseError = new HubTransportError(
		"hub_connection_closed",
		DEFAULT_HUB_CLOSED_MESSAGE,
	);
	private sawSocketClose = false;
	private registered = false;

	constructor(private readonly options: HubClientOptions) {
		this.clientId =
			options.clientId ??
			`core-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
		this.currentUrl = options.url;
	}

	getClientId(): string {
		return this.clientId;
	}

	getUrl(): string {
		return this.currentUrl;
	}

	async connect(): Promise<void> {
		if (
			this.socket &&
			(this.socket.readyState === 1 || this.socket.readyState === 0)
		) {
			return this.connectPromise ?? Promise.resolve();
		}
		this.closedByClient = false;
		this.clearReconnectTimer();

		const url = new URL(this.currentUrl);
		const authToken =
			this.options.authToken?.trim() || resolveLocalHubAuthToken(url);
		url.hash = "";

		const WebSocketImpl = getWebSocketCtor();
		const socket = new WebSocketImpl(
			url.toString(),
			authToken ? [`${HUB_AUTH_PROTOCOL_PREFIX}${authToken}`] : undefined,
		);
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
					`Timed out connecting to hub after ${HUB_CONNECT_TIMEOUT_MS}ms`,
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
			}, HUB_CONNECT_TIMEOUT_MS);
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
			this.handleFrame(JSON.parse(decodeSocketData(data)) as HubTransportFrame);
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
				this.scheduleReconnect();
			}
		});

		await this.connectPromise;
		await this.command("client.register", {
			clientId: this.clientId,
			clientType: this.options.clientType ?? "core",
			displayName: this.options.displayName ?? "core",
			transport: "native",
			actorKind: "client",
			workspaceContext: {
				workspaceRoot: this.options.workspaceRoot,
				cwd: this.options.cwd,
			},
		} satisfies HubClientRegistration);
		this.registered = true;
		for (const key of this.subscriptionCounts.keys()) {
			this.sendSubscriptionFrame(
				"stream.subscribe",
				this.subscriptionSessionIdFromKey(key),
			);
		}
		this.reconnectAttempt = 0;
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
					!(await this.recoverLocalHubTransport(error))
				) {
					throw error;
				}
				attempt += 1;
			}
		}
	}

	private async commandOnce(
		command: HubCommandEnvelope["command"],
		payload?: Record<string, unknown>,
		sessionId?: string,
		options?: { timeoutMs?: number | null },
	): Promise<HubReplyEnvelope> {
		await this.connect();
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
									`Hub command ${command} timed out after ${effectiveTimeoutMs}ms (hub=${this.currentUrl}, requestId=${requestId}, clientId=${this.clientId}). Check hub-daemon.log for matching command.start/command.slow entries, or run 'cline doctor fix' to restart the hub.`,
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
			throw new HubCommandError(
				command,
				resolved.error?.code,
				resolved.error?.message ?? `Hub command ${command} failed`,
			);
		}
		return resolved;
	}

	private async recoverLocalHubTransport(error: unknown): Promise<boolean> {
		if (
			!isRecoverableLocalHubUrl(this.currentUrl) ||
			!isHubReconnectableTransportError(error)
		) {
			return false;
		}
		if (this.recoveryPromise) {
			return await this.recoveryPromise;
		}
		this.recoveryPromise = (async () => {
			const recoveredUrl = await ensureCompatibleLocalHubUrl({
				workspaceRoot: this.options.workspaceRoot,
				cwd: this.options.cwd,
			}).catch(() => undefined);
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
	}

	private async reconnectSubscribedTransport(): Promise<void> {
		if (this.closedByClient || !this.hasActiveSubscriptions()) {
			return;
		}
		try {
			await this.connect();
			this.reconnectAttempt = 0;
		} catch {
			if (!isRecoverableLocalHubUrl(this.currentUrl)) {
				this.reconnectAttempt += 1;
				this.scheduleReconnect();
				return;
			}
			try {
				const recoveredUrl = await ensureCompatibleLocalHubUrl({
					workspaceRoot: this.options.workspaceRoot,
					cwd: this.options.cwd,
				});
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
		this.sendFrame({
			kind,
			clientId: this.clientId,
			...(sessionId ? { sessionId } : {}),
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
			case "event":
				for (const entry of this.listeners) {
					if (
						entry.sessionId &&
						entry.sessionId !== frame.envelope.sessionId?.trim()
					) {
						continue;
					}
					entry.listener(frame.envelope);
				}
				return;
			case "command":
			case "stream.subscribe":
			case "stream.unsubscribe":
				return;
		}
	}
}

export function normalizeHubWebSocketUrl(url: string): string {
	const parsed = new URL(url);
	if (parsed.protocol === "http:") {
		parsed.protocol = "ws:";
	} else if (parsed.protocol === "https:") {
		parsed.protocol = "wss:";
	}
	return parsed.toString();
}

export async function verifyHubConnection(
	url: string,
	options?: Pick<HubClientOptions, "workspaceRoot" | "cwd" | "authToken">,
): Promise<boolean> {
	const client = new NodeHubClient({
		url,
		authToken: options?.authToken,
		clientType: "hub-healthcheck",
		displayName: "hub healthcheck",
		workspaceRoot: options?.workspaceRoot,
		cwd: options?.cwd,
	});
	try {
		await client.connect();
		return true;
	} catch {
		return false;
	} finally {
		client.close();
	}
}

type HubProbeResult =
	| {
			status: "compatible";
			url: string;
	  }
	| {
			status: "unreachable" | "build_mismatch";
			url: string;
	  };

async function probeCompatibleHubUrl(
	url: string,
	options?: {
		verifyConnection?: boolean;
		workspaceRoot?: string;
		cwd?: string;
		authToken?: string;
	},
): Promise<HubProbeResult> {
	const normalized = normalizeHubWebSocketUrl(url);
	const record = await probeHubServer(normalized);
	if (!record) {
		return {
			status: "unreachable",
			url: normalized,
		};
	}
	const buildId = resolveHubBuildId();
	const recordBuildId = record.buildId?.trim();
	if (!recordBuildId || recordBuildId !== buildId) {
		return {
			status: "build_mismatch",
			url: normalized,
		};
	}
	if (
		options?.verifyConnection === true &&
		!(await verifyHubConnection(normalized, {
			workspaceRoot: options.workspaceRoot,
			cwd: options.cwd,
			authToken: options.authToken,
		}))
	) {
		return {
			status: "unreachable",
			url: normalized,
		};
	}
	return {
		status: "compatible",
		url: normalized,
	};
}

async function waitForCompatibleHubUrl(
	owner: HubOwnerContext,
): Promise<string | undefined> {
	const deadline = Date.now() + HUB_STARTUP_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const record = await readHubDiscovery(owner.discoveryPath);
		if (record?.url) {
			const compatible = await probeCompatibleHubUrl(record.url, {
				verifyConnection: true,
				authToken: record.authToken,
			});
			if (compatible.status === "compatible") {
				return rememberRecoverableLocalHubUrl(compatible.url, record.authToken);
			}
		}
		await new Promise((resolve) => setTimeout(resolve, HUB_STARTUP_POLL_MS));
	}
	return undefined;
}

async function waitForHubToRetire(url: string): Promise<boolean> {
	const deadline = Date.now() + HUB_RECOVERY_RETIRE_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const healthy = await probeHubServer(url).catch(() => undefined);
		if (!healthy?.url) {
			return true;
		}
		await new Promise((resolve) =>
			setTimeout(resolve, HUB_RECOVERY_RETIRE_POLL_MS),
		);
	}
	return false;
}

function sameNormalizedHubUrl(left: string, right: string): boolean {
	try {
		return normalizeHubWebSocketUrl(left) === normalizeHubWebSocketUrl(right);
	} catch {
		return false;
	}
}

function hasActiveHubSessions(payload: unknown): boolean {
	const sessions =
		payload &&
		typeof payload === "object" &&
		Array.isArray((payload as { sessions?: unknown }).sessions)
			? (payload as { sessions: unknown[] }).sessions
			: [];
	return sessions.some((session) => {
		if (!session || typeof session !== "object") {
			return false;
		}
		const record = session as {
			status?: unknown;
			participants?: unknown;
		};
		if (record.status === "running" || record.status === "idle") {
			return true;
		}
		return Array.isArray(record.participants) && record.participants.length > 0;
	});
}

async function localHubHasNoActiveSessions(
	url: string,
	authToken?: string,
	options?: Pick<HubClientOptions, "workspaceRoot" | "cwd">,
): Promise<boolean> {
	const client = new NodeHubClient({
		url,
		authToken,
		clientType: "hub-recovery-check",
		displayName: "hub recovery check",
		workspaceRoot: options?.workspaceRoot,
		cwd: options?.cwd,
	});
	try {
		const reply = await client.command(
			"session.list",
			{ limit: 500 },
			undefined,
			{ timeoutMs: HUB_RECOVERY_SESSION_LIST_TIMEOUT_MS },
		);
		return !hasActiveHubSessions(reply.payload);
	} catch {
		return false;
	} finally {
		await client.dispose().catch(() => undefined);
	}
}

export async function resolveCompatibleLocalHubUrl(
	options: LocalHubResolutionOptions = {},
): Promise<string | undefined> {
	if (options.endpoint?.trim()) {
		const compatible = await probeCompatibleHubUrl(options.endpoint);
		return compatible.status === "compatible" ? compatible.url : undefined;
	}

	const owner = resolveSharedHubOwnerContext();
	const record = await readHubDiscovery(owner.discoveryPath);
	if (!record?.url) {
		return undefined;
	}
	const compatible = await probeCompatibleHubUrl(record.url);
	if (compatible.status === "compatible") {
		return rememberRecoverableLocalHubUrl(compatible.url, record.authToken);
	}
	if (compatible.status === "build_mismatch") {
		await clearHubDiscovery(owner.discoveryPath).catch(() => undefined);
	}
	return undefined;
}

export async function ensureCompatibleLocalHubUrl(
	options: LocalHubResolutionOptions = {},
): Promise<string | undefined> {
	const resolved = await resolveCompatibleLocalHubUrl(options);
	if (
		resolved &&
		(await verifyHubConnection(resolved, {
			workspaceRoot: options.workspaceRoot,
			cwd: options.cwd,
		}))
	) {
		return resolved;
	}
	if (options.endpoint?.trim()) {
		return undefined;
	}
	const owner = resolveSharedHubOwnerContext();
	spawnDetachedHubServer(options.workspaceRoot ?? process.cwd());
	return await waitForCompatibleHubUrl(owner);
}

export async function requestHubShutdown(
	url: string,
	authToken?: string,
): Promise<boolean> {
	const parsed = new URL(url);
	const resolvedAuthToken =
		authToken?.trim() || resolveLocalHubAuthToken(parsed);
	if (parsed.protocol === "ws:") {
		parsed.protocol = "http:";
	} else if (parsed.protocol === "wss:") {
		parsed.protocol = "https:";
	}
	parsed.pathname = "/shutdown";
	parsed.hash = "";
	const response = await fetch(parsed, {
		method: "POST",
		headers: resolvedAuthToken
			? { authorization: `Bearer ${resolvedAuthToken}` }
			: undefined,
	});
	return response.ok;
}

export async function stopLocalHubServerGracefully(): Promise<boolean> {
	const owner = resolveSharedHubOwnerContext();
	const discovery = await readHubDiscovery(owner.discoveryPath);
	if (!discovery?.url) {
		return false;
	}
	try {
		const stopped = await requestHubShutdown(
			discovery.url,
			discovery.authToken,
		);
		if (stopped) {
			return true;
		}
	} catch {
		// Fall through so callers can apply a stronger fallback.
	}
	return false;
}

export async function restartLocalHubIfIdleAfterStartupTimeout(options: {
	url: string;
	workspaceRoot?: string;
	cwd?: string;
}): Promise<string | undefined> {
	if (!isRecoverableLocalHubUrl(options.url)) {
		return undefined;
	}
	const owner = resolveSharedHubOwnerContext();
	const discovery = await readHubDiscovery(owner.discoveryPath);
	if (!discovery?.url || !sameNormalizedHubUrl(discovery.url, options.url)) {
		return undefined;
	}
	const hasNoActiveSessions = await localHubHasNoActiveSessions(
		discovery.url,
		discovery.authToken,
		{ workspaceRoot: options.workspaceRoot, cwd: options.cwd },
	);
	if (!hasNoActiveSessions) {
		return undefined;
	}
	if (!(await stopLocalHubServerGracefully())) {
		return undefined;
	}
	if (!(await waitForHubToRetire(discovery.url))) {
		return undefined;
	}
	await clearHubDiscovery(owner.discoveryPath).catch(() => undefined);
	return await ensureCompatibleLocalHubUrl({
		workspaceRoot: options.workspaceRoot,
		cwd: options.cwd,
	});
}
