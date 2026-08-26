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
import type { CoreSettingsService } from "../../settings";
import type { AgendaTaskManagerOptions } from "../../tasks";
import type { HubOwnerContext } from "../discovery";
import type { HubEventLogOptions } from "./hub-event-log";
import type { HubRunQueueOptions } from "./hub-run-queue";

export interface HubWebSocketServerOptions {
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
