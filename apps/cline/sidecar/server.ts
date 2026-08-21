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

const PAIRING_PIN_TTL_MS = 10 * 60 * 1000;
const PAIRING_PIN_MAX_ATTEMPTS = 5;

type PairingPinState = {
	pin: string;
	expiresAt: number;
	attemptsRemaining: number;
};

let pairingPin: PairingPinState | undefined;

export function isDesktopTransportPath(pathname: string): boolean {
	return pathname === "/";
}

function issuePairingPin(): void {
	const token = process.env.CLINE_SIDECAR_REMOTE_TOKEN?.trim();
	if (!token) return;
	const pin = crypto.randomInt(100000, 1000000).toString();
	pairingPin = {
		pin,
		expiresAt: Date.now() + PAIRING_PIN_TTL_MS,
		attemptsRemaining: PAIRING_PIN_MAX_ATTEMPTS,
	};
	console.log(
		`One-time pairing PIN (valid ${PAIRING_PIN_TTL_MS / 60000} min): ${pin}`,
	);
}

async function handlePairRequest(request: Request): Promise<Response> {
	if (!pairingPin) return new Response("Not found", { status: 404 });
	if (
		Date.now() > pairingPin.expiresAt ||
		pairingPin.attemptsRemaining <= 0
	) {
		pairingPin = undefined;
		return new Response("Gone", { status: 410 });
	}

	let body: { pin?: unknown };
	try {
		body = await request.json();
	} catch {
		return new Response("Bad request", { status: 400 });
	}
	const supplied = typeof body.pin === "string" ? body.pin : "";
	const matches =
		supplied.length === pairingPin.pin.length &&
		timingSafeEqual(Buffer.from(supplied), Buffer.from(pairingPin.pin));

	if (!matches) {
		pairingPin.attemptsRemaining -= 1;
		if (pairingPin.attemptsRemaining <= 0) pairingPin = undefined;
		return new Response("Unauthorized", { status: 401 });
	}

	const token = process.env.CLINE_SIDECAR_REMOTE_TOKEN?.trim() ?? "";
	pairingPin = undefined;
	return Response.json({ token });
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
	issuePairingPin();
	const server = Bun.serve<{ socket: SidecarSocket }>({
		hostname: SIDECAR_HOST,
		port: SIDECAR_PORT,
		fetch(request, server) {
			const url = new URL(request.url);
			const origin = request.headers.get("origin");
			if (url.pathname === "/health")
				return Response.json({ ok: true, mode: "gateway", pid: process.pid });
			if (url.pathname === "/pair" && request.method === "POST")
				return handlePairRequest(request);
			if (
				isDesktopTransportPath(url.pathname) &&
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

import * as crypto from "node:crypto";
import { timingSafeEqual } from "node:crypto";
