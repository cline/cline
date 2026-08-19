import { timingSafeEqual } from "node:crypto";
import { captureSdkError } from "@cline/shared";
import type { DesktopTransportRequest } from "../webview/lib/desktop-transport";
import { MAX_DESKTOP_TRANSPORT_PAYLOAD_BYTES } from "../webview/lib/voice-input-limits";
import { handleCommand } from "./commands";
import { encodeSidecarEvent } from "./context";
import { fetchMarketplaceCatalog } from "./marketplace";
import { cancelMcpOAuthAuthorizationsForOwner } from "./mcp-oauth";
import { cancelProviderOAuthLoginsForOwner } from "./oauth-login";
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

/**
 * Per-launch bearer credential guarding the control plane. The Origin
 * allowlist below is only a CSRF control: browsers always send Origin, but a
 * non-browser local process can omit or forge it, so origin alone cannot
 * authenticate anyone. The token is generated at startup, handed to the app
 * shell over the sidecar's private stdout pipe, and required on the WebSocket
 * transport (first-message handshake) and on /shutdown.
 */
export type SidecarAuth = {
	token: string;
};

/** Connections that never authenticate are dropped within this window. */
const WS_AUTH_TIMEOUT_MS = 10_000;

function sidecarTokensEqual(provided: string, expected: string): boolean {
	const a = Buffer.from(provided);
	const b = Buffer.from(expected);
	return a.length === b.length && timingSafeEqual(a, b);
}

function hasValidAuthToken(req: Request, auth: SidecarAuth): boolean {
	const header = req.headers.get("authorization")?.trim();
	if (!header?.toLowerCase().startsWith("bearer ")) {
		return false;
	}
	const provided = header.slice("bearer ".length).trim();
	return provided.length > 0 && sidecarTokensEqual(provided, auth.token);
}

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

type DesktopClientErrorReport = {
	operation?: unknown;
	errorMessage?: unknown;
	errorType?: unknown;
	handled?: unknown;
	command?: unknown;
	timeoutMs?: unknown;
	transportState?: unknown;
	sourceUrl?: unknown;
	lineno?: unknown;
	colno?: unknown;
	stack?: unknown;
};

// Bound for free-form attribution strings (source URLs, stack traces);
// matches ERROR_REPORT_FIELD_LIMIT in webview/lib/desktop-client.ts.
const ERROR_REPORT_FIELD_LIMIT = 500;

function captureDesktopError(
	ctx: SidecarContext,
	operation: string,
	error: unknown,
	context?: Record<string, string | number | boolean>,
	handled = true,
): void {
	captureSdkError(ctx.telemetry, {
		component: "desktop",
		operation,
		error,
		handled,
		context,
	});
}

// ---------------------------------------------------------------------------
// Bun HTTP + WebSocket server
// ---------------------------------------------------------------------------

export function startServer(
	ctx: SidecarContext,
	preferredPort: number = SIDECAR_PORT,
	onShutdown?: (reason?: string) => Promise<void>,
	auth: SidecarAuth = { token: "" },
): { port: number } {
	if (!BunRuntime) {
		throw new Error("sidecar must be run with Bun");
	}
	if (!auth.token) {
		throw new Error("sidecar requires an auth token to start its server");
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
				fetch: createFetchHandler(ctx, onShutdown, auth),
				websocket: createWebSocketHandler(ctx, auth),
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
	auth: SidecarAuth = { token: "" },
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
				captureDesktopError(ctx, "marketplace.catalog", error);
				return createJsonResponse(req, {
					...EMPTY_MARKETPLACE_CATALOG,
					error:
						error instanceof Error
							? error.message
							: "Failed to fetch marketplace catalog",
				});
			}
		}

		if (url.pathname === "/telemetry/error" && req.method === "POST") {
			if (!isTrustedRequestOrigin(req)) {
				return createJsonResponse(req, { ok: false }, 403);
			}
			try {
				const report = (await req.json()) as DesktopClientErrorReport;
				const operation =
					typeof report.operation === "string" && report.operation.trim()
						? report.operation.trim().slice(0, 100)
						: "webview.unknown";
				const error = Object.assign(
					new Error(
						typeof report.errorMessage === "string"
							? report.errorMessage
							: "Unknown desktop webview error",
					),
					{
						name:
							typeof report.errorType === "string"
								? report.errorType.slice(0, 100)
								: "Error",
					},
				);
				const context: Record<string, string | number | boolean> = {};
				if (typeof report.command === "string") {
					context.command = report.command.slice(0, 100);
				}
				if (
					typeof report.timeoutMs === "number" &&
					Number.isFinite(report.timeoutMs)
				) {
					context.timeoutMs = report.timeoutMs;
				}
				if (typeof report.transportState === "string") {
					context.transportState = report.transportState.slice(0, 30);
				}
				if (typeof report.sourceUrl === "string" && report.sourceUrl.trim()) {
					context.sourceUrl = report.sourceUrl.slice(
						0,
						ERROR_REPORT_FIELD_LIMIT,
					);
				}
				if (
					typeof report.lineno === "number" &&
					Number.isFinite(report.lineno)
				) {
					context.lineno = report.lineno;
				}
				if (typeof report.colno === "number" && Number.isFinite(report.colno)) {
					context.colno = report.colno;
				}
				if (typeof report.stack === "string" && report.stack.trim()) {
					context.stack = report.stack.slice(0, ERROR_REPORT_FIELD_LIMIT);
				}
				captureDesktopError(
					ctx,
					operation,
					error,
					context,
					typeof report.handled === "boolean" ? report.handled : true,
				);
				return createJsonResponse(req, { ok: true }, 202);
			} catch (error) {
				captureDesktopError(ctx, "webview.error_report", error);
				return createJsonResponse(req, { ok: false }, 400);
			}
		}

		if (url.pathname === "/shutdown" && req.method === "POST") {
			if (!hasValidAuthToken(req, auth)) {
				return new Response(JSON.stringify({ ok: false }), {
					status: 403,
					headers: jsonHeaders(req),
				});
			}
			queueMicrotask(() => {
				void onShutdown?.("code_sidecar_shutdown_endpoint")
					.catch((error) => {
						captureDesktopError(ctx, "sidecar.shutdown", error);
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

export function createWebSocketHandler(
	ctx: SidecarContext,
	auth: SidecarAuth = { token: "" },
) {
	// Connections that have presented the auth token. Anything else may stay
	// open only long enough to complete the handshake. The origin check at
	// upgrade stays as-is: it is CSRF defense for browsers, while this
	// handshake is what actually authenticates the connection.
	const authenticated = new WeakSet<SidecarWebSocketClient>();
	const authTimeouts = new Map<
		SidecarWebSocketClient,
		ReturnType<typeof setTimeout>
	>();

	const closeUnauthenticated = (ws: SidecarWebSocketClient, error: string) => {
		try {
			ws.send(JSON.stringify({ type: "auth", ok: false, error }));
		} catch {
			// The socket is already gone; closing below is best-effort too.
		}
		try {
			ws.close?.();
		} catch {
			// Ignore: the peer may have raced us to the close.
		}
	};

	return {
		maxPayloadLength: MAX_DESKTOP_TRANSPORT_PAYLOAD_BYTES,
		open(ws: SidecarWebSocketClient) {
			// Nothing is sent and no command is served until the client
			// authenticates; host_ready and any pending mismatch replay happen
			// after a successful handshake.
			authTimeouts.set(
				ws,
				setTimeout(() => {
					authTimeouts.delete(ws);
					if (!authenticated.has(ws)) {
						closeUnauthenticated(ws, "authentication required");
					}
				}, WS_AUTH_TIMEOUT_MS),
			);
		},
		async message(ws: SidecarWebSocketClient, raw: string) {
			if (!authenticated.has(ws)) {
				let handshake: { type?: unknown; token?: unknown } | null = null;
				try {
					const parsed: unknown = JSON.parse(String(raw));
					if (parsed !== null && typeof parsed === "object") {
						handshake = parsed as { type?: unknown; token?: unknown };
					}
				} catch {
					handshake = null;
				}
				if (
					handshake?.type !== "auth" ||
					typeof handshake.token !== "string" ||
					!sidecarTokensEqual(handshake.token, auth.token)
				) {
					closeUnauthenticated(ws, "invalid auth token");
					return;
				}
				const timeout = authTimeouts.get(ws);
				if (timeout) {
					clearTimeout(timeout);
					authTimeouts.delete(ws);
				}
				authenticated.add(ws);
				ctx.wsClients.add(ws);
				ws.send(JSON.stringify({ type: "auth", ok: true }));
				ws.send(
					encodeSidecarEvent("host_ready", {
						pid: process.pid,
						mode: SIDECAR_MODE,
					}),
				);
				// Replay a pending mismatch so webviews that connect (or reload)
				// after detection still prompt the user to update and restart.
				if (ctx.hubBuildMismatch) {
					ws.send(
						encodeSidecarEvent("hub_build_mismatch", ctx.hubBuildMismatch),
					);
				}
				return;
			}

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
				const result = await handleCommand(ctx, request.command, request.args, {
					connection: ws,
				});
				ws.send(jsonResponse(request.id, true, result));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				captureDesktopError(ctx, "command.execute", error, {
					command: request.command,
				});
				ws.send(jsonResponse(request.id, false, undefined, message));
			}
		},
		close(ws: SidecarWebSocketClient) {
			const timeout = authTimeouts.get(ws);
			if (timeout) {
				clearTimeout(timeout);
				authTimeouts.delete(ws);
			}
			ctx.wsClients.delete(ws);
			// Browser OAuth flows are interactive: if the connection that started
			// one goes away (webview reload, transport drop), cancel its callback
			// wait so the sidecar cannot retain an abandoned authorization attempt.
			cancelProviderOAuthLoginsForOwner(ws);
			cancelMcpOAuthAuthorizationsForOwner(ws);
		},
	};
}
