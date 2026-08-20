import type { DesktopTransportRequest } from "../webview/lib/desktop-transport";
import { handleCommand } from "./commands";
import {
	SIDECAR_HOST,
	SIDECAR_PORT,
	type SidecarContext,
	type SidecarSocket,
} from "./types";

const trustedOrigins = new Set([
	"tauri://localhost",
	"http://tauri.localhost",
	"https://tauri.localhost",
	"http://localhost:3125",
	"http://127.0.0.1:3125",
]);
for (const origin of process.env.CLINE_SIDECAR_TRUSTED_ORIGINS?.split(",") ??
	[]) {
	if (origin.trim()) trustedOrigins.add(origin.trim());
}

function authorized(request: Request): boolean {
	const expected = process.env.CLINE_SIDECAR_REMOTE_TOKEN?.trim();
	if (!expected) return true;
	const protocols =
		request.headers
			.get("sec-websocket-protocol")
			?.split(",")
			.map((value) => value.trim()) ?? [];
	const supplied = protocols
		.find((value) => value.startsWith("cline-auth."))
		?.slice("cline-auth.".length);
	if (!supplied || supplied.length !== expected.length) return false;
	return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

export function broadcast(
	ctx: SidecarContext,
	name: string,
	payload: unknown,
): void {
	const message = JSON.stringify({ type: "event", event: { name, payload } });
	for (const socket of ctx.sockets) socket.send(message);
}

export function startServer(ctx: SidecarContext): {
	port: number;
	stop(): void;
} {
	const server = Bun.serve<{ socket: SidecarSocket }>({
		hostname: SIDECAR_HOST,
		port: SIDECAR_PORT,
		fetch(request, server) {
			const url = new URL(request.url);
			const origin = request.headers.get("origin");
			if (url.pathname === "/health")
				return Response.json({ ok: true, mode: "gateway", pid: process.pid });
			if (
				url.pathname === "/transport" &&
				(!origin || trustedOrigins.has(origin)) &&
				authorized(request) &&
				server.upgrade(request, {
					data: { socket: undefined as never },
					headers: { "sec-websocket-protocol": "cline-desktop-v1" },
				})
			)
				return;
			return new Response("Not found", { status: 404 });
		},
		websocket: {
			open(socket) {
				socket.data.socket = socket;
				ctx.sockets.add(socket);
			},
			close(socket) {
				ctx.sockets.delete(socket);
			},
			async message(socket, raw) {
				let request: DesktopTransportRequest;
				try {
					request = JSON.parse(String(raw));
				} catch {
					return;
				}
				if (request.type !== "command") return;
				try {
					const result = await handleCommand(
						ctx,
						request.command,
						request.args,
					);
					socket.send(
						JSON.stringify({
							type: "response",
							id: request.id,
							ok: true,
							result,
						}),
					);
				} catch (error) {
					socket.send(
						JSON.stringify({
							type: "response",
							id: request.id,
							ok: false,
							error: error instanceof Error ? error.message : String(error),
						}),
					);
				}
			},
		},
	});
	return { port: server.port ?? SIDECAR_PORT, stop: () => server.stop() };
}

import { timingSafeEqual } from "node:crypto";
