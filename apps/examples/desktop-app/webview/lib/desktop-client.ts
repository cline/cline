"use client";

import type {
	DesktopDebugLogPayload,
	DesktopTransportEvent,
	DesktopTransportMessage,
	DesktopTransportRequest,
	DesktopTransportResponse,
	DesktopTransportState,
} from "@/lib/desktop-transport";

// Lazily import the Tauri invoke API only when available. When running in
// sidecar/web mode (without Tauri), this module may not exist or the bridge
// may not be initialised, so we fall back to a hardcoded local WS endpoint.
async function tryTauriInvoke<T>(
	command: string,
	args?: Record<string, unknown>,
): Promise<T> {
	try {
		const { invoke } = await import("@tauri-apps/api/core");
		return await invoke<T>(command, args);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Tauri invoke failed for ${command}: ${message}`);
	}
}

/** Resolved once on first call; cached for subsequent calls. */
let resolvedEndpointCache: string | null = null;

/**
 * Resolve the backend WebSocket endpoint.
 *
 * Priority order:
 * 1. `window.__SIDECAR_WS_ENDPOINT__` — injected by the sidecar's HTML scaffold
 *    or an integration test harness.
 * 2. Tauri `get_desktop_backend_endpoint` command — used when running inside
 *    the full Tauri app shell.
 * 3. `NEXT_PUBLIC_SIDECAR_WS_ENDPOINT` (inlined at build time), then fallback
 *    to `ws://127.0.0.1:3126/transport` — the sidecar's default port when
 *    running in plain web/dev mode (`bun run dev:sidecar` + `bun run dev:web`).
 */
export async function resolveDesktopBackendWsEndpoint(): Promise<string> {
	if (resolvedEndpointCache) return resolvedEndpointCache;

	// 1. Explicit injection from sidecar or test harness.
	const injected =
		typeof window !== "undefined"
			? (window as unknown as Record<string, unknown>).__SIDECAR_WS_ENDPOINT__
			: undefined;
	if (typeof injected === "string" && injected.trim()) {
		resolvedEndpointCache = injected.trim();
		return resolvedEndpointCache;
	}

	// 2. Tauri command (full desktop app).
	if (isTauriAvailable()) {
		const endpoint = await tryTauriInvoke<string>(
			"get_desktop_backend_endpoint",
		);
		const trimmed = endpoint.trim();
		if (trimmed) {
			resolvedEndpointCache = trimmed;
			return resolvedEndpointCache;
		}
		throw new Error("Tauri returned an empty desktop backend endpoint");
	}

	// 3. Env override, then default sidecar port for local dev mode without
	// the Tauri bridge.
	const envEndpoint = process.env.NEXT_PUBLIC_SIDECAR_WS_ENDPOINT?.trim();
	resolvedEndpointCache = envEndpoint || "ws://127.0.0.1:3126/transport";
	return resolvedEndpointCache;
}

export async function resolveDesktopBackendHttpEndpoint(): Promise<string> {
	const wsEndpoint = await resolveDesktopBackendWsEndpoint();
	const endpoint = new URL(wsEndpoint);
	endpoint.protocol = endpoint.protocol === "wss:" ? "https:" : "http:";
	if (endpoint.pathname.endsWith("/transport")) {
		endpoint.pathname = endpoint.pathname.slice(0, -"/transport".length);
	}
	endpoint.search = "";
	endpoint.hash = "";
	return endpoint.toString().replace(/\/$/, "");
}

type PendingRequest = {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timeoutId?: ReturnType<typeof setTimeout>;
};

type EventHandler = (payload: unknown) => void;
type TransportStateHandler = (state: DesktopTransportState) => void;

export type DesktopInvokeOptions = {
	/**
	 * Override the default command deadline. Use `null` for commands whose
	 * response represents completion of a legitimately long-running operation.
	 */
	timeoutMs?: number | null;
};

export type DesktopErrorReport = {
	operation: string;
	error: unknown;
	handled?: boolean;
	command?: string;
	timeoutMs?: number;
	/** Failing resource URL from an ErrorEvent's `filename`. */
	sourceUrl?: string;
	lineno?: number;
	colno?: number;
};

/**
 * Upper bound for free-form attribution strings (source URLs, stack traces)
 * so a single report stays small on the wire and in telemetry storage.
 */
const ERROR_REPORT_FIELD_LIMIT = 500;

function boundedReportString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim()
		? value.slice(0, ERROR_REPORT_FIELD_LIMIT)
		: undefined;
}

function finiteReportNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

const REQUEST_TIMEOUT_MS = 120_000;
const RECONNECT_BASE_DELAY_MS = 400;
const RECONNECT_MAX_DELAY_MS = 4_000;
const DESKTOP_DEBUG_LOG_EVENT = "desktop_debug_log";
// Commands that should be routed to Tauri's native invoke bridge instead of
// the WebSocket transport — only applicable in the full Tauri app shell.
// In sidecar/web mode these commands are handled by the sidecar over WebSocket.
export function isTauriAvailable(): boolean {
	return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseDesktopDebugLogPayload(
	payload: unknown,
): DesktopDebugLogPayload | null {
	if (!isRecord(payload)) return null;
	const { level, message, metadata, scope, timestamp } = payload;
	if (
		(level !== "debug" && level !== "info" && level !== "error") ||
		typeof message !== "string" ||
		typeof scope !== "string" ||
		typeof timestamp !== "string"
	) {
		return null;
	}
	return {
		level,
		message,
		scope,
		timestamp,
		metadata: isRecord(metadata) ? metadata : undefined,
	};
}

function webviewDebugLoggingEnabled(): boolean {
	let runtimeEnabled = false;
	try {
		runtimeEnabled =
			typeof window !== "undefined" &&
			window.localStorage.getItem("cline.debugLogs") === "1";
	} catch {
		// Some embedded/privacy contexts deny localStorage access.
	}
	return (
		process.env.NODE_ENV !== "production" ||
		process.env.NEXT_PUBLIC_CLINE_DEBUG_LOGS === "1" ||
		runtimeEnabled
	);
}

export function writeDesktopDebugLog(payload: unknown): void {
	const entry = parseDesktopDebugLogPayload(payload);
	if (!entry || !webviewDebugLoggingEnabled()) {
		return;
	}
	const prefix = `[desktop:${entry.scope}] ${entry.message}`;
	const details = {
		timestamp: entry.timestamp,
		...(entry.metadata ?? {}),
	};
	if (entry.level === "error") {
		console.error("%s %o", prefix, details);
	} else if (entry.level === "info") {
		console.info("%s %o", prefix, details);
	} else {
		console.debug("%s %o", prefix, details);
	}
}

const NATIVE_COMMANDS = new Set([
	"pick_workspace_directory",
	"open_mcp_settings_file",
	"get_update_status",
	"restart_to_apply_update",
	"check_for_update_now",
	"set_app_icon",
	"show_session_notification",
	"drain_desktop_actions",
	"set_tray_status",
]);

class DesktopClient {
	private socket: WebSocket | null = null;
	private connectPromise: Promise<void> | null = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private requestCounter = 0;
	private pending = new Map<string, PendingRequest>();
	private handlers = new Map<string, Set<EventHandler>>();
	private transportStateHandlers = new Set<TransportStateHandler>();
	private transportState: DesktopTransportState = "connecting";
	private transportError: string | null = null;
	private hasConnectedOnce = false;
	private endpoint: string | null = null;
	private recentErrorReports = new Map<string, number>();
	private reportedErrorObjects = new WeakSet<object>();
	private errorObjectDeliveries = new WeakMap<object, Promise<boolean>>();

	reportError(report: DesktopErrorReport): void {
		const error = report.error;
		if (typeof error === "object" && error !== null) {
			if (this.reportedErrorObjects.has(error)) {
				return;
			}
			const pendingDelivery = this.errorObjectDeliveries.get(error);
			if (pendingDelivery) {
				void pendingDelivery.then((delivered) => {
					if (!delivered) this.reportError(report);
				});
				return;
			}
		}

		const delivery = this.deliverErrorReport(report);
		if (typeof error === "object" && error !== null) {
			this.errorObjectDeliveries.set(error, delivery);
			void delivery.then((delivered) => {
				if (delivered) this.reportedErrorObjects.add(error);
				if (this.errorObjectDeliveries.get(error) === delivery) {
					this.errorObjectDeliveries.delete(error);
				}
			});
		}
	}

	private async deliverErrorReport(
		report: DesktopErrorReport,
	): Promise<boolean> {
		const error = report.error;
		const errorMessage = error instanceof Error ? error.message : String(error);
		const errorType = error instanceof Error ? error.name : "Error";
		const dedupeKey = `${report.operation}:${report.command ?? ""}:${errorType}:${errorMessage}`;
		const now = Date.now();
		if ((this.recentErrorReports.get(dedupeKey) ?? 0) > now - 10_000) {
			return true;
		}
		for (const [key, timestamp] of this.recentErrorReports) {
			if (timestamp <= now - 10_000) this.recentErrorReports.delete(key);
		}

		try {
			const endpoint = await resolveDesktopBackendHttpEndpoint();
			const response = await fetch(`${endpoint}/telemetry/error`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					operation: report.operation,
					errorMessage,
					errorType,
					handled: report.handled ?? true,
					command: report.command,
					timeoutMs: report.timeoutMs,
					transportState: this.transportState,
					sourceUrl: boundedReportString(report.sourceUrl),
					lineno: finiteReportNumber(report.lineno),
					colno: finiteReportNumber(report.colno),
					stack: boundedReportString(
						error instanceof Error ? error.stack : undefined,
					),
				}),
			});
			if (!response.ok) return false;
			this.recentErrorReports.set(dedupeKey, Date.now());
			return true;
		} catch {
			// Error reporting must never affect the desktop UI error path.
			return false;
		}
	}

	private setTransportState(next: DesktopTransportState) {
		this.transportState = next;
		for (const handler of this.transportStateHandlers) {
			handler(next);
		}
	}

	private async getBackendEndpoint(): Promise<string> {
		if (this.endpoint?.trim()) {
			return this.endpoint;
		}
		const endpoint = await resolveDesktopBackendWsEndpoint();
		this.endpoint = endpoint;
		return this.endpoint;
	}

	private takePending(requestId: string): PendingRequest | undefined {
		const pending = this.pending.get(requestId);
		if (!pending) {
			return undefined;
		}
		if (pending.timeoutId !== undefined) {
			clearTimeout(pending.timeoutId);
		}
		this.pending.delete(requestId);
		return pending;
	}

	private rejectPending(errorMessage: string) {
		// Only report closures that actually drop in-flight requests; a clean
		// transport close (app quit, sidecar restart) is not an error.
		if (this.pending.size > 0) {
			this.reportError({
				operation: "webview.transport_closed",
				error: new Error(errorMessage),
			});
		}
		for (const requestId of this.pending.keys()) {
			this.takePending(requestId)?.reject(new Error(errorMessage));
		}
	}

	private dispatchEvent(message: DesktopTransportEvent) {
		if (message.event.name === DESKTOP_DEBUG_LOG_EVENT) {
			writeDesktopDebugLog(message.event.payload);
		}
		const handlers = this.handlers.get(message.event.name);
		if (!handlers || handlers.size === 0) {
			return;
		}
		for (const handler of handlers) {
			handler(message.event.payload);
		}
	}

	private handleMessage(raw: string) {
		let parsed: DesktopTransportMessage;
		try {
			parsed = JSON.parse(raw) as DesktopTransportMessage;
		} catch (error) {
			this.reportError({
				operation: "webview.transport_message_parse",
				error,
			});
			return;
		}

		if (parsed.type === "event") {
			this.dispatchEvent(parsed);
			return;
		}

		const response = parsed as DesktopTransportResponse;
		const pending = this.takePending(response.id);
		if (!pending) {
			return;
		}
		if (!response.ok) {
			pending.reject(new Error(response.error || "Desktop command failed"));
			return;
		}
		pending.resolve(response.result);
	}

	private scheduleReconnect() {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
		}
		const attempt = Math.max(this.pending.size, 1);
		const delayMs = Math.min(
			RECONNECT_BASE_DELAY_MS * 2 ** Math.min(attempt, 4),
			RECONNECT_MAX_DELAY_MS,
		);
		this.reconnectTimer = setTimeout(() => {
			void this.ensureConnected(true);
		}, delayMs);
	}

	private async ensureConnected(isReconnect = false): Promise<void> {
		if (
			this.socket &&
			(this.socket.readyState === WebSocket.OPEN ||
				this.socket.readyState === WebSocket.CONNECTING)
		) {
			return;
		}
		if (this.connectPromise) {
			return this.connectPromise;
		}

		this.setTransportState(
			this.hasConnectedOnce || isReconnect ? "reconnecting" : "connecting",
		);

		this.connectPromise = (async () => {
			const endpoint = await this.getBackendEndpoint();
			await new Promise<void>((resolve, reject) => {
				const socket = new WebSocket(endpoint);
				this.socket = socket;
				socket.onopen = () => {
					this.hasConnectedOnce = true;
					this.transportError = null;
					this.setTransportState("connected");
					resolve();
				};
				socket.onmessage = (event) => {
					this.handleMessage(String(event.data));
				};
				socket.onerror = () => {
					// Wait for onclose to reject or reconnect.
				};
				socket.onclose = () => {
					if (this.socket === socket) {
						this.socket = null;
					}
					if (this.transportState !== "connected") {
						reject(
							new Error(`Desktop backend transport unavailable at ${endpoint}`),
						);
						return;
					}
					this.setTransportState("reconnecting");
					this.rejectPending("Desktop backend transport closed");
					this.scheduleReconnect();
				};
			});
		})()
			.catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				this.transportError = message;
				this.reportError({
					operation: "webview.transport_connect",
					error,
				});
				if (!this.hasConnectedOnce) {
					this.setTransportState("unavailable");
				}
				throw error;
			})
			.finally(() => {
				this.connectPromise = null;
			});

		return this.connectPromise;
	}

	async invoke<T>(
		command: string,
		args?: Record<string, unknown>,
		options?: DesktopInvokeOptions,
	): Promise<T> {
		// Route native OS commands (directory picker, file opener) through Tauri
		// only when running inside the full Tauri app shell. In sidecar/web mode
		// these are handled by the sidecar over WebSocket.
		if (NATIVE_COMMANDS.has(command) && isTauriAvailable()) {
			try {
				return await tryTauriInvoke<T>(command, args);
			} catch (error) {
				this.reportError({
					operation: "webview.native_command",
					error,
					command,
				});
				throw error;
			}
		}

		await this.ensureConnected();
		const socket = this.socket;
		if (!socket || socket.readyState !== WebSocket.OPEN) {
			const error = new Error("Desktop backend transport unavailable");
			this.reportError({
				operation: "webview.transport_unavailable",
				error,
				command,
			});
			throw error;
		}

		const id = `desktop_${Date.now()}_${this.requestCounter++}`;
		const request: DesktopTransportRequest = {
			type: "command",
			id,
			command,
			args,
		};

		return await new Promise<T>((resolve, reject) => {
			const timeoutMs =
				options?.timeoutMs === undefined
					? REQUEST_TIMEOUT_MS
					: options.timeoutMs;
			const timeoutId =
				timeoutMs === null
					? undefined
					: setTimeout(() => {
							const pending = this.takePending(id);
							if (!pending) {
								return;
							}
							const error = new Error(
								`Desktop command timed out waiting for ${command}`,
							);
							this.reportError({
								operation: "webview.command_timeout",
								error,
								command,
								timeoutMs,
							});
							pending.reject(error);
						}, timeoutMs);
			this.pending.set(id, {
				resolve: (value) => resolve(value as T),
				reject,
				timeoutId,
			});
			try {
				socket.send(JSON.stringify(request));
			} catch (error) {
				this.takePending(id);
				this.reportError({
					operation: "webview.command_send",
					error,
					command,
				});
				throw error;
			}
		});
	}

	subscribe(eventName: string, handler: EventHandler): () => void {
		void this.ensureConnected(true).catch(() => {
			// Keep UI functional enough to surface later retries.
		});
		const handlers = this.handlers.get(eventName) ?? new Set<EventHandler>();
		handlers.add(handler);
		this.handlers.set(eventName, handlers);
		return () => {
			const current = this.handlers.get(eventName);
			if (!current) {
				return;
			}
			current.delete(handler);
			if (current.size === 0) {
				this.handlers.delete(eventName);
			}
		};
	}

	subscribeTransportState(handler: TransportStateHandler): () => void {
		this.transportStateHandlers.add(handler);
		handler(this.transportState);
		void this.ensureConnected(true).catch(() => {
			// Ignore eager connect failures; commands will surface them.
		});
		return () => {
			this.transportStateHandlers.delete(handler);
		};
	}

	getTransportState(): DesktopTransportState {
		return this.transportState;
	}

	getTransportError(): string | null {
		return this.transportError;
	}
}

export const desktopClient = new DesktopClient();

/**
 * Open a URL in the user's default browser. Inside the Tauri shell,
 * `target="_blank"` anchors are silently dropped (no window opener is
 * configured), so external links must be routed through the sidecar, which
 * runs on the host and can spawn the platform opener. In plain web mode the
 * browser handles it directly.
 */
export async function openExternalUrl(url: string): Promise<void> {
	if (isTauriAvailable()) {
		await desktopClient.invoke("open_external_url", { url });
		return;
	}
	window.open(url, "_blank", "noopener,noreferrer");
}
