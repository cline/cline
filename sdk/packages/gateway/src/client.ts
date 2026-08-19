/**
 * Loopback Gateway client (Gateway RFC, Phase 3).
 *
 * Speaks the versioned NDJSON protocol: hello-first handshake with the
 * per-instance secret from the discovery record, promise-correlated
 * requests, pushed events (durable-cursor replay), and server-initiated
 * requests (approvals) that the caller answers explicitly.
 *
 * There is no implicit fallback (ADR 0003): when the Gateway cannot be
 * reached this client fails with `gateway_unreachable` — it never spins
 * up a private runtime.
 */

import { connect, type Socket } from "node:net";
import type {
	BotRecord,
	RunRecord,
	SessionRecord,
	TurnOverrides,
} from "@cline/bot";
import type {
	BotId,
	GatewayError,
	GatewayEvent,
	GatewayHelloResult,
	GatewayRequest,
	GatewayResponse,
	GatewayServerRequest,
	RunAccepted,
	RunId,
	SessionId,
} from "@cline/shared/gateway";
import {
	createGatewayError,
	createIdempotencyKey,
	GATEWAY_HELLO_METHOD,
	GATEWAY_PROTOCOL_VERSION,
	GatewayEventSchema,
	GatewayServerRequestSchema,
	IDEMPOTENCY_KEY_PARAM,
	RunAcceptedSchema,
} from "@cline/shared/gateway";
import type { ConnectorRecord } from "./connectors/store";
import type { DiscoveryRecord } from "./discovery";
import type { SessionSnapshot } from "./runtime";
import type { ScheduleJobRecord, ScheduleRecord } from "./schedules/store";

export class GatewayRequestError extends Error {
	readonly gatewayError: GatewayError;

	constructor(gatewayError: GatewayError) {
		super(`${gatewayError.code}: ${gatewayError.message}`);
		this.name = "GatewayRequestError";
		this.gatewayError = gatewayError;
	}
}

export interface GatewayClientOptions {
	host: string;
	port: number;
	/** Per-instance secret from the discovery record. */
	auth: string;
	clientName?: string;
	clientVersion?: string;
	/** Resume a previously assigned client identity. */
	clientId?: string;
	connectTimeoutMs?: number;
}

export type GatewayEventListener = (event: GatewayEvent) => void;
export type GatewayServerRequestHandler = (
	request: GatewayServerRequest,
) => Promise<unknown> | unknown;

// Re-exported so `@cline/gateway/client` consumers never reach into the
// Gateway's internals for the types the typed surface returns, nor for
// discovery/path resolution (the supported client-side surface).
export type { SessionSnapshot } from "./runtime";
export type { RunAttemptRecord, StoredMessage } from "./stores";
export type { BotRecord, RunRecord, SessionRecord, TurnOverrides };
export type { ConnectorRecord } from "./connectors/store";
export type {
	ScheduleJobRecord,
	ScheduleRecord,
} from "./schedules/store";
export type { DiscoveryRecord } from "./discovery";
export { DiscoveryRecordSchema, readDiscoveryRecord } from "./discovery";
export type { GatewayPaths, GatewayPathsOptions } from "./paths";
export {
	DEFAULT_GATEWAY_NAMESPACE,
	defaultGatewayDataRoot,
	GATEWAY_DATA_ROOT_ENV,
	GATEWAY_NAMESPACE_ENV,
	resolveGatewayNamespace,
	resolveGatewayPaths,
} from "./paths";

/** `gateway.status` result (additive fields must not break clients). */
export interface GatewayStatusSummary {
	state: "serving" | "draining";
	executionMode: string;
	sandboxed: boolean;
	gatewayId: string;
	instanceId: string;
	pid: number;
	startedAt: number;
	protocolVersion: number;
	defaultBotId?: BotId;
	catalogGeneration: number;
	namespace: string;
	dataDir: string;
	/** Worker isolation health (Phase 4): driver/isolation/development. */
	execution?: {
		isolation: string;
		development: boolean;
		[extra: string]: unknown;
	};
	/** Plugin catalog summary (Phase 4): counts only, never entries. */
	plugins?: {
		generation: number;
		plugins: number;
		heldGenerations: readonly number[];
		pinnedByRuns: number;
		lastReloadOk: boolean;
	};
	/** Live connector worker health (Phase 6, read-only diagnostics). */
	connectorHealth?: {
		running: readonly {
			connectorId: string;
			workerId: string;
			restarts: number;
			state: string;
		}[];
	};
	counts: {
		bots: number;
		sessions: number;
		queuedRuns: number;
		runningRuns: number;
		clients: number;
		pendingOutbox: number;
		lastEventSequence: number;
		pendingServerRequests: number;
		connectors?: number;
		schedules?: number;
	};
	port: number;
	connections: number;
	[extra: string]: unknown;
}

export interface StartRunInput {
	botId: BotId;
	prompt: string;
	workspaceRoot?: string;
	overrides?: TurnOverrides;
	idempotencyKey?: string;
}

export interface ApprovalResolution {
	approved: boolean;
	reason?: string;
}

interface PendingRequest {
	resolve(value: unknown): void;
	reject(error: Error): void;
}

export class GatewayClient {
	readonly hello: GatewayHelloResult;

	private readonly socket: Socket;
	private readonly pending = new Map<string, PendingRequest>();
	private readonly eventListeners = new Set<GatewayEventListener>();
	private readonly closeListeners = new Set<() => void>();
	private serverRequestHandler: GatewayServerRequestHandler | undefined;
	private buffer = "";
	private nextRequestId = 0;
	private closed = false;
	private closeNotified = false;

	private constructor(socket: Socket, hello: GatewayHelloResult) {
		this.socket = socket;
		this.hello = hello;
	}

	/** Connect and complete the mandatory `gateway.hello` handshake. */
	static async connect(options: GatewayClientOptions): Promise<GatewayClient> {
		const socket = await connectSocket(options);
		const transport = new TransportShim(socket);
		try {
			const helloResult = await transport.request(GATEWAY_HELLO_METHOD, {
				protocolVersions: [GATEWAY_PROTOCOL_VERSION],
				client: {
					name: options.clientName ?? "gateway-client",
					version: options.clientVersion ?? "0.0.0",
					...(options.clientId ? { clientId: options.clientId } : {}),
				},
				auth: options.auth,
			});
			const client = new GatewayClient(
				socket,
				helloResult as GatewayHelloResult,
			);
			transport.handover(client);
			return client;
		} catch (error) {
			socket.destroy();
			throw error;
		}
	}

	/** Connect using a discovery record (endpoint + secret). */
	static async connectToDiscovery(
		record: DiscoveryRecord,
		options: Partial<GatewayClientOptions> = {},
	): Promise<GatewayClient> {
		return GatewayClient.connect({
			host: record.host,
			port: record.port,
			auth: record.auth,
			...options,
		});
	}

	/** Issue a request; mutating methods should go through `mutate`. */
	request(method: string, params?: Record<string, unknown>): Promise<unknown> {
		if (this.closed) {
			return Promise.reject(
				new GatewayRequestError(
					createGatewayError("gateway_unreachable", "Connection is closed"),
				),
			);
		}
		this.nextRequestId += 1;
		const id = `req_${this.nextRequestId}`;
		const request: GatewayRequest = {
			version: GATEWAY_PROTOCOL_VERSION,
			id,
			method,
			...(params ? { params } : {}),
		};
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.socket.write(`${JSON.stringify(request)}\n`);
		});
	}

	/** Issue a mutating request, generating an idempotency key if absent. */
	mutate(
		method: string,
		params: Record<string, unknown> = {},
	): Promise<unknown> {
		const withKey = {
			...params,
			[IDEMPOTENCY_KEY_PARAM]:
				params[IDEMPOTENCY_KEY_PARAM] ?? createIdempotencyKey(),
		};
		return this.request(method, withKey);
	}

	subscribe(params: {
		sessionId?: string;
		runId?: string;
		cursor?: string;
	}): Promise<unknown> {
		return this.request("run.subscribe", { ...params });
	}

	// ---------------------------------------------------------------------
	// Typed command surface (the supported application entrypoint)
	// ---------------------------------------------------------------------

	getStatus(): Promise<GatewayStatusSummary> {
		return this.request("gateway.status", {}) as Promise<GatewayStatusSummary>;
	}

	listBots(): Promise<{ bots: readonly BotRecord[] }> {
		return this.request("bot.list", {}) as Promise<{
			bots: readonly BotRecord[];
		}>;
	}

	listSessions(
		input: { botId?: BotId } = {},
	): Promise<{ sessions: readonly SessionRecord[] }> {
		return this.request("session.list", { ...input }) as Promise<{
			sessions: readonly SessionRecord[];
		}>;
	}

	listRuns(
		input: { sessionId?: SessionId; runId?: RunId } = {},
	): Promise<{ runs: readonly RunRecord[] }> {
		return this.request("run.list", { ...input }) as Promise<{
			runs: readonly RunRecord[];
		}>;
	}

	getSession(input: { sessionId: SessionId }): Promise<SessionSnapshot> {
		return this.request("session.get", {
			sessionId: input.sessionId,
		}) as Promise<SessionSnapshot>;
	}

	/** Admit a prompt; acks immediately without waiting for execution. */
	async startRun(input: StartRunInput): Promise<RunAccepted> {
		const result = await this.mutate("run.start", {
			botId: input.botId,
			prompt: input.prompt,
			...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
			...(input.overrides ? { overrides: input.overrides } : {}),
			...(input.idempotencyKey
				? { [IDEMPOTENCY_KEY_PARAM]: input.idempotencyKey }
				: {}),
		});
		return RunAcceptedSchema.parse(result);
	}

	steerRun(input: {
		runId: RunId;
		text: string;
		idempotencyKey?: string;
	}): Promise<{ merged: boolean }> {
		return this.mutate("run.steer", {
			runId: input.runId,
			text: input.text,
			...(input.idempotencyKey
				? { [IDEMPOTENCY_KEY_PARAM]: input.idempotencyKey }
				: {}),
		}) as Promise<{ merged: boolean }>;
	}

	interruptRun(input: {
		runId: RunId;
		reason?: string;
		idempotencyKey?: string;
	}): Promise<{ state: string }> {
		return this.mutate("run.interrupt", {
			runId: input.runId,
			...(input.reason ? { reason: input.reason } : {}),
			...(input.idempotencyKey
				? { [IDEMPOTENCY_KEY_PARAM]: input.idempotencyKey }
				: {}),
		}) as Promise<{ state: string }>;
	}

	/** Re-admit a failed/interrupted run: same runId, new attempt. */
	async retryRun(input: {
		runId: RunId;
		reason?: string;
		idempotencyKey?: string;
	}): Promise<RunAccepted> {
		const result = await this.mutate("run.retry", {
			runId: input.runId,
			...(input.reason ? { reason: input.reason } : {}),
			...(input.idempotencyKey
				? { [IDEMPOTENCY_KEY_PARAM]: input.idempotencyKey }
				: {}),
		});
		return RunAcceptedSchema.parse(result);
	}

	listConnectors(
		input: { botId?: BotId } = {},
	): Promise<{ connectors: readonly ConnectorRecord[] }> {
		return this.request("connector.list", { ...input }) as Promise<{
			connectors: readonly ConnectorRecord[];
		}>;
	}

	/** Register a bot-scoped connector; `credentialRef` names a secret file, never a secret. */
	registerConnector(input: {
		botId: BotId;
		kind: string;
		name: string;
		config?: Record<string, unknown>;
		credentialRef?: string;
		idempotencyKey?: string;
	}): Promise<ConnectorRecord> {
		return this.mutate("connector.register", {
			botId: input.botId,
			kind: input.kind,
			name: input.name,
			...(input.config ? { config: input.config } : {}),
			...(input.credentialRef ? { credentialRef: input.credentialRef } : {}),
			...(input.idempotencyKey
				? { [IDEMPOTENCY_KEY_PARAM]: input.idempotencyKey }
				: {}),
		}) as Promise<ConnectorRecord>;
	}

	listSchedules(
		input: { botId?: BotId } = {},
	): Promise<{ schedules: readonly ScheduleRecord[] }> {
		return this.request("schedule.list", { ...input }) as Promise<{
			schedules: readonly ScheduleRecord[];
		}>;
	}

	/** Create a schedule (exactly one of `intervalMs` / `at`). */
	createSchedule(input: {
		botId: BotId;
		name: string;
		prompt: string;
		intervalMs?: number;
		at?: number;
		maxAttempts?: number;
		idempotencyKey?: string;
	}): Promise<ScheduleRecord> {
		return this.mutate("schedule.create", {
			botId: input.botId,
			name: input.name,
			prompt: input.prompt,
			...(input.intervalMs !== undefined
				? { intervalMs: input.intervalMs }
				: {}),
			...(input.at !== undefined ? { at: input.at } : {}),
			...(input.maxAttempts !== undefined
				? { maxAttempts: input.maxAttempts }
				: {}),
			...(input.idempotencyKey
				? { [IDEMPOTENCY_KEY_PARAM]: input.idempotencyKey }
				: {}),
		}) as Promise<ScheduleRecord>;
	}

	scheduleReport(input: {
		scheduleId: string;
	}): Promise<{ jobs: readonly ScheduleJobRecord[] }> {
		return this.request("schedule.report", {
			scheduleId: input.scheduleId,
		}) as Promise<{ jobs: readonly ScheduleJobRecord[] }>;
	}

	/**
	 * Answer a server-initiated approval request. First answer wins across
	 * all attached clients; the Gateway broadcasts `approval.resolved`.
	 */
	resolveApproval(requestId: string, resolution: ApprovalResolution): void {
		this.respondToServerRequest(requestId, {
			approved: resolution.approved,
			...(resolution.reason ? { reason: resolution.reason } : {}),
		});
	}

	onEvent(listener: GatewayEventListener): () => void {
		this.eventListeners.add(listener);
		return () => {
			this.eventListeners.delete(listener);
		};
	}

	/** Fires once when the connection is lost or closed locally. */
	onClose(listener: () => void): () => void {
		this.closeListeners.add(listener);
		return () => {
			this.closeListeners.delete(listener);
		};
	}

	/** Register the handler answering server-initiated requests. */
	onServerRequest(handler: GatewayServerRequestHandler): void {
		this.serverRequestHandler = handler;
	}

	respondToServerRequest(
		id: string,
		result: unknown,
		error?: GatewayError,
	): void {
		this.socket.write(
			`${JSON.stringify({
				version: GATEWAY_PROTOCOL_VERSION,
				id,
				...(error ? { error } : { result: result ?? null }),
			})}\n`,
		);
	}

	/** Destroy the connection. Never aborts runs (server-side invariant). */
	close(): void {
		this.closed = true;
		this.socket.destroy();
		const failure = new GatewayRequestError(
			createGatewayError("gateway_unreachable", "Connection closed locally"),
		);
		for (const pending of this.pending.values()) {
			pending.reject(failure);
		}
		this.pending.clear();
		this.notifyClosed();
	}

	// ---------------------------------------------------------------------
	// Frame routing (also used by the handshake shim)
	// ---------------------------------------------------------------------

	handleFrame(value: unknown): void {
		if (typeof value !== "object" || value === null) {
			return;
		}
		const frame = value as Record<string, unknown>;
		if (typeof frame.sequence === "number" && typeof frame.event === "string") {
			const parsed = GatewayEventSchema.safeParse(frame);
			if (parsed.success) {
				for (const listener of this.eventListeners) {
					listener(parsed.data);
				}
			}
			return;
		}
		if (typeof frame.method === "string" && typeof frame.id === "string") {
			const parsed = GatewayServerRequestSchema.safeParse(frame);
			if (parsed.success) {
				this.dispatchServerRequest(parsed.data);
			}
			return;
		}
		if (typeof frame.id === "string") {
			this.settleResponse(frame as unknown as GatewayResponse);
		}
	}

	feed(chunk: string): void {
		this.buffer += chunk;
		for (;;) {
			const newline = this.buffer.indexOf("\n");
			if (newline === -1) {
				return;
			}
			const line = this.buffer.slice(0, newline).trim();
			this.buffer = this.buffer.slice(newline + 1);
			if (!line) {
				continue;
			}
			try {
				this.handleFrame(JSON.parse(line));
			} catch {
				// Skip malformed frames; correlation ids keep us consistent.
			}
		}
	}

	handleDisconnect(): void {
		this.closed = true;
		const failure = new GatewayRequestError(
			createGatewayError(
				"gateway_unreachable",
				"Connection to the Gateway was lost",
			),
		);
		for (const pending of this.pending.values()) {
			pending.reject(failure);
		}
		this.pending.clear();
		this.notifyClosed();
	}

	private notifyClosed(): void {
		if (this.closeNotified) {
			return;
		}
		this.closeNotified = true;
		for (const listener of this.closeListeners) {
			listener();
		}
	}

	private settleResponse(response: GatewayResponse): void {
		const pending = this.pending.get(response.id);
		if (!pending) {
			return;
		}
		this.pending.delete(response.id);
		if (response.error) {
			pending.reject(new GatewayRequestError(response.error));
			return;
		}
		pending.resolve(response.result);
	}

	private dispatchServerRequest(request: GatewayServerRequest): void {
		const handler = this.serverRequestHandler;
		if (!handler) {
			return;
		}
		void (async () => {
			try {
				const result = await handler(request);
				this.respondToServerRequest(request.id, result);
			} catch (error) {
				this.respondToServerRequest(
					request.id,
					undefined,
					createGatewayError(
						"internal",
						error instanceof Error ? error.message : String(error),
					),
				);
			}
		})();
	}
}

/**
 * Minimal request transport used only for the handshake, before the
 * `GatewayClient` exists; then hands the socket stream over to it.
 */
class TransportShim {
	private readonly socket: Socket;
	private buffer = "";
	private pendingResolve: ((value: unknown) => void) | undefined;
	private pendingReject: ((error: Error) => void) | undefined;
	private client: GatewayClient | undefined;

	constructor(socket: Socket) {
		this.socket = socket;
		socket.setEncoding("utf8");
		socket.on("data", (chunk: string) => this.onData(chunk));
		socket.on("close", () => {
			this.pendingReject?.(
				new GatewayRequestError(
					createGatewayError(
						"gateway_unreachable",
						"Connection closed during the handshake",
					),
				),
			);
			this.client?.handleDisconnect();
		});
	}

	request(method: string, params: Record<string, unknown>): Promise<unknown> {
		const request: GatewayRequest = {
			version: GATEWAY_PROTOCOL_VERSION,
			id: "hello_1",
			method,
			params,
		};
		return new Promise((resolve, reject) => {
			this.pendingResolve = resolve;
			this.pendingReject = reject;
			this.socket.write(`${JSON.stringify(request)}\n`);
		});
	}

	handover(client: GatewayClient): void {
		this.client = client;
		if (this.buffer) {
			client.feed(this.buffer);
			this.buffer = "";
		}
	}

	private onData(chunk: string): void {
		if (this.client) {
			this.client.feed(chunk);
			return;
		}
		this.buffer += chunk;
		const newline = this.buffer.indexOf("\n");
		if (newline === -1) {
			return;
		}
		const line = this.buffer.slice(0, newline).trim();
		this.buffer = this.buffer.slice(newline + 1);
		let response: GatewayResponse;
		try {
			response = JSON.parse(line) as GatewayResponse;
		} catch {
			this.pendingReject?.(
				new GatewayRequestError(
					createGatewayError("invalid_request", "Malformed handshake response"),
				),
			);
			return;
		}
		if (response.error) {
			this.pendingReject?.(new GatewayRequestError(response.error));
			return;
		}
		this.pendingResolve?.(response.result);
	}
}

function connectSocket(options: GatewayClientOptions): Promise<Socket> {
	return new Promise((resolve, reject) => {
		const socket = connect({ host: options.host, port: options.port });
		const timeout = setTimeout(() => {
			socket.destroy();
			reject(
				new GatewayRequestError(
					createGatewayError(
						"gateway_unreachable",
						`Timed out connecting to ${options.host}:${options.port}`,
						{ retryable: true },
					),
				),
			);
		}, options.connectTimeoutMs ?? 5_000);
		socket.once("connect", () => {
			clearTimeout(timeout);
			resolve(socket);
		});
		socket.once("error", (error) => {
			clearTimeout(timeout);
			socket.destroy();
			reject(
				new GatewayRequestError(
					createGatewayError(
						"gateway_unreachable",
						`Cannot reach the Gateway at ${options.host}:${options.port}: ${error.message}`,
						{ retryable: true },
					),
				),
			);
		});
	});
}
