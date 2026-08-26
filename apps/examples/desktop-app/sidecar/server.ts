import { randomUUID, timingSafeEqual } from "node:crypto";
import { captureSdkError } from "@cline/shared";
import type { DesktopTransportRequest } from "../webview/lib/desktop-transport";
import { MAX_DESKTOP_TRANSPORT_PAYLOAD_BYTES } from "../webview/lib/voice-input-limits";
import { handleCommand } from "./commands";
import {
	cancelSidecarToolApprovalsForOwner,
	encodeSidecarEvent,
	sendEvent,
	syncSidecarApprovalReadiness,
} from "./context";
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
	upgrade(
		req: Request,
		options?: { data?: { canApproveTools?: boolean } },
	): boolean;
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

const APPROVAL_TOKEN_QUERY_PARAM = "approval_token";

function hasValidApprovalToken(url: URL, expectedToken: string): boolean {
	const candidate = url.searchParams.get(APPROVAL_TOKEN_QUERY_PARAM);
	if (!candidate) return false;
	const candidateBytes = Buffer.from(candidate);
	const expectedBytes = Buffer.from(expectedToken);
	return (
		candidateBytes.length === expectedBytes.length &&
		timingSafeEqual(candidateBytes, expectedBytes)
	);
}

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
	approvalToken = process.env.CLINE_SIDECAR_APPROVAL_TOKEN?.trim() ||
		randomUUID(),
): { port: number; approvalToken: string } {
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
				fetch: createFetchHandler(ctx, onShutdown, approvalToken),
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

	return { port: server.port, approvalToken };
}

export function createFetchHandler(
	ctx: SidecarContext,
	onShutdown?: (reason?: string) => Promise<void>,
	approvalToken = "",
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
			server.upgrade(req, {
				data: {
					// Originless clients remain supported for local integrations, but only
					// the browser-hosted desktop UI may receive or resolve approvals.
					canApproveTools:
						Boolean(readOrigin(req)) &&
						hasValidApprovalToken(url, approvalToken),
				},
			})
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
			if (!isTrustedRequestOrigin(req)) {
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

export function createWebSocketHandler(ctx: SidecarContext) {
	return {
		maxPayloadLength: MAX_DESKTOP_TRANSPORT_PAYLOAD_BYTES,
		open(ws: SidecarWebSocketClient) {
			ctx.wsClients.add(ws);
			void syncSidecarApprovalReadiness(ctx).catch(() => {});
			sendEvent(ctx, "host_ready", {
				pid: process.pid,
				mode: SIDECAR_MODE,
			});
			// Replay a pending mismatch so webviews that connect (or reload)
			// after detection still prompt the user to update and restart.
			if (ctx.hubBuildMismatch) {
				ws.send(encodeSidecarEvent("hub_build_mismatch", ctx.hubBuildMismatch));
			}
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
			ctx.wsClients.delete(ws);
			cancelSidecarToolApprovalsForOwner(ctx, ws);
			void syncSidecarApprovalReadiness(ctx).catch(() => {});
			// Browser OAuth flows are interactive: if the connection that started
			// one goes away (webview reload, transport drop), cancel its callback
			// wait so the sidecar cannot retain an abandoned authorization attempt.
			cancelProviderOAuthLoginsForOwner(ws);
			cancelMcpOAuthAuthorizationsForOwner(ws);
		},
	};
}
