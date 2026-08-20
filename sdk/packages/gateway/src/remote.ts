/** Remote WebSocket listener for Gateway clients (Phase 7). */

import {
	createServer as createHttpsServer,
	type Server as HttpsServer,
} from "node:https";
import { isIP } from "node:net";
import type { Duplex } from "node:stream";
import { createWebSocketStream, type WebSocket, WebSocketServer } from "ws";

export interface GatewayTlsOptions {
	readonly cert: string | Buffer;
	readonly key: string | Buffer;
	readonly ca?: string | Buffer;
}

export interface GatewayRemoteOptions {
	/** Public bind address. Defaults to 127.0.0.1 for safe development. */
	readonly host?: string;
	/** 0 selects an ephemeral port. */
	readonly port: number;
	/** Remote credential, deliberately distinct from local discovery auth. */
	readonly accessToken: string;
	/** Providing TLS creates a wss:// listener. */
	readonly tls?: GatewayTlsOptions;
	/** Required to bind plaintext ws:// beyond loopback. */
	readonly allowInsecure?: boolean;
	/** Bound unauthenticated-upgrade lifetime. Defaults to 10 seconds. */
	readonly handshakeTimeoutMs?: number;
	/** Hard cap for concurrently attached remote clients. Defaults to 128. */
	readonly maxConnections?: number;
}

export interface GatewayRemoteAddress {
	readonly url: string;
	readonly host: string;
	readonly port: number;
	readonly secure: boolean;
}

export function isLoopbackHost(host: string): boolean {
	if (host === "localhost" || host === "::1") return true;
	return isIP(host) === 4 && host.startsWith("127.");
}

export function validateRemoteOptions(options: GatewayRemoteOptions): void {
	const host = options.host ?? "127.0.0.1";
	if (Buffer.byteLength(options.accessToken, "utf8") < 32) {
		throw new Error("Remote Gateway access tokens must be at least 32 bytes");
	}
	if (
		options.handshakeTimeoutMs !== undefined &&
		(!Number.isFinite(options.handshakeTimeoutMs) ||
			options.handshakeTimeoutMs <= 0)
	) {
		throw new Error("Remote Gateway handshake timeout must be positive");
	}
	if (
		options.maxConnections !== undefined &&
		(!Number.isInteger(options.maxConnections) || options.maxConnections <= 0)
	) {
		throw new Error(
			"Remote Gateway max connections must be a positive integer",
		);
	}
	if (!options.tls && !isLoopbackHost(host) && !options.allowInsecure) {
		throw new Error(
			"Remote Gateway requires TLS outside loopback; set tls or explicitly allow insecure development",
		);
	}
}

export class GatewayRemoteListener {
	private readonly webSocketServer: WebSocketServer;
	private readonly httpsServer: HttpsServer | undefined;
	private listeningAddress: GatewayRemoteAddress | undefined;

	private constructor(
		webSocketServer: WebSocketServer,
		httpsServer: HttpsServer | undefined,
	) {
		this.webSocketServer = webSocketServer;
		this.httpsServer = httpsServer;
	}

	static async start(
		options: GatewayRemoteOptions,
		onConnection: (stream: Duplex) => void,
	): Promise<GatewayRemoteListener> {
		validateRemoteOptions(options);
		const host = options.host ?? "127.0.0.1";
		let httpsServer: HttpsServer | undefined;
		let webSocketServer: WebSocketServer;
		if (options.tls) {
			httpsServer = createHttpsServer(options.tls);
			webSocketServer = new WebSocketServer({ server: httpsServer });
		} else {
			webSocketServer = new WebSocketServer({ host, port: options.port });
		}
		webSocketServer.on("connection", (socket: WebSocket) => {
			onConnection(createWebSocketStream(socket, { encoding: "utf8" }));
		});
		if (httpsServer) await listen(httpsServer, host, options.port);
		else await onceListening(webSocketServer);
		const listener = new GatewayRemoteListener(webSocketServer, httpsServer);
		const address = (httpsServer ?? webSocketServer).address();
		if (address === null || typeof address === "string") {
			await listener.close();
			throw new Error("Remote Gateway bound to a non-TCP address");
		}
		listener.listeningAddress = {
			url: `${options.tls ? "wss" : "ws"}://${formatHost(host)}:${address.port}`,
			host,
			port: address.port,
			secure: Boolean(options.tls),
		};
		return listener;
	}

	address(): GatewayRemoteAddress {
		if (!this.listeningAddress)
			throw new Error("Remote Gateway is not listening");
		return this.listeningAddress;
	}

	async close(): Promise<void> {
		for (const client of this.webSocketServer.clients) client.terminate();
		await new Promise<void>((resolve) =>
			this.webSocketServer.close(() => resolve()),
		);
		if (this.httpsServer?.listening) {
			await new Promise<void>((resolve) =>
				this.httpsServer?.close(() => resolve()),
			);
		}
	}
}

function formatHost(host: string): string {
	return host.includes(":") ? `[${host}]` : host;
}

function listen(
	server: HttpsServer,
	host: string,
	port: number,
): Promise<void> {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen({ host, port }, () => {
			server.off("error", reject);
			resolve();
		});
	});
}

function onceListening(server: WebSocketServer): Promise<void> {
	return new Promise((resolve, reject) => {
		server.once("listening", resolve);
		server.once("error", reject);
	});
}
