import { connect, type Socket } from "node:net";
import type {
	ComputerUseDisplayInfo,
	ComputerUseRequest,
	ComputerUseResponse,
} from "./protocol";
import { GET_DISPLAY_INFO_ACTION, isComputerUseResponse } from "./protocol";

export interface ComputerUseClientOptions {
	host?: string;
	port: number;
	requestTimeoutMs?: number;
	connectTimeoutMs?: number;
}

export interface ComputerUseSendOptions {
	signal?: AbortSignal;
	timeoutMs?: number;
}

interface PendingRequest {
	resolve(response: ComputerUseResponse): void;
	reject(error: Error): void;
	timeout: ReturnType<typeof setTimeout>;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 3_000;

function abortReasonToError(reason: unknown): Error {
	if (reason instanceof Error) return reason;
	if (typeof reason === "string" && reason) return new Error(reason);
	return new Error("Computer-use request cancelled");
}

export class ComputerUseClient {
	private socket: Socket | undefined;
	private connectPromise: Promise<Socket> | undefined;
	private buffer = "";
	private nextRequestId = 1;
	private readonly pending = new Map<number, PendingRequest>();

	constructor(private readonly options: ComputerUseClientOptions) {}

	async send(
		request: Omit<ComputerUseRequest, "id">,
		options: ComputerUseSendOptions = {},
	): Promise<ComputerUseResponse> {
		if (options.signal?.aborted)
			throw abortReasonToError(options.signal.reason);
		const socket = await this.ensureConnected();
		if (options.signal?.aborted)
			throw abortReasonToError(options.signal.reason);

		const id = this.nextRequestId++;
		const fullRequest: ComputerUseRequest = { ...request, id };
		const timeoutMs =
			options.timeoutMs ??
			this.options.requestTimeoutMs ??
			DEFAULT_REQUEST_TIMEOUT_MS;
		// A promoted job has no host RPC keeping the sandbox alive. Keep Node alive
		// while qbt owes us a response, then make the idle connection non-owning.
		socket.ref();

		return await new Promise<ComputerUseResponse>((resolve, reject) => {
			let settled = false;
			let onAbort: (() => void) | undefined;
			const cleanup = () => {
				clearTimeout(timeout);
				if (onAbort && options.signal) {
					options.signal.removeEventListener("abort", onAbort);
				}
				this.pending.delete(id);
				if (this.pending.size === 0) socket.unref();
			};
			const settleResolve = (response: ComputerUseResponse) => {
				if (settled) return;
				settled = true;
				cleanup();
				resolve(response);
			};
			const settleReject = (error: Error) => {
				if (settled) return;
				settled = true;
				cleanup();
				reject(error);
			};
			const timeout = setTimeout(
				() =>
					settleReject(
						new Error(
							`Computer-use request ${id} (${request.action}) timed out after ${timeoutMs}ms`,
						),
					),
				timeoutMs,
			);
			if (options.signal) {
				onAbort = () =>
					settleReject(abortReasonToError(options.signal?.reason));
				options.signal.addEventListener("abort", onAbort, { once: true });
				if (options.signal.aborted) {
					onAbort();
					return;
				}
			}
			this.pending.set(id, {
				resolve: settleResolve,
				reject: settleReject,
				timeout,
			});
			socket.write(`${JSON.stringify(fullRequest)}\n`, (error) => {
				if (error) settleReject(error);
			});
		});
	}

	async getDisplayInfo(timeoutMs = 3_000): Promise<ComputerUseDisplayInfo> {
		const response = await this.send(
			{ action: GET_DISPLAY_INFO_ACTION },
			{ timeoutMs },
		);
		if (!response.ok || !response.display) {
			throw new Error(
				response.error ?? "Computer-use backend did not return display info",
			);
		}
		return response.display;
	}

	get isConnected(): boolean {
		return !!this.socket && !this.socket.destroyed && !this.socket.connecting;
	}

	close(): void {
		this.socket?.destroy();
		this.socket = undefined;
		this.connectPromise = undefined;
		this.failAllPending(new Error("Computer-use client closed"));
	}

	private async ensureConnected(): Promise<Socket> {
		if (this.socket && !this.socket.destroyed) return this.socket;
		this.connectPromise ??= this.connectSocket();
		return await this.connectPromise;
	}

	private connectSocket(): Promise<Socket> {
		const host = this.options.host ?? "127.0.0.1";
		const port = this.options.port;
		const connectTimeoutMs =
			this.options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
		return new Promise<Socket>((resolve, reject) => {
			const socket = connect({ host, port });
			const timeout = setTimeout(() => {
				socket.destroy();
				reject(
					new Error(
						`Timed out connecting to computer-use backend at ${host}:${port}`,
					),
				);
			}, connectTimeoutMs);
			socket.once("connect", () => {
				clearTimeout(timeout);
				this.socket = socket;
				this.buffer = "";
				socket.unref();
				resolve(socket);
			});
			socket.once("error", (error) => {
				clearTimeout(timeout);
				this.connectPromise = undefined;
				this.failAllPending(error);
				reject(error);
			});
			socket.once("close", () => {
				this.socket = undefined;
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
		let newline = this.buffer.indexOf("\n");
		while (newline >= 0) {
			const line = this.buffer.slice(0, newline).trim();
			this.buffer = this.buffer.slice(newline + 1);
			if (line) this.handleLine(line);
			newline = this.buffer.indexOf("\n");
		}
	}

	private handleLine(line: string): void {
		let response: unknown;
		try {
			response = JSON.parse(line);
		} catch {
			return;
		}
		if (!isComputerUseResponse(response)) return;
		this.pending.get(response.id)?.resolve(response);
	}

	private failAllPending(error: Error): void {
		for (const pending of [...this.pending.values()]) pending.reject(error);
	}
}
