import type {
	AgentConfig,
	AgentExtensionAutomationContext,
	AgentResult,
	AutomationEventEnvelope,
	BasicLogger,
	ChatRunTurnRequest,
	ChatStartSessionRequest,
	ChatTurnResult,
	ExtensionContext,
	ITelemetryService,
	ToolApprovalRequest,
	ToolApprovalResult,
} from "@clinebot/shared";
import type {
	CronEventIngressResult,
	CronEventSuppression,
} from "./cron/events/cron-event-ingress";
import { CronService } from "./cron/service/cron-service";
import type { HubScheduleRuntimeHandlers } from "./cron/service/schedule-service";
import type {
	CronEventLogRecord,
	CronRunRecord,
	CronSpecRecord,
} from "./cron/store/sqlite-cron-store";
import type { ToolExecutors } from "./extensions/tools";
import type { CheckpointEntry } from "./hooks/checkpoint-hooks";
import type { SessionHistoryListOptions } from "./runtime/host/history";
import { listSessionHistory } from "./runtime/host/history";
import type { SessionBackend } from "./runtime/host/host";
import { createRuntimeHost } from "./runtime/host/host";
import type {
	LocalRuntimeStartOptions,
	PendingPromptMutationResult,
	PendingPromptsAction,
	PendingPromptsDeleteInput,
	PendingPromptsListInput,
	PendingPromptsUpdateInput,
	RuntimeHost,
	RuntimeHostMode,
	RuntimeHostSubscribeOptions,
	StartSessionInput,
	StartSessionResult,
} from "./runtime/host/runtime-host";
import { splitCoreSessionConfig } from "./runtime/host/runtime-host";
import { normalizeProviderId } from "./services/llms/provider-settings";
import { CORE_TELEMETRY_EVENTS } from "./services/telemetry/core-events";
import {
	applyCheckpointToWorktree,
	createCheckpointRestorePlan,
} from "./session/checkpoint-restore";
import { SessionSource } from "./types/common";
import type { CoreSessionConfig } from "./types/config";
import type { CoreSessionEvent, SessionPendingPrompt } from "./types/events";
import type { SessionMessagesArtifactUploader } from "./types/session";
import type { SessionHistoryRecord } from "./types/sessions";

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
	ingestEvent(event: any): ClineAutomationEventIngressResult;
	listEvents(
		options?: ClineAutomationListEventsOptions,
	): ClineAutomationEventLog[];
	getEvent(eventId: string): ClineAutomationEventLog | undefined;
	listSpecs(options?: ClineAutomationListSpecsOptions): ClineAutomationSpec[];
	listRuns(options?: ClineAutomationListRunsOptions): ClineAutomationRun[];
}

export type { RuntimeHostMode };

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
	messages?: import("@clinebot/llms").Message[];
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
	 * Override one or more default tool executors (e.g. file I/O, shell, browser).
	 * Partial — only the keys you supply are replaced; the rest use built-in implementations.
	 */
	defaultToolExecutors?: Partial<ToolExecutors>;
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
	 * Called before any tool is executed that requires explicit user approval.
	 * Return `{ approved: true }` to allow or `{ approved: false }` to deny.
	 * If omitted, all approval-required tools are auto-denied.
	 */
	requestToolApproval?: (
		request: ToolApprovalRequest,
	) => Promise<ToolApprovalResult>;
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
	 *     `@clinebot/hub`
	 *   - `createLocalHubScheduleRuntimeHandlers({ fetch })` from
	 *     `@clinebot/core/hub` for the scheduler
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

function normalizeAutomationOptions(
	options: ClineCoreOptions["automation"],
): ClineCoreAutomationOptions | undefined {
	if (options === true) return {};
	if (!options) return undefined;
	return options;
}

function normalizeAutomationCronScope(
	scope: ClineCoreAutomationOptions["cronScope"],
): "global" | "workspace" | undefined {
	if (scope === "user") return "global";
	return scope;
}

function toChatTurnResult(result: AgentResult): ChatTurnResult {
	return {
		text: result.text,
		usage: {
			inputTokens: result.usage.inputTokens,
			outputTokens: result.usage.outputTokens,
			cacheReadTokens: result.usage.cacheReadTokens,
			cacheWriteTokens: result.usage.cacheWriteTokens,
			totalCost: result.usage.totalCost,
		},
		inputTokens: result.usage.inputTokens,
		outputTokens: result.usage.outputTokens,
		iterations: result.iterations,
		finishReason: result.finishReason,
		toolCalls: result.toolCalls.map((call) => ({
			name: call.name,
			input: call.input,
			output: call.output,
			error: call.error,
			durationMs: call.durationMs,
		})),
	};
}

function resolveMode(
	request: ChatStartSessionRequest | ChatRunTurnRequest["config"],
): "act" | "plan" | "yolo" {
	return request.mode === "plan"
		? "plan"
		: request.mode === "yolo"
			? "yolo"
			: "act";
}

class ClineCoreAutomationController implements ClineCoreAutomationApi {
	constructor(private readonly getService: () => CronService) {}

	async start(): Promise<void> {
		await this.getService().start();
	}

	async stop(): Promise<void> {
		await this.getService().stop();
	}

	async reconcileNow(): Promise<void> {
		await this.getService().reconcileNow();
	}

	ingestEvent(
		event: AutomationEventEnvelope,
	): ClineAutomationEventIngressResult {
		const result: CronEventIngressResult = this.getService().ingestEvent(event);
		return {
			event: result.event,
			duplicate: result.duplicate,
			matchedSpecIds: result.matchedSpecs.map((spec) => spec.specId),
			queuedRuns: result.queuedRuns,
			suppressions: result.suppressions,
		};
	}

	listEvents(
		options?: ClineAutomationListEventsOptions,
	): ClineAutomationEventLog[] {
		return this.getService().listEventLogs(options);
	}

	getEvent(eventId: string): ClineAutomationEventLog | undefined {
		return this.getService().getEventLog(eventId);
	}

	listSpecs(options?: ClineAutomationListSpecsOptions): ClineAutomationSpec[] {
		return this.getService().listSpecs(options);
	}

	listRuns(options?: ClineAutomationListRunsOptions): ClineAutomationRun[] {
		return this.getService().listRuns(options);
	}
}

/**
 * The primary entry point for the Cline Core SDK.
 *
 * @example
 * ```ts
 * import { ClineCore } from "@clinebot/core";
 *
 * const cline = await ClineCore.create({ clientName: "my-app" });
 * const session = await cline.start({ ... });
 * ```
 */
export class ClineCore implements RuntimeHost {
	readonly clientName: string | undefined;
	readonly runtimeAddress: string | undefined;
	readonly automation: ClineCoreAutomationApi;
	private readonly host: RuntimeHost;
	private readonly prepare: ClineCoreOptions["prepare"] | undefined;
	private readonly defaultToolExecutors: Partial<ToolExecutors> | undefined;
	private readonly logger: BasicLogger | undefined;
	private readonly telemetry: ITelemetryService | undefined;
	private readonly distinctId: string | undefined;
	private readonly automationService: CronService | undefined;
	private readonly activeSessionBootstraps = new Map<
		string,
		StartSessionBootstrap
	>();
	private readonly unsubscribeBootstrapCleanup: () => void;

	private constructor(
		host: RuntimeHost,
		clientName: string | undefined,
		runtimeAddress: string | undefined,
		prepare: ClineCoreOptions["prepare"],
		defaultToolExecutors: Partial<ToolExecutors> | undefined,
		logger: BasicLogger | undefined,
		telemetry: ITelemetryService | undefined,
		distinctId: string | undefined,
		automationOptions:
			| (ClineCoreAutomationOptions & { logger?: BasicLogger })
			| undefined,
	) {
		this.clientName = clientName;
		this.runtimeAddress = runtimeAddress;
		this.host = host;
		this.prepare = prepare;
		this.defaultToolExecutors = defaultToolExecutors;
		this.logger = logger;
		this.telemetry = telemetry;
		this.distinctId = distinctId;
		this.automationService = automationOptions
			? new CronService({
					workspaceRoot: automationOptions.workspaceRoot ?? process.cwd(),
					specs: {
						cronSpecsDir:
							automationOptions.cronSpecsDir ?? automationOptions.cronDir,
						scope: normalizeAutomationCronScope(automationOptions.cronScope),
						workspaceRoot: automationOptions.workspaceRoot,
					},
					runtimeHandlers: this.createAutomationRuntimeHandlers(host),
					dbPath: automationOptions.dbPath,
					logger: automationOptions.logger,
					pollIntervalMs: automationOptions.pollIntervalMs,
					claimLeaseSeconds: automationOptions.claimLeaseSeconds,
					globalMaxConcurrency: automationOptions.globalMaxConcurrency,
					watcherDebounceMs: automationOptions.watcherDebounceMs,
				})
			: undefined;
		this.automation = new ClineCoreAutomationController(() => {
			if (!this.automationService) {
				throw new Error(
					"ClineCore automation is not enabled. Pass `automation: true` or automation options to ClineCore.create().",
				);
			}
			return this.automationService;
		});
		this.unsubscribeBootstrapCleanup = this.host.subscribe((event) => {
			if (event.type !== "ended") {
				return;
			}
			void this.disposeSessionBootstrap(event.payload.sessionId);
		});
	}

	/**
	 * Creates a new ClineCore instance.
	 *
	 * This is the primary factory method for initializing the SDK. It sets up the runtime
	 * host (local, hub, or remote) based on the provided options and prepares the SDK for
	 * starting sessions.
	 *
	 * @param options Configuration options for the SDK instance
	 * @returns A promise that resolves to a new ClineCore instance
	 *
	 * @example
	 * ```ts
	 * const cline = await ClineCore.create({
	 *   clientName: "my-app",
	 *   backendMode: "local",
	 * });
	 * ```
	 */
	static async create(options: ClineCoreOptions = {}): Promise<ClineCore> {
		const host = await createRuntimeHost(options);
		const automationOptions = normalizeAutomationOptions(options.automation);
		const core = new ClineCore(
			host,
			options.clientName,
			host.runtimeAddress,
			options.prepare,
			options.defaultToolExecutors,
			options.logger,
			options.telemetry,
			options.distinctId,
			automationOptions
				? { ...automationOptions, logger: options.logger }
				: undefined,
		);
		if (automationOptions && automationOptions.autoStart !== false) {
			await core.automation.start();
		}
		return core;
	}

	private createAutomationRuntimeHandlers(
		host: RuntimeHost,
	): HubScheduleRuntimeHandlers {
		const core = this;
		return {
			async startSession(request) {
				const cwd = (request.cwd?.trim() || request.workspaceRoot).trim();
				const started = await host.start({
					source: request.source?.trim() || SessionSource.CLI,
					interactive: false,
					config: {
						providerId: normalizeProviderId(request.provider),
						modelId: request.model,
						apiKey: request.apiKey?.trim() || undefined,
						cwd,
						workspaceRoot: request.workspaceRoot,
						systemPrompt: request.systemPrompt ?? "",
						mode: resolveMode(request),
						maxIterations: request.maxIterations,
						enableTools: request.enableTools !== false,
						enableSpawnAgent: request.enableSpawn !== false,
						enableAgentTeams: request.enableTeams !== false,
						disableMcpSettingsTools: request.disableMcpSettingsTools,
						missionLogIntervalSteps: request.missionStepInterval,
						missionLogIntervalMs: request.missionTimeIntervalMs,
					},
					toolPolicies: request.toolPolicies ?? {
						"*": {
							autoApprove: request.autoApproveTools !== false,
						},
					},
					localRuntime: {
						configOverrides: {
							extensionContext: core.withAutomationExtensionContext(),
						},
						configExtensions: request.configExtensions,
					},
				});
				return {
					sessionId: started.sessionId,
					startResult: {
						sessionId: started.sessionId,
						manifestPath: started.manifestPath,
						messagesPath: started.messagesPath,
					},
				};
			},
			async sendSession(sessionId, request) {
				const result = await host.send({
					sessionId,
					prompt: request.prompt,
					userImages: request.attachments?.userImages,
					userFiles: request.attachments?.userFiles?.map(
						(file) => file.content,
					),
					delivery: request.delivery,
				});
				if (!result) {
					throw new Error("ClineCore automation runtime returned no result");
				}
				return { result: toChatTurnResult(result) };
			},
			async abortSession(sessionId) {
				await host.abort(sessionId, new Error("ClineCore automation abort"));
				return { applied: true };
			},
			async stopSession(sessionId) {
				await host.stop(sessionId);
				return { applied: true };
			},
		};
	}

	private createAutomationPluginContext():
		| AgentExtensionAutomationContext
		| undefined {
		if (!this.automationService) {
			return undefined;
		}
		return {
			ingestEvent: (event: AutomationEventEnvelope) => {
				this.automation.ingestEvent(event);
			},
		};
	}

	private withAutomationExtensionContext(
		context?: ExtensionContext,
	): ExtensionContext | undefined {
		const automation = this.createAutomationPluginContext();
		const client =
			context?.client ??
			(this.clientName ? { name: this.clientName } : undefined);
		const user =
			context?.user ??
			(this.distinctId ? { distinctId: this.distinctId } : undefined);
		const logger = context?.logger ?? this.logger;
		const telemetry = context?.telemetry ?? this.telemetry;
		if (!automation && !client && !user && !logger && !telemetry) {
			return context;
		}
		return {
			...(context ?? {}),
			...(client ? { client } : {}),
			...(user ? { user } : {}),
			...(logger ? { logger } : {}),
			...(telemetry ? { telemetry } : {}),
			...(automation ? { automation } : {}),
		};
	}

	private async disposeSessionBootstrap(sessionId: string): Promise<void> {
		const bootstrap = this.activeSessionBootstraps.get(sessionId);
		if (!bootstrap) {
			return;
		}
		this.activeSessionBootstraps.delete(sessionId);
		await Promise.resolve(bootstrap.dispose?.());
	}

	private toClineCoreStartInput(
		input: StartSessionInput | ClineCoreStartInput,
	): ClineCoreStartInput {
		const config = input.config as CoreSessionConfig;
		return "providerId" in config
			? {
					...input,
					config: {
						...config,
						...(input.localRuntime?.configOverrides ?? {}),
					},
					localRuntime: input.localRuntime
						? {
								...input.localRuntime,
								configOverrides: input.localRuntime.configOverrides,
							}
						: undefined,
				}
			: (input as ClineCoreStartInput);
	}

	private normalizeStartInput(input: ClineCoreStartInput): StartSessionInput {
		const split = splitCoreSessionConfig(input.config);
		let localRuntime: LocalRuntimeStartOptions | undefined =
			split.localRuntime || input.localRuntime || this.defaultToolExecutors
				? {
						...(split.localRuntime ?? {}),
						...(input.localRuntime ?? {}),
						configOverrides: {
							...(split.localRuntime?.configOverrides ?? {}),
							...(input.localRuntime?.configOverrides ?? {}),
						},
						defaultToolExecutors: {
							...(this.defaultToolExecutors ?? {}),
							...(split.localRuntime?.defaultToolExecutors ?? {}),
							...(input.localRuntime?.defaultToolExecutors ?? {}),
						},
					}
				: undefined;
		const automationExtensionContext = this.withAutomationExtensionContext(
			localRuntime?.configOverrides?.extensionContext,
		);
		if (automationExtensionContext) {
			localRuntime = {
				...(localRuntime ?? {}),
				configOverrides: {
					...(localRuntime?.configOverrides ?? {}),
					extensionContext: automationExtensionContext,
				},
			};
		}
		return {
			...input,
			...split,
			...(localRuntime ? { localRuntime } : {}),
		};
	}

	/**
	 * Starts a new Cline session with the provided configuration.
	 *
	 * This method initializes and begins a new agent session. It handles session setup,
	 * runs any preparation hooks, and returns session metadata along with event streams.
	 * The session continues to run until explicitly stopped or aborted.
	 *
	 * @param input The session configuration and startup parameters
	 * @returns A promise that resolves to session metadata and event stream
	 *
	 * @example
	 * ```ts
	 * const result = await cline.start({
	 *   config: {
	 *     providerId: "anthropic",
	 *     modelId: "claude-opus-4-1",
	 *   },
	 * });
	 *
	 * // Subscribe to session events
	 * result.subscribe((event) => {
	 *   console.log("Session event:", event);
	 * });
	 * ```
	 */
	start(input: StartSessionInput): Promise<StartSessionResult>;
	/**
	 * Starts a new Cline session with extended core-specific configuration.
	 * This overload allows specifying local runtime options and config overrides.
	 */
	start(input: ClineCoreStartInput): Promise<StartSessionResult>;
	async start(
		input: StartSessionInput | ClineCoreStartInput,
	): Promise<StartSessionResult> {
		const clineCoreInput = this.toClineCoreStartInput(input);
		const bootstrap = await this.prepare?.(clineCoreInput);
		try {
			const preparedInput = bootstrap
				? await bootstrap.applyToStartSessionInput(clineCoreInput)
				: clineCoreInput;
			const result = await this.host.start(
				this.normalizeStartInput(preparedInput),
			);
			if (bootstrap) {
				const activeSession = await this.host.get(result.sessionId);
				if (activeSession) {
					this.activeSessionBootstraps.set(result.sessionId, bootstrap);
				} else {
					await Promise.resolve(bootstrap.dispose?.());
				}
			}
			this.emitSessionStartedTelemetry(preparedInput, result.sessionId);
			return result;
		} catch (error) {
			await Promise.resolve(bootstrap?.dispose?.());
			throw error;
		}
	}

	private emitSessionStartedTelemetry(
		input: ClineCoreStartInput,
		sessionId: string,
	): void {
		// Per-session telemetry override (passed via `CoreSessionConfig.telemetry`)
		// takes precedence over the instance-wide telemetry service configured
		// on `ClineCore.create`. Either way we fire a single `session.started`
		// event here so the signal is emitted for every backend (local, hub,
		// remote), not just the in-process local transport.
		const telemetry = input.config.telemetry ?? this.telemetry;
		if (!telemetry) {
			return;
		}
		telemetry.capture({
			event: CORE_TELEMETRY_EVENTS.SESSION.STARTED,
			properties: {
				sessionId,
				source: input.source ?? SessionSource.CORE,
				providerId: input.config.providerId,
				modelId: input.config.modelId,
				enableTools: input.config.enableTools,
				enableSpawnAgent: input.config.enableSpawnAgent,
				enableAgentTeams: input.config.enableAgentTeams,
				clientName: this.clientName,
				runtimeAddress: this.runtimeAddress,
			},
		});
	}
	/**
	 * Sends a message or command to an active session.
	 *
	 * This method communicates with a running session, allowing you to send user messages,
	 * tool responses, or other session input while the session is in progress.
	 *
	 * @example
	 * ```ts
	 * await cline.send(sessionId, {
	 *   type: "user_message",
	 *   text: "Please implement the login feature",
	 * });
	 * ```
	 */
	send: RuntimeHost["send"] = (...args) => this.host.send(...args);
	pendingPrompts(
		action: "list",
		input: PendingPromptsListInput,
	): Promise<SessionPendingPrompt[]>;
	pendingPrompts(
		action: "update",
		input: PendingPromptsUpdateInput,
	): Promise<PendingPromptMutationResult>;
	pendingPrompts(
		action: "delete",
		input: PendingPromptsDeleteInput,
	): Promise<PendingPromptMutationResult>;
	pendingPrompts(
		action: PendingPromptsAction,
		input:
			| PendingPromptsListInput
			| PendingPromptsUpdateInput
			| PendingPromptsDeleteInput,
	): Promise<SessionPendingPrompt[] | PendingPromptMutationResult> {
		switch (action) {
			case "list":
				return this.host.pendingPrompts(
					"list",
					input as PendingPromptsListInput,
				);
			case "update":
				return this.host.pendingPrompts(
					"update",
					input as PendingPromptsUpdateInput,
				);
			case "delete":
				return this.host.pendingPrompts(
					"delete",
					input as PendingPromptsDeleteInput,
				);
		}
	}
	/**
	 * Retrieves accumulated token and cost usage for a session.
	 *
	 * Returns metrics about the session's resource consumption, including tokens used
	 * across different API providers and associated costs. Useful for monitoring and billing.
	 *
	 * @example
	 * ```ts
	 * const usage = await cline.getAccumulatedUsage(sessionId);
	 * console.log(`Total cost: $${usage.totalCost}`);
	 * ```
	 */
	getAccumulatedUsage: RuntimeHost["getAccumulatedUsage"] = (...args) =>
		this.host.getAccumulatedUsage(...args);
	/**
	 * Aborts an in-flight tool execution without stopping the session.
	 *
	 * Interrupts the current tool operation (e.g., file read, shell command) while keeping
	 * the session alive. The session can continue processing after the abort. Use this for
	 * cancelling long-running operations.
	 *
	 * @example
	 * ```ts
	 * // Stop the current operation but keep the session running
	 * await cline.abort(sessionId);
	 * ```
	 */
	abort: RuntimeHost["abort"] = (...args) => this.host.abort(...args);
	/**
	 * Stops an active session gracefully.
	 *
	 * Terminates the session and cleans up associated resources. Unlike abort, this
	 * completely ends the session. The session cannot be resumed after stopping.
	 *
	 * @example
	 * ```ts
	 * // Cleanly shutdown the session
	 * await cline.stop(sessionId);
	 * ```
	 */
	stop: RuntimeHost["stop"] = async (sessionId) => {
		await this.host.stop(sessionId);
		await this.disposeSessionBootstrap(sessionId);
	};
	/**
	 * Disposes the ClineCore instance and all associated resources.
	 *
	 * Shuts down the runtime host, closes connections, and cleans up all active sessions
	 * and bootstraps. Call this when you're done using the SDK instance, typically at
	 * application shutdown. After calling dispose, the instance cannot be reused.
	 *
	 * @example
	 * ```ts
	 * // Clean up when done
	 * await cline.dispose();
	 * ```
	 */
	dispose: RuntimeHost["dispose"] = async (...args) => {
		try {
			await this.automationService?.dispose();
			await this.host.dispose(...args);
		} finally {
			this.unsubscribeBootstrapCleanup();
			const sessionIds = [...this.activeSessionBootstraps.keys()];
			await Promise.allSettled(
				sessionIds.map((sessionId) => this.disposeSessionBootstrap(sessionId)),
			);
		}
	};
	/**
	 * Retrieves information about a specific session by ID.
	 *
	 * Fetches the current metadata and state of a session, including configuration,
	 * status, and other session details.
	 *
	 * @example
	 * ```ts
	 * const session = await cline.get(sessionId);
	 * console.log("Session status:", session?.status);
	 * ```
	 */
	get: RuntimeHost["get"] = (...args) => this.host.get(...args);
	/**
	 * Lists recent sessions through the shared history-listing path.
	 */
	listHistory = async (
		options: ClineCoreListHistoryOptions = {},
	): Promise<SessionHistoryRecord[]> =>
		await listSessionHistory(this.host, options);
	/**
	 * Lists recent sessions with inferred history display metadata.
	 *
	 * Retrieves a paginated list of recent sessions, optionally limited by the
	 * provided count.
	 *
	 * @param limit Maximum number of sessions to return (defaults to 200)
	 * @returns A promise resolving to an array of session history records
	 *
	 * @example
	 * ```ts
	 * const sessions = await cline.list(50);
	 * sessions.forEach((session) => {
	 *   console.log(`Session ${session.sessionId}: ${session.metadata?.title}`);
	 * });
	 * ```
	 */
	list = async (
		limit = 200,
		options: Omit<ClineCoreListHistoryOptions, "limit"> = {},
	): Promise<SessionHistoryRecord[]> =>
		await this.listHistory({ ...options, limit });
	/**
	 * Permanently deletes a session and all its associated data.
	 *
	 * Removes the session from storage and cleans up any related resources. This is
	 * a destructive operation that cannot be undone.
	 *
	 * @param sessionId The ID of the session to delete
	 * @returns A promise that resolves to true if the session was deleted, false if not found
	 *
	 * @example
	 * ```ts
	 * const deleted = await cline.delete(sessionId);
	 * if (deleted) {
	 *   console.log("Session deleted successfully");
	 * }
	 * ```
	 */
	delete: RuntimeHost["delete"] = async (sessionId) => {
		const deleted = await this.host.delete(sessionId);
		if (deleted) {
			await this.disposeSessionBootstrap(sessionId);
		}
		return deleted;
	};
	/**
	 * Updates an existing session's metadata.
	 *
	 * Modifies session properties like title or other mutable metadata while preserving
	 * message history and other session data.
	 *
	 * @example
	 * ```ts
	 * await cline.update(sessionId, {
	 *   title: "Updated session title",
	 * });
	 * ```
	 */
	update: RuntimeHost["update"] = (...args) => this.host.update(...args);
	/**
	 * Reads message history for a session.
	 *
	 * Retrieves the full message transcript for a specific session, including all
	 * user messages, agent responses, and tool interactions.
	 *
	 * @example
	 * ```ts
	 * const messages = await cline.readMessages(sessionId);
	 * messages.forEach((msg) => {
	 *   console.log(`${msg.role}: ${msg.content}`);
	 * });
	 * ```
	 */
	readMessages: RuntimeHost["readMessages"] = (...args) =>
		this.host.readMessages(...args);

	async restore(input: RestoreInput): Promise<RestoreResult> {
		const sourceSessionId = input.sessionId.trim();
		if (!sourceSessionId) {
			throw new Error("sessionId is required");
		}
		const restoreMessages = input.restore?.messages !== false;
		const restoreWorkspace = input.restore?.workspace !== false;
		if (!restoreMessages && !restoreWorkspace) {
			throw new Error("restore.messages or restore.workspace must be true");
		}
		if (restoreMessages && !input.start) {
			throw new Error("start is required when restore.messages is true");
		}
		const sourceSession = await this.host.get(sourceSessionId);
		if (!sourceSession) {
			throw new Error(`Session ${sourceSessionId} not found`);
		}
		const sourceMessages = restoreMessages
			? await this.host.readMessages(sourceSessionId)
			: undefined;
		if (restoreMessages && sourceMessages?.length === 0) {
			throw new Error(`No messages found for session ${sourceSessionId}`);
		}
		const plan = createCheckpointRestorePlan({
			session: sourceSession,
			messages: sourceMessages,
			checkpointRunCount: input.checkpointRunCount,
			cwd: input.cwd,
			restoreMessages,
		});
		if (restoreWorkspace) {
			await applyCheckpointToWorktree(plan.cwd, plan.checkpoint);
		}
		if (!restoreMessages) {
			return { checkpoint: plan.checkpoint };
		}
		const startResult = await this.start({
			...input.start!,
			initialMessages: plan.messages ?? [],
		});
		return {
			sessionId: startResult.sessionId,
			startResult,
			messages: plan.messages,
			checkpoint: plan.checkpoint,
		};
	}

	/**
	 * Handles hook events from the runtime environment.
	 *
	 * Processes system or environment events (e.g., workspace changes, external signals)
	 * that may affect the current session. This is typically called by the host environment
	 * rather than directly by consumer code.
	 *
	 * @internal
	 */
	handleHookEvent: RuntimeHost["handleHookEvent"] = (...args) =>
		this.host.handleHookEvent(...args);
	/**
	 * Subscribes to session events.
	 *
	 * Registers a listener for all session events (messages, state changes, errors, etc.).
	 * Returns an unsubscribe function to stop listening.
	 *
	 * @param listener Callback function invoked for each event
	 * @param options Optional configuration for the subscription
	 * @returns An unsubscribe function
	 *
	 * @example
	 * ```ts
	 * const unsubscribe = cline.subscribe((event) => {
	 *   if (event.type === "message") {
	 *     console.log("New message:", event.payload.message);
	 *   }
	 * });
	 *
	 * // Later, stop listening
	 * unsubscribe();
	 * ```
	 */
	subscribe(
		listener: (event: CoreSessionEvent) => void,
		options?: RuntimeHostSubscribeOptions,
	): () => void {
		return this.host.subscribe(listener, options);
	}
	/**
	 * Updates the AI model used by an active session.
	 *
	 * Switches the session to use a different AI model while maintaining the session state
	 * and message history. This allows you to continue a conversation with a different model.
	 *
	 * @example
	 * ```ts
	 * // Switch to a different model mid-session
	 * await cline.updateSessionModel(sessionId, "claude-opus-4-1");
	 * ```
	 */
	updateSessionModel: RuntimeHost["updateSessionModel"] = (...args) =>
		this.host.updateSessionModel?.(...args) ?? Promise.resolve();
}
