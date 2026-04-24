import type {
	AgentConfig,
	BasicLogger,
	ITelemetryService,
	ToolApprovalRequest,
	ToolApprovalResult,
} from "@clinebot/shared";
import type { ToolExecutors } from "./extensions/tools";
import { hydrateSessionHistory } from "./runtime/history";
import type { SessionBackend } from "./runtime/host";
import { createRuntimeHost } from "./runtime/host";
import type {
	LocalRuntimeStartOptions,
	RuntimeHost,
	RuntimeHostMode,
	RuntimeHostSubscribeOptions,
	StartSessionInput,
	StartSessionResult,
} from "./runtime/runtime-host";
import { splitCoreSessionConfig } from "./runtime/runtime-host";
import { CORE_TELEMETRY_EVENTS } from "./services/telemetry/core-events";
import { SessionSource } from "./types/common";
import type { CoreSessionConfig } from "./types/config";
import type { CoreSessionEvent } from "./types/events";
import type { SessionMessagesArtifactUploader } from "./types/session";

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

export type { RuntimeHostMode };

export interface ClineCoreStartInput
	extends Omit<StartSessionInput, "config" | "localRuntime"> {
	config: CoreSessionConfig;
	localRuntime?: LocalRuntimeStartOptions;
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
	private readonly host: RuntimeHost;
	private readonly prepare: ClineCoreOptions["prepare"] | undefined;
	private readonly defaultToolExecutors: Partial<ToolExecutors> | undefined;
	private readonly telemetry: ITelemetryService | undefined;
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
		telemetry: ITelemetryService | undefined,
	) {
		this.clientName = clientName;
		this.runtimeAddress = runtimeAddress;
		this.host = host;
		this.prepare = prepare;
		this.defaultToolExecutors = defaultToolExecutors;
		this.telemetry = telemetry;
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
		return new ClineCore(
			host,
			options.clientName,
			host.runtimeAddress,
			options.prepare,
			options.defaultToolExecutors,
			options.telemetry,
		);
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
		const localRuntime =
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
	 * Lists recent sessions with their full history.
	 *
	 * Retrieves a paginated list of recent sessions, optionally limited by the provided
	 * count. Each session includes its complete message history and metadata.
	 *
	 * @param limit Maximum number of sessions to return (defaults to 200)
	 * @returns A promise resolving to an array of sessions with full history
	 *
	 * @example
	 * ```ts
	 * const sessions = await cline.list(50);
	 * sessions.forEach((session) => {
	 *   console.log(`Session ${session.id}: ${session.messages.length} messages`);
	 * });
	 * ```
	 */
	list: RuntimeHost["list"] = async (limit = 200) =>
		await hydrateSessionHistory(this.host, await this.host.list(limit));
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
