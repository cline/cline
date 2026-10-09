import { existsSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_TEXT_FRAME } from "@cline/device";
import { AVATAR_ROOT } from "@cline/device/assets";
import type { Server } from "bun";
import type { DeviceBridge, DeviceSocketData } from "./bridge";
import type { DeviceBridgeStatus } from "./status";

const MAX_FRAME_BYTES = 8 * 1024;

/** The browser device (apps/device-bridge/web), served at `/`. */
export const WEB_ROOT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"web",
);

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

/** Serve the host UI and SDK avatar mount, refusing traversal. */
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

export function startDeviceServer(options: {
	bridge: DeviceBridge;
	port: number;
	hostname: string;
	/** Serve over HTTPS/WSS (browsers only allow the mic on secure origins). */
	tls?: { cert: string; key: string };
	/** Serve the browser device from WEB_ROOT. */
	web?: boolean;
	webRoot?: string;
	status?: () => DeviceBridgeStatus;
}): Server<DeviceSocketData> {
	const { bridge } = options;
	return Bun.serve<DeviceSocketData>({
		port: options.port,
		hostname: options.hostname,
		...(options.tls ? { tls: options.tls } : {}),
		fetch(req, server) {
			const url = new URL(req.url);
			if (url.pathname === "/health")
				return Response.json({ ok: true, v: 1, ...options.status?.() });
			if (url.pathname === "/device") {
				if (server.upgrade(req, { data: { authed: false } })) return undefined;
				return new Response("expected a WebSocket upgrade", { status: 426 });
			}
			if (options.web && req.method === "GET") {
				const file = resolveWebFile(url.pathname, options.webRoot ?? WEB_ROOT);
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
