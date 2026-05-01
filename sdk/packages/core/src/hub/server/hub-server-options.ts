import type { CronServiceOptions } from "../../cron/service/cron-service";
import type {
	HubScheduleRuntimeHandlers,
	HubScheduleServiceOptions,
} from "../../cron/service/schedule-service";
import type {
	PendingPromptsRuntimeService,
	RuntimeHost,
} from "../../runtime/host/runtime-host";
import type { CoreSettingsService } from "../../settings";
import type { HubOwnerContext } from "../discovery";

export interface HubWebSocketServerOptions {
	host?: string;
	port?: number;
	pathname?: string;
	owner?: HubOwnerContext;
	sessionHost?: RuntimeHost & Partial<PendingPromptsRuntimeService>;
	settingsService?: CoreSettingsService;
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
}

export interface HubWebSocketServer {
	host: string;
	port: number;
	url: string;
	authToken: string;
	close(): Promise<void>;
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
