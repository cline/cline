import type * as LlmsProviders from "@clinebot/llms";
import type {
	AgentResult,
	RuntimeConfigExtensionKind,
	ToolApprovalRequest,
	ToolApprovalResult,
} from "@clinebot/shared";
import type { ToolExecutors } from "../extensions/tools";
import type { HookEventPayload } from "../hooks";
import type { ProviderSettings } from "../llms/provider-settings";
import type { SessionManifest } from "../session/session-manifest";
import type { SessionSource } from "../types/common";
import type { CoreSessionConfig } from "../types/config";
import type { CoreSessionEvent, SessionPendingPrompt } from "../types/events";
import type { SessionRecord } from "../types/sessions";

type LocalOnlyCoreSessionConfigKeys =
	| "hooks"
	| "logger"
	| "telemetry"
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

export type LocalRuntimeConfigOverrides = Pick<
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
	configOverrides?: Partial<LocalRuntimeConfigOverrides>;
	modelCatalogDefaults?: Partial<NonNullable<ProviderSettings["modelCatalog"]>>;
	userInstructionWatcher?: import("../extensions/config").UserInstructionConfigWatcher;
	configExtensions?: RuntimeConfigExtensionKind[];
	onTeamRestored?: () => void;
	defaultToolExecutors?: Partial<ToolExecutors>;
}

export interface StartSessionInput {
	config: RuntimeSessionConfig;
	source?: SessionSource;
	prompt?: string;
	interactive?: boolean;
	sessionMetadata?: Record<string, unknown>;
	initialMessages?: LlmsProviders.Message[];
	userImages?: string[];
	userFiles?: string[];
	/**
	 * Host-local bootstrap options. These are intentionally isolated from the
	 * transport-neutral runtime session config so all runtime hosts share the
	 * same execution contract while still allowing host-specific preparation.
	 */
	localRuntime?: LocalRuntimeStartOptions;
	toolPolicies?: import("@clinebot/shared").AgentConfig["toolPolicies"];
	requestToolApproval?: (
		request: ToolApprovalRequest,
	) => Promise<ToolApprovalResult>;
}

export function splitCoreSessionConfig(config: CoreSessionConfig): {
	config: RuntimeSessionConfig;
	localRuntime?: LocalRuntimeStartOptions;
} {
	const {
		hooks,
		logger,
		telemetry,
		extraTools,
		extensions,
		onTeamEvent,
		onConsecutiveMistakeLimitReached,
		checkpoint,
		compaction,
		...transportConfig
	} = config;

	const localConfigOverrides: Partial<LocalRuntimeConfigOverrides> = {};
	if (hooks) localConfigOverrides.hooks = hooks;
	if (logger) localConfigOverrides.logger = logger;
	if (telemetry) localConfigOverrides.telemetry = telemetry;
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
			? {
					configOverrides:
						localConfigOverrides as Partial<LocalRuntimeConfigOverrides>,
				}
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
							thresholdRatio: compaction.thresholdRatio,
							reserveTokens: compaction.reserveTokens,
							preserveRecentTokens: compaction.preserveRecentTokens,
							contextWindowTokens: compaction.contextWindowTokens,
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
	userImages?: string[];
	userFiles?: string[];
	delivery?: "queue" | "steer";
}

export interface SessionAccumulatedUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	totalCost: number;
}

export interface PendingPromptMutationResult {
	sessionId: string;
	prompts: SessionPendingPrompt[];
	prompt?: SessionPendingPrompt;
	updated?: boolean;
	removed?: boolean;
}

export type PendingPromptsAction = "list" | "update" | "delete";

export interface PendingPromptsListInput {
	sessionId: string;
}

export interface PendingPromptsUpdateInput {
	sessionId: string;
	promptId: string;
	prompt?: string;
	delivery?: "queue" | "steer";
}

export interface PendingPromptsDeleteInput {
	sessionId: string;
	promptId: string;
}

export interface RuntimeHostSubscribeOptions {
	sessionId?: string;
}

/**
 * RuntimeHost is the transport/runtime boundary for core session execution.
 * Callers must normalize broad local config into `RuntimeSessionConfig`
 * plus optional `localRuntime` overrides before invoking a host.
 */
export interface RuntimeHost {
	readonly runtimeAddress?: string;
	start(input: StartSessionInput): Promise<StartSessionResult>;
	send(input: SendSessionInput): Promise<AgentResult | undefined>;
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
	getAccumulatedUsage(
		sessionId: string,
	): Promise<SessionAccumulatedUsage | undefined>;
	abort(sessionId: string, reason?: unknown): Promise<void>;
	stop(sessionId: string): Promise<void>;
	dispose(reason?: string): Promise<void>;
	get(sessionId: string): Promise<SessionRecord | undefined>;
	list(limit?: number): Promise<SessionRecord[]>;
	delete(sessionId: string): Promise<boolean>;
	update(
		sessionId: string,
		updates: {
			prompt?: string | null;
			metadata?: Record<string, unknown> | null;
			title?: string | null;
		},
	): Promise<{ updated: boolean }>;
	readMessages(sessionId: string): Promise<LlmsProviders.Message[]>;
	handleHookEvent(payload: HookEventPayload): Promise<void>;
	subscribe(
		listener: (event: CoreSessionEvent) => void,
		options?: RuntimeHostSubscribeOptions,
	): () => void;
	updateSessionModel?(sessionId: string, modelId: string): Promise<void>;
}

export type RuntimeHostMode = "auto" | "local" | "hub" | "remote";
