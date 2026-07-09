import { type Socket, connect } from "node:net";
import {
	type ComputerUseDisplayInfo,
	GET_DISPLAY_INFO_ACTION,
	type ComputerUseRequest,
	type ComputerUseResponse,
	isComputerUseResponse,
} from "./protocol";

export interface ComputerUseClientOptions {
	/** Backend host, defaults to loopback only. */
	host?: string;
	/** Backend TCP port. */
	port: number;
	/** Per-request timeout in milliseconds. */
	requestTimeoutMs?: number;
	/** Timeout for establishing the initial connection, in milliseconds. */
	connectTimeoutMs?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 3_000;

interface PendingRequest {
	resolve: (response: ComputerUseResponse) => void;
	reject: (error: Error) => void;
	timeout: ReturnType<typeof setTimeout>;
}

/**
 * Minimal client for the computer-use backend's JSON-L-over-TCP protocol.
 *
 * Deliberately lightweight: no reconnect/backoff policy, no multiplexed
 * transport negotiation, no schema registry. Connects lazily on first use,
 * reuses the connection across calls, and reconnects on the next call after
 * a disconnect. See ./protocol.ts for the wire format and the rationale for
 * not using MCP here.
 */
export class ComputerUseClient {
	private socket: Socket | undefined;
	private connectPromise: Promise<Socket> | undefined;
	private buffer = "";
	private nextRequestId = 1;
	private readonly pending = new Map<number, PendingRequest>();

	constructor(private readonly options: ComputerUseClientOptions) {}

	/** Sends a request and resolves with the matching response. */
	async send(
		request: Omit<ComputerUseRequest, "id">,
	): Promise<ComputerUseResponse> {
		const socket = await this.ensureConnected();
		const id = this.nextRequestId++;
		const fullRequest: ComputerUseRequest = { ...request, id };
		const line = `${JSON.stringify(fullRequest)}\n`;

		const timeoutMs = this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
		return new Promise<ComputerUseResponse>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(id);
				reject(
					new Error(
						`Computer-use request ${id} (${request.action}) timed out after ${timeoutMs}ms`,
					),
				);
			}, timeoutMs);

			this.pending.set(id, { resolve, reject, timeout });

			socket.write(line, (error) => {
				if (error) {
					this.pending.delete(id);
					clearTimeout(timeout);
					reject(error);
				}
			});
		});
	}

	/**
	 * Queries the backend for the native display dimensions. This is not one
	 * of Anthropic's `computer` tool actions — it's a one-time startup query
	 * used to build the tool's description/schema with real values instead
	 * of guessed defaults, since the tool's definition is static once built.
	 */
	async getDisplayInfo(): Promise<ComputerUseDisplayInfo> {
		const response = await this.send({ action: GET_DISPLAY_INFO_ACTION });
		if (!response.ok || !response.display) {
			throw new Error(
				response.error ?? "Computer-use backend did not return display info",
			);
		}
		return response.display;
	}

	/** Closes the underlying socket, if any. Safe to call multiple times. */
	close(): void {
		this.socket?.destroy();
		this.socket = undefined;
		this.connectPromise = undefined;
		this.failAllPending(new Error("Computer-use client closed"));
	}

	private async ensureConnected(): Promise<Socket> {
		if (this.socket && !this.socket.destroyed) {
			return this.socket;
		}
		if (!this.connectPromise) {
			this.connectPromise = this.connectSocket();
		}
		return this.connectPromise;
	}

	private connectSocket(): Promise<Socket> {
		const host = this.options.host ?? "127.0.0.1";
		const port = this.options.port;
		const connectTimeoutMs =
			this.options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;

		return new Promise<Socket>((resolve, reject) => {
			const socket = connect({ host, port });
			const onConnectTimeout = setTimeout(() => {
				socket.destroy();
				reject(
					new Error(
						`Timed out connecting to computer-use backend at ${host}:${port}`,
					),
				);
			}, connectTimeoutMs);

			socket.once("connect", () => {
				clearTimeout(onConnectTimeout);
				this.socket = socket;
				this.buffer = "";
				// Don't let an idle backend connection keep the host process
				// alive on its own; the socket is reference-counted back in
				// while a request is in flight via the write/response cycle.
				socket.unref();
				resolve(socket);
			});

			socket.once("error", (error) => {
				clearTimeout(onConnectTimeout);
				this.connectPromise = undefined;
				this.failAllPending(error);
				reject(error);
			});

			socket.once("close", () => {
				this.connectPromise = undefined;
				this.failAllPending(new Error("Computer-use backend connection closed"));
			});

			socket.setEncoding("utf8");
			socket.on("data", (chunk: string) => this.onData(chunk));
		});
	}

	private onData(chunk: string): void {
		this.buffer += chunk;
		let newlineIndex = this.buffer.indexOf("\n");
		while (newlineIndex >= 0) {
			const line = this.buffer.slice(0, newlineIndex).trim();
			this.buffer = this.buffer.slice(newlineIndex + 1);
			if (line.length > 0) {
				this.handleLine(line);
			}
			newlineIndex = this.buffer.indexOf("\n");
		}
	}

	private handleLine(line: string): void {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			// Malformed line from the backend; ignore rather than crash the
			// connection, since this is best-effort POC plumbing.
			return;
		}
		if (!isComputerUseResponse(parsed)) {
			return;
		}
		const pending = this.pending.get(parsed.id);
		if (!pending) {
			return;
		}
		this.pending.delete(parsed.id);
		clearTimeout(pending.timeout);
		pending.resolve(parsed);
	}

	private failAllPending(error: Error): void {
		for (const [id, pending] of this.pending) {
			clearTimeout(pending.timeout);
			pending.reject(error);
			this.pending.delete(id);
		}
	}
}
