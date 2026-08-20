export interface GatewayErrorShape {
	code: string;
	message: string;
	retryable?: boolean;
	details?: Record<string, unknown>;
}

export interface GatewayScope {
	botId?: string;
	sessionId?: string;
	runId?: string;
}

export interface GatewayEvent {
	version: 1;
	sequence: number;
	event: string;
	scope: GatewayScope;
	payload?: Record<string, unknown>;
}

export interface GatewayServerRequest {
	version: 1;
	id: string;
	method: string;
	scope: GatewayScope;
	params?: Record<string, unknown>;
}

export interface GatewayHello {
	protocolVersion: number;
	clientId: string;
	gatewayId: string;
	instanceId: string;
	capabilities: string[];
	[key: string]: unknown;
}

interface GatewayResponse {
	version: 1;
	id: string;
	result?: unknown;
	error?: GatewayErrorShape;
}

interface PendingRequest {
	resolve(value: unknown): void;
	reject(error: Error): void;
}

export class GatewayRpcError extends Error {
	constructor(readonly gatewayError: GatewayErrorShape) {
		super(`${gatewayError.code}: ${gatewayError.message}`);
		this.name = "GatewayRpcError";
	}
}

export interface BrowserGatewayClientOptions {
	url: string;
	auth: string;
	clientId?: string;
	allowInsecure?: boolean;
	connectTimeoutMs?: number;
	signal?: AbortSignal;
}

type SocketFactory = (url: string) => WebSocket;

export class BrowserGatewayClient {
	private nextRequestId = 0;
	private readonly pending = new Map<string, PendingRequest>();
	private readonly eventListeners = new Set<(event: GatewayEvent) => void>();
	private readonly requestListeners = new Set<
		(request: GatewayServerRequest) => void
	>();
	private readonly closeListeners = new Set<(reason: string) => void>();
	private buffer = "";
	private closed = false;

	private constructor(
		private readonly socket: WebSocket,
		readonly hello: GatewayHello,
	) {
		socket.addEventListener(
			"message",
			(event) => void this.handleMessage(event),
		);
		socket.addEventListener("close", () =>
			this.handleClose("Connection closed"),
		);
		socket.addEventListener("error", () => this.handleClose("WebSocket error"));
	}

	static async connect(
		options: BrowserGatewayClientOptions,
		socketFactory: SocketFactory = (url) => new WebSocket(url),
	): Promise<BrowserGatewayClient> {
		const url = validateRemoteUrl(options.url, options.allowInsecure ?? false);
		options.signal?.throwIfAborted();
		const socket = socketFactory(url.toString());
		try {
			await waitForOpen(
				socket,
				options.connectTimeoutMs ?? 5_000,
				options.signal,
			);
			const hello = await handshake(socket, options);
			return new BrowserGatewayClient(socket, hello);
		} catch (error) {
			socket.close();
			throw error;
		}
	}

	request(method: string, params?: Record<string, unknown>): Promise<unknown> {
		if (this.closed)
			return Promise.reject(new Error("Gateway connection is closed"));
		this.nextRequestId += 1;
		const id = `web_${this.nextRequestId}`;
		this.send({ version: 1, id, method, ...(params ? { params } : {}) });
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
		});
	}

	mutate(
		method: string,
		params: Record<string, unknown> = {},
	): Promise<unknown> {
		return this.request(method, {
			...params,
			idempotencyKey:
				params.idempotencyKey ??
				globalThis.crypto?.randomUUID?.() ??
				`web-${Date.now()}-${Math.random()}`,
		});
	}

	onEvent(listener: (event: GatewayEvent) => void): () => void {
		this.eventListeners.add(listener);
		return () => this.eventListeners.delete(listener);
	}

	onServerRequest(
		listener: (request: GatewayServerRequest) => void,
	): () => void {
		this.requestListeners.add(listener);
		return () => this.requestListeners.delete(listener);
	}

	onClose(listener: (reason: string) => void): () => void {
		this.closeListeners.add(listener);
		return () => this.closeListeners.delete(listener);
	}

	respond(id: string, result: unknown, error?: GatewayErrorShape): void {
		this.send({ version: 1, id, ...(error ? { error } : { result }) });
	}

	close(): void {
		this.handleClose("Disconnected locally");
		this.socket.close();
	}

	private send(value: unknown): void {
		this.socket.send(`${JSON.stringify(value)}\n`);
	}

	private async handleMessage(message: MessageEvent): Promise<void> {
		const chunk =
			typeof message.data === "string"
				? message.data
				: message.data instanceof Blob
					? await message.data.text()
					: new TextDecoder().decode(message.data as ArrayBuffer);
		this.buffer += chunk;
		for (;;) {
			const newline = this.buffer.indexOf("\n");
			if (newline === -1) return;
			const line = this.buffer.slice(0, newline).trim();
			this.buffer = this.buffer.slice(newline + 1);
			if (!line) continue;
			try {
				this.route(JSON.parse(line) as Record<string, unknown>);
			} catch {
				// Ignore malformed frames; request correlation remains intact.
			}
		}
	}

	private route(frame: Record<string, unknown>): void {
		if (typeof frame.sequence === "number" && typeof frame.event === "string") {
			for (const listener of this.eventListeners)
				listener(frame as unknown as GatewayEvent);
			return;
		}
		if (typeof frame.method === "string" && typeof frame.id === "string") {
			for (const listener of this.requestListeners)
				listener(frame as unknown as GatewayServerRequest);
			return;
		}
		if (typeof frame.id !== "string") return;
		const pending = this.pending.get(frame.id);
		if (!pending) return;
		this.pending.delete(frame.id);
		const response = frame as unknown as GatewayResponse;
		if (response.error) pending.reject(new GatewayRpcError(response.error));
		else pending.resolve(response.result);
	}

	private handleClose(reason: string): void {
		if (this.closed) return;
		this.closed = true;
		for (const pending of this.pending.values())
			pending.reject(new Error(reason));
		this.pending.clear();
		for (const listener of this.closeListeners) listener(reason);
	}
}

export function initialEventCursor(): string {
	return btoa(JSON.stringify({ v: 1, lastSequence: -1 }))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");
}

export function validateRemoteUrl(value: string, allowInsecure: boolean): URL {
	const url = new URL(value);
	if (url.protocol !== "ws:" && url.protocol !== "wss:") {
		throw new Error("Gateway URLs must use ws:// or wss://");
	}
	const loopback = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(
		url.hostname,
	);
	if (url.protocol === "ws:" && !loopback && !allowInsecure) {
		throw new Error(
			"Use wss:// for remote Gateways, or enable insecure development mode",
		);
	}
	if (url.username || url.password || url.search || url.hash) {
		throw new Error(
			"Credentials and query parameters are not allowed in Gateway URLs",
		);
	}
	return url;
}

function waitForOpen(
	socket: WebSocket,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<void> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = (callback: () => void) => {
			if (settled) return;
			settled = true;
			cleanup();
			callback();
		};
		const onOpen = () => finish(resolve);
		const onError = () =>
			finish(() => reject(new Error("Cannot reach the Gateway")));
		const onClose = () =>
			finish(() => reject(new Error("Gateway connection closed")));
		const onAbort = () =>
			finish(() => reject(new DOMException("Connection canceled", "AbortError")));
		const timeout = globalThis.setTimeout(
			() =>
				finish(() => reject(new Error("Timed out connecting to the Gateway"))),
			timeoutMs,
		);
		const cleanup = () => {
			globalThis.clearTimeout(timeout);
			socket.removeEventListener("open", onOpen);
			socket.removeEventListener("error", onError);
			socket.removeEventListener("close", onClose);
			signal?.removeEventListener("abort", onAbort);
		};
		socket.addEventListener("open", onOpen);
		socket.addEventListener("error", onError);
		socket.addEventListener("close", onClose);
		signal?.addEventListener("abort", onAbort, { once: true });
		if (signal?.aborted) onAbort();
	});
}

function handshake(
	socket: WebSocket,
	options: BrowserGatewayClientOptions,
): Promise<GatewayHello> {
	return new Promise((resolve, reject) => {
		const id = "hello_1";
		let settled = false;
		const finish = (callback: () => void) => {
			if (settled) return;
			settled = true;
			cleanup();
			callback();
		};
		const onAbort = () =>
			finish(() => reject(new DOMException("Connection canceled", "AbortError")));
		const onClose = () =>
			finish(() => reject(new Error("Gateway connection closed")));
		const onError = () =>
			finish(() => reject(new Error("Cannot authenticate with the Gateway")));
		const timeout = globalThis.setTimeout(
			() =>
				finish(() => reject(new Error("Timed out authenticating with the Gateway"))),
			options.connectTimeoutMs ?? 5_000,
		);
		const cleanup = () => {
			globalThis.clearTimeout(timeout);
			socket.removeEventListener("message", onMessage);
			socket.removeEventListener("close", onClose);
			socket.removeEventListener("error", onError);
			options.signal?.removeEventListener("abort", onAbort);
		};
		const onMessage = async (event: MessageEvent) => {
			const text =
				typeof event.data === "string" ? event.data : await event.data.text();
			for (const line of text.split("\n")) {
				if (!line.trim()) continue;
				const response = JSON.parse(line) as GatewayResponse;
				if (response.id !== id) continue;
				if (response.error)
					finish(() => reject(new GatewayRpcError(response.error!)));
				else finish(() => resolve(response.result as GatewayHello));
				return;
			}
		};
		socket.addEventListener("message", onMessage);
		socket.addEventListener("close", onClose);
		socket.addEventListener("error", onError);
		options.signal?.addEventListener("abort", onAbort, { once: true });
		if (options.signal?.aborted) {
			onAbort();
			return;
		}
		socket.send(
			`${JSON.stringify({
				version: 1,
				id,
				method: "gateway.hello",
				params: {
					protocolVersions: [1],
					client: {
						name: "cline-gateway-web",
						version: "0.1.0",
						...(options.clientId ? { clientId: options.clientId } : {}),
					},
					auth: options.auth,
				},
			})}\n`,
		);
	});
}
