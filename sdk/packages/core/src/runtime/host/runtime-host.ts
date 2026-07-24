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
	source?: SessionSource;
	prompt?: string;
	interactive?: boolean;
	sessionMetadata?: Record<string, unknown>;
	initialMessages?: LlmsProviders.Message[];
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
	messages?: LlmsProviders.Message[];
	checkpoint: CheckpointEntry;
}

/**
 * RuntimeHost is the transport/runtime boundary for core session execution.
 * Callers must normalize broad local config into `RuntimeSessionConfig`
 * plus optional named `localRuntime` bootstrap fields before invoking a host.
 */
export interface RuntimeHost {
	readonly runtimeAddress?: string;
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
	readSessionMessages(sessionId: string): Promise<LlmsProviders.Message[]>;
	dispatchHookEvent(payload: HookEventPayload): Promise<void>;
	subscribe(
		listener: (event: CoreSessionEvent) => void,
		options?: RuntimeHostSubscribeOptions,
	): () => void;
}

export type RuntimeHostMode = "auto" | "local" | "hub" | "remote";
