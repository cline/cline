import { existsSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { MAX_TEXT_FRAME } from "@cline/device";
import { AVATAR_ROOT, WEB_ROOT as SDK_WEB_ROOT } from "@cline/device/assets";
import { WebSocketServer } from "ws";
import type { DeviceBridge, DeviceSocket } from "./bridge";
import type { DeviceServiceStatus } from "./status";
/** Package resources for Node installs, adjacent resources for compiled CLI builds. */
export const WEB_ROOT =
	[
		process.env.CLINE_DEVICE_WEB_ROOT,
		join(dirname(process.execPath), "cline-hub/device-web"),
		process.argv[1]
			? join(dirname(resolve(process.argv[1])), "cline-hub/device-web")
			: undefined,
		SDK_WEB_ROOT,
	].find((root): root is string =>
		Boolean(root && existsSync(join(root, "index.html"))),
	) ?? SDK_WEB_ROOT;

const CONTENT_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".gif": "image/gif",
	".png": "image/png",
	".webp": "image/webp",
	".svg": "image/svg+xml",
	".json": "application/json",
	".webmanifest": "application/manifest+json",
};
/** Serve the SDK browser UI and avatar mount, refusing traversal. */
export function resolveWebFile(
	pathname: string,
	root = WEB_ROOT,
	avatarRoot = existsSync(join(root, "avatars"))
		? join(root, "avatars")
		: AVATAR_ROOT,
): string | undefined {
	let decoded: string;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		return undefined;
	}
	const relative = normalize(decoded === "/" ? "/index.html" : decoded).replace(
		/^[/\\]+/,
		"",
	);
	const base = relative.startsWith("avatars/") ? avatarRoot : root;
	const asset = relative.startsWith("avatars/")
		? relative.slice("avatars/".length)
		: relative;
	const file = resolve(base, asset);
	if (!file.startsWith(resolve(base) + "/")) return undefined;
	if (!existsSync(file) || !statSync(file).isFile()) return undefined;
	return file;
}
export interface DeviceServer {
	port: number;
	stop(): Promise<void>;
}
export async function startDeviceServer(options: {
	bridge: DeviceBridge;
	port: number;
	hostname: string;
	tls?: { cert: string; key: string };
	web?: boolean;
	webRoot?: string;
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
		if (options.web && req.method === "GET") {
			const file = resolveWebFile(url.pathname, options.webRoot);
			if (file) {
				res.writeHead(200, {
					"content-type":
						CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
					"cache-control": "no-cache",
				});
				res.end(readFileSync(file));
				return;
			}
		}
		res.writeHead(url.pathname === "/device" ? 426 : 404);
		res.end("not found");
	};
	const server = options.tls
		? https.createServer(
				{
					cert: readFileSync(options.tls.cert),
					key: readFileSync(options.tls.key),
				},
				handler,
			)
		: http.createServer(handler);
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
