import type { DesktopTransportRequest } from "../webview/lib/desktop-transport";
import { handleCommand } from "./commands";
import { sendEvent } from "./context";
import { fetchMarketplaceCatalog } from "./marketplace";
import {
	BunRuntime,
	SIDECAR_HOST,
	SIDECAR_MODE,
	SIDECAR_PORT,
	type SidecarContext,
	type SidecarWebSocketClient,
} from "./types";

type SidecarServer = {
	port: number;
	upgrade(req: Request): boolean;
};

// Comma-separated extra origins (e.g. a dev server on a nonstandard port when
// the sidecar runs inside a container). Origin validation itself stays on.
const EXTRA_TRUSTED_ORIGINS = (process.env.CLINE_SIDECAR_TRUSTED_ORIGINS ?? "")
	.split(",")
	.map((origin) => origin.trim())
	.filter(Boolean);

const TRUSTED_BROWSER_ORIGINS = new Set([
	"tauri://localhost",
	"http://tauri.localhost",
	"https://tauri.localhost",
	"http://localhost:3125",
	"http://127.0.0.1:3125",
	...EXTRA_TRUSTED_ORIGINS,
]);

const JSON_HEADERS = {
	"content-type": "application/json",
};

function readOrigin(req: Request): string | undefined {
	const origin = req.headers.get("origin")?.trim();
	return origin ? origin : undefined;
}

function isTrustedRequestOrigin(req: Request): boolean {
	const origin = readOrigin(req);
	return !origin || TRUSTED_BROWSER_ORIGINS.has(origin);
}

function corsHeaders(req: Request): Record<string, string> {
	const origin = readOrigin(req);
	return {
		"access-control-allow-headers": "accept, content-type",
		"access-control-allow-methods": "GET, POST, OPTIONS",
		...(origin && TRUSTED_BROWSER_ORIGINS.has(origin)
			? {
					"access-control-allow-origin": origin,
					vary: "Origin",
				}
			: {}),
	};
}

function jsonHeaders(req: Request): Record<string, string> {
	return {
		...JSON_HEADERS,
		...corsHeaders(req),
	};
}

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

function createJsonResponse(
	req: Request,
	body: unknown,
	status = 200,
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: jsonHeaders(req),
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
				hostname: SIDECAR_HOST,
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

export function createFetchHandler(
	ctx: SidecarContext,
	onShutdown?: (reason?: string) => Promise<void>,
) {
	return async (req: Request, server: SidecarServer) => {
		const url = new URL(req.url);

		if (req.method === "OPTIONS") {
			if (!isTrustedRequestOrigin(req)) {
				return new Response(null, { status: 403 });
			}
			return new Response(null, { status: 204, headers: corsHeaders(req) });
		}

		if (url.pathname === "/health") {
			return new Response(
				JSON.stringify({
					ok: true,
					mode: SIDECAR_MODE,
					pid: process.pid,
				}),
				{ headers: jsonHeaders(req) },
			);
		}

		if (
			url.pathname === "/transport" &&
			isTrustedRequestOrigin(req) &&
			server.upgrade(req)
		) {
			return undefined;
		}

		if (url.pathname === "/api/marketplace/catalog") {
			try {
				return createJsonResponse(req, await fetchMarketplaceCatalog());
			} catch (error) {
				return createJsonResponse(req, {
					...EMPTY_MARKETPLACE_CATALOG,
					error:
						error instanceof Error
							? error.message
							: "Failed to fetch marketplace catalog",
				});
			}
		}

		if (url.pathname === "/shutdown" && req.method === "POST") {
			if (!isTrustedRequestOrigin(req)) {
				return new Response(JSON.stringify({ ok: false }), {
					status: 403,
					headers: jsonHeaders(req),
				});
			}
			queueMicrotask(() => {
				void onShutdown?.("code_sidecar_shutdown_endpoint")
					.catch((error) => {
						ctx.logger?.error?.("Desktop sidecar shutdown failed", { error });
					})
					.finally(() => process.exit(0));
			});
			return new Response(JSON.stringify({ ok: true }), {
				headers: jsonHeaders(req),
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
