/** Browser WebSocket boundary for the loopback-only Gateway protocol. */

import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { connect, type Socket } from "node:net";
import { GATEWAY_HELLO_METHOD } from "@cline/shared/gateway";
import { WebSocket, WebSocketServer } from "ws";
import { readDiscoveryRecord } from "./discovery";
import { resolveGatewayPaths, type GatewayPathsOptions } from "./paths";

export const DEFAULT_GATEWAY_WEBSOCKET_BRIDGE_PORT = 18_080;
export const MAX_GATEWAY_WEBSOCKET_FRAME_BYTES = 1024 * 1024;

export interface GatewayWebSocketBridgeOptions extends GatewayPathsOptions {
	host?: string;
	port?: number;
	allowedOrigins: readonly string[];
}

function tokensEqual(actual: string, expected: string): boolean {
	const left = Buffer.from(actual);
	const right = Buffer.from(expected);
	return left.length === right.length && timingSafeEqual(left, right);
}

function helloAuth(raw: string): string | undefined {
	try {
		const value = JSON.parse(raw) as { method?: unknown; params?: { auth?: unknown } };
		return value.method === GATEWAY_HELLO_METHOD && typeof value.params?.auth === "string"
			? value.params.auth
			: undefined;
	} catch {
		return undefined;
	}
}

export async function startGatewayWebSocketBridge(options: GatewayWebSocketBridgeOptions) {
	const host = options.host ?? "127.0.0.1";
	const requestedPort = options.port ?? DEFAULT_GATEWAY_WEBSOCKET_BRIDGE_PORT;
	const allowedOrigins = new Set(options.allowedOrigins);
	const discoveryFile = resolveGatewayPaths(options).discoveryFile;
	const upstreams = new Map<WebSocket, Socket>();
	const server = createServer((request, response) => {
		if (request.url !== "/health") {
			response.writeHead(404).end("Not found");
			return;
		}
		const discovery = readDiscoveryRecord(discoveryFile);
		response.writeHead(discovery ? 200 : 503, { "content-type": "application/json" });
		response.end(JSON.stringify({ ok: Boolean(discovery), gateway: discovery ? "discovered" : "unavailable" }));
	});
	const websocketServer = new WebSocketServer({ noServer: true, maxPayload: MAX_GATEWAY_WEBSOCKET_FRAME_BYTES });
	server.on("upgrade", (request, socket, head) => {
		const origin = request.headers.origin;
		if (request.url !== "/" || (origin && !allowedOrigins.has(origin))) {
			socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
			socket.destroy();
			return;
		}
		websocketServer.handleUpgrade(request, socket, head, (websocket) => websocketServer.emit("connection", websocket, request));
	});
	websocketServer.on("connection", (websocket) => {
		let authenticated = false;
		let upstreamBuffer = "";
		websocket.on("message", (data, isBinary) => {
			if (isBinary) {
				websocket.close(1003, "Text frames required");
				return;
			}
			const message = data.toString("utf8");
			if (!authenticated) {
				const discovery = readDiscoveryRecord(discoveryFile);
				const auth = helloAuth(message);
				if (!discovery || !auth || !tokensEqual(auth, discovery.auth)) {
					websocket.close(1008, "Unauthorized");
					return;
				}
				const upstream = connect({ host: discovery.host, port: discovery.port });
				upstreams.set(websocket, upstream);
				authenticated = true;
				upstream.setEncoding("utf8");
				upstream.on("connect", () => upstream.write(`${message}\n`));
				upstream.on("data", (chunk: string) => {
					upstreamBuffer += chunk;
					for (;;) {
						const newline = upstreamBuffer.indexOf("\n");
						if (newline < 0) break;
						const line = upstreamBuffer.slice(0, newline).trim();
						upstreamBuffer = upstreamBuffer.slice(newline + 1);
						if (line && websocket.readyState === WebSocket.OPEN) websocket.send(line);
					}
				});
				upstream.on("error", () => websocket.close(1011, "Gateway unavailable"));
				upstream.on("close", () => websocket.close(1012, "Gateway disconnected"));
				return;
			}
			upstreams.get(websocket)?.write(`${message}\n`);
		});
		websocket.on("close", () => {
			upstreams.get(websocket)?.destroy();
			upstreams.delete(websocket);
		});
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(requestedPort, host, () => {
			server.off("error", reject);
			resolve();
		});
	});
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Bridge did not bind TCP");
	return {
		host,
		port: address.port,
		async stop(): Promise<void> {
			for (const websocket of websocketServer.clients) websocket.close(1001, "Bridge stopping");
			for (const upstream of upstreams.values()) upstream.destroy();
			websocketServer.close();
			await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
		},
	};
}
