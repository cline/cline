import type * as LlmsProviders from "@cline/llms";
import type {
	AgentMode,
	AgentResult,
	RuntimeConfigExtensionKind,
} from "@cline/shared";
import type { HookEventPayload } from "../../hooks";
import type { CheckpointEntry } from "../../hooks/checkpoint-hooks";
import type { ProviderSettings } from "../../services/llms/provider-settings";
import type { SessionCompactionState } from "../../session/models/session-compaction";
import type { SessionManifest } from "../../session/models/session-manifest";
import type { SessionSource } from "../../types/common";
import type {
	ClineCoreStartConfig,
	CoreSessionConfig,
} from "../../types/config";
import type {
	CoreSessionEvent,
	SessionPendingPrompt,
} from "../../types/events";
import type { SessionRecord } from "../../types/sessions";
import type { RuntimeCapabilities } from "../capabilities";
import type { ConnectionUpdate } from "../config/connection-update";

export const SESSION_NOT_FOUND_ERROR_CODE = "session_not_found";

export class SessionNotFoundError extends Error {
	readonly code = SESSION_NOT_FOUND_ERROR_CODE;

	constructor(
		readonly sessionId?: string,
		message?: string,
	) {
		super(
			message ??
				(sessionId ? `session not found: ${sessionId}` : "session not found"),
		);
		this.name = "SessionNotFoundError";
	}
}

export function isSessionNotFoundError(
	error: unknown,
): error is SessionNotFoundError {
	return (
		error instanceof SessionNotFoundError ||
		(typeof error === "object" &&
			error !== null &&
			"code" in error &&
			(error as { code?: unknown }).code === SESSION_NOT_FOUND_ERROR_CODE)
	);
}

function errorMessageOf(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (typeof error === "object" && error !== null && "message" in error) {
		const message = (error as { message?: unknown }).message;
		return typeof message === "string" ? message : "";
	}
	return typeof error === "string" ? error : "";
}

/**
 * A session that cannot serve another turn, whatever the caller does with it.
 *
 * Two distinct causes, one remedy: the session is gone (`session_not_found`,
 * after a hub restart, a deletion, or retention cleanup), or its runtime is stuck
 * with a run that never drained (`session_run_in_progress`). A caller holding a
 * long-lived mapping to that session — a connector thread, for instance — has to
 * replace the session rather than keep retrying against it.
 *
 * Errors reaching a connector have crossed the hub's JSON boundary, so the code
 * may be gone and only the message survives; both are checked, which also keeps
 * this working when the hub and the CLI are different versions.
 */
export function isUnusableSessionError(error: unknown): boolean {
	if (isSessionNotFoundError(error)) {
		return true;
	}
	if (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === "session_run_in_progress"
	) {
		return true;
	}
	return errorMessageOf(error).includes(
		"shutdown called while a run is in progress",
	);
}

type LocalOnlyCoreSessionConfigKeys =
	| "hooks"
	| "logger"
	| "telemetry"
	| "extensionContext"
	| "extraTools"
	| "extensions"
	| "onTeamEvent"
	| "onConsecutiveMistakeLimitReached";

export type RuntimeSessionConfig = Omit<
	CoreSessionConfig,
	LocalOnlyCoreSessionConfigKeys | "checkpoint" | "compaction"
> & {
	checkpoint?: Omit<
		NonNullable<CoreSessionConfig["checkpoint"]>,
		"createCheckpoint"
	>;
	compaction?: Omit<NonNullable<CoreSessionConfig["compaction"]>, "compact">;
};

/** Workspace paths may be omitted only at the session-start boundary. */
export type StartSessionConfig = Omit<RuntimeSessionConfig, "cwd"> & {
	cwd?: string;
};

export type LocalRuntimeBootstrapConfig = Pick<
	CoreSessionConfig,
	LocalOnlyCoreSessionConfigKeys
> & {
	checkpoint?: Pick<
		NonNullable<CoreSessionConfig["checkpoint"]>,
		"createCheckpoint"
	> &
		Partial<NonNullable<CoreSessionConfig["checkpoint"]>>;
	compaction?: Pick<NonNullable<CoreSessionConfig["compaction"]>, "compact"> &
		Partial<NonNullable<CoreSessionConfig["compaction"]>>;
};

export interface LocalRuntimeStartOptions {
	hooks?: LocalRuntimeBootstrapConfig["hooks"];
	logger?: LocalRuntimeBootstrapConfig["logger"];
	telemetry?: LocalRuntimeBootstrapConfig["telemetry"];
	extensionContext?: LocalRuntimeBootstrapConfig["extensionContext"];
	extraTools?: LocalRuntimeBootstrapConfig["extraTools"];
	extensions?: LocalRuntimeBootstrapConfig["extensions"];
	onTeamEvent?: LocalRuntimeBootstrapConfig["onTeamEvent"];
	onConsecutiveMistakeLimitReached?: LocalRuntimeBootstrapConfig["onConsecutiveMistakeLimitReached"];
	checkpoint?: LocalRuntimeBootstrapConfig["checkpoint"];
	compaction?: LocalRuntimeBootstrapConfig["compaction"];
	modelCatalogDefaults?: Partial<NonNullable<ProviderSettings["modelCatalog"]>>;
	userInstructionService?: import("../../extensions/config").UserInstructionConfigService;
	configExtensions?: RuntimeConfigExtensionKind[];
	onTeamRestored?: () => void;
}

export interface StartSessionInput {
	config: StartSessionConfig;
	/** The process/client that starts the session. E.g., "vscode", "cli". */
	source?: SessionSource;
	/** How the session was initiated, such as user, automation, or subagent. */
	mode?: string;
	prompt?: string;
	interactive?: boolean;
	sessionMetadata?: Record<string, unknown>;
	initialMessages?: LlmsProviders.MessageWithMetadata[];
	initialCompactionState?: SessionCompactionState;
	userImages?: string[];
	userFiles?: string[];
	/**
	 * Host-local bootstrap options. These are intentionally isolated from the
	 * transport-neutral runtime session config so all runtime hosts share the
	 * same execution contract while still allowing host-specific preparation.
	 */
	localRuntime?: LocalRuntimeStartOptions;
	capabilities?: RuntimeCapabilities;
	toolPolicies?: import("@cline/shared").AgentConfig["toolPolicies"];
}

/** Session input after the execution host has resolved a concrete workspace. */
export interface ResolvedStartSessionInput
	extends Omit<StartSessionInput, "config"> {
	config: RuntimeSessionConfig;
}

export function splitCoreSessionConfig(config: ClineCoreStartConfig): {
	config: StartSessionConfig;
	localRuntime?: LocalRuntimeStartOptions;
} {
	const {
		hooks,
		logger,
		telemetry,
		extensionContext,
		extraTools,
		extensions,
		onTeamEvent,
		onConsecutiveMistakeLimitReached,
		checkpoint,
		compaction,
		...transportConfig
	} = config;

	const localConfigOverrides: Partial<LocalRuntimeBootstrapConfig> = {};
	if (hooks) localConfigOverrides.hooks = hooks;
	if (logger) localConfigOverrides.logger = logger;
	if (telemetry) localConfigOverrides.telemetry = telemetry;
	if (extensionContext)
		localConfigOverrides.extensionContext = extensionContext;
	if (extraTools) localConfigOverrides.extraTools = extraTools;
	if (extensions) localConfigOverrides.extensions = extensions;
	if (onTeamEvent) localConfigOverrides.onTeamEvent = onTeamEvent;
	if (onConsecutiveMistakeLimitReached) {
		localConfigOverrides.onConsecutiveMistakeLimitReached =
			onConsecutiveMistakeLimitReached;
	}
	if (checkpoint?.createCheckpoint) {
		localConfigOverrides.checkpoint = checkpoint;
	}
	if (compaction?.compact) {
		localConfigOverrides.compaction = compaction;
	}

	const localRuntime =
		Object.keys(localConfigOverrides).length > 0
			? (localConfigOverrides as LocalRuntimeStartOptions)
			: undefined;

	return {
		config: {
			...transportConfig,
			...(checkpoint ? { checkpoint: { enabled: checkpoint.enabled } } : {}),
			...(compaction
				? {
						compaction: {
							enabled: compaction.enabled,
							strategy: compaction.strategy,
							preserveRecentTokens: compaction.preserveRecentTokens,
							summarizer: compaction.summarizer,
						},
					}
				: {}),
		},
		...(localRuntime ? { localRuntime } : {}),
	};
}

export interface StartSessionResult {
	sessionId: string;
	manifest: SessionManifest;
	manifestPath: string;
	messagesPath: string;
	result?: AgentResult;
}

export interface SendSessionInput {
	sessionId: string;
	prompt: string;
	mode?: AgentMode;
	userImages?: string[];
	userFiles?: string[];
	delivery?: "queue" | "steer";
	timeoutMs?: number;
}

export interface SessionAccumulatedUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	totalCost: number;
}

export interface SessionUsageSummary {
	usage?: SessionAccumulatedUsage;
	aggregateUsage?: SessionAccumulatedUsage;
}

export interface PendingPromptMutationResult {
	sessionId: string;
	prompts: SessionPendingPrompt[];
	prompt?: SessionPendingPrompt;
	updated?: boolean;
	removed?: boolean;
}

export interface PendingPromptsListInput {
	sessionId: string;
}

export interface PendingPromptsUpdateInput {
	sessionId: string;
	promptId: string;
	prompt?: string;
	mode?: AgentMode;
	delivery?: "queue" | "steer";
}

export interface PendingPromptsDeleteInput {
	sessionId: string;
	promptId: string;
}

export interface PendingPromptsServiceApi {
	list(input: PendingPromptsListInput): Promise<SessionPendingPrompt[]>;
	update(
		input: PendingPromptsUpdateInput,
	): Promise<PendingPromptMutationResult>;
	delete(
		input: PendingPromptsDeleteInput,
	): Promise<PendingPromptMutationResult>;
}

export interface PendingPromptsRuntimeService {
	readonly pendingPrompts: PendingPromptsServiceApi;
}

export interface SessionUsageRuntimeService {
	getAccumulatedUsage(
		sessionId: string,
	): Promise<SessionUsageSummary | undefined>;
}

export type SessionConnectionUpdate = ConnectionUpdate;

export interface SessionModelRuntimeService {
	updateSessionModel(sessionId: string, modelId: string): Promise<void>;
}

export interface SessionConnectionRuntimeService {
	updateSessionConnection(
		sessionId: string,
		updates: SessionConnectionUpdate,
	): Promise<void>;
}

export interface CommandExecutionRuntimeService {
	proceedWhileRunning(sessionId: string, toolCallId?: string): Promise<number>;
}

export interface RuntimeHostSubscribeOptions {
	sessionId?: string;
}

export interface RestoreSessionInput {
	sessionId: string;
	checkpointRunCount: number;
	cwd?: string;
	restore?: {
		messages?: boolean;
		workspace?: boolean;
		omitCheckpointMessageFromSession?: boolean;
	};
	start?: StartSessionInput;
}

export interface RestoreSessionResult {
	sessionId?: string;
	startResult?: StartSessionResult;
	messages?: LlmsProviders.MessageWithMetadata[];
	checkpoint: CheckpointEntry;
}

/**
 * RuntimeHost is the transport/runtime boundary for core session execution.
 * Callers must normalize broad local config into `RuntimeSessionConfig`
 * plus optional named `localRuntime` bootstrap fields before invoking a host.
 */
export interface RuntimeHost {
	readonly runtimeAddress?: string;
	proceedWhileRunning?: CommandExecutionRuntimeService["proceedWhileRunning"];
	startSession(input: StartSessionInput): Promise<StartSessionResult>;
	runTurn(input: SendSessionInput): Promise<AgentResult | undefined>;
	restoreSession(input: RestoreSessionInput): Promise<RestoreSessionResult>;
	abort(sessionId: string, reason?: unknown): Promise<void>;
	stopSession(sessionId: string): Promise<void>;
	dispose(reason?: string): Promise<void>;
	getSession(sessionId: string): Promise<SessionRecord | undefined>;
	listSessions(limit?: number): Promise<SessionRecord[]>;
	deleteSession(sessionId: string): Promise<boolean>;
	updateSession(
		sessionId: string,
		updates: {
			prompt?: string | null;
			metadata?: Record<string, unknown> | null;
			title?: string | null;
		},
	): Promise<{ updated: boolean }>;
	updateSessionCompactionState(
		sessionId: string,
		state: SessionCompactionState,
	): Promise<{ updated: boolean }>;
	readSessionCompactionState(
		sessionId: string,
	): Promise<SessionCompactionState | undefined>;
	readSessionMessages(
		sessionId: string,
	): Promise<LlmsProviders.MessageWithMetadata[]>;
	/**
	 * Like {@link readSessionMessages}, but prefers the resident session's
	 * in-memory conversation over the persisted transcript. Disk persistence
	 * happens at assistant-message/turn boundaries (and abort() does not
	 * flush), so this is the accurate read for callers that need the
	 * conversation of an in-flight or just-aborted turn — e.g. rebuilding a
	 * session for a mode switch. Optional: hosts without live-session access
	 * (e.g. hub clients) fall back to the persisted transcript.
	 */
	readLiveSessionMessages?(
		sessionId: string,
	): Promise<LlmsProviders.MessageWithMetadata[]>;
	dispatchHookEvent(payload: HookEventPayload): Promise<void>;
	subscribe(
		listener: (event: CoreSessionEvent) => void,
		options?: RuntimeHostSubscribeOptions,
	): () => void;
}

export type RuntimeHostMode = "auto" | "local" | "hub" | "remote";
