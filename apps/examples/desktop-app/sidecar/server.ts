import type { DesktopTransportRequest } from "../webview/lib/desktop-transport";
import { handleCommand } from "./commands";
import { sendEvent } from "./context";
import { fetchMarketplaceCatalog } from "./marketplace";
import {
	BunRuntime,
	SIDECAR_MODE,
	SIDECAR_PORT,
	type SidecarContext,
	type SidecarWebSocketClient,
} from "./types";

type SidecarServer = {
	port: number;
	upgrade(req: Request): boolean;
};

const JSON_HEADERS = {
	"access-control-allow-headers": "accept, content-type",
	"access-control-allow-methods": "GET, POST, OPTIONS",
	"access-control-allow-origin": "*",
	"content-type": "application/json",
};

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

function createJsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: JSON_HEADERS,
	});
}

const EMPTY_MARKETPLACE_CATALOG = {
	version: 1,
	counts: {
		total: 0,
		plugins: 0,
		skills: 0,
		mcps: 0,
	},
	tags: [],
	entries: [],
};

// ---------------------------------------------------------------------------
// Bun HTTP + WebSocket server
// ---------------------------------------------------------------------------

export function startServer(
	ctx: SidecarContext,
	preferredPort: number = SIDECAR_PORT,
	onShutdown?: (reason?: string) => Promise<void>,
): { port: number } {
	if (!BunRuntime) {
		throw new Error("sidecar must be run with Bun");
	}

	let server: SidecarServer | undefined;
	let lastError: unknown;

	// Try the preferred port first, then fall back to OS-assigned port (0).
	const candidates = [preferredPort, 0];
	for (const candidate of candidates) {
		try {
			server = BunRuntime.serve({
				hostname: "127.0.0.1",
				port: candidate,
				fetch: createFetchHandler(ctx, onShutdown),
				websocket: createWebSocketHandler(ctx),
			}) as SidecarServer;
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

function createFetchHandler(
	_ctx: SidecarContext,
	onShutdown?: (reason?: string) => Promise<void>,
) {
	return async (req: Request, server: SidecarServer) => {
		const url = new URL(req.url);

		if (req.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: JSON_HEADERS });
		}

		if (url.pathname === "/health") {
			return new Response(
				JSON.stringify({
					ok: true,
					mode: SIDECAR_MODE,
					pid: process.pid,
				}),
				{ headers: JSON_HEADERS },
			);
		}

		if (url.pathname === "/transport" && server.upgrade(req)) {
			return undefined;
		}

		if (url.pathname === "/api/marketplace/catalog") {
			try {
				return createJsonResponse(await fetchMarketplaceCatalog());
			} catch (error) {
				return createJsonResponse({
					...EMPTY_MARKETPLACE_CATALOG,
					error:
						error instanceof Error
							? error.message
							: "Failed to fetch marketplace catalog",
				});
			}
		}

		if (url.pathname === "/shutdown" && req.method === "POST") {
			queueMicrotask(() => {
				void onShutdown?.("code_sidecar_shutdown_endpoint")
					.catch((error) => {
						process.stderr.write(
							`sidecar shutdown failed: ${
								error instanceof Error ? error.message : String(error)
							}\n`,
						);
					})
					.finally(() => process.exit(0));
			});
			return new Response(JSON.stringify({ ok: true }), {
				headers: { "content-type": "application/json" },
			});
		}

		return new Response("Not found", { status: 404 });
	};
}

function createWebSocketHandler(ctx: SidecarContext) {
	return {
		open(ws: SidecarWebSocketClient) {
			ctx.wsClients.add(ws);
			sendEvent(ctx, "host_ready", {
				pid: process.pid,
				mode: SIDECAR_MODE,
			});
		},
		async message(ws: SidecarWebSocketClient, raw: string) {
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
		close(ws: SidecarWebSocketClient) {
			ctx.wsClients.delete(ws);
		},
	};
}
