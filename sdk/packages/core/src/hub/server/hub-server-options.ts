import type { BasicLogger, ITelemetryService } from "@cline/shared";
import type { CronServiceOptions } from "../../cron/service/cron-service";
import type {
	HubScheduleRuntimeHandlers,
	HubScheduleServiceOptions,
} from "../../cron/service/schedule-service";
import type {
	CommandExecutionRuntimeService,
	PendingPromptsRuntimeService,
	RuntimeHost,
} from "../../runtime/host/runtime-host";
import type { SessionHistorySearchOptions } from "../../session/search";
import type { CoreSettingsService } from "../../settings";
import type { AgendaTaskManagerOptions } from "../../tasks";
import type { HubOwnerContext } from "../discovery";
import type { HubPairingAuthority } from "../pairing";
import type {
	HubAttachAuthorizer,
	HubSessionTrustModel,
} from "./handlers/context";
import type { HubEventLogOptions } from "./hub-event-log";
import type { HubRunQueueOptions } from "./hub-run-queue";

export interface HubWebSocketServerOptions {
	/** Hub-owned full-text session history index configuration. */
	sessionSearchOptions?: SessionHistorySearchOptions;
	/** Workspace authority assigned by the Hub to authenticated clients. */
	workspaceRoot?: string;
	host?: string;
	port?: number;
	pathname?: string;
	owner?: HubOwnerContext;
	sessionHost?: RuntimeHost &
		Partial<PendingPromptsRuntimeService & CommandExecutionRuntimeService>;
	settingsService?: CoreSettingsService;
	/** File/DB/watcher overrides for the Hub-owned agenda task manager. */
	taskOptions?: Omit<AgendaTaskManagerOptions, "runtime" | "publish">;
	runtimeHandlers: HubScheduleRuntimeHandlers;
	scheduleOptions?: Omit<HubScheduleServiceOptions, "runtimeHandlers">;
	/**
	 * File-based cron automation options. When provided, the hub starts a
	 * `CronService` that watches global `~/.cline/cron/` by default, reconciles
	 * specs into `cron.db`, and executes queued runs through `runtimeHandlers`.
	 * Pass `cronOptions.specs` to use a different source, including future
	 * workspace-scoped specs.
	 */
	cronOptions?: Omit<CronServiceOptions, "runtimeHandlers">;
	/**
	 * Custom `fetch` implementation forwarded to the internally-constructed
	 * `LocalRuntimeHost` that executes incoming `session.create` traffic.
	 * Used by the AI gateway providers for every session that runs inside
	 * this hub process.
	 *
	 * Ignored when `sessionHost` is supplied — in that case the caller owns
	 * runtime construction and is responsible for wiring its own fetch.
	 */
	fetch?: typeof fetch;
	/**
	 * Telemetry forwarded to the internally-constructed `LocalRuntimeHost`.
	 * Ignored when `sessionHost` is supplied.
	 */
	telemetry?: ITelemetryService;
	/**
	 * Structured logger forwarded to the internally-constructed local runtime.
	 * Ignored when `sessionHost` is supplied.
	 */
	logger?: BasicLogger;
	/**
	 * How long the hub waits for an answer to a tool approval before auto-denying
	 * it with reason `approval_timeout`. Defaults to
	 * `DEFAULT_HUB_APPROVAL_TIMEOUT_MS` (15 minutes).
	 */
	approvalTimeoutMs?: number;
	/**
	 * How much an authenticated connection is trusted with other clients' sessions.
	 * Defaults to the conservative `"session-scoped"`; `startHubWebSocketServer`
	 * sets it explicitly from its bind host. See {@link HubSessionTrustModel}.
	 */
	sessionTrustModel?: HubSessionTrustModel;
	/**
	 * Client ids permitted to `session.attach` to sessions they did not create —
	 * the hub's enrollment list for known devices/clients. Ignored when
	 * {@link HubWebSocketServerOptions.authorizeAttach} is supplied.
	 */
	attachAllowlist?: readonly string[];
	/**
	 * Replaces the built-in attach rule. Supplied by layers that have a stronger
	 * notion of identity than a self-declared client id (device pairing, relay
	 * enrollment). See {@link HubAttachAuthorizer}.
	 */
	authorizeAttach?: HubAttachAuthorizer;
	/**
	 * The hub's device-pairing authority — the second authentication path, beside
	 * the durable `cline-hub-auth.<token>` subprotocol.
	 *
	 * Defaults to the on-disk one under `~/.cline/.../hub/pairing/`, which is the
	 * same directory `cline hub share` writes offers into. Pass `false` to serve a
	 * token-only hub, or an explicit authority (or {@link
	 * HubWebSocketServerOptions.pairingDir}) to point a test at a throwaway tree
	 * instead of the developer's real identity key.
	 */
	pairing?: HubPairingAuthority | false;
	/** Pairing directory for the default authority. Ignored when `pairing` is set. */
	pairingDir?: string;
	/**
	 * Notifies the owning process of an authenticated `/shutdown` request before
	 * the server begins its memoized close. The daemon uses this to route HTTP,
	 * signals, and fatal errors through one shutdown coordinator.
	 */
	onShutdownRequested?: () => void | Promise<void>;
	/**
	 * Durable event log configuration. Pass `false` to disable persistence
	 * (events become fire-and-forget, the pre-log behavior; `stream.subscribe`
	 * replay cursors are then best-effort no-ops).
	 */
	eventLog?: HubEventLogOptions | false;
	/** Durable run queue configuration (`run.enqueue`). */
	runQueue?: HubRunQueueOptions | false;
}

export interface HubWebSocketServer {
	host: string;
	port: number;
	url: string;
	authToken: string;
	/**
	 * Starts the memoized two-phase close. Runtime/session teardown is exposed
	 * separately so daemon telemetry can remain available until it completes,
	 * even when the listener close is stalled by the runtime.
	 */
	beginClose(): HubWebSocketServerClose;
	close(): Promise<void>;
}

export interface HubWebSocketServerClose {
	transportStopped: Promise<void>;
	closed: Promise<void>;
}

export interface EnsureHubWebSocketServerOptions
	extends HubWebSocketServerOptions {
	allowPortFallback?: boolean;
}

export interface EnsuredHubWebSocketServerResult {
	server?: HubWebSocketServer;
	url: string;
	authToken?: string;
	action: "reuse" | "started";
}
