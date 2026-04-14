import type { DesktopTransportRequest } from "../lib/desktop-transport";
import { handleCommand } from "./commands";
import { sendEvent } from "./context";
import {
	BunRuntime,
	SIDECAR_MODE,
	SIDECAR_PORT,
	type SidecarContext,
} from "./types";

// ---------------------------------------------------------------------------
// JSON response helper
// ---------------------------------------------------------------------------

function jsonResponse(
	id: string,
	ok: boolean,
	result?: unknown,
	error?: string,
): string {
	return JSON.stringify({ type: "response", id, ok, result, error });
}

// ---------------------------------------------------------------------------
// Bun HTTP + WebSocket server
// ---------------------------------------------------------------------------

export function startServer(
	ctx: SidecarContext,
	preferredPort: number = SIDECAR_PORT,
): { port: number } {
	if (!BunRuntime) {
		throw new Error("sidecar must be run with Bun");
	}

	let server: any;
	let lastError: unknown;

	// Try the preferred port first, then fall back to OS-assigned port (0).
	const candidates = [preferredPort, 0];
	for (const candidate of candidates) {
		try {
			server = BunRuntime.serve({
				hostname: "127.0.0.1",
				port: candidate,
				fetch: createFetchHandler(ctx),
				websocket: createWebSocketHandler(ctx),
			});
			break;
		} catch (error) {
			lastError = error;
		}
	}

	if (!server) {
		throw lastError ?? new Error("Failed to start sidecar server");
	}

	return { port: server.port };
}

function createFetchHandler(_ctx: SidecarContext) {
	return (req: Request, server: any) => {
		const url = new URL(req.url);

		if (url.pathname === "/health") {
			return new Response(
				JSON.stringify({
					ok: true,
					mode: SIDECAR_MODE,
					pid: process.pid,
				}),
				{ headers: { "content-type": "application/json" } },
			);
		}

		if (url.pathname === "/transport" && server.upgrade(req)) {
			return undefined;
		}

		return new Response("Not found", { status: 404 });
	};
}

function createWebSocketHandler(ctx: SidecarContext) {
	return {
		open(ws: any) {
			ctx.wsClients.add(ws);
			sendEvent(ctx, "host_ready", {
				pid: process.pid,
				mode: SIDECAR_MODE,
			});
		},
		async message(ws: any, raw: string) {
			let request: DesktopTransportRequest;
			try {
				request = JSON.parse(String(raw)) as DesktopTransportRequest;
			} catch {
				ws.send(
					jsonResponse(
						"",
						false,
						undefined,
						"invalid desktop transport payload",
					),
				);
				return;
			}
			try {
				const result = await handleCommand(ctx, request.command, request.args);
				ws.send(jsonResponse(request.id, true, result));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ws.send(jsonResponse(request.id, false, undefined, message));
			}
		},
		close(ws: any) {
			ctx.wsClients.delete(ws);
		},
	};
}
