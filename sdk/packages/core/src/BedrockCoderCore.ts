import type {
	CreateTeamTaskInput,
	TeamBoardSnapshot,
	TeamRunRecord,
	TeamTask,
	UpdateTeamTaskInput,
} from "@bedrock-coder/shared";
import {
	createBedrockCoderCorePendingPromptsApi,
	createBedrockCoderCoreSettingsApi,
	type RuntimeHostServiceExtensions,
} from "./bedrock-coder-core/runtime-services";
import {
	normalizeBedrockCoderCoreStartInput,
	toBedrockCoderCoreStartInput,
} from "./bedrock-coder-core/start-input";
import type {
	BedrockCoderCoreListHistoryOptions,
	BedrockCoderCoreOptions,
	BedrockCoderCoreSettingsApi,
	BedrockCoderCoreStartInput,
	CompareCheckpointInput,
	CompareCheckpointResult,
	RestoreInput,
	RestoreResult,
	StartSessionBootstrap,
} from "./bedrock-coder-core/types";
import type { RuntimeCapabilities } from "./runtime/capabilities";
import { normalizeRuntimeCapabilities } from "./runtime/capabilities";
import { listSessionHistory } from "./runtime/host/history";
import { createRuntimeHost } from "./runtime/host/host";
import type {
	PendingPromptsServiceApi,
	RuntimeHost,
	RuntimeHostSubscribeOptions,
	SessionConnectionRuntimeService,
	SessionModelRuntimeService,
	SessionUsageRuntimeService,
	StartSessionInput,
	StartSessionResult,
} from "./runtime/host/runtime-host";
import type { TeamRuntimeService } from "./runtime/orchestration/session-runtime";
import { compareCheckpointToWorkspace } from "./session/checkpoint-diff";
import type { CoreSessionEvent } from "./types/events";
import type { SessionHistoryRecord } from "./types/sessions";

export type {
	BedrockCoderCoreListHistoryOptions,
	BedrockCoderCoreOptions,
	BedrockCoderCoreSettingsApi,
	BedrockCoderCoreStartInput,
	CompareCheckpointInput,
	CompareCheckpointResult,
	HubOptions,
	RemoteOptions,
	RestoreInput,
	RestoreOptions,
	RestoreResult,
	RuntimeHostMode,
	StartSessionBootstrap,
} from "./bedrock-coder-core/types";

/**
 * The primary entry point for the BedrockCoder Core SDK.
 *
 * @example
 * ```ts
 * import { BedrockCoderCore } from "@bedrock-coder/core";
 *
 * const bedrockCoder = await BedrockCoderCore.create({ clientName: "my-app" });
 * const session = await bedrockCoder.start({ ... });
 * ```
 */
export class BedrockCoderCore {
	readonly clientName: string | undefined;
	readonly runtimeAddress: string | undefined;
	readonly settings: BedrockCoderCoreSettingsApi;
	readonly pendingPrompts: PendingPromptsServiceApi;
	private readonly host: RuntimeHost;
	private readonly prepare: BedrockCoderCoreOptions["prepare"] | undefined;
	private readonly capabilities: RuntimeCapabilities | undefined;
	private readonly activeSessionBootstraps = new Map<
		string,
		StartSessionBootstrap
	>();
	private readonly unsubscribeBootstrapCleanup: () => void;

	private constructor(
		host: RuntimeHost,
		clientName: string | undefined,
		runtimeAddress: string | undefined,
		prepare: BedrockCoderCoreOptions["prepare"],
		capabilities: RuntimeCapabilities | undefined,
	) {
		this.clientName = clientName;
		this.runtimeAddress = runtimeAddress;
		this.host = host;
		this.prepare = prepare;
		this.capabilities = capabilities;
		this.settings = createBedrockCoderCoreSettingsApi(host);
		this.pendingPrompts = createBedrockCoderCorePendingPromptsApi(host);
		this.unsubscribeBootstrapCleanup = this.host.subscribe((event) => {
			if (event.type !== "ended") {
				return;
			}
			void this.disposeSessionBootstrap(event.payload.sessionId);
		});
	}

	/**
	 * Creates a new BedrockCoderCore instance.
	 *
	 * This is the primary factory method for initializing the SDK. It sets up the runtime
	 * host (local, hub, or remote) based on the provided options and prepares the SDK for
	 * starting sessions.
	 *
	 * @param options Configuration options for the SDK instance
	 * @returns A promise that resolves to a new BedrockCoderCore instance
	 *
	 * @example
	 * ```ts
	 * const bedrockCoder = await BedrockCoderCore.create({
	 *   clientName: "my-app",
	 *   backendMode: "local",
	 * });
	 * ```
	 */
	static async create(options: BedrockCoderCoreOptions = {}): Promise<BedrockCoderCore> {
		const capabilities = normalizeRuntimeCapabilities(options.capabilities);
		const normalizedOptions = { ...options, capabilities };
		const host = await createRuntimeHost(normalizedOptions);
		const core = new BedrockCoderCore(
			host,
			options.clientName,
			host.runtimeAddress,
			options.prepare,
			capabilities,
		);
		return core;
	}

	private async disposeSessionBootstrap(sessionId: string): Promise<void> {
		const bootstrap = this.activeSessionBootstraps.get(sessionId);
		if (!bootstrap) {
			return;
		}
		this.activeSessionBootstraps.delete(sessionId);
		await Promise.resolve(bootstrap.dispose?.());
	}

	/**
	 * Starts a new BedrockCoder session with the provided configuration.
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
	 * const result = await bedrockCoder.start({
	 *   config: {
	 *     providerId: "bedrock",
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
	 * Starts a new BedrockCoder session with extended core-specific configuration.
	 * This overload allows specifying local runtime options and config overrides.
	 */
	start(input: BedrockCoderCoreStartInput): Promise<StartSessionResult>;
	async start(
		input: StartSessionInput | BedrockCoderCoreStartInput,
	): Promise<StartSessionResult> {
		const bedrockCoderCoreInput = toBedrockCoderCoreStartInput(input);
		const bootstrap = await this.prepare?.(bedrockCoderCoreInput);
		try {
			const preparedInput = bootstrap
				? await bootstrap.applyToStartSessionInput(bedrockCoderCoreInput)
				: bedrockCoderCoreInput;
			const result = await this.host.startSession(
				normalizeBedrockCoderCoreStartInput(preparedInput, {
					defaultCapabilities: this.capabilities,
				}),
			);
			if (bootstrap) {
				const activeSession = await this.host.getSession(result.sessionId);
				if (activeSession) {
					this.activeSessionBootstraps.set(result.sessionId, bootstrap);
				} else {
					await Promise.resolve(bootstrap.dispose?.());
				}
			}
			return result;
		} catch (error) {
			await Promise.resolve(bootstrap?.dispose?.());
			throw error;
		}
	}
	/**
	 * Sends a message or command to an active session.
	 *
	 * This method communicates with a running session, allowing you to send user messages,
	 * tool responses, or other session input while the session is in progress.
	 *
	 * @example
	 * ```ts
	 * await bedrockCoder.send(sessionId, {
	 *   type: "user_message",
	 *   text: "Please implement the login feature",
	 * });
	 * ```
	 */
	send: RuntimeHost["runTurn"] = (...args) => this.host.runTurn(...args);

	getTeamBoard(sessionId: string): TeamBoardSnapshot | undefined {
		return (
			this.host as RuntimeHost & Partial<TeamRuntimeService>
		).getTeamBoard?.(sessionId);
	}

	createTeamTask(
		sessionId: string,
		input: Omit<CreateTeamTaskInput, "createdBy">,
	): TeamTask {
		const service = this.host as RuntimeHost & Partial<TeamRuntimeService>;
		if (!service.createTeamTask) {
			throw new Error("Team task management requires the local runtime");
		}
		return service.createTeamTask(sessionId, input);
	}

	updateTeamTask(sessionId: string, input: UpdateTeamTaskInput): TeamTask {
		const service = this.host as RuntimeHost & Partial<TeamRuntimeService>;
		if (!service.updateTeamTask) {
			throw new Error("Team task management requires the local runtime");
		}
		return service.updateTeamTask(sessionId, input);
	}

	cancelTeamRun(
		sessionId: string,
		runId: string,
		reason?: string,
	): TeamRunRecord {
		const service = this.host as RuntimeHost & Partial<TeamRuntimeService>;
		if (!service.cancelTeamRun) {
			throw new Error("Team run management requires the local runtime");
		}
		return service.cancelTeamRun(sessionId, runId, reason);
	}
	/**
	 * Retrieves accumulated token and cost usage for a session.
	 *
	 * Returns metrics about the session's resource consumption, including tokens used
	 * across different API providers and associated costs. The `usage` field is
	 * root/lead-agent usage; `aggregateUsage` includes teammates and subagents.
	 *
	 * @example
	 * ```ts
	 * const usageSummary = await bedrockCoder.getAccumulatedUsage(sessionId);
	 * console.log(`Total cost: $${usageSummary?.aggregateUsage?.totalCost}`);
	 * ```
	 */
	getAccumulatedUsage: SessionUsageRuntimeService["getAccumulatedUsage"] = (
		...args
	) => {
		const service = this.host as RuntimeHostServiceExtensions;
		return service.getAccumulatedUsage?.(...args) ?? Promise.resolve(undefined);
	};
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
	 * await bedrockCoder.abort(sessionId);
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
	 * await bedrockCoder.stop(sessionId);
	 * ```
	 */
	stop: RuntimeHost["stopSession"] = async (sessionId) => {
		await this.host.stopSession(sessionId);
		await this.disposeSessionBootstrap(sessionId);
	};
	/**
	 * Disposes the BedrockCoderCore instance and all associated resources.
	 *
	 * Shuts down the runtime host, closes connections, and cleans up all active sessions
	 * and bootstraps. Call this when you're done using the SDK instance, typically at
	 * application shutdown. After calling dispose, the instance cannot be reused.
	 *
	 * @example
	 * ```ts
	 * // Clean up when done
	 * await bedrockCoder.dispose();
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
	 * const session = await bedrockCoder.get(sessionId);
	 * console.log("Session status:", session?.status);
	 * ```
	 */
	get: RuntimeHost["getSession"] = (...args) => this.host.getSession(...args);
	/**
	 * Lists recent sessions through the shared history-listing path.
	 */
	listHistory = async (
		options: BedrockCoderCoreListHistoryOptions = {},
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
	 * const sessions = await bedrockCoder.list(50);
	 * sessions.forEach((session) => {
	 *   console.log(`Session ${session.sessionId}: ${session.metadata?.title}`);
	 * });
	 * ```
	 */
	list = async (
		limit = 200,
		options: Omit<BedrockCoderCoreListHistoryOptions, "limit"> = {},
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
	 * const deleted = await bedrockCoder.delete(sessionId);
	 * if (deleted) {
	 *   console.log("Session deleted successfully");
	 * }
	 * ```
	 */
	delete: RuntimeHost["deleteSession"] = async (sessionId) => {
		const deleted = await this.host.deleteSession(sessionId);
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
	 * await bedrockCoder.update(sessionId, {
	 *   title: "Updated session title",
	 * });
	 * ```
	 */
	update: RuntimeHost["updateSession"] = (...args) =>
		this.host.updateSession(...args);
	/**
	 * Stores the compacted working-context state for an existing session.
	 */
	updateSessionCompactionState: RuntimeHost["updateSessionCompactionState"] = (
		...args
	) => this.host.updateSessionCompactionState(...args);
	/**
	 * Reads the compacted working-context sidecar for a session, if one exists.
	 */
	readSessionCompactionState: RuntimeHost["readSessionCompactionState"] = (
		...args
	) => this.host.readSessionCompactionState(...args);
	/**
	 * Reads message history for a session.
	 *
	 * Retrieves the full message transcript for a specific session, including all
	 * user messages, agent responses, and tool interactions.
	 *
	 * @example
	 * ```ts
	 * const messages = await bedrockCoder.readMessages(sessionId);
	 * messages.forEach((msg) => {
	 *   console.log(`${msg.role}: ${msg.content}`);
	 * });
	 * ```
	 */
	readMessages: RuntimeHost["readSessionMessages"] = (...args) =>
		this.host.readSessionMessages(...args);

	async restore(input: RestoreInput): Promise<RestoreResult> {
		const normalizedStart = input.start
			? normalizeBedrockCoderCoreStartInput(input.start, {
					defaultCapabilities: this.capabilities,
				})
			: undefined;
		return this.host.restoreSession({
			sessionId: input.sessionId,
			checkpointRunCount: input.checkpointRunCount,
			cwd: input.cwd,
			restore: input.restore,
			start: normalizedStart,
		});
	}

	async compareCheckpoint(
		input: CompareCheckpointInput,
	): Promise<CompareCheckpointResult> {
		const sessionId = input.sessionId.trim();
		if (!sessionId) {
			throw new Error("sessionId is required");
		}
		const session = await this.host.getSession(sessionId);
		if (!session) {
			throw new Error(`Session ${sessionId} not found`);
		}
		return compareCheckpointToWorkspace({
			session,
			checkpointRunCount: input.checkpointRunCount,
			cwd: input.cwd,
		});
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
	ingestHookEvent: RuntimeHost["dispatchHookEvent"] = (...args) =>
		this.host.dispatchHookEvent(...args);
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
	 * const unsubscribe = bedrockCoder.subscribe((event) => {
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
	 * await bedrockCoder.updateSessionModel(sessionId, "claude-opus-4-1");
	 * ```
	 */
	updateSessionModel: SessionModelRuntimeService["updateSessionModel"] = (
		...args
	) => {
		const service = this.host as RuntimeHostServiceExtensions;
		return service.updateSessionModel?.(...args) ?? Promise.resolve();
	};
	/**
	 * Updates provider/model/reasoning connection options for subsequent turns in
	 * an active session.
	 */
	updateSessionConnection: SessionConnectionRuntimeService["updateSessionConnection"] =
		(...args) => {
			const service = this.host as RuntimeHostServiceExtensions;
			return service.updateSessionConnection?.(...args) ?? Promise.resolve();
		};
}
