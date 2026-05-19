import type { Message } from "@cline/llms";
import type {
	AgentConfig,
	AutomationEventEnvelope,
	BasicLogger,
	ITelemetryService,
} from "@cline/shared";
import type { CronEventSuppression } from "../cron/events/cron-event-ingress";
import type {
	CronEventLogRecord,
	CronRunRecord,
	CronSpecRecord,
} from "../cron/store/sqlite-cron-store";
import type { CheckpointEntry } from "../hooks/checkpoint-hooks";
import type { RuntimeCapabilities } from "../runtime/capabilities";
import type { SessionHistoryListOptions } from "../runtime/host/history";
import type { SessionBackend } from "../runtime/host/host";
import type {
	LocalRuntimeStartOptions,
	RuntimeHostMode,
	StartSessionInput,
	StartSessionResult,
} from "../runtime/host/runtime-host";
import type { CoreSessionConfig } from "../types/config";
import type { SessionMessagesArtifactUploader } from "../types/session";

export type { RuntimeHostMode } from "../runtime/host/runtime-host";
export type { ClineCoreSettingsApi } from "../settings";

export interface HubOptions {
	endpoint?: string;
	authToken?: string;
	strategy?: "prefer-hub" | "require-hub";
	clientType?: string;
	displayName?: string;
	workspaceRoot?: string;
	cwd?: string;
}

export interface RemoteOptions {
	endpoint: string;
	authToken?: string;
	clientType?: string;
	displayName?: string;
	workspaceRoot?: string;
	cwd?: string;
}

export interface ClineCoreAutomationOptions {
	/** @deprecated Use `cronSpecsDir`. */
	cronDir?: string;
	cronSpecsDir?: string;
	/** @deprecated Reports are written under the resolved cron specs directory. */
	reportsDir?: string;
	cronScope?: "global" | "user" | "workspace";
	workspaceRoot?: string;
	dbPath?: string;
	pollIntervalMs?: number;
	claimLeaseSeconds?: number;
	globalMaxConcurrency?: number;
	watcherDebounceMs?: number;
	autoStart?: boolean;
}

export type ClineAutomationSpec = CronSpecRecord;
export type ClineAutomationRun = CronRunRecord;
export type ClineAutomationEventLog = CronEventLogRecord;
export type ClineAutomationEventSuppression = CronEventSuppression;
export type ClineAutomationRunStatus =
	| "queued"
	| "running"
	| "done"
	| "failed"
	| "cancelled";

export interface ClineAutomationListSpecsOptions {
	triggerKind?: "one_off" | "schedule" | "event";
	enabled?: boolean;
	parseStatus?: "valid" | "invalid";
	includeRemoved?: boolean;
	limit?: number;
}

export interface ClineAutomationListRunsOptions {
	specId?: string;
	status?: ClineAutomationRunStatus | ClineAutomationRunStatus[];
	limit?: number;
}

export interface ClineAutomationListEventsOptions {
	eventType?: string;
	source?: string;
	processingStatus?:
		| "received"
		| "unmatched"
		| "queued"
		| "suppressed"
		| "failed";
	limit?: number;
}

export interface ClineAutomationEventIngressResult {
	event: ClineAutomationEventLog;
	duplicate: boolean;
	matchedSpecIds: string[];
	queuedRuns: ClineAutomationRun[];
	suppressions: ClineAutomationEventSuppression[];
}

export interface ClineCoreAutomationApi {
	start(): Promise<void>;
	stop(): Promise<void>;
	reconcileNow(): Promise<void>;
	ingestEvent(
		event: AutomationEventEnvelope,
	): ClineAutomationEventIngressResult;
	listEvents(
		options?: ClineAutomationListEventsOptions,
	): ClineAutomationEventLog[];
	getEvent(eventId: string): ClineAutomationEventLog | undefined;
	listSpecs(options?: ClineAutomationListSpecsOptions): ClineAutomationSpec[];
	listRuns(options?: ClineAutomationListRunsOptions): ClineAutomationRun[];
}

export type ClineCoreListHistoryOptions = SessionHistoryListOptions;

export interface ClineCoreStartInput
	extends Omit<StartSessionInput, "config" | "localRuntime"> {
	config: CoreSessionConfig;
	localRuntime?: LocalRuntimeStartOptions;
}

export interface RestoreOptions {
	/**
	 * Restore the message history by starting a new session fork trimmed to
	 * `checkpointRunCount`. Defaults to true.
	 */
	messages?: boolean;
	/**
	 * Restore the workspace files from the checkpoint's git snapshot.
	 * Defaults to true.
	 */
	workspace?: boolean;
	/**
	 * Start the forked session with messages before the checkpoint user message
	 * while still returning messages through that user message. This is for
	 * clients that put the checkpoint message back into a compose box so it can
	 * be edited and submitted again without duplicating it in session history.
	 */
	omitCheckpointMessageFromSession?: boolean;
}

export interface RestoreInput {
	sessionId: string;
	checkpointRunCount: number;
	start?: ClineCoreStartInput;
	cwd?: string;
	restore?: RestoreOptions;
}

export interface RestoreResult {
	sessionId?: string;
	startResult?: StartSessionResult;
	messages?: Message[];
	checkpoint: CheckpointEntry;
}

export interface ClineCoreOptions {
	/**
	 * A human-readable name for this SDK client (e.g. `"my-app"`, `"acme-bot"`).
	 * Used to identify the consumer in telemetry and logs.
	 */
	clientName?: string;
	/**
	 * A stable identifier for this machine or user, used for telemetry attribution.
	 * Defaults to the system machine ID, falling back to a generated `cl-<nanoid>` persisted
	 * at `~/.cline/data/machine-id`.
	 */
	distinctId?: string;
	/**
	 * Controls how the runtime host is selected:
	 * - `"auto"` (default) — prefers a compatible local hub when one is available and falls
	 *   back to local in-process execution when not.
	 * - `"hub"` — requires a compatible websocket hub runtime; throws if one is not reachable.
	 * - `"remote"` — requires an explicit remote websocket hub endpoint.
	 * - `"local"` — always uses local in-process execution and local SQLite/file storage.
	 */
	backendMode?: RuntimeHostMode;
	/**
	 * Hub runtime connection options. Used when `backendMode` is `"hub"` or when `"auto"`
	 * should prefer a shared local hub if available.
	 */
	hub?: HubOptions;
	/**
	 * Remote hub connection options. Only relevant when `backendMode` is `"remote"`.
	 */
	remote?: RemoteOptions;
	/**
	 * Client-owned runtime capabilities. Core adapts these handlers to the
	 * selected runtime backend so apps implement interactive behavior once.
	 */
	capabilities?: RuntimeCapabilities;
	/**
	 * Telemetry service instance to use for capturing events and usage.
	 * If omitted, telemetry is a no-op.
	 */
	telemetry?: ITelemetryService;
	/**
	 * Optional structured logger for core-side operational diagnostics such as
	 * runtime-host selection and fallback decisions.
	 */
	logger?: BasicLogger;
	/**
	 * Per-tool approval policies that control whether a tool runs automatically,
	 * requires user confirmation, or is blocked entirely.
	 */
	toolPolicies?: AgentConfig["toolPolicies"];
	/**
	 * Optional hook invoked after `messages.json` is persisted to disk.
	 * Consumers can use this to mirror session transcripts into remote storage.
	 */
	messagesArtifactUploader?: SessionMessagesArtifactUploader;
	/**
	 * Enables file-based and event-driven automation through this ClineCore
	 * instance. When configured, callers use `cline.automation.*` instead of
	 * constructing cron services directly.
	 */
	automation?: boolean | ClineCoreAutomationOptions;
	/**
	 * Custom `fetch` implementation forwarded to the AI gateway providers used
	 * by local sessions. When supplied, it is threaded into each
	 * `ProviderConfig.fetch` built during session bootstrap, which in turn
	 * populates `GatewayProviderSettings.fetch` (and the top-level
	 * `GatewayConfig.fetch` fallback) so hosts can inject custom HTTP behavior
	 * such as proxies, retries, tracing, or test doubles.
	 *
	 * Per-session or per-provider overrides still win: an explicit
	 * `config.fetch` on `CoreSessionConfig` or a stored provider-level `fetch`
	 * takes precedence over this default.
	 *
	 * Applies only to sessions executed in this process (local and fallback-
	 * to-local auto mode). For hub and remote runtimes the HTTP call happens
	 * inside the process that owns the gateway, so configure `fetch` there:
	 *   - `startHubServer({ fetch })` / `ensureHubServer({ fetch })` from
	 *     `@cline/hub`
	 *   - `createLocalHubScheduleRuntimeHandlers({ fetch })` from
	 *     `@cline/core/hub` for the scheduler
	 */
	fetch?: typeof fetch;
	/**
	 * An already-constructed session backend to use instead of resolving one automatically.
	 * Intended for testing or embedding a custom persistence layer.
	 * @internal
	 */
	sessionService?: SessionBackend;
	/**
	 * Optional hook invoked before each session starts.
	 * Use this to prepare workspace-scoped runtime state and then return an
	 * adapter that mutates the shared session input before core starts the run.
	 */
	prepare?: (
		input: ClineCoreStartInput,
	) =>
		| Promise<StartSessionBootstrap | undefined>
		| StartSessionBootstrap
		| undefined;
}

export interface StartSessionBootstrap {
	applyToStartSessionInput(
		input: ClineCoreStartInput,
	): Promise<ClineCoreStartInput> | ClineCoreStartInput;
	dispose?(): Promise<void> | void;
}
