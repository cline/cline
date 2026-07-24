import { connect, type Socket } from "node:net";
import { nanoid } from "nanoid";
import {
	type ComputerUseDisplayInfo,
	type ComputerUseRequest,
	type ComputerUseResponse,
	GET_DISPLAY_INFO_ACTION,
	isComputerUseResponse,
} from "./protocol";

function abortReasonToError(reason: unknown): Error {
	if (reason instanceof Error) {
		return reason;
	}
	if (typeof reason === "string" && reason.length > 0) {
		return new Error(reason);
	}
	return new Error("Computer-use request aborted");
}

export interface ComputerUseClientOptions {
	/** Backend host, defaults to loopback only. */
	host?: string;
	/** Backend TCP port. */
	port: number;
	/** Per-request timeout in milliseconds. */
	requestTimeoutMs?: number;
	/** Timeout for establishing the initial connection, in milliseconds. */
	connectTimeoutMs?: number;
	/**
	 * Observer for the action lifecycle. Every request produces exactly one
	 * `action_requested` followed by exactly one terminal event
	 * (`action_completed`, `action_failed`, or `action_cancelled`), all
	 * sharing the same `actionId`. Artifact recorders correlate clicks,
	 * results, and screenshots through this identity. Observer errors are
	 * swallowed: observation must never break the action path.
	 */
	observer?: ComputerUseClientObserver;
}

/** A single computer-use action's lifecycle, keyed by a stable `actionId`. */
export type ComputerUseClientEvent =
	| {
			type: "action_requested";
			actionId: string;
			request: ComputerUseRequest;
			at: number;
	  }
	| {
			type: "action_completed";
			actionId: string;
			response: ComputerUseResponse;
			durationMs: number;
			at: number;
	  }
	| {
			type: "action_failed";
			actionId: string;
			error: Error;
			durationMs: number;
			at: number;
	  }
	| {
			type: "action_cancelled";
			actionId: string;
			reason: string;
			durationMs: number;
			at: number;
	  };

export type ComputerUseClientObserver = (event: ComputerUseClientEvent) => void;

export interface ComputerUseSendOptions {
	/**
	 * Cancels waiting for the response. Cancellation removes the pending
	 * entry and rejects the returned promise, but an input event the backend
	 * has already accepted cannot be recalled — callers must treat the
	 * on-screen effect of a cancelled action as unknown until the next
	 * screenshot.
	 */
	signal?: AbortSignal;
	/**
	 * Correlation id recorded in observer events. When omitted the client
	 * generates one. Callers that pre-announce actions (e.g. artifact
	 * recorders linking a tool call to its screenshot) pass their own.
	 */
	actionId?: string;
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

	/**
	 * Sends a request and resolves with the matching response.
	 *
	 * When `options.signal` aborts, the returned promise rejects with the
	 * abort reason and the pending entry is removed — but the action may
	 * still execute on the backend (see `ComputerUseSendOptions.signal`).
	 */
	async send(
		request: Omit<ComputerUseRequest, "id">,
		options?: ComputerUseSendOptions,
	): Promise<ComputerUseResponse> {
		const actionId = options?.actionId ?? `act_${nanoid(10)}`;
		const startedAt = Date.now();
		const signal = options?.signal;

		if (signal?.aborted) {
			const error = abortReasonToError(signal.reason);
			this.notify({
				type: "action_cancelled",
				actionId,
				reason: error.message,
				durationMs: 0,
				at: startedAt,
			});
			throw error;
		}

		let socket: Socket;
		try {
			socket = await this.ensureConnected();
		} catch (error) {
			const normalized =
				error instanceof Error ? error : new Error(String(error));
			this.notify({
				type: "action_requested",
				actionId,
				request: { ...request, id: -1 },
				at: startedAt,
			});
			this.notify({
				type: "action_failed",
				actionId,
				error: normalized,
				durationMs: Date.now() - startedAt,
				at: Date.now(),
			});
			throw normalized;
		}

		const id = this.nextRequestId++;
		const fullRequest: ComputerUseRequest = { ...request, id };
		const line = `${JSON.stringify(fullRequest)}\n`;
		this.notify({
			type: "action_requested",
			actionId,
			request: fullRequest,
			at: startedAt,
		});

		const timeoutMs =
			this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
		return new Promise<ComputerUseResponse>((resolve, reject) => {
			// Single settle path: whichever outcome fires first (response,
			// failure, timeout, abort) clears the timer, detaches the abort
			// listener, removes the pending entry, and emits exactly one
			// terminal observer event. Later outcomes find `settled` and
			// do nothing.
			let settled = false;
			let onAbort: (() => void) | undefined;
			const cleanup = () => {
				clearTimeout(timeout);
				if (onAbort && signal) {
					signal.removeEventListener("abort", onAbort);
				}
				this.pending.delete(id);
			};
			const settleResolve = (response: ComputerUseResponse) => {
				if (settled) return;
				settled = true;
				cleanup();
				this.notify({
					type: "action_completed",
					actionId,
					response,
					durationMs: Date.now() - startedAt,
					at: Date.now(),
				});
				resolve(response);
			};
			const settleReject = (error: Error, cancelled = false) => {
				if (settled) return;
				settled = true;
				cleanup();
				this.notify(
					cancelled
						? {
								type: "action_cancelled",
								actionId,
								reason: error.message,
								durationMs: Date.now() - startedAt,
								at: Date.now(),
							}
						: {
								type: "action_failed",
								actionId,
								error,
								durationMs: Date.now() - startedAt,
								at: Date.now(),
							},
				);
				reject(error);
			};

			const timeout = setTimeout(() => {
				settleReject(
					new Error(
						`Computer-use request ${id} (${request.action}) timed out after ${timeoutMs}ms`,
					),
				);
			}, timeoutMs);

			if (signal) {
				onAbort = () => {
					settleReject(abortReasonToError(signal.reason), true);
				};
				signal.addEventListener("abort", onAbort, { once: true });
				// The signal may have aborted while ensureConnected() was
				// awaited above; an already-aborted signal never fires its
				// listener, so re-check after registration.
				if (signal.aborted) {
					onAbort();
				}
			}

			this.pending.set(id, {
				resolve: settleResolve,
				reject: settleReject,
				timeout,
			});

			socket.write(line, (error) => {
				if (error) {
					settleReject(error);
				}
			});
		});
	}

	private notify(event: ComputerUseClientEvent): void {
		try {
			this.options.observer?.(event);
		} catch {
			// Observation must never break the action path.
		}
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
				this.failAllPending(
					new Error("Computer-use backend connection closed"),
				);
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
