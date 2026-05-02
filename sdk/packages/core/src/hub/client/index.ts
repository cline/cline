import {
	createSessionId,
	type HubClientRegistration,
	type HubCommandEnvelope,
	type HubEventEnvelope,
	type HubReplyEnvelope,
	type HubTransportFrame,
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

function normalizeWebSocketConnectError(error: unknown, url: URL): Error {
	if (error instanceof Error) {
		return error;
	}
	if (
		error &&
		typeof error === "object" &&
		"error" in error &&
		(error as { error?: unknown }).error instanceof Error
	) {
		return (error as { error: Error }).error;
	}
	const message =
		error &&
		typeof error === "object" &&
		"message" in error &&
		typeof (error as { message?: unknown }).message === "string"
			? (error as { message: string }).message.trim()
			: "";
	if (message) {
		return new Error(message);
	}
	const eventType =
		error &&
		typeof error === "object" &&
		"type" in error &&
		typeof (error as { type?: unknown }).type === "string"
			? (error as { type: string }).type.trim()
			: "";
	return new Error(
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
const HUB_COMMAND_TIMEOUT_MS = 30_000;
const HUB_AUTH_PROTOCOL_PREFIX = "cline-hub-auth.";
const LOCAL_HUB_AUTH_TOKENS = new Map<string, string>();
const HUB_RECOVERY_SESSION_LIST_TIMEOUT_MS = 3_000;
const HUB_RECOVERY_RETIRE_TIMEOUT_MS = 3_000;
const HUB_RECOVERY_RETIRE_POLL_MS = 100;

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

function rememberLocalHubAuthToken(url: string, authToken: string): string {
	const parsed = new URL(url);
	parsed.search = "";
	parsed.hash = "";
	LOCAL_HUB_AUTH_TOKENS.set(parsed.toString(), authToken);
	return url;
}

function resolveLocalHubAuthToken(url: URL): string | undefined {
	const queryToken = url.searchParams.get("authToken")?.trim();
	url.searchParams.delete("authToken");
	if (queryToken) {
		return queryToken;
	}
	return LOCAL_HUB_AUTH_TOKENS.get(url.toString());
}

export class NodeHubClient {
	private socket: WebSocketLike | undefined;
	private connectPromise: Promise<void> | undefined;
	private readonly clientId: string;
	private readonly pendingReplies = new Map<string, PendingReply>();
	private readonly listeners = new Set<SubscriptionEntry>();
	private readonly subscriptionCounts = new Map<string, number>();
	private lastCloseMessage = "Hub connection closed";
	private registered = false;

	constructor(private readonly options: HubClientOptions) {
		this.clientId =
			options.clientId ??
			`core-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
	}

	getClientId(): string {
		return this.clientId;
	}

	getUrl(): string {
		return this.options.url;
	}

	async connect(): Promise<void> {
		if (
			this.socket &&
			(this.socket.readyState === 1 || this.socket.readyState === 0)
		) {
			return this.connectPromise ?? Promise.resolve();
		}

		const url = new URL(this.options.url);
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
				this.lastCloseMessage = `Timed out connecting to hub after ${HUB_CONNECT_TIMEOUT_MS}ms`;
				this.connectPromise = undefined;
				this.socket = undefined;
				try {
					socket.close();
				} catch {
					// best-effort close
				}
				reject(new Error(this.lastCloseMessage));
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
				this.connectPromise = undefined;
				this.socket = undefined;
				reject(normalizeWebSocketConnectError(error, url));
			});
		});

		socket.addEventListener("message", (data: unknown) => {
			this.handleFrame(JSON.parse(decodeSocketData(data)) as HubTransportFrame);
		});
		socket.addEventListener("close", (event: unknown) => {
			if (this.socket !== socket && this.connectPromise === undefined) {
				return;
			}
			const closeEvent = event as { code?: number; reason?: unknown };
			const reasonText = decodeCloseReason(closeEvent.reason);
			if (!suppressCloseMessage) {
				this.lastCloseMessage =
					closeEvent.code || reasonText
						? `Hub connection closed (code=${closeEvent.code ?? 0}${reasonText ? `, reason=${reasonText}` : ""})`
						: "Hub connection closed";
			}
			for (const pending of this.pendingReplies.values()) {
				pending.reject(new Error(this.lastCloseMessage));
			}
			this.pendingReplies.clear();
			this.connectPromise = undefined;
			this.socket = undefined;
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
		await this.connect();
		const requestId = createSessionId("hubreq_");
		const reply = new Promise<HubReplyEnvelope>((resolve, reject) => {
			const timeoutMs = options?.timeoutMs;
			const effectiveTimeoutMs = timeoutMs ?? HUB_COMMAND_TIMEOUT_MS;
			const timeout =
				timeoutMs === null
					? undefined
					: setTimeout(() => {
							if (!this.pendingReplies.delete(requestId)) {
								return;
							}
							reject(
								new HubCommandError(
									command,
									"hub_command_timeout",
									`Hub command ${command} timed out after ${effectiveTimeoutMs}ms (hub=${this.options.url}, requestId=${requestId}, clientId=${this.clientId}). Check hub-daemon.log for matching command.start/command.slow entries, or run with CLINE_SESSION_BACKEND_MODE=local to bypass the hub.`,
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
		this.sendFrame({
			kind: "command",
			envelope: {
				version: "v1",
				command,
				requestId,
				clientId: this.clientId,
				sessionId,
				payload,
			},
		});
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

	close(): void {
		const socket = this.socket;
		this.registered = false;
		if (!socket) {
			return;
		}
		this.lastCloseMessage = "Hub connection closed";
		for (const pending of this.pendingReplies.values()) {
			pending.reject(new Error(this.lastCloseMessage));
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
			throw new Error(
				this.lastCloseMessage === "Hub connection closed"
					? "Hub connection is not open."
					: this.lastCloseMessage,
			);
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
				return rememberLocalHubAuthToken(compatible.url, record.authToken);
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
		return rememberLocalHubAuthToken(compatible.url, record.authToken);
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
