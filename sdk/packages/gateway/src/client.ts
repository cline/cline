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
	GatewayError,
	GatewayEvent,
	GatewayHelloResult,
	GatewayRequest,
	GatewayResponse,
	GatewayServerRequest,
} from "@cline/shared/gateway";
import {
	createGatewayError,
	createIdempotencyKey,
	GATEWAY_HELLO_METHOD,
	GATEWAY_PROTOCOL_VERSION,
	GatewayEventSchema,
	GatewayServerRequestSchema,
	IDEMPOTENCY_KEY_PARAM,
} from "@cline/shared/gateway";
import type { DiscoveryRecord } from "./discovery";

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

interface PendingRequest {
	resolve(value: unknown): void;
	reject(error: Error): void;
}

export class GatewayClient {
	readonly hello: GatewayHelloResult;

	private readonly socket: Socket;
	private readonly pending = new Map<string, PendingRequest>();
	private readonly eventListeners = new Set<GatewayEventListener>();
	private serverRequestHandler: GatewayServerRequestHandler | undefined;
	private buffer = "";
	private nextRequestId = 0;
	private closed = false;

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

	onEvent(listener: GatewayEventListener): () => void {
		this.eventListeners.add(listener);
		return () => {
			this.eventListeners.delete(listener);
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
