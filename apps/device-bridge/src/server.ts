import { existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import type { Server } from "bun";
import type { DeviceBridge, DeviceSocketData } from "./bridge";
import { MAX_TEXT_FRAME } from "./protocol";

const MAX_FRAME_BYTES = 8 * 1024;

/** The browser pet (apps/device-bridge/web), served at `/`. */
export const WEB_ROOT = resolve(import.meta.dir, "..", "web");

const CONTENT_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".gif": "image/gif",
	".png": "image/png",
	".svg": "image/svg+xml",
	".json": "application/json",
	".webmanifest": "application/manifest+json",
};

/** Resolve a URL path to a file under WEB_ROOT, refusing traversal. */
export function resolveWebFile(
	pathname: string,
	root = WEB_ROOT,
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
	const file = join(root, relative);
	if (!file.startsWith(root + "/") && file !== root) return undefined;
	if (!existsSync(file) || !statSync(file).isFile()) return undefined;
	return file;
}

export function startDeviceServer(options: {
	bridge: DeviceBridge;
	port: number;
	hostname: string;
	/** Serve over HTTPS/WSS (browsers only allow the mic on secure origins). */
	tls?: { cert: string; key: string };
	/** Serve the browser pet from WEB_ROOT. */
	web?: boolean;
}): Server<DeviceSocketData> {
	const { bridge } = options;
	return Bun.serve<DeviceSocketData>({
		port: options.port,
		hostname: options.hostname,
		...(options.tls ? { tls: options.tls } : {}),
		fetch(req, server) {
			const url = new URL(req.url);
			if (url.pathname === "/health") return Response.json({ ok: true, v: 1 });
			if (url.pathname === "/device") {
				if (server.upgrade(req, { data: { authed: false } })) return undefined;
				return new Response("expected a WebSocket upgrade", { status: 426 });
			}
			if (options.web && req.method === "GET") {
				const file = resolveWebFile(url.pathname);
				if (file) {
					return new Response(Bun.file(file), {
						headers: {
							"content-type":
								CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
							"cache-control": "no-cache",
						},
					});
				}
			}
			return new Response("not found", { status: 404 });
		},
		websocket: {
			maxPayloadLength: Math.max(MAX_TEXT_FRAME, MAX_FRAME_BYTES),
			idleTimeout: 120,
			sendPings: true,
			open: (ws) => bridge.onOpen(ws),
			close: (ws) => bridge.onClose(ws),
			message: (ws, message) => bridge.onMessage(ws, message),
		},
	});
}
