import {
	createSessionId,
	type HubCommandEnvelope,
	type HubReplyEnvelope,
	type HubTransportFrame,
	resolveHubCommandTimeoutMs,
} from "@cline/shared/browser";
import {
	type HubBrowserConnection,
	type HubCommandClient,
	HubCommandError,
	type HubCommandOptions,
} from "./command-client";

/** A registered browser connection. A dispatched request is never automatically replayed. */
export class BrowserHubClient implements HubCommandClient {
	private socket?: WebSocket;
	private connecting?: Promise<void>;
	private closed = false;
	private registered = false;
	private clientId = createSessionId("browser_");
	private pending = new Map<
		string,
		{
			resolve: (reply: HubReplyEnvelope) => void;
			reject: (error: Error) => void;
		}
	>();
	constructor(private resolveConnection: () => Promise<HubBrowserConnection>) {}
	connect(): Promise<void> {
		if (this.closed) return Promise.reject(new Error("Hub client is disposed"));
		if (this.registered && this.socket?.readyState === 1)
			return Promise.resolve();
		if (this.connecting) return this.connecting;
		const attempt = this.open();
		this.connecting = attempt;
		void attempt
			.finally(() => {
				if (this.connecting === attempt) this.connecting = undefined;
			})
			.catch(() => {});
		return attempt;
	}
	private async open() {
		const info = await this.resolveConnection();
		if (this.closed) throw new Error("Hub client is disposed");
		let url: URL;
		try {
			url = new URL(info.url);
		} catch {
			throw new Error("Invalid Hub connection bootstrap");
		}
		if (
			!["ws:", "wss:"].includes(url.protocol) ||
			url.username ||
			url.password ||
			url.search ||
			url.hash ||
			!/^[A-Za-z0-9_-]+$/.test(info.authToken)
		)
			throw new Error("Invalid Hub connection bootstrap");
		let socket: WebSocket;
		try {
			socket = new WebSocket(url.toString(), [
				`cline-hub-auth.${info.authToken}`,
			]);
		} catch {
			throw new Error("Hub connection could not be opened");
		}
		this.socket = socket;
		socket.addEventListener("message", (event) => {
			if (this.socket !== socket) return;
			try {
				const frame = JSON.parse(String(event.data)) as HubTransportFrame;
				if (frame.kind === "reply" && frame.envelope.requestId) {
					this.pending.get(frame.envelope.requestId)?.resolve(frame.envelope);
				}
			} catch {
				this.fail(socket, new Error("Invalid Hub response"));
				socket.close();
			}
		});
		socket.addEventListener("close", () =>
			this.fail(socket, new Error("Hub connection closed")),
		);
		socket.addEventListener("error", () => {
			this.fail(socket, new Error("Hub connection failed"));
			socket.close();
		});
		try {
			await new Promise<void>((resolve, reject) => {
				const timer = setTimeout(() => {
					reject(new Error("Hub connection timed out"));
					socket.close();
				}, 10_000);
				const open = () => {
					cleanup();
					resolve();
				};
				const fail = () => {
					cleanup();
					reject(new Error("Hub connection failed"));
				};
				const cleanup = () => {
					clearTimeout(timer);
					socket.removeEventListener("open", open);
					socket.removeEventListener("error", fail);
					socket.removeEventListener("close", fail);
				};
				socket.addEventListener("open", open, { once: true });
				socket.addEventListener("error", fail, { once: true });
				socket.addEventListener("close", fail, { once: true });
			});
			if (this.closed || this.socket !== socket)
				throw new Error("Hub connection closed during registration");
			const reply = await this.dispatch("client.register", {
				clientId: this.clientId,
				clientType: "desktop-webview",
				displayName: "Cline Desktop",
				transport: "browser",
				actorKind: "client",
				workspaceContext: {
					workspaceRoot: info.workspaceRoot,
					cwd: info.workspaceRoot,
				},
			});
			if (!reply.ok)
				throw new HubCommandError(
					"client.register",
					reply.error?.code,
					reply.error?.message ?? "Hub registration failed",
				);
			if (this.closed || this.socket !== socket)
				throw new Error("Hub connection closed during registration");
			this.registered = true;
		} catch (error) {
			this.fail(
				socket,
				error instanceof Error ? error : new Error("Hub connection failed"),
			);
			socket.close();
			throw error;
		}
	}
	private fail(socket: WebSocket, error: Error) {
		if (this.socket !== socket) return;
		this.registered = false;
		this.socket = undefined;
		for (const pending of this.pending.values()) pending.reject(error);
		this.pending.clear();
	}
	async command(
		command: HubCommandEnvelope["command"],
		payload?: Record<string, unknown>,
		sessionId?: string,
		options?: HubCommandOptions,
	) {
		await this.connect();
		return this.dispatch(command, payload, sessionId, options);
	}
	private dispatch(
		command: HubCommandEnvelope["command"],
		payload?: Record<string, unknown>,
		sessionId?: string,
		options?: HubCommandOptions,
	): Promise<HubReplyEnvelope> {
		const socket = this.socket;
		if (!socket || socket.readyState !== 1)
			return Promise.reject(new Error("Hub connection is unavailable"));
		options?.beforeDispatch?.();
		const requestId = createSessionId("browser_request_");
		const timeoutMs = resolveHubCommandTimeoutMs(command, options?.timeoutMs);
		return new Promise((resolve, reject) => {
			const settle = (error?: Error, reply?: HubReplyEnvelope) => {
				if (timer) clearTimeout(timer);
				this.pending.delete(requestId);
				if (error) reject(error);
				else if (reply) resolve(reply);
			};
			const timer =
				timeoutMs === null
					? undefined
					: setTimeout(
							() =>
								settle(
									new HubCommandError(
										command,
										"hub_command_timeout",
										`Hub command timed out: ${command}`,
									),
								),
							timeoutMs,
						);
			this.pending.set(requestId, {
				resolve: (reply) => settle(undefined, reply),
				reject: (error) => settle(error),
			});
			try {
				options?.onDispatch?.(requestId);
				socket.send(
					JSON.stringify({
						kind: "command",
						envelope: {
							version: "v1",
							clientId: this.clientId,
							requestId,
							command,
							payload,
							sessionId,
							timeoutMs,
						},
					}),
				);
			} catch {
				settle(new Error("Hub request could not be dispatched"));
			}
		});
	}
	async dispose() {
		if (this.closed) return;
		this.closed = true;
		const socket = this.socket;
		if (socket && this.registered)
			await this.dispatch("client.unregister", {}, undefined, {
				timeoutMs: 1000,
			}).catch(() => {});
		if (socket) {
			this.fail(socket, new Error("Hub client is disposed"));
			socket.close();
		}
	}
}
