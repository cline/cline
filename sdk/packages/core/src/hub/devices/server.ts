import http from "node:http";
import { MAX_TEXT_FRAME } from "@cline/device";
import { WebSocketServer } from "ws";
import type { DeviceBridge, DeviceSocket } from "./bridge";
import type { DeviceServiceStatus } from "./status";

export interface DeviceServer {
	port: number;
	stop(): Promise<void>;
}
export async function startDeviceServer(options: {
	bridge: DeviceBridge;
	port: number;
	hostname: string;
	status?: () => DeviceServiceStatus;
}): Promise<DeviceServer> {
	const handler: http.RequestListener = (req, res) => {
		let url: URL;
		try {
			url = new URL(req.url ?? "/", "http://localhost");
		} catch {
			res.writeHead(400);
			res.end();
			return;
		}
		if (url.pathname === "/health") {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ ok: true, v: 1, ...options.status?.() }));
			return;
		}
		res.writeHead(url.pathname === "/device" ? 426 : 404);
		res.end("not found");
	};
	const server = http.createServer(handler);
	const sockets = new WebSocketServer({
		noServer: true,
		maxPayload: Math.max(MAX_TEXT_FRAME, 8192),
	});
	server.on("upgrade", (req, socket, head) => {
		if (new URL(req.url ?? "/", "http://localhost").pathname !== "/device") {
			socket.destroy();
			return;
		}
		sockets.handleUpgrade(req, socket, head, (ws) => {
			const device: DeviceSocket = {
				data: { authed: false },
				send: (data) => ws.send(data),
				close: (code, reason) => ws.close(code, reason),
			};
			alive.set(ws, true);
			ws.on("pong", () => alive.set(ws, true));
			options.bridge.onOpen(device);
			ws.on(
				"message",
				(data, binary) =>
					void options.bridge.onMessage(
						device,
						binary ? Buffer.from(data as Buffer) : data.toString(),
					),
			);
			ws.on("close", () => options.bridge.onClose(device));
			ws.on("error", () => ws.terminate());
		});
	});
	try {
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(options.port, options.hostname, () => {
				server.removeListener("error", reject);
				resolve();
			});
		});
	} catch (error) {
		sockets.close();
		server.close();
		throw error;
	}
	const alive = new WeakMap<import("ws").WebSocket, boolean>();
	const heartbeat = setInterval(() => {
		for (const ws of sockets.clients) {
			if (alive.get(ws) === false) {
				ws.terminate();
				continue;
			}
			alive.set(ws, false);
			ws.ping();
		}
	}, 30000);
	heartbeat.unref();
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("Device server has no TCP address");
	let stopping: Promise<void> | undefined;
	return {
		port: address.port,
		stop: () =>
			(stopping ??= new Promise<void>((resolve, reject) => {
				clearInterval(heartbeat);
				for (const socket of sockets.clients) socket.terminate();
				sockets.close();
				server.close((error) => (error ? reject(error) : resolve()));
				server.closeAllConnections();
			})),
	};
}
