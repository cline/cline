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
// Exported (not just used internally) so callers that need a Tauri command
// NOT routed through resolveDesktopBackendWsEndpoint's shared endpoint cache
// (e.g. resolving a *different*, non-active bot's endpoint for a background
// relay) can invoke it directly instead of risking corrupting that cache.
export async function tryTauriInvoke<T>(
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

/**
 * Resolved once per (bot, project) pair; cached until a different pair is
 * requested. Each assigned project has its own sandboxed backend process
 * (see apps/cline/SANDBOX.md), so switching the active project means
 * resolving — and connecting to — a genuinely different endpoint, not just
 * reusing whatever was cached for the last one.
 */
let resolvedEndpointCache: string | null = null;
let resolvedEndpointCacheKey: string | null = null;

/**
 * `null` means "no specific pair requested — reuse whatever's cached."
 * An empty `projectPath` is a real, distinct key (the "no project" entry
 * scoped to just the bot's own data), not the same as "not specified" — a
 * plain `botId && projectPath` check would treat `projectPath: ""` as
 * missing and either throw or silently reuse a stale, unrelated cache entry.
 */
function projectCacheKey(botId?: string, projectPath?: string): string | null {
	if (botId === undefined || projectPath === undefined) {
		return null;
	}
	return `${botId}::${projectPath}`;
}

/**
 * Resolve the backend WebSocket endpoint for a given bot+project.
 *
 * Priority order:
 * 1. `window.__SIDECAR_WS_ENDPOINT__` — injected by the sidecar's HTML scaffold
 *    or an integration test harness.
 * 2. Tauri `get_desktop_backend_endpoint` command — used when running inside
 *    the full Tauri app shell. Requires `botId`/`projectPath` (the project
 *    must already be assigned via `assign_project`) unless a value is
 *    already cached, since resolving a *new* connection always needs to
 *    know which project's pooled process to reach.
 * 3. `NEXT_PUBLIC_SIDECAR_WS_ENDPOINT` (inlined at build time), then fallback
 *    to `ws://127.0.0.1:3126/` — the sidecar's default port when
 *    running in plain web/dev mode (`bun run dev:web` starts both processes).
 *
 * Callers that don't care which project (e.g. error-telemetry POSTs) can
 * omit both arguments to reuse whatever's already resolved.
 */
export async function resolveDesktopBackendWsEndpoint(
	botId?: string,
	projectPath?: string,
): Promise<string> {
	const requestedKey = projectCacheKey(botId, projectPath);
	const browserEndpoint =
		typeof window !== "undefined"
			? window.localStorage.getItem("cline.gatewayUi.endpoint")?.trim()
			: undefined;
	if (browserEndpoint) {
		resolvedEndpointCache = browserEndpoint;
		resolvedEndpointCacheKey = requestedKey;
		return browserEndpoint;
	}
	if (
		resolvedEndpointCache &&
		(!requestedKey || requestedKey === resolvedEndpointCacheKey)
	) {
		return resolvedEndpointCache;
	}

	// 1. Explicit injection from sidecar or test harness.
	const injected =
		typeof window !== "undefined"
			? (window as unknown as Record<string, unknown>).__SIDECAR_WS_ENDPOINT__
			: undefined;
	if (typeof injected === "string" && injected.trim()) {
		resolvedEndpointCache = injected.trim();
		resolvedEndpointCacheKey = requestedKey;
		return resolvedEndpointCache;
	}

	// 2. Tauri command (full desktop app).
	if (isTauriAvailable()) {
		if (!botId || projectPath === undefined) {
			throw new Error(
				"resolveDesktopBackendWsEndpoint requires a bot id and project path to resolve a new connection",
			);
		}
		const endpoint = await tryTauriInvoke<string>(
			"get_desktop_backend_endpoint",
			{ botId, projectPath },
		);
		const trimmed = endpoint.trim();
		if (trimmed) {
			resolvedEndpointCache = trimmed;
			resolvedEndpointCacheKey = requestedKey;
			return resolvedEndpointCache;
		}
		throw new Error("Tauri returned an empty desktop backend endpoint");
	}

	// 3. Env override, then default sidecar port for local dev mode without
	// the Tauri bridge.
	const envEndpoint = process.env.NEXT_PUBLIC_SIDECAR_WS_ENDPOINT?.trim();
	resolvedEndpointCache = envEndpoint || "ws://127.0.0.1:3126/";
	resolvedEndpointCacheKey = requestedKey;
	return resolvedEndpointCache;
}

export async function resolveDesktopBackendHttpEndpoint(): Promise<string> {
	const wsEndpoint = await resolveDesktopBackendWsEndpoint();
	const endpoint = new URL(wsEndpoint);
	endpoint.protocol = endpoint.protocol === "wss:" ? "https:" : "http:";
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
// A freshly-spawned per-project sidecar can report its endpoint (main.rs's
// own get_desktop_backend_endpoint already retries that resolution 3x) before
// its WebSocket server has actually started accepting connections - a brief
// startup race, not a real failure. scheduleReconnect() only covers a
// disconnect *after* a first successful connect, so the very first attempt
// for a given endpoint needs its own short retry budget here, or a user who
// switches to a project whose backend just started spawning sees a hard
// "transport unavailable" instead of the UI simply waiting the extra moment.
const INITIAL_CONNECT_RETRY_ATTEMPTS = 5;
const INITIAL_CONNECT_RETRY_DELAY_MS = 400;
const DESKTOP_DEBUG_LOG_EVENT = "desktop_debug_log";
// Rejection message for in-flight requests dropped by a deliberate,
// self-caused transport reset (switching the active bot/project) - callers
// use this to distinguish "we did this on purpose, don't show an error" from
// a genuine transport failure. Keep in sync with setActiveProject() below.
export const PROJECT_SWITCH_ERROR_MESSAGE = "Switching to a different project";
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
	"pick_bot_icon_file",
	"list_assigned_projects",
	"assign_project",
	"sync_gateway_bots",
	"switch_active_bot_preference",
	"open_mcp_settings_file",
	"get_update_status",
	"restart_to_apply_update",
	"check_for_update_now",
	"set_app_icon",
	"drain_desktop_menu_actions",
	"set_tray_status",
]);

class DesktopClient {
	private socket: WebSocket | null = null;
	private connectPromise: Promise<void> | null = null;
	// Bumped on every setActiveProject so a retry loop already in flight for
	// the project being left (see connectWithInitialRetry) can tell it's been
	// superseded and stop retrying against a now-irrelevant endpoint, rather
	// than fighting the fresh attempt setActiveProject is about to start.
	private connectGeneration = 0;
	// The `reject` of whichever connectSocketOnce promise is currently
	// pending, if any - lets setActiveProject fail it immediately instead of
	// leaving it to hang forever once the socket's own handlers are stripped
	// below (which is what would otherwise silently orphan it: nothing would
	// ever call resolve/reject on it again).
	private pendingConnectReject: ((error: Error) => void) | null = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private requestCounter = 0;
	private pending = new Map<string, PendingRequest>();
	private handlers = new Map<string, Set<EventHandler>>();
	private transportStateHandlers = new Set<TransportStateHandler>();
	private transportState: DesktopTransportState = "connecting";
	private transportError: string | null = null;
	private hasConnectedOnce = false;
	private endpoint: string | null = null;
	// Default to the "no project" entry for the default bot, not null:
	// arbitrary components (e.g. AgentSidebar) can issue commands as soon as
	// they mount, before whichever component owns the active workspace
	// (ChatThreadPane) has had a chance to call setActiveProject - there's
	// no reliable effect ordering to lean on instead. Matches
	// bot-config.ts's DEFAULT_BOT_ID until a bot picker exists.
	private activeBotId = "cline";
	private activeProjectPath = "";
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

	private assertCurrentGeneration(generation: number): void {
		if (this.connectGeneration !== generation) {
			throw new Error(PROJECT_SWITCH_ERROR_MESSAGE);
		}
	}

	private async getBackendEndpoint(
		generation: number,
		botId: string,
		projectPath: string,
	): Promise<string> {
		if (this.endpoint?.trim()) {
			return this.endpoint;
		}
		const endpoint = await resolveDesktopBackendWsEndpoint(botId, projectPath);
		// Endpoint resolution crosses the native bridge and can take long enough
		// for another session/project to become active. Never let that stale
		// continuation install an endpoint for the target we already left.
		this.assertCurrentGeneration(generation);
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
		this.rejectPendingSilently(errorMessage);
	}

	/** Like rejectPending, but for closures we caused on purpose (switching
	 * the active project) — not a transport failure worth reporting. */
	private rejectPendingSilently(errorMessage: string) {
		for (const requestId of this.pending.keys()) {
			this.takePending(requestId)?.reject(new Error(errorMessage));
		}
	}

	/**
	 * Point this client at a specific bot+project's own sandboxed backend
	 * process. Each assigned project has its own process (see
	 * apps/cline/SANDBOX.md) with its own endpoint, so switching means
	 * dropping any existing connection and resolving/connecting fresh —
	 * never silently continuing to talk to whichever project was active
	 * before.
	 */
	setActiveProject(botId: string, projectPath: string): void {
		if (this.activeBotId === botId && this.activeProjectPath === projectPath) {
			return;
		}
		this.activeBotId = botId;
		this.activeProjectPath = projectPath;
		this.endpoint = null;
		this.transportError = null;
		// Connection history is target-scoped. A socket that opened for the
		// previous project must not suppress startup retries for this one.
		this.hasConnectedOnce = false;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		const socket = this.socket;
		this.socket = null;
		// Invalidate any connect attempt already in flight for the project
		// being left, and fail it immediately rather than letting it hang:
		// stripping its socket's own onclose/onopen below (needed so late
		// events from a project we've already left don't touch current
		// state) means nothing else will ever settle that promise. A caller
		// already awaiting it - including this same class's own
		// connectPromise field - gets this rejection instead of hanging
		// forever; use-chat-session.ts already knows to swallow this exact
		// message rather than showing it as a real error.
		this.connectGeneration += 1;
		this.connectPromise = null;
		const pendingConnectReject = this.pendingConnectReject;
		this.pendingConnectReject = null;
		pendingConnectReject?.(new Error(PROJECT_SWITCH_ERROR_MESSAGE));
		this.rejectPendingSilently(PROJECT_SWITCH_ERROR_MESSAGE);
		this.setTransportState("connecting");
		if (socket) {
			socket.onopen = null;
			socket.onclose = null;
			socket.onerror = null;
			socket.onmessage = null;
			socket.close();
		}
		void this.ensureConnected().catch(() => {
			// The state subscription and the next command surface a current-target
			// failure. Deliberate switches reject the superseded chain by design.
		});
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
			this.reconnectTimer = null;
			void this.ensureConnected(true).catch(() => {
				// A later reconnect attempt or command will retry the current target.
			});
		}, delayMs);
	}

	/** One connection attempt against `endpoint`. Resolves on open, rejects
	 * on close-before-open (including a raw connection refusal) - or
	 * whenever setActiveProject aborts it early via pendingConnectReject. */
	private connectSocketOnce(
		endpoint: string,
		generation: number,
	): Promise<void> {
		this.assertCurrentGeneration(generation);
		return new Promise<void>((resolve, reject) => {
			this.pendingConnectReject = reject;
			const clearPendingReject = () => {
				if (this.pendingConnectReject === reject) {
					this.pendingConnectReject = null;
				}
			};
			const remoteToken =
				typeof window !== "undefined"
					? window.localStorage.getItem("cline.gatewayUi.token")?.trim()
					: undefined;
			const socket = new WebSocket(
				endpoint,
				remoteToken
					? ["cline-desktop-v1", `cline-auth.${remoteToken}`]
					: ["cline-desktop-v1"],
			);
			this.socket = socket;
			let opened = false;
			socket.onopen = () => {
				if (this.connectGeneration !== generation || this.socket !== socket) {
					clearPendingReject();
					socket.onopen = null;
					socket.onclose = null;
					socket.onerror = null;
					socket.onmessage = null;
					socket.close();
					reject(new Error(PROJECT_SWITCH_ERROR_MESSAGE));
					return;
				}
				clearPendingReject();
				opened = true;
				this.hasConnectedOnce = true;
				this.transportError = null;
				this.setTransportState("connected");
				resolve();
			};
			socket.onmessage = (event) => {
				if (this.connectGeneration !== generation || this.socket !== socket) {
					return;
				}
				this.handleMessage(String(event.data));
			};
			socket.onerror = () => {
				// Wait for onclose to reject or reconnect.
			};
			socket.onclose = () => {
				clearPendingReject();
				if (this.connectGeneration !== generation || this.socket !== socket) {
					reject(new Error(PROJECT_SWITCH_ERROR_MESSAGE));
					return;
				}
				if (this.socket === socket) {
					this.socket = null;
				}
				if (!opened) {
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
	}

	/** Retries a still-never-succeeded first connect a few times before
	 * giving up - see INITIAL_CONNECT_RETRY_ATTEMPTS's own comment for why
	 * this attempt in particular needs a retry budget the way a later
	 * disconnect (handled by scheduleReconnect instead) already has one.
	 * Stops retrying immediately once a newer setActiveProject call has
	 * superseded this one (its own fresh attempt should own the field from
	 * here, not a retry loop still chasing the endpoint just left behind). */
	private async connectWithInitialRetry(
		endpoint: string,
		generation: number,
	): Promise<void> {
		for (let attempt = 1; ; attempt++) {
			this.assertCurrentGeneration(generation);
			try {
				await this.connectSocketOnce(endpoint, generation);
				return;
			} catch (error) {
				this.assertCurrentGeneration(generation);
				if (
					this.hasConnectedOnce ||
					attempt >= INITIAL_CONNECT_RETRY_ATTEMPTS ||
					this.connectGeneration !== generation
				) {
					throw error;
				}
				await new Promise((resolve) =>
					setTimeout(resolve, INITIAL_CONNECT_RETRY_DELAY_MS),
				);
			}
		}
	}

	private async ensureConnected(isReconnect = false): Promise<void> {
		if (this.socket && this.socket.readyState === WebSocket.OPEN) {
			return;
		}
		// A socket in the CONNECTING state always has a matching
		// connectPromise (both are set together below, and connectPromise is
		// only cleared once the socket has settled to OPEN or been nulled
		// out) - awaiting it here, instead of returning immediately just
		// because a socket object already exists, is what makes a caller
		// that fires right after a fresh connect kicked off (e.g. right
		// after setActiveProject) actually wait for the handshake instead of
		// failing "transport unavailable" against a socket that hasn't
		// finished opening yet.
		if (this.connectPromise) {
			return this.connectPromise;
		}

		this.setTransportState(
			this.hasConnectedOnce || isReconnect ? "reconnecting" : "connecting",
		);

		const generation = this.connectGeneration;
		const botId = this.activeBotId;
		const projectPath = this.activeProjectPath;
		this.connectPromise = (async () => {
			const endpoint = await this.getBackendEndpoint(
				generation,
				botId,
				projectPath,
			);
			this.assertCurrentGeneration(generation);
			await this.connectWithInitialRetry(endpoint, generation);
		})()
			.catch((error) => {
				if (this.connectGeneration !== generation) {
					throw new Error(PROJECT_SWITCH_ERROR_MESSAGE);
				}
				const message = error instanceof Error ? error.message : String(error);
				this.transportError = message;
				this.reportError({
					operation: "webview.transport_connect",
					error,
				});
				if (!this.hasConnectedOnce) {
					this.setTransportState("unavailable");
				} else {
					this.setTransportState("reconnecting");
					this.scheduleReconnect();
				}
				throw error;
			})
			.finally(() => {
				// setActiveProject may have already superseded this chain -
				// synchronously clearing connectPromise itself and starting a
				// new one - before this settles (rejecting it is what lets
				// it settle at all; see pendingConnectReject). Only clear the
				// field if it's still ours, or this would null out that
				// newer, still-in-flight chain instead.
				if (this.connectGeneration === generation) {
					this.connectPromise = null;
				}
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

		const generation = this.connectGeneration;
		await this.ensureConnected();
		if (this.connectGeneration !== generation) {
			throw new Error(PROJECT_SWITCH_ERROR_MESSAGE);
		}
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
